# Glendale (California)

Built 2026-10-18. Data build: `scripts/cities/glendale.mjs` → `data/glendale/` (format in [city-build.md](city-build.md));
tests: `scripts/cities/glendale.test.mjs`. The curb placement is shared with Santa Monica (`scripts/cities/santa-monica.mjs`).

## How the rule works

- **Weekly, posted.** The City's street sweeping page (glendaleca.gov now opens
  [glendalerecycles.com/street-sweeping](https://glendalerecycles.com/street-sweeping/), Integrated Waste Management):
  "Parking restrictions are enforced based on the posted day and time, even if the sweeper has already passed." The
  code bans parking only where a street "is posted with signs which give notice that parking is prohibited for street
  cleaning purposes" (GMC 10.36.110). Towing needs tow-away signs posted 24 hours ahead (10.36.120): none in the data.
- **Posted windows** are 1 to 4 hours (8 to 10 AM, 8 to 11 AM, 9 AM to noon, noon to 2 PM…), on weekdays, mostly in
  south and central Glendale. Commercial streets have overnight windows: Monday 3 to 6:30 AM, Tuesday 3 to 6 AM.
- **The two sides often differ.** Of the 1,282 built blocks with both sides, 893 have a different day or window on each
  side (Vassar St: one side Thursday, the other Friday). On Street View, E Harvard St's north curb has a sign naming
  Wednesday, the day the data gives that curb, and the south curb is Tuesday.
- **Holidays**: "Street sweeping does not occur on the following holidays: New Year's Day, President's Day, Memorial
  Day, Independence Day, Juneteenth, Labor Day, Veterans Day, Thanksgiving Day, Christmas Day", and "Parking enforcement
  is also suspended for street sweeping on these holidays"; the sweep resumes on the next regular day (no make-up).
  `holidayRule: "all"`. The page names no observed day for a weekend holiday, so only the holidays' own dates are listed.
- **Fine: not found.** No City page or published schedule gives the street sweeping fine; `fine` is `null` and the
  words leave the amount out.
- Contact: Integrated Waste Management's street sweeping line; parking enforcement questions go to the Police
  Department (both on the page above).

## The data

| Source | What it gives | Notes |
|---|---|---|
| [PW/StreetSweeping](https://gismap.glendaleca.gov/arcgis/rest/services/PW/StreetSweeping/MapServer/0) ("SweepRoutes") | 12,596 lines with `Day` and `Time` ("Monday", "8AM-12PM"), nothing else | The layer behind the City's [Street Sweeping Map](https://experience.arcgis.com/experience/fdda24d2559e43dd97c50a2a1aa2ddb2), which shows the same two fields. No license stated |
| [Common/Streets](https://gismap.glendaleca.gov/arcgis/rest/services/Common/Streets/FeatureServer/0) | 8,070 centerlines with names, type and address ranges | From LA County CAMS, edited by the City. 978 Primary, Secondary or Minor pieces have no name |
| [Common/NeighborhoodZones](https://gismap.glendaleca.gov/arcgis/rest/services/Common/NeighborhoodZones/FeatureServer/1) | The City's 37 neighborhoods | `h`, and the welcome card (16 with at least 20 posted blocks) |

No parking citations are published, so there is no ticket cross-check.

## How it was placed

- **The lines are curbs, one per side**, 6 to 10 m off the street centerline (median 7.9 m), though the layer has no
  side field. So the sides are told apart by geometry, as in Santa Monica: each line is sampled every 5 m and goes to
  the nearest Primary, Secondary or Minor centerline within 30 m running the same way, on the side where it lies.
  1,056 of 1,113 km are placed.
- **8 AM to 3 PM is left off.** 9,032 lines (774 km, 72%) read 8 AM to 3 PM, a seven hour shift rather than a sign
  window. They cover most hillside and low density streets; Street View (2022 to 2025) shows no sweeping signs on the
  four such blocks checked (Cordova Ave, E Palmer Ave, W Windsor Rd, W Harvard St), while the posted windows sit where
  parking is dense and their signs are there. Since Glendale tickets only where signs are posted, these 5,625 sides
  (2,922 blocks with nothing else) stay off the map until the City confirms them; `SHIFT_IS_POSTED = true` in the build
  puts them back.
- **Unnamed centerlines.** 151 of the 978 unnamed pieces take the name of the street they continue in a straight line.
  Lines on the rest are left off: 223 sides (19 km) run down the middle of alleys and lanes (within 4 m of the
  centerline), and 189 sides (9 km) sit along curbs of streets the layer does not name.
- What a side keeps, cross streets and intersection pieces: as in Santa Monica (15% of the block and 15 m of curb; cross
  streets found within 12 m; 260 pieces under 20 m between two cross streets left out).
- Left out as well: 452 lines with hours but no day (41 km); 1,101 lines (49 km) with no centerline of the right kind
  within 30 m: along the railroad, inside business parks whose streets are not in the layer (Grand Central), or where
  the curb line strays from the centerline (20 km of them are 8 AM to 3 PM, 11 km overnight commercial windows).

Result (`data/glendale/report.json`): **1,505 blocks, 2,787 sides, 2,796 rules**. `segments.json` is 371 KB.

## Unverified

1. That 8 AM to 3 PM streets are unposted (four Street View checks), and that every other window is posted.
2. The fine (not published), and whether a weekend holiday is kept on the Friday before or the Monday after (2026-07-03,
   2027-06-18, 2027-07-05, 2027-12-24 are not listed, so the map shows sweeps those days).
3. Block ids are the Streets layer's `OBJECTID`, its only key; a republish of the layer could renumber them.

## Questions for the City

1. Are the streets whose map hours read 8 AM to 3 PM posted with no parking signs? If not, could the layer say which
   curbs are posted?
2. What is the street sweeping fine (GMC 10.36.110), and where is the parking penalty schedule published?
3. When a sweeping holiday falls on a Saturday or a Sunday, is the Friday or Monday off?
4. Could the layer carry a stable id, the street name and the side, and could the 978 unnamed centerlines get names?
5. What are the terms of use for the GIS layers? None are stated.

## What the page needs

- `fine` is `null`: the sheet and the alert copy must not print an amount for Glendale.
- `words.afterpass` says "ticket, no tow" without an amount.
