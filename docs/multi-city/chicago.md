# Chicago

Built 2026-10-18 with `scripts/cities/chicago.mjs` (format in [city-build.md](city-build.md)). Every number below is
in `data/chicago/report.json`. The City's sweeping schedule is a list of dates, not a weekly pattern, so every
sweeping rule is a date list rule.

## How the rule works

- **Season.** Street sweeping runs from April 1 "through the end of November or later, weather permitting" (the
  City's 2026 release). The 2026 schedule's last date is November 20.
- **When.** Weekdays. The City's Sweeper Tracker page: "On weekdays, from 9am to 2pm, this Sweeper Tracker map will
  show real-time locations of city street sweepers." The bright orange signs carry the hours.
- **Where.** The city is split into 838 ward sections. Each section is swept on two working days in a row, about
  once a month: "one side of the street (East/West or North/South) will be swept on the first date, and the other
  side of the street (East/West or North/South) will be swept on the second date" (the City's 2026 schedule page).
  Nothing says which side goes first. A few sections differ: four are swept every Tuesday and Wednesday (0204,
  0205, 4205, 4308, near downtown), some over four days in a row, and one ward section (34NA, part of the Loop) has
  no dates at all.
- **Signs.** "Bright orange signs announcing temporary parking restrictions. These signs are posted two days prior
  to scheduled street sweeping events. Some streets also have permanently posted signs that specify either a
  once-per-week or two-days-per-month period when parking is prohibited for street sweeping" (2026 release).
- **Fine.** $60: "9-64-040(b) Street Cleaning $60.00" in the Department of Finance's fine schedule (9-64-040(a),
  $50, is the permanent sign version). The City's words for street sweeping never mention a tow, so the rules are
  ticket only (flags 0). News reports say a tow is possible. `city.json` says `tow: "sometimes"`: sweeping is ticket
  only, but the winter ban streets on the same map tow.
- **Holidays.** The 2026 dates already skip the six City holidays in season (Memorial Day, Juneteenth, July 3,
  Labor Day, Columbus Day, Veterans Day): those are exactly the six working days between April 1 and November 20
  when no section is swept. The build stops if any listed date is a City holiday or a weekend.
- **Winter overnight parking ban.** "The ban is enforced on 107 miles of vital arterial streets from 3 am to 7 am
  starting December 1st through April 1st, regardless of snow ... Violators of the parking ban will be towed and
  face a minimum $150 towing fee, a $60 ticket, and a storage fee of $25 per day" (the City's winter parking
  page). The sign reads "NO PARKING 3AM-7AM DEC 1-APR 1 OR WHEN SNOW IS OVER 2 INCHES TOW ZONE". The ban is a weekly
  rule on every day, December to March, plus the April 1 mornings as dates; it runs on holidays and tows (flags 3).
  The two inch snow ban (about 500 more miles) depends on snowfall and is not in the data.

## The data

| Dataset | What it gives | Fresh |
|---|---|---|
| [Street Sweeping Zones - 2026](https://data.cityofchicago.org/d/2r7q-emq3) (Streets and Sanitation) | 838 ward sections as polygons, with the days of each month, April to November | 2026-06-08 |
| [Street Sweeping Schedule - 2026](https://data.cityofchicago.org/d/u5ai-3efk) | The same dates as a table (4,134 section months) | 2026-06-08 |
| [Street Center Lines](https://data.cityofchicago.org/d/6imu-meau) (table pr57-gg9e) | 56,338 block lines with trans_id, house numbers, cross streets, street class | the 2016 network, updated 2021-06-11 |
| [Winter Overnight Parking Restrictions](https://data.cityofchicago.org/d/mcad-r2g5) | The 20 ban routes as lines | 2021-12-06 |
| [Boundaries - Community Areas](https://data.cityofchicago.org/d/igwz-8jzy) | The 77 community areas: each block's neighborhood, the city limits, the welcome card list | 2025 |

All are on the City of Chicago Data Portal under its terms of use. The zones dataset gets a new id every spring
(2025 was utb4-q645), so 2027 dates appear when the City publishes the 2027 dataset; the build's `DATASETS.zones`
and `YEAR` change then.

The zones and the table agree on every section month but one: section 3905 in September reads "16,15" in the zones
and "16,17" in the table. The ward 39 PDF says September 16 and 17. Both sides get all three dates (the union, as for
every difference).

## How it was placed

1. **Which streets.** Residential streets only: centerline class 4, open (status N, or under construction in 2016).
   Left out: arterials (class 2, 6,265 segments) and collectors (class 3, 6,959), because the City sweeps main
   streets on their own schedule, under permanent signs where they are posted, and its own winter ban list calls
   class 3 streets such as Milwaukee Ave, Clark St and Division St "arterial streets". Also left out: expressways,
   ramps, lower level streets, rivers, an undocumented class E (dead ends, connectors, campus and park drives),
   private, vacated and closed streets, and 53 residential lines with no street name.
2. **Which section.** Each side of a block is looked up at three points 7 m off the line (past the curb), at a
   quarter, half and three quarters of its length. The side gets the dates of the section(s) they fall in.
   Moving the points to 5 or 10 m changes about 105 of 37,177 assignments.
   - 32,442 blocks sit inside one section: both sides get the same dates.
   - 3,314 are section boundaries (the polygons are drawn on street centerlines): each side gets its own section's
     dates. 195 blocks have a section boundary crossing them; that side gets both sections' dates.
   - 366 have one side in no section but inside the city (a rail embankment, a channel or a park across the street):
     that side takes the other side's section. 169 face another town across the city limit: the outer side is left out.
   - 886 are in no section (the Loop and downtown, lakefront and park drives, the airports), and 104 are in 34NA,
     which has no dates.
3. **Both days on both sides.** A side lists every date of its section, both days of each pair, because the City does
   not say which side goes first. A driver who moves on both days never gets a ticket; the sheet's line under the
   schedule says "One side is swept on each of the two days; the orange signs say which."
4. **Winter ban.** Matched to the centerlines by street name and distance (4 of 5 points along the block within 15 m
   of a route line of the same street): 16 of the 20 routes match 98 to 100% of their length that way. The route
   labeled "E 103RD ST" from Torrence Ave to State Line Rd is drawn along E 106th St, so blocks that lie exactly on a
   route line (all 5 points within 3 m) are matched whatever their name: E 106th St, Kedzie Blvd (the Logan Square
   piece of the Kedzie route), the Washington Park drives on the Rainey Dr route, and short pieces at Jefferson Park
   (Foster) and 95th St (Cottage Grove). With those, every route is matched over 99% of its length. 1,524 blocks.
5. **Blocks.** `c` is the centerline's trans_id. `s` is the street as signed ("W 82nd St"), `l` the cross streets
   from the centerline (the next real corner when a line ends at a bend or a ramp), `h` the community area, `n` the
   house numbers, `o` the odd side (Chicago puts odd numbers on the south and east sides). Lines keep 6 decimals;
   points on a straight line (within 0.25 m) are dropped, 272,870 to 95,929 points, invisible at any zoom.

## What the numbers say

- 37,699 blocks, 75,221 sides, 96,581 rules, 765,383 listed dates. 36,187 blocks have sweeping, 1,524 the winter ban.
- `segments.json` is 19.6 MB (1.4 MB gzipped), over the 6 MB guideline. Nothing was dropped. Half the bytes (10.0 MB)
  are date lists, and there are only 531 distinct ones: a shared table of date lists would bring it under 10 MB.
- No ticket cross-check: Chicago publishes no current parking citations (only the 1996 to 2018 records released under
  FOIA, through ProPublica).

## Gaps

- Which side is swept on the first day of each pair (the orange signs say).
- Main streets: the permanent sign schedules (once a week, or two days a month) are not published, so arterials and
  collectors show no sweeping at all. Some collectors may in fact follow their section's dates.
- Whether a boundary street is swept side by side with each section, as placed, or wholly with one of them.
- Streets built since 2016 are missing from the centerlines.
- The winter ban list is from 2021. It matches the map the City's winter page still links (2017), but the City says
  107 miles and the 20 routes measure about 98.

## Questions for the City

Contact: dataportal@cityofchicago.org (data portal); Streets and Sanitation through 311.

1. Is there a list of the block sides swept on the first and on the second day of each pair, or a rule (for example
   north and east sides first)?
2. Are collector streets (Grand Ave, Addison St, Damen Ave and the like) swept on their ward section's dates, or on
   the arterial program with permanent signs?
3. On a street that is the boundary of two sections, which section sweeps each side?
4. Can the streets with permanent street cleaning signs be published, with their days and hours?
5. Is the Winter Overnight Parking Restrictions dataset (2021) the current list of the 107 miles?
6. Are cars towed for street sweeping, or only ticketed? And what hours do the orange signs post (9 AM to 2 PM everywhere)?
7. In the 2026 zones, section 3905 reads "16,15" for September; the table and the ward PDF say 16 and 17. Can the
   zones be corrected?
8. What does street class E mean in Street Center Lines? Its 1,113 segments (dead ends, connectors, campus and park
   drives, a few ordinary looking blocks) are left out.

## Files

| File | What it is |
|---|---|
| `scripts/cities/chicago.mjs` | The build. `node scripts/cities/chicago.mjs [--refresh]`; inputs cached in `private/cache/chicago/` |
| `scripts/cities/chicago.test.mjs` | Tests with real rows; `npx vitest run scripts/cities/chicago.test.mjs` |
| `data/chicago/segments.json` | Blocks, sides and rules |
| `data/chicago/city.json` | Time zone, holidays 2026 and 2027, map view, fine, sources, words, the 77 community areas |
| `data/chicago/report.json` | Counts, what was left out and why, the checks, assumptions, questions |
