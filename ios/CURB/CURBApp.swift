import SwiftUI

@main
struct CURBApp: App {
    @StateObject private var model = CurbViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}
