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
        // The page is a fixed full-screen map that never scrolls; bouncing only rubber-banded the whole
        // UI (map, sheet, header) on any vertical drag. Scrollable parts (the sheet) scroll inside WebKit.
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
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
        context.coordinator.lastReloadToken = reloadToken

        // A cold-start notification tap parks its deep link in pendingURL BEFORE the web view exists;
        // load it INSTEAD of the root, or the unconditional root load would immediately cancel and
        // replace it (two back-to-back WKWebView.load calls — the second wins, dropping the deep link).
        if let pending = PushRouter.shared.pendingURL {
            PushRouter.shared.pendingURL = nil
            webView.load(URLRequest(url: pending))
        } else {
            webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 20))
        }
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
          // Last known native CLAuthorizationStatus as a PermissionState. NOT seeded from a past success:
          // Allow Once / Ask Next Time revert to notDetermined, and a stale 'granted' made the launch
          // auto-locate pop the system prompt by itself. permissions.query asks native each time.
          var permissionState = 'prompt';
          var statusWaiters = [];
          window.__curbNativeGeoStatus = function (state) {
            if (state) permissionState = state;
            var waiters = statusWaiters;
            statusWaiters = [];
            waiters.forEach(function (answer) { answer(); });
          };

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
              timestamp: result.timestamp || Date.now(),
              curbReduced: !!result.reduced   // Precise Location off: the page words its "approximate" toast
            };
          }

          window.__curbNativeLocationResult = function (id, result) {
            var callback = callbacks[String(id)];
            if (!callback) return;
            delete callbacks[String(id)];
            if (result && result.ok) {
              permissionState = 'granted';
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
                return new Promise(function (resolve) {
                  var answered = false;
                  function answer() {
                    if (answered) return;
                    answered = true;
                    resolve({ name: 'geolocation', state: permissionState, onchange: null });
                  }
                  statusWaiters.push(answer);
                  setTimeout(answer, 1000);   // a lost native reply must not hang the page's launch auto-locate
                  window.webkit.messageHandlers.curbLocation.postMessage({ type: 'status' });
                });
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
          // (No locate-failure copy override any more: the page words each failure itself — denied vs
          // timeout vs unavailable — and a blanket "allow CURB in Settings" misled people who had allowed it.)
          installCurbAppChrome();
          syncCurbAppRoute();
          document.addEventListener('DOMContentLoaded', function () {
            installCurbAppChrome();
            installCurbBackButton();
            syncCurbAppRoute();
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
          // r = { ok, status, message, reason } — see PushBridge.resolve.
          window.__curbNativePushResult = function (r) {
            if (resolveFn) resolveFn(r || { ok: false, status: 0, message: 'no-result', reason: 'no-result' });
            resolveFn = null;
          };
          function requestPush(spot) {
            return new Promise(function (resolve) {
              resolveFn = resolve;
              window.webkit.messageHandlers.curbPush.postMessage({ spot: spot || null });
            });
          }
          // Legacy contract (pages that do .then(ok => ...)): a plain boolean, as in builds <= 6.
          window.__curbRequestPush = function (spot) {
            return requestPush(spot).then(function (r) { return !!(r && r.ok); });
          };
          // Detailed contract: resolves { ok, status, message, reason } so the page can tell
          // "couldn't save, try again" (status = HTTP code, message = server error) from a permission
          // problem (reason 'denied' / 'denied-settings'). Feature-detect it; fall back to the boolean.
          window.__curbRequestPushDetail = requestPush;
          // Fire a one-off TEST push to this device (fire-and-forget) so the user can feel the cadence.
          window.__curbTestPush = function (opts) {
            window.webkit.messageHandlers.curbPush.postMessage({ test: true, opts: opts || {} });
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
        let timeoutMs: Int
        let precise: Bool                         // enableHighAccuracy: wants a curb-side-grade fix
        var workItem: DispatchWorkItem?
    }

    weak var webView: WKWebView?

    private let locationManager = CLLocationManager()
    private var pendingRequests: [String: PendingRequest] = [:]
    private var lastLocation: CLLocation?
    private var updating = false                  // one shared startUpdatingLocation() serves every pending request
    private var acquireStart = Date.distantPast   // deliveries older than this acquisition are stale cache
    private var bestFix: CLLocation?              // most accurate fix of THIS acquisition
    private var relaxWork: DispatchWorkItem?
    private var askingPrecise = false             // the temporary full-accuracy sheet is up
    private static let promptGraceMs = 50_000     // extra grace so the permission prompt never trips the backstop
    private static let preciseM: CLLocationAccuracy = 25   // good enough at once: picks the curb side
    private static let relaxedM: CLLocationAccuracy = 65   // good enough after relaxAfterMs: still picks the block
    private static let coarseM: CLLocationAccuracy = 100   // all an enableHighAccuracy:false request needs
    private static let relaxAfterMs = 5_000
    private static let precisePurposeKey = "PreciseCurb"   // Info.plist NSLocationTemporaryUsageDescriptionDictionary

    // THREADING: every LocationBridge access is main-thread only — WKScriptMessage delivery, the
    // CLLocationManager delegate callbacks and completion blocks (the manager is created on main), and the
    // main-queue timeout work items all serialize there, so the plain dictionaries need no extra locking.

    override init() {
        super.init()
        locationManager.delegate = self
    }

    /// Debug-only guard that makes the main-thread-only invariant above load-bearing: a future change
    /// delivering any entry point off-main traps here instead of silently corrupting the lock-free state.
    @inline(__always) private func assertMain() {
        #if DEBUG
        precondition(Thread.isMainThread, "LocationBridge accessed off the main thread")
        #endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        assertMain()
        guard message.name == "curbLocation", let body = message.body as? [String: Any] else {
            return
        }
        if (body["type"] as? String) == "status" {   // the shim's navigator.permissions.query
            sendStatus()
            return
        }
        guard let id = body["id"] as? String else {
            return
        }

        let options = body["options"] as? [String: Any] ?? [:]
        let maximumAge = milliseconds(from: options["maximumAge"], fallback: 0)
        let timeout = min(max(milliseconds(from: options["timeout"], fallback: 15_000), 1_000), 30_000)
        let precise = options["enableHighAccuracy"] as? Bool ?? true
        // The page's launch auto-locate: it must never surface a system prompt the user didn't ask for.
        let silent = options["curbSilent"] as? Bool ?? false
        let status = locationManager.authorizationStatus

        // Register first: finish() resolves by REMOVING the entry, so a request that skipped
        // registration would never reach send() and the JS promise would never resolve.
        pendingRequests[id] = PendingRequest(id: id, timeoutMs: timeout, precise: precise, workItem: nil)

        // Cache: only while authorized with full accuracy (an expired Allow Once must not keep serving fixes,
        // and a reduced-accuracy one must not skip asking for precise), and only if good enough for this request.
        if status == .authorizedWhenInUse || status == .authorizedAlways,
           locationManager.accuracyAuthorization == .fullAccuracy,
           let lastLocation, maximumAge > 0,
           lastLocation.horizontalAccuracy <= (precise ? Self.relaxedM : Self.coarseM),
           Date().timeIntervalSince(lastLocation.timestamp) * 1_000 <= Double(maximumAge) {
            finish(id: id, with: lastLocation)
            return
        }

        switch status {
        case .notDetermined:
            if silent {
                // Not code 1: the shim would then report 'denied', which isn't true.
                finish(id: id, code: 2, message: "Location permission not granted yet.")
                return
            }
            // First run: the acquisition timeout must NOT fire while the "Allow Location?" prompt is up
            // (that was the original bug — the very first locate timed out mid-prompt). But a request with
            // no timer can leak/hang forever if the prompt is abandoned or interrupted, so arm a generous
            // BACKSTOP (prompt grace + the fix deadline) that won't trip during a normal answer yet still
            // reaps a stranded request. It's tightened to the real deadline once auth resolves.
            armTimeout(id: id, ms: timeout + Self.promptGraceMs)
            locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            if askingPrecise {   // the full-accuracy sheet is up: wait for its answer like the others
                armTimeout(id: id, ms: timeout + Self.promptGraceMs)
                return
            }
            if precise, !silent, locationManager.accuracyAuthorization == .reducedAccuracy {
                // Precise Location is off, so fixes are ~5 km region points that can't pick a block. Ask for
                // full accuracy for this locate; it's a system sheet, so the deadline waits like the prompt.
                armTimeout(id: id, ms: timeout + Self.promptGraceMs)
                requestPreciseOnce()
                return
            }
            armTimeout(id: id, ms: timeout)
            startAcquiring()
        case .denied, .restricted:
            finish(id: id, code: 1, message: "Location permission is off for CURB.")
        @unknown default:
            finish(id: id, code: 2, message: "Location is unavailable.")
        }
    }

    /// (Re)arm a request's deadline for `ms` from now, cancelling any prior one. The .notDetermined path
    /// arms a generous backstop (so the permission prompt never trips it); resolving auth re-arms the
    /// tight acquisition deadline. Every registered request always has exactly one live timer.
    private func armTimeout(id: String, ms: Int) {
        guard var pending = pendingRequests[id] else { return }
        pending.workItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.deadline(id: id)
        }
        pending.workItem = work
        pendingRequests[id] = pending
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(ms), execute: work)
    }

    /// A request's deadline: serve the best fix of this acquisition instead of failing — the page shows a
    /// coarse one as approximate. Only having no fix at all is a timeout.
    private func deadline(id: String) {
        if updating, !askingPrecise, let fix = bestFix {
            finish(id: id, with: fix)
        } else {
            finish(id: id, code: 3, message: "Location timed out.")
            if pendingRequests.isEmpty { askingPrecise = false }   // a sheet that never called back must not park every later locate
        }
    }

    /// One shared acquisition serves every pending request. startUpdatingLocation — not the one-shot
    /// requestLocation(), which holds out ~10 s for a Best fix and so blew the page's 9 s deadline (the
    /// first tap failed, the second got the late fix from cache) — streams fixes as they improve; each
    /// request takes the first good-enough one, or the best of this acquisition at its deadline.
    private func startAcquiring() {
        locationManager.desiredAccuracy = pendingRequests.values.contains { $0.precise }
            ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        if !updating {
            updating = true
            acquireStart = Date()
            bestFix = nil
            let relax = DispatchWorkItem { [weak self] in
                self?.resolveReady()
            }
            relaxWork = relax
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Self.relaxAfterMs), execute: relax)
            locationManager.startUpdatingLocation()
        }
        resolveReady()   // a request joining a running acquisition may already be satisfied
    }

    private func stopAcquiringIfIdle() {
        guard updating, pendingRequests.isEmpty else { return }
        updating = false
        relaxWork?.cancel()
        relaxWork = nil
        locationManager.stopUpdatingLocation()   // GPS off as soon as nobody is waiting (battery)
    }

    /// Resolve every pending request the best fix so far is good enough for: curb-side grade at first,
    /// block grade after relaxAfterMs, and anything under reduced accuracy (it won't get better).
    private func resolveReady() {
        guard updating, !askingPrecise, let fix = bestFix else { return }
        let reduced = locationManager.accuracyAuthorization == .reducedAccuracy
        let relaxed = Date().timeIntervalSince(acquireStart) * 1_000 >= Double(Self.relaxAfterMs)
        let snapshot = pendingRequests
        for (id, pending) in snapshot {
            let need = reduced ? CLLocationAccuracy.greatestFiniteMagnitude
                : pending.precise ? (relaxed ? Self.relaxedM : Self.preciseM) : Self.coarseM
            if fix.horizontalAccuracy <= need { finish(id: id, with: fix) }
        }
    }

    private func requestPreciseOnce() {
        guard !askingPrecise else { return }
        askingPrecise = true
        // Called back granted or not (or with an error when iOS declines to show the sheet); hop to main
        // explicitly rather than rely on the manager's run loop.
        locationManager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: Self.precisePurposeKey) { [weak self] _ in
            DispatchQueue.main.async { self?.preciseAnswered() }
        }
    }

    /// The full-accuracy sheet closed (or iOS declined to show it): acquire at whatever accuracy we have now.
    private func preciseAnswered() {
        assertMain()
        askingPrecise = false
        lastLocation = nil
        let ids = Array(pendingRequests.keys)
        guard !ids.isEmpty else { return }
        ids.forEach { id in
            if let ms = pendingRequests[id]?.timeoutMs { armTimeout(id: id, ms: ms) }
        }
        startAcquiring()
    }

    /// Tell the page the REAL authorization (the shim's permissions.query waits on this): Allow Once and
    /// Ask Next Time read as 'prompt' once they lapse, so the launch auto-locate stays quiet.
    private func sendStatus() {
        let state: String
        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: state = "granted"
        case .denied, .restricted: state = "denied"
        default: state = "prompt"
        }
        webView?.evaluateJavaScript("window.__curbNativeGeoStatus && window.__curbNativeGeoStatus('\(state)');")
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        assertMain()
        lastLocation = nil   // a fix cached under the old authorization/accuracy must not be served under the new one
        sendStatus()
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            // Only act if something is actually waiting — iOS fires this once when the delegate is set,
            // so an unconditional start here would pull a stray fix on every launch.
            let ids = Array(pendingRequests.keys)
            guard !ids.isEmpty, !askingPrecise else { break }
            ids.forEach { id in
                if let ms = pendingRequests[id]?.timeoutMs { armTimeout(id: id, ms: ms) }   // tighten the backstop now that we're acquiring
            }
            startAcquiring()
        case .denied, .restricted:
            finishAll(code: 1, message: "Location permission is off for CURB.")
        case .notDetermined:
            break
        @unknown default:
            finishAll(code: 2, message: "Location is unavailable.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        assertMain()
        guard updating else { return }
        let reduced = manager.accuracyAuthorization == .reducedAccuracy
        for location in locations {
            // Skip invalid fixes (negative accuracy) and the cached delivery an acquisition often opens with:
            // it can be minutes old, i.e. where you were before you drove and parked. (Reduced-accuracy
            // region fixes are documented as up to 20 min old, and waiting won't bring a fresher one.)
            guard location.horizontalAccuracy >= 0,
                  reduced || location.timestamp.timeIntervalSince(acquireStart) >= -2 else { continue }
            if let best = bestFix, best.horizontalAccuracy < location.horizontalAccuracy { continue }
            bestFix = location
        }
        if let bestFix { lastLocation = bestFix }
        resolveReady()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        assertMain()
        let nsError = error as NSError
        guard nsError.domain == kCLErrorDomain as String else {
            finishAll(code: 2, message: "Location is unavailable.")
            return
        }
        switch nsError.code {
        case CLError.locationUnknown.rawValue:
            break   // transient ("no fix yet"): updates keep coming, and each request's deadline decides
        case CLError.denied.rawValue:
            finishAll(code: 1, message: "Location permission is off for CURB.")
        default:
            finishAll(code: 2, message: "Location is unavailable (CLError \(nsError.code)).")
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
        pending.workItem?.cancel()
        stopAcquiringIfIdle()

        let payload: [String: Any] = [
            "ok": true,
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": max(location.horizontalAccuracy, 0),
            "altitude": location.verticalAccuracy >= 0 ? location.altitude : NSNull(),
            "altitudeAccuracy": location.verticalAccuracy >= 0 ? location.verticalAccuracy : NSNull(),
            "heading": location.course >= 0 ? location.course : NSNull(),
            "speed": location.speed >= 0 ? location.speed : NSNull(),
            "timestamp": location.timestamp.timeIntervalSince1970 * 1_000,
            "reduced": locationManager.accuracyAuthorization == .reducedAccuracy
        ]
        send(payload, to: id)
    }

    private func finish(id: String, code: Int, message: String) {
        guard let pending = pendingRequests.removeValue(forKey: id) else {
            return
        }
        pending.workItem?.cancel()
        stopAcquiringIfIdle()
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
    private var pendingTest: [String: Any]?   // set when the message is a "send me a test" request
    private var registrationTimeout: DispatchWorkItem?
    private var registrationGen = 0   // bumped per tap; a superseded registration's timeout must not cancel a newer one

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "curbPush", let body = message.body as? [String: Any] else { return }
        if (body["test"] as? Bool) == true {
            pendingTest = (body["opts"] as? [String: Any]) ?? [:]
            pendingSpot = nil
        } else {
            pendingTest = nil
            pendingSpot = body["spot"] as? [String: Any]
        }
        registrationGen &+= 1
        let gen = registrationGen
        Task { @MainActor in
            // If the user already denied notifications, iOS shows no prompt — requestAuthorization just
            // returns false. Surface that distinctly so JS can point them straight at Settings.
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if settings.authorizationStatus == .denied {
                self.resolve(false, "denied-settings"); return
            }
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            if granted {
                PushRouter.shared.tokenReceiver = self
                UIApplication.shared.registerForRemoteNotifications()
                // didReceiveDeviceToken (or didFailRegistration) resolves the JS promise — but APNs
                // can silently call back neither (e.g. no network), which would leave the web
                // "Sweep alerts" button stuck on "Enabling…". Time out after 15s like LocationBridge
                // does. A late token still saves server-side (tokenReceiver stays set).
                // A rapid re-tap supersedes this registration; gate the timeout on the generation so a
                // stale one can't fire resolve() and cancel the NEWER registration's timer.
                let timeout = DispatchWorkItem { [weak self] in
                    guard let self, self.registrationGen == gen else { return }
                    self.resolve(false, "timeout")
                }
                self.registrationTimeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(15), execute: timeout)
            } else {
                self.resolve(false, "denied")
            }
        }
    }

    func didReceiveDeviceToken(_ hexToken: String) {
        // A "send me a test" request routes the token to the test endpoint instead of saving a watch.
        if let opts = pendingTest {
            pendingTest = nil
            var payload: [String: Any] = opts
            payload["token"] = hexToken
            guard let url = URL(string: "https://curb.guide/api/test-notification"),
                  let data = try? JSONSerialization.data(withJSONObject: payload) else { resolve(false, "encode"); return }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = data
            Task { @MainActor in
                _ = try? await URLSession.shared.data(for: req)
                self.resolve(true, "test-sent")
            }
            return
        }
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
                let (body, resp) = try await URLSession.shared.data(for: req)
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let ok = (200...299).contains(status)
                // Pass the server's reason through (e.g. 429 "slow down", 503 store down) so the page can
                // say "couldn't save, try again" instead of blaming notification permissions.
                let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
                // `error` is the reason ("slow down", "store not configured"); `note` is only operator advice.
                let serverMsg = (json?["error"] as? String) ?? (ok ? "saved" : "HTTP \(status)")
                self.resolve(ok, ok ? "saved" : "save-failed", message: serverMsg, status: status)
            } catch {
                self.resolve(false, "save-failed", message: error.localizedDescription)
            }
        }
    }

    func didFailRegistration(_ message: String) { resolve(false, "registration-failed", message: message) }

    /// Resolves the page's pending promise with { ok, status, message, reason }: `reason` is a stable code
    /// (saved, test-sent, denied, denied-settings, timeout, save-failed, registration-failed, no-spot, encode),
    /// `message` the server's / system's own words (defaults to the reason), `status` the save call's HTTP
    /// status (0 when no request was made or it never got a response).
    private func resolve(_ ok: Bool, _ reason: String, message: String? = nil, status: Int = 0) {
        registrationTimeout?.cancel()
        registrationTimeout = nil
        let result: [String: Any] = ["ok": ok, "reason": reason, "message": String((message ?? reason).prefix(300)), "status": status]
        guard let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__curbNativePushResult && window.__curbNativePushResult(\(json));")
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
