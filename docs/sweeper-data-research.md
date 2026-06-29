# Can CURB show where the sweeper truck is / starts? — research findings

_Researched 2026-06-09. Every dataset claim below was verified against the live DataSF
Socrata APIs; program-status claims are cited to sources._

## Bottom line
- **No public real-time feed** of SF street-sweeper or parking-enforcement vehicle
  locations exists. The "Map of Street Sweeping Routes" dataset (`n8xs-xfw6`) is just a
  broken map view of the schedule data, "undergoing maintenance."
- The GPS **exists internally**: SF runs a **$8.26M Geotab telematics contract** (fleet
  pings every ~2 min, 30-day location log, classified "Not Published") and Public Works
  keeps **"FleetRoute"** — an internal GIS master DB of sweeper routes (inventory
  `DPW-0039-S`, classified _Level 1 – Public_, i.e. potentially releasable).
- **Other cities publish exactly this**: Chicago's live Sweeper Tracker (9am–2pm
  weekdays), and NYC's **Local Law 9 of 2023** _mandates_ GPS on brooms + a public
  tracker (`SweepNYC`) and an open "last-swept per segment" dataset (updating daily).
- The **realistic gold mine is already public**: the SFMTA **Parking Citations** dataset
  lets CURB reconstruct *when each block is actually ticketed*, statistically — which is
  the actionable version of "where's the truck."

## The citation goldmine — `ab4h-6ztd`
- 23.8M rows, **updated daily**, CORS-open (`access-control-allow-origin: *`).
- Street-cleaning tickets: **`STR CLEAN`** (code TRC7.2.22, 6.74M rows) + legacy
  **`ST CLEANIN`** (T37C, 2.40M rows). Minute-resolution `citation_issued_datetime`.
- **Real fine in 2026: $105** (verified: 208,673 of 208,712 YTD STR CLEAN tickets).
- **Publish lag ~2–5 days**; drop typo'd future dates (max seen `2027-04-23`).
- The bulk DataSF rows ship without lat/long for recent years — only an address string.
  A 2024 records request (#26-5453) **restored GPS coordinates** on the citations, so the
  earlier "0 of 851k rows have lat/long / address join only" claim is superseded: CURB now
  matches each ticket to the **nearest CNN segment (<=40m)** off GPS (~815k of ~1M
  street-cleaning tickets matched). The address → block (CNN) join via the EAS dataset
  (`3mea-di5p`) is kept only as a pre-2024 fallback for GPS-less rows. Watch out either way:
  citation addresses are zero-padded and dirty (`001 STEINER ST`, `0121 …`, `VALENICA` typos).

### What the data proves (live demos)
- **214–255 Steiner St** (posted Wed/Fri 9–11 AM): 221 tickets since 2023 →
  **median 9:11 AM, 90% by 9:21, earliest 9:00.** Real risk window ≈ 40 min, not 2 hrs.
- **Valencia St** (posted 6–8 AM): **97.6%** of 1,356 tickets in the **6 AM hour**.
- A single afternoon ticket trail traces the truck across the Outer Sunset
  (12:31 Tompkins → 13:30 Moraga) → **route order, direction, and pace are recoverable**.

→ This is what CURB now ships: `scripts/build-enforcement-records.py` precomputes per-block-side
  ticket-time distributions into `data/enforcement.json`; the sheet/tooltip show
  "🎯 Ticketed ~9:11a · earliest 9:00a."

## The enforcement vehicles (PCO "ticket cars")
- PCOs ride the sweeper's route; the citation record is their only public exhaust.
- **No ALPR-on-sweeper ticketing in SF** as of mid-2026 (that's Washington DC's
  "Sweepercam"). SF hasn't even launched its authorized bike-lane parking cameras.
- **Cautionary tale:** "Find My Parking Cops" (Sept 2025) showed live PCO positions by
  scraping SFMTA's citation-payment portal — **SFMTA killed it in ~4 hours** on
  officer-safety grounds. ⇒ Don't scrape for real-time; use the sanctioned daily dataset.

## Color curb / loading zones — `6cqg-dxku` (Meter Operating Schedules)
- 72k rows; the **`applied_color_rule`** field carries the regulation + **days/hours/limit**:
  Yellow commercial loading (7,755), White passenger loading (954), Red truck loading
  (2,137), Green short-term (3,828), Orange bus (280). `cap_color` is unreliable (white
  zones often show a Grey cap) — match on `applied_color_rule`.
- No geometry; **join to meter coords by `post_id`** (`8vzz-qzz9` has lat/long + CNN).
- Paint-only (non-metered) white/yellow curbs are **not** published → records-request item.
- Blue (disabled) zones have their own dataset (`g69s-9jxr`).

## Prior art
- **SweepSF** (sweepsf.com) is the closest SF product to the citation-inference idea
  (per-address "when tickets are typically issued") — CURB doing it **map-wide** leapfrogs it.
- **SpotAngels** tried city open data, found it inaccurate, pivoted to crowdsourcing + CV.
- Schedule-only reminder apps: Sweep Alarm, Street Sweep (all on the same `yhqp-riqs` data).
- Real-time trackers exist **only** where the city publishes fleet AVL (Chicago, NYC,
  Wichita). The civic precedent **ClearStreets** (Chicago plow GPS, 2012–19) died when the
  city changed its tracker + the map vendor killed free tiers — the maintenance risk any
  live layer inherits.

## Paths to (near-)real-time, ranked
1. **Citation-inferred pass times** (DONE) — zero new infra, durable, legal.
2. **Public-records request** for FleetRoute + sweeper AVL — free, async (see
   `records-request.md`). Strong precedent (NYC law, Chicago tracker).
3. **Inferred route animation** from schedule adjacency + citation ordering — no new data.
4. **Crowd "truck spotted" layer** — only works at density; pilot in 2–3 dense
   neighborhoods with gamification, as *confirmation* of the predicted time, never primary.
5. ❌ **Real-time PCO scraping** — technically possible, killed within hours, bad PR.
