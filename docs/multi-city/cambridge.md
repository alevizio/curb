# Cambridge, MA

Researched 2026-10-18; built 2026-11-20 from the City's district schedule (`scripts/cities/cambridge.mjs`, spec in
[city-build.md](city-build.md)). **A preview** at curb.guide/cambridge: noindex and unlisted, not in `scripts/cities/public.mjs`
`PUBLIC`.

## Short version

- Every residential street side is swept once a month, April to December. Signs give the day ("2nd Thursday") and the
  hours: the City says most streets are 8 AM to noon, a few differ, and drivers should follow the posted signs. $100
  ticket since September 2024, no tow. A sweep on a City holiday moves to a make-up day.
- What changed: on 2026-10-22 the City made its Street Sweeping Schedule (`uvf3-2xt3`) public again, updated for 2026:
  20 rows, one per street cleaning district (A to K, no I) and side (odd or even house numbers), with the day on the
  signs ("1st Wed") and the date of each month's sweep, April to December, make-up days included. No hours. The Master
  Addresses List (`vup6-kpwv`) gives every address its district, and the City suggested joining the two. The build does
  that join on the City's street centerline.
- 3,515 block sides on 2,062 blocks get a district and its nine dates, 8 AM to noon. 375 sides with an address range are
  left off: they have no address points, no district on their addresses, or addresses split between districts.
- Of the 2025 street cleaning tickets placed on a block side, **91.6% land on a side the schedule sweeps that day, 8 to
  noon** (street level 95.7%, street and side 95.2%). That is over the 90% gate, so `segments.json` ships.

## How the rule works

From the City's street cleaning page (`cambridgema.gov/services/streetcleaning`, read 2026-10-18), its 2025 notice and the
schedule dataset's description:

- Public Works sweeps both sides of every residential street once a month, April through December. Within each district
  the odd and even sides are swept on different days: twenty slots, every weekday of weeks 1 to 4 once.
- Hours are on the signs. The City (October 2026): most streets are 8 AM to noon, a few streets differ, follow the posted
  signs. CURB shows 8 AM to noon everywhere and says the sign decides.
- Fine $100 per violation since September 1, 2024. Towing was suspended in the 2023 pilot and the 2025 notice says
  "vehicles will not be towed during street cleaning operations".
- Holidays: no sweeping; the sweep moves to a make-up day, a 5th weekday (days 29 to 31) when no regular sweep is
  scheduled. 2026: Patriots' Day to Apr 29, Memorial Day to May 29, Juneteenth to Jun 29, Independence Day (Jul 3) to
  Jun 30, Labor Day to Aug 31, Indigenous Peoples' Day to Sep 29, Veterans Day to Oct 29, Thanksgiving to Nov 30,
  Christmas to Dec 29. The day after Thanksgiving and Christmas Eve: no change.
- Reminders run on ReCollect, the City's vendor, per address.

## What the City publishes

| Need | Source | Notes |
|---|---|---|
| Schedule | [Street Sweeping Schedule `uvf3-2xt3`](https://data.cambridgema.gov/d/uvf3-2xt3) | Public Works, PDDL. 20 rows: district, side (Odd, Even), day ("1st Wed"), a date column per month April to December 2026, and the month of any holiday change. Rows updated 2026-10-22 |
| District per address | [Master Addresses List `vup6-kpwv`](https://data.cambridgema.gov/d/vup6-kpwv) | 20,881 addresses, `street_sweeping_district` (951 have none), `neighborhood`, updated weekly, PDDL |
| Street lines | [Street Centerline `3d3q-sfd6`](https://data.cambridgema.gov/d/3d3q-sfd6) | 2,628 segments with node ids and left/right address ranges, PDDL |
| Tickets | [Cambridge Parking Tickets `vnxa-cuyr`](https://data.cambridgema.gov/d/vnxa-cuyr) | Violation `S1` street cleaning: 20,059 in 2025 (Apr 1 to Dec 26), with date, time and the address or corner typed by the officer. No plates. The table ends 2025-12-31: no 2026 tickets yet |
| District map | [`qd7s-qntb`](https://data.cambridgema.gov/d/qd7s-qntb), and `upm7-2w6p` (named in the schedule's description) | Polygons; not used: the address list is the City's own join |
| Former street table | [Schedule M, Section 16.7](https://www.cambridgema.gov/~/media/Files/Traffic/trafficregulations/schedules/mschedulejuly2014.pdf) | Revision 9/15/2014. No longer used (see "The 2014 table" below) |

## What the build does

1. Reads the schedule into one list of nine dates per district and side. Every date is checked against the row's day
   ("1st Wed" in that month): it is that day, or the make-up day the City's page gives for a holiday falling on it. One
   date is neither (below); it is kept as the City lists it. Fails when the table changes shape (20 rows, districts A to K
   without I, an odd and an even row each) or when a listed date is a City holiday (CURB would drop it).
2. Places each address of the Master Addresses List on its street's centerline segment, on the side whose address range
   holds its number with its parity (the nearer line when two ranges hold it). 20,033 of 20,881 placed: 237 are on
   streets the centerline doesn't have (Newtowne Ct, Peabody Ter, Graham Pl, Harvard Yard, Gray Gdns and other private
   ways and campuses), 604 have a number no range holds, 7 no number.
3. On 11 segments the address points lie on the other side of the line from the one their numbers give (Lincoln Way 19
   of 20, Walden Mews, Jackson Pl, two blocks of Broadway, Dunstable Rd and others): the ranges are on the wrong sides
   there, so the sides are swapped (the rule `scripts/cities/norfolk.mjs` uses).
4. A block side takes the district of at least 75% of its addresses (addresses with no district count against it).
   3,503 sides have one district on every address, 12 pass by majority (Massachusetts Ave K 78%, Third St A 75%, Huron
   Ave J 83%, JFK St E 85% and 88%, ...). Left off: 250 sides whose addresses have no district, 32 split (Hampshire St
   B 2 A 1; Massachusetts Ave G 7 H 4; Binney St A 1 and 3 with none), 89 sides with a range and no address point, and
   4 sides of segments whose id the centerline uses twice (Main_St_10, Main_St_11, Memoria_Dr_27).
5. Each side gets one rule: no parking 8 to 12 on its district's nine 2026 dates for its parity
   (`[-1, 8, 12, 0, 0, 0, [dates]]`), so make-up days are on the map and no holiday rule is guessed.
6. Checks every 2025 ticket, and writes `segments.json` only if at least 90% of those placed on a block side land on a
   side the schedule sweeps that day and hour (`SHIP_SHARE`; a side left off the map counts as a miss).

## The ticket check (2025)

The 2026 dates are not 2025's, so each list is read by its day on the signs on 2025's calendar. 20,059 tickets: 4,766 at a
corner (side unknown), 100 with no house number, 543 on a 5th weekday (make-up days, which only the 2026 dates have),
648 at a number no centerline range holds within 20. Of the rest:

| Level | Tickets | On a side the schedule sweeps that day, 8 to noon |
|---|---|---|
| Street | 14,650 | 14,023 (95.7%) |
| Street and side (the house number's parity) | 13,903 | 13,242 (95.2%) |
| Block side | 14,002 | 12,819 (91.6%) |

Block side misses: 457 on another day, 260 when the other side of the block is swept, 9 on the right day outside 8 to
noon, and 457 on sides left off the map (229 whose addresses have no district, 133 split, 72 with no address point, 23 on
the repeated Main St ids).

By district, block side level: A 95.1%, B 97.5%, C 97.7%, D 93.3%, E 96.8%, F 93.5%, G 97.1%, H 93.1%, J 90.2%, K 89.2%.
By list, the share of its tickets on its own day: from 85.8% (J even, 4th Wed) and 87.2% (K odd, 4th Thu) to 98.9% (E odd,
2nd Thu).

Where the tickets and the address list disagree most (2025 tickets, block side level):

- Huron Ave, even side, J (4th Wed): 79 tickets on a 4th Tuesday, J odd's day.
- Inman St, odd side, D (2nd Tue): 67 tickets on a 1st Monday, B odd's day (the 2014 table had Inman St in B too).
- Berkshire St, A even (1st Thu): 30 on a 1st Wednesday. Wheeler St, H odd (3rd Fri): 28 on a 4th Tuesday. Concord Ave,
  K even (4th Fri): 24 on a 4th Monday. Garden St, H odd: 21 on a 4th Thursday. Mt Auburn St, K odd (4th Thu): 18 on a
  4th Monday.
- Ticketed sides whose addresses have no district: Pacific St (31), Albany St (30), Green St (24), Bent St (24),
  Landsdowne St (23), Vassar St (19, plus 65 on its split sides), Sidney St (19), Brookline St (13).

## Hours

2025 street cleaning tickets by the hour written: 7 AM 11, 8 AM 12,868, 9 AM 6,629, 10 AM 496, 11 AM 54, 6 PM 1. After
noon: 1 of 19,370 on regular days (a ticket at 6:47 PM at "1 Cambridge Common"), none of 689 on 5th weekdays. So the map
uses 8 AM to noon, as the City said. The tickets can't tell noon from 2 PM (they are written right after the sweeper:
97% between 8 and 10 AM); 8 to noon is the City's word.

Before 8 AM: 11 tickets, 7:27 to 7:59 (Plympton St, Cogswell Ave, Davenport St, Kirkland St, Inman St, Green St, Follen St,
Garden St). The 2014 table had 33 rows at 7 to 10 AM on 21 streets (Appian Way, Arrow St, Bishop Allen Dr, Broadway,
Cambridge St, DeWolfe St, Doane St, Dunster St, Hampshire St, Holyoke St, Huron Ave, Inman St, James St, JFK St, Main
St, Mount Auburn St, Quincy St, Sellers St, Surrey St, Temple St, Third St): 1,892 tickets in 2025 on those streets, one
before 8 AM (Inman St, 7:58). Those signs may still say 7 AM: the map says 8, and the sign decides.

## What looked odd in the City's data

- **District B, even side, September 2026:** listed Sep 8, a 2nd Tuesday. Its day is the 1st Tuesday (Sep 1), Sep 1 is no
  holiday, and the row's holiday column is empty. Sep 8 is also D odd's day (2nd Tue). Kept as listed; the date has passed.
- The schedule's description says cars must move "to avoid being ticketed and towed"; the 2023 to 2025 notices say no
  towing, and the 2026 page does not say. `city.json` keeps `tow: "no"`.
- The day column's description says holiday changes are marked "H"; no row has one (the month column notes them instead).
- The centerline uses five ids twice (Main_St_10, Main_St_11, Monsign-O_Hwy_6, Memoria_Dr_27, Memoria_Dr_28), and 11
  segments have their address ranges on the wrong sides (above).
- The address list's districts disagree with the tickets on a few streets (above), and 951 addresses have no district,
  mostly on main roads and campuses (Massachusetts Ave 45, Concord Ave 40, Memorial Dr 38, Alewife Brook Pkwy 37,
  Larchwood Dr 36, Aberdeen Ave 35).

## Gaps and assumptions

- Hours: 8 AM to noon on every side. A few streets post other hours (the City); the 2014 table's 7 to 10 AM streets
  may start at 7.
- 2026 only. After the last date (Dec 29, 2026) a side has no next sweep until the City publishes 2027 and the build runs
  again, before April 1, 2027.
- 375 sides are left off (above); 457 of the 2025 tickets fell on them, so some of them are posted.
- Make-up days are the City's dates; no tickets check them (2025's make-up days are not in the data, and there are no
  2026 tickets yet).
- No one has checked blocks on the street against the signs yet (adding-a-city.md asks for 20 before a city goes public).
- 2027 holidays in `city.json` are the 2026 set by the same rules (observed on a Friday or Monday); they stop nothing
  until 2027 dates are built.

## Questions for the City

1. District B, even side: was September's sweep on Sep 8 or Sep 1?
2. Which streets post hours other than 8 AM to noon, and could the schedule (or the address list) say so?
3. Ticketed streets whose addresses have no district (Pacific St, Albany St, Green St, Bent St, Landsdowne St, Vassar St,
   Sidney St, Brookline St): which district is each side in?
4. Where the tickets and the address list disagree (Inman St odd side: D in the list, ticketed on 1st Mondays; Huron Ave
   even side: J even in the list, ticketed on 4th Tuesdays; Berkshire St, Wheeler St, Concord Ave, Garden St, Mt Auburn
   St), which day is on the signs?
5. When will the 2027 schedule be published?
6. Is towing still suspended? The dataset's description says cars are towed.
7. Which district map is current, `qd7s-qntb` or `upm7-2w6p`?

## The 2014 table (2026-10-18, no longer built)

Before the schedule was public, the only street by street table was Traffic Regulation Schedule M (PDF, 946 rows,
revision 9/15/2014). The first build read it, placed 807 rows on the centerline, and checked the 2025 tickets: 77.9% on a
street it swept that day and hour, 64.7% on the right side, 53.2% on the right block side, against 94.5% for the district
pattern the tickets showed. In districts B, C and H one side of every street had moved to another week since 2014. It
did not ship. The new build reads the City's schedule instead (the PDF reader is in the git history,
`scripts/cities/cambridge.mjs` before 2026-11-20). The pattern the tickets showed then is the one the City now publishes,
20 of 20 slots, and a spot check of the City's reminder tool at one address per district (2026-10-18) agreed 10 of 10.

## Files

`scripts/cities/cambridge.mjs` (build), `scripts/cities/cambridge.test.mjs` (tests: the schedule's dates with the City's
20 rows, a side's district, house numbers on the ranges, the tickets' places; plus the cached schedule when present),
`data/cambridge/segments.json`, `city.json`, `report.json`. Downloads in `private/cache/cambridge/` (gitignored).
