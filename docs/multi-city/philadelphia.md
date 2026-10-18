# Philadelphia

Built 2026-10-18, eleven days before the 2026 season ends. Data build: `scripts/cities/philadelphia.mjs` →
`data/philadelphia/` (format in [city-build.md](city-build.md)); tests: `scripts/cities/philadelphia.test.mjs`.

## How the rule works

Philadelphia's **Mechanical Street Cleaning** program (Department of Sanitation) sweeps 14 neighborhoods picked by the
City's Litter Index. It is not citywide: most of the city has no posted sweeping.

- **Season:** April 6 to October 29, 2026, Monday to Thursday, between 9 a.m. and 3 p.m. The City's page: "No service
  is performed on City-observed holidays, but crews resume cleaning the following week" (no make up day).
- **Signs:** one posted two hour window per block, staggered: 9 to 11 a.m., 11 a.m. to 1 p.m., or 1 to 3 p.m. Both
  sides of a block usually share the day and window; on 281 blocks (Frankford Ave, Aramingo Ave and E Allegheny Ave
  among them) the two sides have different days, same window.
- **Only some blocks are signed.** The April 2026 releases: "there will be restricted parking on some streets in all 14
  areas", chosen "based on the width of each block"; "enforcement will occur on streets that have posted signage". The
  route data does not say which blocks those are (see Gaps).
- **Fine:** $31, Philadelphia Parking Authority table, Code 12-903(6) "No Parking Street Cleaning" (same amount in and
  out of Center City). No tow. Enforcement started April 20, 2026 after a warning period. Tickets are written "during
  specified no parking times"; news reports add that they are written only where the broom actually runs that day (not
  on a City page).
- **Holidays:** the City-observed list (Sanitation's palm card and the City's own holiday API,
  `api.phila.gov/phila/trashday/v1`, which lists the current year): 13 days. In season and on a sweeping weekday only
  Memorial Day, Labor Day and Indigenous Peoples' Day matter. `holidayRule: all`.

The 14 areas and their boundaries are on the [cleaning schedule page](https://www.phila.gov/programs/mechanical-street-cleaning/cleaning-schedule/):
Frankford, Germantown, Kensington, Logan, Nicetown, North Central, Paschall, Point Breeze, Port Richmond, South
Philadelphia, Southwest, Strawberry Mansion, West Fairhill, West Philadelphia. They are the `h` of every block and the
welcome card's list.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [SweepPHL Route Locations](https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Broom_Routes_SweepPHL/FeatureServer/0) (Streets Department) | 8,209 route blocks: the City's street segment (`SEG_ID`, address ranges, node ids), area (`Name`), `Day`, `Time`, `EVEN_SIDE_DAY`, `ODD_SIDE_DAY` | The layer behind SweepPHL on StreetSmartPHL. Data edited 2026-07-17. No license stated and not in the OpenDataPhilly catalog |
| [Street Centerline](https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Street_Centerline/FeatureServer/0) (OpenDataPhilly) | 41,252 segments: node ids and names only | Cross streets: the other streets at a block's two nodes. The route layer's node ids are the centerline's |

Clean up, all in `report.json`: `Time` "1PM - 3PMl" (10 rows) read as 1 to 3 p.m.; 310 street names padded with
spaces ("  OREGON                        AVE"); 38 rows with both side days blank take the single `Day` ("WED"); 2 rows
with one side blank take the other day of the `Day` pair ("MON - WED"). The `Day` pair's order is not even then odd (147
of the 281 two day rows list the odd side's day first), so it is never used to place a side. Two area names are written as the
City's page writes them (West Philly → West Philadelphia, South Philly → South Philadelphia).

## How it was placed

- Each route row is one block, keyed by `SEG_ID` (the City's permanent segment id, unique in the layer).
- The odd side comes from the address ranges (`L_F_ADD`, `R_F_ADD` …). Checked: addresses rise from the line's first
  point to its last on 8,200 of 8,201 segments with numbers, and the odd side faces north or east (or northeast,
  northwest, southeast where the grid turns) on 8,127 of 8,201, which is Philadelphia's rule (520 Chestnut St,
  Independence Hall, is on the south side). So the layer's left and right are the drawn line's, and an even side day
  goes on the even side.
- Rule: `[weekday, from, to, 31, 1016, 0]`, every week, April to October, not towable, stopped by City holidays.
- Left out (17 rows, with examples in the report): 14 segments the City classes as not travelable (class 12: Temple's
  walks such as Polett Walk, and closed streets in the Logan Triangle), 1 Roosevelt Blvd ramp (class 1), 1 SEPTA
  driveway with no house numbers (class 6). And 2 blocks whose sides have different days but no address numbers (Wayne
  Ave and Germantown Ave in Nicetown): not guessed.
- Checked by hand against the City's route maps (PDF) linked from the schedule page: South Philadelphia (map dated March
  2020; every street's day and the 9 to 11 window match) and Port Richmond (map dated March 2026; 1 to 3 p.m., and the
  two day streets are drawn in both days' colors). The maps cannot say which side is which.

Result: 8,191 blocks, 16,382 sides, 1.9 MB.

## Gaps

1. **Which blocks are signed.** The routes include every block the broom runs; the City says no parking signs are on
   "some streets", by width. The map shows every route block with the sign caveat in the data notes. This is the
   biggest accuracy question for Philadelphia.
2. **Season edges.** The months mask (April to October) also marks April 1 and 2 (Wednesday and Thursday) as swept; the
   2026 season started Monday April 6. The 2027 dates are not out (April 1, 2027 is a Thursday). The core has no way to
   start a season mid month (see "What the page needs").
3. **Season words carry 2026 dates** (`words.rule`): rebuild when the City posts 2027.
4. **No citations** with time and place after 2017 on OpenDataPhilly, so no check that tickets land on the posted
   blocks and hours.
5. **License:** the route layer states none.
6. **2027 holidays** are derived (the same 13); weekend holidays are kept on their own dates, as the City's API lists
   2026's (July 4, 2026 is a Saturday). Monday July 5, 2027 is not listed as a holiday.

## Questions for the City

To the Open Data Program (maps@phila.gov) and Sanitation (MechanicalCleaning@phila.gov):

1. Could the route layer say which blocks have posted no parking signs (a yes or no per segment and side)?
2. Could the layer carry the season's start and end dates, and the enforcement start, so apps don't hard code them?
3. When the two sides have different days, is `EVEN_SIDE_DAY` always the even house number side? (The data says so on
   every block we could check; confirming it would let apps rely on it.)
4. Is Monday July 5, 2027 (Independence Day observed) a no cleaning day?
5. Could the layer be listed on OpenDataPhilly with a license, like the Street Centerline?
6. Parking violations data after 2017 (date, time, location, code 12-903(6)) to check the posted windows.

## What the page needs that the format does not cover

- **Season start and end dates** in city.json (for example `"season": {"from": "2026-04-06", "to": "2026-10-29"}`)
  for the time core to clip a months mask, so April 1 and 2 don't show as sweep days.
- A per block or per city **"signs on some blocks only"** flag, so the sheet can say "check for a posted sign on this
  block" more strongly than the general "the sign wins".
