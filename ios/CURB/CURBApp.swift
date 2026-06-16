import SwiftUI

@main
struct CURBApp: App {
    // APNs device-token callbacks land on UIApplicationDelegate, which a pure-SwiftUI App has no
    // equivalent for — the adaptor bridges them in.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
