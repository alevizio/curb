import UIKit
import UserNotifications

/// Handles the APNs callbacks SwiftUI has no hook for: device-token registration and notification
/// taps. Both are relayed to PushRouter, which the WKWebView bridge consumes.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Set early so a cold-start launch-from-notification still reaches didReceive below.
        UNUserNotificationCenter.current().delegate = self
        // Opens, for the rating ask's "never on the very first open": this launch and every return from the
        // background. Observers on the main queue, so assumeIsolated keeps foreground/background in order.
        ReviewPrompt.shared.enteredForeground()
        let center = NotificationCenter.default
        _ = center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ReviewPrompt.shared.enteredForeground() }
        }
        _ = center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { ReviewPrompt.shared.enteredBackground() }
        }
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushRouter.shared.deliverDeviceToken(hex)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRouter.shared.deliverRegistrationFailure(error.localizedDescription)
    }

    // Show the banner even when CURB is foregrounded (otherwise the alert is silently dropped).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // Tap → open the block's deep link (e.g. /b/<cnn>) in the web view. A real sweep alert also arms the
    // App Store rating ask for when that page has loaded (ReviewPrompt).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        let path = content.userInfo["url"] as? String
        let tag = content.userInfo["tag"] as? String
        let title = content.title
        if let path, let url = URL(string: path, relativeTo: URL(string: "https://curb.guide")) {
            let abs = url.absoluteURL
            Task { @MainActor in
                ReviewPrompt.shared.notificationTapped(tag: tag, title: title)
                PushRouter.shared.routeNotification(to: abs)
            }
        }
        completionHandler()
    }
}
