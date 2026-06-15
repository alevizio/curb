import CoreLocation
import Foundation
import MapKit

struct DataSFClient {
    private let session: URLSession

    private static let sweep = URL(string: "https://data.sfgov.org/resource/yhqp-riqs.json")!
    private static let meter = URL(string: "https://data.sfgov.org/resource/8vzz-qzz9.json")!
    private static let rpp = URL(string: "https://data.sfgov.org/resource/hi6h-neyh.json")!
    private static let address = URL(string: "https://data.sfgov.org/resource/3mea-di5p.json")!

    init(session: URLSession = .shared) {
        self.session = session
    }

    func sweepCount(in region: MKCoordinateRegion) async throws -> Int {
        let polygon = CurbGeometry.polygonWKT(for: region)
        let rows: [CountRow] = try await get(
            Self.sweep,
            query: [
                "$select": "count(*)",
                "$where": "intersects(line,'\(polygon)')"
            ]
        )
        return Int(rows.first?.count ?? "0") ?? 0
    }

    func sweepRows(in region: MKCoordinateRegion, limit: Int = 2_500) async throws -> [SweepRow] {
        let polygon = CurbGeometry.polygonWKT(for: region)
        return try await get(
            Self.sweep,
            query: [
                "$select": "cnn,corridor,limits,blockside,cnnrightleft,weekday,fromhour,tohour,week1,week2,week3,week4,week5,holidays,line",
                "$where": "intersects(line,'\(polygon)')",
                "$limit": String(limit)
            ]
        )
    }

    func address(_ normalized: NormalizedAddress) async throws -> AddressRow? {
        let rows: [AddressRow] = try await get(
            Self.address,
            query: [
                "$select": "address,address_number,street_name,street_type,latitude,longitude,cnn",
                "$where": "address_number=\(normalized.number) AND upper(street_name)='\(soql(normalized.street))'",
                "$limit": "1"
            ]
        )
        return rows.first
    }

    func addressSuggestions(_ normalized: NormalizedAddress, limit: Int = 4) async throws -> [AddressRow] {
        try await get(
            Self.address,
            query: [
                "$select": "address,latitude,longitude,cnn",
                "$where": "address like '\(soql(normalized.number + " " + normalized.street))%'",
                "$limit": String(limit),
                "$order": "address"
            ]
        )
    }

    func streetMatches(_ query: String, limit: Int = 8) async throws -> [StreetSearchRow] {
        try await get(
            Self.sweep,
            query: [
                "$select": "corridor,line",
                "$where": "upper(corridor) like '%\(soql(query.uppercased()))%' AND line IS NOT NULL",
                "$group": "corridor,line",
                "$limit": String(limit)
            ]
        )
    }

    func meterCount(near coordinates: [CLLocationCoordinate2D]) async throws -> Int {
        guard let bounds = CurbGeometry.boundingBox(for: coordinates, padding: 0.00022) else {
            return 0
        }
        let rows: [CountRow] = try await get(
            Self.meter,
            query: [
                "$select": "count(objectid) as c",
                "$where": "on_offstreet_type='ON' AND latitude between \(bounds.south) and \(bounds.north) AND longitude between \(bounds.west) and \(bounds.east)"
            ]
        )
        return Int(rows.first?.c ?? "0") ?? 0
    }

    func rppHint(near coordinates: [CLLocationCoordinate2D], midpoint: CLLocationCoordinate2D) async throws -> RPPHint? {
        guard let bounds = CurbGeometry.boundingBox(for: coordinates, padding: 0.0003) else {
            return nil
        }
        let rows: [RPPRow] = try await get(
            Self.rpp,
            query: [
                "$select": "rpparea1,hrlimit,days,from_time,to_time,regulation,exceptions,shape",
                "$where": "rpparea1 IS NOT NULL AND intersects(shape,'\(bounds.polygonWKT)')",
                "$limit": "40"
            ]
        )

        var best: RPPHint?
        var bestDistance = Double.infinity
        for row in rows {
            guard let area = row.rpparea1, let shape = row.shape else { continue }
            for line in shape.lines {
                let distance = CurbGeometry.squaredDistanceMeters(from: midpoint, toLine: line)
                if distance < bestDistance {
                    bestDistance = distance
                    best = RPPHint(
                        area: area,
                        hourLimit: row.hrlimit,
                        days: row.days,
                        fromTime: row.fromTime,
                        toTime: row.toTime
                    )
                }
            }
        }
        return bestDistance < 35 * 35 ? best : nil
    }

    private func get<T: Decodable>(_ baseURL: URL, query: [String: String]) async throws -> T {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func soql(_ value: String) -> String {
        value.replacingOccurrences(of: "'", with: "''")
    }
}

enum SearchNormalizer {
    static func address(_ value: String) -> NormalizedAddress? {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let comma = text.firstIndex(of: ",") {
            text = String(text[..<comma])
        }
        if let hash = text.firstIndex(of: "#") {
            text = String(text[..<hash])
        }
        text = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)

        guard let match = text.firstMatch(of: /^(\d{1,6})\s+(.+)$/) else {
            return nil
        }

        let number = String(match.1)
        var street = String(match.2).uppercased().replacingOccurrences(of: ".", with: "")
        street = street.trimmingCharacters(in: .whitespacesAndNewlines)
        var parts = street.split(separator: " ").map(String.init)
        let suffixes: Set<String> = [
            "STREET", "ST", "AVENUE", "AVE", "BOULEVARD", "BLVD", "ROAD", "RD",
            "DRIVE", "DR", "WAY", "LANE", "LN", "COURT", "CT", "PLACE", "PL",
            "TERRACE", "TER"
        ]
        if let last = parts.last, suffixes.contains(last) {
            parts.removeLast()
        }
        street = parts.joined(separator: " ")
        guard !street.isEmpty else { return nil }
        return NormalizedAddress(number: number, street: street)
    }
}
