# Pittsburgh

Built 2026-10-18, six weeks before the season ends (November 30). Data build: `scripts/cities/pittsburgh.mjs` →
`data/pittsburgh/` (format in [city-build.md](city-build.md)); tests: `scripts/cities/pittsburgh.test.mjs`.

## How the rule works

Public Works sweeps residential streets on a posted monthly schedule, one day per side.

- **Season:** "Street Sweeping begins April 1 and ends November 30" ([City page](https://www.pittsburghpa.gov/Resident-Services/Road-Maintenance/Street-Maintenance/Street-Sweeping)).
- **Days:** each side has its day of the month, the nth weekday: for example the 4th Monday on one side and the 4th
  Tuesday on the other. Monday to Thursday in the data (one code has Monday and Wednesday, see below).
- **Hours:** the City publishes none per block. Its page: "Neighborhood and residential street sweeping begins after 8
  AM and ends approximately at 2:30 PM"; the 2026 Council bulletin: "between 8:00 AM and about 2:30 PM". Older signs are
  reported to read 8:30 a.m. to 2 p.m. CURB uses **8 AM to 2:30 PM**, which covers both (unverified against signs).
- **Fine:** $30, Parking Authority "List of Infractions" (updated 1/27/2025): 541.01(c)(4) "No Parking - street
  cleaning", $30, no extra fee. Since 2025 camera cars record plates on streets being swept and tickets are mailed. No
  tow found.
- **Holidays:** "when an observed holiday falls on the same day as signed Street Cleaning, the Street Cleaning day is
  cancelled, and will not occur until the next street signed Street Cleaning day" (City page). The City Clerk's 2026
  calendar marks 11 holidays; Presidents' Day is not one. In season and on a sweeping weekday: Memorial Day, Labor Day,
  Veterans Day and Thanksgiving (the 4th Thursday of November is always Thanksgiving, so 4th Thursday sides have no
  November sweep). `holidayRule: all`.
- Business districts are cleaned at night and are not in these codes.

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Pittsburgh Street Centerline](https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PavementPublic/FeatureServer/0) (Public Works, "PavementPublic") | 19,683 segments; 3,763 carry `sweep_left` and/or `sweep_right`. Also `carteid` (the Cartegraph id), address ranges, `fromstreet`/`tostreet`, `hood_left`/`hood_right`, `retired` | Edited 2026-09-24. Mirrored on [WPRDC](https://data.wprdc.org/dataset/pittsburgh-street-centerlines) under CC0 |
| [Neighborhoods](https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHWebNeighborhoods/FeatureServer/0) (City) | The 90 official neighborhood names | Names only (the layer also has staff names; never requested) |

**The sweep fields are documented**, in WPRDC's data dictionary for the centerline (not on the ArcGIS layer): "The
Street Sweeping Route identifier to the right and left of a segment, when facing the direction the line segment has been
drawn. The identifier consists of 3 parts: the Public Works Division, the route number, and the date of street
sweeping (e.g. '5SW8-2W' is done by the 5th Division, on route number 8, and completed on the 2nd Wednesday of each
month)." The same dictionary says `fromstreet` is at the line's first point and `tostreet` at its last.

### Decoding

`<division>SW<route>[A|B]-<week><day letters>`

| Part | Meaning | Values in the data |
|---|---|---|
| Division | Public Works division | 1 to 5 (one side reads 6: `6SW6-2M`, decoded the same) |
| `SW` | street sweeping | always |
| Route | route number, A and B pairing two routes on the same blocks | 1 to 44; A/B pairs only in Division 2 (A is the earlier day) |
| Week | which occurrence of the weekday in the month | 1 to 4 |
| Day letters | M Monday, T Tuesday, W Wednesday, R Thursday | one letter, except `3SW1-3MW` |

Examples: `2SW10A-4M` = 4th Monday, `2SW10B-4T` = 4th Tuesday, `1SW10-1R` = 1st Thursday, `3SW1-3MW` = 3rd Monday and
3rd Wednesday (read literally; the dictionary has no two letter example). All 56 codes in the data and how many sides
each covers are in `report.json` (`decoding.codes`). None failed to parse.

## How it was placed

- Each coded segment is one block keyed by `carteid` (unique across all 19,683 segments). Five retired segments
  (`retired` set) are skipped: the live segments that replaced four of them carry their codes (N Craig St, Federal St
  S); the ones that replaced the fifth (Sarah St at E Carson St) carry none. One two part line (Noblestown Rd, parts
  0.1 m apart) is joined.
- `sweep_left` goes on the line's left, `sweep_right` on its right, as the dictionary says. Checked three ways:
  1. Addresses rise from the first point to the last on 3,601 of 3,606 numbered segments, and the odd numbers are on
     the left on 3,565: a consistent drawing direction.
  2. Downtown, 437 Grant St (the Frick Building) is on the northwest side and 436 (the County Courthouse) on the
     southeast, as the data places them.
  3. Oakland's street cleaning list by odd and even side, published by the Oakland Planning and Development
     Corporation (not the City; no City list by street was found): of 204 side days that can be compared, 139 agree,
     37 match the other side of the street, and 28 differ. The "other side" cases cluster on a few streets (Oakland
     Ave, S Bouquet St, the South Oakland part of Parkview Ave, Lawn St, the 3400 block of Bates St, N Bellefield
     Ave), where either the list or the codes have the sides swapped; flipped, the whole check would be 37 against 139.
- Rule: `[weekday, 8, "14:30", 1 << (week - 1), 2040, 0]`, April to November, not towable, stopped by holidays.
- 73 blocks carry one code on both sides (both sides the same day); 694 are swept on one side only.
- `l` is "from street - to street" in the line's direction; an end that carries the block's own name is dropped.
- `h` is the official neighborhood name (SOUTHSIDE FLATS → South Side Flats). The welcome card lists the 59
  neighborhoods with swept blocks, framed by those blocks.

Result: 3,758 blocks, 6,822 sides, 6,910 rules, 1.1 MB.

## Gaps

1. **Hours** are not in the data: 8 AM to 2:30 PM is the City's general statement, not the sign text.
2. **`3SW1-3MW`** (35 + 53 sides on Fifth Ave, Forbes Ave, Bigelow Blvd and nearby Oakland streets): read as two days a
   month per side. To confirm.
3. **The Oakland check** finds 37 side days where a third party list has the other side, and 28 with another day.
4. **No citations** with time and place are published, so no check of the hours or the sides from tickets.
5. **2027 holidays** are derived from the 2026 calendar's rule.
6. Mid month season edges are not an issue here (April 1 to November 30 are whole months).

## Questions for the City

Via [311](https://www.pittsburghpa.gov/Resident-Services/311) (Public Works and DOMI GIS):

1. What hours do the street cleaning signs post: 8 AM to 2:30 PM, 8:30 AM to 2 PM, or does it vary by route?
2. What does `3SW1-3MW` mean: the 3rd Monday and the 3rd Wednesday on each side, or Monday on one side and Wednesday on
   the other?
3. On Oakland Ave, S Bouquet St, Parkview Ave (South Oakland), Lawn St, Bates St (3400 block) and N Bellefield Ave, which
   side is swept on which day? (A neighborhood list and the codes disagree.)
4. Could the ArcGIS layer carry the WPRDC data dictionary's field descriptions, and an hours field?
5. Street cleaning citations (date, time, location) from the camera program, to check the posted windows.
6. The 2027 holiday calendar.

## What the page needs that the format does not cover

- Nothing essential. The page could say in the sheet that hours are the City's general window, since no sign text is
  published.
