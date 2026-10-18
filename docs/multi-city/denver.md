# Denver

Built 2026-10-18 by [city-build.md](city-build.md). Build: `node scripts/cities/denver.mjs [--refresh]` (inputs cached in
`private/cache/denver/`), tests: `npx vitest run scripts/cities/denver.test.mjs`. Output: `data/denver/segments.json`
(2.9 MB), `city.json`, `report.json`.

## Short version

- Denver sweeps residential streets once a month, April to November. In posted areas each side of a block has its own
  week and weekday (the 2nd Tuesday, say), on signs; the street centerline layer codes it side by side.
- **21,744 block sides** get a monthly day rule, and **445 sides** downtown an overnight rule from their signs: 11,148
  blocks, 22,085 sides, 22,545 rules.
- **The posted hours are on no City web page.** They come from the City's own sign inventory: the standard sign reads
  8 AM to 5 PM ("STREET SWEEPING 1ST THURSDAY 8AM-5PM", "... APR THRU NOV 8AM-5PM (TAZ)"); 12 sides say 8 AM to noon.
  Confirm with the City before launch.
- Check: of 39,558 daytime sweeping signs placed on a coded block side, **94.0% name the week and weekday the centerline
  gives that side** (95.1% of those the City itself links to the segment), 2.5% name the other side's, 3.5% neither. The
  City's lookup agrees with the codes on 70 of 72 blocks checked by hand.
- No citations with time and place are published (only aggregates), so no ticket cross-check.

## How the rule works

- "Residential seasonal street sweeping season runs April through November" (denvergov.org Street Sweeping page). "There's
  a parking ban on sweeping day for the side of the block being swept... sweeping days may be different for each side of the
  street, and not every block has restrictions" (Tickets and Towing page).
- Posted blocks: a fixed week and weekday per side, Tuesday to Friday, weeks 1 to 4 ("the Nth time that weekday occurs in
  the month": the City's lookup lists Oct 20, 2026 as a 3rd Tuesday). On 97.6% of blocks the two sides go on paired days
  of the same week, Tuesday and Wednesday or Thursday and Friday.
- Unposted blocks: swept "sometime during the week indicated... You do not need to relocate your vehicle" (the lookup), so
  they carry no rule (12,154 segments; unposted areas south of 6th Avenue are swept every other month).
- **Hours**: 8 AM to 5 PM on the City's daytime sweeping sign records that state hours (755 records; 38 say 8 AM to noon; no
  other sweeping hours, the 7 AM to 6 PM or 12 noon to 9 PM on some records belong to a loading or permit panel of the same
  sign). A side gets 8 to noon only when a sign on that side says so and names the same week and day as its code (12
  sides). About 95% of sign records carry only the sign type's name, so every other posted side gets the standard 8 to 5.
- **Overnight sweeping** downtown (CBD, Union Station, Five Points, North Capitol Hill, Cherry Creek, City Park): the signs
  read "STREET SWEEPING 2AM-6AM MONDAY AND WEDNESDAY TAZ" or "TUESDAY AND THURSDAY", "THURSDAY 2AM-6AM" (Cherry Creek),
  "3RD MONDAY 2AM-6AM", "2ND AND 4TH MONDAY 2AM-8AM". The centerline only marks these streets "N" (night), with no days, so
  each side takes the schedule most of its signs show (31 sides had a minority sign; on 19 ties every tied schedule is
  kept). The nights follow the parity pattern of downtown's meter programming (odd side Tuesday and Thursday, even side
  Monday and Wednesday) on 274 of 311 sides. The signs name no season and no holiday exception, so night rules run all
  year and on holidays (the schedule area's MONTHS says April to November: question below).
- **Holidays**: no current City statement. The City's lookup leaves holidays out of each block's next dates (Veterans Day
  for 2nd Wednesday blocks, Thanksgiving for 4th Thursday blocks), and in 2020 the City said "There will be no sweeping on
  July 3 as the city observes the July 4 holiday." Day rules skip the City's 12 holidays (holidayRule "all"); no make-up
  days are known.
- **Fine and tow**: $50 ("54-482 (c) Tow Away Zone - Street Sweeping $50.00", fine schedule effective 2022-02-01). "It will be
  ticketed and may be relocated", with a $100 fee; signs read TAZ (Tow Away Zone). Rules carry flag 2 (towable).
- **Time**: Mountain, with daylight saving.

## The data

| Need | Dataset | Notes |
|---|---|---|
| Codes per side | **ODC_TRANS_STREET_L**, `services1.arcgis.com/zdB7qR0BtYrg0Xpl/.../ODC_TRANS_STREET_L/FeatureServer/145` | 30,706 centerlines, edited 2026-10-14, CC BY 3.0. `LEFTSWEEP`/`RIGHTSWEEP`, `SSSID`, `NIGHTSWEEP`, address ranges, `MASTERID` (the block id `c`, unique among the blocks written). No data dictionary |
| Posted areas | **ODC_ADMN_STREETSWEEPSCHEDULE_A**, `.../FeatureServer/17` | 51 areas, edited 2026-08-07: `MONTHS`, `WEEK`, `DAYS`, `POSTED`. 19 posted, all "Apr-Nov", "Tue-Fri" |
| Hours, night signs, check | **Sign inventory** (Cartegraph), December 2025 export, `.../Signs_12022025/FeatureServer/0` | 41,586 sweeping sign records with the sign type's description, `Street_Master_ID` (= `MASTERID`), address and location. No license stated |
| Neighborhoods | **ODC_ADMN_NEIGHBORHOOD_A**, `.../FeatureServer/13` | 78 statistical neighborhoods; `city.json` lists the 58 with posted blocks, with their boxes |

### Decoding (checked against the City's lookup, `denvergov.org/api/Streets/Sweeping`)

- Two digits: the week of the month (1 to 4), then the weekday with 1 = Sunday, so 3 = Tuesday to 6 = Friday (1, 2 and 7
  never occur). 23 = 2nd Tuesday.
- 10, 20, 30, 40: "the Nth week of the month", no set day, no need to move. N: night sweeps (not "not swept"). NDM: "Street
  is not maintained by the City and County of Denver". 2X: no valid data.
- `LEFTSWEEP` is the side with the left address range, the left side looking along the line (the lines run from low to
  high addresses; odd numbers are on the north and west sides on 99% of segments).
- `SSSID`: district, week (or A for night), Tuesday to Friday flags, posted Y/N, sub-route. Its week differs from the side's
  code on 258 sides; the code wins (the lookup follows the codes, and the area's `WEEK` disagrees with them on 18% of
  unposted sides).

### Placing the signs

- A sign goes to the segment the City links it to (`Street_Master_ID`); 6,479 without a usable link go to the nearest
  centerline within 20 m, one of the sign's own street if any. Its side is the side of the line it stands on (signs are 4 to
  8 m from the centerline). 22 signs found no street, 68 stood too close to the line to tell.
- A combination sign's other panel is never read as the sweep's hours ("STREET SWEEPING 1ST WEDNESDAY (TOP)/ 2HR PARKING
  8AM-6PM (BOTTOM)" is not 8 to 6). 10 night signs read "2AM-6PM" and are read as 6 AM.

## Gaps and assumptions

1. **Hours from the sign inventory**, not from a City statement; standard 8 to 5 assumed where a sign record names no hours.
2. 419 posted segments (812 sides) carry a day code and `NIGHTSWEEP = Yes`. They keep the day rule; for 2 of 5 such blocks
   the City's lookup said "Night Sweeps" instead.
3. Night rules: season and holidays unknown (all year, holidays too, as the signs read).
4. Holidays and make-up days for day sweeps rest on the lookup's next dates and a 2020 statement.
5. About 60% of residential streets are posted (news, not the City); by the layer, about 50% of day-swept curb miles.
6. The City's lookup and its API block bulk requests; the build uses only the open data layers.

## Questions for the City (DOTI, via 311; open data: opendata-geospatialdenver.hub.arcgis.com)

1. Are posted residential sweeping hours 8 AM to 5 PM everywhere, and which areas are 8 AM to noon? A field for the posted
   hours in ODC_TRANS_STREET_L would settle it.
2. Is sweeping (and enforcement) skipped on all 12 City holidays? Are there make-up days?
3. Downtown overnight sweeping: which nights per block side, all year or April to November, and on holidays? Could the
   centerline carry the night schedule like the day codes?
4. The 419 segments coded with a day and flagged for night sweeping (E 16th and E 17th Avenues, for example): day, night, or both?
5. A data dictionary for LEFTSWEEP, RIGHTSWEEP, SSSID and NIGHTSWEEP, and the license of the sign inventory.
6. Street sweeping citations with date, time and block, for "when tickets usually land".
