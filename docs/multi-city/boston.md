# Boston

Researched 2026-10-01. Every source below was opened and re-checked by a second pass, with cross origin
checks sent as `Origin: https://curb.guide`.

## Short version

- Boston can reach level 2 (map, block sheet, alerts) from public data.
- The hard part is one thing: the public sweeping schedule has **no street geometry**. We have to attach
  each schedule row to a street line ourselves. A first automatic attempt matched 91% of rows.
- The City already holds the matched geometry inside its own reminder tool, Notify Boston. If they share
  it, the join step disappears.
- There is no public ticket data, so "when tickets usually land" is not possible yet.

## What the City publishes

| Need | Dataset | Notes |
|---|---|---|
| Sweeping schedule | [Street Sweeping Schedules](https://data.boston.gov/dataset/street-sweeping-schedules), Analyze Boston (CKAN), resource `9fdbdcad-67c8-4b23-b6ec-861e77d56227` | 3,758 rows, updated daily, public domain (ODC PDDL), open to browsers. Fields: `st_name`, `from`, `to`, `side` (Odd or Even), `week_1`..`week_5`, `sunday`..`saturday`, `every_day`, `start_time`, `end_time`, `year_round`, `north_end_pilot`, `dist`, `main_id`, `parent`, `losta`, `hista`. **No geometry and no segment id.** No data dictionary |
| Street lines | [Boston Street Segments (SAM)](https://data.boston.gov/dataset/boston-street-segments-sam-system), ArcGIS `SAM/Live_SAM_Address/FeatureServer/3` | 19,440 segments with left and right address ranges, updated nightly. This is what the schedule gets joined to |
| Intersections | ArcGIS `SAM/Live_SAM_Address/FeatureServer/8` | 11,324 points. Used to find a row's `from` and `to` cross streets. Tables 5, 6 and 7 hold street name aliases |
| The City's own joined geometry | Notify Boston, `notify.boston.gov/street-alerts/api/streets/…` | Works and returns block paths, and its variant id equals the schedule's `main_id`. But it is undocumented, has no terms, and only answers its own website. Ask before using |
| Meters | [Parking Meters](https://data.boston.gov/dataset/parking-meters) | 6,955 points, but the content looks frozen around 2017 (rate $0.25 on 6,947 rows). Current rates are only on a web page |
| Curb rules in general | Curb Lab prototype Curbs API (Curb Data Specification format) | Real and reachable, but unofficial, read from sign photos by a model, noisy, and with no street name or side. Not something to build on yet |
| Signs | [Signs (Cartegraph)](https://data.boston.gov/dataset/signs-cartegraph) | 253,139 rows with photos. Raw sign posts, not curb spans |
| Snow emergency routes | [Snow Emergency Routes](https://data.boston.gov/dataset/snow-emergency-routes) | Geometry exists (last edited 2011). No feed says when an emergency is declared |
| Holidays | [City of Boston Holidays](https://www.boston.gov/departments/311/city-boston-holidays) | A web page, no feed. Says per holiday whether daytime sweeping is canceled |
| Tickets | Not published | The newest bulk data is a 2018 to August 2020 records release with no coordinates |
| Resident permit blocks | Not published as curbs | Only permit holder addresses from 2022 and a 2017 PDF map |

## The rules

- **Season.** Daytime sweeping runs April 1 to November 30 in most neighborhoods, and March 1 to
  December 31 in the North End, South End and Beacon Hill. Night sweeping on main and commercial streets
  runs all year. The file has no season dates per row, only `year_round` (361 rows) and `north_end_pilot`
  (333 rows: South End 192, North End 67, Beacon Hill 61, and 13 elsewhere). That the pilot flag means the
  March to December season is our inference, not documented.
- **Sides and weeks.** `side` is Odd or Even, by house number. The two sides usually share a weekday and
  alternate weeks (Odd on weeks 1 and 3, Even on weeks 2 and 4). "Week n" is the nth time that weekday
  falls in the month, the same rule SF uses. 113 rows are weeks 1, 3 and 5, so use the row's flags.
- **Hours.** Day rows are mostly 08:00 to 12:00 and 12:00 to 16:00, with 09:00 to 13:00 and 13:00 to 17:00
  also common. Night rows are 00:01 to 07:00 and similar. 301 rows start at 00:01, so hours are not always
  whole. 5 rows read 12:00 to 04:00 and are probably typos for 16:00.
- **Holidays.** On listed City holidays daytime sweeping is canceled and overnight sweeping runs as normal.
  Evacuation Day (March 17) and Bunker Hill Day (June 17) are normal sweeping days.
- **Fines and towing.** Street cleaning is $40 and towable. Overnight street cleaning is $90 with no tow.
  Charlestown is $90 with no tow. A tow is $132 plus $35 a day of storage. The posted sign wins.
- **Time.** Eastern time, with daylight saving.

## Gaps

1. No sweeping geometry or segment key in public data. Our join matched 3,422 of 3,758 rows on street
   name plus cross streets, and 3,220 also agree on length within 25%. The other 340 or so need the alias
   tables or hand fixes. Putting Odd and Even on the correct side of the line through the segment's
   address ranges is designed but not yet tested.
2. No season dates, tow flag or holiday flag per row. They have to be inferred.
3. No signal for same day cancellations (rain, events).
4. No citations, no current meter rates, no permit-only blocks.
5. Only the Analyze Boston datasets state a license.

## What to ask the City for

In order of how much work each one saves:

1. **The sweeping block geometry behind Notify Boston**, as a file on Analyze Boston, or permission to
   read that API. This removes the join.
2. **A data dictionary** for the schedule: what `north_end_pilot` means, what an empty `side` means
   (198 rows), season start and end per row, and a tow or no tow flag.
3. **A holiday calendar for sweeping** in a machine readable form, and any same day cancellation signal.
4. **Citation data** from the ticket system in use since June 2025: issue date and time, violation,
   location. No plates, no badge numbers. Street cleaning codes for the last two or three seasons would be
   enough to start.
5. **The official Curbs API**: timeline, terms, and whether the street name and side fields will be filled.
6. Current meter rates by zone, permit-only blocks, and a snow emergency status feed.
7. **How to coexist with Notify Boston**, so residents do not get two conflicting reminders.

## How Boston maps onto CURB

- Level 2 at launch: map, block sheet, alerts at `curb.guide/boston`.
- `scripts/cities/boston.mjs` reads the schedule and the street segments, joins them, splits rows that
  list several weekdays into one rule per weekday, and tags each rule with its season
  (`months: [4..11]` or `[3..12]`, none for year round rows).
- Time logic: `makeTimeCore({ tz: 'America/New_York', suspended, holidayName })`. The suspension rule is
  SF's two list model again: daytime rows skip City holidays, night rows do not.
- Known wrinkles for phase 1: the 00:01 start times (rounded down to midnight at first), and the alert
  watch age (120 days today) is one day shorter than the December to April break.
- First step when work starts: a one day test of the join on the full file, or of a dataset with geometry
  if the City provides one. That test decides the rest of the schedule.
