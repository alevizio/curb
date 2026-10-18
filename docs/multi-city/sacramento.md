# Sacramento

Data built 2026-10-18 (`scripts/cities/sacramento.mjs` → `data/sacramento/`), following [city-build.md](city-build.md).
No page yet. Every number below is in `data/sacramento/report.json`.

## How the rule works

- **Sweeping alone needs no move.** Every public street with a curb and gutter is swept once a month, February to
  October; November to January is leaf season. "There are no requirements that cars be off the streets for sweeping,
  unless there are signed parking restrictions" ([Street Sweeping](https://www.cityofsacramento.gov/public-works/recycling-solid-waste/Collectionservices/StreetSweeping)).
- **Signed "City Services" restrictions in parts of Downtown and Midtown**, 8 AM to noon on one weekday per side:
  Monday the south side of lettered streets, Tuesday the north side, Wednesday the west side of numbered streets,
  Thursday the east side (the City's 2018 notice, reported by CBS13 on 2018-06-28; the City's sign inventory says the
  same). **Weekly** on blocks where homes get weekly garbage and organics pickup on that street; **the first week of
  the month** on the others ("1st TUE of the month" on the signs). The signs say "City Services" because the curb is
  kept for sweeping, garbage and leaf collection.
- **Holidays don't stop it** (an assumption, flags 1 on every rule): the City says residential collection "will occur
  on holidays", leaf crews "work rain or shine, including holidays", and meters and time limits are enforced "7 days
  per week, including holidays". Nothing says street sweeping restrictions are off on holidays.
- **All year** (an assumption, months 0): the signs name no season; sweeping runs February to October and leaf
  collection November to January on the same days.
- **Fine: $72.50**, unverified. The City's fine schedule has no street sweeping line; "No Parking Certain Hours"
  (City Code 10.36.040) is $60, plus the State's $12.50 surcharge. A 2014 street cleaning ticket was $52.50.
  Tow: none mentioned.

## The data

| Need | Source | Notes |
|---|---|---|
| Rules | [On-street Parking Data](https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/ONSTREETPARKING/FeatureServer/0) (Public Works, ArcGIS) | 45,738 points, one per curb space or address, edited daily (last 2026-10-17). 7,497 have a sweeping day (`PKGSDAY`: MON, TUES, WED, THUR; 31 say "1ST …") and hours (`PKGSWBEG`/`PKGSWEND`: 8 am to 12 pm on 7,417). `EVENODD` gives the side's parity. No field says weekly or monthly |
| Lines | [County Street Centerlines](https://mapservices.gis.saccounty.net/arcgis/rest/services/BASE_MAP_LABELS/MapServer/7) | `UNIQUE_ID`, address ranges per side, from and to node ids. Numbered streets are split at the named mid-block alleys (Eggplant Aly, Matsui Aly), so most blocks are half blocks of about 64 m |
| Weekly or monthly | [Streetsweep Sign Inventory](https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/StreetServicesSignInventory_VW/FeatureServer/0) (City, last edited 2018-06-25) | 1,588 signed block faces with `SERVICE_DAY` ("MONDAY-SOUTH"), `STNEEDWKLY` and the 2018 `Status` (NoChange, ToMonthly, NewMonthly, NewWeekly); keyed by the County `UNIQUE_ID` |
| Neighborhood | [City Neighborhoods](https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Neighborhoods/FeatureServer/0) | 129 polygons |

No license is stated on these layers. The City publishes no parking citations: its yearly "Citation Data" layers are
police traffic stops without a place, so there is no ticket check.

## How it was built

1. **Points onto lines.** Each point's street is spelled the County's way ("23RD ST", "CAPITOL AVE"; the data's 10
   "North D" spaces are on D St, 8 m away, not on the County's N D St 800 m north). Each point goes on the nearest
   centerline of its street within 30 m (all 7,497; median 6.1 m, 95% within 7.9 m), on the side it is on. That side
   agrees with the point's `EVENODD` and the County's address range on 6,780 points and disagrees on none (717 have no
   range or parity).
2. **One rule per side.** 1,014 block sides on 569 segments: the day most points give and the hours most of them give.
   29 sides mix days or hours, almost always one corner space carrying the cross street's day; 33 sides come from one
   or two points (both lists in the report). Two sides have Monday points on the north side (E St, 16th to 17th; I St,
   800 block), against the City's scheme: kept as the data says, labeled by compass.
3. **Weekly or the first week of the month.** For each side, the 2018 inventory face under its points (same service
   day, within 25 m): 1,010 sides. A "1ST" day in the parking data means monthly; 4 sides with no inventory record are
   drawn weekly, the stricter reading. Result: 733 weekly, 281 first week of the month. Every side whose sign text in
   the parking data says "1st … of the month" (14) is monthly in the inventory too.
4. Labels are the City's words for the day's side (Monday "South", …); the grid is turned about 20° from north, so the
   label is kept when the side's compass direction contains it.

Rules: `[dow, 8, 12, 31 | 1, 0, 1]`: weekly (31) or the first week (1), all year, not suspended on holidays (flags 1).

## Gaps

- **Weekly or monthly comes from 2018**, the latest the City publishes; today's parking data does not say it.
- No ticket data, so nothing checks the schedule against enforcement.
- Holidays and November to January are assumptions (above). The holiday list in `city.json` (the City's 2026 list,
  2027 by its rule, half days left out) suspends nothing, because every rule has flags 1.
- The fine is inferred from the fine schedule; tow unknown.
- Only 6 neighborhoods have 10 or more blocks; Downtown has 4 restricted segments in the data.

## Questions for the City (311, sacrecycle@cityofsacramento.org)

1. Is the June 2018 sign inventory still right about which blocks are weekly and which are first week of the month?
   Could the on-street parking data say it (as it does with "1ST WED" on 31 spaces)?
2. Are City Services restrictions enforced on City holidays, and from November to January?
3. Which City Code section and fine does a City Services sign carry? Is a car ever towed?
4. E St (16th to 17th) has Monday on both sides and I St (800 block) Monday on the north side: data or signs?
5. Is there a parking citation dataset with date, time and place?
6. What are the terms of use for the ArcGIS layers (on-street parking, sign inventory, neighborhoods) and the County
   centerlines?
