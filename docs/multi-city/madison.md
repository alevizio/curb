# Madison, Wisconsin

Built 2026-10-18 by [city-build.md](city-build.md). Build: `node scripts/cities/madison.mjs [--refresh]` (inputs cached
in `private/cache/madison/`), tests: `npx vitest run scripts/cities/madison.test.mjs`. Output: `data/madison/segments.json`
(14.2 MB, 0.68 MB gzipped; see "Size"), `city.json`, `report.json`.

## Short version

- Two rules get Madison drivers tickets and tows: **posted street sweeping signs** (Clean Streets Clean Lakes, about
  1,700 signs, mostly in the central neighborhoods and enforced all year) and **winter alternate side parking**
  (November 15 to March 15, 1 to 7 AM, odd-numbered side on odd dates, even side on even dates) on every City street
  outside the Snow Emergency Zone.
- 1,702 of 1,712 sweeping signs are placed on **1,670 block sides of 1,094 blocks**. The winter rule covers **14,734 block
  sides of 7,367 street segments**, 8,418 blocks in all, but it is **not on the map yet** (2026-10-18): a rule that
  switches sides by date needs its own design (words, alerts every other night), and the City has not said how it will
  enforce it this winter. `--with-winter` builds it; the page today shows the 1,094 sweeping blocks.
- The City publishes no parking ticket data with time and place, so there is no ticket cross-check.
- How the City will enforce the winter rule in 2026-27 is not announced (see below): the data follows the ordinance.

## How the rules work

**Posted street sweeping** (Clean Streets Clean Lakes, https://www.cityofmadison.com/streets/street-maintenance/clean-streets-clean-lakes)

- Signs read "No Parking 8AM-12PM Thursdays", one weekly window per curb side, Monday to Friday: 8 AM to 12 PM (843 signs),
  10:30 AM to 2 PM (502), 8 to 11:30 AM (232), 9 AM to 1 PM (53), 8 to 9:30 AM (30), 9 AM to 12 PM (25) and a few others.
- Season: "Most CSCL areas are now enforced year-round. Areas with year-round signs are part of the Snow Emergency Zone.
  There is a small CSCL area south of Wingra Creek that has seasonal enforcement." The sweeping itself ends in early
  December; the restriction stays for plowing to the curb. In the data, 1,633 signs are year-round, 56 (south of Wingra
  Creek) read "May1-Nov15" and 13 (Jenifer St, Williamson St to Baldwin/Dickinson) read "Mar16-Nov30". The months mask
  cannot hold the 15th, so those rules run May to November and March to November: November 16 to 30 and March 1 to 15
  show a sweep that is not in force.
- Fine: $35 (violation 048, STREET CLEAN/MAINTENANCE REGULATIONS, the City's ticket system cost schedule). Towing is
  possible ("Any posted daytime parking restriction signage will be enforced. This may include towing for street
  maintenance", Parking Enforcement FAQ). MGO 12.1339(1).
- Holidays: the signs carry no "except holidays" wording, and the ordinance has none. The City says "time-related parking
  restrictions are not enforced" on its eight parking holidays, but it is not settled that this covers sweeping signs, so
  the data keeps the sweeps on holidays (flag 1, the cautious reading).

**Winter alternate side parking** (https://www.cityofmadison.com/live-work/winter/parking)

- MGO 12.1335(1): "From the dates of November 15 to March 15, between the hours of 1:00 a.m. and 7:00 a.m. all vehicles will
  be parked only on the even-numbered side of the street on even-numbered calendar days, and only on the odd side of the
  street on odd-numbered calendar days; unless otherwise posted or exempted in this ordinance."
- The date is the morning's: "Tonight (3/16/26 into the morning of 3/17/26), park on the side of the street with odd house
  numbers." The first window is 1 AM on November 15; the last ends 7 AM on March 15. So each side's rule lists the dates
  it is closed: the odd side on even dates, the even side on odd dates (121 dates in the 2026-27 season; December 31 and
  January 1 are both odd).
- Fine $20, $60 during a declared snow emergency, plus a $115 tow fee (the City's ticket system: "149-ALT SIDE PKG 1A-7A"
  $20, "148 - SNOW EMERGENCY 1A-7A" $60, "TOW FEE" $115; MGO 12.1331(3)). Towing applies outside emergencies too (MGO
  12.1335(4)(d)). A proposal to raise the tow fee to $125 was on the Transportation Commission's 2026-10-14 agenda.
- No holiday exception: the rule runs every night of the season (flag 1), and is towable (flag 2).
- **Enforcement changed in 2025-26**: "Enforcement will begin only when the Street Superintendent declares the first general
  plowing operation or snow emergency" (activated 2025-11-29), and "ticketing for alternate side violations may be paused
  during prolonged periods without snow or ice." For 2026-27 the City's program page lists a possible "Phase 2" in which
  alternate side parking would "activate only during general plow or snow emergency events", with no decision published
  by 2026-10-18. The ordinance is unchanged, the City's own lookup gives a side for every night, and the FAQ says the rules
  "can be enforced at any time", so the data lists every night. The sheet's line says how it was enforced last winter.

**Snow Emergency Zone** (https://www.cityofmadison.com/live-work/winter/parking/declared-snow-emergencies)

- Inside the zone, alternate side parking applies only in a declared snow emergency (48 hours, declared before 9 PM).
  Declared emergencies cannot be scheduled, so the zone's streets carry no winter rule here.
- The zone is the City's official map, a Google My Maps polygon (189 points) embedded on that page, fetched as KML. Its
  current legal text is a street by street boundary (MGO 12.1335(2), recreated by ORD-25-00061 on 2025-09-02 "without
  altering" the zone). The City's page still names "Alder Districts 2, 4, 6, 8, and 13, and the part of District 5 south of
  Campus Drive and east of Franklin Avenue", the districts before the 2022 redistricting, so the current Aldermanic
  Districts layer must not be used for it.
- A segment is in the zone when its midpoint is (1,857 segments). 17 segments outside lie within 25 m of the zone's edge.

**Holidays**: the City's eight parking holidays, on their calendar dates: New Year's Day, Martin Luther King Jr. Day,
Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas Day (Parking Enforcement FAQ, MGO 12.01).
Ho-Chunk Day, Christmas Eve and New Year's Eve close City offices but parking is enforced. Every rule in the data carries
flag 1, so no sweep or winter night is dropped on a holiday.

**Time**: Central, with daylight saving.

## The data

| Need | Dataset | Notes |
|---|---|---|
| Sweeping signs | **Street Sweeping Restrictions**, `Public/OPEN_DATA_TE/MapServer/5` (hub item 1a0c02ed8b004764a19a85690e7d4032, Parking Utility) | 1,712 lines, last edited 2026-09-18, one per curb side, drawn 2.7 to 5.7 m off the centerline (10th to 90th percentile). Fields `Restr_txt_full` (the sign's text), `Day`, `StartTime`, `EndTime`, `May1_Nov15`, `Mar16_Nov30`, `Type` (SSA 1,637, SS 69, SSS 1: undocumented; SS are the seasonal ones), `DateRemoved`, `Note`. No curb side field |
| Street lines | **Pavement Centerlines**, `Public/OPEN_DATA_ENGR/MapServer/1` | 11,365 segments, all in the City, with `Asset_ID` (the block id `c`, unique; `segment_id` repeats on 27 ids and is empty on 776), names, cross streets, left and right address ranges, functional class, who maintains it |
| Neighborhoods | **Neighborhood Associations**, `Public/OPEN_DATA/MapServer/12` | 141 polygons; a block takes the smallest active association around its midpoint (6,830 of 8,418 blocks have one) |
| Snow Emergency Zone | The City's map (Google My Maps KML export) | One polygon. No GIS layer has it |
| Tickets | Not published | The City's ticket system lists fines only |

License: both datasets point to the City of Madison Data Policy (a disclaimer); the open data ordinance (MGO 3.72) makes
datasets available "without any registration requirement, license requirement or restrictions on their use".

### How it was placed

- **Sweeping signs to blocks**: each sign line is sampled every 4 m (ends trimmed 2 m); each sample goes to the nearest
  centerline within 15 m that runs parallel to it (within about 30 degrees), on the side it lies. A sign goes on every
  centerline it runs along for 8 m or a third of its length, on the side most of its samples are on. 1,610 signs land on
  one centerline, 92 on two or more. 6 signs drawn on or near the centerline itself split their samples between the
  sides (7 blocks; kept on the majority side, listed in `report.json`).
- **Sign text over fields**: the build reads the sign's full text first. Sign 6059's start field says 8PM, its text 8AM;
  signs with empty time fields carry the times in the text. Two AM/PM slips fixed: sign 355 "8AM-10:30PM" (its end field
  says 10:30AM) and sign 926 "8AM-9:30PM" (8 to 9:30 AM is on 29 signs).
- Left out: 5 empty rows, 2 signs removed on 2023-11-01 but still in the layer, 3 signs along no centerline.
- **Odd and even sides**: from the centerlines' left and right address ranges. Checked against 722 City address points
  near the east isthmus: 96% lie on the side their parity says (the rest are on one loop street). A segment with house
  numbers on one side only gets the other parity on the other side.
- **The winter rule's streets**: every centerline outside the zone with functional class 1 to 5 (not ramps, alleys,
  private or unbuilt streets), maintained by the City, the state or the county (not private, University or neighboring
  towns' streets), with odd and even address ranges. Left out: 659 segments with no address ranges, 55 UW, 8 neighboring
  towns', 686 ramps, alleys, private or unbuilt.

## Size

`segments.json` is 14.2 MB (0.68 MB gzipped), over the 6 MB guide: 14,734 block sides each list 59 or 62 dates. With the
sweeping blocks only it would be 0.29 MB; with one date per list, 2.6 MB. No data was dropped. A city level parity rule in
the format (the dates once in `city.json`, a flag per block side) would bring it near 2.6 MB.

## Gaps

1. The 2026-27 enforcement model of the winter rule (nightly, from the first plowing, or only in plow and snow events).
2. Sweeping signs on holidays.
3. Seasonal signs start and end mid-month (May 1 to Nov 15, Mar 16 to Nov 30); the rules show whole months.
4. Declared snow emergencies (inside the zone, and the $60 fine everywhere) have no schedule and no public feed.
5. Exemptions in MGO 12.1335(5) other than Jenifer St (inside the zone) were not checked: Municode blocks scripts and the
   section was rebuilt from Legistar.
6. No ticket data for a cross-check.
7. A new City notification system for winter parking is planned, with no launch details yet.

## Questions for the City (Parking Utility: parkingenforcement@cityofmadison.com)

1. How will alternate side parking be enforced in 2026-27, and when will that be announced? A machine readable "enforced
   tonight" signal would let alerts follow it.
2. Are Clean Streets Clean Lakes signs enforced on the eight parking holidays?
3. Could the Snow Emergency Zone be published as a GIS layer (it is only a Google My Maps polygon today)?
4. What do the sweeping layer's `Type` codes (SSA, SS, SSS) mean? Two rows were removed in 2023 but remain, five are empty.
5. Which streets are exempt from alternate side parking (MGO 12.1335(5)) outside the zone?
6. Could parking citations (date, time, block, violation) be published, for "when tickets usually land"?
