import SwiftUI
import WebKit

struct ContentView: View {
    @State private var isLoading = true

    var body: some View {
        ZStack {
            CurbWebView(isLoading: $isLoading)
                .ignoresSafeArea()

            if isLoading {
                LaunchOverlay()
                    .transition(.opacity)
            }
        }
        .background(CurbTheme.paper)
        .animation(.easeOut(duration: 0.18), value: isLoading)
    }
}

private struct CurbWebView: UIViewRepresentable {
    @Binding var isLoading: Bool

    private var appURL: URL {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["CURB_APP_URL"],
           let url = URL(string: override) {
            return url
        }
        #endif

        return URL(string: "https://curb.guide/?app=ios")!
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(isLoading: $isLoading)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(Self.nativeZoomGuardScript)
        configuration.userContentController.addUserScript(Self.nativeShellScript)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.delegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = CurbTheme.uiPaper
        webView.scrollView.backgroundColor = CurbTheme.uiPaper
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = true
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.delaysContentTouches = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.zoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false

        let doubleTapBlocker = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.blockDoubleTap(_:))
        )
        doubleTapBlocker.numberOfTapsRequired = 2
        doubleTapBlocker.cancelsTouchesInView = true
        doubleTapBlocker.delaysTouchesBegan = true
        doubleTapBlocker.delaysTouchesEnded = true
        doubleTapBlocker.delegate = context.coordinator
        webView.addGestureRecognizer(doubleTapBlocker)

        webView.load(URLRequest(url: appURL, cachePolicy: .returnCacheDataElseLoad))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.lockWebViewZoom(webView)
    }

    private static let nativeZoomGuardScript = WKUserScript(
        source: """
        (function(){
          if(window.__curbNativeZoomGuardsEarly) return;
          window.__curbNativeZoomGuardsEarly = true;

          function stopRepeatedActivation(event){
            if(event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();
            event.stopPropagation();
          }

          var lastTouchEnd = 0;
          document.addEventListener('touchend', function(event){
            var now = Date.now();
            if(now - lastTouchEnd <= 340){
              stopRepeatedActivation(event);
            }
            lastTouchEnd = now;
          }, {capture:true, passive:false});

          var lastPointerUp = 0;
          document.addEventListener('pointerup', function(event){
            var now = Date.now();
            if(now - lastPointerUp <= 340){
              stopRepeatedActivation(event);
            }
            lastPointerUp = now;
          }, {capture:true, passive:false});

          var lastMouseUp = 0;
          document.addEventListener('mouseup', function(event){
            var now = Date.now();
            if(now - lastMouseUp <= 340){
              stopRepeatedActivation(event);
            }
            lastMouseUp = now;
          }, true);

          var lastClick = 0;
          document.addEventListener('click', function(event){
            var now = Date.now();
            if(now - lastClick <= 340){
              stopRepeatedActivation(event);
            }
            lastClick = now;
          }, true);

          document.addEventListener('dblclick', function(event){
            stopRepeatedActivation(event);
          }, true);

          document.addEventListener('gesturestart', function(event){
            if(event.cancelable) event.preventDefault();
          }, {capture:true, passive:false});

          function patchLeaflet(){
            var L = window.L;
            if(!L || !L.Map || L.Map.__curbDoubleClickZoomDisabled) return false;
            L.Map.__curbDoubleClickZoomDisabled = true;
            if(L.Map.prototype && L.Map.prototype.options){
              L.Map.prototype.options.doubleClickZoom = false;
            }
            if(L.Map.mergeOptions){
              L.Map.mergeOptions({doubleClickZoom:false});
            }
            if(L.Map.addInitHook){
              L.Map.addInitHook(function(){
                if(this.doubleClickZoom) this.doubleClickZoom.disable();
              });
            }
            return true;
          }

          window.__curbPatchLeafletDoubleClickZoom = patchLeaflet;
          patchLeaflet();
          var tries = 0;
          var timer = setInterval(function(){
            tries += 1;
            if(patchLeaflet() || tries > 240) clearInterval(timer);
          }, 25);
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    private static let nativeShellScript = WKUserScript(
        source: """
        (function(){
          var css = `
            html.curb-native-ios{
              -webkit-text-size-adjust:100%!important;
            }
            html.curb-native-ios a,
            html.curb-native-ios button,
            html.curb-native-ios input,
            html.curb-native-ios select,
            html.curb-native-ios textarea,
            html.curb-native-ios [role="button"]{
              touch-action:manipulation!important;
            }
            html.curb-native-ios.curb-map-page .top .logo{display:none!important}
            html.curb-native-ios.curb-map-page .top{padding-top:calc(10px + env(safe-area-inset-top))!important}
            html.curb-native-ios.curb-map-page .barrow{gap:8px!important}
            html.curb-native-ios.curb-map-page .fwrap{min-width:0!important}

            html.curb-native-ios.curb-content-page,
            html.curb-native-ios.curb-content-page body{
              height:auto!important;
              min-height:100%!important;
              overflow-x:hidden!important;
              overflow-y:auto!important;
              -webkit-overflow-scrolling:touch!important;
              position:static!important;
              touch-action:pan-y!important;
            }
            html.curb-native-ios.curb-content-page body{
              padding-bottom:max(26px,env(safe-area-inset-bottom))!important;
            }
            html.curb-native-ios.curb-content-page main{
              padding-bottom:calc(86px + env(safe-area-inset-bottom))!important;
            }
            html.curb-native-ios.curb-content-page header{
              position:relative!important;
              z-index:1000!important;
              overflow:visible!important;
            }
            html.curb-native-ios.curb-content-page header.wrap{
              padding-top:max(72px,calc(16px + env(safe-area-inset-top)))!important;
            }
            html.curb-native-ios.curb-content-page .mast{
              min-height:44px!important;
              align-items:center!important;
              gap:10px!important;
            }
            html.curb-native-ios.curb-content-page header .logo{
              display:none!important;
            }
            html.curb-native-ios.curb-content-page .topnav,
            html.curb-native-ios.curb-content-page header>.nav,
            html.curb-native-ios.curb-content-page .mast>.btn{
              display:none!important;
            }
            html.curb-native-ios.curb-content-page .backbtn{
              display:inline-grid!important;
              place-items:center!important;
              width:44px!important;
              height:44px!important;
              flex:none!important;
              margin-left:0!important;
              padding:0!important;
              color:#17150F!important;
              background:transparent!important;
              border:0!important;
              border-radius:0!important;
              box-shadow:none!important;
              text-decoration:none!important;
              line-height:1!important;
            }
            html.curb-native-ios.curb-content-page .backbtn svg{
              display:block!important;
              width:28px!important;
              height:28px!important;
              stroke:currentColor!important;
              fill:none!important;
              stroke-width:2.4!important;
              stroke-linecap:round!important;
              stroke-linejoin:round!important;
            }
            html.curb-native-ios.curb-content-page .navwrap{
              display:block!important;
              margin-left:auto!important;
              position:relative!important;
            }
            html.curb-native-ios.curb-content-page .burger{
              display:grid!important;
              place-items:center!important;
              width:44px!important;
              height:44px!important;
              padding:0!important;
              background:#FFFDF6!important;
              color:#17150F!important;
              border:2.5px solid #17150F!important;
              border-radius:12px!important;
              box-shadow:3px 3px 0 #17150F!important;
            }
            html.curb-native-ios.curb-content-page .burger svg{
              width:21px!important;
              height:21px!important;
            }
            html.curb-native-ios.curb-content-page .navmenu{
              top:calc(100% + 10px)!important;
              right:0!important;
              max-height:min(62vh,430px)!important;
              overflow-y:auto!important;
              z-index:10000!important;
            }
          `;
          var style = document.createElement('style');
          style.id = 'curb-native-ios-style';
          style.textContent = css;
          (document.head || document.documentElement).appendChild(style);

          function lockViewportZoom(){
            var content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
            var meta = document.querySelector('meta[name="viewport"]');
            if(!meta){
              meta = document.createElement('meta');
              meta.name = 'viewport';
              (document.head || document.documentElement).appendChild(meta);
            }
            meta.setAttribute('content', content);
          }

          function installZoomGuards(){
            if(window.__curbNativeZoomGuards) return;
            window.__curbNativeZoomGuards = true;
            var lastTouchEnd = 0;
            function stopRepeatedActivation(event){
              if(event.cancelable) event.preventDefault();
              event.stopImmediatePropagation();
              event.stopPropagation();
            }
            document.addEventListener('touchend', function(event){
              var now = Date.now();
              if(now - lastTouchEnd <= 340){
                stopRepeatedActivation(event);
              }
              lastTouchEnd = now;
            }, {capture:true, passive:false});
            var lastPointerUp = 0;
            document.addEventListener('pointerup', function(event){
              var now = Date.now();
              if(now - lastPointerUp <= 340){
                stopRepeatedActivation(event);
              }
              lastPointerUp = now;
            }, {capture:true, passive:false});
            var lastMouseUp = 0;
            document.addEventListener('mouseup', function(event){
              var now = Date.now();
              if(now - lastMouseUp <= 340){
                stopRepeatedActivation(event);
              }
              lastMouseUp = now;
            }, true);
            var lastClick = 0;
            document.addEventListener('click', function(event){
              var now = Date.now();
              if(now - lastClick <= 340){
                stopRepeatedActivation(event);
              }
              lastClick = now;
            }, true);
            document.addEventListener('gesturestart', function(event){
              if(event.cancelable) event.preventDefault();
            }, {capture:true, passive:false});
            document.addEventListener('dblclick', function(event){
              stopRepeatedActivation(event);
            }, true);
          }

          function ensureBackButton(container){
            if(!container || container.querySelector('.backbtn')) return;
            var back = document.createElement('a');
            back.className = 'backbtn';
            back.href = '/';
            back.setAttribute('aria-label','Back to map');
            back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6 9 12l6 6"/></svg>';
            container.insertBefore(back, container.firstChild);
          }

          function ensureMenu(container){
            if(!container || container.querySelector('.navwrap')) return;
            var wrap = document.createElement('div');
            wrap.className = 'navwrap';
            wrap.innerHTML =
              '<button class="burger" type="button" aria-label="Menu" aria-haspopup="true" aria-expanded="false">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
              '</button>' +
              '<div class="navmenu" hidden>' +
              '<a href="/">Map</a><a href="/n/">Neighborhoods</a><a href="/tickets">Tickets</a><a href="/about">About</a>' +
              '<a href="https://github.com/alevizio/curb" rel="noopener">GitHub</a>' +
              '</div>';
            container.appendChild(wrap);
            var button = wrap.querySelector('button');
            var menu = wrap.querySelector('.navmenu');
            function close(){ menu.hidden = true; button.setAttribute('aria-expanded','false'); }
            button.addEventListener('click', function(event){
              event.stopPropagation();
              var opening = menu.hidden;
              menu.hidden = !opening;
              button.setAttribute('aria-expanded', String(opening));
            });
            document.addEventListener('click', function(event){
              if(!menu.hidden && !wrap.contains(event.target)) close();
            });
            document.addEventListener('keydown', function(event){
              if(event.key === 'Escape') close();
            });
          }

          function refreshNativeChrome(){
            lockViewportZoom();
            installZoomGuards();
            if(window.__curbPatchLeafletDoubleClickZoom) window.__curbPatchLeafletDoubleClickZoom();
            var root = document.documentElement;
            var isMapPage = !!document.getElementById('map') && !!document.querySelector('.top');
            root.classList.add('curb-native-ios');
            root.classList.toggle('curb-map-page', isMapPage);
            root.classList.toggle('curb-content-page', !isMapPage);
            if(isMapPage) return;

            var container = document.querySelector('header .mast') || document.querySelector('header.wrap');
            ensureBackButton(container);
            ensureMenu(container);
          }

          if(document.readyState === 'loading'){
            document.addEventListener('DOMContentLoaded', refreshNativeChrome);
          }
          refreshNativeChrome();
          setTimeout(refreshNativeChrome, 250);
          setTimeout(refreshNativeChrome, 1000);
        })();
        """,
        injectionTime: .atDocumentEnd,
        forMainFrameOnly: true
    )

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        @Binding private var isLoading: Bool

        init(isLoading: Binding<Bool>) {
            _isLoading = isLoading
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isLoading = false
            lockWebViewZoom(webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            isLoading = false
            lockWebViewZoom(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            isLoading = false
            lockWebViewZoom(webView)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            if shouldOpenExternally(url, navigationAction: navigationAction) {
                UIApplication.shared.open(url)
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
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url else {
                return nil
            }

            if shouldOpenExternally(url, navigationAction: navigationAction) {
                UIApplication.shared.open(url)
            } else {
                webView.load(URLRequest(url: url))
            }
            return nil
        }

        private func shouldOpenExternally(_ url: URL, navigationAction: WKNavigationAction) -> Bool {
            guard navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil else {
                return false
            }

            guard let scheme = url.scheme?.lowercased() else {
                return false
            }

            if scheme != "http", scheme != "https" {
                return true
            }

            let host = url.host(percentEncoded: false)?.lowercased()
            return host != "curb.guide" && host != "www.curb.guide"
        }

        @objc func blockDoubleTap(_ recognizer: UITapGestureRecognizer) {
            if let webView = recognizer.view as? WKWebView {
                lockWebViewZoom(webView)
            }
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            nil
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            if abs(scrollView.zoomScale - 1) > 0.001 {
                scrollView.setZoomScale(1, animated: false)
            }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            false
        }

        func lockWebViewZoom(_ webView: WKWebView) {
            let scrollView = webView.scrollView
            scrollView.minimumZoomScale = 1
            scrollView.maximumZoomScale = 1
            scrollView.zoomScale = 1
            scrollView.pinchGestureRecognizer?.isEnabled = false
        }
    }
}

private struct LaunchOverlay: View {
    var body: some View {
        ZStack {
            CurbTheme.paper.ignoresSafeArea()

            Text("CURB")
                .font(.system(size: 48, weight: .black, design: .rounded))
                .foregroundStyle(CurbTheme.red)
                .scaleEffect(1.04)
                .modifier(Heartbeat())
                .accessibilityLabel("Loading CURB")
        }
    }
}

private struct Heartbeat: ViewModifier {
    @State private var beat = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(beat ? 1.08 : 0.94)
            .opacity(beat ? 1 : 0.72)
            .onAppear { beat = true }
            .animation(
                .easeInOut(duration: 0.72).repeatForever(autoreverses: true),
                value: beat
            )
    }
}
