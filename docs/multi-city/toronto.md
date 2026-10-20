# Toronto, Ontario

Built 2026-10-20 by [city-build.md](city-build.md). Build: `node scripts/cities/toronto.mjs [--refresh]` (inputs cached in
`private/cache/toronto/`, about 1.1 GB: the by-law schedules file alone is 0.8 GB), tests: `npx vitest run
scripts/cities/toronto.test.mjs`. Output: `data/toronto/segments.json` (5.6 MB, 0.63 MB gzipped), `city.json`, `report.json`, and
`winter.json` (the snow route switch, written once and then only by `scripts/cities/winter.mjs`). The page is curb.guide/toronto
(unlisted, noindex). Every number below is in `report.json`.

## Short version

- Two winter rules, both from Municipal Code Chapter 950 (Traffic and Parking):
  - **Snow routes** (§ 950-406, Schedule XVII-A): no parking or standing on a snow route while the City declares a Major Snow
    Storm Condition, both sides, all hours. Signed. Mostly downtown, every streetcar street among them. The City's January 2026
    release: "Vehicles parked on snow routes will be towed at the owner's expense during a declared event", "subject to fines up
    to $500". **147 entries in force, all placed: 3,792 blocks, 7,584 block sides.**
  - **The former North York's winter maintenance ban** (§ 950-400D(9), Schedule IV): no parking 2:00 to 6:00 AM, December 1 to
    March 31. Not signed. **8,919 blocks, 17,803 block sides**, every night of the season, holidays too.
- The snow route rule follows the City's declarations, which no feed carries (Toronto Open Data and Winter Operations both said
  so). CURB's switch (`data/toronto/winter.json`) is flipped by hand; `.github/workflows/winter-watch.yml` reads toronto.ca/news
  every 30 minutes from November to April and emails the owner when a release declares or ends a Major Snowstorm Condition. It
  never flips the switch.
- Last winter's tickets agree: 93.4% of the 2025 snow route tickets placed by address land on a mapped snow route (Feb 13 to 27,
  2025, the one declaration that year), and 98.0% of the North York ban tickets land on a block side with the ban.

## How the rules work

**Snow routes** (Chapter 950, https://www.toronto.ca/legdocs/municode/1184_950.pdf)

- § 950-406A: "Despite any by-law of the City, no person shall park or stand a vehicle on any highway set out in Column 1 of
  Schedule XVII, Subsection A in § 950-1316A between the limits set out in Column 2 of said Schedule during the period of a major
  snow storm condition hereinafter referred to, where signs have been erected thereon."
- § 950-406C to E: the Mayor or the General Manager declares it "on a specified date and time"; it lasts "until it has been
  terminated", once "the General Manager has informed the public that the major snow storm condition ... no longer exists".
- Schedule XVII-B (§ 950-406B) bans parking on or blocking streetcar tracks in the same condition, on 29 streetcar streets. All of
  them are inside the XVII-A routes, so it is not drawn separately.
- The City's page (https://www.toronto.ca/services-payments/streets-parking-transportation/road-maintenance/winter-maintenance/major-snow-event/):
  "Designated snow routes are primarily located in the downtown core and include all streetcar routes. They are all clearly
  signed. Parking on a designated snow route during a major snow event is subject to a fine of up to $500."
- Fines: the 2025 tickets show $100 for "PARK VEHICLE - SNOW ROUTE" (code 94) and $200 for parking on or blocking streetcar
  tracks (codes 220, 222); the City says up to $500. Towing at the owner's expense.
- Declarations in the City's news, 2022 to 2026: January 17, 2022; March 4, 2023; February 12 to March 5, 2025; January 15 to 19,
  2026; January 25 to February 10, 2026. None in 2024. Each one starts and ends with a news release.

**The former North York's winter ban** (§ 950-400D(9))

- "No person shall park a vehicle on any highway at any time ... (9) In the former City of North York, from 2:00 a.m. to 6:00
  a.m., from December 1 of one year to March 31 of the next following year on the highways set out in Schedule IV in § 950-1303."
- Not signed. The City describes it as applying "on all streets (unsigned) in the former city of North York" (a 2026 ward letter)
  and "on roadways in the former City of North York" (a 2018 staff memo).
- Council takes a street off it one by one, on residents' request: the Schedule IV entry is repealed, often with new entries for
  the parts or sides that keep the ban (St. Dennis Drive, by-law 114-2018; Maxwell Street, 425-2020, its west side south of
  Cocksfield Avenue; Betty Nagle Street, 4-2020).
- Fine: $50 ("PARK-N.YORK 2AM-6AM DEC1-MAR31", code 28, every 2025 ticket). Towing: § 950-1200C lets an officer move and store
  any vehicle parked against the chapter.
- No holiday exception: the ban runs every night of the season.

**Time**: Eastern, with daylight saving (the ban's season has the March change: the window is wall clock 2 to 6 AM).

## The data

| Need | Dataset | Notes |
|---|---|---|
| Snow routes and the North York ban | **Traffic and Parking By-Law Schedules** (Toronto Open Data, Transportation Services; one 0.8 GB JSON, refreshed with each by-law) | 77,992 records of Chapter 950's 44 schedules. Schedule XVII-A (template 950-17A): 160 entries, 147 in force. Schedule IV (950-04): 2,681 entries, 2,632 in force, 49 repealed. Each entry: Highway, Between, the by-law actions (added or repealed, by-law number and date), and for most the coordinates of the intersections at its limits (`geoData`, the same points as the centreline's to the millimetre) |
| Street lines | **Toronto Centreline (TCL)** | 64,394 segments: CENTRELINE_ID (the block id `c`), legal and short names, class, jurisdiction, address ranges and parity per side, the intersections at each end |
| North York | **Former Municipality Boundaries** | Six polygons; a block's `h` is its former municipality ("North York", "Old Toronto", "York", "East York", "Etobicoke", "Scarborough") |
| Check | **Parking Tickets 2025** (Revenue Services) | 2,051,176 tickets with date, time, infraction and address; 27,003 North York ban tickets, 3,638 snow route tickets |
| Check | The City's snow route list (PDF, current to 2025-12-31) | The XVII-A extract linked from the City's snow event page |

License: all four datasets are under the Open Government Licence – Toronto (https://open.toronto.ca/open-data-licence/). The page
carries the credit line the City asks for: "Uses City of Toronto data under the Open Government Licence – Toronto." The schedules
file has the City's staff user names in owner fields: the build never reads them, and nothing it writes has any.

### How it was placed

- **Each schedule entry on the centreline**: the street is the centreline segments of that legal name (a typo within two letters,
  a missing space, or the City's other spelling of it, are matched and noted). Its limits are nodes: the schedule's intersection
  points where it gives them; else the nodes where a segment of the cross street's name meets the street (an exact name, the name
  without its direction, a renamed street, a ramp to it, or, for a cross street that stops short, the street's nearest node: 61 m
  for Vaughan Road at Eglinton Avenue West, 172 m for Bayview Avenue at Labatt Avenue). "(north intersection)" picks the
  northmost; "the north end of" picks the street's end that way, a dead end first. The entry covers the shortest route along the
  street between its limits; "a point 38.1 metres east of" moves a limit along that route (or past it); a street interrupted by a
  park is crossed with a jump of up to 500 m. A block side is covered when half of it or more is. A side named in the entry ("east
  side") is the side facing that way, by the direction of the part covered.
- **Snow routes**: every block side of an in force XVII-A entry, both sides. 147 of 147 placed. One more from the City's list:
  "Lower Coxwell Avenue, Eastern Avenue and Queen Street East", which the dataset marks repealed (by-law 1258-2024, the street
  renamed Emdaabiimok Avenue, and that new entry marked purged) while the City's list of December 31, 2025 still has it. Kept, as
  the City's page lists it.
- **The North York ban**: every City street (local, collector, minor and major arterial; City of Toronto jurisdiction) whose
  middle is in the former North York, both sides; a street on the boundary (its middle within 15 m of it) only where Schedule IV
  lists it. Less the **exemptions**: the block sides a repealed Schedule IV entry covered that no entry in force covers. Left out:
  expressways, ramps, lanes, trails, private, provincial and unbuilt ("Pending", 252 segments) roads.
- **Exemptions**: of the 49 repealed entries, 38 take block sides off the map (171 sides: St. Dennis Drive, Isaac Devins
  Boulevard, Mary Chapman Boulevard, Brookbanks Drive between Three Valleys and Underhill, Invermay Avenue, Maxwell Street's west
  side south of Cocksfield Avenue and more; each with its by-law in `report.json`); 11 take none, because the by-law kept every
  block side under other entries (moved limits, one side kept: Harlandale Avenue, Duplex Avenue, Bob Yuill Drive), or the
  street is not a City street on the map (Evelyn Wiggins Drive and Herons Hill Way are "Pending").
- **Rules**: a snow route side `[-1, 0, 24, 0, 0, 15, "snow1"|"snow2"]`, all day on the dates of the season's two lists (November 1
  to January 30, January 31 to April 30, under 96 dates each, what a saved alert keeps), flags 1 (holidays too), 2 (towable), 4
  (the switch) and 8 (both sides). A North York side has seven weekly rules, `[dow, 2, 6, 31, 2055, 35]`: every weekday, 2 to 6 AM,
  December to March (months mask 2055), flags 1, 2 and 32 (a no parking rule, not a sweep).
- **Blocks**: `c` the CENTRELINE_ID, `s` the short name ("Queen St W"), `l` the cross streets at each end (the next corner along
  the street when an end is only a driveway or a lane), `n` the house numbers, `o` the side with odd numbers (the centreline's
  parity), `h` the former municipality, `g` the line (points within 0.25 m of a straight line dropped, 6 decimals).

## Against the City's tickets (2025)

Tickets placed by house number and street on the centreline's address ranges (82.7% of North York ban tickets, 92.1% of snow
route tickets; a ticket written "OPP" goes on the other side).

- **North York ban**: of 22,321 placed, 21,883 (98.0%) land on a block side with the ban; 20,708 (92.8%) on a side Schedule IV
  lists in force; 237 on an exempted side (St. Dennis Drive 101, Whitburn Crescent 36, Forest Manor Road 29, Tippett Road 24:
  streets Council took off the schedule, still ticketed); 201 off the map's North York streets. 99.9% of the tickets are written
  2 to 5 AM, December to March.
- **Snow routes**: of 3,350 placed, 3,130 (93.4%) land on a mapped route. Most of the rest are on Yonge Street north of St. Clair
  Avenue (173), a route until by-law 1494-2025 (December 2025) moved it north of the 401.

## The page

- **The plate** under the search field (the day chips are hidden: no sweeping here): "Not declared · Snow routes · No parking on
  snow routes while Toronto declares a Major Snowstorm Condition ..." while the switch waits; dark once declared, "Major Snowstorm
  Condition · No parking on snow routes · Both sides, all day, until the City ends it · Since Tue Jan 26".
- **The map**: snow routes dashed while none is declared, red on both sides while one is (in the citywide view too); North York
  streets colored by the night ban like any rule (green, amber within 24 hours, red within 3 hours and from 2 to 6 AM).
- **The sheet**: a snow route says "Snow route · Not declared" (or "No parking" while declared) and lists both sides; a North York
  side keeps the page's own verdict ("Park until Mon night") with its schedule line "Tue 2 to 6 AM · every night, December to
  March", and "No parking · Until 6 AM" during the window. No calendar for a snow route (it has no time).
- **Alerts**: a snow route watch gets one push when the switch turns on ("Move your car off Queen St W" / "Toronto declared a Major
  Snowstorm Condition. Queen St W is a snow route: no parking until the City ends it. Parked cars get towed."), sent from the
  switch for a day, never again for that declaration, nothing while none is declared. A North York watch gets the one 9 PM push
  of a 2 AM rule each night of the season, in its own words ("Move your car tonight" / "Kenneth Ave (West): no parking 2 to 6 AM.").
- **How**: city.json `winter: { from, to, start: 0, end: 24, declared: true }` (lib/winter-ui.js, the declared branch of
  lib/notify-core.js `winterPlan`), flag 32 on the ban's rules (lib/notify-core.js night copy, api/_spot.js keeps it), and
  `words.what`, `words.tagline`, `words.alerts` and `credit` for the page's words (scripts/cities/city-page.mjs).

## The switch and the watch

- On: `node scripts/cities/winter.mjs toronto on --reason "Toronto declared a Major Snowstorm Condition."` (from today; `--from
  YYYY-MM-DD` when the declaration starts on a later day), then commit and push `data/toronto/winter.json`. Off, when the City says
  it ends: `node scripts/cities/winter.mjs toronto waiting`, commit, push.
- The watch: `node scripts/cities/winter-watch.mjs toronto --seen .winter-watch/seen-toronto.json` reads the toronto.ca/news table,
  picks releases about snowstorms or snow routes from the last three days, reads each one's lead (its page's description) and says
  whether it declares a Major Snowstorm Condition, ends one, or only mentions snow routes. Test it with no email and no memory
  written, on a saved listing: `node scripts/cities/winter-watch.mjs toronto --seen /tmp/seen.json --dry-run --listing <a saved
  toronto.ca/news page> --today 2026-01-25` (it still reads each release's lead from toronto.ca; the saved page of the week of
  January 25, 2026 gives "Toronto declared a Major Snowstorm Condition: City of Toronto activates second Major Snow Event Response
  Plan ..."). `scripts/cities/winter-watch.test.mjs` holds every snow release from 2022 to 2026, with no network.
- The workflow runs every 30 minutes from November to April; a manual run picks the city, and can send a test email or dry run.

## Rebuild

Before November each year: the snow route dates are listed for one season (city.json `winter.from` to `winter.to`;
scripts/cities/winter.test.mjs fails in time). Run the build, then configs.mjs, basemap-city.mjs toronto, city-page.mjs toronto,
og-city.mjs toronto and check-city.mjs toronto. The North York ban's weekly rules need no rebuild.

## Gaps

1. The North York ban's streets: § 950-400D(9) applies it to the highways in Schedule IV, which lists 82.9% of the former North
   York's City street block sides (14,895 of 17,974). Most of the rest are major arterials (Bathurst Street, Bayview Avenue, Finch
   Avenue, Leslie Street, Sheppard Avenue, Don Mills Road, Keele Street, Yonge Street and more: 1,820 sides), minor arterials
   (432), and local streets and collectors (656) that Schedule IV doesn't list or the build couldn't place; 171 are the
   exemptions. The map shows the ban on all but the exemptions, as the City describes it ("all streets"); 5.3% of last winter's
   ban tickets were on sides Schedule IV doesn't list.
2. 84 Schedule IV entries in force are not placed (legs of streets, names the centreline spells differently, streets outside North
   York, listed in `report.json` with the reason). They don't change the map (every North York street is on it); they could hide
   an exemption only if an entry for the part kept is one of them.
3. Tickets on exempted streets (237 in 2025, 101 on St. Dennis Drive alone): the City may still enforce there.
4. The switch is by date: a declaration from 5 PM shows as all day. The watch and the owner's flip take minutes to hours.
5. Snow route signs come first: an entry's limits are placed by the centreline, not by the signs.
6. Lower Coxwell Avenue (Emdaabiimok Avenue): on the City's list, repealed in the dataset.
7. Streets with "Pending" class (252 in North York): new, unbuilt or not yet assumed; left out of the ban.

## Questions for the City (Transportation Services; Toronto Open Data: opendata@toronto.ca)

1. Is the 2 to 6 AM ban enforced on North York streets not in Schedule IV, the major arterials among them?
2. Should St. Dennis Drive (by-law 114-2018), Whitburn Crescent (316-2016 and 1710-2019), Forest Manor Road (323-2016) and
   Tippett Road (1003-2019) still get ban tickets (101, 36, 29 and 24 in 2025), now that Council took them off Schedule IV?
3. Is Lower Coxwell Avenue (Emdaabiimok Avenue, Eastern Avenue to Queen Street East) a snow route? The City's list says yes, the
   by-law dataset says repealed.
4. Could a Major Snow Storm Condition be published as data (a feed or an open dataset entry with its start and end), so alerts
   can follow it without a person?
5. Could the by-law schedules carry the centreline ids of each entry (the dataset has a `linearId` field, filled for 28 of 160
   snow route entries)?
6. Could the schedules file drop the owner fields, which name City staff?
