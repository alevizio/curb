import EventKit
import Foundation
import UserNotifications

enum ReminderServiceError: LocalizedError {
    case noSweep
    case notificationsDenied
    case calendarDenied
    case noCalendar

    var errorDescription: String? {
        switch self {
        case .noSweep:
            "No upcoming sweep on this side."
        case .notificationsDenied:
            "Notifications are blocked for CURB."
        case .calendarDenied:
            "Calendar access was not granted."
        case .noCalendar:
            "No writable calendar is available."
        }
    }
}

enum NativeReminderScheduler {
    static func alertKey(for selection: CurbSelection) -> String? {
        guard let window = selection.side.nextSweep else { return nil }
        return [
            selection.group.corridor,
            selection.group.limits,
            selection.side.blockside,
            String(Int(window.start.timeIntervalSince1970))
        ].joined(separator: "|")
    }

    static func scheduleAlerts(for selection: CurbSelection) async throws -> String {
        guard let window = selection.side.nextSweep else {
            throw ReminderServiceError.noSweep
        }

        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard granted else {
            throw ReminderServiceError.notificationsDenied
        }

        let key = alertKey(for: selection) ?? UUID().uuidString
        center.removePendingNotificationRequests(withIdentifiers: [
            "\(key).night",
            "\(key).soon"
        ])

        let title = "Move your car"
        let block = [selection.group.corridor, selection.group.limits].filter { !$0.isEmpty }.joined(separator: " · ")
        let startText = SweepSchedule.calendarDateTime(window.start)

        let evening = SweepSchedule.eveningBefore(window)
        if evening > Date().addingTimeInterval(10 * 60), evening < window.start {
            try await addNotification(
                id: "\(key).night",
                date: evening,
                title: title,
                body: "\(block) sweeps tomorrow at \(SweepSchedule.formattedHour(window.fromHour))."
            )
        }

        let soon = window.start.addingTimeInterval(-30 * 60)
        if soon > Date().addingTimeInterval(60) {
            try await addNotification(
                id: "\(key).soon",
                date: soon,
                title: title,
                body: "\(block) sweeps at \(startText). Posted signs are the source of truth."
            )
        }

        return key
    }

    private static func addNotification(id: String, date: Date, title: String, body: String) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
        try await UNUserNotificationCenter.current().add(request)
    }
}

enum CalendarReminderWriter {
    static func addEvent(for selection: CurbSelection) async throws {
        guard let window = selection.side.nextSweep else {
            throw ReminderServiceError.noSweep
        }

        let store = EKEventStore()
        let granted = try await requestAccess(store)
        guard granted else {
            throw ReminderServiceError.calendarDenied
        }
        guard let calendar = store.defaultCalendarForNewEvents else {
            throw ReminderServiceError.noCalendar
        }

        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = "Move car - street sweeping"
        event.location = [selection.group.corridor, selection.group.limits].filter { !$0.isEmpty }.joined(separator: " · ")
        event.notes = "CURB reminder. The posted sign is always the source of truth."
        event.startDate = window.start
        event.endDate = window.end
        event.addAlarm(EKAlarm(relativeOffset: -30 * 60))
        try store.save(event, span: .thisEvent)
    }

    private static func requestAccess(_ store: EKEventStore) async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            if #available(iOS 17.0, *) {
                store.requestWriteOnlyAccessToEvents { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: granted)
                    }
                }
            } else {
                store.requestAccess(to: .event) { granted, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: granted)
                    }
                }
            }
        }
    }
}
