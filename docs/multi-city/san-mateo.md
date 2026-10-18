# San Mateo

Checked 2026-10-18 (`scripts/cities/san-mateo.mjs` → `data/san-mateo/report.json`), following
[city-build.md](city-build.md). **Not built:** there is no `segments.json` and no `city.json`. The City's data cannot tell
which streets get tickets today, or on which days and hours. Every number below is in the report.

## How the rule works

From the City's [Residential Street Cleaning](https://www.cityofsanmateo.org/2148/Residential-Street-Cleaning) page:

- **Most streets are not posted.** "Most neighborhood routes do not have signage restricting parking during street
  cleaning ... We ask residents to voluntarily move their cars." Residential roads are swept about twice a month, most
  routes early in the morning.
- **Some streets are posted and ticketed.** "Some high traffic streets are posted with a 'No Parking' sign that states
  the time and day of the week the street vacuum comes through. The Police Department will issue citations for
  violations of the posted restrictions." **$41**. No tow is mentioned.
- **Holidays:** "We street clean every day of the year except for City Holidays." The City's Holiday Closures calendar
  lists only the next few (Veterans Day, Thanksgiving and the day after, Christmas 2026, New Year's Day 2027); no 2026 or
  2027 list was found.
- **2018 changes** ([Street Sweeping Program Improvements](https://www.cityofsanmateo.org/3688/Street-Sweeping-Program-Improvements)):
  routes were reset by how much trash each street collects (low, moderate, high), and "parking restriction signs are
  expanded in red/high generation areas". The page shows only the trash map; the new signage map it mentions is not on it.
- Downtown is swept three times a week, daily from November to January
  ([Business Area Street Cleaning](https://www.cityofsanmateo.org/2147/Business-Area-Street-Cleaning)); El Camino Real
  "16 times between March and September and 10 times between October and February".
- The City's "What is my sweeping day?" link goes to a private site (Xtreet); its own MyStreet tool link returns 404.

## The data

All in the City of San Mateo's ArcGIS organization, public, no license stated:

| Layer | What it is | Edited |
|---|---|---|
| [StreeSweep_Times](https://services2.arcgis.com/g26Y0m7OCdjU0ObA/arcgis/rest/services/StreeSweep_Times/FeatureServer/2) | Today's schedule: 25,700 parcels, each with its route ("10a", "10b": on most blocks the two sides have different routes, on different days), day, weeks and sweep time. **No field says posted or not.** Only street, route and schedule are read, with the parcel's centroid | 2026-09-23 |
| [SignedNoParking_10_2019](https://services2.arcgis.com/g26Y0m7OCdjU0ObA/arcgis/rest/services/SignedNoParking_10_2019/FeatureServer/0) | The street sweeping "No Parking" signs: 406 line pieces on 95 streets, drawn along the curb (5 to 12 m off the centerline), with route, day, weeks and hours ("10B, THU, 2/4, 8-10 AM"; downtown "MWF, WEEKLY, 4-6 AM") | 2019-10-10 |
| [Streets_8_9_23](https://services2.arcgis.com/g26Y0m7OCdjU0ObA/arcgis/rest/services/Streets_8_9_23/FeatureServer/0) | Street centerline, 2,889 segments with address ranges and cross streets | 2023-08-09 |
| SweeperRoutes_10_10_2019 | 8,396 sweeper route lines (winter and summer schedules). Not used | October 2019 |

No San Mateo County dataset was used. The City publishes no parking citations.

## What was checked

The 2019 sign layer is the only data that says which streets are posted. Each signed piece was put on the centerline
segment and side it runs along (753 signed sides; 2 pieces on Vannessa Dr found no segment), and compared with today's
schedule for the parcels on that side (23,708 of 25,700 parcels placed on a segment and side):

| Signed sides | Count |
|---|---|
| Same days, weeks and hours as today's schedule | **50** |
| Same days and weeks, other hours | 268 |
| Other days or weeks | 205 |
| No parcel on that side to compare (commercial frontage, downtown) | 228 |
| Two signs that disagree on one side | 2 |

Where the two can be compared, they disagree on 90% of the signed sides. Examples: Woodside Wy, signed Tuesday 1st and
3rd 8-10 AM, today 9-11 AM; N Kingston St, signed 7-9 AM, today 5-7 AM; downtown, signed 4-6 AM, today 3-5 AM; 1st Ave
between Claremont and Delaware, signed Wednesday, today Thursday. They agree on parts of S Claremont St, N Ellsworth Ave,
S Delaware St and S Eldorado St.

## Why there is no map

- A map from the 2019 signs would put a wrong day or wrong hours wherever the City has changed routes and signs since
  2019, and the comparison suggests that is most of them.
- A map from today's schedule would mark every street no parking for two hours twice a month, when the City says most
  streets are not posted and get no tickets.
- A map of only the 50 sides where both agree would leave most posted streets off, and they would look unswept.

## What to ask the City

To StreetSweeping@cityofsanmateo.org (Public Works, 650-522-7300):

1. Which streets are posted with street sweeping "No Parking" signs today? Is the SignedNoParking_10_2019 layer still
   current, or is there a newer layer or list of signed streets?
2. On posted streets, do the signs show the hours in StreeSweep_Times (SWEEP_TIME), or other hours? (Downtown signs in
   the 2019 layer say 4-6 AM; today's schedule says 3-5 AM.)
3. Did the 2018 "proposed new signage" on high trash generation streets go up, and where?
4. Which City holidays stop street sweeping and its ticketing, for 2026 and 2027?
5. Is the fine still $41, and does the City ever tow for street sweeping?
6. Could a "posted" field be added to StreeSweep_Times? With it the map can be built the way San Diego's is.

## If the City answers

With a current list of signed streets (or the 2019 layer confirmed) and the hours on the signs, the build is short: the
signed pieces already sit on centerline sides (`signSides` in the script), so each side gets its sign's rule, $41, no
tow, `holidayRule: all` with the City's holiday list.
