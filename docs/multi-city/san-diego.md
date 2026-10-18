# San Diego

Data built 2026-10-18 (`scripts/cities/san-diego.mjs` → `data/san-diego/`), following [city-build.md](city-build.md).
No page yet. Every number below is in `data/san-diego/report.json`.

## How the rule works

- **Only posted blocks get tickets.** "Some street sweeping routes are posted with 'no parking' signs stating the day of
  the week and time of day"; unposted streets "have no signs and have no parking restrictions", and residents are asked
  to move voluntarily ([Stormwater Department](https://www.sandiego.gov/stormwater/services/streetsweeping)). The
  schedule marks 3,367 of 28,141 segments posted (12%). Only those are on the map.
- **Each side has its own day and hours**, named by compass: "NS 1st Thu, SS 1st Wed", "NS/WS", "SES". Busy streets
  are swept weekly, often overnight (2 to 6 AM: 892 blocks); residential blocks once or twice a month; 502 blocks only
  in odd or even months ("Even Month 3rd Thu (ES), Odd Month 3rd Thu (WS)").
- **Holidays:** "If your assigned sweeping day falls on a scheduled City holiday, it will not be swept. The route will
  be swept on the next assigned sweeping day." The City's holiday notices list "posted street-sweeping routes" as not
  enforced (Labor Day 2026; the Dec. 23, 2021 notice shows a Saturday holiday observed the Friday before). No make-up
  day: `holidayRule: all`.
- **Fine:** $83.50 on every street sweeping ticket (City Code 86.0112(E)) since November 2025, $85.00 from July to
  October 2025, from the City's own citation data. No fine schedule page was found on sandiego.gov. No tow mentioned
  anywhere (unverified).

## The data

| Need | Source | Notes |
|---|---|---|
| Schedule and lines | [Street Sweeping Schedule](https://data.sandiego.gov/datasets/street-sweeping-schedule/) (Stormwater, ODC PDDL) | 28,141 LineString features (28,100 segments), `sapid` id, L/R address ranges, cross streets, `posted` P/NP, `schedule` + `schedule2` as text. Last updated 2026-05-05. The live GeoSweep MapServer (layer 13) had the same 3,367 posted schedules on 2026-10-18, word for word |
| Neighborhood | [Community Planning Areas](https://data.sandiego.gov/datasets/gis-community-planning-districts/) (ODC PDDL) | `cpcode` → name; "Mid-City:City Heights" shown as "City Heights" |
| Check | [Parking Citations](https://data.sandiego.gov/datasets/parking-citations/) (ODC PDDL) | Date and typed address, no time. 88,524 street sweeping tickets from 2025-08-01 to 2026-07-31 |
| Odd side | [Address Points](https://data.sandiego.gov/datasets/gis-address-points-apn/) (SANDAG, ODC PDDL) | 461,598 City address points; only counts are kept, no address goes into any file |

## How it was built

1. **The schedule text.** 217 distinct posted strings (223 before trimming spaces) in many grammars: windows before or
   after the side, days said once for both sides, schedule2 with its own hours, "Not Posted" for one side, "NS & WS".
   `parseSchedule` reads all but two, which name no day or no hours (4 segments, in `skipped.unreadable`):
   Hollister St "Posted (12am-3am), WS, Not Posted, ES" (no day) and 14th St / 15th St "Red Curb ES Mon & Thu, WS Tue &
   Fri" (no hours, red curb). Result: 3,363 blocks, 6,612 sides, 7,799 rules.
2. **Which side is "NS".** The sign side goes on the side of the line whose outward normal is closest to that compass
   direction, length weighted along the line (`sideOf`). Where the City's compass word runs within ~20° of the street
   (a "north side" on a north to south street: 362 rules), the word is ambiguous and the tickets decide: a ticket's
   house number parity says which side it was written on, counted only on dates when that rule alone sweeps (5 tickets
   and 80%, the block first, then the same street with the same schedule text). 146 compass guesses were confirmed, 136
   moved, 80 stay as compass guesses (no tickets; mostly La Jolla Shores and Clairemont cul-de-sacs). Those sides are
   labeled by their real compass direction, not the City's word.
   Example: Haines St in Pacific Beach runs north to south and is written "NS 1st Thu, SS 1st Wed"; its 1st Thursday
   tickets are on the even, west side, so Thursday is drawn on the west side.
3. **"Every Tues & Wed"** (122 segments on El Cajon Blvd, University Ave, Washington St and Normal St) names no side.
   The tickets show one side per day: on El Cajon Blvd 287 even side tickets on Tuesdays and 429 odd side on
   Wednesdays, against 7 the other way. 64 blocks are split that way; 58 (University Ave, W University Ave, Normal St:
   the split is there but under 80%) stay both sides both days.
4. **Odd side.** The address points put the odd numbers on the same side as the City's L/R ranges on 2,550 blocks and
   the other side on 8 (cul-de-sacs and 28th St, B to A), which use the address points.

## What the City's tickets say

Each ticket of the last 12 months goes on the posted block of its street whose numbers hold it, on the side holding its
parity. Of 84,201 tickets on posted blocks:

- **86.9% land on a side the data says is swept that date** (weekday, week of the month, month).
- **0.24% (200) land on a block not swept that date at all**: the days and weeks in the schedule match the signs.
- 6 tickets in the year fall on a City holiday: holidays are off, as the City says.
- **12.8% land on the other side of the street.** 2,690 of those are round block numbers ("1100 28TH ST"), typed for
  any car on the block. 4,304 are on **105 blocks where the tickets on both sides are on the side opposite to the
  schedule** (against 218 the right way): Broadway downtown (11 blocks), Lincoln Ave (10), Thomas Ave (9), several
  Pacific Beach streets, 28th St. The sides look swapped in the dataset, or the signs differ from it. Since 2026-10-18
  the build swaps them to follow the tickets, as Oakland's does (`report.json` `sideSwapCandidates`), which raises the
  86.9% to 91.6%; `--as-published` keeps the City's text.
- 742 tickets land only on unposted segments and 3,479 on no segment (typos, addresses outside the ranges).

The citation data has no time, so the hours are not checked.

## Gaps

- The 105 blocks above: the City's text and its tickets disagree. A decision: keep the text (now) or follow the tickets.
- 80 ambiguous sides placed by compass alone, and 58 "Every Tues & Wed" blocks drawn on both sides both days.
- 2027 holidays are derived (the City posts one year): the same eleven holidays, with Juneteenth on Friday, June 18,
  Independence Day on Monday, July 5, Christmas on Friday, Dec. 24, and New Year's Day 2028 on Friday, Dec. 31, 2027.
- Fine and tow come from the citation data, not a City page.
- The odd and even month masks (2730, 1365) need their own words on the page: "even months", "odd months".
- 122 segments are "UNFUNDED" and 75 more are unposted "Odd Month 4th Fri": not on the map, as unposted.

## Questions for the City (data@sandiego.gov, swppp@sandiego.gov)

1. On 105 blocks (listed in `report.json`), last year's tickets on both sides are on the side opposite to the schedule.
   Are the sides swapped in the dataset, or do the signs differ?
2. "Every Tues & Wed" (El Cajon Blvd, University Ave, Washington St, Normal St): which side is swept which day?
3. What does "NS" mean on a north to south street (Haines St, Dawes St, Cass St in Pacific Beach)? The tickets point
   to the west side on Haines and Dawes, but the east side on Cass and Everts.
4. Hollister St "Posted (12am-3am), WS" has no day; 14th St and 15th St say "Red Curb ES Mon & Thu, WS Tue & Fri"
   with no hours. What do the signs say?
5. The 2027 City holidays, and whether Friday, Dec. 31, 2027 is observed for New Year's Day 2028.
6. The fine schedule for 86.0112(E), and whether cars are ever towed for street sweeping.
7. Could the schedule name each side as left/right or odd/even (as the address ranges do), and could citations carry
   a time? The GeoSweep layer already has ROUTE_L and ROUTE_R.
