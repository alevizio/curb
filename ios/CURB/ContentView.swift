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

    private let appURL = URL(string: "https://curb.guide/?app=ios")!

    func makeCoordinator() -> Coordinator {
        Coordinator(isLoading: $isLoading)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(Self.nativeShellScript)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = CurbTheme.uiPaper
        webView.scrollView.backgroundColor = CurbTheme.uiPaper
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.load(URLRequest(url: appURL, cachePolicy: .returnCacheDataElseLoad))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    private static let nativeShellScript = WKUserScript(
        source: """
        (function(){
          document.documentElement.classList.add('curb-native-ios');
          var css = `
            html.curb-native-ios .top .logo{display:none!important}
            html.curb-native-ios .top{padding-top:calc(10px + env(safe-area-inset-top))!important}
            html.curb-native-ios .barrow{gap:8px!important}
            html.curb-native-ios .fwrap{min-width:0!important}
          `;
          var style = document.createElement('style');
          style.id = 'curb-native-ios-style';
          style.textContent = css;
          (document.head || document.documentElement).appendChild(style);
        })();
        """,
        injectionTime: .atDocumentEnd,
        forMainFrameOnly: true
    )

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        @Binding private var isLoading: Bool

        init(isLoading: Binding<Bool>) {
            _isLoading = isLoading
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            isLoading = false
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
