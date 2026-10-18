# Berkeley

Data built 2026-10-18 (`scripts/cities/berkeley.mjs` → `data/berkeley/`), following [city-build.md](city-build.md).
No page yet. Every number below is in `data/berkeley/report.json`.

## How the rule works

- **Every block in the schedule is posted and ticketed.** Residential streets are swept once a month, each side on a
  fixed weekday of the month (the 2nd Tuesday, say), in the morning or the afternoon. The program has had "mandatory
  parking enforcement" since Resolution 54,513-N.S. (1987); "Check signs posted on the street where you park to see what
  day and time street sweeping will occur" ([street sweeping page](https://berkeleyca.gov/city-services/streets-sidewalks-sewers-and-utilities/street-sweeping)).
- **Hours.** The City's schedule says only "AM" or "PM". The signs, read in Google Street View, say **9 AM to 12 noon**
  ("NO PARKING 9 AM TO 12 NOON, 1ST TUESDAY EACH MONTH, STREET SWEEPING", Ward St, 1600 block, south side, imagery
  January 2015) and **12:30 PM to 3:30 PM** ("NO PARKING 12:30 PM TO 3:30 PM, 1ST WEDNESDAY EACH MONTH", Acton St, 1600
  block, east side, imagery March 2025). Both match the schedule's day for that side; a third sign (Bonita Ave, 1600
  block) is blurry but reads the same way. Not confirmed by the City: the first question below.
- **Opted-out blocks are not swept.** In 1987 blocks could leave the program; they get no sweeping and no signs ("there
  are several streets and blocks throughout the City that do not receive sweeping services, either due to the street
  being too narrow, lacking curb and gutter, or if residents have previously opted out of service", [council report,
  July 8, 2025](https://berkeleyca.gov/sites/default/files/documents/2025-07-08%20Item%2022%20Reinstating%20Street%20Sweeping%20on%20the%202900.pdf)).
  A block opts back in with a petition of two thirds of its residents: the 2900 block of Regent St did in 2025 and is in
  the September 2025 schedule.
- **Holidays.** "Streets are no longer swept on holidays. When scheduled street sweeping falls on a holiday, the impacted
  streets will be swept on their next regularly scheduled day" (the schedule PDFs): the next month. `holidayRule: all`,
  no make-up day. The 2026 and 2027 holidays are the City's own list
  ([City Holidays](https://berkeleyca.gov/your-government/city-holidays): 2026 as the page listed it in January 2026,
  2027 as it lists it now), with Berkeley's Lincoln's Birthday and Malcolm X's Birthday.
- **Fine:** $73, "BMC 14.36.030 D No Parking Street Sweeping (sign)" in the [Schedule of Parking Violations and
  Fines](https://berkeleyca.gov/sites/default/files/Schedule%20of%20Parking%20Violations%20and%20Fines.pdf) (updated
  July 28, 2026). No tow is listed for it.
- **Commercial and industrial streets** (353 and 232 segments in the City's layer) are not in the residential schedule
  and not on the map. Whether any of them are posted for sweeping is not said anywhere (question 7).

## The data

| Need | Source | Notes |
|---|---|---|
| Schedule | Three PDFs on the [street sweeping page](https://berkeleyca.gov/city-services/streets-sidewalks-sewers-and-utilities/street-sweeping) | Excel sheets printed to PDF: streets A-G and numbered streets created 2018-02-08, H-Z created 2025-09-25 (all three linked from a 2022-03 folder). 722 rows: route, street, side (N, S, E, W, E/W), numbers, week and weekday, AM or PM, cross streets, opt-out block. No license stated |
| Lines | [Street Sweep Status](https://gis.cityofberkeley.info/arcgis/rest/services/PublicWorks/PubWorks/MapServer/28) (Public Works GIS) | 3,101 centerline segments with left and right house number ranges and a status (`enforced` 1,397, `Commercial` 353, `industry` 232, `exempt` = opted out 127, `excluded` = narrow or no curb 890). OBJECTID is the block id: the layer has no other |
| Odd side | [Addresses](https://gis.cityofberkeley.info/arcgis/rest/services/Public/GISportal/MapServer/0) (City GIS portal) | 31,510 address points. Only house number and street are requested (the layer also carries owner names) |
| City limit | [Boundary](https://gis.cityofberkeley.info/arcgis/rest/services/Public/GISportal/MapServer/2) | Tells a "City Limit" end of a street from a "Terminus" |
| Tickets | None | Berkeley publishes no parking citation data, so there is no cross-check |

The PDFs are read with pdfjs-dist (text with x, y positions), installed into the gitignored cache on first run.

## How it was built

1. **Rows.** Each row is anchored on its route number and the other cells taken by column; the 2018 files print "1st
   Fri" as "1", a raised "st" and "Fri", a few points off the line. All 722 rows read; the route number agrees with the
   day on every one ("61" = 1st Friday). Three rows give one number (Dwight N 2801, Hillcrest Rd N 119, Oakvale S 25):
   the rest of that hundred block is assumed.
2. **Placing a row.** A row goes on the segments of its street whose numbers on the row's side are at least half inside
   its range, on the side with the row's parity (N and E odd, S and W even: the PDFs say so). 675 rows placed: 455 by
   numbers and cross streets together, 169 by numbers alone, 51 by walking the street between the row's two cross streets
   (courts numbered 1 to 99 that the schedule calls 1600 to 1698, and the like).
3. **The odd side.** The address points confirm the centerline's ranges on 2,004 segments and show them the wrong way
   round on 56 (Addison St 1200 block, Stannage Ave 1400 block, Vincente Ave, Acton Crescent...), which follow the
   points. On 2 segments with ranges only, the row's own word points clearly the other way (Oak St 2400 block, Tevlin St
   1300 block) and wins; those blocks carry no `o`.
4. **Opted out.** 52 streets name opt-out blocks; 133 segments inside them are left off, both sides (123 of them are
   `exempt` in the City's layer too). 34 rows fall only in opted-out blocks.
5. **Two rows, one side.** The schedule repeats some blocks in a wide row ("Acton E 1329-1949, Gilman - Berkeley, 2nd
   Mon" over "Acton E 1601-1699, Lincoln - Cedar, 1st Wed"). 47 sides got two days; the row that numbers and cross
   streets both put there wins, then the narrower range. The 1st Wednesday the sign on Acton's 1600 block shows is the one
   kept. 3 sides keep two days (Avalon Ave 3000 block, Neilson St 1200 block: the schedule gives each twice with
   different cross streets).
6. **Sides.** Each side is labeled with the City's word (North, South, East, West). Against the compass: 2,473 placed
   sides agree, 5 differ (winding hill roads: Alvarado Rd, Hillcrest Rd, Vicente Rd), 37 run too diagonal to say.

Result: **1,283 blocks, 2,479 sides, 2,482 rules** (1,435 morning sides, 1,044 afternoon), 284 KB.

## Unplaced rows (13)

Dover St W 3300-3349 and North Valley St (both sides) are not in the City's centerline. Garber St 3000-3099 (both
sides), Hillcrest Rd 254-266 (both sides) and Vicente Rd E 150-181 have numbers the centerline does not hold and a
"City Limit" end. Cypress St 1400-1414 (both sides), Claremont Blvd E 2901-2929 and Tanglewood Rd (both sides) cover a
small part of one long segment, or name a cross street that does not meet them.

## Checks against the City's own layer

The Street Sweep Status layer was not used to place rules, only to check them:

- Of the placed blocks, 1,222 are `enforced` in the layer, 27 `exempt`, 16 `excluded`, 11 blank, 7 `Commercial`.
- The 27 `exempt` ones are in the schedule anyway, most with an "Opt-In Stage" in the layer: Regent St 2900 block
  (stage 2; reinstated by Council in July 2025 and in the 2025 schedule), Thousand Oaks Blvd and Santa Rosa Ave
  (stage 4), Jaynes St and Roble Rd (stage 3), Hillcrest Rd, Oakvale Ave, Virginia Gardens (stage 2), Buena Ave,
  Russell St 2800 block, Virginia St 1800 block, El Camino Real, Roble Ct. Kept as scheduled.
- 5 blocks are opt-outs in the schedule but `enforced` in the layer: Allston Way 1700, Derby St 2400, Grizzly Peak
  Blvd 600, Josephine St 1600, McGee Ave 2400. Left off, as the schedule says.
- 99 `enforced` segments have no schedule row (paths and ramps without numbers, West St 1700-2199, Dwight Way
  2900-3099, Piedmont Crescent, Essex St 1900 block...). Not on the map: no day to show.

## Gaps

- The hours come from two signs, not from the City.
- The A-G and numbered schedules date from February 2018; blocks added or opted in since then may be missing or old.
- The block id is the layer's OBJECTID (1 to 3,101): stable as long as the City edits the layer rather than reloading it.
- Reduced Service Days (City offices closed, about one Friday a month) are treated as normal sweeping days.
- New Year's Day 2028 falls on a Saturday; the City's list does not have Friday, Dec. 31, 2027 yet.

## Questions for the City

To PublicWorks@berkeleyca.gov:

1. Do all residential street sweeping signs read 9 AM to 12 noon (AM) and 12:30 to 3:30 PM (PM)?
2. Is street sweeping (and its ticketing) on as usual on Reduced Service Days?
3. Is there a newer version of the A-G and numbered street schedules than February 2018, or the spreadsheet behind all
   three?
4. What do the "Opt-In Stage" values (1 to 4) in the Street Sweep Status layer mean, and are stage 4 blocks (Thousand
   Oaks Blvd, Santa Rosa Ave) posted now?
5. Allston Way 1700, Derby St 2400, Grizzly Peak Blvd 600, Josephine St 1600 and McGee Ave 2400 are opted out in the
   schedule but enforced in the GIS layer: which is right?
6. Is the Street Sweep Status layer, or a schedule with segment ids, available as open data? It would replace the PDFs.
7. Are any commercial or industrial streets posted for street sweeping, and on what schedule?
