import CoreLocation
import Foundation
import MapKit
import SwiftUI

@MainActor
final class CurbViewModel: ObservableObject {
    static let sanFrancisco = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)
    private static let segmentCap = 2_500
    private static let minLongitudeDeltaForCurbData = 0.055

    @Published var overlays: [CurbOverlayItem] = []
    @Published var selected: CurbSelection?
    @Published var parkedCoordinate: CLLocationCoordinate2D?
    @Published var cameraRequest: CameraRequest?
    @Published var searchText = ""
    @Published var suggestions: [SearchSuggestion] = []
    @Published var dayFilter: Int?
    @Published var isLoading = false
    @Published var toast: String?
    @Published var savedAlertKey = UserDefaults.standard.string(forKey: "curb.native.alertKey") ?? ""

    private let client = DataSFClient()
    private let locationProvider = LocationProvider()
    private var groups: [CurbGroup] = []
    private var lastRows: [SweepRow] = []
    private var loadTask: Task<Void, Never>?
    private var suggestionTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    init() {
        locationProvider.onResult = { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let coordinate):
                    self?.moveTo(coordinate, span: .street)
                    self?.parkedCoordinate = coordinate
                    self?.loadTask?.cancel()
                    self?.loadTask = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(500))
                        await self?.selectNearest(to: coordinate)
                    }
                case .failure:
                    self?.showToast("Location is blocked. Search a street or tap where you parked.")
                }
            }
        }
    }

    func initialRegion() -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: Self.sanFrancisco,
            span: MKCoordinateSpan(latitudeDelta: 0.032, longitudeDelta: 0.032)
        )
    }

    func regionDidChange(_ region: MKCoordinateRegion) {
        loadTask?.cancel()
        loadTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(325))
            await loadViewport(region)
        }
    }

    func loadViewport(_ region: MKCoordinateRegion) async {
        guard region.span.longitudeDelta <= Self.minLongitudeDeltaForCurbData else {
            overlays = []
            groups = []
            showToast("Zoom in for block-by-block curb rules.")
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let count = try await client.sweepCount(in: region)
            guard count <= Self.segmentCap else {
                overlays = []
                groups = []
                showToast("This view has too many blocks. Zoom in a little.")
                return
            }
            let rows = try await client.sweepRows(in: region, limit: Self.segmentCap)
            lastRows = rows
            rebuildGroups()
            if rows.isEmpty {
                showToast("No SF street-sweeping data in this view.")
            }
        } catch {
            showToast("Could not load that area. Pan and try again.")
        }
    }

    func selectDay(_ day: Int?) {
        dayFilter = dayFilter == day ? nil : day
        rebuildGroups()
        if let dayFilter {
            showToast("\(SweepSchedule.fullDayLabels[dayFilter]) filter is on.")
        }
    }

    func tapMap(at coordinate: CLLocationCoordinate2D) {
        parkedCoordinate = coordinate
        if groups.isEmpty {
            moveTo(coordinate, span: .street)
            showToast("Loading this block.")
            return
        }
        selectNearest(to: coordinate)
    }

    func locate() {
        locationProvider.requestLocation()
    }

    func notify(_ message: String) {
        showToast(message)
    }

    func select(group: CurbGroup, side: CurbSide) {
        parkedCoordinate = side.midpoint
        selected = CurbSelection(group: group, side: side)
        hydrateSelectionDetails()
    }

    func updateSuggestions() {
        suggestionTask?.cancel()
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else {
            suggestions = []
            return
        }

        suggestionTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(220))
            await loadSuggestions(for: query)
        }
    }

    func performSearch() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        suggestions = []

        if let normalized = SearchNormalizer.address(query) {
            do {
                if let row = try await client.address(normalized), let coordinate = row.coordinate {
                    searchText = row.address ?? query
                    parkedCoordinate = coordinate
                    moveTo(coordinate, span: .street)
                    loadTask?.cancel()
                    loadTask = Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(650))
                        await self.selectNearest(to: coordinate, cnnHint: row.cnn)
                    }
                    return
                }
            } catch {
                showToast("Address search failed. Try a nearby cross street.")
            }
        }

        do {
            if let row = try await client.streetMatches(query, limit: 1).first,
               let coordinate = row.line?.locations.first {
                searchText = row.corridor ?? query
                moveTo(coordinate, span: .street)
                return
            }
            showToast("No SF street matched \"\(query)\".")
        } catch {
            showToast("Search failed. Try again.")
        }
    }

    func pickSuggestion(_ suggestion: SearchSuggestion) {
        suggestions = []
        switch suggestion.kind {
        case .address(let row):
            guard let coordinate = row.coordinate else { return }
            searchText = row.address ?? suggestion.title
            parkedCoordinate = coordinate
            moveTo(coordinate, span: .street)
            loadTask?.cancel()
            loadTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(650))
                await self.selectNearest(to: coordinate, cnnHint: row.cnn)
            }
        case .street(let row):
            guard let coordinate = row.line?.locations.first else { return }
            searchText = row.corridor ?? suggestion.title
            moveTo(coordinate, span: .street)
        }
    }

    func setAlertKey(_ key: String) {
        savedAlertKey = key
        UserDefaults.standard.set(key, forKey: "curb.native.alertKey")
    }

    private func loadSuggestions(for query: String) async {
        var next: [SearchSuggestion] = []
        if let normalized = SearchNormalizer.address(query) {
            if let rows = try? await client.addressSuggestions(normalized) {
                next.append(contentsOf: rows.map {
                    SearchSuggestion(title: $0.address ?? query, kind: .address($0))
                })
            }
        }
        if let rows = try? await client.streetMatches(query, limit: next.isEmpty ? 6 : 3) {
            next.append(contentsOf: rows.compactMap { row in
                guard let title = row.corridor else { return nil }
                return SearchSuggestion(title: title, kind: .street(row))
            })
        }
        if query == searchText.trimmingCharacters(in: .whitespacesAndNewlines) {
            suggestions = next
        }
    }

    private func rebuildGroups() {
        groups = Self.buildGroups(from: lastRows, dayFilter: dayFilter)
        overlays = groups.flatMap { group in
            group.sides.map { side in
                CurbOverlayItem(
                    id: "\(group.cnn)|\(side.id)",
                    coordinates: side.coordinates,
                    status: side.status
                )
            }
        }
    }

    private func selectNearest(to coordinate: CLLocationCoordinate2D, cnnHint: String? = nil) {
        let candidates = groups.flatMap { group in
            group.sides.map { (group, $0) }
        }.filter { group, _ in
            guard let cnnHint, !cnnHint.isEmpty else { return true }
            return group.cnn == cnnHint
        }

        let pool = candidates.isEmpty && cnnHint != nil
            ? groups.flatMap { group in group.sides.map { (group, $0) } }
            : candidates

        guard let nearest = pool.min(by: {
            CurbGeometry.squaredDistanceMeters(from: coordinate, toLine: $0.1.coordinates)
                < CurbGeometry.squaredDistanceMeters(from: coordinate, toLine: $1.1.coordinates)
        }) else {
            showToast("No curb loaded yet. Zoom in or pan slightly.")
            return
        }

        let distance = CurbGeometry.squaredDistanceMeters(from: coordinate, toLine: nearest.1.coordinates)
        guard distance < 70 * 70 else {
            showToast("Tap closer to a highlighted curb.")
            return
        }

        selected = CurbSelection(group: nearest.0, side: nearest.1)
        hydrateSelectionDetails()
    }

    private func hydrateSelectionDetails() {
        guard let selected else { return }
        let selectionID = selected.id
        Task { @MainActor in
            async let meter = try? client.meterCount(near: selected.side.coordinates)
            async let rpp = try? client.rppHint(near: selected.side.coordinates, midpoint: selected.side.midpoint)
            let details = await (meter, rpp)
            guard self.selected?.id == selectionID else { return }
            var updated = self.selected
            updated?.meterCount = details.0 ?? 0
            updated?.rpp = details.1 ?? nil
            self.selected = updated
        }
    }

    private func moveTo(_ coordinate: CLLocationCoordinate2D, span: CameraSpan) {
        cameraRequest = CameraRequest(
            region: MKCoordinateRegion(center: coordinate, span: span.mapSpan)
        )
    }

    private func showToast(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            if self.toast == message {
                self.toast = nil
            }
        }
    }

    static func buildGroups(from rows: [SweepRow], dayFilter: Int?) -> [CurbGroup] {
        let grouped = Dictionary(grouping: rows) { row in row.cnn ?? UUID().uuidString }
        return grouped.compactMap { cnn, rows -> CurbGroup? in
            guard let geometry = rows.first(where: { $0.line?.locations.isEmpty == false })?.line?.locations,
                  !geometry.isEmpty else {
                return nil
            }

            let sideRows = Dictionary(grouping: rows) { row in
                row.blockside ?? row.cnnrightleft ?? "C"
            }
            let sideKeys = sideRows.keys.sorted()
            var signs: [String: Int] = [:]
            if sideKeys.count == 1 {
                signs[sideKeys[0]] = 0
            } else {
                for (index, key) in sideKeys.enumerated() {
                    let lr = sideRows[key]?.first?.cnnrightleft
                    signs[key] = lr == "R" ? 1 : (lr == "L" ? -1 : (index == 0 ? -1 : 1))
                }
                if sideKeys.count == 2,
                   let first = signs[sideKeys[0]],
                   let second = signs[sideKeys[1]],
                   first == second {
                    signs[sideKeys[1]] = -(first == 0 ? 1 : first)
                }
            }

            var sides: [CurbSide] = []
            for key in sideKeys {
                guard let rowsForSide = sideRows[key] else { continue }
                if let dayFilter, !rowsForSide.contains(where: { SweepSchedule.normalizedDay($0.weekday) == dayFilter }) {
                    continue
                }

                let best = rowsForSide.reduce((row: rowsForSide.first, window: Optional<SweepWindow>.none, status: CurbStatus.postedSign)) { partial, row in
                    let window = SweepSchedule.nextSweep(for: row)
                    let status = SweepSchedule.status(for: window)
                    return status.rank > partial.status.rank ? (row, window, status) : partial
                }
                let sign = signs[key] ?? 0
                let offset = CurbGeometry.offsetLine(geometry, meters: 5, sign: sign)
                let midpoint = offset[offset.count / 2]
                sides.append(
                    CurbSide(
                        id: key,
                        key: key,
                        blockside: rowsForSide.first?.blockside ?? "Curbside",
                        rows: rowsForSide,
                        displayRow: best.row,
                        nextSweep: best.window,
                        status: best.status,
                        coordinates: offset,
                        midpoint: midpoint
                    )
                )
            }

            guard !sides.isEmpty else { return nil }
            return CurbGroup(
                cnn: cnn,
                corridor: rows.first?.corridor ?? "This block",
                limits: rows.first?.limits ?? "",
                sides: sides
            )
        }
        .sorted { $0.corridor < $1.corridor }
    }
}

struct CameraRequest: Identifiable, Equatable {
    let id = UUID()
    let region: MKCoordinateRegion

    static func == (lhs: CameraRequest, rhs: CameraRequest) -> Bool {
        lhs.id == rhs.id
    }
}

enum CameraSpan {
    case street

    var mapSpan: MKCoordinateSpan {
        switch self {
        case .street:
            MKCoordinateSpan(latitudeDelta: 0.006, longitudeDelta: 0.006)
        }
    }
}
