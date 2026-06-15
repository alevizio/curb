import MapKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: CurbViewModel
    @FocusState private var searchFocused: Bool
    @State private var didLoadInitialViewport = false

    var body: some View {
        ZStack(alignment: .top) {
            CurbMapView(
                overlays: model.overlays,
                parkedCoordinate: model.parkedCoordinate,
                cameraRequest: model.cameraRequest,
                initialRegion: model.initialRegion(),
                onRegionChanged: model.regionDidChange,
                onTap: model.tapMap
            )
            .ignoresSafeArea()

            topChrome

            if model.isLoading {
                ProgressView()
                    .tint(CurbTheme.ink)
                    .padding(12)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
                    .padding(.top, 118)
            }

            VStack {
                Spacer()
                if let selection = model.selected {
                    CurbDetailSheet(selection: selection)
                        .environmentObject(model)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .ignoresSafeArea(edges: .bottom)

            if let toast = model.toast {
                VStack {
                    Spacer()
                    Text(toast)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(CurbTheme.paper)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(CurbTheme.ink)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .padding(.horizontal, 18)
                        .padding(.bottom, model.selected == nil ? 34 : 250)
                }
                .transition(.opacity)
            }
        }
        .background(CurbTheme.paper)
        .animation(.snappy(duration: 0.22), value: model.selected?.id)
        .animation(.snappy(duration: 0.18), value: model.toast)
        .task {
            guard !didLoadInitialViewport else { return }
            didLoadInitialViewport = true
            await model.loadViewport(model.initialRegion())
        }
    }

    private var topChrome: some View {
        VStack(spacing: 9) {
            HStack(spacing: 9) {
                Button {
                    model.notify("CURB shows rules, not live spaces. The posted sign always wins.")
                } label: {
                    Text("CURB")
                        .font(.system(size: 25, weight: .black, design: .default))
                        .foregroundStyle(CurbTheme.paper)
                        .frame(width: 72, height: 47)
                        .background(CurbTheme.red)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(CurbTheme.ink, lineWidth: 2)
                        )
                }
                .buttonStyle(.plain)

                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 16, weight: .black))
                    TextField("Street or address", text: $model.searchText)
                        .focused($searchFocused)
                        .textInputAutocapitalization(.words)
                        .disableAutocorrection(true)
                        .submitLabel(.search)
                        .onSubmit {
                            searchFocused = false
                            Task { await model.performSearch() }
                        }
                        .onChange(of: model.searchText) { _, _ in
                            model.updateSuggestions()
                        }
                }
                .foregroundStyle(CurbTheme.ink)
                .padding(.horizontal, 12)
                .frame(height: 47)
                .background(CurbTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(CurbTheme.ink, lineWidth: 2)
                )

                Button {
                    searchFocused = false
                    model.locate()
                } label: {
                    Image(systemName: "location.fill")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(CurbTheme.paper)
                        .frame(width: 47, height: 47)
                        .background(CurbTheme.ink)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)

            if !model.suggestions.isEmpty, searchFocused {
                VStack(spacing: 0) {
                    ForEach(model.suggestions.prefix(6)) { suggestion in
                        Button {
                            searchFocused = false
                            model.pickSuggestion(suggestion)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: suggestionIcon(suggestion))
                                    .font(.system(size: 13, weight: .black))
                                    .frame(width: 22, height: 22)
                                    .background(CurbTheme.ink)
                                    .foregroundStyle(CurbTheme.paper)
                                    .clipShape(Circle())
                                Text(suggestion.title)
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                    .foregroundStyle(CurbTheme.ink)
                                    .lineLimit(1)
                                Spacer()
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)

                        if suggestion.id != model.suggestions.prefix(6).last?.id {
                            Divider().background(CurbTheme.ink.opacity(0.25))
                        }
                    }
                }
                .background(CurbTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(CurbTheme.ink, lineWidth: 2)
                )
                .padding(.horizontal, 91)
                .padding(.trailing, 58)
            }

            dayStrip
        }
        .padding(.top, 9)
    }

    private var dayStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                dayChip(title: "All", day: nil)
                dayChip(title: "Today \(SweepSchedule.dayLabels[SweepSchedule.sfTodayIndex()])", day: SweepSchedule.sfTodayIndex())
                ForEach(0..<7, id: \.self) { day in
                    dayChip(title: SweepSchedule.dayLabels[day], day: day)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 2)
        }
    }

    private func dayChip(title: String, day: Int?) -> some View {
        let isOn = model.dayFilter == day || (day == nil && model.dayFilter == nil)
        return Button {
            model.selectDay(day)
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .black, design: .rounded))
                .foregroundStyle(isOn ? CurbTheme.paper : CurbTheme.ink)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(isOn ? CurbTheme.ink : CurbTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(CurbTheme.ink, lineWidth: 1.5)
                )
        }
        .buttonStyle(.plain)
    }

    private func suggestionIcon(_ suggestion: SearchSuggestion) -> String {
        switch suggestion.kind {
        case .address: "house.fill"
        case .street: "road.lanes"
        }
    }
}

struct CurbDetailSheet: View {
    @EnvironmentObject private var model: CurbViewModel
    let selection: CurbSelection
    @State private var alertBusy = false
    @State private var calendarBusy = false

    private var window: SweepWindow? { selection.side.nextSweep }
    private var displayRule: SweepRow? { selection.side.displayRow }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(CurbTheme.ink.opacity(0.35))
                .frame(width: 46, height: 5)
                .padding(.top, 9)
                .padding(.bottom, 10)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 13) {
                    header
                    scheduleLine
                    detailChips
                    actionRow
                    otherSides
                    dataNote
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .frame(maxHeight: 390)
        }
        .background(CurbTheme.paper)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
        .overlay(alignment: .top) {
            UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous)
                .stroke(CurbTheme.ink, lineWidth: 2)
        }
        .shadow(color: .black.opacity(0.18), radius: 14, y: -4)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 7) {
                Text(kicker)
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .textCase(.uppercase)
                    .foregroundStyle(CurbTheme.ink.opacity(0.66))

                HStack(spacing: 9) {
                    Text(headline)
                        .font(.system(size: 34, weight: .black, design: .rounded))
                        .foregroundStyle(selection.side.status.color)
                        .lineLimit(1)
                        .minimumScaleFactor(0.74)

                    if (selection.meterCount ?? 0) > 0 {
                        Label("Metered", systemImage: "parkingsign.circle.fill")
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundStyle(CurbTheme.paper)
                            .padding(.horizontal, 8)
                            .frame(height: 25)
                            .background(CurbTheme.ink)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                }

                Text(whereLine)
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(CurbTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            VStack(spacing: 8) {
                Button {
                    model.selected = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(CurbTheme.ink)
                        .frame(width: 32, height: 32)
                        .background(CurbTheme.paper)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(CurbTheme.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)

                if let url = URL(string: "https://curb.guide/b/\(selection.group.cnn)") {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 14, weight: .black))
                            .foregroundStyle(CurbTheme.ink)
                            .frame(width: 32, height: 32)
                            .background(CurbTheme.paper)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(CurbTheme.ink, lineWidth: 1.5))
                    }
                }
            }
        }
    }

    private var scheduleLine: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let window {
                Text("\(SweepSchedule.formattedHour(window.fromHour))-\(SweepSchedule.formattedHour(window.toHour)) · \(SweepSchedule.frequencyLabel(for: displayRule)) · \(SweepSchedule.relativePhrase(for: window))")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .foregroundStyle(selection.side.status.color)
            }
            if let rule = displayRule {
                let day = SweepSchedule.dayLabels[SweepSchedule.normalizedDay(rule.weekday) ?? 0].uppercased()
                Text("\(selection.side.blockside) · sweeps \(day) \(SweepSchedule.formattedHour(rule.fromhour))-\(SweepSchedule.formattedHour(rule.tohour))")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(CurbTheme.ink.opacity(0.74))
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selection.side.status.color.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(selection.side.status.color, lineWidth: 1.5)
        )
    }

    @ViewBuilder
    private var detailChips: some View {
        HStack(spacing: 8) {
            if let rpp = selection.rpp {
                Label {
                    Text(rppText(rpp))
                } icon: {
                    Text(rpp.area)
                        .font(.system(size: 11, weight: .black, design: .rounded))
                        .foregroundStyle(CurbTheme.paper)
                        .frame(width: 23, height: 23)
                        .background(CurbTheme.meter)
                        .clipShape(Circle())
                }
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .foregroundStyle(CurbTheme.ink)
                .padding(.horizontal, 9)
                .padding(.vertical, 7)
                .background(CurbTheme.meter.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(CurbTheme.meter, lineWidth: 1.2)
                )
            }

            if selection.meterCount == 0 {
                Text("No meters found on this block")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(CurbTheme.ink.opacity(0.62))
            }
        }
    }

    private var actionRow: some View {
        HStack(spacing: 9) {
            Button {
                Task { await scheduleAlert() }
            } label: {
                Label(alertTitle, systemImage: alertIsOn ? "checkmark.circle.fill" : "bell.badge.fill")
                    .frame(maxWidth: .infinity)
            }
            .disabled(window == nil || alertBusy)
            .signageButtonStyle(background: alertIsOn ? CurbTheme.green : CurbTheme.ink)

            Button {
                Task { await addCalendarEvent() }
            } label: {
                Label(calendarBusy ? "Adding" : "Calendar", systemImage: "calendar.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .disabled(window == nil || calendarBusy)
            .signageButtonStyle(background: CurbTheme.paper, foreground: CurbTheme.ink)
        }
    }

    @ViewBuilder
    private var otherSides: some View {
        let others = selection.group.sides.filter { $0.id != selection.side.id }
        if !others.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Other side")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .textCase(.uppercase)
                    .foregroundStyle(CurbTheme.ink.opacity(0.62))
                ForEach(others) { side in
                    Button {
                        model.select(group: selection.group, side: side)
                    } label: {
                        HStack(spacing: 11) {
                            StreetCleaningBadge(side: side)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(side.blockside)
                                    .font(.system(size: 15, weight: .black, design: .rounded))
                                Text(otherSideSummary(side))
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(side.status.color)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .black))
                        }
                        .foregroundStyle(CurbTheme.ink)
                        .padding(10)
                        .background(CurbTheme.paper)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(CurbTheme.ink.opacity(0.32), lineWidth: 1.2)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var dataNote: some View {
        Text("Posted signs, temporary signs, and holidays override this data. CURB shows rules, not live parking availability. Permit data is a city 2017 hint and may be incomplete.")
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundStyle(CurbTheme.ink.opacity(0.64))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 2)
    }

    private var kicker: String {
        guard let window else { return "Schedule" }
        let now = Date()
        if now >= window.start, now < window.end {
            return "Restricted"
        }
        return "Park until"
    }

    private var headline: String {
        guard let window else { return "Posted sign" }
        let now = Date()
        if now >= window.start, now < window.end {
            return "Sweeping now"
        }
        return "\(SweepSchedule.dayLabels[window.weekday]) \(SweepSchedule.formattedHour(window.fromHour))"
    }

    private var whereLine: String {
        [selection.group.corridor, selection.group.limits].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var alertTitle: String {
        if alertBusy { return "Enabling" }
        return alertIsOn ? "Alerts on" : "Sweep alert"
    }

    private var alertIsOn: Bool {
        guard let key = NativeReminderScheduler.alertKey(for: selection) else { return false }
        return model.savedAlertKey == key
    }

    private func scheduleAlert() async {
        alertBusy = true
        defer { alertBusy = false }
        do {
            let key = try await NativeReminderScheduler.scheduleAlerts(for: selection)
            model.setAlertKey(key)
            model.notify("Sweep alert set: night-before when useful, plus about 30 min before.")
        } catch {
            model.notify(error.localizedDescription)
        }
    }

    private func addCalendarEvent() async {
        calendarBusy = true
        defer { calendarBusy = false }
        do {
            try await CalendarReminderWriter.addEvent(for: selection)
            model.notify("Calendar reminder added.")
        } catch {
            model.notify(error.localizedDescription)
        }
    }

    private func rppText(_ rpp: RPPHint) -> String {
        let detail = [rpp.hourLimit.map { "\($0)hr limit" }, rpp.days, rpp.fromTime].compactMap { $0 }.joined(separator: " · ")
        if detail.isEmpty {
            return "Permit Area \(rpp.area)"
        }
        return "Permit Area \(rpp.area) · \(detail)"
    }

    private func otherSideSummary(_ side: CurbSide) -> String {
        guard let window = side.nextSweep else { return "Check posted sign" }
        return "\(SweepSchedule.shortDate(window.start)) · \(SweepSchedule.relativePhrase(for: window))"
    }
}

private struct StreetCleaningBadge: View {
    let side: CurbSide

    var body: some View {
        VStack(spacing: 1) {
            Text(day)
                .font(.system(size: 11, weight: .black, design: .rounded))
            Text(time)
                .font(.system(size: 10, weight: .black, design: .rounded))
            Text("CLEAN")
                .font(.system(size: 7, weight: .black, design: .rounded))
        }
        .foregroundStyle(CurbTheme.paper)
        .frame(width: 58, height: 44)
        .background(side.status.color)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(CurbTheme.ink, lineWidth: 1)
        )
    }

    private var day: String {
        guard let row = side.displayRow, let index = SweepSchedule.normalizedDay(row.weekday) else {
            return "SIGN"
        }
        return SweepSchedule.dayLabels[index].uppercased()
    }

    private var time: String {
        guard let row = side.displayRow else { return "" }
        return "\(SweepSchedule.formattedHour(row.fromhour))-\(SweepSchedule.formattedHour(row.tohour))"
    }
}
