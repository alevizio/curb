# CURB Competitive Landscape — Launch Brief (verified June 12, 2026)

## 1. Landscape Table (verified alive as of 2026-06-12)

| Competitor | What it is | Platform | Pricing | Traction (verified) | SF sweeping coverage | Status |
|---|---|---|---|---|---|---|
| **SpotAngels** | Community parking map + move-your-car reminders; owns "SF street cleaning map" SERP with June-2026-stamped free web map | iOS/Android/web | Freemium; Plus IAP $2.99–$49.99; web map free/no-account, ad-supported | iOS 4.73 stars, 12,467 ratings; 38 Reddit mentions since Jun 2024 (most of any app); iOS app last updated **Jan 15, 2025 (~17 mo stale)**, web page current | Yes — citywide schedule-based hours + 2026 holiday calendar; quotes stale $73 fine; no real ticket times | Active (web fresh, app stale) |
| **Ticketless+** (Abdullah Zahid) | Free SF-only iOS app: auto-detects parking, warns before sweeping/meters/time limits/tow-away/construction; RPP added Apr 30, 2026. No account, no ads, no tracking | iOS only | Free (verified iTunes API) | 4.71 stars, **14 ratings** — very early; v1.1.0 Apr 30, 2026, actively developed | Yes — closest positioning twin; official schedule data, no citation-derived times, no white zones, no web/Android | Active |
| **Sweep Alarm** (Jorn van Dijk) | SF-only street cleaning alarm: check nearby schedules, set per-park alarm, 3 escalating notifications | iOS + Android | Free | iOS 4.47 stars, 78 ratings; **updated Jun 4, 2026** (alive); Android updated May 8, 2026 | Yes — schedule-based, manual per-park alarm; reviews say "always double-check the sign"; no RPP/meters/citation data | Active |
| **SF Street Cleaning Map** (kaushalpartani) | Free open-source web map: street schedule + add-to-calendar links, DataSF data, GPL-3.0 | Web | Free, no account | 9 GitHub stars; repo pushed 2026-06-12 (maintained) | Yes — schedule + calendar export only; no push, permits, meters, colors; thin DataSF pass-through with documented data-quality fragility | Active |
| **Xtreet** | Web SF parking guide: per-block sweep schedules, calendar, email reminders (24h–1h), 31 RPP zones, curb colors, meters | Web (iOS app pulled — 404) | Free; free account required for email alerts; no paid tier exists | 10 Reddit mentions; no ratings/press; API serves correct June 2026 data but © 2015 template, jQuery 3.1.1, email alerts land in spam | Yes — broadest paper overlap with CURB, schedule-based only | Live but unmaintained-looking |
| **Street Cleaning Parking** (Felgueres) | SF iOS reminder app, Dec 2023 Reddit launch | iOS | Subscription required: $3.99/mo or $14.99/yr | **2.42 stars, 24 ratings**; last update Jun 21, 2025 (~12 mo stale); reviews cite missing notifications, wrong-side data | Yes, weakly — DataSF schedules, wrong-side-of-street bugs | Stale |
| **SF Public Works / DataSF official lookup** | City's address/map sweeping lookup + 2026 calendar PDF; CURB's upstream | Web | Free | System of record; dataset rows last updated 2026-05-14 with live "undergoing maintenance" banner | Authoritative schedules; no countdown, alerts, ticket times; clunky GIS UX; ~zero organic Reddit recommendations | Active |
| **SFMTA Text Before Tow** | Free SMS before tow — covers only 72-hr, blocked driveway, construction, special events. **Explicitly excludes sweeping**; texts can arrive 5 min before the truck | SMS | Free | Official; misrecommended on Reddit as a sweeping fix | None | Active |
| **ParkMobile + HotSpot** | The two official SFMTA meter apps since PayByPhone's mid-May 2026 phase-out; paid-session expiry reminders only | iOS/Android | Free + $0.35/transaction | ParkMobile 4.76 stars/1.33M ratings; HotSpot 4.23/350 | None — reminders fire only on paid meter sessions; zero coverage of free/RPP blocks where sweeping tickets happen | Active |
| **Google Maps / Apple Maps / Waze** | Rule-blind parking pins (48h Google pin; Bluetooth-disconnect Apple marker + iOS 27 widget; Waze lots/garages only). Mar 2026 Ask Maps adds "where to park" hints, zero curb-rule awareness | All | Free | Default for everyone | None — verified zero sweep/curb/RPP/move-car content in docs and 2026 announcements | Active |
| **SpotHero / ParkWhiz** | Off-street reservation marketplaces (SF garages $17–40 weekend, ~$340/mo) | All | Pay per booking | SpotHero 4.86/390k; ParkWhiz 4.81/188k | None — compete for the "give up on street parking" moment | Active |
| **INRIX** (B2B) | Holds/maintains SFMTA's digital curb inventory (SMART grant, CDS); sells driver-facing curb rules to OEMs/map platforms; consumer ParkMe dying (2.2 stars, pulled from Play Store) | B2B | Enterprise | 48M spaces/22k cities (Jun 4, 2026 PR) | Deepest raw data, no consumer surface; threat is rules surfacing in Google/Apple Maps in 1–2 yrs | Active |
| **Dead/defunct** | Find My Parking Cops (SFMTA-killed in 4 hrs, Sept 2025, frozen memorial), SweepMap (CapRover placeholder), sfstreetcleaningmap.com (DNS dead), Coord (absorbed into Google 2022), Lacuna (shut 2023), Vade (DNS gone), audiodude's map (1-day project), SFpark (legacy artifact) | — | — | — | — | Dead/stale |

## 2. Honest Threat Ranking — "don't get a sweeping ticket in SF"

1. **DIY calendar/alarm/Siri (no app)** — the real incumbent. ~49% of answers in the canonical AskSF thread. Free, already installed, "good enough" until it isn't.
2. **SpotAngels** — only competitor with brand recognition, SERP dominance, automatic move-your-car alerts, and SF holiday data. Weaknesses: paywalled features, reliability complaints, app stale since Jan 2025, schedule-based only.
3. **Ticketless+** — the positioning twin (free, no-account, privacy-first, SF-only, RPP, auto park detection) with one feature CURB lacks (background auto-detect). Tiny (14 ratings) but actively shipped this quarter. Most dangerous on a 12-month horizon.
4. **Sweep Alarm** — small, loved, alive (updated this month), but manual-alarm UX and no curb/RPP/citation depth.
5. **kaushalpartani's map / Xtreet** — free-web SERP occupants; thin or decaying. SEO competitors more than product competitors.
6. **Adjacent, not competing**: official city tools (data, no product), ParkMobile/HotSpot (paid meters only), Google/Apple/Waze (rule-blind pins), SpotHero/ParkWhiz (off-street), INRIX/Populus/Automotus (sell to the cities that issue tickets — zero incentive to ship this).
7. **Watch list**: INRIX curb rules landing inside Google/Apple Maps (1–2 yrs out, optimizes "can I park now" not "wake me Tuesday 7:38am"); Gemini-in-car sign reading (demo phase, production unconfirmed).

## 3. CURB's Defensible Differences — and fastest copier of each

| Differentiator | Defensibility | Fastest copier |
|---|---|---|
| **REAL ticket times per block (650k citations)** | Strongest moat. Nobody upstream has it — INRIX/SFMTA publish scheduled rules, not enforcement reality. Requires the citation-reconstruction pipeline, not just DataSF. Directly answers the universal review complaint "always double-check the sign" and the Reddit outrage "ticketed at 2:14AM, sign says 2–6am" | SpotAngels (data team, could replicate in months if they noticed); Ticketless+ (solo dev, slower) |
| **The 22-minute finding** (headline stat from that data) | A story, not a feature — own it at launch before anyone can. Citable, press-ready, AI-engine-quotable | Anyone can cite it once published; only CURB can generate the next one |
| **Free / no-account / open-source** | Matches r/sanfrancisco values exactly (community is hostile to paywalls); SpotAngels structurally can't follow (freemium business), Ticketless+ already matches free/no-account but is closed-source | Ticketless+ (already 2 of 3) |
| **White school zones + unmetered loading zones** | Nobody covers these — verified gap across all lenses | Ticketless+ or SpotAngels via the SFMTA CDS curb inventory (public data, weeks of work once motivated) |
| **Web/PWA + Web Push (no install, Android reach)** | Ticketless+ is iOS-only; SpotAngels' web map has no alerts; answers the verified Android demand ("I'd pay $20 today if there was an android version") | SpotAngels (has web infra); kaushalpartani (open-source web, but no push today) |
| **Everything-on-one-map (sweep + RPP + meters + colors)** | Only Xtreet attempts it and it's rotting | SpotAngels |

Regulatory note: Find My Parking Cops proved both the demand (~1M impressions in 4 hours) and the risk (SFMTA killed it in 4 hours). CURB uses historical bulk open data, aggregated, no officer info — have that defense written down before launch day.

## 4. What Competitors Do BETTER Than CURB Today (steal these)

- **Automatic park detection** (Ticketless+, SpotAngels via Bluetooth disconnect): no manual "I parked here" step. The DIY failure mode is "it depends on where I parked" — auto-detection kills it completely; tap-to-pin only mostly kills it.
- **Holiday/suspension calendar** (SpotAngels): next suspensions Jul 3–4, Sep 7, Oct 12, Nov 11, Nov 26–27, 2026. Cheap to add, high trust value ("is sweeping enforced on Christmas?" is a recurring confusion).
- **Escalating multi-stage alerts** (Sweep Alarm's 3 notifications): one Web Push is missable; night-before + morning-of + 30-min-out is the proven pattern.
- **Add-to-calendar export** (kaushalpartani): meets the DIY-calendar majority where they already live; trivial to ship.
- **Share car location with partner** (Street Cleaning Parking): the "text your partner a pin" social hack, productized.
- **Native app store presence**: PWA install friction is real; "Add to Home Screen" needs first-run onboarding, and iOS Web Push requires the PWA to be installed — design for that explicitly.
- **SEO neighborhood pages** (Xtreet, SpotAngels): they own "[neighborhood] street cleaning schedule" queries with stale pages — beatable, but CURB has zero pages today.

## 5. The Substitute Insight — the no-app default to beat

The enemy is **a recurring calendar event and a phone alarm**, plus "just read the sign." In users' own words, where it breaks:

- "It doesn't really help me to have a repeating reminder, since it depends on where I parked." (parking on a different street each time)
- "Forget if it's 1st/3rd or 2nd/4th and walk outside to double check... every single week" / "is tomorrow the 3rd or 4th Monday of the month?" (week-of-month math)
- Two sides of the street, two schedules — two calendar events per block.
- Holidays: nobody knows when sweeping is suspended.
- "I got a ticket literally this morning." The cost of failure is now **$105** per ticket (FY26 SFMTA fine, effective Jul 2025 — not the $73/$93/$97 still quoted around the web; CURB should cite $105).
- Expect the launch-thread pushback verbatim: "So just... read the sign?" / "basically an alarm clock?" Preempt it: the sign tells you the window; CURB tells you when tickets actually start on YOUR block — and the calendar doesn't know where you parked.
- Language note: users say "street cleaning" (not "sweeping"), "remind me to move my car." Use their words in copy and SEO.

## 6. Positioning One-Liners ("how is this different from X?")

- **vs SpotAngels**: "SpotAngels shows the posted schedule and charges for the good parts. CURB is free, no account, open-source — and shows when ticketing *actually* happens on your block, reconstructed from 650k real SFMTA citations."
- **vs Ticketless+**: "Love it — it's iOS-only and uses the official schedule. CURB works on any phone in the browser, no install required, and adds real citation times, RPP areas, meters, and white school zones on one map."
- **vs Sweep Alarm**: "Sweep Alarm is a great alarm you set yourself. CURB is the whole curb: every block colored by next sweep, permits, meters, white zones — and the alert knows your block's real first-ticket time, not just the sign."
- **vs Xtreet**: "Xtreet hasn't meaningfully changed since 2015 and emails you (check spam). CURB is maintained, open-source, push-notifies you, and is built from this year's data."
- **vs kaushalpartani's map**: "Genuinely good free tool — CURB does that plus push alerts, every curb colored at once, permits, meters, white zones, and real ticket times instead of a pass-through of the schedule feed."
- **vs the city (DataSF/Public Works)**: "Same official data underneath — but the city map can't tell you your next sweep is in 14 hours or wake you up before it. And the schedule isn't the whole truth: citations show enforcement starts ~22 minutes in on average."
- **vs ParkMobile/HotSpot**: "Those pay your meter. CURB protects you on the free and permit blocks where sweeping tickets actually happen — the part no payment app touches."
- **vs Text Before Tow**: "The city texts you 5 minutes before the tow truck, and never for street cleaning. CURB warns you the night before, for the violation SF writes most."
- **vs "just set an alarm"**: "Your calendar doesn't know where you parked, which side of the street you're on, whether it's the 2nd or 4th Monday, or that your block gets ticketed 22 minutes after the window opens. CURB does — for free, with no account."

Launch framing: lead with the data ("we reconstructed when ticketing actually happens on every SF block from 650k citations"), not "another reminder app" — that framing survived every Reddit launch-thread autopsy in this research; "reminder app" framing did not. Timing hook: SF drivers are already confused about parking apps after SFMTA's May 2026 PayByPhone-to-ParkMobile/HotSpot switch.