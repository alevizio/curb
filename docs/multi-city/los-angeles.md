# Los Angeles

Built 2026-10-18 by `scripts/cities/los-angeles.mjs` (format: [city-build.md](city-build.md)). Data in `data/los-angeles/`;
the numbers below are from `report.json` of that run.

## Short version

- The City publishes when each posted route is swept, but not which side of the street is swept on which day. Every
  route has two sweeping days (say Monday and Tuesday) for the same streets.
- LADOT publishes every parking ticket with its time and address (CC0). Each street cleaning ticket lands on a block and,
  by its house number, on a side of the street. The tickets answer the side question block by block.
- There is no rule per route: within one route, one street gets Monday on its north side and the next street on its
  south side (as if the sweeper drove a loop). So the side is decided per block, and a block without tickets takes the side
  of the nearest ticketed block on the same street and route (right 97.7% of the time one block away, in a holdout test).
- Result: 28,150 blocks, 55,403 block sides, 4,889 curb miles (StreetsLA says "more than 4,700 curb miles" are posted).
  Of the 900,142 street cleaning tickets placed on a block side, 89.8% land on a side the data says is swept that weekday,
  week and hour; with sides inferred from 2025 tickets only, 89.1% of 2026's do. Most of the rest (7.7%) land on the
  other side of a swept block: an address written for the other side of the street.

## How sweeping works in Los Angeles

- **Posted routes, every other week.** "Posted routes are swept on a biweekly basis, meaning on either the first and third
  weeks of the month or the second and fourth weeks of the month" (StreetsLA). "Week" is the nth time that weekday comes
  in the month, as in San Francisco: the 2026 calendar colors days 1-7 and 15-21 of each month one way, 8-14 and 22-28
  the other. Fifth weekdays are for unposted routes only (215 of 912,449 tickets fall on one).
- **Sides.** Each route has two polygons, one per day, with the same boundaries. One side of each street is swept on one
  day, the other side on the other day. The two days can share weeks (Monday and Tuesday, 1st and 3rd) or not (Thursday
  1st and 3rd, Wednesday 2nd and 4th).
- **Hours.** Posted windows, mostly 2 hours (8 to 10, 10 to 12, 12 to 2), some 3 (12 to 3, 8 to 11), a few with half
  hours (12 to 2:30, 7:30 to 9:30). Night routes 4 to 6:30 AM. Downtown (routes DT 1 to 3): every weeknight, 1 to 4 AM.
  99.6% of the tickets on a polygon's own day are written inside its window (15 minutes of slack).
- **Holidays.** No sweeping on City holidays, and no make-up day (StreetsLA's 2026 calendar marks them; 6 tickets were
  written on the 26 City holidays of 2025 and 2026, against about 2,000 on a normal weekday). City holidays (Administrative
  Code Sec. 4.119; the list below gives StreetsLA's 2026 calendar exactly): New Year's Day, Martin Luther King Jr. Day, Presidents' Day, César Chávez Day (last
  Monday of March), Memorial Day, Juneteenth, Independence Day, Labor Day, Indigenous Peoples' Day, Veterans Day,
  Thanksgiving and the day after, Christmas; a Saturday holiday moves to the Friday before, a Sunday one to the Monday
  after. Lincoln's Birthday is a normal day (2,347 and 3,010 tickets on it in 2025 and 2026). No season.
- **Fine.** $73 (every one of the 912,449 street cleaning tickets of 2025-26, violation 80.69BS "NO PARK/STREET CLEAN").
  No tow (a citation; tow-away street sweeping signs were not looked for). 524,709 tickets in 2025.

## Data

| Need | Source | Notes |
|---|---|---|
| Schedule | [Posted Street Sweeping Routes](https://services1.arcgis.com/PTh9WC0Sf2WS7AAq/arcgis/rest/services/Posted_Street_Sweeping_Routes_Update/FeatureServer/0) (StreetsLA, ArcGIS) | 871 polygons, 436 routes, "as of July 2026", edited 2026-09-09. Fields `Route`, `Posted_Day`, `Weeks`, `Posted_Time`, `Odd_Even` (the week pair, not the street side), `Boundaries`, `Maint_District`. Each polygon is a buffer of about 15 m around the streets of its route. No license stated |
| Street lines | [Streets (Centerline)](https://maps.lacity.org/lahub/rest/services/Street_Information/MapServer/36) (Bureau of Engineering, LA GeoHub) | 85,192 lines (85 ids twice, same line) with left and right address ranges, intersection ids, street designation. `ASSETID` is the block id (`c`). No license stated |
| Tickets | [Parking Citations](https://data.lacity.org/Transportation/Parking-Citations/4f5p-udkv) (LADOT, Socrata, CC0) | Daily, about two days behind. Read: date, time, location, coordinates of violation 80.69BS since 2025-01-01. No ticket numbers, plates or vehicles are read or kept. The coordinates are geocoded from the address |
| Holidays | [Street Sweeping 2026 Biweekly Schedule](https://streets.lacity.gov/sites/default/files/2025-12/Sweeping2026.pdf) (StreetsLA) | 2027 is not posted yet; `city.json` derives it from the same rules (`holidaysNote`) |
| Welcome card | [Neighborhood Councils (Certified)](https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/18) (LA GeoHub) | The 12 councils with the most swept block sides, by place name (councils named after something else are left out), for `city.json` `neighborhoods`. No `h` per block: council names are not all neighborhood names |

## How the build places it

1. **Blocks in routes.** A block belongs to a polygon when 60% of points every 8 m along its line, 18 m left out at each
   end (the intersections), are inside. 34,340 blocks are inside some polygon; the share is 0 or 1 for all but 597.
2. **Tickets on blocks.** By address: the block of that street whose address range holds the house number, the one
   nearest the ticket's coordinates when several do (N and S Main St share numbers); when that block is over 150 m from
   the coordinates and another block of the street is within 60 m, that one. The side comes from the number's parity.
   900,142 of 912,449 tickets placed (6,548 street names not found, 5,105 numbers out of range, 447 without a number).
3. **Each polygon against its tickets.** Left out: polygons with fewer than 5 tickets on their day, weeks and hours in 21
   months (5NP401 Thursday and Friday, 8NP100 Thursday, Skid Row Wednesday and Friday, DT 4: none at all in their
   windows), and Adams Bl ("As Available"). Widened to all four weeks where at least 20% of a polygon's tickets fall on
   its other weeks: 3P217 Friday (874 of 1,088 on the 2nd and 4th Fridays, the City says 1st and 3rd) and 3NP249 Tuesday
   and Wednesday (about a third and almost half).
4. **Sides.** Per block and route: tickets on day A by side and on day B by side; a block decides when one split leads by
   2 tickets and 70% (21,214 route groups). Else the nearest decided block of the same street and route, up to 8 blocks
   away (4,838), else its single ticket (728), else both days on both sides, flagged `u: 1` (1,984 groups, 1,977 blocks).
   A one polygon route (downtown's weeknights, a night route) goes on both sides (145). A route that wrote no ticket on
   a block held by another route that did is dropped there (its boundary street).
5. **Left out:** 5,635 arterial blocks and 72 boundary blocks inside a polygon with no street cleaning ticket of any kind
   in 21 months (Jefferson, Vermont, Olympic, Robertson...: likely swept but not posted), 264 boundary blocks whose tickets
   fit none of their rules, 219 blocks only in the polygons left out above.
6. **Lines.** Points within 25 cm of the line through their neighbors are dropped (161,781 to about 74,000 points).
   `segments.json` is 6.6 MB (1.45 MB gzipped), so the same blocks are also split by StreetsLA maintenance district
   (`segments-101.json` to `segments-224.json`, 70 to 580 KB each), indexed in `city.json` `segmentFiles`.

## Confidence

Per route, of the tickets on its blocks that pick a side, the share that agree with the side chosen: pooled 0.92; of the
430 routes with 30 or more such tickets, 73 at 0.95 or more, 225 at 0.90 to 0.95, 110 at 0.80 to 0.90, 22 at 0.70 to
0.80, none lower (`report.json` `routeConfidence`). The lowest are in the Valley (routes 19P, 22P, 23P: the San
Fernando, Granada Hills and Northridge maintenance districts).

Why the Valley is lower: on 2,589 blocks one day's tickets sit on one side and the other day's on both sides (1% to 23%
of well ticketed blocks in the twelve districts south of the hills, 44% to 68% in eight Valley districts: Woodland
Hills, Studio City, San Fernando, Van Nuys, Reseda, Granada Hills, Northridge, Canoga Park). The spread day typically has
a third of its tickets on the other side, tailing off toward a half, with no bump at a half. Read as addresses written from the
other side of the street (corner lots and side yards, more common on Valley blocks); the alternative, one side posted
for both days, would show up as a peak near a half. The build keeps one day per side; worth checking on the ground.

## Gaps and assumptions

1. Which side gets which day is inferred from tickets, not published. Unknown sides (1,977 blocks) show both days.
2. The City's week pairs are trusted except the three polygons above. 3P217 runs along Avalon Blvd (Martin Luther King
   Blvd to 56th St). A July 2026 L.A. Material analysis reported street sweeping tickets written on non-sweeping days,
   concentrated on an Avalon Blvd corridor in South Park (not verified to be this route). Either the schedule or the
   enforcement is off there, so the map warns on every Friday.
3. Blocks with no ticket in 21 months are left out on arterials and route boundaries (5,707) and kept on residential
   streets inside a route (4,228 kept blocks have no ticket of their own).
4. 2027 holidays are derived from the City's rules (14 dates, with New Year's Day 2028 observed on Friday 2027-12-31),
   not from a StreetsLA calendar.
5. No license is stated on the two ArcGIS layers.
6. Downtown DT 2 and DT 3 have a quarter to half of their tickets outside 1 to 4 AM; 12P353 Tuesday a quarter outside
   11 to 1. Kept as published.

## Questions for the City

1. Could the routes carry the side of the street per day (or the curb lines behind the polygons), so apps don't infer it?
2. 3P217 Friday: the routes say 1st and 3rd, 80% of its 2025-26 Friday tickets fall on the 2nd and 4th. Which is right?
   Same for 3NP249 (tickets in every week).
3. DT 4 (Arts District, 1 to 4 AM weeknights), Skid Row, 5NP401 and 8NP100: posted, but no tickets in their windows in
   21 months. Still posted, and what do the signs say?
4. Arterials inside route polygons (Jefferson, Vermont, Olympic...) with no street cleaning ticket since 2025: swept
   without posting, or posted?
5. Is any block posted for two days on one side? (2,589 blocks have one day's tickets on both sides.)
6. The 2027 sweeping calendar, and the license for the routes and centerline layers.

Contacts: StreetsLA External Relations Team, StreetsLA.ERT@lacity.org; open data, mayor.opendata@lacity.org.

## What the shared page needs that the format doesn't cover

- `u: 1` on a block: which side gets which day isn't known and both days are on both sides. The sheet should say so
  ("Which side is swept which day isn't known: move for both") rather than show two days as if the sign said both.
- `segmentFiles` in `city.json` (district files with bounds), if the page should load LA by area rather than one 6.6 MB file.
- `holidaysNote` and `ticketAgency` in `city.json` (2027 holidays derived; tickets are LADOT's, sweeping StreetsLA's).
