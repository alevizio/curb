# Oakland

Researched and built 2026-10-18, the pilot for the generic city page. Data: `scripts/cities/oakland.mjs` →
`data/oakland/` (segments, city, report); tests: `scripts/cities/oakland.test.mjs`. The build's numbers below come
from `data/oakland/report.json`; dataset sizes come from the City's portals on 2026-10-18.

## Short version

- Oakland can reach level 2 (map, sheet, alerts) from the City's own data: a schedule layer with geometry, odd and
  even sides, and coded days and hours. **10,267 blocks, 18,303 block sides, 26,474 rules.**
- The schedule layer was last edited on 2021-06-21. The City's 2025 and 2026 street sweeping tickets say it is still
  right for most daytime residential routes (81.6% of their tickets fall in the window the data gives, most routes 80
  to 92%), and stale on the night routes on main streets (10 to 14) and the weekend routes (W2 to W6).
- Overall, **69.3% of 316,353 tickets agree with the layer as published, 73.7% after the build swaps 217 blocks whose
  tickets show the odd and even days reversed.**
- The holidays are on the City's page for 2026 and 2027, and the tickets confirm them: no tickets at all on six 2026
  holidays, nights included.

## How sweeping works in Oakland

- **Sides.** Each block side has its own posted schedule: one for the odd house numbers, one for the even. Most
  residential blocks are swept on the 1st and 3rd or the 2nd and 4th occurrence of a weekday, the two sides on
  different weekdays of the same weeks (odd side 1st and 3rd Monday, even side 1st and 3rd Tuesday is the most common
  pair). Some blocks are swept once a month (2nd Wednesday, 1st Friday). Daytime windows are 9 AM to noon and 12:30 to
  3:30 PM.
- **Night routes.** Main streets (Broadway, Telegraph, MacArthur, International, Foothill, San Pablo, downtown) are
  swept at night, midnight to 3 AM or 3 to 6 AM, usually the odd side Tue, Thu and Sat and the even side Mon, Wed and
  Fri. A night window belongs to the calendar date it starts on (a Tuesday 12 to 3 AM sweep is Monday night).
- **All year.** No season: the tickets run evenly from January to December.
- **Holidays.** "Street sweeping will not occur on the following City of Oakland holidays" (the City's Street
  Sweeping page, lists for 2026 and 2027, observed days included). `holidayRule: "all"`. The tickets agree: zero
  tickets on 2026-01-01, 01-19, 02-16, 03-31, 05-25 and 06-19 against about 700 to 950 on the same weekdays around
  them, before 6 AM included. One exception: on 2026-07-03 (Independence Day, observed) the night routes ran (325
  tickets before 6 AM, a normal night) and a little daytime (51). See questions.
- **Fine.** $72, OMC 10.28.240 "No parking certain hours (used for street sweeping)", on the City's Parking Tickets
  page; the citation data has `fine_amount` 72 since September 2024 ($69 before).
- **Tow.** No City page speaks of towing for sweeping; `tow: "no"` is an assumption.
- **After the sweeper passes.** The City's Parking FAQs: no parking for the whole posted window, even after the sweeper
  has passed. When a sweep is cancelled, enforcement is told not to cite. The City says it is building its own
  sweeping reminders and cancellation notices ("coming soon").

## What the City publishes

| Need | Dataset | Notes |
|---|---|---|
| Schedule + geometry | [Street Sweeping Routes](https://services.arcgis.com/9tC74aDHuml0x5Yz/arcgis/rest/services/StreetSweeping/FeatureServer/0), the layer behind [Map Your Street's Sweeping](https://www.oaklandca.gov/Public-Safety-Streets/Streets/Street-Sweeping/Map-Your-Streets-Sweeping) | 23,862 lines (street base map, DYNAMAP_ID), L/R address ranges, ROUTE, DAY_ODD, TIME_ODD, DAY_EVEN, TIME_EVEN as coded values. Edited 2021-06-21. No license stated |
| A newer partial snapshot | [OaklandDayRouteSweepingSegments](https://services.arcgis.com/9tC74aDHuml0x5Yz/arcgis/rest/services/OaklandDayRouteSweepingSegments/FeatureServer/0) | Daytime routes "as of February 2024", 7,512 lines, published 2025-06-16. Same geometry and codes as the 2021 layer (below) |
| Tickets | [Citation Data Portal](https://data.oaklandca.gov/d/58em-y96b) | 2.83M rows, Jan 2018 to Jul 2026: date, time, violation, written address, a point. No plates or names. Street sweeping = 10.28.240 |
| Holidays | [Street Sweeping](https://www.oaklandca.gov/Public-Safety-Streets/Streets/Street-Sweeping) | A web page, 2026 and 2027 |
| Which side is odd, physically | [Oakland Addresses, Dec 2022 revised view](https://services.arcgis.com/9tC74aDHuml0x5Yz/arcgis/rest/services/Oakland_Addresses_as_of_December_2022_revised_view/FeatureServer/0) | 196,435 address points, updated 2026-10-15 |
| Neighborhoods | [neighborhoods](https://data.oaklandca.gov/d/sb4q-6bkc) | 131 polygons; 113 hold swept blocks (city.json) |
| Later, not built | meters `wnjv-tz7z`, residential permit zones `su5x-2u99`, blue zones `cnpw-bvzz` | |

Contact: OpenData@oaklandca.gov.

## How the build places the schedule

1. **Codes.** Every day and time code comes from the layer's coded value domains, checked word for word at each build
   (a changed or new code stops it). The tickets back the domain's words: 98.4% of the tickets on a "2nd Wed" type
   side's weekday and hours fall in the 2nd week, 99.9% of "1st and 3rd" ones in the 1st or 3rd week, 99.8% of "2nd and
   4th" ones in the 2nd or 4th. No code is left undecoded except `missing` (85 even sides, not in the domain). Left out
   as not enforced: `N-S` "No Signage" (401 sides, swept but not posted) and 11 sides with a day but time `NA`.
2. **Repeated names.** The layer repeats a line once per name it has (51st St and Pleasant Valley Ave, San Pablo Ave
   and State Hwy 123): 1,330 copies. One block per line. When copies give a side different schedules (14 sides), the
   tickets on that side choose (10), else the primary record (4).
3. **The 2024 snapshot** holds no schedule the 2021 layer lacks: of its 7,512 lines, 7,501 carry the 2021 primary
   record's schedule and 11 another copy's (the alias it kept, for example "61st St Pl" for 61st Pl). Where it
   differs, its schedule is one more candidate for that line, and the tickets choose (step 2).
4. **Sides.** On a line, the odd side is the side of its odd house numbers (address ranges), checked against the
   City's address points: they agree on 4,807 lines and win on the 21 where they clearly disagree. Lines with no ranges
   take the address points (41) or the next line of the same street (476). 66 lines are left out: two different
   schedules and no way to tell which side is odd. The tickets' own points were not used: they sit on the side the
   address points give on only about 80% of blocks.
5. **Major streets (`MS`).** A street drawn as two lines (a divided street) has `MS` on one side of each line: that
   side is on the other line. Each line becomes its own block with one side, the curb on the side of its house numbers
   (1,654), else away from the street's other line (356). On the 1,624 lines that have both, they agree on 1,621; the
   address points agree with 385 of the 390 major street lines they can test.
6. **Swaps.** A block (or a major street's pair of lines) whose odd numbered tickets fall in the even side's window and
   whose even numbered tickets fall in the odd side's (each at least 3, three times those in their own window, and 40%
   of that parity's tickets) gets its two schedules swapped: 217 blocks, mostly night routes 14 (45), 11 (32), 10 (21)
   and route 3 (15). The layer's own notes say "some of routes shows the sweeping reverse date for odd and even".
   `--as-published` builds without them. Evidence from one parity only (330 blocks) changes nothing and is listed.
7. **Words and ids.** Labels are compass words (like Boston), "Odd side" or "Even side" where a line bends too much
   for one word (523 sides each). Block id `c` = the City's DYNAMAP_ID, which survived the 2024 re-export; 10 lines
   that share one or have none get `-1`, `-2` in the order of their first point.

## The ticket cross-check

326,152 tickets (10.28.240, 2025-01-01 to 2026-07-31). 316,353 placed on a line: the written street, the line whose
house numbers hold the number (on a major street, the line that carries that parity), nearest the ticket's point.
Agreement = the side has a rule for that weekday, that week of the month and that hour (10 minute grace; 73.5% with
none).

| | As published | After swaps |
|---|---|---|
| In the side's own window | 69.3% | 73.7% |
| In the other side's window | 13.4% | 9.0% |
| On a side the layer marks not swept | 5.8% | 5.8% |
| Right day, other hours | 6.3% | 6.6% |
| Other day | 5.0% | 4.8% |
| Right day and hours, other week | 0.2% | 0.2% |

- **Daytime residential routes** (1 to 7E): 81.6% of their 198,247 tickets agree; median route 86%, best 91.5% (6D).
  The few percent in the other side's window on every route look like tickets written with the house number across
  the street.
- **Night routes 10 to 14**: 59.5% as published, 69.0% after swaps (89,551 tickets). Besides reversed sides, some
  blocks are ticketed at other hours (16th St downtown, midnight to 3 AM where the layer says 3 to 6 AM; 17th St by
  the lake, at night where the layer says Thursday and Friday afternoons).
- **Weekend routes W2 to W6** (West Oakland): 35.4%. Blocks coded Saturday and Sunday are ticketed on Thursday and
  Friday at the same hours (Chester St, 5th St, Hollis St). The schedule changed after 2021.
- **Routes where tickets contradict the data** (300+ tickets, under 70% after swaps): 11, 10, (no route), 14, 3, 4B,
  1E, W6, 5N, 4A, W4, W5, W2, 2A/3. 498 block sides have mostly tickets outside any window of the data
  (`contradictedSides`); they are left off the map (2026-10-18), because the map would call those curbs clear at the
  hours people get tickets there. `--keep-contradicted` builds them as the City publishes them.
- **Ticketed but not on the map**: 264 sides the layer marks not swept have 10 or more tickets, mostly downtown and
  Uptown (26th to 31st St, 9th Ave, Harrison St, Lakeshore Ave, Thomas L Berkley Way). Some may be other "no parking
  certain hours" signs (10.28.240 covers any posted hours), others new sweeping since 2021.
- One outlier: the odd side of Vallecito Pl (E 28th St to E 31st St) holds 2,105 tickets at all hours of the week,
  0.7% of the check; unexplained.

## Gaps and assumptions

- The schedule is five years old and the tickets show where it is stale (above). The posted sign wins.
- `tow: "no"` is assumed (no City page mentions towing for sweeping).
- 10.28.240 is "no parking certain hours", used for sweeping but not only for it; the check counts all of it.
- Swaps rest on ticket addresses: the house number written on the ticket decides odd or even.
- 2027 observed holidays come straight from the City's list; whether night routes run on observed days is open.
- Licenses: none stated on the layer, the address points or the portal datasets.
- Cross streets come from the street base map's own names; 23 blocks have none and 1,578 one.

## Questions for the City (OpenData@oaklandca.gov)

1. Is the Street Sweeping Routes layer (edited 2021-06-21) still the schedule on the signs? The 2025 and 2026 tickets
   agree with it on most daytime routes but not on night routes 10 to 14 or the weekend routes W2 to W6.
2. The weekend routes (W2 to W6): did the Saturday and Sunday sweeps move to Thursday and Friday?
3. 217 blocks look reversed between odd and even (their tickets fall in the other side's window, both ways), mostly on
   routes 14, 11, 10 and 3: is the layer reversed there? (List in report.json, `crossCheck.swapped`.)
4. 264 block sides marked not swept get regular 10.28.240 tickets (26th St, 9th Ave, Lakeshore Ave, Harrison St):
   new sweeping routes, or other posted hours?
5. On 2026-07-03 (Independence Day, observed) the night routes were ticketed as usual: do night routes run on observed
   holidays? Do sweeps get made up after a holiday?
6. What do the codes `missing`, `DM` and `NS-UC` mean, and is `EEH` ("Everyday except Holidays") different from `E`?
7. Could the layer be published with one record per line (it repeats a line per alias name, sometimes with a
   different schedule on the copy) and a stable segment id?
8. Under what license can the layer, the citation data and the address points be republished?
9. Is towing ever used for street sweeping?
10. The City's planned sweeping reminders and cancellation notices: will cancellations be published as data?

## What the shared page will need

- **Night wording** for windows starting at midnight on a weekday (Tue 12 to 3 AM is Monday night), as in SF.
- **A side with only one curb** per block for major streets drawn as two lines (each line is its own block with one
  side); the page already draws single sides.
- **"Odd side" / "Even side" labels** on 1,046 sides, and the `o` field for address search (every block has it).
- **Contradicted sides** (`report.json` `crossCheck.contradictedSides`, 498): left off the map by the build (the data
  notes say so); a field to show them marked as uncertain would let the page keep them.
- **Data age**: the sheet should say the schedule is from June 2021, checked against 2025 and 2026 tickets.
