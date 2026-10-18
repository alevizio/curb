# Riverside

Built 2026-10-18. Data build: `scripts/cities/riverside.mjs` → `data/riverside/` (format in [city-build.md](city-build.md));
tests: `scripts/cities/riverside.test.mjs`.

## How the rule works

- Neighborhood streets are swept **twice a month**, on the **1st and 3rd** or the **2nd and 4th** Tuesday, Wednesday,
  Thursday or Friday, **7:30 to 11:30 AM** or **11:30 AM to 3:30 PM** (the City's
  [Street Sweeping Program](https://riversideca.gov/publicworks/streets/street-sweeping/street-sweeping-program) page).
  Signs are posted on the streets; "Citations are issued when your vehicle is not moved off the street on scheduled
  street sweeping days and time."
- "1st & 3rd" counts the weekday's occurrences in the month: the City's
  [2026 calendar](https://riversideca.gov/publicworks/streets/street-sweeping/street-sweeping-calendar) colors each
  Tuesday to Friday blue (1st and 3rd), yellow (2nd and 4th) or blank (a 5th one). Weeks masks 5 and 10.
- No sweeping on Mondays, weekends or City holidays. "If my sweeping day is a holiday does my street get swept that
  week? No. Sweeping will resume on the next regular sweeping day." So `holidayRule` is `all`, with no make-up day.
- **$46** (RMC 10.52.030(a), "no stopping, standing, or parking during posted street sweeping days/hrs", Fees and
  Charges as of July 1, 2026). No tow is mentioned.
- Main thoroughfares are swept weekly, outside the zone schedule; their posting is not published, so they are not
  shown. Private streets and streets without curb and gutter are not swept.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Street Sweeping Zones](https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/Street_Sweeping_Zones/FeatureServer/0) (Public Works, open data) | 136 polygons: route code (`StreetSweepRoute`), weekday, a zone number | Edited 2026-09-23; created 2023-04-05, four zones edited 2023-04-04. 92 swept, 44 `NOSWEEP`. No week pair, no hours |
| [Street Sweeping Schedule](https://riversideca.gov/publicworks/sites/riversideca.gov.publicworks/files/Street%20Sweeping%20Schedule.pdf) map (City of Riverside) | Every zone filled with its schedule's color ("1st & 3rd Tues. AM" ...) and labeled with the same route codes | An ArcMap export dated 2015-07-09, still on the City's site (the same map was "Street-Sweeping-Web-Map.pdf" on the old site, archived 2015 to 2022). The only City source for the week pair |
| [Streets](https://gis.countyofriverside.us/arcgis_Mapping/rest/services/OpenData/Transportation/MapServer/0) (Riverside County TLMA GIS) | One line per block with names, address ranges, road class and a `GLOBALID` | The County's road and geocoding network, cities included. County open data, public use |
| [Street Centerlines](https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/Riverside_Street_Centerline/FeatureServer/0) (City) | `OwnedBy` per piece | Only to drop private streets. Its lines are survey pieces (one per course), not blocks, so it is not the block layer |
| [Neighborhoods](https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/RiversideNeighborhoods/FeatureServer/0) (City) | The 28 neighborhoods | Each block's `h`, and the welcome card |

The City's Street Sweeping page itself is empty (its two subpages, the program and the calendar, are not); no route
lookup or app config was found.

## Decoding the route codes

- **First digit = weekday**: 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday. The layer's own `StreetSweepDay` agrees on
  every zone.
- **A = 7:30 to 11:30 AM, P = 11:30 AM to 3:30 PM**: the map's legend has an AM and a PM color for each weekday and week
  pair, and the label colors match A and P on every route.
- **Week pair: from the map.** Each route label's surrounding color was matched to the legend: on all 38 routes the map
  shows, odd route numbers are 1st & 3rd and even ones 2nd & 4th (`MAP_WEEKS` in the build lists only those 38).
- **Side-by-side zones** ("206/7", "208/9", "506/7", "30911" = 309/11): the legend has three such schedules.
  309/11 is "1st & 3rd Wed. AM Odd Side / PM Even Side": the odd numbered side 7:30 to 11:30, the even side 11:30 to
  3:30, both on the 1st and 3rd Wednesday, placed by the County's address ranges (131 sides). 206/7 and 208/9
  ("1st & 3rd Tues. Odd Side / 2nd & 4th Tues. Even Side") and 506/7 (the same on Friday, Downtown) give no window, so
  they are left out.

How the map was read (once, by hand; the numbers are in `report.json` → `mapCheck`): the PDF is georeferenced (its
viewport carries the latitude and longitude of its corners, GPTS, in NAD83 State Plane California VI). The route labels'
positions came from the PDF's text; each label's surrounding fill color, sampled from the rendered page, was matched
to the legend patches. Then each current zone was sampled on a grid of interior points projected onto the map (a
bilinear fit of the four corners; the labels land inside their own zones, one 27 m off) and each point classified by
the nearest legend color. **87 of the 92 swept zones show their own weekday, window and one week pair** (84% to 100% of
their points, median 99%). The other five are below. The label colors, legend colors and per-zone counts are saved
in `private/cache/riverside/evidence/` (gitignored) with the two City PDFs.

- **313A, 313P, 315A, 315P** (Wednesday): the four zones edited in April 2023 (their zone number, 21, is Friday's).
  The map shows 1st & 3rd *Friday* there (the old routes 511 and 513). Odd routes are 1st & 3rd everywhere else, so
  1st & 3rd Wednesday is likely, but no City source says so: **left out** (306 block lines).
- **406A's second polygon**: the map colors it as 2nd & 4th Thursday PM; the layer says A. Same weeks; the build uses
  the layer's morning window (the newer source) and the report flags it.

## How it was placed

- Blocks are the County's collector and residential street lines (CLASS 11 and 12). Freeways, highways, ramps,
  expressways, major roads and arterials (CLASS 1 to 10: 1,508 arterial and major road lines cross swept zones) and
  tentative streets are left out, and so are lines named "Ramp", "Walkway", "Street A" or "<access Road>" and alleys.
- **Each side takes the zone it lies in**: every 5 m along the line, points 9 m to its left and right are placed in a
  zone. Zone polygons are drawn on street centerlines, so a boundary street gets each side's own schedule (520 blocks);
  where a boundary crosses a block, the line is cut there (132 lines; pieces under 15 m join their longer neighbor).
  A side in a `NOSWEEP` zone gets no rule. An independent check (a point 12 m out at each block's middle) agrees on
  99.6% of sides; the rest are short stubs at zone corners.
- Private streets: lines with half their length or more within 8 m of a City centerline owned by `Private` (596 lines,
  mostly gated tracts).
- Ids: `c` is the County line's `GLOBALID`, with `-1`, `-2` added when a zone boundary cuts it.
- `l` = the cross streets at each end (walking on along the same street where a line is split mid-block), `o` = the
  odd side from the address ranges, compass labels as in Boston (`Odd side` / `Even side` in zone 309/11).

Result (`data/riverside/report.json`): **7,669 blocks, 15,144 sides, 15,144 rules** in 85 of the 92 swept zones.
`segments.json` is 2.9 MB.

## Gaps

1. The week pair of zones 313A, 313P, 315A and 315P (left out).
2. The hours of the side-by-side zones 206/7, 208/9 and 506/7 (left out; Downtown is 506/7). A 2022 to 2023 Downtown
   pilot swept one side 1st & 3rd and the other 2nd & 4th, Fridays 7 to 11 AM; what was posted after it ended is not
   published.
3. Zone 406A's second polygon: AM (layer) or PM (2015 map).
4. Whether arterials inside zones carry the zone's signs (left out), and which residential streets lack curb and gutter
   (shown, though the City does not sweep them).
5. 2027 holidays are derived from the 2026 calendar's list and weekend rule.

## What to ask the City

1. Zones 313A, 313P, 315A and 315P (Wednesday since 2023): 1st & 3rd or 2nd & 4th Wednesday?
2. Zones 206/7 and 208/9 (Tuesday) and 506/7 (Friday, Downtown): what hours are posted on each side?
3. Zone 406A: is the part that was route 406P in 2015 now swept in the morning?
4. Could the Street Sweeping Zones layer carry the week pair and the hours, so the schedule no longer depends on the
   2015 map?
5. Are main thoroughfares posted for their weekly sweeping, and when?
