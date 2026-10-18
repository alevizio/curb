# San Jose

Built 2026-10-18. Data build: `scripts/cities/san-jose.mjs` → `data/san-jose/` (format in [city-build.md](city-build.md));
tests: `scripts/cities/san-jose.test.mjs`.

## How the rule works

- **Every street is swept, few are posted.** "Residential streets are swept once each month by a contractor ... on the
  same day of the month each month (e.g., first Monday, second Thursday)"; downtown, business district and arterial
  streets "two to four times per month, between the hours of 2:00 a.m. and 11:00 a.m."
  ([Street Sweeping](https://www.sanjoseca.gov/your-government/departments-offices/transportation/streets/street-sweeping)).
  "Vehicles parked in areas that have been posted for no parking during sweeping times will be issued a parking
  citation." Signs are used "on streets where sweeping efforts are greatly impacted by parked vehicles", so only the
  **Signed Route** segments get tickets.
- **Residential signed routes**: the nth weekday of the month, both sides the same day, hours in two windows around a
  lunch break ("7AM to NOON, then 12:30PM to 5PM"). CURB writes them as two rules on the same day.
- **Major roads (signed)**: each side's own sign, often a different night per side ("West Side: No Parking Tuesday
  1am-6am, East Side: No Parking Wednesday 1am-6am"), weekly or 1st and 3rd / 2nd and 4th weekdays; downtown some curbs
  say "No Parking 3am-6am Any Day".
- **Holidays**: the City's own lookup tool ([Utility Services Lookup](https://www.sanjoseca.gov/your-government/departments-offices/environmental-services/recycling-garbage/residents/utility-services-lookup),
  whose calendar comes from an API behind it) shows "Residential Street Sweep (Moved for Holiday)" on Saturday
  2026-11-28, Saturday 2026-12-26 and Saturday 2027-01-02: in the weeks of New Year's Day, Thanksgiving and Christmas a
  residential sweep on or after the holiday moves one day later, like garbage collection, and the signs name no such
  day. Residential sweeps on other City holidays (Indigenous Peoples Day, Veterans Day, MLK Day, Presidents' Day) stay.
  The same calendar cancels major road sweeps on City holidays (2026-10-12, 11-11, 11-26, 12-24; 2027-01-18, 02-15,
  03-31, 05-31, 07-05, 09-06).
- **Fine $65, no tow**: SJMC 11.36.190, $52.50 base plus $12.50 State surcharges, Resolution RES2025-272 (2025-08-12)
  in the City Clerk's [GILES](https://sanjoseca.govnita.com/workspaces/Resolutions?query=RES2025-272). The
  [Parking Regulations](https://www.sanjoseca.gov/your-government/departments-offices/transportation/parking/parking-compliance/parking-regulations)
  page still links the repealed RES2024-264 on a records site that no longer exists. In May and June 2026 two
  neighborhoods (Council Districts 7 and 10) had four sweeps enforced by towing as a test
  ([City news, 2026-04-07](https://www.sanjoseca.gov/Home/Components/News/News/7243)); over, so no tow flag.
- Contact: StreetSweeping@sanjoseca.gov (Department of Transportation).

## The data

| Source | What it gives | Notes |
|---|---|---|
| [Residential Street Sweeping Routes](https://data.sanjoseca.gov/dataset/residential-street-sweeping-routes) (MapServer/515) | 18,810 centerline rows: `ROUTETYPE`, `APPWEEKDAY` ("1st Monday of the Month"), `POSTEDTIME`, `SIDEOFROAD`, `ROADNAME/FROM/TO`, `CENTERLINEID`, `NEIGHBORHOODNAME` | CC BY. 2,252 Signed Route, 16,432 Non-Signed, 126 Median Island. Every row's `LASTUPDATE` is 2023-12-14 |
| [Major Road Street Sweeping Routes](https://data.sanjoseca.gov/dataset/major-road-street-sweeping-routes) (MapServer/516) | 1,638 rows, stacked per side, with `APPPUBLICPOSTEDTIMES` per side | CC BY. 526 Signed Route. Updated 2026-08-24 |
| [Streets](https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/60) | The City's centerlines: `INTID` = `CENTERLINEID`, house numbers per side | One block line and direction for both layers; 58 swept ids are not in it (the sweeping line is used) |
| [Neighborhoods](https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/549) | The 297 neighborhoods drawn with Council offices in 2020 | `h`, and the welcome card (30 with at least 30 signed blocks) |

San Jose publishes citations only as a dashboard, not as data, so there is no ticket cross-check.

## How it was built

- **Residential**: every Signed Route row → its `CENTERLINEID` block, both sides, the posted weekday and week, one rule
  per window. A row listing two signs' hours ("8AM to NOON 1PM to 5PM 9AM to NOON 1PM to 4PM", 167 rows) gets the hours
  merged, so every hour either names is covered. One row is posted on its West side only (San Tomas Aquino Pkwy, "One
  side"), and one signed row has no hours (Linkhorne Ct): left out.
- **Major roads**: each signed row's public text is split by side; "No Parking <days> <hours>" becomes rules on that
  side, placed by compass on the block line. Signs that are not a sweeping window are left out (counted per row): no stopping (157), time
  limits (60), loading (16), permit only, no parking anytime, trolley only. 122 signed rows have nothing else. One curb
  pair (Charles St) is posted 6 PM to 8 AM on the 2nd and 4th Monday: written as a window past midnight.
- Cross streets are the row's `ROADFROM - ROADTO`, title cased ("EOS", end of street, becomes "End").

Result (`data/san-jose/report.json`): **2,424 blocks (2,246 residential, 178 major road), 4,810 sides, 9,442 rules**.
`segments.json` is 1.1 MB.

## Unverified

1. The residential routes were last updated 2023-12-14: whether the signs still match is unknown (the major road layer
   is current).
2. The holiday rule is read from the lookup calendar's twelve months; 2026-01-01/02 and 2027-11-25/26 are derived, and a
   Saturday holiday (Christmas 2027, New Year's Day 2028) is assumed to move nothing.
3. Whether parking is enforced on the posted day of a moved sweep (the holiday itself): the build treats it as off.
4. "No Parking 3am-6am Any Day" (downtown, 22 sides) is a posted nightly ban on a sweeping route; it is shown as seven
   nightly rules.

## Questions for the City

1. Is the residential layer (2023-12-14) still what the signs say? Will signed routes be added?
2. On a holiday week, is the posted day enforced, the moved day, or neither? A holiday table for apps would help.
3. Which City holidays cancel major road sweeps, for 2027 and after?
4. Would DOT publish parking citations (date, time, location, violation) as data?
5. The Parking Regulations page links a penalty schedule (RES2024-264) on the retired records site.

## What the page needs

- **Two windows on one day.** A residential side has two rules on its day (7 AM to noon, 12:30 to 5 PM): the sheet will
  list both and the next sweep is the first one; the lunch break shows as a short gap.
- **Holidays that differ by program.** `holidays` holds only the dates that stop residential sweeps (the moved
  weeks), so on the other City holidays the map shows major road sweeps the City cancels (safe: it tells people to move).
  A per-rule holiday list, or a flag for "City holidays too", would let the major roads skip them.
- **"Moved one day later"** cannot be said in the format; `words.afterpass` says it.
