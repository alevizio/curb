import StoreKit
import UIKit
import os

/// Asks iOS for the App Store rating sheet when ReviewPolicy says the moment is right: a few seconds after
/// the page a sweep alert opened has loaded, on the active window scene, and only when nothing else is up
/// (no share sheet, no calendar preview, no system permission prompt). One try per alert tap; a try that
/// finds the screen busy is dropped without counting, so the next alert tap gets another one.
/// Main-actor: AppDelegate and the web view's navigation delegate call it on the main thread.
@MainActor
final class ReviewPrompt {
    static let shared = ReviewPrompt()
    private init() {
        opens = ReviewPolicy.Opens(count: UserDefaults.standard.integer(forKey: Self.opensKey))
    }

    private static let opensKey = "curbReviewOpens"
    private static let askedVersionKey = "curbReviewAskedVersion"
    /// Let the block's page settle, and be read, before the rating sheet slides up over it.
    private static let settle: Duration = .seconds(3)
    /// The moment passes: a page still loading this long after the tap no longer gets the ask.
    private static let freshFor: TimeInterval = 60

    private let defaults = UserDefaults.standard
    private let log = Logger(subsystem: "guide.curb.ios", category: "review")
    private var opens: ReviewPolicy.Opens
    private var armedAt: Date?     // when a sweep alert was tapped; nil once its one try is used
    private var pending: Task<Void, Never>?

    /// CURB is in the foreground: the cold launch, or a return from the background.
    func enteredForeground() {
        opens.enteredForeground()
        defaults.set(opens.count, forKey: Self.opensKey)
    }

    /// CURB went to the background, so the next foreground is a new open.
    func enteredBackground() { opens.enteredBackground() }

    /// A notification was tapped and CURB is about to load its page. Only a real sweep alert arms the ask.
    func notificationTapped(tag: String?, title: String?) {
        pending?.cancel()
        pending = nil
        armedAt = ReviewPolicy.isSweepAlert(tag: tag, title: title) ? Date() : nil
        if armedAt == nil { log.info("review: tapped push is not a sweep alert") }
    }

    /// The web view started another page: wait for that one instead.
    func pageStarted() {
        pending?.cancel()
        pending = nil
    }

    /// The web view finished a page. After a sweep alert tap, ask once it has settled.
    func pageFinished() {
        guard let armedAt else { return }
        guard Date().timeIntervalSince(armedAt) < Self.freshFor else {
            self.armedAt = nil
            return
        }
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(for: Self.settle)
            guard !Task.isCancelled else { return }
            self?.askIfStillRight()
        }
    }

    private func askIfStillRight() {
        pending = nil
        armedAt = nil   // one try per alert tap
        let count = opens.count
        let asked = defaults.string(forKey: Self.askedVersionKey)
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        guard ReviewPolicy.shouldAsk(opens: count, askedVersion: asked, version: version) else {
            log.info("review: not asking (open \(count), asked in \(asked ?? "none", privacy: .public), now \(version, privacy: .public))")
            return
        }
        guard let scene = Self.activeScene(), scene.keyWindow?.rootViewController?.presentedViewController == nil else {
            log.info("review: something is on screen, skipping this alert")
            return
        }
        defaults.set(version, forKey: Self.askedVersionKey)
        log.info("review: asking iOS for the rating sheet (open \(count), \(version, privacy: .public))")
        AppStore.requestReview(in: scene)
    }

    /// The scene the person is looking at. A system prompt (notification or location permission, precise
    /// location) or the app switcher makes the app inactive, so this is nil while one is up.
    private static func activeScene() -> UIWindowScene? {
        guard UIApplication.shared.applicationState == .active else { return nil }
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }
}
