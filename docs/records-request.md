# Public-records requests — sweeper routes/AVL & full color-curb data

Two ready-to-send requests. SF responses are due within **10 days** (CA Public Records
Act / SF Sunshine Ordinance, S.F. Admin. Code Ch. 67). File via the city portal at
**https://sanfrancisco.nextrequest.com** (routes to the correct department), or email the
addresses below. Keep them narrow and cite the public precedents — that gets data, not a
deflection.

---

## Request 1 — SF Public Works: sweeper routes + AVL

**To:** San Francisco Public Works — Bureau of Street Environmental Services
(Operations Yard, 2323 Cesar Chavez St). Records contact via NextRequest.

**Subject:** Public Records Act request — mechanical street-sweeping route data & sweeper GPS/AVL

Under the California Public Records Act (Gov. Code § 7920 et seq.) and the San Francisco
Sunshine Ordinance, I request copies of the following records in electronic, machine-
readable form (CSV, GeoJSON, shapefile, or database export preferred):

1. **Sweeper route definitions** — the route/segment data maintained in the Public Works
   "FleetRoute" system (referenced as inventory item **DPW-0039-S**, "High density routing
   for street sweepers; master data for sweeper routes; GIS-based"), including for each
   mechanical street-sweeping route: the ordered list of street segments / CNNs, the route
   identifier, assigned yard, scheduled service day(s), and shift/start time.
2. **Route start points and sequence** — any document or export showing where each route
   begins and the order in which blocks are serviced.
3. **Sweeper vehicle location history (AVL/GPS)** — telematics location logs for mechanical
   street-sweeping vehicles for the most recent **90 days** available, as produced by the
   City's fleet telematics system (Geotab; City contract for "Telemetry and GPS System,"
   City Administrator / Central Shops). Timestamp, latitude/longitude, and vehicle/route ID
   per ping are sufficient; I do not seek driver names or personnel records.

If any portion is exempt, please release the non-exempt remainder and cite the specific
exemption for any withholding (Gov. Code § 7922.000). I note that other major cities
publish equivalent data — **Chicago's live Sweeper Tracker** and **New York City**, where
**Local Law 9 of 2023** mandates GPS on mechanical brooms and a public tracking page — so a
categorical officer-safety or security objection is not well-founded for route and
historical (non-live) location data.

Please provide records electronically at no charge where possible; if fees will exceed $25,
contact me first with an estimate.

---

## Request 2 — SFMTA: full color-curb inventory + geocoded street-cleaning citations

**To:** SFMTA (San Francisco Municipal Transportation Agency), Public Records.

**Subject:** Public Records Act request — color-curb (loading zone) inventory & geocoded citation data

Under the CPRA and SF Sunshine Ordinance, I request, in machine-readable electronic form:

1. **Complete color-curb inventory**, including **non-metered / paint-only** zones not
   present in the published "Meter Operating Schedules" (`6cqg-dxku`) or "Parking
   regulations (except non-metered color curb)" (`hi6h-neyh`) datasets: for each white,
   yellow, red, green, and blue curb zone — location (lat/long or street + block + side),
   color/type, days, hours, and time limit.
2. **Geocoded street-cleaning citations** — for violation codes **TRC7.2.22 ("STR CLEAN")**
   and **T37C ("ST CLEANIN")**, the latitude/longitude (or CNN/segment id) for citations
   issued since **2024-01-01**. The public dataset (`ab4h-6ztd`) has not been geocoded since
   ~2021; I request the geocode that SFMTA holds internally, so citations can be matched to
   the correct block without re-geocoding address strings.

I do not seek license-plate numbers, registered-owner information, or any personal data —
aggregate location/time fields are sufficient and avoid CVC § 1808.21 / privacy concerns.

If fees will exceed $25, please contact me with an estimate before proceeding.

---

### Notes for whoever sends these
- Replace the signature/contact block and confirm the current NextRequest routing.
- Requests 1.3 and 2.2 are the most likely to be partially withheld — keeping them
  **historical** (not live) and **de-identified** (no plates/personnel) is what makes them
  releasable. Don't ask for real-time or officer-identifying data; that invites a denial.
- If FleetRoute (DPW-0039-S) comes back as GIS files, it can feed CURB's route-animation
  feature directly. If the AVL log comes back, it ground-truths the citation-inferred times.
