# CURB — App Store Connect listing (paste-ready)

**Name:** CURB
**Subtitle** (≤30): `SF street-sweep parking map`
**Category:** Navigation (primary), Utilities (secondary) · **Price:** Free · **Age:** 4+
**Support URL:** https://curb.guide

**Promotional text** (≤170, editable anytime without review):
`About 815,000 SF tickets mapped: on a typical block the posted 2-hour street-cleaning window is really about 20 minutes. See your block's real ticket time. Free.`

**Keywords** (≤100 chars):
```
street cleaning,sweeping,parking,SF,tickets,RPP,meters,reminder,alert,curb,SFMTA,permit,citation
```

## Description
Version 1.0.3 (corrected numbers, 3 Oct 2026). Paste as-is.
```
Your street-cleaning sign says 9 to 11am. The tickets say 9:12am.

CURB is a free map of San Francisco street-parking rules, and the only one that shows you WHEN tickets actually get written, not just when the sign says you're at risk.

I obtained about a million GPS-located SFMTA street-cleaning citations through a public records request and matched about 815,000 of them to the blocks where they were issued (2024 to mid 2026). The finding: that posted 2-hour window is mostly a 20-minute reality. On a typical block, most tickets land within about 20 minutes of each other. Citywide, about 77% are written in the first 45 minutes of the posted window and about 90% in the first hour.

Take the 200 block of Steiner St. Posted window: 9 to 11am. From 2024 to mid 2026: 278 tickets, the earliest at 9:00am, the median at 9:12am, and 90% written by 9:21am. The "2 hours" was never real.

WHAT CURB SHOWS YOU
• Every block colored by its next street sweep. See at a glance where it's safe to park
• When tickets actually get written on your block, rebuilt from public SFMTA citation data
• Residential permit (RPP) zones, meters, and color curb
• ~1,975 unmetered white passenger-loading zones (627 of them by schools) pulled straight from the city's own curb map, the ones DataSF leaves out
• Holiday enforcement flags, like SF suspending daytime street-sweeping enforcement on Juneteenth

MOVE-YOUR-CAR ALERTS
• Pick how hard CURB nags you: a single 30-minute heads-up (Light), plus the night before (Normal), or add a morning-of warning too (Intense)
• Choose the voice: warm and funny, drill-sergeant, or deadpan-with-the-receipts
• Native iOS push, plus a one-tap calendar (.ics) sweep event
• No more "I forgot it was Tuesday"

THE SCALE OF IT
• $105 street-cleaning fine in 2026
• 24M total parking citations in SF since 2008
• Over a million street-cleaning tickets since 2024 alone
• Enforcement is surging where the city is building: Mission Bay and Financial District / South Beach are up the most vs. five years ago

A NOTE ON HONESTY
CURB reads the patterns in public data so you don't have to. But the posted physical sign is always the final authority. CURB never overrides it, and neither should you.

Built by one person in San Francisco who got tired of the parking math.

Free. No ads. No signup. No account. No cookies. If you turn on alerts, CURB stores an anonymous push token with the curb you picked.
```

## What's New (v1.0.4)
Build 9. DRAFT for Alejandro to edit, not final. The only change inside the app is the rating ask: the map, alerts and copy come from curb.guide and update without a release.
```
A small update:

• When you open CURB from a sweep alert, it may ask you to rate it on the App Store. It asks at most once per version, never the first time you open the app, and Not Now closes it.

The posted sign is always the final authority.
```

## What's New (v1.0.3)
Build 8. Paste the block below into App Store Connect as-is.
```
Fresher numbers and steadier alerts:

• Sweep alerts and Calendar stay pinned to the bottom of the block card, and they still work while your block is being swept, so you can arm the next sweep right after you re-park.
• Neighborhood totals now count every ticket by the neighborhood the city records on it, over the last two years.
• If part of the map fails to download, CURB tries again and tells you, instead of leaving a blank map.
• Small fixes across the map and the block pages.

The posted sign is always the final authority.
```

## What's New (v1.0.2)
Build 7. Paste the block below into App Store Connect as-is.
```
Location fixes and a smoother feel:

• Locate works on the first tap. CURB used to give up after 9 seconds while your iPhone was still getting a GPS fix, so only a second tap worked. Now it uses the best fix it has and opens your block once its rules have loaded.
• If Precise Location is off, CURB asks for precise access once. Without it, CURB shows the approximate area instead of guessing the wrong block.
• CURB no longer asks for your location on its own when the app opens. It only asks when you tap locate.
• Block details slide up and expand smoothly, and the screen no longer bounces when you drag.
• Clearer messages when location is off, unavailable or slow, and when sweep alerts couldn't be saved.

The posted sign is always the final authority.
```

## What's New (v1.0.1)
```
Reliability fixes:

- Fixed "locate me" not working on the first try. Tapping the location button now finds you right away — even the very first time you allow location access.
- More reliable sweep-alert setup.

Thanks for the early feedback. The posted sign is always the final authority.
```

## What's New (v1.0)
```
First release.

CURB maps every San Francisco block by its next street sweep — and shows you when tickets actually get written, reconstructed from over a million real SFMTA citations. The posted 2-hour window is mostly a 20-minute reality.

In v1.0:
- Live street-sweeping map, colored by next sweep
- Real ticket-timing for your block
- RPP permit zones, meters, and color curb
- ~1,975 white passenger-loading zones DataSF omits
- Move-your-car alerts you can dial in — Light, Normal, or Intense, in the voice you like — plus native iOS push and one-tap calendar (.ics) events
- Holiday enforcement flags (e.g. Juneteenth daytime suspension)

Free, no account, no data collection. The posted sign is always the final authority.
```

## App Review notes (paste into "Notes")
```
ABOUT THIS APP
CURB is a free public-service tool that maps San Francisco street-parking rules (street sweeping, residential permit zones, meters, color curb, loading zones). It is made by an individual developer (Alejandro Vizio), not a company. There is no monetization — no ads, no in-app purchases, no subscriptions.

DATA SOURCE
All data is public and open: SFMTA street-sweeping schedules and parking-citation records, DataSF, and the City of San Francisco's own ArcGIS curb layer. The "when tickets get written" feature is a statistical analysis of public SFMTA citation data, not private or personal information.

ACCOUNT / LOGIN
There is NO account, login, or sign-up of any kind, and no tracking across apps. The web app inside uses cookieless, aggregate analytics, and optional sweep alerts store an anonymous push token with the block the user picked. The App Privacy answers reflect this. There is no demo account because none is needed — the app is fully usable on launch.

ARCHITECTURE
The iOS app is a WKWebView wrapper of the live website at https://curb.guide. It adds native bridges: Core Location for the "locate me" button, the native share sheet, and native Calendar (.ics) event previews.

PUSH NOTIFICATIONS
Push is used solely for optional "move your car" street-sweeping reminders that the user explicitly opts into per block. Users choose an intensity (Light = 30 min before; Normal = also the night before; Intense = also the morning of) and a copy "voice." A "Send me a test" button sends a single test notification to the user's OWN device only (rate-limited; it cannot target any other device). The app supports both web push and native APNs push. No marketing or promotional notifications are sent. Push has been built and verified end-to-end (test push returned APNs status 200).

LOCATION
Location is used only when the user taps the locate button, to center the map and look up the nearby blocks. CURB's server never stores it.

DISCLAIMER
CURB surfaces patterns in public data as guidance only. The app clearly states that the posted physical street sign is always the final authority.
```

## App Privacy (questionnaire answers)
- **Data collection:** keep what the live label says, "Data Not Linked to You": Precise Location and Device ID (App Functionality), Product Interaction (Analytics). Never "Data Not Collected".
- **Location:** used when the user taps locate; not stored by CURB.
- `PrivacyInfo.xcprivacy` is already in the app.

## Screenshots — 6.7" iPhone shotlist
1. **Full-screen SF map** zoomed to a neighborhood, blocks color-coded by next sweep, locate button visible. → *"Every SF block, colored by its next street sweep."*
2. **Steiner St block card** over the map: posted 9–11am window + the real ticket-timing spike right after 9:00am. → "Posted 9–11am. Median ticket: 9:12am. The 2-hour window is really ~20 minutes."
3. **Stat view** / zoomed-out map with a data panel: ~1M citations, ~90% in first hour, $105 fine. → *"Over a million real tickets, mapped. ~90% land in the first hour."*
4. **Move-your-car alert flow**: sweep schedule with Add-to-Calendar + an iOS push banner preview. → *"Get a calendar event or a push alert before your block is swept."*
5. **Layers view**: RPP shading, meter pins, color curb, white loading zones near a school. → *"Permit zones, meters, color curb, and ~1,975 loading zones the city's data leaves out."*
