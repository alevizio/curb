# CURB iOS

Native iPhone app for CURB's San Francisco curb-rules experience.

## What is included

- SwiftUI shell with a MapKit map.
- Live DataSF street-sweeping fetches for the visible viewport.
- CURB's curb-side offset logic, next-sweep calculation, SF timezone handling, and holiday suspension table.
- Tap/search/location flows to select the nearest curb.
- Native bottom sheet with the active curb, other side, metered/RPP hints, share link, local notification alerts, and EventKit calendar reminders.

## Open locally

```bash
open ios/CURB.xcodeproj
```

Then set your Apple Developer Team and a final bundle identifier under the CURB target's Signing & Capabilities tab.

## App Store setup checklist

- Replace `guide.curb.ios` with the bundle ID registered in Apple Developer.
- Set the signing team.
- Review App Privacy answers in App Store Connect. This app uses location only on device to find nearby curb rules, stores one local alert key in `UserDefaults`, and does not sell or track users.
- Archive from Xcode and upload through Organizer.

The app intentionally does not claim live parking availability; SF's live space sensors are gone, so the posted sign remains the source of truth.
