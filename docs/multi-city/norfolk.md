# Norfolk, Virginia

Researched and built 2026-10-18. Build: `scripts/cities/norfolk.mjs` (tests in `scripts/cities/norfolk.test.mjs`), writing
`data/norfolk/segments.json`, `city.json` and `report.json`. Format: [city-build.md](city-build.md). The counts below come
from `data/norfolk/report.json`.

## How street sweeping works there

- **Monthly, on a set weekday, all year.** Public Works sweeps every street with curb and gutter once a month, on a day
  like "the second Tuesday", and downtown every weekday ([Street Sweeping](https://www.norfolk.gov/2658/Street-Sweeping),
  [Services](https://norfolk.gov/6444/Services)). The City's schedule gives each address its own day, and in the signed
  areas the two sides of a block often go on different days: on the 1300 block of Westover Ave the even side is swept the
  first Wednesday, the odd side the first Thursday.
- **Only regulatory signs are enforced.** The City has two kinds of signs. Advisory signs "remind and encourage residents to
  move their cars"; regulatory signs "are mandatory and enforced NO PARKING signs with fines and/or towing consequences.
  You may not park in the designated areas during the posted times for any reason." The schedule marks the addresses with
  enforcement signs (`signed_area` = Yes): 9,546 of 77,706, 12%. CURB shows only those.
- **Fine and tow.** "No Parking - Street Cleaning" is $60, with $50 added after 31 days
  ([Parking Fine Fees](https://www.norfolk.gov/493/Parking-Fine-Fees)). Towing is possible.
- **Hours: only on the signs.** No City page states them. The City's street cleaning tickets do: 7,459 of 7,465 (Jan 2022
  to Mar 2024) were written between 8:00 AM and 1:52 PM, the first at 8:00, none from 2 PM on (the 6 others are scattered:
  00:04, 01:30, 03:55, 07:56, 15:26, 20:41). The build uses 8 AM to 2 PM, flagged as an assumption.
- **Holidays.** No sweeping on City holidays: the City's closure notices for Washington's Birthday, Memorial Day and Labor
  Day 2026 each say "There are no trash or recycling collections, or street sweeping operations scheduled". Missed days are
  made up on Mondays in advisory areas, but "if a street with regulatory signs is missed due to inclement weather, equipment
  failure, etc., the route can not be rescheduled". A City post from December 2020 says the same of Christmas Eve ("a city
  holiday") and of "any areas marked with regulatory signs". The holidays are City Code Sec. 2-48
  ([Holidays](https://www.norfolk.gov/4740/Holidays)): 13 a year, Election Day, Veterans Day, the day after Thanksgiving
  and Christmas Eve among them; a Saturday one is observed the Friday before, a Sunday one the Monday after.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Street Sweeping Schedule](https://data.norfolk.gov/d/pic8-i2xr) (Public Works) | 1,072,458 rows: 77,706 address points x their 2026 dates, the day in words, `signed_area`, `sweeping_frequency` (Monthly or Daily) | Updated 2026-05-13, 2026 only, "updated at the beginning of each calendar year". No hours, no side. License not stated |
| [Street Centerline](https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/Public_Works/FeatureServer/1) (Public Works, Surveys) | 16,067 block lines with left and right address ranges and a stable `UNIQUE_NO` | The block id (`c`). Ramps and connectors are named "MISCELLANEOUS STREET" |
| [Planning Districts](https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/Planning/FeatureServer/2) | 87 named districts (Ghent, Park Place, Colonial Place...) | The neighborhood of each block (`h`). The layer spells Lafayette "Layfayette" |
| [Parking Citations](https://data.norfolk.gov/d/ei2q-6g8n) | 7,465 street cleaning tickets, Jan 2022 to Mar 2024: time and street only | The cross-check. The table also holds plates; the build never asks for them. Years are written "0022" |

Every row's date is the day its words name (0 exceptions), and each signed address has one day pattern and 12 dates.

## How it was placed

1. Each address (written like "1300 WESTOVER AVENUE") is matched to the centerline blocks of its street, and put on the block whose
   address range holds its number (9,357 signed addresses), or on the nearest block of the street within 60 m (18).
2. Its side is the side whose range has its parity (odd or even); where the ranges can't tell (3), the side of the line its
   point lies on. Numbers and position agree for 99.2% of all address points. On 10 blocks almost every point near the line
   sits on the other side from the one its number gives: there the centerline's ranges are on the wrong sides (four blocks of
   Nicholson St, 219 signed addresses), so the points decide.
3. A block side gets the union of its signed addresses' dates, minus City holidays, as one rule:
   `[-1, 8, 14, 0, 0, 2, [dates]]` (no parking 8 AM to 2 PM on each date, towable). 8 sides have addresses on two patterns
   (Wiley Dr, Seay Ave...): they keep both, so a driver who moves on every listed day is never ticketed.
4. Taken off: 722 side dates on City holidays that the data still lists (New Year's Day, Juneteenth, Veterans Day,
   Thanksgiving, the day after, Christmas Eve, Christmas Day). The build fails if any listed date is a City holiday.

Result: **952 blocks, 1,473 block sides, 17,050 dates** (2026-01-07 to 2026-12-23), 491 KB. 9,375 of 9,546 signed addresses
placed (98.2%). Left out: 67,598 unsigned addresses (8,538 blocks with no signed address) and 171 signed ones (below).

## What the tickets say

The citation table has no house number or point, so tickets can't be put on a block or side. At street level:

- 95.4% of street cleaning tickets are on a street that has signed sweeping in the 2026 data.
- 96.3% of those fall on a day (nth weekday) the 2026 schedule gives that street: 96.9% in 2022, 95.9% in 2023, 94.2% in
  early 2024. The schedule has been stable. The biggest misses: Trice Ter, Gatling Ave, Core Ave and Blow St, ticketed on
  first Thursdays while the schedule says first Wednesdays.
- Downtown streets swept daily got 4 street cleaning tickets in 27 months: daily sweeping is not enforced.

## Gaps

- **Hours** are read from tickets, not from the City. A sign with a longer window would be under-warned.
- **2027.** The schedule holds 2026 only. After 2026-12-23 there is no listed date until the City publishes 2027.
- **New streets.** 155 signed addresses on E Charlotte St (800 to 1100 blocks) and Walke St, and 14 on Fenchurch St (500
  block), all near Resilience Dr in the St. Paul's area, have no block in the centerline layer (new streets, most likely).
  Left out.
- **Downtown** (562 addresses, swept every weekday) is `signed_area` = No throughout, and ticket free. Left out.
- **Holidays on signed days.** Sweeping is off on City holidays, but whether Parking writes tickets there on those days is
  not stated anywhere.
- **Edges.** 41 sides have fewer signed addresses than unsigned ones (at the edges of signed areas, several on arterials
  like Colley Ave and Colonial Ave): shown, since the City marks those addresses signed.
- **Side by numbers.** Apart from the 10 blocks above, 38 signed address points sit on the other side of the line from the
  side their number gives: 11 on Chapel St lie on the line itself, 14 sit 80 m or more away (Wiley Dr, Arlington Ave,
  Mayflower Rd), 6 on one block of Conoga St. The number decides there. 222 signed points lie more than
  60 m from the block their number puts them on, and on 6 sides every signed point does (one 785 m away, on Mayflower Rd):
  shown, flagged in the report.

## For the page

- Every rule is a date list: `[-1, 8, 14, 0, 0, 2, [dates]]`. No listed date is a City holiday, so `holidayRule: "all"`
  changes nothing today and stays right if the City publishes holiday dates later.
- After 2026-12-23 every side runs out of dates. The page should say the 2027 schedule is not published yet, not that the
  street is free of sweeping.

## Questions for the City

1. What hours do the regulatory street sweeping signs post? The same everywhere (8 AM to 2 PM)?
2. Is street sweeping parking enforced on a City holiday that falls on a signed day (Veterans Day, the day after
   Thanksgiving, Christmas Eve)?
3. Could the schedule carry the posted hours and the side of the street, and list next year's dates in December?
4. Walke St, E Charlotte St (800 to 1100) and Fenchurch St (500): when will the centerline layer have these blocks?
5. Is there any posted no-parking window for the daily downtown sweeping?
6. Did Trice Ter, Gatling Ave, Core Ave and Blow St move from first Thursday to first Wednesday?
7. Could the citation table add the block number or a point, and data after March 2024?

Contact: opendata@norfolk.gov (data); Public Works, Division of Environmental Storm Water Management (sweeping); the
Parking Division (tickets).
