# Boston

Researched 2026-10-01. Every source below was opened and re-checked by a second pass, with cross origin
checks sent as `Origin: https://curb.guide`.

## Prototype (2026-10-16)

A working preview of CURB for Boston: `boston.html`, served at `curb.guide/boston` (noindex, not linked
from the San Francisco site). Same map, colors and block sheet as San Francisco.

How it is built:

| Piece | File | What it does |
|---|---|---|
| Data | `scripts/cities/boston.mjs` → `data/boston/` | Fetches the three sources below, attaches each schedule row to street blocks, writes `segments.json` (swept blocks and rules), `curbs.json` (Curb Lab layers, sorted by `scripts/cities/boston-curbs.mjs`), `rules.json` (each block side's posted rules, for the sheet: 30 KB compressed), `report.json` (match and coverage numbers) and `fixes.json` (every fix below). Inputs are cached in `private/cache/boston/`; `--refresh` fetches again |
| Fixes | `scripts/cities/boston-fixes.mjs` (+ `boston-basemap-streets.mjs`) | The rules for the map fixes (below): wrong street names, cross street capitals, and each block line checked against the basemap's streets, which `boston-basemap-streets.mjs` reads out of `basemap/boston.pmtiles` once (cached as `private/cache/boston/basemap-streets.json`; needs the basemap toolchain) |
| Pages | `scripts/cities/boston-pages.mjs` → `boston/about.html`, `boston/fixes.html` | `/boston/about` (how it works, Boston's rules, its sweeping holidays, the data sources) and `/boston/fixes` (every fix, each with a small map), in the About page's styles; `site.js` gives pages under `/boston` Boston's nav and footer. Run after the data build |
| Share card | `og/template-boston.html` → `og-boston.png` | `npm run og:boston`. The Boston page and its pages use it, not SF's `og.png` |
| Time and data helpers | `lib/city-boston.js` | Boston's `makeTimeCore` (Eastern time, City holidays, seasons), attached under the names the page already calls; expands `segments.json` into the row shape the page reads from DataSF in SF |
| Page | `scripts/cities/boston-page.mjs` → `boston.html` | Generates the Boston page from `index.html` with a list of checked edits, so SF fixes reach Boston when it is rebuilt. Never edit `boston.html` by hand |
| Basemap | `CITY=boston bash scripts/build-basemap.sh` → `basemap/boston/` | Parchment tiles z8 to 16 citywide, overzoomed past 16, plus z17 for the center of town (`CORE_BOUNDS`, a second tile layer): 4,700 files, 111 MB. Add one zoom with `CURB_BASEMAP_CITY=boston CURB_BASEMAP_ZOOMS=17 node scripts/render-basemap.mjs` |
| Check | `scripts/check-boston.mjs` | Headless walk of the page: overview (real lines), the fixes, menu and card, street zoom, sheet, calendar time zone, address search, layers, alerts, the two pages, no SF requests |

Sources: the Street Sweeping Schedules (Public Works), the SAM street segments, and the Curb Lab's Curbs
API. The API's own address (`cds-curb-api.boston.gov`) has had an expired certificate since 2026-07-28, so the
build reads the Cloud Run address the City's beta map uses (`OETBoston/curb-atlas`). The API answers bulk pages
fast (10,000 zones in about 2 s) but small area queries slowly (about 20 s), which is why the page reads a
snapshot, as everywhere in CURB.

What the numbers say (`data/boston/report.json`, 2026-10-16):

- **Schedule to blocks: 3,599 of 3,758 rows (96%)**, 3,092 of them at both cross streets. 7,410 blocks,
  14,303 block sides. Odd and even go on the side of the line that holds those house numbers (SAM address
  ranges). 159 rows did not match: 118 on length (streets split by a square or a rotary), 25 with no walk
  between the cross streets (loops, dead ends), 10 street names, 6 without days or hours.
- **The Curb Lab data has sweeping signs on 2,416 block sides, 15% of the schedule's.** 14,309 of 54,185
  curb zones have only "unusable image" policies and 11,426 have none. Sweeping signs carry no street
  cleaning label: they read as "no parking" with `weeks_of_month` and a season.
- **Where both exist (2,129 block sides), 1,771 agree on day and hour** and 1,541 on the weeks too. On 227
  the sign's weeks are those of the other side of the street: odd and even swapped in the schedule, in the
  sign reading, or in where the curb zone was drawn.
- Curb Lab layers on the map (six tiles): 4,834 resident permit (residents only, or everyone else's time limit),
  1,568 accessible, 2,660 loading (commercial, passenger, bus, rideshare, valet, short term), 2,578 paid (rate and
  ParkBoston zone), 1,294 free time limits, 4,244 snow emergency, 15,061 no stopping or no parking (bus stops, rush
  hour, school and game days). Many signs are coded as exceptions ("no parking except resident permit"), which the
  first build missed: it had 1,510 permit and 56 accessible. Hydrant stubs are left out. A tapped curb lists the
  rules matched to its side (5,071 of 14,303 swept sides have some).

Sweep alerts work for Boston (2026-10-17): a saved spot carries `city: 'boston'` and its rules' `months`, and the
one shared sender times it on Boston's core (`lib/cities.js`: Eastern time, City holidays, the season, a $40 fine
in the copy and no SF ticket statistics, a 165 day watch age to bridge the December to March break, pushes that
open `/boston?b=`). On iPhone they need the page added to the Home Screen (`manifest-boston.json`, which opens
/boston); the CURB app is San Francisco only. One device's saved alerts hold both cities; each page's panel
resolves its own and sends the other city's curbs to their map. Not in the preview: ticket times (no citation
data), block pages, the iPhone app. The calendar reminder works, in Eastern time.

Like San Francisco's (2026-10-17): the menu has Neighborhoods (the welcome card's list), Sweeping holidays and Map
fixes, and How it works and About open `/boston/about` instead of SF's `/about`; shared links show `og-boston.png`.

### Map fixes (2026-10-17)

Every block line was checked against the streets the basemap is drawn from (OpenStreetMap), and every street name
against SAM. The fixes are made by the data build and written down one by one in `data/boston/fixes.json`, shown at
`/boston/fixes`:

- **The zoomed out view drew each block as a straight line between its ends** (SF's `data/overview.json` shape),
  fine for SF's short straight blocks but not Boston's: 407 lines strayed 10 m or more from their street, 41 over
  50 m, up to 168 m (Dunstable St, a loop). `BOS.overview` now carries each block's whole line and the page draws
  it, so the opening view follows the streets. The hover tooltip measures against the same line.
- **Block lines and the basemap agree**: 7,140 of 7,410 lines (96%) stay within 4 m of a street for cars. 13 blocks
  are left off the map: 10 on pedestrian streets (Downtown Crossing: Winter St, Washington St, Franklin St and
  Bromfield St; Faneuil Hall Marketplace: three "Commercial St" pieces), swept but with no curb to park at (where the
  Curb Lab read signs, they say no stopping), and 3 where the basemap has no street under most of the line (a Doone
  Ave stub past the end of the street, Eliot Pl, Haymarket Sq). A block the Curb Lab posts parking rules on would
  stay; none did. Rules in `boston-fixes.mjs`: on a street within 7 m (10 m for a major road, 15 m for one with the
  block's own name), sampled every 3 m; pedestrian when 60% of the line is on a pedestrian way, off the map when
  under 50% is on a street.
- **10 street names are wrong in the schedule** and show as SAM has them (22 blocks): four typos (Thonrdike,
  Merill, Patson, Wenoah), Yawkey Way (renamed Jersey St in 2018), REV R A BURKE ST, Martin Luther King Blvd
  (no Jr), Harborview St, La Grange St and Newcroft Cr. The schedule's other spellings stay (it writes "East Eighth
  St" where SAM has "E Eighth St").
- **Cross street names** come from SAM in capitals; 23 needed care when written for people: an apostrophe s is not a
  capital S (Allen's Aly), and Mc names keep their second capital (McLellan St).

Questions for the City, from building it:

1. Which address should apps use for the Curbs API, and will the `cds-curb-api.boston.gov` certificate be
   renewed?
2. The public API's policies were last published 2026-05-07. Is it refreshed from the nightly sign system?
3. Could curb zones carry `street_name` and `street_side` (empty today), and sweeping policies a street
   cleaning purpose?
4. The 227 block sides where the sign data and the schedule disagree on odd and even: which is right?
5. Could the sweeping block geometry behind Notify Boston be published? It would replace the join.
6. What are the terms for the Curbs API data? None are stated.
7. A bulk export (one file per refresh) would suit apps better than area queries.
8. A machine-readable holiday and season calendar, and any same day cancellation signal.
9. Street cleaning citations (date, time, location) for "when tickets usually land".
10. Are the Curb Lab's meter rates current, and are the cleaned neighborhoods public?
11. The schedule spells 10 street names differently from SAM (typos, Yawkey Way for Jersey St) and lists 10
    pedestrian street blocks (Downtown Crossing, Faneuil Hall Marketplace): fix them at the source? (`/boston/fixes`)

## Short version

- Boston can reach level 2 (map, block sheet, alerts) from public data.
- The hard part is one thing: the public sweeping schedule has **no street geometry**. We have to attach
  each schedule row to a street line ourselves. A first automatic attempt matched 91% of rows.
- The City already holds the matched geometry inside its own reminder tool, Notify Boston. If they share
  it, the join step disappears.
- There is no public ticket data, so "when tickets usually land" is not possible yet.

## What the City publishes

| Need | Dataset | Notes |
|---|---|---|
| Sweeping schedule | [Street Sweeping Schedules](https://data.boston.gov/dataset/street-sweeping-schedules), Analyze Boston (CKAN), resource `9fdbdcad-67c8-4b23-b6ec-861e77d56227` | 3,758 rows, updated daily, public domain (ODC PDDL), open to browsers. Fields: `st_name`, `from`, `to`, `side` (Odd or Even), `week_1`..`week_5`, `sunday`..`saturday`, `every_day`, `start_time`, `end_time`, `year_round`, `north_end_pilot`, `dist`, `main_id`, `parent`, `losta`, `hista`. **No geometry and no segment id.** No data dictionary |
| Street lines | [Boston Street Segments (SAM)](https://data.boston.gov/dataset/boston-street-segments-sam-system), ArcGIS `SAM/Live_SAM_Address/FeatureServer/3` | 19,440 segments with left and right address ranges, updated nightly. This is what the schedule gets joined to |
| Intersections | ArcGIS `SAM/Live_SAM_Address/FeatureServer/8` | 11,324 points. Used to find a row's `from` and `to` cross streets. Tables 5, 6 and 7 hold street name aliases |
| The City's own joined geometry | Notify Boston, `notify.boston.gov/street-alerts/api/streets/…` | Works and returns block paths, and its variant id equals the schedule's `main_id`. But it is undocumented, has no terms, and only answers its own website. Ask before using |
| Meters | [Parking Meters](https://data.boston.gov/dataset/parking-meters) | 6,955 points, but the content looks frozen around 2017 (rate $0.25 on 6,947 rows). Current rates are only on a web page |
| Curb rules in general | Curb Lab prototype Curbs API (Curb Data Specification format) | Real and reachable, but unofficial, read from sign photos by a model, noisy, and with no street name or side. Not something to build on yet |
| Signs | [Signs (Cartegraph)](https://data.boston.gov/dataset/signs-cartegraph) | 253,139 rows with photos. Raw sign posts, not curb spans |
| Snow emergency routes | [Snow Emergency Routes](https://data.boston.gov/dataset/snow-emergency-routes) | Geometry exists (last edited 2011). No feed says when an emergency is declared |
| Holidays | [City of Boston Holidays](https://www.boston.gov/departments/311/city-boston-holidays) | A web page, no feed. Says per holiday whether daytime sweeping is canceled |
| Tickets | Not published | The newest bulk data is a 2018 to August 2020 records release with no coordinates |
| Resident permit blocks | Not published as curbs | Only permit holder addresses from 2022 and a 2017 PDF map |

## The rules

- **Season.** Daytime sweeping runs April 1 to November 30 in most neighborhoods, and March 1 to
  December 31 in the North End, South End and Beacon Hill. Night sweeping on main and commercial streets
  runs all year. The file has no season dates per row, only `year_round` (361 rows) and `north_end_pilot`
  (333 rows: South End 192, North End 67, Beacon Hill 61, and 13 elsewhere). That the pilot flag means the
  March to December season is our inference, not documented.
- **Sides and weeks.** `side` is Odd or Even, by house number. The two sides usually share a weekday and
  alternate weeks (Odd on weeks 1 and 3, Even on weeks 2 and 4). "Week n" is the nth time that weekday
  falls in the month, the same rule SF uses. 113 rows are weeks 1, 3 and 5, so use the row's flags.
- **Hours.** Day rows are mostly 08:00 to 12:00 and 12:00 to 16:00, with 09:00 to 13:00 and 13:00 to 17:00
  also common. Night rows are 00:01 to 07:00 and similar. 301 rows start at 00:01, so hours are not always
  whole. 5 rows read 12:00 to 04:00 and are probably typos for 16:00.
- **Holidays.** On listed City holidays daytime sweeping is canceled and overnight sweeping runs as normal.
  Evacuation Day (March 17) and Bunker Hill Day (June 17) are normal sweeping days.
- **Fines and towing.** Street cleaning is $40 and towable. Overnight street cleaning is $90 with no tow.
  Charlestown is $90 with no tow. A tow is $132 plus $35 a day of storage. The posted sign wins.
- **Time.** Eastern time, with daylight saving.

## Gaps

1. No sweeping geometry or segment key in public data. Our join matched 3,422 of 3,758 rows on street
   name plus cross streets, and 3,220 also agree on length within 25%. The other 340 or so need the alias
   tables or hand fixes. Putting Odd and Even on the correct side of the line through the segment's
   address ranges is designed but not yet tested.
2. No season dates, tow flag or holiday flag per row. They have to be inferred.
3. No signal for same day cancellations (rain, events).
4. No citations, no current meter rates, no permit-only blocks.
5. Only the Analyze Boston datasets state a license.

## What to ask the City for

In order of how much work each one saves:

1. **The sweeping block geometry behind Notify Boston**, as a file on Analyze Boston, or permission to
   read that API. This removes the join.
2. **A data dictionary** for the schedule: what `north_end_pilot` means, what an empty `side` means
   (198 rows), season start and end per row, and a tow or no tow flag.
3. **A holiday calendar for sweeping** in a machine readable form, and any same day cancellation signal.
4. **Citation data** from the ticket system in use since June 2025: issue date and time, violation,
   location. No plates, no badge numbers. Street cleaning codes for the last two or three seasons would be
   enough to start.
5. **The official Curbs API**: timeline, terms, and whether the street name and side fields will be filled.
6. Current meter rates by zone, permit-only blocks, and a snow emergency status feed.
7. **How to coexist with Notify Boston**, so residents do not get two conflicting reminders.

## How Boston maps onto CURB

- Level 2 at launch: map, block sheet, alerts at `curb.guide/boston`.
- `scripts/cities/boston.mjs` reads the schedule and the street segments, joins them, splits rows that
  list several weekdays into one rule per weekday, and tags each rule with its season
  (`months: [4..11]` or `[3..12]`, none for year round rows).
- Time logic: `makeTimeCore({ tz: 'America/New_York', suspended, holidayName })`. The suspension rule is
  SF's two list model again: daytime rows skip City holidays, night rows do not.
- Known wrinkles for phase 1: the 00:01 start times (rounded down to midnight at first), and the alert
  watch age (120 days today) is one day shorter than the December to April break.
- First step when work starts: a one day test of the join on the full file, or of a dataset with geometry
  if the City provides one. That test decides the rest of the schedule.
