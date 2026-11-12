# Lodi

Built 2026-11-11, after a request on /cities for "Lodi, NJ". Data build: `scripts/cities/lodi.mjs` → `data/lodi/`
(format in [city-build.md](city-build.md)); tests: `scripts/cities/lodi.test.mjs`. A preview: not in
`scripts/cities/public.mjs`, so the page is noindex and unlisted.

## How the rule works

- The Borough of Lodi (Bergen County) publishes no map and no street sweeping page. The schedule is in the Borough's
  Code, Chapter 560 (Vehicles and Traffic), **§ 560-38, "Schedule II: No Parking Certain Hours"**: a table of street,
  side, hours and day, and location. Its paragraph C says the regulations "shall be suspended when the street sweepers
  of the Borough of Lodi are not operable", which is what makes it the sweeping schedule.
- Most rows are **one day a week, 9 AM to 3 PM, one side**: the other side of the same street has another day. A few
  are one hour (9 to 10, 10 to 11, 11 to noon, 1 to 2 PM) or a morning (9 AM to noon). Monday to Friday only.
- § 560-27C: no parking "between the hours specified in Schedule II of any day specified therein". § 560-28: a
  penalty of **not more than $50** (or up to 15 days, or both). Article II names no tow.
- The Code gives no season, no week of the month and no holiday: every row is read as every week, all year.
- Not modeled: 32 rows that are not a weekly sweeping window (below), the 1965 Article I (§ 560-24, "Schedule 10:
  Alternate Side of Street Parking", about 40 streets, weekdays 8 AM to 5 PM, no side, possibly superseded), snow
  emergencies.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Code of the Borough of Lodi, § 560-38](https://ecode360.com/13641874) (Borough of Lodi, on eCode360) | 340 rows: street, side, "9:00 a.m. to 3:00 p.m., Monday", location in words ("From Prospect Street to Grove Street", "Entire length") | Public law. eCode360 refuses scripts (a browser check), so the rows are transcribed in the build (`CODE_ROWS`, read 2026-11-11 in a browser), amendment notes kept. Two rows that name a single house number are not transcribed |
| [Road Centerlines of NJ](https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/Tran_road/FeatureServer/0), NG9-1-1 (NJ Office of GIS) | One line per block: names, address ranges with parity, municipality codes, a stable `RCL_NGUID` | 2,201 lines in the envelope, 853 coded to Lodi (`INCMUNI` 885284). NJOGIS conditions of use; acknowledgement requested. The layer's editor field is never requested |

## How it was placed

- **Names.** The Code's street names are written as the State writes them (`norm`): "South Main Street" = S Main St,
  "First Street" = 1st St, "St. Joseph Boulevard" = Saint Joseph Blvd, "Route No. 46" = Us Hwy 46. Where they differ
  in more than spelling the State's name is used: Jefferson, Madison and Marion "Street" are the State's avenues,
  "Vreeland Avenue" its Vreeland St, and on James Street "St. Joseph Plaza" is read as East Place (the Code's own rows
  call the plaza the continuation of East Place).
- **Stretches.** A row's location is "Entire length" or two limits. A limit is a cross street, a distance from one
  ("118 feet north of Union Street"), the terminus ("east to terminus") or the circle. Each limit becomes a point along
  the street; the row goes on every block whose **middle lies between the two points**. So where a rule starts or ends
  partway down a block, the map shows the whole block or none of it.
- **A limit that cannot be placed is never read as the street's end.** A cross street that stops short of the street
  is placed at its nearest point (within 120 m, noted). A name the State has under another type is read as the one
  street of that name that meets it (noted). Anything else, and a terminus with no direction, leaves the stretch off
  the map with the reason in the report.
- **Sides.** North, South, East and West become the block's left or right by its drawn direction; where a block's own
  direction is unclear the street's overall run decides. A row naming the side a block runs along ("East" on a block
  that runs east) is not shown there. "Both" goes on both sides.
- **Marion Pepe Drive** ends in a loop: "Inner Circle" is the curb facing the middle of the loop, "Outer Circle" the
  other, and the East and West rows "From Terhune Avenue to Circle" are the straight block before it.
- **Only Lodi's curbs.** On a street along the Borough line only the side the State codes to Lodi gets the rule (22
  blocks). Highways and ramps get none.
- **Ids.** `c` is the block's `RCL_NGUID`. `o` is the odd side from the State's parity; `l` the cross streets at each
  end. Rules are flagged 1 (not suspended on holidays): the Code names none.

Result (`data/lodi/report.json`): **496 blocks, 879 sides, 925 rules**. Of the 338 rows read, 295 are on the map, 32
are set aside and 11 could not be placed. `segments.json` is 0.15 MB.

## Gaps

1. **No block has been checked against the posted signs.** The Code is the only source; an ordinance can trail the
   signs by years.
2. **32 rows set aside**: 21 read "All; except 9:00 a.m. to 3:00 p.m., Tuesday" (no parking at all times except then,
   or the reverse: the Code does not say), 4 have blank hours or days, 4 are weekday hours "except Saturday, Sunday,
   and holidays" (not a sweep), 3 have a location the build cannot read. Those sides show nothing.
3. **11 rows not placed**: Aida Court, Arnot Place and Robert Court (the side named is the way the block runs), Hoehn
   Street's east side (in a neighboring town in the State's layer), Massey Street's first 118 and 140 feet (shorter
   than a block), Putnam Street's west side "Hamilton Avenue to Kimmig Avenue" (Kimmig Avenue is nowhere near), South
   Savoie Street (not in the State's layer under that name).
4. **Holidays and winter.** None in the Code; nothing is skipped.
5. **Towing.** Shown as none, from Article II's silence.
6. Five streets whose Lodi blocks are in separate pieces carry an "Entire length" row on every piece (Brookside Ave,
   Church St, Hamilton Ave, Redstone Ln, Sherman Ave). First Street's south side has two overlapping Wednesday rows
   (9 to 10 AM and 9 AM to 3 PM): both are shown.

## What to ask the Borough

1. Is Schedule II (§ 560-38) the schedule the sweepers and the signs follow today? Is there a map or list besides the
   Code?
2. What do the rows that read "All; except <day and hours>" mean on the street?
3. Which holidays suspend the schedule, and is it suspended in winter or for snow?
4. Is § 560-24 (Schedule 10, alternate side parking, 1965) still enforced?
5. What do the signs say where the Code's hours or days are blank (East Place, Liberty Lane, Washington Street's south
   side, Westervelt Place's west side)?
6. Are Jefferson, Madison and Marion "Street" the avenues of those names? Is South Savoie Street today's Savoie Street?
7. Can a car be towed for a street sweeping violation?
8. First Street, south side: Wednesday 9 to 10 AM or 9 AM to 3 PM?
9. Where is Putnam Street's "Hamilton Avenue to Kimmig Avenue"? Is "St. Joseph Plaza" on James Street the corner of
   East Place?
10. Marion Pepe Drive: is the "Inner Circle" the curb around the island of the loop?

## Before it goes public

- A person in Lodi checks at least 20 blocks against the signs ([adding-a-city.md](adding-a-city.md)).
- One line in `scripts/cities/public.mjs`, then the site's city count (25 today) changes everywhere it is written.
