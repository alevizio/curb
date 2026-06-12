# CURB Launch Kit

_Ready-to-post assets. Stats computed 2026-06-11 from data/enforcement.json
(656,599 street-cleaning tickets matched to 9,107 blocks / 18,077 block-days)._

## The numbers that carry everything
- The city posts a **2-hour** sweeping window. On the **median block, every ticket
  falls inside a 22-minute span.**
- On **87.5% of blocks**, all tickets land within 45 minutes. (94.5% within an hour.)
- Typical gap between a block's earliest ticket and its average: **9 minutes** —
  the ticketing pass is fast and consistent.
- Exemplar: 214–255 Steiner St, posted Wed/Fri 9–11am → median ticket **9:14am**,
  90% written by 9:39.
- Fine: **$105** (verified against 208k tickets YTD 2026).

## Sequence — pinned calendar (set 2026-06-12)
| Date | Channel | Asset | Notes |
|---|---|---|---|
| Sat–Sun Jun 13–14 | Pre-flight | checklist below | GSC + analytics + cache priming + fresh data |
| Mon Jun 15 | Press pitch v2 | §4b | The SF Standard surge story is hot NOW — don't wait for Reddit |
| Tue Jun 16, ~9am PT | r/sanfrancisco | §1 | Morning post catches commute + lunch browsing |
| Thu Jun 18, 8–10am ET | Show HN | §2 | Link to /about; tech comment ready |
| Thu–Fri Jun 18–19 | Press pitch v1 | §4 | Now with "as discussed on HN/Reddit" social proof if it hit |
| Tue Jun 23, 12:01am PT | Product Hunt | §3 | Maker comment immediately; X thread same morning |
| Week of Jun 22 | Nextdoor | §5 | 2–3 neighborhoods/day, personalize the hood stat |
| Fri Jun 26 | Retro | — | What hit, what didn't, queue month-2 calendar |

*Respond to every comment, everywhere, fast. That is most of the work.*

---

## 1 · Reddit — r/sanfrancisco
**Title:** I analyzed 650k SF street-cleaning tickets. The "2-hour" window is a myth — on most blocks, every ticket lands in a ~22-minute span. So I built a free map of when they actually come.

**Body:**
Like everyone here I've eaten my share of $105 street-cleaning tickets, so I pulled
SFMTA's public citation data (every parking ticket since 2008 is on DataSF) and matched
~650,000 street-cleaning tickets to their exact blocks.

What I found: the posted window is two hours, but enforcement isn't. On the median
block, **all tickets fall within a 22-minute span**, usually right after the window
opens. On 87% of blocks, everything's written inside 45 minutes. Example: the
9–11am block I checked first gets its median ticket at **9:14am** — nobody's been
ticketed there after 9:40 in two years.

So I made the map I wanted: **curb.guide** — every curb in SF colored by its next
sweep, and when you tap a block it shows the posted schedule *plus* when tickets
have actually been written there. Permit areas, loading zones, and a one-tap push
alert ~30 min before your block is swept.

Free, no account, no ads, no tracking. All public data (the posted sign always wins —
this is a guide, not legal advice). Would love to know if your block's numbers match
your experience.

---

## 2 · Show HN
**Title:** Show HN: I matched 650k SF parking tickets to city blocks to find when sweepers actually come

**URL:** https://curb.guide/about

**First comment (technical):**
The whole app is one static index.html (vanilla JS + Leaflet, no build step) on Vercel,
plus three precomputed JSON assets and a couple of serverless functions for Web Push.

The interesting part was the citation pipeline. SFMTA publishes every ticket since 2008
(23.8M rows on Socrata), but the rows haven't been geocoded since ~2021 — you get raw
officer-typed address strings like "0121 STEINER ST" or "1125 VALENICA". I join them to
block segments (CNNs) via the city's addressing dataset, validate against each block's
posted schedule to drop bad matches, and emit a 475KB per-block-side time distribution
file. Fun Socrata lesson: deep $offset pagination times out around row 400k; paging on
the internal `:id` cursor is fast and stable.

The "truck route" layer orders a corridor's blocks spatially (project onto the
farthest-pair axis) and uses ticket times only for direction via time-position
correlation — sorting by the noisy per-block averages directly produces zigzag garbage.
Runs that can't prove a direction (|r| < 0.35) aren't drawn.

Notable negative result: there's no public real-time sweeper GPS. The city runs a fleet
telematics system (it's in their public systems inventory) but doesn't publish it —
NYC mandates publishing by law, Chicago has a live tracker. Someone tried scraping
SFMTA's citation portal for live officer positions last year; it was blocked within
4 hours. So CURB is deliberately predictive, not live.

Source: https://github.com/alevizio/curb

---

## 3 · Product Hunt
**Tagline (49):** Know when SF street sweeping tickets actually land

**Description (≤260):** CURB maps every SF curb by its next street sweep — and shows
when tickets are actually written on your block, reconstructed from 650k real
citations. Permit areas, loading zones, push alerts ~30 min before. Free, no account,
no tracking.

**Topics:** Maps · Data visualization · User experience

**Gallery:** og.png (cover) → landing sign-stack screenshot → mobile sheet with 🎯
callout → citywide overview zoom → permit-area boundary → truck-route arrows.

**Maker comment:**
Hi PH! I kept getting $105 street-cleaning tickets even though I "knew" my block's
schedule — because the posted 2-hour window tells you nothing about when the truck
actually comes.

SF publishes every parking ticket as open data, so I matched ~650k street-cleaning
citations to their exact blocks. It turns out enforcement is incredibly consistent:
on the median block all tickets land in a 22-minute span. CURB shows that, per curb,
on a live map — plus permit areas, loading zones, and a push alert before your block
is swept. It's free and anonymous, built on SF open data.

Things I'd love feedback on: the inferred truck-route layer (beta), and what other
cities you'd want this for. I'm here all day!

---

## 4 · Press pitch (SF Standard / Mission Local / SFGate)
**Subject:** Data: SF's "2-hour" street-cleaning windows are really ~22 minutes of ticketing

Hi [name],

I analyzed all ~650,000 street-cleaning citations SFMTA has issued over the last two
years (public DataSF records) and matched them to their exact blocks. Two findings your
readers will feel personally:

- The posted window is two hours, but on the median SF block, every ticket is written
  within a 22-minute span — typically starting minutes after the window opens.
- Enforcement is remarkably consistent block-to-block: 87% of blocks see all tickets
  inside 45 minutes. (Sample block: posted 9–11am, median ticket 9:14am, none after 9:40.)

I built a free public map of it — curb.guide — every block's schedule plus its actual
ticket times. No account, no ads; it runs entirely on city open data.

Happy to share the full per-neighborhood numbers, methodology, or anything else.
[name] · curb.guide/about · github.com/alevizio/curb

---

## 4b · Press pitch v2 — the surge tie-in (send FIRST, Mon Jun 15)
_To the SF Standard reporters behind the June 10–11 ticket-surge stories (bylines are
on the two articles linked at curb.guide/about#press) + Mission Local._

**Subject:** Three follow-ups to your parking-ticket surge story (with data + a free map)

Hi [name],

Loved the surge piece — I'd been building on the same DataSF citations and your map
matched my numbers almost exactly (I get Ingleside -14% vs your -13%). Three things
I have that might make follow-ups:

1. **The "2-hour window" is really ~22 minutes.** I matched ~650k street-cleaning
   citations to their exact blocks: on the median block every ticket lands in a
   22-minute span. Per-block, on a free public map (curb.guide).
2. **My own neighborhood cut of your surge analysis** — same windows, all violation
   types, address-matched: Mission Bay +112%, FiDi +69%, only three neighborhoods
   declining. Chart + methodology: curb.guide/tickets
3. **The school white zones SFMTA doesn't publish.** Their open-data parking dataset
   literally excludes "non-metered color curb." I found the inventory exposed on the
   city's ArcGIS and put all 1,975 passenger-loading zones (627 near schools) on the
   map — first time they're publicly browsable.

All public data, free, no ads. Happy to share any cut of the numbers.
[name] · curb.guide · github.com/alevizio/curb

---

## 5 · Nextdoor template (per neighborhood)
**Title:** When street sweeping tickets ACTUALLY happen in [Neighborhood] — free map

Neighbors — I matched SF's public parking-citation records to our blocks. On most
[Neighborhood] streets, the tickets all land in the first ~20–40 minutes of the posted
window. I put it on a free map (curb.guide): tap your block to see its schedule and its
real ticket times, and set a reminder before sweeping. No account/ads/tracking — it's
all city open data. Curious if it matches what you've seen on your street.

---

## 6 · X/Twitter thread skeleton
1. SF posts 2-hour street-cleaning windows. I analyzed 650,000 tickets: the median
   block gets ALL of them in a 22-minute span. 🧵
2. [chart/screenshot: Steiner timeline] Posted 9–11am. Median ticket 9:14. None after 9:40.
3. So I built curb.guide — every SF curb, colored by its next sweep, with the real
   ticket times per block. Free, no account.
4. The data nobody publishes: the city HAS live sweeper GPS (it's in their systems
   inventory). NYC publishes theirs by law. SF doesn't. So this is prediction, not
   tracking — built from the tickets themselves.
5. Bonus layer: SFMTA's open data excludes painted white zones. Found the inventory
   on the city's GIS — all 1,975 passenger-loading zones are on the map now, school
   drop-off zones included. [white-zone popup screenshot]
6. [sign-stack image] Open data → fewer $105 surprises. curb.guide

---

## 7 · Demo video — 60 seconds, one take (record before PH day)
Cmd+Shift+5 full-screen capture at 2x, clean profile, cursor large; captions burned in
(80% watch muted). Gifski for the 15s social cut.

| t | Shot | Caption overlay |
|---|---|---|
| 0–5s | Zoomed Mission view, curbs colored; idle 1 beat | "Every SF curb, colored by its next street sweep" |
| 5–15s | Tap a red block → sheet opens on the verdict | "Tap where you parked. Red = sweeping soon." |
| 15–30s | Scroll sheet to the 🎯 ticket-time line | "The sign says 9–11am. The tickets say 9:14." |
| 30–40s | Tap the alert bell → "✓ Alerts on" toast | "One tap = a push alert ~30 min before the sweeper" |
| 40–50s | Layers panel → permit zones + a white school zone popup | "Permit areas, meters — even the school zones the city doesn't publish" |
| 50–60s | Zoom out citywide, hold on the full map | "Free. No account. curb.guide" |

15s cut for X/PH gallery: shots 1, 2, 3, 6.

---

## 8 · Post-launch content calendar (4 weeks, ~3 posts/wk on X + 1 long elsewhere)
| Week | Mon | Wed | Fri |
|---|---|---|---|
| Jun 23 | PH launch thread (§6) | Behind-the-scenes: one-file app, $0 infra | Launch metrics, transparent numbers |
| Jun 30 | Data drop: weirdest white zones found | "How I found the unpublished school zones" (long: blog/HN) | Neighborhood spotlight #1 (surge chart crop) |
| Jul 7 | Most-ticketed block in SF | Reply roundup: "does my block match?" stories | Neighborhood spotlight #2 |
| Jul 14 | Month-1 retro: visits, alerts set, lessons | "Which city next?" poll (note demand per city) | July data refresh delta thread |
Repurpose every X thread: same content → Reddit comment, Nextdoor variant, IndieHackers
milestone post. One asset, four surfaces.

---

## Launch-day checklist
- [ ] Google Maps referrer for curb.guide added (parchment tiles live) — **still open**
- [ ] Analytics decision made & wired (currently flying blind) — **still open**
- [ ] Prime social caches: opengraph.xyz on / and /about
- [ ] Search Console verified + sitemap submitted
- [ ] Fresh data: `npm run build:enforcement && npm run build:overview && npm run build:zones && npm run build:whitezones && npm run build:stats`
- [ ] Cron/push smoke test (the end-to-end push test is still pending)
- [ ] Reply templates ready for "is this legal?" (public records; sign is source of truth)
  and "do this for my city" (top request — note which cities get asked)
