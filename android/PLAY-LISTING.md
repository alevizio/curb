# CURB on Google Play (paste-ready)

The Android app is a Trusted Web Activity of curb.guide (package `guide.curb.android`, built with Bubblewrap from
`twa-manifest.json`). The map, alerts and copy come from the site, so they update without a release.

**App name** (30 max): `CURB: SF Street Sweeping Map`
**Short description** (80 max): `Every SF curb colored by its next sweep, and when tickets really get written.`
**Category:** Maps & Navigation · **Price:** Free · **Contains ads:** No · **In-app purchases:** No
**Website:** https://curb.guide · **Email:** hello@curb.guide · **Privacy policy:** https://curb.guide/privacy

**Graphics** (in `play/`): app icon `icon-512.png` (512 x 512), feature graphic `feature-graphic.jpg` (1024 x 500),
phone screenshots `screenshot-1.png` to `screenshot-3.png` (1080 x 1920, 9:16 as Play requires; real screens from the app on the emulator, demo mode status bar).

## Full description (4000 max)
```
Your street cleaning sign says 9 to 11am. The tickets say 9:12am.

CURB is a free map of San Francisco street parking rules, and the only one that shows you WHEN tickets actually get written, not just when the sign says you're at risk.

I obtained about 1.35 million GPS located SFMTA street cleaning citations through a public records request and matched over a million of them to the blocks where they were issued (2024 to mid 2026). The finding: that posted 2 hour window is mostly a 20 minute reality.

Take the 200 block of Steiner St. Posted window: 9 to 11am. From 2024 to mid 2026: 278 tickets, the earliest at 9:00am, the median at 9:12am, and 90% written by 9:21am.

WHAT CURB SHOWS YOU
• Every block colored by its next street sweep. See at a glance where it's safe to park
• When tickets actually get written on your block, rebuilt from public SFMTA citation data
• Residential permit (RPP) zones, meters and color curb
• About 1,975 unmetered white passenger loading zones (627 of them by schools) from the city's own curb map
• Holiday enforcement flags

MOVE YOUR CAR ALERTS
• Pick how hard CURB nags you: a single 30 minute heads up (Light), plus the night before (Normal), or a morning of warning too (Intense)
• Choose the voice: warm and funny, drill sergeant, or deadpan with the receipts
• Push alerts on your phone, plus a one tap calendar event
• No more "I forgot it was Tuesday"

A NOTE ON HONESTY
CURB reads the patterns in public data so you don't have to. But the posted physical sign is always the final authority. CURB never overrides it, and neither should you.

CURB is independent and not affiliated with the City and County of San Francisco or the SFMTA. Its data comes from DataSF and SFMTA public records.

Built by one person in San Francisco who got tired of the parking math.

Free. No ads. No signup. No account. No cookies. If you turn on alerts, CURB stores an anonymous push subscription with the curb you picked.
```

## Release notes (first release)
```
CURB is on Android: every San Francisco curb colored by its next sweep, when tickets really land, and move your car alerts. The posted sign is always the final authority.
```

## App content answers (Play Console > Policy > App content)
- **Privacy policy:** https://curb.guide/privacy
- **App access:** all functionality is available without special access (no login).
- **Ads:** no ads.
- **Content rating:** questionnaire category "All other app types"; no violence, sexual content, profanity, drugs, gambling or user interaction (no chat, no user content shared). Expected rating: Everyone.
- **Target audience:** 18 and over (it's for drivers). Not designed for children.
- **News app:** no. **Government app:** no (independent; the description says so and names the sources). **Financial features:** none. **Health:** none.
- **Data safety** (owner's picks, 20-Oct-2026): collects data, nothing shared, all encrypted in transit, no accounts.
  - *Location, precise* (optional, app functionality, not ephemeral): the block you set an alert for, kept with the alert, plus the area the map loads after you tap locate. The locate fix itself never leaves the phone.
  - *Device or other IDs* (optional, app functionality): the anonymous push subscription, only if alerts are on.
  - *App activity, other actions* (optional, app functionality): the alert settings picked (intensity, voice).
  - *App activity, in-app search history* (optional, app functionality): a typed street or address goes to DataSF to find it (CURB never stores it).
  - *App activity, app interactions* (required, analytics): cookieless aggregate page views and feature counts.
  - *App info and performance, crash logs and diagnostics* (required, analytics): anonymous error reports (message, page, coarse device type).
  - Deletion: yes, link https://curb.guide/privacy (its "Remove it any time" paragraph). Turn off on an alert removes the block and sweep time at once (from 20-Oct-2026 a turned-off watch keeps only unreadable keys, `offKeys` in api/_store.js); the anonymous push endpoint stays, with nothing to send, as /privacy says.
  - Not collected: name, email, contacts, photos, financial data.

## Signing and the site link
- Play App Signing (Google keeps the app signing key). Upload key: `../private/android/curb-upload.keystore`, alias `upload`, password in the macOS Keychain item "CURB Android upload keystore". Never commit it.
- `/.well-known/assetlinks.json` on curb.guide vouches for the upload key. After the first upload, copy the **app signing key SHA-256** from Play Console > Test and release > App integrity and add it there, or the Play-installed app shows a browser bar.

## Build
`bubblewrap update --skipVersionUpgrade && bubblewrap build` (BUBBLEWRAP_KEYSTORE_PASSWORD and BUBBLEWRAP_KEY_PASSWORD from the Keychain item). Raise `appVersionCode` for every upload (`bubblewrap update` does it without the flag).
