# Saint Paul

Built 2026-10-18, the day before the fall residential sweep started. Data build: `scripts/cities/saint-paul.mjs` →
`data/saint-paul/` (format in [city-build.md](city-build.md)); tests: `scripts/cities/saint-paul.test.mjs`.

## How the rule works

Saint Paul sweeps its 530 miles of residential streets twice a year, in spring and fall, neighborhood by neighborhood.
The fall 2026 sweep started Monday, October 19, for "up to six weeks, weather permitting" (City news release).

- Each block is swept on one day. Public Works posts temporary "No Parking" signs on the block 24 to 48 hours ahead
  (elsewhere on the same page: "at least 24 hours").
- On that day, parking is banned **8 a.m. to 6 p.m.** Cars in the posted zone "could be ticketed and towed".
- The order rotates every season, so there is no weekly pattern: each block has a date. CURB stores it as a date list
  rule, `[-1, 8, 18, 0, 0, 2, ["2026-10-20"]]` (flags 2 = towable).
- The City's map popup: "These dates may be rescheduled with short notice due to weather and/or staffing resources.
  Please check for posted signs along the street."

Not modeled:

- **Arterial overnight "sanitation bans"**: year round, posted on many arterials and downtown. A 2020 City memo
  (Overnight Parking Restrictions on Summit Avenue) says most run 2 to 7 a.m., "from one night a week to every night of
  the week". The data gives 3,359 of the 4,919 arterial blocks a night route per side (`M-3-N` = Monday, north side),
  and these match the memo's examples on Grand Ave (north side Monday, south side Tuesday), Dale St (east Monday, west
  Thursday) and Cleveland Ave (Friday). But Snelling Ave, posted Monday, Wednesday and Friday on one side and Tuesday,
  Thursday and Saturday on the other, has one night per side in the data, and no hours are in the data at all. A one
  night rule would call a banned night free, so arterials are left out until the City publishes the posted nights and
  hours.
- **Snow emergencies**: they depend on a declaration.
- **The weekly alternate side parking pilot**: winter only, in two small pilot areas (January to April in 2025 and
  2026, ticket and tow; layer `Weekly_Alternate_Side_Parking`). No word yet on winter 2027.
- **Alleys**: swept only in spring, and nobody parks there.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Street Sweeping](https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Street_Sweeping/FeatureServer/0) (Public Works) | 11,882 block lines with address ranges, cross streets, the day route (`DAY_RTE`), night routes, `SweepOperation` (Seasonal, Arterial, Highway) and, during a sweep, `SweepDate` | "The authoritative data source for street sweeping routes", and the layer the City's [Street Sweep Map](https://stpaul.maps.arcgis.com/apps/instant/interactivelegend/index.html?appid=c2af26c6795845528e5aa2bac4475e84) draws. Edited 2026-10-18. 6,574 blocks have a date, Oct 19 to Nov 18 2026 |
| [District Councils](https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/District_Councils/FeatureServer/0) | The 17 planning districts | Each block's `h`, and the welcome card. Public domain |
| [Centerlines](https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Centerlines/FeatureServer/0) (2019) | Street names and ranges | Only for the 33 swept blocks whose name is blank in the sweeping layer |
| [Parking citations 2025](https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/ParkingCitationsSPPD_2025_public_view/FeatureServer/0) (Police) | Date, time, statute, a block point | Only for the hours check below. Fetched without the comment or location text |

The layers also carry editors' user names; the build never requests them. The sweep map's license is the City's GIS
notice under the Minnesota Government Data Practices Act: the data is provided as is, and **a copy must include the
notice**. The full notice is in `segments.json` (`_meta.notice`) and the page's data notes say so.

## How it was placed

- Every block with a `SweepDate` becomes one block of `segments.json`, keyed by its `OBJECTID`. OBJECTIDs (and
  GlobalIDs) matched the 2022 copy of the same layer on 11,771 blocks, so they survive seasons; the route codes do not
  (all 77 are new this fall).
- The date is the SweepDate's calendar date in Saint Paul (it is stored as 06:01 UTC, 1:01 a.m. local).
- **Both sides get the date.** The layer has one date per block and no side, the City's map shows one date per block,
  and no City page says the sides are swept on different days.
- Each of the 77 routes has exactly one date. No date falls on a weekend or a City holiday: there are no sweeps on
  Nov 3 (Election Day) or Nov 11 (Veterans Day).
- Left and right are read from the line's drawing direction, the odd side from the address ranges. Odd numbers land on
  the west or north side on 97% of the 6,289 blocks with ranges, which is how a consistent grid looks.
- Cross streets are written from the line's first point to its last (87 were stored the other way round and are
  swapped). Streets on the city limits (Hoyt Ave W, McKnight Rd N) take the nearest district.
- Left out: 111 unnamed pieces under 20 m (intersection slivers), 1 unnamed block with no centerline under it, and
  blocks without a date (4,918 arterial, 328 highway, 30 residential not scheduled, 32 private drives and blank rows).
- House numbers never reach the output. A few rows name a street by an address (an access road, private drives);
  the build strips the numbers.

Result (`data/saint-paul/report.json`): **6,462 blocks, 12,924 sides, 21 sweep days**, 161 to 431 blocks a day.
`segments.json` is 1.7 MB.

### Hours check against 2025 tickets

The City publishes 2025's parking tickets with a time and a block point. During the 2025 fall sweep (Oct 16 to
Nov 26, weekdays), 961 no-parking-zone tickets (Minn. Stat. 169.34 subd. 1(a)(14)) landed on residential blocks; 85.5%
were written between 8 a.m. and 6 p.m., none before 7 a.m., most between 9 a.m. and noon. That fits the posted window
but proves little: the statute covers every no parking sign (construction, events, the summer sweep), a block point
cannot tell the side, and 2025's dates per block are not published, so the dates cannot be checked.

## Gaps

1. **The fine.** No City page gives it. Tickets during sweeps are written as "no parking zone" (169.34), whose 2025
   statewide payable is $25 plus a $12 surcharge, $37, if the City uses it for sweeping. The snow emergency ticket is
   $56 under a City code. `city.json` leaves `fine` empty until the City answers.
2. **Dates move.** Rescheduled blocks change in the layer, so the build should run daily during a sweep. A saved alert
   on a block whose date moved needs the new date: the build keeps the block id, so an alert follows the block.
3. **Sides.** Assumed swept the same day (above).
4. **Signs.** The operations page also says streets "may or may not be posted in advance". The sign on the block wins.
5. **2027 holidays** are derived from the City's eleven paid holidays (policy 209.00) and the Minnesota weekend rule
   (Minn. Stat. 645.44 subd. 5), not published.

## Questions for the City

Send to publicworksinfo@stpaul.gov.

1. What is the fine for parking on a block during its posted residential sweep, and what does the tow cost?
2. Are both sides of a residential block always swept on the block's `SweepDate`?
3. When a block is rescheduled, is `SweepDate` updated the same day, and are the signs moved with it? How late can a date change?
4. Could the posted nights and hours of the arterial overnight bans be added to the layer? The night route codes
   give one weekday per side, and some streets (Snelling Ave) are posted three nights a side.
5. Is `OBJECTID` stable from season to season, so saved alerts keep working next spring?
6. When will the spring 2027 dates be published, and in the same layer?
7. Will the weekly alternate side parking pilot run again this winter, and where?

## What the page needs that the format does not cover

- Date list rules: the next sweep is the first listed date not yet over; nothing repeats. The list is final (City
  holidays are already absent), so the page need not suspend listed dates again.
- A way to say "dates can move": `words.afterpass` says it, but an alert armed weeks ahead should re-read the block's
  dates before it fires.
- The City's GIS notice must travel with the data: its full text is in `segments.json` `_meta.notice`, and the data
  notes say so.
- `fine` is empty: the sheet and the alerts should leave the amount out rather than print "$".
