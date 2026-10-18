# New York City

Built 2026-10-18 with [city-build.md](city-build.md). Id `new-york`. Build: `node scripts/cities/new-york.mjs [--refresh]`
→ `data/new-york/`. Tests: `scripts/cities/new-york.test.mjs`. Every number below is in `data/new-york/report.json`.

## Short version

- The rule is **alternate side parking (ASP)**: a broom sign on each block side names the days and hours when nobody may
  park there, so the Department of Sanitation's mechanical brooms can pass. All year, Monday to Saturday, usually one or
  two windows a week of 30 to 90 minutes; commercial strips get daily or overnight windows. A $65 ticket (code 21), no tow.
- DOT publishes **every sign** with its block side (street, two cross streets, compass side) and a point, but no line. The
  build joins them to the City's street centerlines (CSCL), the way Boston's schedule was joined, at about five times
  Boston's size: 195,571 broom signs on 58,999 block sides.
- **99.3% of block sides are placed** (58,591), on 38,911 centerline blocks: 69,111 curb sides, 136,495 rules.
- **93.2% of a 1% sample of this fiscal year's street cleaning tickets** land on a block side whose rule covers that
  weekday and minute; 2.0% match only the other side of the street.
- The citywide file is 10.6 MB (1.5 MB compressed), over the 6 MB a page should load at once, so the build also writes
  one file per borough (Brooklyn, the largest, is 4.4 MB). The page needs to load by borough: see "What the shared page
  needs".
- Holidays: the City's 2026 ASP suspension calendar (42 days). **The 2027 calendar is not published yet**; every build
  asks for it again and adds it once it is out.

## How ASP works

- **Where:** wherever a broom sign is posted (a "NO PARKING" sign with the broom symbol). 58,999 block sides carry one:
  Brooklyn 27,607, Queens 14,909, Bronx 10,302, Manhattan 6,180, Staten Island 1 (it has essentially no ASP).
- **When:** the sign's days and hours. The common patterns, by curb side: one day a week (30,425 sides), two days
  (30,381), Monday to Saturday (5,924). Night signs (moon and stars) run midnight to 3 AM or 3 to 6 AM on commercial
  streets; 3,107 blocks are swept only at night (every window starts before 6 AM).
- **Holidays:** DOT suspends ASP citywide on its calendar's days (legal and religious holidays: 42 days in 2026, Eid,
  Diwali and Lunar New Year among them), for the whole day, overnight signs included (`holidayRule: "all"`). It also
  suspends ASP for snow and emergencies, announced the same day by 311 and Notify NYC; those can't be known in advance.
- **Fine:** $65 everywhere since 2020-02-20 (DOF violation code 21, "Street Cleaning"). No tow.
- **Who:** DSNY sweeps; DOT writes and posts the signs. NYPD traffic enforcement agents wrote 65% of this fiscal year's
  street cleaning tickets and Sanitation's agents 35% (`issuing_agency` T and S); DOF collects them.

## The data

| Need | Dataset | Notes |
|---|---|---|
| Rules | [Parking Regulation Locations and Signs](https://data.cityofnewyork.us/d/nfid-uabd) (DOT), Socrata `nfid-uabd` | 441,348 current signs, updated daily. Per sign: order number, borough, `on_street`, `from_street`, `to_street` (+ suffixes for roadbeds: "N S/R", "W RDWY"), `side_of_street` (N, S, E, W), `sign_code`, `sign_description`, `distance_from_intersection` (feet), `arrow_direction`, `sign_x_coord`/`sign_y_coord` (EPSG:2263, State Plane feet; on 95% of broom signs). No line, no segment id |
| Street lines | [Centerline (CSCL)](https://data.cityofnewyork.us/d/inkn-q76z) (OTI), `inkn-q76z` | 122,329 lines, weekly. `physicalid` (the block id `c`), left and right blockface ids and address ranges, `b5sc` (borough + DOF street code, which tickets carry too), road type, street names |
| Neighborhoods | [2020 Neighborhood Tabulation Areas](https://data.cityofnewyork.us/d/9nt8-h7nd) (DCP), `9nt8-h7nd` | 262 areas, the `h` of each block |
| Holidays | [ASP suspension calendar](https://www.nyc.gov/html/dot/html/motorist/alternate-side-parking.shtml) (DOT) | One .ics per year (`/html/dot/downloads/misc/2026-alternate-side.ics`). nyc.gov answers 403 to a plain client, so the build reads it with a browser user agent |
| Tickets (check only) | [Parking Violations Issued, FY2027](https://data.cityofnewyork.us/d/pvqr-7yc4) (DOF), `pvqr-7yc4` | 550,626 code 21 tickets so far (June to September 2026), with street code, house number, front of or opposite, time and the posted hours. No coordinates. The build reads a 1% sample and never keeps plates |
| Broom visits (not used yet) | [SweepNYC](https://data.cityofnewyork.us/d/c23c-uwsm) (DSNY), `c23c-uwsm` | Daily; every time a broom's GPS touched a CSCL physical id, since 2023-10-27 (9.9 million rows). Same ids as `c`, so "when the broom actually passed" can join directly later |

All Socrata datasets are under the NYC Open Data terms of use and open to browsers, but the page reads the built
snapshot, as everywhere in CURB.

## How the build places a rule

1. **Signs → rules.** 540 sign designs carry the broom (typos included: BRROM, BROOMM, SANITATIOJN). A short parser reads
   days and hours from the text: "MONDAY THURSDAY 9AM-10:30AM", "8:30-10AM TUES", "MIDNIGHT TO-3AM MON WED FRI",
   "7:30AM-8AM EXCEPT SUNDAY", "10:30AM-NOON", with the City's typos ("THURDAY", "MODAY", "10A M", "11:30AM-1 M").
   It reads 195,543 of 195,571 signs (99.99%). The 28 it can't are four designs with no days or hours on them (one is a
   template, "XYY-XYY DAY THRU DAY"). Any word outside the parser's list is reported, so a new design can't slip by.
2. **Block sides.** Signs of the same place (borough, street, cross streets, roadbed suffix, side) form one block side,
   which keeps every distinct rule its signs carry: 726 block sides (1.2%) carry more than one schedule.
3. **Street names.** Both datasets go through one spelling ("EAST  115 STREET" and "E  115 ST" → `E115ST`;
   "MC CLELLAN" = "MCCLELLAN", "B 69 STREET" is Beach 69th, "THIRD AVENUE" is 3 Ave). A roadbed suffix picks CSCL's
   roadway when it has one (Astoria Blvd N). 57 names CSCL spells differently were learned: 49 from where their signs
   stand (each sign votes for the nearest line within 15 m: "6 AVENUE" is Avenue of the Americas, "ADAM C POWELL
   BOULEVARD" is Adam Clayton Powell Jr Blvd, Willett St is Bialystoker Pl), 8 from a near identical name (CHARLECOTTE
   RIDGE). All are in `report.json` (`streetNameAliases`).
4. **The walk.** On the street's own graph, from the node where the first cross street meets it to the node where the
   second does: by name (56,088 walks), a similar name among the streets that meet it (594), the street's end for "DEAD
   END" (908), the node nearest a cross street that passes without meeting it, like an expressway in a trench (393), or,
   with one end unknown, as far as the signs reach (216). A walk may cross a piece of another street of 40 m or less (an
   offset intersection: 141 St jogs 29 m along 78 Ave), which never gets the rule. Among the possible walks the build takes
   the one closest to the order's sign points (median 1.2 m away), refuses walks that turn back on themselves (across a
   divided street and back) and walks far longer than the signs' distances from the corner allow.
5. **The side.** The sign points sit on the centerline, at the sign's distance from the corner, so they tell which line,
   never which side. The side is the order's compass side, taken against each line's own direction (the north side of a
   line running east is its left), or the walk's direction where a line runs along the compass direction.
6. **Fallback.** A block side whose walk misses its signs is placed sign by sign on the nearest line of its street within
   20 m (287 block sides). A walk whose cross streets both match by name but whose sign points sit off the street (some
   are geocoded onto a neighboring street) is kept (49).

## What the numbers say

- **Placed:** 58,591 of 58,999 block sides (99.3%); 2,156 have no sign points and were placed by their cross streets alone.
- **Not placed (408):** a cross street that doesn't meet the street and no sign points to go by (207; some are data
  errors, like "100 St between 31 Ave and 32 Street"); no connected walk between the cross streets and no sign points
  (88); the only walk far longer than the signs reach (32, mostly a "DEAD END" that CSCL continues past); a street name
  CSCL doesn't have (28, like Bartel Pritchard Sq in Brooklyn and Belmont St in the Bronx); and smaller groups. Examples
  per reason in `report.json`.
- **Ticket check** (1% of FY2027 code 21 tickets, 5,052; by street code and house number, 4,298 land on a block with
  rules, on the side the number is on, or the other side when the ticket says "opposite"):
  - 93.2% are on a side whose rule covers that weekday and minute (95.1% on sides placed by a walk). By borough: Queens
    94.7%, Brooklyn 94.3%, Manhattan 92.6%, Bronx 88.7%.
  - 2.0% match only the other side of the street, 1.6% the day but not the hour, 3.0% nothing; most of these are tickets
    written outside any posted window ("ALL" hours, at night or on a Sunday), or on avenues with service roads where the
    house number and the sign sit on different roadbeds.
  - The hours the officer copied from the sign equal one of the side's rule windows on 84.6% of tickets, 93.6% allowing
    the AM/PM slips in the ticket data ("1100A 1230A"). Where the hours match, the number of posted days does too on
    90.6% (the weekdays themselves can't be read: see question 7).
- **Output:** 38,911 blocks, 69,111 sides, 136,495 rules. 1,081 sides show more than one window (see "Gaps").

## Gaps and caveats

- **Part of a block.** Signs carry an arrow and a distance from the corner, so a regulation can cover part of a block
  side (a daily "8:30-9 except Sunday" sign by a commercial corner, next to the weekly one). The format's smallest unit is
  the block, so the side shows every schedule its signs carry. The sheet says "see the posted sign"; the arrows could
  split blocks later.
- **Divided streets.** CSCL gives every roadbed of Queens Blvd, Ocean Pkwy or Grand Concourse the same name. The sign
  points choose the roadbed; the 2,156 block sides without points take the shortest walk, which can be the main roadbed.
- **Sides are inferred from the compass.** 54,655 walks run clearly across their compass side; 3,410 at an angle; 237
  have lines along it, where the side is a guess. Checked against geometry: 9 sides of 69,111 face the other way.
- **Queens house numbers** ("22-001") don't fit the format's numbers, so `n` is left out on 10,937 blocks (the odd side
  `o` is still set). The page's address search will need the hyphen.
- **Old inventory.** The sign table is DOT's asset inventory, current orders only; a sign removed on the street without a
  closed order would still show. The ticket check is how we know the inventory matches the street (93%).
- **Snow and emergencies** suspend ASP the same day; only the holiday calendar is in the data.
- **2027 holidays** are not published yet (checked 2026-10-18; the 2026 file was posted 2025-10-29).

## What the shared page needs

1. **Loading by borough.** `segments.json` is 10.6 MB (1.5 MB compressed). `city.json` → `parts.files` lists one file per
   borough, in the same format, with its bounding box, block count and size: Manhattan 1.3 MB, Bronx 2.0 MB, Brooklyn
   4.4 MB, Queens 2.4 MB, Staten Island 2 KB. `lib/city.js` `load()` reads the whole city today.
2. **The zoomed out view.** 38,911 blocks is about three times San Francisco's; the citywide overview will need the
   chunked drawing SF uses, or a lighter overview file.
3. **Address search.** Streets are written as people say them ("W 82nd St", "Beach 116th St", "Avenue J"); the page's
   street key doesn't yet match "West 82 Street" to "W 82nd St", and Queens addresses need their hyphen.
4. **The opening view** is the Upper West Side (`center` 40.7835, -73.9765, zoom 15: 218 swept sides within 600 m), in
   Manhattan, the smallest borough file. Park Slope is the other natural choice; it loads Brooklyn's 4.4 MB first.

## Questions for the City

For NYC Open Data, DOT and DSNY:

1. **Publish the sign-to-segment join.** SweepNYC already keys DSNY's sweeping to CSCL physical ids; publishing each sign
   order's CSCL physical id or blockface id, and its side, would replace this whole join and its guesses.
2. Could the sign points carry the curb side, or a blockface id? Today they sit on the centerline.
3. 207 orders name a cross street that doesn't meet their street in CSCL (and have no sign points). Can they be checked?
   A list is in `report.json`.
4. Do current orders ever keep a sign that is no longer on the street? Is there a date when each sign was last seen?
5. Could the ASP suspension calendar be published as open data (or the next year's .ics earlier), and the same day
   snow and emergency suspensions as an open feed?
6. Could nyc.gov serve the .ics to non-browser clients? It answers 403 today.
7. In the ticket data, `days_parking_in_effect` loses its leading blanks ("Y  Y"), so the weekdays can't be read. Could it
   keep them, or use one letter per day?
8. Could the tickets carry the officer's GPS position, like the street code and house number?
9. Some streets in the sign table have no CSCL line under any spelling found: Bartel Pritchard Sq (Brooklyn), Belmont St
   (Bronx). Botanical Sq (Bronx) is in CSCL as two legs, N and S, while its orders run from Webster Ave back to Webster
   Ave. Which lines are they?
10. What are the terms for reusing the sign inventory in a free public app? The datasets carry no license field.

Contacts: [NYC Open Data](https://www.nyc.gov/opendata/contact-us) (dataset questions, routed to the owning agency) and
[DOT's contact form](https://www.nyc.gov/html/dot/html/contact/contact-form.shtml).
