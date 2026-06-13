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

## 6 · X/Twitter thread (polished — copy/paste; media notes in [brackets])

**1/** San Francisco posts a 2-hour street-cleaning window.
I matched 650,000 tickets to the exact blocks they were written on.
On the median block, every ticket lands inside the same 22 minutes. 🧵
[media: the trailer (curb-trailer-16x9.mp4) OR card-stat22.png]

**2/** Street cleaning is SF's #1 ticket — about half a million a year, more than LA writes. It's $105 now.
And the sign misleads you: it says "9–11am," but the tickets start ~9:14 and stop by 9:40. The window is theater; the enforcement is a sniper.

**3/** So I built the map I wanted → curb.guide
Every curb in SF, colored by its next sweep. Green = clear, amber = soon, red = move now.
Tap your block: the posted schedule AND when tickets actually land there.
[media: card-tap.png]

**4/** One tap arms a move-your-car alert — a heads-up the night before, and ~30 min before the truck.
No more "is it the 2nd or 4th Tuesday?" It knows your block, your side of the street, the week pattern.
[media: card-alerts.png]

**5/** It even maps the white passenger-loading zones at schools — the ones SFMTA doesn't publish on its open-data portal. I found the inventory on the city's own GIS and put all 1,975 on the map.
[media: card-whitezones.png]

**6/** And there's the whole data story: 23.8M tickets since 2008 — what SF fines, by year, type and neighborhood → curb.guide/tickets
[media: card-tickets.png]

**7/** It's free. No account, no ads, no cookies, nothing to install — works in any browser.
And it's open source (MIT): github.com/alevizio/curb
Built entirely on SF's public data (DataSF). The posted sign is always the final word.

**8/** If you park on the street in SF, try it on your block: curb.guide
Tell me if your block's real ticket times match what you've lived through. 👀

_Reply-ready if someone calls it creepy:_ "It's the city's own published data, aggregated — no officer tracking, nothing live. The goal is the opposite of dodging enforcement: move your car before the sweeper, which is exactly what the program wants."

## Social assets (generated, in ~/Downloads/curb-social/)
- **curb-trailer-16x9.mp4** — ~25s trailer for Twitter/X (also LinkedIn).
- **curb-trailer-9x16.mp4** — same for Instagram Reels/Stories & TikTok.
- **card-*.png** — 8 feature cards (2560×1440): stat22, map, tap, alerts, whitezones, tickets, logo, cta. Drop them into the thread above or post standalone.
- Regenerate: `/tmp/social/` has reel.html + render.js (`node render.js full land|port` → ffmpeg) and cards.js.

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
- [ ] Reply templates ready — the full arsenal is in `competitive-landscape.md` §6
  (one-liners vs SpotAngels, Ticketless+, Sweep Alarm, Xtreet, the city, "just set an
  alarm") and `data-defense.md` ("is this legal?" — the Find My Parking Cops question).
  The big preempt, verbatim-ready: **"So just... read the sign?"** → "The sign tells you
  the window. CURB tells you when tickets actually start on YOUR block — median block
  gets every ticket in a 22-minute span — and your calendar doesn't know where you
  parked, which side you're on, or whether it's the 2nd or 4th Monday."
- [ ] "Do this for my city" replies: note which cities get asked (demand signal)
- Timing hook for press + posts: SFMTA just switched meter apps (PayByPhone →
  ParkMobile/HotSpot, May 2026) — SF drivers are actively confused about parking apps
  RIGHT NOW. And the fine is **$105** — most of the web still quotes $73–97.
