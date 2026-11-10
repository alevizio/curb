# CURB — App Store Connect listing (paste-ready)

**Name** (≤30): `CURB: Street Parking Map` (Ale's pick, 1 Nov 2026, live with 1.0.6; was `CURB: SF Street Parking`)
**Subtitle** (≤30): `Sweeping alerts for 25 cities` (was `SF street-sweep parking map`). 25 = SF plus the 24 public city maps, never Boston or Somerville
**Category:** Navigation (primary), Utilities (secondary) · **Price:** Free · **Age:** 4+
**Support URL:** https://curb.guide

**Promotional text** (≤170, editable anytime without review):
`New look, more map. Search in one pill, the answer first on every block card, and one map for 25 cities.` (the owner's pick, set 10 Nov 2026 with 1.0.7; was `New: CURB saves where you park by itself and puts a little car on that curb, so you know when to move it. Pick your car, or share where you parked.`, set 1 Nov 2026)

**Keywords** (≤100 chars; words already in the name and subtitle left out, since Apple joins them):
```
cleaning,SF,tickets,reminder,citation,permit,los angeles,oakland,nyc,chicago,toronto,alternate side
```

## Description
Saved in App Store Connect on 1 Nov 2026 with 1.0.6 (the 13 Oct full records file text plus the MORE CITIES section).
```
Your street-cleaning sign says 9 to 11am. The tickets say 9:12am.

CURB is a free map of San Francisco street-parking rules, and the only one that shows you WHEN tickets actually get written, not just when the sign says you're at risk.

I obtained about 1.35 million GPS-located SFMTA street-cleaning citations through a public records request and matched over a million of them to the blocks where they were issued (2024 to mid 2026). The finding: that posted 2-hour window is mostly a 20-minute reality. On a typical block, most tickets land within about 20 minutes of each other. Citywide, about 77% are written in the first 45 minutes of the posted window and about 90% in the first hour.

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

MORE CITIES
CURB now maps 24 more cities block by block, from each city's open data, with alerts before the rule starts:
• Oakland, Berkeley, San Jose, Sacramento, Los Angeles, Unincorporated LA County, Santa Monica, Glendale, Riverside, San Diego, Denver, Saint Paul and Norfolk: street sweeping
• New York City and Hoboken: alternate side parking
• Philadelphia, Pittsburgh, Paterson, Washington DC and Montréal (in French or English): street cleaning
• Chicago and Madison: street sweeping and winter rules
• Milwaukee: night parking and winter rules
• Toronto: winter parking
Zoom out and tap a city pin, or open Cities in the ⓘ menu.

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

## What's New (v1.0.7)
Build 12 (Xcode Cloud 64). Submitted 10 Nov 2026, about 11:48 AM PT, releasing automatically to everyone once
approved (the owner's pick). Nothing changed inside the app: the version exists to carry new screenshots, which App Store Connect only
takes with a new version. The map first layout they show (search pill, bottom bar, facts card, car pill) comes from
curb.guide and is already in 1.0.6. The set is ten shots in the 6.5" slot (1242 x 2688): the eight headlines of 1.0.6
on new captures, with 8 ("ONE MAP. 25 CITIES.") now a map of the US with a dot per city, then a steep block and a
permit area. Files and tools are in private/store-screenshots-2026-11-09/. Headlines 9 and 10 (the owner's picks,
9 Nov 2026): "SF HILLS · $48 TICKET / CURB YOUR WHEELS" and "PERMIT AREAS / FIND YOUR PERMIT AREA". The text below
is the owner's pick of the same day. In App Store Connect since 10 Nov 2026: the version, the ten shots in order,
build 64, this text and the new promotional text. Shots 1, 5 and 6 went up as JPEG copies of the same pictures
(private/store-screenshots-2026-11-09/appstore-jpg/): Media Manager left their PNGs on "processing" for good. When
an upload sticks there, remove it and upload again one file at a time, or as a JPEG; files that did process can be
added back from Browse Assets.
```
A new look, with more map.

• Search sits in one pill at the top.
• A bottom bar holds the legend, the day filter and today's date.
• The block card opens with the answer first: when it sweeps, how long you have, when tickets land.
• Your car gets its own pill with the time to move it.
• On steep San Francisco blocks, a reminder to curb your wheels.
• One map for 25 cities.
```

## What's New (v1.0.6)
Build 11 (Xcode Cloud 63). Submitted 29 Oct 2026 with manual release; on 1 Nov Ale switched it to release automatically once approved. Rejected 1 Nov
under 2.3.7 for "FREE." in screenshot 4 (never say free in screenshots); label changed to "NO SIGNUP." and resubmitted
the same day. The text below was saved in App Store Connect on 1 Nov while Waiting for Review, adding the web changes
the app already shows (the car, Share where I parked, the car picker, curbs apart when zoomed out), then the 25 cities line.
Screenshots 7 ("YOUR CAR, ON ITS CURB.") and 8 ("ONE MAP. 25 CITIES.", the New York map) were made 1 Nov in the set's style on screenshot 4 as the template; the files are in private/appstore-screenshots-2026-11-01/. Inside the app: two
App Intents, Save Parking Spot and Clear Parking Spot (ios/CURB/Parking.swift), and the bridge the Sweep alerts screen
uses to set them up and show the saved spot. The screen itself comes from curb.guide; its auto-park section shows only
in builds that have the bridge. Approved 3 Nov 2026 at 19:39 UTC and released automatically: the App Store lookup lists
1.0.6 with that release time.
```
Auto-save where you park, and your car on the map:

• New Shortcuts actions: Save Parking Spot and Clear Parking Spot. Run them when your car's CarPlay or Bluetooth disconnects and connects, and CURB saves the block you parked on and turns on its sweep alerts by itself.
• Set it up in the ⓘ menu, Sweep alerts, Auto-save where you park. San Francisco for now.
• The saved spot shows there too, with its next sweep, Show on map and Clear.
• A little car sits on the curb where you parked. Tap that curb to pick yours: red car, pickup, van, taxi, convertible, sports car or surf wagon.
• Share where I parked, on every curb: it sends the side, the next sweep and a link that opens the map with the car on it. Handy when you park someone else's car.
• Zoomed out, both sides of a street now show as two lines, so you can tell them apart.
• Now in 25 cities, from Oakland and Los Angeles to New York, Chicago, Toronto and Montréal. Zoom out and tap a city pin, or open Cities in the ⓘ menu.

The posted sign is always the final authority.
```

## What's New (v1.0.5)
Build 10 (Xcode Cloud 61). Submitted to App Review word for word on 11 Oct 2026, automatic release. Inside the app: the move-your-car alerts are Time Sensitive (the
entitlement; the server marks the 30 min and "move it tonight" pushes) and the Sweep alerts screen can open CURB's
notification settings. The Sweep alerts screen itself comes from curb.guide and is already live for every version.
```
Alerts you can count on:

• The alerts that tell you to move your car are now Time Sensitive, so they can get through a Focus like Sleep or Do Not Disturb.
• The new Sweep alerts screen in the ⓘ menu shows every curb you watch and when each alert comes, and turns them off in one tap.
• If notifications are off for CURB, the screen tells you and opens Settings for you.

The posted sign is always the final authority.
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
Location is used only when the user taps the locate button, to center the map and look up the nearby blocks, or when the user's own Save Parking Spot automation runs (below), to find the block they parked on. CURB's server never stores it.

DISCLAIMER
CURB surfaces patterns in public data as guidance only. The app clearly states that the posted physical street sign is always the final authority.

TIME SENSITIVE (new in 1.0.5)
Only the reminders that ask the user to move the car now are marked Time Sensitive: the one 30 minutes before the sweep, and the evening one before an early-morning sweep. The night-before and morning reminders stay at the normal level. Users can turn Time Sensitive off for CURB in iOS Settings, as for any app.

AUTO-SAVE WHERE YOU PARK (new in 1.0.6)
Two optional Shortcuts actions (App Intents): Save Parking Spot and Clear Parking Spot. Nothing runs on its own: the user makes an automation in the Shortcuts app (CarPlay, or a Bluetooth device, Disconnects / Connects) that runs them. Save Parking Spot sends the parked location once to curb.guide, which finds the nearest swept block in San Francisco and turns on that block's sweep reminders for this device's push token; it keeps the block, never the coordinates. Clear Parking Spot turns those reminders off. Outside San Francisco the action says so and saves nothing. To try it anywhere: in Shortcuts, add the CURB action Save Parking Spot to a new shortcut, set its Location to "Valencia St and 20th St, San Francisco", and run it. A "Parked" notification names the block and its next sweep, and the spot shows in the app under ⓘ, Sweep alerts.
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
