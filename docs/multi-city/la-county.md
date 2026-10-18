# Unincorporated Los Angeles County

Built 2026-10-18 by `scripts/cities/la-county.mjs` (format: [city-build.md](city-build.md)). Data in `data/la-county/`;
numbers from `report.json` of that run. The 88 cities inside the County (Los Angeles, Long Beach, Pasadena...) sweep their
own streets and are not part of this; the City of Los Angeles is [los-angeles.md](los-angeles.md).

## Short version

- Public Works publishes its sweeping map as lines drawn along each curb (a block face, rounded at the corners), with the
  day, hours, frequency and whether the street is posted. The side of the street is in the drawing, so nothing has to be
  inferred: each curb is laid on the County's street centerline (CAMS), on the side it runs along.
- 11,164 of 27,849 lines are marked posted (signs with no parking hours); only those are kept. The County warns that the
  posted field is incomplete: 7,234 lines with no posting status have a full weekly schedule, including every line in
  maintenance district 3 (View Park/Windsor Hills, Athens-Westmont, West Carson, Ladera Heights, Lennox). See Gaps.
- Result: 8,439 blocks, 15,027 block sides, 1,105 curb miles. 6,588 blocks are posted on both sides (5,802 with different
  days), 1,851 on one side.
- No ticket data is published (the Sheriff writes over 24,000 parking tickets a month, street sweeping first on its list of
  citations to be aware of),
  so there is no cross-check against tickets.

## How sweeping works there

- **Posted streets, once a week.** "Some streets have posted signs which designate the hours between which there is no
  parking allowed ... Other streets are not posted with designated times, yet still have a designated sweeping day"
  (Public Works FAQ). Posted lines are weekly (10,931) or twice weekly, Monday and Friday (206). Windows are mostly 4
  hours (8 to 12, 11 to 3, 7 to 11, 9 to 1, 12 to 4), some 2 or 3 hours early in the morning (5 to 7, 5 to 8, 4 to 7).
- **Each curb has its own day.** The curb lines show it, and Board traffic orders read the same way ("prohibiting parking
  for street sweeping purposes from 7 a.m. to 11 a.m., Thursdays only, on the east side of Casitas Avenue").
- **Tickets.** The Sheriff's Parking Enforcement Detail, under County Code 15.20.070(2) ("All streets with posted signs for
  street sweeping will be enforced"), at any time in the posted hours: it does not follow the sweeper.
- **Holidays.** "Street Sweeping is not performed on County Holidays ... Although sweeping is not performed the Sheriff
  Parking Enforcement provides enforcement of parking regulations" (Public Works FAQ). So every rule carries flag 1 (not
  suspended on holidays): a parked car can still be ticketed on a holiday. The holiday list in `city.json` is for showing
  only.
- **Fine.** $50 for failure to obey signs (County Code 15.200.010, amended 2025) plus $5 and $5 of court assessments
  (15.200.020): about $60. No tow.
- No season.

## Data

| Need | Source | Notes |
|---|---|---|
| Schedule and sides | [Street Sweeping Routes](https://data.lacounty.gov/datasets/los-angeles-county-public-works-road-maintenance-division-street-sweeping-routes) (Public Works, ArcGIS) | 27,849 lines, edited 2026-10-14. Fields read: `SCHEDULE`, `TIME` ("time route is typically swept", taken as the posted hours), `POSTED` ("incomplete. All posted street regulations apply regardless of contents shown in this layer"), `FREQUENCY`, `STREET_TYPE`, `MD`. The layer also holds editors' user names and route labels that are first names: never read or kept |
| Street lines | [CAMS Address Lines](https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/eGIS_Addressing_ROAD_LINES/FeatureServer/0) (County eGIS) | 70,475 centerlines with an unincorporated side, names and address ranges; `SourceID` is the block id (`c`) |
| Communities | [Unincorporated LA County](https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Unincorporated_LA_County/FeatureServer/0) (Board boundaries) | 121 communities, the block's `h` and the welcome card list |

All three are under the [County eGIS terms of use](https://egis-lacounty.hub.arcgis.com/pages/terms-of-use) (informational
data, access may change).

## How the build places it

1. Posted lines with a weekday, hours and a frequency: 11,109 (left out: 20 "All Day", 15 blank hours, 14 hand sweeping
   or "As Needed", 6 median curbs, 2 without a frequency).
2. Each curb line is sampled every 5 m, 8 m left out at each end (the rounded corners); each sample goes to the nearest
   centerline within 22 m that runs within about 30 degrees of it, on the side it lies on. A curb counts on a block side
   when it covers 35% of the block or 60 m, with 20 m at least. A curb that turns the corner counts on both streets.
   11,017 curb lines placed (98.5% of sample points); 92 were not (no unincorporated County centerline within 22 m;
   listed in `report.json`, not examined one by one). Posted lines sit 4 to 12 m from the centerline for 78% of their
   points: they are drawn at the curb.
3. Rules: each weekday of the line, its hours, every week (31), all year, flag 1.
4. 17 block sides have two windows on one weekday (two posted stretches on one block, East 6th St: 5 to 7 AM and 8 to 12):
   both are kept.

## Gaps and assumptions

1. **The posted field is incomplete** (the layer says so). Kept: lines marked posted, as asked. Left out: 7,234 lines with
   no posting status but a weekday, hours and a weekly frequency (5,358 in district 3, 1,870 in district 1). Laid the
   same way they would add about 4,600 blocks and 660 curb miles, but 37% of district 3's points find no County centerline
   within 22 m, so they need a look first. This is the largest gap: a decision for the project owner.
2. Holiday enforcement is from one Public Works FAQ answer; the Sheriff's own rule was not found in writing.
3. The holiday dates follow the FAQ's list (written for 2023) plus Juneteenth, with César Chávez Day on March 31 and weekend
   holidays moved to the Friday before or the Monday after. Not checked against a County calendar.
4. The $60 total assumes street sweeping tickets are the $50 "failure to obey signs" penalty, as the Sheriff's notices cite.
5. The layer calls its hours the "time route is typically swept"; they are used as the posted hours.
6. No ticket data, so no check of which blocks are really enforced.

## Questions for the County

1. Does the Sheriff enforce posted street sweeping hours on County holidays, when the sweeper doesn't come?
2. The fine for a street sweeping ticket (penalty and fees), and the code section it is written under.
3. Could the Sheriff's parking citations (date, time, location, violation; no plates) be published, as LADOT does?
4. Which of the 7,234 lines with no posting status are posted (all of district 3)? Is `TIME` the posted hours?
5. 92 posted curb lines have no County centerline next to them: are they County streets?

Contacts: Public Works Road Maintenance (the layer's description names a contact; "The Works" app; pw.lacounty.gov);
Sheriff Parking Enforcement Detail, PEDHQ-Parking@lasd.org, (323) 526-5185.

## What the shared page needs that the format doesn't cover

- A city whose holidays stop the sweeper but not the tickets: here every rule carries flag 1, so nothing is suspended and the
  sheet should say why ("No sweeping on County holidays, but posted hours are still enforced").
- `fineNote`, `holidaysNote` and `ticketAgency` in `city.json`.
