# CURB in more cities

Started 2026-10-01. This folder is the plan for taking CURB beyond San Francisco, and the notes on each
city we are looking at. Read this file first.

| File | What it is |
|---|---|
| [README.md](README.md) | The plan: principles, what a city gets, architecture, phases, open decisions |
| [adding-a-city.md](adding-a-city.md) | What we need from someone who wants CURB in their city, step by step |
| [data-contract.md](data-contract.md) | The one data format every city gets converted into |
| [boston.md](boston.md) | Boston: what the City publishes, the rules, the gaps, what to ask for |
| [buenos-aires.md](buenos-aires.md) | Buenos Aires: how parking works there, the data, what a first version looks like |

## Where each city stands

| City | Status | Who | What is in the way |
|---|---|---|---|
| San Francisco | Live at curb.guide and in the App Store | Ale | Nothing |
| Boston | Researched. Waiting on data | Ale | The public sweeping schedule has no street geometry. See [boston.md](boston.md) |
| Buenos Aires | Researched. A volunteer wants to run it | A local maintainer | The City publishes the rule for every curb side, but under a license that forbids commercial use. It is not a street sweeping city, so the map has to draw other rule types, and it needs Spanish. See [buenos-aires.md](buenos-aires.md) |

## Principles

1. **San Francisco does not change.** SF stays at the root of curb.guide, with its 12,253 block pages, its
   neighborhood pages and its App Store links. A new city is added next to it, never in place of it.
2. **A new city starts small.** Map, block sheet, alerts. Everything else (meters, permits, block pages,
   ticket times) is switched on per city, only when that city has the data. No city has to match SF.
3. **One data format.** Each city's data is fetched and converted when the data is built, into the format in
   [data-contract.md](data-contract.md), and committed as JSON. Visitors' phones never query a new city's
   servers live. This is the snapshot pattern CONTRIBUTING.md already asks for.
4. **The posted sign wins.** Every city page says where its data came from and when, like SF does.
5. **Free infrastructure only**, one domain, one iPhone app.

## What a city gets, in levels

A city launches at level 1 or 2 and climbs when the data exists.

| Level | What people see | What the city must have |
|---|---|---|
| 1. Map | Every curb side colored by its next restriction, and a block sheet with the schedule | Street lines with a left and right side, at least one kind of rule with days and hours, the time zone |
| 2. Alerts | Push alerts and calendar events before a restriction starts | Level 1, plus holidays and seasons that are right, and block ids that stay the same between data refreshes |
| 3. Layers | Meters, permit areas, loading zones on the map | A dataset for each layer. Each one is optional |
| 4. Pages | A page per block and per neighborhood, for search engines | Level 1, plus neighborhood boundaries |
| 5. Ticket times | "Tickets usually land at 9:11" | Citation records with a time and a location. Usually a public records request |

San Francisco is at level 5. Boston can reach level 2 with what is public today. Buenos Aires has the
best raw data of the three (one layer with every curb side) and can reach level 2 once the map can draw
rules that are not sweeping.

## What is already the same for every city, and what is tied to SF

A code review on 2026-10-01 found 27 places where the code assumes San Francisco (12 small, 13 medium,
2 large). The short version:

**Works for any city today:** the map engine, drawing curb sides next to a street line, the block sheet,
the alert schedule (evening before, morning of, 30 minutes before), push delivery on web and iPhone, the
monitor, and since 2026-10-01 the time and schedule logic (see "Done so far").

**Tied to San Francisco:**

| Area | Where | Size |
|---|---|---|
| Live data source (DataSF queries by map area) | index.html, api/_geo.js, api/parked.js, api/og.js | Large |
| SF-only layers and baked files (permits, meters, loading, ticket times, sweeper passes) | index.html, scripts/build-*.mjs, data/*.json | Large |
| Words on screen ("San Francisco", SFMTA, the $105 fine, about 70 strings) | index.html, api/block.js, lib/notify-core.js, site.js, manifest.json | Medium |
| Basemap tiles, baked only for SF and the Bay | basemap/parchment, scripts/build-basemap.sh | Medium |
| Saved alerts carry no city (a block id is only unique inside one city) | api/_spot.js, api/send-notifications.js, index.html localStorage | Medium |
| Block and neighborhood pages, sitemaps, share cards | api/block.js, scripts/build-hood-pages.mjs, scripts/build-block-sitemap.mjs | Medium |
| Map defaults (center, bounds, weather) and "CURB covers San Francisco" messages | index.html | Small |
| Address search (SF's address database) | index.html | Medium |
| Data refresh job and the monitor's sample block | .github/workflows, scripts/monitor, scripts/validate-data.mjs | Small |
| iPhone app wording (location prompt, App Store listing) | ios/ | Small |

## Architecture

1. **City config, `lib/cities.js`** (not written yet; add it with the second city). One entry per city:
   id, name, URL path (`''` for SF, `/boston`), time zone, map center and bounds, basemap, holiday rule,
   which levels and layers are on, the fine, agency names, links, and the words that change per city.
   Loaded the same two ways as `lib/sweep-core.js` (a plain script in the browser, an import in Node), so
   there is still no build step.
2. **Data.** One script per city, `scripts/cities/<id>.mjs`, fetches from the city's portal (Socrata, CKAN,
   ArcGIS, plain files) and writes `data/<id>/…json` in the shared format. In the page, a small "provider"
   answers "what is in this map area" and "give me this block". SF keeps its live DataSF provider. New
   cities use a static provider that loads the city file once and filters it in memory.
3. **Time and schedule logic, `makeTimeCore` in `lib/sweep-core.js`.** Done. One instance per city, built
   from the city's time zone, its holiday rule and, per rule, an optional season.
4. **URLs.** One domain, one path per city: `curb.guide/boston`, `curb.guide/boston/b/<block>`. Paths
   instead of subdomains because one origin means one service worker, one push subscription and one saved
   spot per phone, and search ranking stays on one domain.
5. **Alerts.** A saved spot gets a `city` field. A spot without one is San Francisco, so every existing
   subscriber keeps working. The sender picks the city's time logic, fine and wording. Storage, the
   15 minute scheduler and delivery are shared.
6. **Pages.** Per city block pages, sitemaps and share cards come after the map works (level 4).
7. **Basemap.** The tile bake reads each city's bounds and writes `basemap/<city>/`. A second city roughly
   doubles the tile weight, which is the moment to move tiles off Vercel (docs/self-host-basemap-plan.md).
8. **iPhone app.** One app. The web page picks the city, so the app needs no new code, only a neutral
   location prompt and an updated listing.
9. **Operations.** The monitor and the monthly data refresh loop over the cities, each with its own sample
   block and its own sanity bounds.

## Phases

**Phase 0, groundwork. Done 2026-10-01.**

- `makeTimeCore({ tz, suspended, holidayName })` in `lib/sweep-core.js`: the whole time and schedule
  logic now works for any time zone and any holiday rule. SF is one instance of it, attached under the
  same names as before, so nothing that calls it changed.
- A rule can carry `months` (for example April to November), so seasonal cities work. A rule without
  months is year round, as before.
- Checked two ways: 3,850,714 side by side comparisons of the old and new code over 1,400 rules and 476
  clock times (zero differences), and new tests for Eastern time, the season edges and Buenos Aires.
- This folder.

**Phase 1, the second city on the map (level 2).** Most likely Boston. Starts when we have its data.

1. `lib/cities.js` with SF and the new city.
2. `scripts/cities/<id>.mjs` writing `data/<id>/segments.json` and `overview.json`.
3. The static provider in index.html, root absolute asset paths, and switches that hide SF-only layers.
4. `city` on saved spots, through the sender, the deep link and the saved alert key.
5. The city's page at `curb.guide/<id>`, its manifest, its basemap bake, its holiday table.
6. Tests for the city's time zone, season, holidays and data; one monitor check.

Rough size: about two weeks of focused work for the first one, because it builds the shared pieces. A
third city with clean data should be days.

**Phase 2, rules beyond sweeping.** Needed for Buenos Aires, useful for Boston later. The data format
already has room for it ([data-contract.md](data-contract.md)), and the schedule logic already computes a
weekday window like Buenos Aires's "no parking on business days 7 to 21" (it is tested). The work is in
the map and the sheet: what a side that is never allowed looks like, what a free side looks like, what
color a weekday window gets, what the sheet and the alert say. This changes how CURB looks and reads, so
it is Ale's design call before any code.

**Phase 3, pages for search (level 4)** per city, then layers (level 3) as data allows.

## Decisions that are Ale's

1. **Address of a city.** `curb.guide/boston` (recommended, reasons above) or `boston.curb.guide`.
2. **How people switch city.** A city picker in the info menu, plus a prompt when the phone is clearly in
   another city.
3. **Colors and words for rules that are not sweeping** (phase 2).
4. **Language.** Buenos Aires needs Spanish for the whole interface and for the alert voices. This is the
   largest single cost of that city after the new rule types.
5. **Who runs a city.** If a local maintainer runs Buenos Aires, they own that city's data script and its
   facts (rules, holidays, fines), and CURB's design and code review stay with Ale.
6. **What Boston's pitch is.** The City already sends its own sweeping reminders (Notify Boston) and
   publishes no ticket data, so the SF hook ("when tickets land") is not available there yet.
