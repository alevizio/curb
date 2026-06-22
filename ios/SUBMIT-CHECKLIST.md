# CURB iOS — Archive → TestFlight → App Store submit

App: **CURB** · Bundle `guide.curb.ios` · Team `69K2S3664V` · v **1.0** build **1**
(Metadata copy — subtitle/description/keywords/what's-new/review notes — comes from the App Store kit.)

## 0 · Pre-flight (should already be true)
- [x] Push Notifications capability on the target → `CURB/CURB.entitlements` has `aps-environment` (built + verified).
- [x] Vercel APNs env vars set: `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID=69K2S3664V`, `APNS_BUNDLE_ID=guide.curb.ios`.
- [ ] Apple Developer Program membership **active** (enrollment must be finished).
- [ ] `ContentView.swift` changes saved (they ride the archive — intentionally uncommitted in git).

## A · Archive in Xcode
1. Open `ios/CURB.xcodeproj`.
2. Target **CURB → General**: Version `1.0`, Build `1` (bump Build on every re-upload). **Signing & Capabilities**: Team `69K2S3664V`, Automatic signing, Push Notifications capability present.
3. Destination dropdown → **Any iOS Device (arm64)** (not a simulator).
4. **Product → Archive**.
5. Organizer opens → select the archive → **Validate App** → App Store Connect → Automatic signing → Validate. Fix anything it flags (usually icon or entitlement).
6. ⚠️ **APNs production check (the #1 footgun):** Organizer → right-click archive → *Show in Finder* → *Show Package Contents* → `Products/Applications/CURB.app` → check the embedded entitlements show **`aps-environment` = `production`** (Xcode auto-promotes on archive). If it says `development`, TestFlight/App Store push tokens will return **400 BadDeviceToken**.

## B · Create the app record in App Store Connect (skip if it exists)
- appstoreconnect.com → **Apps → +  → New App**: iOS · Name **CURB** · English (U.S.) · Bundle ID `guide.curb.ios` · SKU `curb-ios-1` · Full Access.

## C · Upload the build
7. Organizer → **Distribute App → App Store Connect → Upload** → Automatic signing → Upload. Processing takes ~5–15 min (you'll get an email when the build is ready).

## D · Fill the 1.0 listing (paste from the App Store kit)
8. Subtitle · Promotional Text · Description · Keywords · What's New.
9. **Support URL** `https://curb.guide` · Marketing URL optional.
10. **Screenshots**: upload the 6.7" iPhone set from the shotlist (at least one size required; 6.7" satisfies it).
11. **App Privacy** questionnaire: CURB has **no account, no tracking, no data collection**. Location is used only on-device for "locate me" (not collected/linked). Answer accordingly → "Data Not Collected" where true. (`PrivacyInfo.xcprivacy` is already in the app.)
12. **Age rating** → 4+.
13. **Pricing** → Free.
14. **Category** → Navigation (primary), Utilities (secondary).
15. Under **Build**, select the processed build.

## E · TestFlight first (strongly recommended)
- TestFlight tab → the build → install on your iPhone → verify: map loads, **locate**, **share**, **calendar (.ics)**, and a **real push** — arm an alert on a due-window block and confirm APNs delivery against the **production** host. This is the most failure-prone step (sandbox vs production token mismatch).

## F · Submit for review
16. 1.0 page → **Add for Review**:
   - Export Compliance: uses only standard HTTPS → "uses encryption" = exempt (standard).
   - Advertising Identifier (IDFA): **No**.
17. **App Review notes** → paste from the kit (free public tool over public DataSF data; web/APNs push only for sweep reminders; no login/account; WKWebView of curb.guide). No demo account needed.
18. **Submit**. Review is typically 24–48h.

— Web Push + the live site are unaffected throughout; this is purely additive.
