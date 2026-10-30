import AppIntents
import CoreLocation
import UIKit
import UserNotifications

// Auto-save where you park (1.0.6): two App Intents that a Shortcuts automation runs with no tap. Save Parking Spot runs
// when the car's CarPlay or Bluetooth disconnects, Clear Parking Spot when it connects again. Save sends the spot once to
// /api/parked-ios, which turns the nearest swept block into the car's own sweep-alert watch on this iPhone's push token
// (the server keeps the block, never the coordinates), and shows what it found as a notification. Clear turns that watch
// off. The Sweep alerts panel sets it up and shows the saved spot through AutoParkBridge (ContentView.swift).

/// What this iPhone keeps for auto-park: its APNs token (the intents run with no page to ask) and the last saved spot.
enum CurbDevice {
    private static let tokenKey = "curbApnsToken"
    private static let carKey = "curbCarSpot"
    private static let styleKey = "curbAlertStyle"

    static var apnsToken: String? { UserDefaults.standard.string(forKey: tokenKey) }
    static func saveToken(_ hex: String) { UserDefaults.standard.set(hex, forKey: tokenKey) }

    /// The page's Intensity and Voice (the Sweep alerts panel hands them over), sent with each park so the car's alerts
    /// follow them like every curb's. The server keeps only values it knows.
    static var style: [String: String] { UserDefaults.standard.dictionary(forKey: styleKey) as? [String: String] ?? [:] }
    static func saveStyle(level: String, voice: String) {
        let word = { (s: String) in !s.isEmpty && s.count <= 16 && s.allSatisfy(\.isLetter) }
        guard word(level), word(voice) else { return }
        UserDefaults.standard.set(["level": level, "voice": voice], forKey: styleKey)
    }

    static var car: CarSpot? {
        guard let data = UserDefaults.standard.data(forKey: carKey) else { return nil }
        return try? JSONDecoder().decode(CarSpot.self, from: data)
    }
    static func saveCar(_ car: CarSpot?) {
        if let car, let data = try? JSONEncoder().encode(car) { UserDefaults.standard.set(data, forKey: carKey) }
        else { UserDefaults.standard.removeObject(forKey: carKey) }
    }
}

/// The block the car was last saved on, as the server named it. `covered`: alerts were already on for that side from its
/// sheet, so the car's watch stayed off and that watch alerts instead.
struct CarSpot: Codable, Sendable {
    var corridor: String
    var limits: String
    var blockside: String
    var cnn: String
    var sideKey: String
    var nextSweepISO: String
    var url: String
    var covered: Bool
    var savedAt: Date

    /// For the page (AutoParkBridge): plain JSON values, savedAt in epoch milliseconds.
    var page: [String: Any] {
        ["corridor": corridor, "limits": limits, "blockside": blockside, "cnn": cnn, "sideKey": sideKey,
         "nextSweepISO": nextSweepISO, "url": url, "covered": covered, "savedAt": Int(savedAt.timeIntervalSince1970 * 1000)]
    }
}

/// Why an intent stopped. Shortcuts shows the text when an automation fails.
enum ParkingError: Error, CustomLocalizedStringResourceConvertible {
    case noToken, noLocationAccess, noFix, outsideSF, noBlock, full, busy, failed(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .noToken: "Turn on notifications for CURB in its Sweep alerts screen first, so it can alert you about this spot."
        case .noLocationAccess: "CURB needs location access. In Settings, set CURB's Location to While Using the App, then try again."
        case .noFix: "CURB couldn't get an accurate location here. Try again in a minute."
        case .outsideSF: "CURB saves parking spots in San Francisco for now."
        case .noBlock: "CURB found no street cleaning on this block."
        case .full: "You have 5 of 5 alerts on. Turn one off in CURB's Sweep alerts screen to save this spot."
        case .busy: "CURB saved a spot less than a minute ago. Try again in a minute."
        case .failed(let why): "CURB couldn't save the spot (\(why)). Try again."
        }
    }
}

struct ParkResult: Sendable {
    let title: String
    let body: String
    let car: CarSpot
}

/// The calls to /api/parked-ios.
enum ParkingService {
    private static let endpoint = URL(string: "https://curb.guide/api/parked-ios")!

    static func park(at coordinate: CLLocationCoordinate2D) async throws -> ParkResult {
        guard let token = CurbDevice.apnsToken else { throw ParkingError.noToken }
        var body: [String: Any] = ["token": token, "lat": coordinate.latitude, "lng": coordinate.longitude]
        for (key, value) in CurbDevice.style { body[key] = value }
        let (status, json) = try await post(body)
        let error = json["error"] as? String
        switch status {
        case 200:
            guard json["ok"] as? Bool == true, let spot = json["spot"] as? [String: Any] else { throw ParkingError.noBlock }
            let text = { (key: String) in spot[key] as? String ?? "" }
            let car = CarSpot(corridor: text("corridor"), limits: text("limits"), blockside: text("blockside"), cnn: text("cnn"),
                              sideKey: text("sideKey"), nextSweepISO: text("nextSweepISO"), url: json["url"] as? String ?? "/",
                              covered: json["covered"] as? Bool ?? false, savedAt: Date())
            return ParkResult(title: json["title"] as? String ?? "🚗 Parked", body: json["body"] as? String ?? car.corridor, car: car)
        case 400 where error == "outside SF": throw ParkingError.outsideSF
        case 409: throw ParkingError.full
        case 429: throw ParkingError.busy
        default: throw ParkingError.failed(error ?? "HTTP \(status)")
        }
    }

    /// The car drove off. The saved spot is forgotten here even if the server can't be reached: the car has left it
    /// either way, and a failed clear only leaves the old block's alerts on until the next park moves them.
    static func clear() async {
        CurbDevice.saveCar(nil)
        guard let token = CurbDevice.apnsToken else { return }
        _ = try? await post(["token": token, "clear": true])
    }

    private static func post(_ body: [String: Any]) async throws -> (Int, [String: Any]) {
        var req = URLRequest(url: endpoint, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            return ((resp as? HTTPURLResponse)?.statusCode ?? 0, json)
        } catch {
            throw ParkingError.failed(error.localizedDescription)
        }
    }
}

/// One location fix for Save Parking Spot when the automation passes none: the first one within 25 m, else the best one
/// within 75 m after 10 seconds. Needs location access already granted (an intent can't ask).
@MainActor
final class OneShotLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var best: CLLocation?
    private var deadline: Task<Void, Never>?

    func current() async throws -> CLLocation {
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { throw ParkingError.noLocationAccess }
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            manager.startUpdatingLocation()
            deadline = Task { [weak self] in
                try? await Task.sleep(for: .seconds(10))
                self?.finish()
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for fix in locations where fix.horizontalAccuracy >= 0 && -fix.timestamp.timeIntervalSinceNow < 60 {
            if best.map({ fix.horizontalAccuracy < $0.horizontalAccuracy }) ?? true { best = fix }
        }
        if let best, best.horizontalAccuracy <= 25 { finish() }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { return }   // transient: keep trying until the deadline
        finish()
    }

    private func finish() {
        deadline?.cancel()
        manager.stopUpdatingLocation()
        guard let continuation else { return }
        self.continuation = nil
        if let best, best.horizontalAccuracy <= 75 { continuation.resume(returning: best) }
        else { continuation.resume(throwing: ParkingError.noFix) }
    }
}

/// The confirmation, as a notification: a tap opens the block (AppDelegate routes `url`). It replaces the previous one.
enum ParkingNotice {
    static func post(_ result: ParkResult) async {
        let content = UNMutableNotificationContent()
        content.title = result.title
        content.body = result.body
        content.sound = .default
        content.threadIdentifier = "curb-parked"
        content.userInfo = ["url": result.car.url, "tag": "curb-parked"]
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "curb-parked", content: content, trigger: nil))
    }
}

struct SaveParkingSpotIntent: AppIntent {
    static let title: LocalizedStringResource = "Save Parking Spot"
    static let description = IntentDescription("Saves the San Francisco block where you parked and turns on its street cleaning alerts. Run it from an automation when your car's CarPlay or Bluetooth disconnects.")
    static let openAppWhenRun = false

    @Parameter(title: "Location", description: "Leave it empty and CURB uses where your iPhone is.")
    var location: CLPlacemark?

    // Reads complete as it is: Location waits under the action's expand arrow, so nobody thinks it must be filled in.
    static var parameterSummary: some ParameterSummary {
        Summary("Save parking spot") { \.$location }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let fix: CLLocation
        if let given = location?.location { fix = given } else { fix = try await OneShotLocation().current() }
        let result = try await ParkingService.park(at: fix.coordinate)
        CurbDevice.saveCar(result.car)
        await ParkingNotice.post(result)
        return .result(dialog: "\(result.body)")
    }
}

struct ClearParkingSpotIntent: AppIntent {
    static let title: LocalizedStringResource = "Clear Parking Spot"
    static let description = IntentDescription("Turns off the alerts for the spot CURB saved when you parked. Run it from an automation when your car's CarPlay or Bluetooth connects.")
    static let openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        await ParkingService.clear()
        return .result(dialog: "Parking spot cleared.")
    }
}

/// Puts both actions in Shortcuts (and Siri) as soon as the app is installed, with no setup in the app.
struct CurbShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SaveParkingSpotIntent(),
                    phrases: ["Save my parking spot in \(.applicationName)", "I parked with \(.applicationName)"],
                    shortTitle: "Save Parking Spot", systemImageName: "car.fill")
        AppShortcut(intent: ClearParkingSpotIntent(),
                    phrases: ["Clear my parking spot in \(.applicationName)"],
                    shortTitle: "Clear Parking Spot", systemImageName: "car")
    }
}

extension UNAuthorizationStatus {
    /// Notifications can reach the user, so a push token is worth having (the AppDelegate and AutoPark.prepare).
    var allowsNotifications: Bool { self == .authorized || self == .provisional || self == .ephemeral }
}

/// The Sweep alerts panel's side of auto-park (AutoParkBridge): what's allowed, and asking for what isn't decided yet.
@MainActor
enum AutoPark {
    static func status() async -> [String: Any] {
        let notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        var out: [String: Any] = [
            "notifications": name(notifications),
            "location": name(CLLocationManager().authorizationStatus),
            "token": CurbDevice.apnsToken != nil,
        ]
        if let car = CurbDevice.car { out["car"] = car.page }
        return out
    }

    /// Asks for notifications and location if the user hasn't decided yet, and registers for a push token (the
    /// AppDelegate keeps it), so the first automation run can save the spot. → status()
    static func prepare() async -> [String: Any] {
        let center = UNUserNotificationCenter.current()
        if await center.notificationSettings().authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        if await center.notificationSettings().authorizationStatus.allowsNotifications {
            UIApplication.shared.registerForRemoteNotifications()
            for _ in 0..<20 where CurbDevice.apnsToken == nil { try? await Task.sleep(for: .milliseconds(250)) }
        }
        if CLLocationManager().authorizationStatus == .notDetermined { await LocationAsk().whenInUse() }
        return await status()
    }

    private static func name(_ s: UNAuthorizationStatus) -> String {
        switch s {
        case .authorized: "authorized"
        case .denied: "denied"
        case .provisional: "provisional"
        case .ephemeral: "ephemeral"
        default: "notDetermined"
        }
    }

    private static func name(_ s: CLAuthorizationStatus) -> String {
        switch s {
        case .authorizedWhenInUse: "whenInUse"
        case .authorizedAlways: "always"
        case .denied: "denied"
        case .restricted: "restricted"
        default: "notDetermined"
        }
    }
}

/// The While Using location prompt, answered (or given up on after 60 seconds).
@MainActor
private final class LocationAsk: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<Void, Never>?

    func whenInUse() async {
        manager.delegate = self
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.requestWhenInUseAuthorization()
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(60))
                self?.done()
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { done() }
    }

    private func done() {
        continuation?.resume()
        continuation = nil
    }
}
