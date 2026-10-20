# CURB on Google Play (paste-ready)

The Android app is a Trusted Web Activity of curb.guide (package `guide.curb.android`, built with Bubblewrap from
`twa-manifest.json`). The map, alerts and copy come from the site, so they update without a release.

**App name** (30 max): `CURB: SF Street Sweeping Map`
**Short description** (80 max): `Every SF curb colored by its next sweep, and when tickets really get written.`
**Category:** Maps & Navigation · **Price:** Free · **Contains ads:** No · **In-app purchases:** No
**Website:** https://curb.guide · **Email:** hello@curb.guide · **Privacy policy:** https://curb.guide/privacy

**Graphics** (in `play/`): app icon `icon-512.png` (512 x 512), feature graphic `feature-graphic.jpg` (1024 x 500),
phone screenshots `screenshot-1.png` to `screenshot-3.png` (1080 x 2160, real screens from the app).

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
- **Data safety:**
  - Collected, not shared, encrypted in transit, optional: *Device or other IDs* (the anonymous push subscription, only if alerts are on; purpose: app functionality) and *App activity, other actions* (the block and sweep time picked for an alert; app functionality). Users can delete it: Turn off on the alert removes the block and time.
  - Collected, not shared, required: *App info and performance, crash logs and diagnostics* (anonymous error reports: message, page, coarse device type; purpose: analytics) and *App activity, app interactions* (cookieless aggregate page views and feature counts; analytics).
  - Not collected: location (the locate button uses it on the phone only), name, email, contacts, photos, financial data.

## Signing and the site link
- Play App Signing (Google keeps the app signing key). Upload key: `../private/android/curb-upload.keystore`, alias `upload`, password in the macOS Keychain item "CURB Android upload keystore". Never commit it.
- `/.well-known/assetlinks.json` on curb.guide vouches for the upload key. After the first upload, copy the **app signing key SHA-256** from Play Console > Test and release > App integrity and add it there, or the Play-installed app shows a browser bar.

## Build
`bubblewrap update --skipVersionUpgrade && bubblewrap build` (BUBBLEWRAP_KEYSTORE_PASSWORD and BUBBLEWRAP_KEY_PASSWORD from the Keychain item). Raise `appVersionCode` for every upload (`bubblewrap update` does it without the flag).
