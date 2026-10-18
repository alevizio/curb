# Somerville, MA

Researched and built 2026-10-18 (`scripts/cities/somerville.mjs`, spec in [city-build.md](city-build.md)). Built:
`data/somerville/segments.json` has 1,827 blocks, 3,592 block sides and 4,086 rules (455 KB).

## Short version

- The odd side of a street is swept on the 1st and 3rd of its weekday each month, the even side on the 2nd and 4th
  (sometimes another weekday), 8 AM to noon, April 1 to December 31. Main streets are also swept one night a week per
  side, squares six nights a week. $50 ticket, and "vehicles that do not move may be ticketed and towed". No
  sweeping on City holidays, and no make-up day.
- There is no dataset. The schedule is 1,042 City web pages, one per street side or stretch. Their old index is gone,
  so the build reads them by their page ids, once each, one request every 1.2 seconds.
- The pages are placed on MassGIS street centerlines; MassGIS address points decide which side of each block is odd.
- Checked against the City's December 2025 street sweeping contract (the day routes: 367 of the 368 streets in both
  agree on both sides) and against the City's reminder tool at 13 addresses (all 13 agree after three fixes it showed).
- Somerville publishes no parking tickets, so there is no ticket cross check.

## How the rule works

- The City's sweeping page (`somervillema.gov/departments/sweeping`): "A recurring pattern was chosen in order to allow
  residents to plan ahead (example: 1st and 3rd Thursday of each month)". Season April 1 to December 31. "$50 fine".
- The City's 2026 notice: "Regular street sweeping schedules resume Wednesday, April 1, and will continue through
  December 31, 2026 … Vehicles that do not move may be ticketed and towed."
- The pages: odd side "1st and 3rd <weekday>", even side "2nd and 4th <weekday>", 8 a.m. to 12 p.m. (962 pages);
  "<Weekday> Night", 12 a.m. to 6 a.m. (65) or 12 a.m. to 7:30 a.m. on Saturday (15), for main streets (one side a
  night) and squares (both sides, Monday to Saturday).
- "Monday Night 12 a.m. - 6 a.m." is Monday from midnight to 6 AM (the Sunday to Monday night): the City's reminder
  tool names the same sweeps "Odd Side Wednesday 12AM 6AM" and lists them on that weekday.
- Holidays: the reminder tool marks nine in the season (Patriots' Day, Memorial Day, Juneteenth, Independence Day,
  Labor Day, Indigenous Peoples' Day, Veterans Day, Thanksgiving, Christmas) and drops those sweeps. Thanksgiving
  Friday is a City holiday (offices closed) but not a sweeping holiday there, so it is left out of `city.json`.

## What the City publishes

| Need | Source | Notes |
|---|---|---|
| Schedule | Street sweeping section pages, `somervillema.gov/content/street-sweeping-section-…` (Drupal nodes 26349 to 27390) | 1,042 pages: street name, suffix, side (494 odd, 491 even, 57 either), day, hours, a stretch on 224 ("from Broadway to Morrison"), and an old mailing list code. Not in the sitemap or the site search |
| Their index | `somervillema.gov/sweeper` (2014) and `/street-sweeping-data` (2015) | A table of every section, in the Wayback Machine only; both 404 now. A copy of the old view's markup sits, empty, on the Parking Department page |
| Day routes | [IFB #26-30 Street Sweeping Services](https://s3.amazonaws.com/somervillema-live/s3fs-public/2025-12/IFB%2026-30%20Street%20Sweeping%20Services.pdf), Attachment A (December 2025) | Five contractor routes, each "1st & 3rd <day> odd side, 2nd & 4th <day> even side", 8 AM to noon, with their streets. Used to check the pages |
| Reminders | ReCollect (the City's vendor) via the Waste Wizard | Per address. Used for spot checks only: 17 address lookups, 13 answered |
| Street lines | Somerville's own `Streets` (data.somervillema.gov `7jtq-qmnf`, shapefile, April 2026) | Geometry and names but no address ranges, so the build uses MassGIS Roads instead |
| Street lines with ranges | [MassGIS Roads](https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/MassGIS_Roads_Hosted_Feature_Layer/FeatureServer) (the state's NG911 centerlines) | 2,704 segments in Somerville with left and right address ranges and parity |
| Address points | [MassGIS Master Address Points](https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/MassGIS_Master_Address_Points/FeatureServer) | 49,460 points in Somerville (17,913 places once units are merged) |
| Tickets | Not published | data.somervillema.gov has moving violations (Police Data: Traffic Citations), not parking tickets |

## What the build does

1. Reads every page from node 26349 to 27390 (cached in `private/cache/somerville/pages/`, never fetched twice;
   `--refresh-pages` refetches) and fails if the pages around that range are sections too (the batch grew) or if a
   page lost a field.
2. Reads each page's day: the weeks decide the side for day sweeps (1st and 3rd odd, 2nd and 4th even; one page,
   McGrath Highway node 26352, says odd for a 2nd and 4th day, and the contract lists that route as even); nights are
   every week.
3. Places each page on MassGIS Roads: the whole street, or a walk between its two cross streets, or to the street's
   end ("Beacon St. end"), or the street's block at the city line. Two halves that meet at a railroad bridge ("from
   Medford St. to R.R. bridge" and "from Summer St. to R.R. bridge", same day) become one walk. A stretch replaces the
   whole street's rule of the same kind and side on its blocks.
4. The odd side of each block: the address points of that street within 45 m, by side (1,699 blocks, at least two
   points and three to one); else MassGIS's range parity (266); else the next block of the same street (369). The
   points and the ranges agree on 1,526 blocks and disagree on 17.
5. Squares the pages name without a stretch: MassGIS's own square streets (Union Square 12 blocks, Davis Square 15,
   Assembly Square Drive 17), or the blocks of the square's streets within 120 m of where they meet (Teele: Broadway
   and Holland St, 10; Ball: Broadway and Boston Ave, 8; Magoun: Broadway and Medford St, 8).
6. Writes the rules: day `[dow, 8, 12, 5 or 10, 4088, 2]`, night `[dow, 0, 6, 31, 4088, 2]` (Saturday to `"7:30"`,
   Broadway to 8). 2,697 day rules, 1,389 night rules.

## Checks

- **The 2025 contract** (by hand, pdfplumber): 368 streets are in both; 367 have the same odd and even days on the
  pages; Linwood St differs on one side. The contract adds new Assembly Square streets that have no page (Assembly
  Row, Foley St, Revolution Way, Artisan Way, Canal St, Grand Union Blvd): they are not on the map.
- **The reminder tool** at 13 addresses (Highland Ave 2, Broadway 2, Holland St, Medford St, Somerville Ave, College
  Ave, Central St, Walnut St, Cedar St, Bow St, Evergreen Ave): same days and sides as the pages, except three things
  the map now follows the tool on (`NIGHT_ENDS`, `PAGE_FIXES` and the either side rule in the script):
  1. Broadway's night sweeps end at 8 AM (both Broadway addresses); its pages say 6 AM.
  2. No "either side" Friday or Saturday night sweep at any of the 10 addresses on streets the pages give one. Those
     12 pages (Broadway, Highland Ave, Holland St, College Ave, Elm St, Somerville Ave, Medford St, Central St,
     Walnut St, Cedar St) are left out. Squares keep theirs (the tool has no addresses there to check).
  3. College Ave's even side: its page says "Wednesday, 12 a.m. - 6 a.m." (no weeks, no "Night"); the tool says the
     2nd and 4th Wednesday, 8 AM to noon.
- **Sides**: on seven blocks checked by hand (Evergreen Ave, Cedar St, Summer St, Pearl St, Lowell St, Morrison Ave,
  Albion St) every odd address point lies on the block's odd side and every even one on the other, and the odd side
  carries the page's 1st and 3rd day. Compass labels: all 3,592 sit on their side of the line.

## Left out (38 pages) and gaps

- 12 either side night pages (above). 6 sides where the page says parking is banned anyway (Autumn St, Smith Ave,
  Prospect St odd, Cutter Ave even). 7 whose cross street is not a street: Properzi Way "Taylor St. end" (3; the
  contract lists "Properzi Way Taylor St End" too, but there is no Taylor St on it), Packard Ave "to Tufts College",
  Rush St "to Comm School". Stretches with no extent: Highland Ave "High School Concourse" (3), Broadway "on terrace",
  McGrath Highway "under McGrath Highway bridges", Meacham Rd "to Buena Vista", Marshall St "parking lot town houses",
  Boston Ave "at Medford city line" (the street has 5 loose ends). Short Pearl St is not in MassGIS.
- Not on the pages, so not on the map: the new Assembly Square streets, Tufts streets (Professors Row, Talbot Ave),
  state roads (Mystic Ave, the Fellsway, Alewife Brook Parkway, Mystic Valley Parkway, Routes 16, 28, 38 and I-93).
- Square extents are our assumption (the pages give none).
- Night sweeps get the same April to December season as the rest (the pages don't say).
- MassGIS gives every segment wholly to one city, so a street on the Cambridge or Medford line has both sides on the
  map when only Somerville's side may be posted.
- Sections created after the site moved to Drupal 8 would have other node ids and are not read (none are known).
- 2027 holidays after New Year's Day are the 2026 set by the same rules.

## Questions for the City

1. Is there a current list of street sweeping sections (the old `/sweeper` table) or a dataset of it?
2. Broadway's night sweeps: 12 to 6 AM (the pages) or 12 to 8 AM (the reminder tool)?
3. Are the "either side" Friday and Saturday night sweeps on main streets (Broadway, Highland Ave, Holland St, Elm St,
   College Ave, Somerville Ave, and the Saturday night route on Medford, Central, Walnut and Cedar Streets) still
   posted? The reminder tool doesn't show them.
4. Which blocks do the squares' nightly sweeps cover (Union, Davis, Teele, Ball, Magoun, Assembly)? And the "High
   School Concourse" on Highland Ave?
5. College Ave's even side: night or day? Linwood St's even side: 2nd and 4th Monday (pages) or Tuesday (contract)?
6. The new Assembly Square streets: which day and side? Is "Taylor St. end" on Properzi Way Tyler St?
7. Are night sweeps April to December too, and is Thanksgiving Friday a sweeping day?
8. Could parking tickets (date, time, place) be published, as Cambridge does? They would show where the signs differ
   from the pages.

## Files

`scripts/cities/somerville.mjs` (build), `scripts/cities/somerville.test.mjs` (tests: real pages, days, stretches,
names, sides, and the written data's shape), `data/somerville/segments.json`, `city.json`, `report.json`. Downloads in
`private/cache/somerville/` (the 1,042 pages, MassGIS roads and points; the contract PDF and the spot check answers,
never used by the build).
