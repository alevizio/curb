import Foundation

protocol SweepRuleRepresentable {
    var weekday: String? { get }
    var fromhour: String? { get }
    var tohour: String? { get }
    var week1: String? { get }
    var week2: String? { get }
    var week3: String? { get }
    var week4: String? { get }
    var week5: String? { get }
    var holidays: String? { get }
}

struct SweepWindow: Equatable {
    let start: Date
    let end: Date
    let fromHour: Int
    let toHour: Int
    let weekday: Int
    let year: Int
    let month: Int
    let day: Int
}

enum SweepSchedule {
    static let dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    static let fullDayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let sfTimeZone = TimeZone(identifier: "America/Los_Angeles")!

    private static let dayIndex = [
        "sun": 0,
        "mon": 1,
        "tue": 2,
        "wed": 3,
        "thu": 4,
        "fri": 5,
        "sat": 6
    ]

    private static let holidayDay: Set<String> = [
        "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-07-03", "2026-07-04",
        "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-11-27", "2026-12-25",
        "2027-01-01"
    ]

    private static let holidayNight: Set<String> = [
        "2026-01-01", "2026-11-26", "2026-12-25", "2027-01-01"
    ]

    static var sfCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = sfTimeZone
        return calendar
    }

    static func normalizedDay(_ value: String?) -> Int? {
        guard let key = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().prefix(3) else {
            return nil
        }
        return dayIndex[String(key)]
    }

    static func formattedHour(_ raw: String?) -> String {
        guard let raw, let hour = Int(raw) else { return "" }
        return formattedHour(hour)
    }

    static func formattedHour(_ hour: Int) -> String {
        let suffix = hour >= 12 ? "PM" : "AM"
        let normalized = hour % 12 == 0 ? 12 : hour % 12
        return "\(normalized)\(suffix)"
    }

    static func sfTodayIndex(now: Date = Date()) -> Int {
        let weekday = sfCalendar.component(.weekday, from: now)
        return weekday - 1
    }

    static func sfTodayParts(now: Date = Date()) -> DateComponents {
        sfCalendar.dateComponents([.year, .month, .day, .weekday], from: now)
    }

    static func wallTime(year: Int, month: Int, day: Int, hour: Int, minute: Int = 0) -> Date {
        let components = DateComponents(
            calendar: sfCalendar,
            timeZone: sfTimeZone,
            year: year,
            month: month,
            day: day,
            hour: hour,
            minute: minute
        )
        return sfCalendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }

    static func nextSweep<R: SweepRuleRepresentable>(for rule: R, now: Date = Date()) -> SweepWindow? {
        guard let targetDow = normalizedDay(rule.weekday),
              let fromHour = Int(rule.fromhour ?? "") else {
            return nil
        }

        let weekFlags = [rule.week1, rule.week2, rule.week3, rule.week4, rule.week5].map { String($0 ?? "0") == "1" }
        var toHour = Int(rule.tohour ?? "") ?? fromHour + 1
        if toHour == fromHour { toHour += 1 }

        let calendar = sfCalendar
        let startOfToday = calendar.startOfDay(for: now)
        for offset in 0..<150 {
            guard let dayDate = calendar.date(byAdding: .day, value: offset, to: startOfToday) else { continue }
            let parts = calendar.dateComponents([.year, .month, .day, .weekday], from: dayDate)
            let dow = (parts.weekday ?? 1) - 1
            guard dow == targetDow,
                  let year = parts.year,
                  let month = parts.month,
                  let day = parts.day else {
                continue
            }

            let occurrence = Int(ceil(Double(day) / 7.0))
            guard occurrence >= 1, occurrence <= 5, weekFlags[occurrence - 1] else {
                continue
            }

            let iso = "\(year)-\(String(format: "%02d", month))-\(String(format: "%02d", day))"
            guard !isSuspended(rule: rule, isoDate: iso) else {
                continue
            }

            let start = wallTime(year: year, month: month, day: day, hour: fromHour)
            var end = wallTime(year: year, month: month, day: day, hour: toHour)
            if end <= start {
                end = start.addingTimeInterval(3600)
            }
            if offset == 0, now >= end {
                continue
            }

            return SweepWindow(
                start: start,
                end: end,
                fromHour: fromHour,
                toHour: toHour,
                weekday: dow,
                year: year,
                month: month,
                day: day
            )
        }
        return nil
    }

    static func status(for window: SweepWindow?, now: Date = Date()) -> CurbStatus {
        guard let window else { return .postedSign }
        if now >= window.start, now < window.end {
            return .sweepingNow
        }
        let hours = window.start.timeIntervalSince(now) / 3600
        if hours < 3 {
            return .sweepingNow
        }
        if hours < 24 {
            return .soon
        }
        return .clear
    }

    static func relativePhrase(for window: SweepWindow?, now: Date = Date()) -> String {
        guard let window else { return "Check the posted sign" }
        if now >= window.start, now < window.end {
            return "until \(formattedHour(window.toHour))"
        }
        let hours = max(0, window.start.timeIntervalSince(now) / 3600)
        if hours < 1 {
            return "in <1 hr"
        }
        if hours < 24 {
            return "in \(Int(round(hours))) hr"
        }
        let days = Int(floor(hours / 24))
        if days == 1 {
            return "tomorrow"
        }
        return "in \(days) days"
    }

    static func frequencyLabel<R: SweepRuleRepresentable>(for rule: R?) -> String {
        guard let rule else { return "" }
        let flags = [rule.week1, rule.week2, rule.week3, rule.week4, rule.week5].map { String($0 ?? "0") == "1" }
        if flags.allSatisfy({ $0 }) {
            return "every week"
        }
        let labels = ["1st", "2nd", "3rd", "4th", "5th"]
        let active = zip(flags, labels).compactMap { isOn, label in isOn ? label : nil }
        return active.joined(separator: " & ")
    }

    static func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = sfTimeZone
        formatter.dateFormat = "EEE M/d"
        return formatter.string(from: date)
    }

    static func calendarDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = sfTimeZone
        formatter.dateFormat = "EEE, MMM d 'at' h:mm a"
        return formatter.string(from: date)
    }

    static func eveningBefore(_ window: SweepWindow) -> Date {
        guard let sweepDay = sfCalendar.date(from: DateComponents(
            calendar: sfCalendar,
            timeZone: sfTimeZone,
            year: window.year,
            month: window.month,
            day: window.day
        )),
        let previous = sfCalendar.date(byAdding: .day, value: -1, to: sweepDay) else {
            return window.start.addingTimeInterval(-12 * 3600)
        }
        let parts = sfCalendar.dateComponents([.year, .month, .day], from: previous)
        return wallTime(year: parts.year ?? window.year, month: parts.month ?? window.month, day: parts.day ?? window.day, hour: 20)
    }

    private static func isSuspended<R: SweepRuleRepresentable>(rule: R, isoDate: String) -> Bool {
        let table = String(rule.holidays ?? "0") == "1" ? holidayNight : holidayDay
        return table.contains(isoDate)
    }
}
