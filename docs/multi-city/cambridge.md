# Cambridge, MA

Researched and built 2026-10-18 (`scripts/cities/cambridge.mjs`, spec in [city-build.md](city-build.md)). **Not shipped:**
the only street by street table the City publishes is from 2014, and the City's own 2025 tickets show it is no longer
what the signs say. The build writes `data/cambridge/report.json` and `city.json` and no `segments.json`.

## Short version

- Every residential street side is swept once a month, April 1 to December 31, usually 8 AM to 2 PM. $100 ticket
  since September 2024, no tow. A sweep on a City holiday moves to a make-up day.
- The street side table (Traffic Regulation Schedule M, 946 rows, revision 9/15/2014) is a PDF. The dataset that
  replaced it on the open data portal (`uvf3-2xt3`) is private now.
- Of 2025 street cleaning tickets written at an address, **78% land on a street the 2014 table sweeps that day and
  hour, 65% on the right side of it, 53% on the right block side.** The City's current pattern (each street cleaning
  district's odd side on one weekday of one week, its even side on another) explains **94.5%** of the same tickets.
- In districts B, C and H one side of every street has moved to another week since 2014 (C even: 1st Monday to 2nd
  Monday; H even: 3rd Monday to 4th Monday; B even: 1st Thursday to 1st Tuesday). The table also lacks streets that
  get tickets every month (Hurley, Rogers, Bent, Reed, Pacific in East Cambridge and Area 4).

## How the rule works

From the City's street cleaning page (`cambridgema.gov/services/streetcleaning`, read 2026-10-18) and its 2025 notice:

- Public Works sweeps both sides of every residential street once a month, April through December. Signs on each
  street give the day ("4th Wednesday") and hours. Schedule M has 913 rows at 8 AM to 2 PM and 33 at 7 to 10 AM.
- Fine $100 per violation since September 1, 2024. Towing was suspended in the 2023 pilot and the 2025 notice says
  "vehicles will not be towed during street cleaning operations".
- Holidays: the sweep moves to a make-up day. 2026: Patriots' Day to Apr 29, Memorial Day to May 29, Juneteenth to
  Jun 29, Independence Day (Jul 3) to Jun 30, Labor Day to Aug 31, Indigenous Peoples' Day to Sep 29, Veterans Day to
  Oct 29, Thanksgiving to Nov 30, Christmas to Dec 29. The day after Thanksgiving and Christmas Eve: no change. Every
  make-up day is a 5th weekday of a month (days 29 to 31), when no regular sweep is scheduled.
- Reminders run on ReCollect, the City's vendor, per address.

## What the City publishes

| Need | Source | Notes |
|---|---|---|
| Street side table | [Schedule M, Section 16.7](https://www.cambridgema.gov/~/media/Files/Traffic/trafficregulations/schedules/mschedulejuly2014.pdf) (PDF, 28 pages) | 946 rows: street, side N/S/E/W, from, to, "4th Wednesday", "8AM-2PM", and install/removal regulation columns (7 rows filled). Revision 9/15/2014 |
| Former schedule dataset | `uvf3-2xt3` on data.cambridgema.gov | 403, "You must be logged in" |
| Street cleaning districts | [`qd7s-qntb`](https://data.cambridgema.gov/d/qd7s-qntb) | 14 polygons, districts A to K (no I), the 2011 map, rows updated 2023-04-11, PDDL |
| District per address | [Master Addresses List `vup6-kpwv`](https://data.cambridgema.gov/d/vup6-kpwv) | 20,874 addresses, `street_sweeping_district`, updated weekly, PDDL |
| Street lines | [Street Centerline `3d3q-sfd6`](https://data.cambridgema.gov/d/3d3q-sfd6) | 2,628 segments with node ids and left/right address ranges, PDDL |
| Tickets | [Cambridge Parking Tickets `vnxa-cuyr`](https://data.cambridgema.gov/d/vnxa-cuyr) | Violation `S1` street cleaning: 16,312 in 2023, 18,118 in 2024, 20,059 in 2025 (Apr 1 to Dec 26). Date, time, and the address or corner typed by the officer. No plates, PDDL |

## What the build does

1. Reads Schedule M with a small PDF reader (the City's file has one text block per cell) into 946 rows; fails if the
   columns move.
2. Places each row on the centerline: walks the street from one cross street to the other ("Dead End", "Somerville
   Line" and "RR Tracks" are the street's ends), mending offset corners and missing pieces of the City's lines. 807
   rows placed. Left out: 68 rows whose side letter runs along the street (an "N side" on a street that runs north,
   common in Riverside and East Cambridge, so the side can't be told), 48 whose cross street isn't on the street, 12
   that list the same side twice with different days (Allen St, Callender St, Concord Ave, Windsor St, and Pleasant
   St), 5 with no walk, 3 with no cross streets (Eliot St says "None"), 2 for Little Mass Ave, 1 with no day (South St).
3. Checks every 2025 street cleaning ticket against the placed table, at three levels (street; street and side, from
   the house number; block side), and against the district pattern.
4. Writes `segments.json` only if at least 90% of tickets land where the table sweeps, at both the side and block
   levels (`SHIP_SHARE`). It does not.

## The ticket check (2025)

20,059 tickets: 4,866 at a corner (side unknown), 543 on a 5th weekday (a make-up day: no regular sweep exists then),
648 at a number no centerline range holds. Of the rest:

| Level | Tickets | Where the 2014 table sweeps that day and hour |
|---|---|---|
| Street | 14,650 | 11,410 (77.9%) |
| Street and side | 12,398 (1,604 more on sides the build can't tell) | 8,027 (64.7%) |
| Block side | 14,002 | 7,456 (53.2%) |
| Their district's day for that side (the current pattern) | 13,216 | 12,492 (94.5%) |

By district, street and side level: A 77%, B 59%, C 37%, D 83%, E 91%, F 87%, G 72%, H 40%, J 63%, K 53%.

The pattern the tickets show (most common day, and the share of that district side's tickets on it):

| District | Odd side | Even side |
|---|---|---|
| A | 1st Wed (97%) | 1st Thu (92%) |
| B | 1st Mon (97%) | 1st Tue (97%) |
| C | 1st Fri (98%) | 2nd Mon (97%) |
| D | 2nd Tue (90%) | 2nd Wed (96%) |
| E | 2nd Thu (99%) | 2nd Fri (95%) |
| F | 3rd Mon (94%) | 3rd Tue (94%) |
| G | 3rd Wed (98%) | 3rd Thu (96%) |
| H | 3rd Fri (92%) | 4th Mon (94%) |
| J | 4th Tue (95%) | 4th Wed (86%) |
| K | 4th Thu (86%) | 4th Fri (92%) |

Twenty slots, every weekday of weeks 1 to 4 once. In 2014 three of them were doubled up instead (B's even side on A's
1st Thursday, C's even side on B's 1st Monday, H's even side on F's 3rd Monday) and 1st Tuesday, 2nd Monday and 4th
Monday were nearly empty. On the placed table, 612 of 2,079 block side rules differ from this pattern; most of them in
B (103 of 252), C (135 of 252) and H (144 of 241).

Examples (2025 tickets by house number parity and day):

- Magazine St, Schedule M: E 1st Monday, W 1st Friday. Tickets: odd 1st Friday 69, even **2nd Monday** 59, none on a
  1st Monday.
- Inman St, Schedule M: E 1st Thursday 8 to 2, W 1st Monday 7 to 10. Tickets: odd 1st Monday 87, even **1st Tuesday** 23.
- Raymond St, Schedule M: E 3rd Monday, W 3rd Friday. Tickets: odd 3rd Friday 43, even **4th Monday** 8.

Spot check, by hand and not part of the build: the City's reminder tool for one address in each of the 10 districts
(10 lookups) gives the same odd and even days as the ticket pattern, for 2025 and 2026, 10 of 10.

## What it would take

Any of these makes Cambridge buildable:

1. **The current Schedule M**, or the street schedule dataset (`uvf3-2xt3`) made public again. The build reads the
   same PDF layout and its ticket check decides by itself.
2. **The district pattern, published by the City.** Districts (`qd7s-qntb` and the address list) plus "district A:
   odd side 1st Wednesday, even side 1st Thursday" and so on would give every block side a rule. The tickets support
   it at 94.5%. Exceptions on the signs (the 7 to 10 AM stretches: 33 rows in 2014) would still need the City's list.
3. A decision by the project owner to build from the pattern the tickets show, checked against the City's reminder
   tool at 10 addresses. Not done here: the reminder tool is only for spot checks, and the pattern is our inference.

## Gaps and assumptions

- Make-up days are not modeled: a holiday shows as no sweep (`holidayRule: "all"`), and the make-up day as nothing.
- 2027 holidays are the 2026 set by the same rules (observed on a Friday or Monday); the City posts its list each
  spring. The City page still carries a few 2025 lines (Day after Thanksgiving "Friday November 28th").
- The 2014 table has typos and short forms ("Fountian Terr", "Riedisel Ave", "Mass Ave"); an alias table in the build
  turns them into the centerline's names.
- Ticket locations are typed by officers: 4,866 corners have no side, 648 numbers are in no range.
- Towing: the 2023 to 2025 notices say no towing; the 2026 page does not say. `city.json` says `tow: "no"`.

## Questions for the City

1. Is there a revision of Schedule M after 9/15/2014? Can the street schedule dataset (`uvf3-2xt3`) be public again?
2. Is the schedule now one weekday per district and side (as the reminder tool and the 2025 tickets show), and
   which streets are exceptions (7 to 10 AM, or another day)?
3. Is the 2011 district map (`qd7s-qntb`) still current? Streets missing from the 2014 table (Hurley St, Rogers St,
   Bent St, Reed St, Pacific St and others with monthly tickets): which district are they in?
4. Make-up days: could the yearly list be published as data (date moved from, date moved to, which districts)?
5. Is towing still suspended in 2026?
6. In Schedule M some sides are named along the street ("N" on a street that runs north) and some rows list one side
   twice (Allen St, Callender St, Concord Ave, Windsor St): which side is which?

## Files

`scripts/cities/cambridge.mjs` (build), `scripts/cities/cambridge.test.mjs` (tests: the PDF reader on real rows, the
words, the ticket places, the side letters; plus the cached PDF when present), `data/cambridge/city.json`,
`data/cambridge/report.json`. Downloads in `private/cache/cambridge/` (the PDF, centerline, addresses, 2025 tickets,
the City page; the spot check's answers in `recollect/`, never used by the build).
