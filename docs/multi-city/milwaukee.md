# Milwaukee, Wisconsin

Built 2026-10-18 by [city-build.md](city-build.md). Build: `node scripts/cities/milwaukee.mjs [--refresh]` (inputs cached in
`private/cache/milwaukee/`), tests: `npx vitest run scripts/cities/milwaukee.test.mjs`. Output: `data/milwaukee/segments.json`
(3.9 MB, 0.49 MB gzipped), `city.json`, `report.json`, and `winter.json` (the switch: on, since the ordinance applies every
night). The page is curb.guide/milwaukee ("The page", below): tonight's side all year, as Ale chose on 2026-10-19.

## Short version

- Milwaukee bans parking on every City street from 2 to 6 AM unless the car has a night parking permit (or a one night
  permission). A car with a permit parks on the side with even house numbers on nights with an even date and on the odd side
  on odd dates, and the date that counts is the evening's, "before midnight" (MCO 101-27). Sunday mornings and the mornings of
  and after seven holidays are free.
- It is not a winter rule: on most streets it runs all year. What changes from December 1 to March 1: through highways and
  bus routes allow no night parking on either side, and a few exception streets that allow both sides from March to November
  alternate too. Declared snow emergencies move the hours to 10 PM to 6 AM, for every car.
- The data lists the nights from October 2026 to October 2027 (mornings 2026-10-01 to 2027-10-31): **10,091 street segments
  (20,081 block sides) alternate**, 43 of them (blue) only December 1 to March 1, and **4,949 segments (9,712 sides) on through
  highways and bus routes have no night parking on either side from December 1 to March 1** and the standard rule the rest of
  the year. 2,380 segments the City lets park on both sides every night are left out. 15,040 blocks, 29,793 block sides.
- Enforcement follows the ordinance every night, not an announcement: the switch is **on** from the lists' first morning.
- Unlike Madison: permit only, the evening's date, free Sunday and holiday mornings, all year, and a both sides ban. The
  shared code handles each (see "The page").
- No street sweeping: the City publishes no days and hours by block side. No ticket data either.

## How the rules work

**Night parking** (Milwaukee Code of Ordinances ch. 101, https://city.milwaukee.gov/ImageLibrary/Groups/ccClerk/Ordinances/Volume-1/CH101.pdf,
current to 10/14/2025 and partly 7/14/2026; Parking Regulations, https://city.milwaukee.gov/Parking/ParkingRegulations)

- MCO 101-27-1-b: "No vehicle of any kind or description shall be parked on any highway between: b-1. The hours of 2 a.m. and
  6 a.m., except as otherwise restricted or permitted in this section."
- A night parking permit (101-27-2), for City residents only: $55 a year, $20 a trimester, $10 a month, $5 a week, $1 a night,
  with three free nights every 30 days (Night Parking Permits page). Cars with disabled plates need none but "shall be required
  to park in accordance with all other provisions" (101-27-7-g). Large trucks, trailers and motor homes are not eligible.
- MCO 101-27-7-d: parking is allowed 2 to 6 AM for up to 90 minutes on the block of a licensed business open at that hour.

**Alternate side** (MCO 101-27-3-a): "any vehicle parked pursuant to this section shall be parked only on the even numbered
side of the street on those nights bearing an even calendar date during the portion thereof before midnight, and on the odd
numbered side of the street on those nights bearing an odd calendar date during the portion thereof before midnight, except
that where parking is normally permitted only on one side of the street, vehicles parked pursuant to the aforesaid provisions
may be parked on that side of the street only, on every night of the week."

- So the night of Tuesday December 1 (odd) into Wednesday December 2 is an odd side night: the even side is closed 2 to 6 AM
  on Wednesday morning. January 31 (odd) into February 1 (odd) is an odd side night too. The data lists each side's closed
  mornings.
- The City's page says most residential streets alternate "throughout the year". Exceptions (101-27-3-b): b-1, "vehicles may
  be parked on both sides of designated streets from March 1 to November 30"; b-3, both sides "on any night" in the
  designated parking areas of 101-27-1-a-2 (where cars may also stay 48 hours instead of 24), "except when the department of
  public works announces snow plowing operations".
- The City's Exception Streets map (on the Parking Regulations page) draws them: green, both sides every night for up to 48
  hours with a permit (alternate side only in a snow emergency); blue, both sides March to November for up to 24 hours,
  alternate side December 1 to March 1. Streets not highlighted follow the standard rule.
- Five of the ordinance's 48 hour areas (101-27-1-a-2-d, e, g, h and i: much of the near south side, Bay View, the near west
  and north sides, and the west side) are "exempted from alternate side parking by sub. 3-b-1", an exemption that ends
  November 30. The map makes some of their streets green and leaves the rest standard, so in winter those alternate, as the
  exemption's end says. The data follows the map.

**The winter ban on through highways and bus routes** (MCO 101-27-8): "After 8 p.m. as of December 1 to March 1 inclusive,
unless otherwise extended by emergency order of the commissioner of public works, of the year following, no special permits
shall be issued for parking upon any through highways referred to in s. 101-16-2, nor upon those portions of any street upon
which there is operated a motor bus route, except upon any snow route tow-away zone as referred to in s. 101-24-1, and except
as provided in sub. 9."

- The City's map draws these streets red: no night parking on either side, 2 to 6 AM, December 1 to March 1. They are not
  posted. A red street that is also green follows red in winter (the map's legend).

**Sundays and holidays** (MCO 101-27-7-a): 101-27 "shall not be effective and in force" "On the morning of the 1st day of each
week, Sunday; and on the morning of, and the morning following, the 1st day of January, New Year's Day; 3rd Monday in January,
Dr. Martin Luther King, Jr. Day; last Monday in May, Memorial Day; July 4, Independence Day; 1st Monday in September, Labor
Day; 4th Thursday in November, Thanksgiving Day; December 25, Christmas Day, in any year."

- In the 2026-27 season that frees every Sunday morning and the mornings of December 25 and 26, January 1 and 2, and January
  18 and 19. They are left out of every date list; city.json lists the 2026 and 2027 holiday mornings (`holidayRule: all`).

**Snow emergencies** (MCO 101-26): declared by the Commissioner of Public Works after a snowfall, until plowing is declared
complete (the City's page says 72 hours at most). "Between the hours of 10 p.m. and 6 a.m., inclusive, it shall be unlawful
for any person to park or suffer to be parked any vehicle on the even-numbered side of the street on those nights bearing an
odd calendar date during the portion thereof before midnight and on the odd-numbered side of the street on those nights
bearing an even calendar date", and no parking at all on bus routes and through highways 10 PM to 6 AM. This binds every car,
permit or not, green streets included. Announced through the City's text alerts (milwaukeeparkingalerts.com); not in the
data. 101-27-1-b-2 likewise moves night parking to 10 PM to 6 AM whenever DPW announces plowing or other overnight work.

**Fines and towing** (Parking Citation Types, https://city.milwaukee.gov/Parking/ParkingCitations/Citation-Types): 663 Night
Parking, Wrong Side $30; 660 Night Parking $25; 664 Night Parking, Winter $35; 746, 747, 748 Snow Emergency $50, $100, $150;
most rise by $5, $10 and $15 after 14, 28 and 58 days. MCO 101-25-1-a lets the City tow a car parked against 101-26 or 101-27;
a towed car costs $150 to reclaim plus $25 a day of storage (101-25-1-b). The City's page makes a car tow eligible at the third
snow emergency violation.

**Posted signs come first**. Some residential streets are signed "No Parking" on one side for the winter, all season or
alternating by month; they show only on the signs and in the City's lookup by address. Not in the data.

**Time**: Central, with daylight saving (both changes fall outside the season).

## The data

| Need | Dataset | Notes |
|---|---|---|
| Street lines | **Centerline - City Streets**, `reference/CenterlinDatasets/MapServer/1` on milwaukeemaps.milwaukee.gov (the open data "Streets" dataset, CC BY, refreshed nightly) | 17,649 segments: 17,445 official, 170 private, 34 unofficial. OBJECTID (the block id `c`) is the only segment id; it matches between the map service and the nightly shapefile. Left and right address ranges, no cross streets |
| Exception streets | The map on the Parking Regulations page (ArcGIS Online web map 6695832372454e918e0bb871959e85c9): **TwoSidedParking** and **noNightParkingD1M1** on services1.arcgis.com | TwoSidedParking: 3,271 lines from a CAD drawing, `Layer` "Level 2" (3,082 green) and "Level 1" (33 blue); 156 area outlines on other levels the map does not draw; last edited 2026-10-08. noNightParkingD1M1: 1,892 red lines with `Street` and sometimes `Start`, `End` house numbers; last edited 2026-01-08 |
| City line | Milwaukee_City_Boundary (the same map) | One polygon |
| Neighborhoods | `AGO/neighborhoods/MapServer/0` | 190 polygons; a block takes the smallest one around its midpoint (14,951 of 15,040 have one) |
| Check | DPW's listing of winter regulations that are not posted (mpw.milwaukee.gov/services/winterregs) | 876 rows of street, house numbers and type; an older page, open to scripts |
| Check | Address Points, `property/parcels_mprop/MapServer/22` | 4,426 points in eight areas: house number and street only |
| Sweeping | `DPW/DPW_Sanitation/MapServer/19`: 87 route areas with a route name only; a 2008 frequency map | No days and hours by block side. Posted sweeping streets (MCO 101-26.7) are listed only in Common Council files. Not included |
| Tickets | Not published | |

The City's web pages sit behind a bot check (scripts get a 403), so the rules were read in a browser. The map services, the
open data portal and the DPW listing are open to scripts.

### How it was placed

- **Which rule a street gets**: each official centerline is sampled every 5 m (ends trimmed 4 m). A sample counts for a layer
  when one of its lines runs parallel (within about 30 degrees) within 10 m for the exception lines, which are drawn on the
  centerlines (median 0.1 m off), or 15 m for the red lines (median 4.2 m off, 99% within 10 m). A centerline takes a layer
  that runs along half of it, red first, then green, then blue. Result: 10,054 standard, 43 blue, 2,380 green, 4,949 red.
  93 centerlines are covered 20 to 80% by some layer, mostly short pieces where a diagonal street meets the grid or just past
  the end of a red line (listed in `report.json`).
- **Downtown** is almost all red: the red layer lists 41 downtown streets (Wells, Mason, Jackson, Van Buren, Broadway and more),
  over the downtown 48 hour area (101-27-1-a-2-j).
- **Against DPW's listing**: of the listed blocks, the map gives the listed class to 98.3% of "48 Hour Exception" (2,346
  segments), 98.9% of "No Winter Night Parking" (4,101), 97.3% of "No Winter Parking/48 Hour Exception" (712), and all 42 of
  "Non Winter Exception to Alternate Side Night Parking" and all 3 of "Special Case" (no night parking in winter). Not
  followed: W Howard Ave 8400 to 9980, "No Winter Night Parking (EVEN side only)", which the map bans on both sides.
- **Odd and even sides**: from the centerlines' address ranges. Checked against 4,037 address points: 99.4% lie on the side
  their parity says (the 24 others on one street, W Linwal Ln). A segment numbered on one side gets the other parity across.
- **The rules**: on a standard street, the odd side's rule names the list `even` (closed on the mornings after an even date,
  when cars park on the even side) and the even side's names `odd`: `[-1, 2, 6, 0, 0, 6, "odd"|"even"]`, flags 2 (towable) and
  4 (a side-switching rule). Blue streets name `wodd`/`weven` (winter only). On a red street both sides get the winter ban
  `[-1, 2, 6, 0, 0, 14, "ban"]` (flag 8: both sides close) and, where the sides are known, the standard rule outside winter
  (`sodd`/`seven`). The alternate rules carry no flag 1: the free mornings are simply not listed. The ban lists the winter
  mornings but Sundays and holidays, which DPW confirmed are free on through highways and bus routes too (Gaps, item 6).
- **The City line**: 289 streets on the City line keep only the curb inside the City (the line runs down their middle, within
  4 m of the midpoint; judged 5 m off the centerline). Left out: 2,380 green, 170 private, 34 unofficial, 19 outside the City,
  6 with no address ranges.
- **Cross streets** (`l`): the other street at each end, most nearly at a right angle; where the City splits a street mid
  block, the build follows it to the next corner. 1,562 blocks have one cross street (dead ends), 35 none.

## The page

Tonight's side, all year (design A as Madison has it; Ale picked "Year-round tonight's side" on 2026-10-19):

- **The plate**: "Tonight · Sun Oct 18 into Mon Oct 19 / Park on the even side / With a night parking permit, 2 to 6 AM. Without
  one, no parking. / Tomorrow night: odd side". On a free morning: "Park on either side / Sunday morning: no permit needed".
- **The map**: the side closed tonight red, the open one green; red streets red on both sides every winter night.
- **The sheet**: "Move by 2 AM tonight" or "Park until 2 AM tomorrow night", both sides as cards from their own nights (they
  alternate, skip Sunday mornings, or close both sides all winter), and a line on the permit.
- **Alerts**: the night push (about 9 PM) of every night the saved side closes, "Move to the odd side tonight"; a night both
  sides close, "Move off S Clement Ave tonight. No parking on either side, 2 to 6 AM. Park on a side street."
- **How**: city.json `winter: { from, to, start: 2, end: 6, night: 'evening', permit: true }` (lib/city.js `winterPark`: the
  evening's date names the side), a side's parity from the block's `o`, flag 8 for the ban, the free nights from the file's
  `odd`/`even` lists, `words.what = 'night parking'` for the page's title and words (scripts/cities/city-page.mjs), no day
  chips (no sweeping), and a share card with an alternate side sign (scripts/cities/og-city.mjs).
- **Rebuild before 2027-10-31**, when the listed nights run out (the page then says so).

## Size

`segments.json` is 3.9 MB (0.49 MB gzipped) for 15,040 blocks: the rules name one of seven lists stored once in the file
(`odd` 165 and `even` 161 dates, `wodd`/`weven` 36 each, `sodd` 129, `seven` 125, `ban` 91) instead of listing them on 29,793
sides. An alert carries a side's dates from today on, up to 96 (about six months, past a watch's 165-day age).

## Gaps

1. Red streets outside winter get the standard rule; the City's page says to look up each address for March to November.
2. Streets signed for one side in winter, and other posted night rules: on the signs and the City's lookup by address only.
3. Snow emergencies and announced plowing: no schedule and no public feed (text alerts only).
4. Blue streets on the morning of December 1: the ordinance's "March 1 to November 30" frees the night of November 30; the
   City's page says alternate side starts December 1. Settled by item 5: their first alternate morning is December 2.
5. The ban's first and last night: 101-27-8 says "After 8 p.m. as of December 1 to March 1 inclusive"; the City's pages say 2 to
   6 AM, December 1 to March 1. DPW answered on 2026-10-22 (Laura Vargas, DPW Open Records): it "begins at 8:00 p.m. on
   December 1 and remains in effect through March 1, inclusive". The data's winter mornings are December 2 to March 1.
6. Sunday mornings on red streets: the ordinance's Sunday exception covers all of 101-27, the ban included; the City's page
   states the ban with no exception. DPW answered on 2026-10-22: through highways and bus routes "will be exempt from the
   overnight winter parking restrictions on Sunday mornings and holiday mornings". The data frees those mornings.
7. W Howard Ave 8400 to 9980: the listing bans the even side only, the map both.
8. The exception layers are CAD lines with no street ids, matched by geometry (93 partial matches).
9. Streets on the City line: only Milwaukee's curb gets a rule; the neighbor's rule is not shown.
10. The OBJECTID is the City's only segment id; stable across its services, but not documented as permanent.
11. No ticket data for a cross-check.

## Questions for the City (DPW Parking Services, 414-286-CITY)

1. Do Sunday mornings and the holiday mornings also free through highways and bus routes in winter (101-27-7-a reads so)?
2. When do the winter ban and the blue streets' alternate side start and end: the morning of December 1 or the night of
   December 1 ("after 8 p.m."), and the morning of March 1 or of March 2?
3. Could the exception streets and the winter ban be published by street segment (centerline id and side), and do the
   TwoSidedParking levels keep their meaning?
4. W Howard Ave 8400 to 9980: is the winter ban on the even side only, or both sides?
5. Is there a machine readable feed of snow emergencies and announced plowing?
6. Could the streets signed for one side in winter be published?
7. Could parking citations (date, time, block, violation) be published, for "when tickets usually land"?

Sent 2026-10-19 (as five questions, to the Unified Call Center for DPW Parking Services); DPW Open Records answered on
2026-10-22: question 2 as in gap 5; no machine readable feed of snow emergencies (5); the Exception Streets map's data is
`TwoSidedParking_view` on services1.arcgis.com/5ly0cVV70qsN8Soc, not by segment or side (3); no credit line wanted. The
answer to question 1 came back missing, so we asked again the same day, and DPW answered it within hours (gap 6).
