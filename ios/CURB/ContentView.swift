import SwiftUI
import WebKit
import CoreLocation
import UserNotifications

struct ContentView: View {
    private let curbURL = URL(string: "https://curb.guide")!

    @State private var isLoading = true
    @State private var loadError: String?
    @State private var reloadToken = UUID()

    var body: some View {
        ZStack {
            CurbWebView(
                url: curbURL,
                reloadToken: reloadToken,
                isLoading: $isLoading,
                loadError: $loadError
            )
            .ignoresSafeArea()

            if isLoading {
                LoadingOverlay()
            }

            if let loadError {
                VStack(spacing: 14) {
                    Text("CURB could not load")
                        .font(.system(size: 21, weight: .black, design: .rounded))
                    Text(loadError)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(CurbTheme.ink.opacity(0.72))
                    Button("Try again") {
                        self.loadError = nil
                        isLoading = true
                        reloadToken = UUID()
                    }
                    .signageButtonStyle()
                }
                .foregroundStyle(CurbTheme.ink)
                .padding(20)
                .background(CurbTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(CurbTheme.ink, lineWidth: 2)
                )
                .padding(24)
            }
        }
        .background(CurbTheme.paper)
    }
}

private struct CurbWebView: UIViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.userContentController.addUserScript(Self.nativeLocationScript)
        configuration.userContentController.addUserScript(Self.appChromeScript)
        configuration.userContentController.addUserScript(Self.shareScript)
        configuration.userContentController.addUserScript(Self.pushScript)
        configuration.userContentController.add(context.coordinator.locationBridge, name: "curbLocation")
        configuration.userContentController.add(context.coordinator.shareBridge, name: "curbShare")
        configuration.userContentController.add(context.coordinator.pushBridge, name: "curbPush")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.delaysContentTouches = false
        webView.scrollView.canCancelContentTouches = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.backgroundColor = CurbTheme.uiPaper
        webView.backgroundColor = CurbTheme.uiPaper
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        context.coordinator.webView = webView
        context.coordinator.locationBridge.webView = webView
        context.coordinator.shareBridge.webView = webView
        context.coordinator.pushBridge.webView = webView
        // Notification-tap deep links: navigate the live web view; consume any cold-start link.
        PushRouter.shared.navigate = { [weak webView] url in webView?.load(URLRequest(url: url)) }
        if let pending = PushRouter.shared.pendingURL { webView.load(URLRequest(url: pending)); PushRouter.shared.pendingURL = nil }
        context.coordinator.lastReloadToken = reloadToken

        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 20))
        return webView
    }

    private static let nativeLocationScript = WKUserScript(
        source: """
        (function () {
          if (window.__curbNativeGeoInstalled) return;
          if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.curbLocation) return;
          window.__curbNativeGeoInstalled = true;

          var callbacks = {};
          var nextId = 1;
          var permissionState = 'prompt';
          try {
            if (localStorage.getItem('curbLocOK') === '1') permissionState = 'granted';
          } catch (_) {}

          function geoError(code, message) {
            return {
              code: code,
              message: message || 'Location unavailable',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            };
          }

          function geoPosition(result) {
            return {
              coords: {
                latitude: result.latitude,
                longitude: result.longitude,
                accuracy: result.accuracy,
                altitude: result.altitude == null ? null : result.altitude,
                altitudeAccuracy: result.altitudeAccuracy == null ? null : result.altitudeAccuracy,
                heading: result.heading == null ? null : result.heading,
                speed: result.speed == null ? null : result.speed
              },
              timestamp: result.timestamp || Date.now()
            };
          }

          window.__curbNativeLocationResult = function (id, result) {
            var callback = callbacks[String(id)];
            if (!callback) return;
            delete callbacks[String(id)];
            if (result && result.ok) {
              permissionState = 'granted';
              try { localStorage.setItem('curbLocOK', '1'); } catch (_) {}
              callback.success(geoPosition(result));
            } else {
              if (result && result.code === 1) permissionState = 'denied';
              callback.error(geoError((result && result.code) || 2, (result && result.message) || 'Location unavailable'));
            }
          };

          function request(success, error, options) {
            if (typeof success !== 'function') {
              throw new TypeError('Position success callback must be a function');
            }
            var id = String(nextId++);
            callbacks[id] = {
              success: success,
              error: typeof error === 'function' ? error : function () {}
            };
            window.webkit.messageHandlers.curbLocation.postMessage({
              id: id,
              options: options || {}
            });
            return Number(id);
          }

          var nativeGeo = {
            getCurrentPosition: function (success, error, options) {
              request(success, error, options);
            },
            watchPosition: function (success, error, options) {
              return request(success, error, options);
            },
            clearWatch: function (id) {
              delete callbacks[String(id)];
            }
          };

          try {
            Object.defineProperty(navigator, 'geolocation', {
              configurable: true,
              enumerable: true,
              value: nativeGeo
            });
          } catch (_) {
            navigator.geolocation = nativeGeo;
          }

          if (navigator.permissions && navigator.permissions.query) {
            var originalQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function (descriptor) {
              if (descriptor && descriptor.name === 'geolocation') {
                return Promise.resolve({ name: 'geolocation', state: permissionState, onchange: null });
              }
              return originalQuery(descriptor);
            };
          }
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    private static let appChromeScript = WKUserScript(
        source: """
        (function () {
          try {
            localStorage.setItem('curbIosHintShown', '1');
          } catch (_) {}
          function installCurbAppChrome() {
            if (document.getElementById('curb-ios-app-style')) return;
            document.documentElement.classList.add('curb-ios-app');
            var style = document.createElement('style');
            style.id = 'curb-ios-app-style';
            style.textContent = [
              '.curb-ios-app.curb-ios-page{height:auto!important;min-height:100%!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch}',
              '.curb-ios-app.curb-ios-page body{height:auto!important;min-height:100dvh!important;overflow-x:hidden!important;overflow-y:visible!important;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding-bottom:max(34px,calc(18px + env(safe-area-inset-bottom)))!important}',
              '.curb-ios-app.curb-ios-page body>header{padding-top:max(78px,calc(24px + env(safe-area-inset-top)))!important}',
              '.curb-ios-app.curb-ios-page .mast,.curb-ios-app.curb-ios-page body>header{position:relative;z-index:70}',
              '.curb-ios-app #iosHint{display:none!important}',
              '.curb-ios-back{display:none;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;padding:0;border:2.5px solid var(--ink);border-radius:11px;background:var(--sign,#FFFDF6);color:var(--ink);box-shadow:3px 3px 0 var(--ink);font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}',
              // The web sub-pages now ship their own subtle back button, so keep the injected
              // native one hidden — avoids two back buttons on internal pages.
              '.curb-ios-page .curb-ios-back{display:none}',
              '.curb-ios-back svg{width:21px;height:21px;display:block;stroke:currentColor;fill:none;stroke-width:2.7;stroke-linecap:round;stroke-linejoin:round}',
              '.curb-ios-back:active{transform:translate(2px,2px);box-shadow:none}',
              '.curb-ios-app,.curb-ios-app body{-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}',
              '.curb-ios-app *:not(input):not(textarea):not([contenteditable]){-webkit-user-select:none;user-select:none}'
            ].join('\\n');
            (document.head || document.documentElement).appendChild(style);
          }
          function syncCurbAppRoute() {
            var path = location.pathname || '/';
            var isPage = path !== '/';
            document.documentElement.classList.toggle('curb-ios-page', isPage);
            var button = document.getElementById('curbIosBack');
            if (button) button.hidden = !isPage;
          }
          function installCurbBackButton() {
            if (document.getElementById('curbIosBack')) {
              syncCurbAppRoute();
              return;
            }
            var host = document.querySelector('.mast') || document.querySelector('body > header') || document.querySelector('header');
            if (!host) return;
            var button = document.createElement('button');
            button.id = 'curbIosBack';
            button.className = 'curb-ios-back';
            button.type = 'button';
            button.title = 'Back';
            button.setAttribute('aria-label', 'Back');
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/><path d="M21 12H9"/></svg>';
            button.addEventListener('click', function () {
              var sameOriginReferrer = false;
              try {
                sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === location.origin;
              } catch (_) {}
              if (history.length > 1 && sameOriginReferrer) {
                history.back();
              } else {
                location.assign('/');
              }
            });
            host.insertBefore(button, host.firstChild);
            syncCurbAppRoute();
          }
          function installCurbAppCopy() {
            if (typeof window.locateFail !== 'function' || window.locateFail.__curbIosAppCopy) return;
            var replacement = function () {
              if (typeof window.toast === 'function') {
                window.toast('Location is unavailable — allow CURB in Settings, or search/tap the map.');
              }
            };
            replacement.__curbIosAppCopy = true;
            window.locateFail = replacement;
          }
          installCurbAppChrome();
          syncCurbAppRoute();
          installCurbAppCopy();
          document.addEventListener('DOMContentLoaded', function () {
            installCurbAppChrome();
            installCurbBackButton();
            syncCurbAppRoute();
          }, { once: true });
          document.addEventListener('DOMContentLoaded', function () {
            installCurbAppCopy();
            setTimeout(installCurbAppCopy, 500);
          }, { once: true });
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    // Bridge navigator.share → native share sheet (WKWebView doesn't implement Web Share).
    private static let shareScript = WKUserScript(
        source: """
        (function () {
          if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.curbShare) return;
          var resolveFn = null, rejectFn = null;
          window.__curbShareDone = function (ok) {
            if (ok) { if (resolveFn) resolveFn(); }
            else if (rejectFn) { rejectFn(new DOMException('Share canceled', 'AbortError')); }
            resolveFn = null; rejectFn = null;
          };
          navigator.share = function (data) {
            return new Promise(function (resolve, reject) {
              resolveFn = resolve; rejectFn = reject;
              window.webkit.messageHandlers.curbShare.postMessage({
                title: (data && data.title) || '',
                text: (data && data.text) || '',
                url: (data && data.url) || ''
              });
            });
          };
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    // Bridge the web "Sweep alerts" button to native APNs registration. Defines a flag the web
    // checks (__curbNativePush) and a promise-returning __curbRequestPush(spot) resolved natively.
    private static let pushScript = WKUserScript(
        source: """
        (function () {
          if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.curbPush) return;
          window.__curbNativePush = true;
          var resolveFn = null;
          window.__curbNativePushResult = function (ok, msg) {
            if (resolveFn) resolveFn({ ok: ok, message: msg });
            resolveFn = null;
          };
          window.__curbRequestPush = function (spot) {
            return new Promise(function (resolve) {
              resolveFn = resolve;
              window.webkit.messageHandlers.curbPush.postMessage({ spot: spot || null });
            }).then(function (r) { return !!(r && r.ok); });
          };
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            webView.reload()
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, UIDocumentInteractionControllerDelegate {
        var parent: CurbWebView
        weak var webView: WKWebView?
        let locationBridge = LocationBridge()
        let shareBridge = ShareBridge()
        let pushBridge = PushBridge()
        var lastReloadToken: UUID?
        private var downloadDestination: URL?
        private var documentController: UIDocumentInteractionController?

        init(parent: CurbWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
            parent.loadError = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            parent.loadError = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finishWith(error: error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finishWith(error: error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }

            guard let nextURL = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            if shouldOpenExternally(nextURL) {
                UIApplication.shared.open(nextURL)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                if shouldOpenExternally(url) {
                    UIApplication.shared.open(url)
                } else {
                    webView.load(URLRequest(url: url))
                }
            }
            return nil
        }

        // MARK: downloads (the web's "Apple / .ics" reminder triggers a blob download)
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
            let name = suggestedFilename.isEmpty ? "curb-reminder.ics" : suggestedFilename
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: url)
            downloadDestination = url
            completionHandler(url)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let url = downloadDestination else { return }
            let controller = UIDocumentInteractionController(url: url)
            controller.delegate = self
            documentController = controller
            if !controller.presentPreview(animated: true), let view = webView {
                controller.presentOptionsMenu(from: view.bounds, in: view, animated: true)
            }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloadDestination = nil
        }

        func documentInteractionControllerViewControllerForPreview(_ controller: UIDocumentInteractionController) -> UIViewController {
            curbTopViewController() ?? UIViewController()
        }

        private func finishWith(error: Error) {
            parent.isLoading = false
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled {
                return
            }
            parent.loadError = error.localizedDescription
        }

        private func shouldOpenExternally(_ url: URL) -> Bool {
            guard let host = url.host?.lowercased() else {
                return false
            }
            if host == "curb.guide" || host.hasSuffix(".curb.guide") {
                return false
            }
            return host == "github.com"
                || host.hasSuffix(".github.com")
                || host.contains("calendar.google.com")
                || host.contains("accounts.google.com")
                || host.contains("google.com")
                || host.contains("apple.com")
        }
    }
}

private final class LocationBridge: NSObject, WKScriptMessageHandler, @preconcurrency CLLocationManagerDelegate {
    private struct PendingRequest {
        let id: String
        let workItem: DispatchWorkItem
    }

    weak var webView: WKWebView?

    private let locationManager = CLLocationManager()
    private var pendingRequests: [String: PendingRequest] = [:]
    private var lastLocation: CLLocation?

    override init() {
        super.init()
        locationManager.delegate = self
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "curbLocation",
            let body = message.body as? [String: Any],
            let id = body["id"] as? String
        else {
            return
        }

        let options = body["options"] as? [String: Any] ?? [:]
        let maximumAge = milliseconds(from: options["maximumAge"], fallback: 0)
        let timeout = min(max(milliseconds(from: options["timeout"], fallback: 10_000), 1_000), 30_000)
        let highAccuracy = options["enableHighAccuracy"] as? Bool ?? true

        if let lastLocation,
           maximumAge > 0,
           Date().timeIntervalSince(lastLocation.timestamp) * 1_000 <= Double(maximumAge) {
            finish(id: id, with: lastLocation)
            return
        }

        locationManager.desiredAccuracy = highAccuracy ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters

        let timeoutWork = DispatchWorkItem { [weak self] in
            self?.finish(id: id, code: 3, message: "Location timed out.")
        }
        pendingRequests[id] = PendingRequest(id: id, workItem: timeoutWork)
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeout), execute: timeoutWork)

        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            locationManager.requestLocation()
        case .denied, .restricted:
            finish(id: id, code: 1, message: "Location permission is off for CURB.")
        @unknown default:
            finish(id: id, code: 2, message: "Location is unavailable.")
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            finishAll(code: 1, message: "Location permission is off for CURB.")
        case .notDetermined:
            break
        @unknown default:
            finishAll(code: 2, message: "Location is unavailable.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else {
            finishAll(code: 2, message: "Location is unavailable.")
            return
        }
        lastLocation = location
        let requestIds = Array(pendingRequests.keys)
        requestIds.forEach { finish(id: $0, with: location) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let nsError = error as NSError
        if nsError.domain == kCLErrorDomain as String, nsError.code == CLError.denied.rawValue {
            finishAll(code: 1, message: "Location permission is off for CURB.")
        } else {
            finishAll(code: 2, message: "Location is unavailable.")
        }
    }

    private func milliseconds(from value: Any?, fallback: Int) -> Int {
        if let number = value as? NSNumber {
            return number.intValue
        }
        if let double = value as? Double {
            return Int(double)
        }
        if let int = value as? Int {
            return int
        }
        return fallback
    }

    private func finishAll(code: Int, message: String) {
        let requestIds = Array(pendingRequests.keys)
        requestIds.forEach { finish(id: $0, code: code, message: message) }
    }

    private func finish(id: String, with location: CLLocation) {
        guard let pending = pendingRequests.removeValue(forKey: id) else {
            return
        }
        pending.workItem.cancel()

        let payload: [String: Any] = [
            "ok": true,
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": max(location.horizontalAccuracy, 0),
            "altitude": location.verticalAccuracy >= 0 ? location.altitude : NSNull(),
            "altitudeAccuracy": location.verticalAccuracy >= 0 ? location.verticalAccuracy : NSNull(),
            "heading": location.course >= 0 ? location.course : NSNull(),
            "speed": location.speed >= 0 ? location.speed : NSNull(),
            "timestamp": location.timestamp.timeIntervalSince1970 * 1_000
        ]
        send(payload, to: id)
    }

    private func finish(id: String, code: Int, message: String) {
        guard let pending = pendingRequests.removeValue(forKey: id) else {
            return
        }
        pending.workItem.cancel()
        send(["ok": false, "code": code, "message": message], to: id)
    }

    private func send(_ payload: [String: Any], to id: String) {
        guard
            let webView,
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else {
            return
        }

        let escapedId = id.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        webView.evaluateJavaScript("window.__curbNativeLocationResult && window.__curbNativeLocationResult('\(escapedId)', \(json));")
    }
}

@MainActor private func curbTopViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
    var root = windows.first { $0.isKeyWindow }?.rootViewController ?? windows.first?.rootViewController
    while let presented = root?.presentedViewController { root = presented }
    return root
}

// Bridge the web's navigator.share() to a native UIActivityViewController.
private final class ShareBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "curbShare", let body = message.body as? [String: Any] else { return }
        let text = (body["text"] as? String) ?? ""
        let urlString = (body["url"] as? String) ?? ""

        var items: [Any] = []
        if let url = URL(string: urlString), url.scheme != nil { items.append(url) }
        if !text.isEmpty { items.append(text) }

        guard !items.isEmpty, let top = curbTopViewController() else {
            finish(false)
            return
        }

        let activity = UIActivityViewController(activityItems: items, applicationActivities: nil)
        if let popover = activity.popoverPresentationController, let view = webView {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        activity.completionWithItemsHandler = { [weak self] _, completed, _, _ in
            self?.finish(completed)
        }
        top.present(activity, animated: true)
    }

    private func finish(_ ok: Bool) {
        webView?.evaluateJavaScript("window.__curbShareDone && window.__curbShareDone(\(ok ? "true" : "false"));")
    }
}

// Native APNs registration bridge: the web's "Sweep alerts" button → permission prompt → device
// token → POST {token, spot} to /api/save-ios-subscription → resolve the JS promise.
@MainActor
private final class PushBridge: NSObject, WKScriptMessageHandler, PushTokenReceiver {
    weak var webView: WKWebView?
    private var pendingSpot: [String: Any]?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "curbPush", let body = message.body as? [String: Any] else { return }
        pendingSpot = body["spot"] as? [String: Any]
        Task { @MainActor in
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted {
                PushRouter.shared.tokenReceiver = self
                UIApplication.shared.registerForRemoteNotifications()
                // didReceiveDeviceToken (or didFailRegistration) resolves the JS promise.
            } else {
                self.resolve(false, "denied")
            }
        }
    }

    func didReceiveDeviceToken(_ hexToken: String) {
        guard let spot = pendingSpot else { resolve(false, "no-spot"); return }
        let payload: [String: Any] = ["token": hexToken, "platform": "ios", "bundleId": "guide.curb.ios", "spot": spot]
        guard let url = URL(string: "https://curb.guide/api/save-ios-subscription"),
              let data = try? JSONSerialization.data(withJSONObject: payload) else { resolve(false, "encode"); return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        Task { @MainActor in
            do {
                let (_, resp) = try await URLSession.shared.data(for: req)
                let ok = (resp as? HTTPURLResponse).map { (200...299).contains($0.statusCode) } ?? false
                self.resolve(ok, ok ? "saved" : "save-failed")
            } catch {
                self.resolve(false, "save-failed")
            }
        }
    }

    func didFailRegistration(_ message: String) { resolve(false, message) }

    private func resolve(_ ok: Bool, _ msg: String) {
        let safe = msg.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "'", with: "\\'")
        webView?.evaluateJavaScript("window.__curbNativePushResult && window.__curbNativePushResult(\(ok ? "true" : "false"), '\(safe)');")
    }
}

private struct LoadingOverlay: View {
    var body: some View {
        ZStack {
            CurbTheme.paper
                .ignoresSafeArea()

            TimelineView(.animation) { timeline in
                Image("CurbLoaderLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 118, height: 118)
                    .scaleEffect(heartbeatScale(at: timeline.date))
                    .accessibilityLabel("Loading CURB")
            }
        }
        .transition(.opacity)
    }

    private func heartbeatScale(at date: Date) -> CGFloat {
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.18)
        let firstBeat = pulse(phase, center: 0.12, width: 0.055, lift: 0.13)
        let secondBeat = pulse(phase, center: 0.32, width: 0.07, lift: 0.09)
        return 0.94 + firstBeat + secondBeat
    }

    private func pulse(_ value: TimeInterval, center: TimeInterval, width: TimeInterval, lift: CGFloat) -> CGFloat {
        let distance = (value - center) / width
        return lift * CGFloat(exp(-(distance * distance)))
    }
}
