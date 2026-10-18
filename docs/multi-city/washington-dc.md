# Washington, DC

Built 2026-10-18 by [city-build.md](city-build.md). Build: `node scripts/cities/washington-dc.mjs [--refresh]` (inputs
cached in `private/cache/washington-dc/`), tests: `npx vitest run scripts/cities/washington-dc.test.mjs`. Output:
`data/washington-dc/segments.json` (958 KB), `city.json`, `report.json`.

## Short version

- DC posts its residential street cleaning on signs, block side by block side, and DDOT publishes every sign zone with its
  side of the street, days and hours. That is enough for level 2 (map, sheet, alerts) with no join by street names.
- 5,454 of the 5,675 sweeping zones become rules on **3,541 block sides of 2,064 blocks**.
- Checked against the District's own tickets: of the 2026 street cleaning tickets (P173, $45) placed on a posted block
  with a side named, **90.9% land on a side, weekday and window the data posts** (96.0% on the block, either side).
- The season is March to October, and no ticket was written on any 2026 holiday inside the season, day or night. The
  2026 season ended Friday 2026-10-30, so the map stays green until March 2027.

## How the rule works

Sources: DPW's 2026 season release (archived:
https://web.archive.org/web/20260227230047/https://dpw.dc.gov/release/posted-residential-street-sweeping-resumes-monday-march-2),
https://dpw.dc.gov/spring, https://dpw.dc.gov/page/street-and-alley-cleaning, 18 DCMR 2423.1, and DDOT's sign catalog
(code R-NS-022).

- **Residential sweeping**, posted on signed streets only. The sign (R-NS-022) reads "NO PARKING / MONDAY / 12:30PM TO
  2:30PM / MARCH 1 THRU OCTOBER 31 / EXCEPT HOLIDAYS / TOW AWAY ZONE / IF TOWED CALL 311 / STREET SWEEPING": one weekday
  per side, "generally" 9:30 to 11:30 AM or 12:30 to 2:30 PM (DPW). The two sides of a block go on consecutive days: Monday
  and Tuesday (602 blocks here) or Wednesday and Thursday (707). DPW: "vehicles can park on that side on one day and park
  on the other side on the following day." Blocks join the program by petition (80% of residences, at least 3 blocks).
  Unposted streets are swept without a schedule and without tickets.
- **Season**: 2026 ran Monday March 2 to Friday October 30, with warnings only from March 2 to 13 and $45 fines from March
  16. Since 2024 the start has been the first Monday of March and the end the last weekday on or before October 31; DPW
  announces each season in late February. 2027 is not announced. The rule's months are March to October (mask 1020); in
  2026 March 1 was a Sunday and October 31 a Saturday, so no partial weeks were lost. The two warning weeks are not in the
  format.
- **Overnight sweeping** on 294 zones, mostly on main roads across the city (Georgia, Connecticut and Wisconsin Avenues NW
  hold over half), not only downtown: 10 PM to 5 AM on one night a week (Monday to Thursday nights), or 2 to 5 AM, 1 to 5 AM
  on one morning. DPW says "Overnight scheduled sweeping of the District's major roadways occurs year-round", but there
  were no street cleaning tickets at all from November to February in 2024-25 and 2025-26, and some overnight signs carry
  the same "March 1 thru October 31 except holidays" plaque. The data uses March to October for them too (question below).
- **All-day zones**: 75 zones read 7 AM to 7 PM on one weekday, and their tickets start at 7 AM.
- **Holidays** stop everything: "EXCEPT HOLIDAYS" on the sign, and the District's holiday releases say "All parking
  enforcement will be suspended" (Labor Day and Indigenous Peoples' Day 2026). No make-up days in any source. The tickets
  agree: none on the five 2026 holidays in season, and none before 6 AM the next morning.
- **Fine and tow**: $45, violation P173 NO PARKING STREET CLEANING (every 2025 and 2026 ticket in the data is $45). DPW:
  "violators will be subject to $45 fines and relocation, which carries a $100 fee"; DPW's Parking Control Manual marks P173
  towable. In June 2026, 267 of 1,378 relocation fees were written on the same block, within 30 minutes of a P173 ticket.
  Rules carry flag 2 (towable); `tow` is "sometimes".
- **Holiday list**: DC legal public holidays (DC Code 1-612.02, https://dchr.dc.gov/page/holiday-schedules), with DC
  Emancipation Day (April 16). 2026 is official. 2027 is computed by the Code's rule (a Saturday holiday moves to Friday, a
  Sunday one to Monday) and matches OPM's federal 2027 list, including December 31, 2027 for New Year's Day 2028; DC posts
  its list each January.
- **Time**: Eastern, with daylight saving.

## The data

| Need | Dataset | Notes |
|---|---|---|
| Sweeping rules | DDOT **Parking Zones**, `Transportation_Parking_WebMercator/MapServer/156` (Open Data DC item 402610cb35034aee8328ff745d5622cb) | 72,639 zones from DDOT's sign inventory (survey circa 2016, edited since), CC BY 4.0, updated irregularly (last 2026-10-17). 5,675 have `PARKINGGROUP = 'Sweeping'` (sign code R-NS-022, 11 R-DC-STREETCLEANINGOLD). Each zone is a line offset 5 m to its curb, with `ROUTEID`, `MEAS_FROM`/`MEAS_TO`, `SIDE`, `STARTDAY`/`ENDDAY`, `STARTTIME`/`ENDTIME`, `BLOCKFACEKEY` (= Roadway Blockface), `SIGNTEXT` (field notes), `DATA_ERRORS` |
| Block lines | DDOT **Roadway Block**, `Transportation_WebMercator/MapServer/163` | 13,833 centerlines, one per block, drawn in the direction of increasing route measure, with `BLOCKKEY` (the block id `c`), street, cross streets, left and right address ranges |
| Tickets | **Parking Violations Issued**, `Violations_Parking_2026/MapServer/0..11` (one table per month) | Date, time (HHMM), violation code, block location text with the side ("1300 BLOCK QUEEN ST NE WEST SIDE"), and a point (`XCOORD`/`YCOORD`, Maryland State Plane meters) at the block's address point. 68,529 P173 tickets in 2026 (March to September published) |
| Neighborhoods | Office of Planning **Neighborhood Names**, `Administrative_Other_Boundaries_WebMercator/MapServer/18` | 132 points. DC has no official neighborhood boundaries (the Neighborhood Clusters layer "does not represent boundaries of District of Columbia neighborhoods"), so a block takes the name of the nearest point |

### Decoding

- **Hours**: DDOT's code list (SignWorks_Hours, attached to `DDOT/Signworks/MapServer/3`): 1 = 4:00 AM, 2 = 4:15 AM, ..., 81 =
  12:00 AM, 96 = 3:45 AM; 0 = 12:00 AM, 97 to 99 blank, 100 anytime. So minutes = (225 + 15 × code) mod 1440. Also checked
  against the tickets: on the 2,116 sides whose only window is 23 to 31, 99.7% of 32,760 tickets fall between 9:30 and 11:30
  on the side's weekday.
- **Days**: 1 = Monday to 7 = Sunday, 8 = anytime, 9 = school days.
- **Night windows**: a window that ends before it starts runs into the next morning, from the night of `STARTDAY`
  (Wednesday 10 PM to 5 AM is Wednesday night: its tickets are Wed 10 to 11 PM and Thu 12 to 1 AM). Codes 81 to 96 are
  0:00 to 3:45 on `STARTDAY` itself (a Thursday 2 to 5 AM zone's tickets are Thursday 2 to 4 AM).
- **Side**: `SIDE` is "the side of the SubBlock that this parking zone exists on (if looking towards digitizing direction)",
  the direction of increasing measure the block lines are drawn in: 5,452 of 5,454 zone lines lie on that side.
- **Block**: a zone belongs to the block of its route whose measure range overlaps it most.
- **`DATA_ERRORS`** reads "Missing: [fields] | [flags]": the flags say a day or time band fits none of DDOT's groups (its
  "Overnight" group ends by 4 AM), so every valid 10 PM to 5 AM zone is flagged. It is not a reason to skip.

### What was left out or fixed (`report.json`)

- 97 zones referenced to alley or driveway routes (road types 4 and 5), not street blocks.
- 92 zones with no hours ("Anytime"), 8 whose field note says the sign is missing or not posted, 1 on school days, 4
  night windows over several days ("Weekdays, 10 PM to 5 AM": each night, or one long one?), 19 windows over 12 hours that
  no single fix explains (mostly 7 AM to 8:30 PM, a permit sign's hours).
- 41 AM/PM slips fixed, each listed with its zone: one end 12 hours off ("9:30 to 23:30", "21:00 to 11:30", "12:30 to
  2:30") where exactly one fix gives a window 20 or more zones use, and "21:30 to 23:30", which always sits on a side that
  also has 9:30 to 11:30 and whose tickets are all written in the morning.
- One plaque reads "March 1 thru December 31": that zone runs March to December.
- 312 block sides carry two or more zones with different rules (a side split by an alley, posted differently on each
  part). All the rules are kept, so the side shows each sweep; the format cannot say which stretch of curb each holds on.

## The cross-check (2026 tickets)

Each P173 ticket goes to the nearest street block (its point is the block's address point, within 5 m of the centerline
for 99%; a block named like the ticket's street wins), and to a side by the word in its location (NORTH SIDE, EAST SIDE).

| | Tickets |
|---|---|
| 2026 street cleaning tickets (March to September) | 68,529 |
| Placed on a street block | 67,989 |
| On a block the data posts | 64,985 (95.6%) |
| ... in a window the block posts, either side | 62,374 (96.0%) |
| On a posted block with a side named | 58,256 |
| ... on that side, its weekday and window | **52,929 (90.9%)** |
| ... on that side at another time | 3,234 |
| ... only the other side is posted then | 318 |
| ... on a side the data does not post | 1,775 |

## Gaps

1. A side split into zones with different days shows all of them.
2. The two warning weeks at the start of each season, and the season's exact first and last days, are not in the format
   (months only).
3. Overnight zones: year-round sweeping per DPW, March to October enforcement per the tickets.
4. The 2027 season and the official 2027 holiday list are not published yet.
5. MyDPW DC (the District's app, rebuilt 2026-10-02) already sends block sweeping reminders.

## Questions for the District (DDOT GIS: gisgroup@dc.gov per the dataset's metadata; OCTO: dcgis@dc.gov; DPW via 311)

1. Overnight sweeping signs on Georgia, Connecticut and Wisconsin Avenues: enforced November to February too?
2. The 41 zones whose hours look like AM/PM slips (listed in `report.json`), and the 19 windows over 12 hours: what do
   those signs say?
3. The 4 "Weekdays, 10 PM to 5 AM" zones: every night, or one night?
4. 97 sweeping zones are referenced to alley and driveway routes: should they sit on the street block next to them?
5. Will the 2027 season again start the first Monday of March, with two warning weeks? A feed of season dates and same
   day cancellations (snow, events) would let alerts follow them.
6. A data dictionary for Parking Zones (`DATA_ERRORS`, the day codes 8 and 9) on the Open Data DC page.
