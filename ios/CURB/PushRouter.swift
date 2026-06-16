import Foundation

/// Bridges the UIApplicationDelegate (where APNs device-token callbacks land) to the WKWebView
/// push bridge (which the AppDelegate can't reach directly), and parks a deep link from a tapped
/// notification until the web view is ready (cold-start launches arrive before it). Main-actor —
/// every caller (AppDelegate callbacks, the WebKit bridge) is already on the main thread.
@MainActor
final class PushRouter {
    static let shared = PushRouter()
    private init() {}

    /// The push bridge awaiting a device token (set when the user grants and we registerForRemote).
    weak var tokenReceiver: PushTokenReceiver?

    /// Installed by the WebView Coordinator: navigate the live web view to a URL.
    var navigate: ((URL) -> Void)?
    /// A deep link that arrived before `navigate` was installed (cold start); consumed when ready.
    var pendingURL: URL?

    func deliverDeviceToken(_ hexToken: String) { tokenReceiver?.didReceiveDeviceToken(hexToken) }
    func deliverRegistrationFailure(_ message: String) { tokenReceiver?.didFailRegistration(message) }

    func routeNotification(to url: URL) {
        if let navigate { navigate(url) } else { pendingURL = url }
    }
}

/// Implemented by the WKWebView push bridge so a device-token callback can finish the registration
/// it kicked off (POST the token + the pending spot, then resolve the JS promise).
@MainActor
protocol PushTokenReceiver: AnyObject {
    func didReceiveDeviceToken(_ hexToken: String)
    func didFailRegistration(_ message: String)
}
