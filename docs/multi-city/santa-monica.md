# Santa Monica

Built 2026-10-18. Data build: `scripts/cities/santa-monica.mjs` → `data/santa-monica/` (format in
[city-build.md](city-build.md)); tests: `scripts/cities/santa-monica.test.mjs`.

## How the rule works

- **Weekly, posted, two hours.** Residential streets are swept once a week, and "NO PARKING" signs give each curb its
  day and a two hour window between 9 AM and 5 PM ([santamonica.gov/street-sweeping](https://www.santamonica.gov/street-sweeping):
  "Vehicles will be cited if they are parked in restricted areas on days when street cleaning is scheduled").
- **The two sides of a street have different days.** Of the 1,419 built blocks with both sides, 1,384 have different
  rules on each side.
- **Pico Blvd, three nights a week, 3 to 6 AM:** the south side Monday, Wednesday and Friday, the north side Tuesday,
  Thursday and Saturday. This is the rotating plan a 2015 City proposal described for the major streets ("cleaning from
  3 to 6 a.m. ... parking would be allowed on the side that isn't slated for sweeping that night"); in today's data only
  Pico Blvd has it.
- **Holidays**: no sweeping on 13 holidays (New Year's Day, MLK Day, Presidents' Day, Farmworkers Day on the last
  Monday of March, Memorial Day, Independence Day, Labor Day, Veterans Day, Thanksgiving and the Friday after,
  Christmas Eve, Christmas, New Year's Eve). A holiday on a Saturday is kept the Friday before, one on a Sunday the
  Monday after. 2026 exceptions on the same page: Juneteenth (Fri Jun 19) and Independence Day (Fri Jul 3, Sat Jul 4)
  had regular service. No make-up day. `holidayRule: "all"`.
- **Fine $73, no tow**: SMMC 3.12.845 Street Sweeping, $60.50 City penalty plus $12.50 State fees, in the FY 2026-27
  schedule ([santamonica.gov/fines](https://www.santamonica.gov/fines), Exhibit 3). The $72 often quoted is from 2020;
  the City's open data "Fines" dataset still says $64 (2022). Towing is only for posted tow-away and other violations
  ([Holiday Parking Enforcement](https://www.santamonica.gov/holiday-parking-enforcement)).
- Contact: 311@santamonica.gov (Public Works, Resource Recovery and Recycling).

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Street Sweeping](https://gis.santamonica.gov/server/rest/services/Street_Sweeping/FeatureServer/0) | 19,550 curb lines: `day` (Monday…Sunday, `MWF`, `TRSat`, or the text `null`) and `time` ("12-2") | One line per curb, median 15 m long. ODC-By 1.0. Item updated 2026-09-18. No names, ids or sides |
| [Street Centerlines](https://gis.santamonica.gov/server/rest/services/Street_Centerlines/FeatureServer/0) | 3,465 centerlines, 2,645 of them `type` STREET, with names and left/right address ranges | ODC-By 1.0 |
| [Neighborhood Organizations](https://gis.santamonica.gov/server/rest/services/Neighborhood_Organizations/FeatureServer/0) | 4 polygons: Mid-City, Ocean Park, Pico, Wilshire/Montana | The City's own boundary map (2021 PDF) has 7; North of Montana, Sunset Park and Northeast are missing from the layer |

No parking citations are published (data.santamonica.gov has 82 datasets, none of them tickets), so there is no
ticket cross-check.

## How it was placed

- **Hours.** The data writes hours without AM or PM. The residential windows run in a row from "9-11" to "3-5", the
  weekday shift, so an hour before 7 is read as afternoon: "12-2" is noon to 2 PM, "3-5" 3 to 5 PM, "3:30-5" 3:30 to
  5 PM, "7-9" 7 to 9 AM. Pico Blvd's `MWF`/`TRSat` "3-6" is read as 3 to 6 AM. `TRSat` is read as Tuesday, Thursday,
  Saturday (T, R, Sat), the other half of Pico's week; the City's map legend labels it "Thur/Sat".
- **Curb to block side.** Each scheduled curb line is sampled every 5 m. A sample goes to the nearest STREET centerline
  within 30 m running the same way (within about 37 degrees), on the side where it lies, left or right looking along the
  centerline. 325.2 of 326.9 km of scheduled curb are placed; 246 lines (1.2 km, mostly corner pieces of a few meters,
  the longest 209 m) are not.
- **What a side keeps.** A curb schedule covering at least 15% of the block and 15 m of curb (60% of a block under
  25 m). 66 sides with only stray corner curb (0.6 km) keep nothing. 13 sides keep two schedules, for example Stewart
  St's northeast side, Monday and Friday 1 to 3 PM: shown both.
- **Blocks** are the City's centerlines, keyed by `objectid_1`. The layer splits streets where nothing crosses, so a
  block's cross streets are found by walking along the street to the next street within 12 m. 380 centerlines under 20 m
  with a cross street at both ends (intersections, median crossings of divided streets) are left out.
- House numbers and the odd side come from the address ranges (odd on the left on 1,633 of 1,648 blocks).
- Left out: 6,141 curb lines with no day (110 km: not swept, or not posted) and 34 with a day but no hours (33
  Wednesday, among them 19th St).

Result (`data/santa-monica/report.json`): **1,649 blocks, 3,068 sides, 3,261 rules**. `segments.json` is 481 KB.

## Unverified

1. AM and PM (above), `TRSat` as Tuesday/Thursday/Saturday, and "Sunday 11-1" (14 sides on Nebraska Ave, Stanford St
   and Berkeley St, read 11 AM to 1 PM). A look at a few signs would settle all three.
2. Veterans Day: the street sweeping page lists it, the Holiday Parking Enforcement page does not (and lists Juneteenth,
   which the 2026 note sweeps). Built with the street sweeping page.
3. 2027 holidays are derived from the page's rule; the City posts each year's exceptions. Juneteenth 2027 (Saturday,
   kept Friday Jun 18?) is left out, as in 2026.
4. `objectid_1` is the only unique key in the centerline layer; if the City republishes it, ids could change (saved
   alerts are keyed on them).

## Questions for the City

1. Do the `time` values mean the hours on the signs, with the residential windows all between 9 AM and 5 PM and Pico
   Blvd's 3 to 6 AM? Is `TRSat` Tuesday, Thursday and Saturday?
2. The 6,141 curb lines with no day: not swept, or swept without signs?
3. Veterans Day and Juneteenth: which of the two holiday lists is current? Are 2027's exceptions known?
4. Could the layer carry a stable curb or block id and the street name, and the three missing neighborhood areas?
5. Would the City publish parking citations (date, time, location, violation) like Los Angeles does?

## What the page needs

- No `neighborhoods` list in `city.json`: the City's layer has 4 of its 7 neighborhood organizations, so blocks in the
  other three have no `h`.
- Pico Blvd's rules are overnight (3 to 6 AM) on six days a week, one curb at a time; the night wording already in
  `lib/sweep-core.js` covers them.
