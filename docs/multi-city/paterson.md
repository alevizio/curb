# Paterson

Built 2026-10-18. Data build: `scripts/cities/paterson.mjs` → `data/paterson/` (format in [city-build.md](city-build.md));
tests: `scripts/cities/paterson.test.mjs`.

## How the rule works

- Each route is swept **two days a week**, on the days and hours posted on the block: mornings **8 AM to noon** or
  afternoons **1 to 3:30 PM** (one route 1 to 3 PM), Monday to Friday. The routes are named in pairs ("Route 3A&3B",
  "S1A&B"), which reads as one side per day, but nothing published says which side goes on which day.
- **Downtown** is swept daily, **6 to 8 AM**. "Daily" is all the City's map says.
- **Bunker Hill** (the industrial area north of the river) is swept on Saturdays; the map gives no hours.
- Paterson Code § 435-131: an unoccupied vehicle parked "during said street's designated days and hours for street
  cleaning" shall be removed (towed), the owner paying removal and storage. § 435-132: **$50**, payable without a court
  appearance, plus **$30** court costs.
- The street cleaning schedule itself is a separate ordinance, "not included in codification" (the code's disposition
  list): the days and hours are only on the signs and the City's map. A 2020 notice from Public Works: "Signs are
  posted on neighborhood streets indicating the respective day and time for scheduled cleaning."
- Not modeled: the monthly "Clean Sweep" (one street per Friday, both sides, 8 AM to noon, tow; the July 2026 list is
  the latest posted, all dates past), and snow emergencies.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Street Sweeping Map](https://services7.arcgis.com/24MTNeTGsw9FVZm6/arcgis/rest/services/City_of_Paterson_Street_Sweeping_Map_WFL1/FeatureServer/0) (City of Paterson, [web map](https://www.arcgis.com/apps/mapviewer/index.html?webmap=59a6a355c8384b9da3f0d9afee8f61ae)) | 601 lines: `Route`, `Time` ("Monday& Tuesday 8:00AM - 12:00PM") | Edited 2026-07-29. No street names, no block ids, no side. An earlier copy ("Street Sweeping Route and Time", 593 lines, 2026-07-24) differs on 7 routes' times and has other ids. No license stated; the City's open data guidance asks users to cite the City of Paterson Open Data Portal |
| [Road Centerlines of NJ](https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Tran_road/FeatureServer/0), NG9-1-1 (NJ Office of GIS) | One line per block: names, address ranges with parity, municipality codes, a stable `RCL_NGUID` | Edited 2026-09-23. 3,501 lines in Paterson (`INCMUNI` 885343). NJOGIS conditions of use; acknowledgement requested |
| [Ward boundaries](https://services7.arcgis.com/24MTNeTGsw9FVZm6/arcgis/rest/services/Paterson_Ward_Lookup_Map/FeatureServer/0) | The 6 wards | Each block's `h` and the welcome card. Only the ward number is read (the layer also names council members) |

No street sweeping page exists on patersonnj.gov (Public Works lists none); the map above is not linked from the site
either, but it is the City's public layer, edited this summer.

## How it was placed

- **City lines to blocks.** The City's lines are hand drawn over a basemap and run along routes, not blocks. Each State
  centerline block is sampled every 4 m (5 m in from each end); a sample counts when a City line runs within 10 m in
  the same direction (within about 32°). A block is swept when half its samples or more are on City lines, and takes the
  schedule of every line holding a quarter of them. 97% of the City lines' points lie within 6 m of a State centerline.
  A second pass widens the distance to 30 m for a City line already laid on blocks of the same street name, because
  some lines drift (South Main Street's by up to 27 m): 49 blocks were placed that way.
- **Ids.** `c` is the block's `RCL_NGUID` in the State's centerlines (stable since 2013), not the City's line
  `OBJECTID`, which changed when the City republished its map in July.
- **Both days on both sides.** The map gives a route two days and no side; no City page, PDF, ordinance or news item
  found says "north and east sides Monday". So every side lists both days of its route, as Chicago's build does. A
  driver who moves on both days never gets a ticket; the sheet's line says "On two-day routes each side is swept on one
  of the two days; the sign says which."
- **Only Paterson's curbs.** On a street along the city limit only the side the State codes to Paterson is kept (46
  blocks); 11 blocks wholly in Clifton, Haledon, Prospect Park or Totowa, where the City's lines run past the limit,
  are left out.
- Two routes overlapping on a block (a route boundary drawn twice): the block shows both schedules (11 blocks).
- Left out: Bunker Hill's 28 lines (no hours; 59 blocks only on them), ramps and limited access highways, 21 slivers
  under 8 m, 4 blocks the State calls "Unnamed Segment". 13 City lines with hours lie mostly along no block of the
  output: cut-throughs drawn across blocks, an I-80 ramp, the unnamed streets, a street in Totowa, and a few short
  lines 30 to 100 m from any street (all listed in the report).
- Side labels are compass words (`compass()` as in Boston); `o` is the odd side from the State's parity; `l` the cross
  streets at each end, walking on along the same street where a line is split mid-block.

Result (`data/paterson/report.json`): **2,574 blocks, 5,102 sides, 11,286 rules** (two per side, seven downtown).
`segments.json` is 0.8 MB.

## Gaps

1. **Which side is swept on which day** on every two-day route. The data can't say it; the signs do.
2. Whether "Daily" downtown includes Saturday and Sunday (the build says every day).
3. Bunker Hill's Saturday hours.
4. **Holidays.** No page says whether street cleaning stops on holidays. `holidayRule` is `all` with the City Hall
   closing days: on the City's monthly calendars (Public Works news) City Hall closed on Presidents' Day, Good Friday,
   Memorial Day, Juneteenth, Labor Day and Columbus Day in 2026, and on Christmas Eve and Christmas in 2025. January,
   July and November 2026 have no calendar online and 2027 is derived (federal weekend rule).
5. **Season.** None published for 2026, so all year. In past years the City announced restarts after a winter pause
   (February 3, 2020; warnings from March 21 and enforcement from April 4, 2022).

## What to ask the City

1. On a two-day route (Route 3A&3B, Monday and Tuesday 8 AM to noon), which side is swept on which day? A rule (north
   and east sides first) or a list by street?
2. Does downtown's "Daily 6:00AM - 8:00AM" include weekends?
3. What are Bunker Hill's Saturday hours?
4. Is street cleaning and its ticketing suspended on City holidays, and on which? Is there a winter pause this year?
5. Can the Street Sweeping Map layer keep its fields when it is updated, and carry the street name and the side for
   each day?

## What the page needs

- The fine line: $50 plus $30 court costs, and towing (§ 435-131, § 435-132).
- The data notes should cite the City of Paterson's map and NJOGIS (acknowledgement requested).
