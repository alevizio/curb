import Foundation

/// When CURB asks for an App Store rating. Pure rules (Foundation only, so ReviewPrompt.test.mjs can compile
/// and run them outside the app); ReviewPrompt does the UIKit and StoreKit side.
///
/// Owner's call (Oct 2026): ask when someone opens CURB from a real sweep alert, the moment CURB just saved
/// them a ticket. At most once per app version, never on the very first open. Apple caps the system sheet at
/// 3 times a year on top of this and may show nothing at all, so this only decides when to ASK iOS.
enum ReviewPolicy {
    /// Every real sweep alert's `tag` starts with this (lib/notify-core.js TAGS: curb-sweep, curb-sweep-eve,
    /// curb-sweep-morn). Test pushes are tagged curb-test / curb-test-<key>, so an allowlist on the tag holds
    /// even if test titles change.
    static let sweepAlertTagPrefix = "curb-sweep"
    /// Second guard: "Send me a test" pushes are titled "Test · <which alert> (<when it really fires>)".
    static let testTitlePrefix = "Test ·"

    /// True only for a real sweep alert: the payload's `tag` and the notification's title as the cron sends them.
    static func isSweepAlert(tag: String?, title: String?) -> Bool {
        guard let tag, tag.hasPrefix(sweepAlertTagPrefix) else { return false }
        return !(title ?? "").hasPrefix(testTitlePrefix)
    }

    /// Ask now? `opens` counts every open of CURB including this one (the very first open is 1);
    /// `askedVersion` is the app version CURB last asked in, nil if never.
    static func shouldAsk(opens: Int, askedVersion: String?, version: String) -> Bool {
        opens > 1 && !version.isEmpty && askedVersion != version
    }

    /// Counts opens: one per stay in the foreground. iOS signals the same stay more than once (a scene-based
    /// app also posts willEnterForeground during the cold launch, which made one first launch count as 2),
    /// so only a trip through the background starts a new open.
    struct Opens {
        private(set) var count: Int
        private var counted = false
        init(count: Int) { self.count = count }
        mutating func enteredForeground() {
            guard !counted else { return }
            counted = true
            count += 1
        }
        mutating func enteredBackground() { counted = false }
    }
}
