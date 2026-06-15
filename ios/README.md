# CURB iOS

Native iPhone wrapper for CURB's San Francisco curb-rules experience.

The iOS target intentionally loads the production CURB web app at `https://curb.guide`
inside `WKWebView`. That keeps the App Store app visually identical to the web/PWA
experience: same Leaflet map, same search, same bottom sheet, same layers, same copy.

## What is included

- SwiftUI app shell.
- `WKWebView` loading `https://curb.guide`.
- Native Core Location bridge for the web UI's locate button.
- Native loading/error states.
- External handoff for Google/Apple links that should leave the app.
- Existing iOS privacy strings for location/calendar prompts used by the web UI.

## Open locally

```bash
open ios/CURB.xcodeproj
```

Then set your Apple Developer Team and a final bundle identifier under the CURB target's Signing & Capabilities tab.

## App Store setup checklist

- Replace `guide.curb.ios` with the bundle ID registered in Apple Developer.
- Set the signing team.
- Review App Privacy answers in App Store Connect. The app displays `curb.guide`; location is used only when the user asks the map to locate them. CURB does not sell or track users.
- Archive from Xcode and upload through Organizer.

The app intentionally does not claim live parking availability; SF's live space sensors are gone, so the posted sign remains the source of truth.
