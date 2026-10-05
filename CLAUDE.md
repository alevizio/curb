# CURB — SF street parking, block by block

Context for Claude Code. Read this before editing.

## What it is
A mobile-first web app that shows San Francisco street-parking rules on an
interactive map: where you can park, until when it's swept, whether it's
metered, and whether it's a residential permit (RPP) zone. Lets the user set a
calendar reminder before the next sweep.

## Stack (intentionally minimal)
- Single static file: `index.html`. No build step, no framework, no bundler.
- Vanilla JS + Leaflet 1.9.4 (from cdnjs) for the map.
- Basemap: self-hosted parchment raster tiles (`basemap/parchment/`, `SELF_BASEMAP` in index.html),
  baked from MAP_STYLE by `scripts/build-basemap.sh` and served by Vercel from this repo ($0). See
  `docs/self-host-basemap-plan.md`. Google (forced off 2026-06-29, billing) and CARTO (keyless tiles
  now watermarked "API KEY REQUIRED") are unreachable while SELF_BASEMAP is set. Legacy path:
  official Google Map Tiles API when `GMAPS_KEY` (or `window.GMAPS_KEY`) is set —
  session-token flow in `initBasemap()`, viewport attribution refreshed on moveend. Falls
  back to keyless CARTO Voyager raster tiles when no key / on any failure. Leaflet stays the
  map engine either way. The Google key is a client key (referrer-restrict it) kept OUT of the
  public repo: local dev reads a gitignored `config.js` (from `config.example.js`); on Vercel,
  `api/config.js` emits `window.GMAPS_KEY` from the `GMAPS_KEY` env var and `vercel.json`
  rewrites `/config.js` → `/api/config`.
- Everything is client-side. Data is fetched live from DataSF (Socrata) at runtime.
- Design system: fonts Anton (display) + Hanken Grotesk (body); "transit signage"
  aesthetic; color tokens in :root (--green clear / --amber soon / --red now /
  --meter permit-blue / paper+ink). Keep this language if extending the UI.

## Data sources (all DataSF Socrata, CORS-open: `access-control-allow-origin: *`)
DataSF moved hosts: `data.sfgov.org` now 301s to `data.sf.gov` with no CORS header (and 403s any
query using `$select`), which silently broke every browser fetch. Always use `https://data.sf.gov` (2026-09-27).
1. Street sweeping — `yhqp-riqs`
   https://data.sf.gov/resource/yhqp-riqs.json
   Fields: cnn (segment id), corridor, limits (cross streets), blockside,
   cnnrightleft (L/R vs digitized direction), weekday, fromhour, tohour,
   week1..week5 ("1"/"0" = Nth occurrence of that weekday in the month),
   line (GeoJSON LineString). CURRENT data. weekday can also be 'Holiday' (824 rows, one per curb side on
   ~590 blocks): the side's posted holiday schedule, see the holiday model below.
2. Parking meters — `8vzz-qzz9`
   https://data.sf.gov/resource/8vzz-qzz9.json
   Fields: street_name (UPPERCASE), cap_color, on_offstreet_type, lat/long, etc.
   CURRENT data. Used only for a street-level count (no spatial join — see limits).
3. Parking regulations / RPP — `hi6h-neyh`
   https://data.sf.gov/resource/hi6h-neyh.json
   Fields: regulation, rpparea1 (permit-area letter), hrlimit, days, from_time,
   to_time, exceptions, shape (GeoJSON MultiLineString). STALE: this is SFMTA's
   2017 set, flagged by the city as not comprehensively updated. Treat as a hint.
   NOTE: RPP covers BOTH curbs — rendered as ONE street-wide centerline ribbon UNDER the
   curb lines, with zoom-scaled weight (rppWeight(): 4px@z15 → 26px@z18 ≈ curb-to-curb).
   Do NOT draw offset bands per side: they stack into a blue blanket at low zoom and
   collide with the ±5m curb lines at high zoom (tried 2026-06-09, looked broken).
4. Loading / color-curb zones — `6cqg-dxku` (Meter Operating Schedules)
   Field `applied_color_rule` carries the regulation + days_applied/from_time/to_time/
   time_limit (White=passenger, Yellow=commercial, Red=truck, Green=short-term, Orange=bus).
   `cap_color` is UNRELIABLE (white zones show Grey caps) — match on applied_color_rule.
   No geometry → join to meter coords by `post_id` (8vzz-qzz9 lat/long). Metered zones
   only; paint-only curbs aren't published. Loaded once on toggle, rendered per-viewport.
5. Parking citations — `ab4h-6ztd` (23.8M rows, daily, ~2-5 day lag)
   STR CLEAN (TRC7.2.22) + ST CLEANIN (T37C) = street-cleaning tickets, minute-resolution.
   A 2024 records request (#26-5453) restored GPS lat/long on the citations: ~815k of
   ~1M street-cleaning tickets now match to a CNN by NEAREST CNN SEGMENT (<=40m), the
   primary pipeline. The old address→CNN join via EAS (3mea-di5p, keyed by
   stripZeros(number)|street_name) is demoted to a pre-2024 fallback for rows without GPS.
   Precomputed offline into `data/enforcement.json` — see
   `scripts/build-enforcement-records.py` and `docs/sweeper-data-research.md`. Powers the
   "🎯 Ticketed ~9:11a" lines.

### Spatial queries (verified working)
- Segments in viewport: `?$where=intersects(line,'POLYGON((lng lat, ...))')&$limit=2500`
- RPP in viewport:      `?$where=intersects(shape,'POLYGON((...))') AND rpparea1 IS NOT NULL`
- Polygon ring order is `lng lat`, closed (first point repeated).
- Only fetched at map zoom >= 15 (MIN_ZOOM_DATA), debounced on `moveend`.

## Key product decisions / constraints (don't regress these)
- NO live space availability anywhere for SF — SFpark's sensor API was retired in
  2014. The app deliberately only shows *rules*, never "open spots." Don't add fake
  availability.
- The posted physical sign is the source of truth. Every detail sheet says so.
- Curb sides are drawn as two lines offset ~5 m (OFFSET) perpendicular to the
  centerline, signed by cnnrightleft (R=+1, L=-1; fallback alternate). offsetLine()
  uses a local equirectangular projection. Single-side blocks draw one centered line.
- "Next sweep" math = nextSweep(): iterates up to 70 days, matches weekday +
  Nth-occurrence-of-month flag, skips today's window if already past.
- Holiday model (2026-10-05, from the street-cleaning tickets on 8 minor holidays Oct 2025 to Sep 2026; the
  comment above sweepSuspended in lib/sweep-core.js has the numbers): (1) weekday rows stop on EVERY HOL_DAY
  date, whatever their hours or DataSF's holidays flag (no longer read); (2) a weekday 'Holiday' row is its own
  rule (normDay → HOLIDAY_DOW 7, never a weekday, so DAYLBL / the day filter never match it): it sweeps only on
  minor holidays (HOL_DAY and not HOL_NIGHT, `holidayScheduleDay`), at its own hours, even on a side with no
  row that weekday; nextSweep marks those occurrences `holiday: true`; (3) on HOL_NIGHT (New Year's Day,
  Thanksgiving, Christmas) nothing sweeps. It replaced the night-route rule (window inside 12 to 6 AM or
  flagged = swept through minor holidays, `sweepNightRoute`, removed), wrong both ways. The Holiday row joins
  the side's rules everywhere: the sheet (next sweep = earliest across them; "holiday schedule" in the line
  under the head; a `.holsign` "HOLIDAYS 4 TO 6AM" pill; the city-holiday card from `holidayNote`: "Holiday
  schedule" for a side whose Holiday row sweeps that date, "No street sweeping" otherwise, each number once),
  data/schedules.json + data/overview.json (dow 7), /b/ pages (a HOLIDAYS badge, a sentence, "(holiday
  schedule)" in next sweeps; titles, descriptions and the /n/ lists leave dow 7 out), alert rules (stored as
  'holiday'; the push says "(holiday hours)" and drops the tip), /holidays. Caveats: the Holiday window is close,
  not exact (one block ticketed ~3 AM against a 4 to 6 row); weekend minor holidays were not tested.
- Night wording (owner, 2026-10-05; `sweepDayWords` / `sweepWords` in lib/sweep-core.js): a sweep STARTING
  12 AM to before 6 AM reads by the night before, "Mon night 10/5 → Tue 12 to 2 AM · tonight", counting to that
  night (tonight / tomorrow night / in N days; hours once its midnight has passed). Nights count from the night
  people are in, which until 6 AM is the previous date's: at Mon 12:30 AM a Tue 2 AM sweep (Monday night) is
  "tomorrow night", "tonight" from 6 AM. The alert toast names the night its 9 PM push lands on ("~9 PM tonight",
  "~9 PM that night" after a ", next sweep Wed night 10/7" note, "shortly" once that 9 PM has passed; a 6 AM
  sweep, worded by its own day, keeps "the night before"). Sheet head "Mon night", side
  rows + tooltip + alert toast + /b/ "next sweeps" ("Mon night, Oct 5") all come from it. Sign badges, the share
  text, the report-a-fix prefill and the /b/ schedule sentence keep the sign's own words. Cutoff 6, not the
  push rule's 7: the reason is in the sweep-core comment.
- Geolocation: navigator.geolocation is attempted but is often BLOCKED inside
  sandboxed preview iframes. Fallbacks: tap-the-map to drop "parked here", or search
  a street. Real GPS works once deployed / opened in a normal browser tab.

## File map
- index.html — the entire app (HTML + CSS + JS in one file).
- og/template.html + og.png — static 1200x630 social card (regenerate with `npm run og`
  after design-token changes; meta tags live in index.html `<head>`, URLs absolute).
- Brand mark = the isometric "curb cube" (gray top #ADB5BD / red side #C1121F / cream C
  #FDF0D5) with a thick rounded BLACK outline (the 2026-06-13 logo refresh). The single
  source is `icons/logo.svg` — a self-contained vector referenced via `<img class="clogo|
  imlogo|cube|oglogo" src="/icons/logo.svg">` in every header, the welcome modal (.wmark),
  the info-menu (.imlogo), 404 and the story pages (NOT inline SVG anymore — keeps the HTML
  light and the mark consistent). CRITICAL: the outline is BAKED as a fat round-joined black
  stroke (stroke-width 34, linejoin/linecap round) on the two face paths (gray + red, whose
  union is the full silhouette) drawn behind the colored fills — it is deliberately NOT a
  runtime feMorphology filter, because Safari clips SVG filters inside `<img>` and shaved the
  outline (Chrome was fine). Don't reintroduce a filter in logo.svg. viewBox is
  `-19 -16 282 306` (the 17px outline needs the margin). --red is unified to the LOGO RED
  #C1121F everywhere. Favicon is the same outlined cube on TRANSPARENT (icons/favicon.svg =
  copy of logo.svg + /favicon.ico); install icons (icons/icon-{192,512,512-maskable}.png,
  apple-touch-icon.png) keep the paper fill (iOS blackens transparency, Android maskable needs
  a fill). og.png/og-tickets.png inline the outlined svg. Regenerate the whole icon set from
  logo.svg via rsvg-convert + PIL (the gen script lives in /tmp during a refresh; outline math
  is in the script, not a Downloads source). The maker headshot is `icons/alejandro.jpg`
  (GitHub avatar, self-hosted) framed in the about-page bio. tickets/about share .wrap
  max-width 1080px.
- scripts/build-enforcement-records.py + data/enforcement.json — precomputed citation
  enforcement times (`npm run build:enforcement`); GPS nearest-CNN-segment from records
  request #26-5453, with the data/enforcement-gps dataset as input.
- scripts/build-sweeps.py + data/sweeps.json — precomputed sweeper-pass times (records
  request #26-5451 + the data/sweeper-gps dataset); a ticket lands a median ~19 min AFTER
  the sweeper passes.
- scripts/build-routes.py + data/routes.json — the REAL DPW sweeper route per block (CNN ->
  route# + name), from DPW's "All Sweeps on All Blocks" schedule (records #26-5451; ~2010
  vintage, so route IDENTITY only — days/hours stay live from DataSF). Colors the Truck Routes
  map layer + adds the block sheet's "<route> sweeper route" line (loadRoutes/routeFor, keyed by
  cnn like ENF/SWP). Local build (needs `pip install xlrd` + the .xls set via CURB_SWEEP_SCHEDULE_XLS;
  NOT in the data-refresh CI, like build:enforcement). The layer's run DIRECTION stays inferred.
- api/block.js + sitemap-blocks.xml (scripts/build-block-sitemap.mjs, `npm run build:blocksitemap`) —
  /b/<cnn> server-rendered block share/landing pages, ~10.5k long-tail SEO pages. NO DataSF call at
  request time: they read `data/schedules.json` (scripts/build-schedules.mjs, `npm run build:schedules`,
  in the monthly data-refresh + validate-data): every swept cnn's rows, cleaned street text, its
  neighborhood (hoodAt), the adjacent block at each end, a title tag for split pairs and a per-block
  modified date. Unknown cnn → noindex 404; any internal failure → 503 + Retry-After + no-store (NEVER a
  302 home: that told Google the pages were gone during the Sep 2026 host move). Titles stay < 60 chars
  and unique (api/_block.test.mjs renders all of them); the "next sweeps" line makes the 200 cacheable
  only until SF midnight, and sw.js never caches /b/ (network only; bump its CACHE name if it ever cached
  something it shouldn't, so activate purges it). The sitemap lists every baked cnn (all ~12k swept blocks) with real <lastmod>s
  (scripts/lastmod.mjs); both sitemaps are in robots.txt (which Allows /api/og for share cards).
- /n/ pages (scripts/build-hood-pages.mjs): list every block street by street (the only inbound links
  to /b/), "Nearby" = hoods sharing a border, and the build DELETES pages it no longer generates
  (vercel.json 301s retired slugs). Which hoods get a page is one rule in lib/hoods.js, shared with the
  /b/ links. The same build rewrites the home page's neighborhood list between the
  `<!-- hoods:start/end -->` markers in index.html (welcome card) — don't hand-edit inside them.
- holidays.html (/holidays) is GENERATED by scripts/build-holidays-page.mjs (`npm run build:holidays`) from the
  holiday tables in lib/sweep-core.js; never hand-edit it. It tells the holiday model above (regular sweeping
  stops; holiday-schedule blocks are swept, except on HOL_NIGHT); HOLIDAY_SCHEDULE_BLOCKS (590) is a constant a
  test holds within 10% of data/schedules.json. After any change to HOL_DAY / HOL_NIGHT / HOL_NAMES,
  rebuild it (scripts/build-holidays-page.test.mjs fails while the committed page differs from a fresh build).
  When SFMTA posts more dates, also move POSTED_THROUGH in the script. The next holiday is picked in the browser.
- IndexNow: key file `71aabb1f18854413823b971dfe671c61.txt` at the root; `npm run indexnow -- --since
  <ref> [--dry-run]` submits URLs whose sitemap entry changed. data-refresh runs it (optional step)
  once the new sitemaps are live.
- docs/ — sweeper-data research + ready-to-send public-records requests.
- docs/multi-city/ — the plan for more cities (Boston, Buenos Aires researched 2026-10-01): README (plan,
  levels, phases), data-contract.md (the one format a city's data is converted into), adding-a-city.md.
  Groundwork already in the code: `lib/sweep-core.js` is `makeTimeCore({ tz, suspended, holidayName })`,
  one instance per city; SF's instance is attached under the same global names as before (sfParts,
  nextSweep, alertAnchors, …), so SF callers are unchanged. A rule may carry `months` (a season).
- README.md — human-facing run/deploy notes.

## Run / deploy
- Local: just open index.html, or `npm run dev` (http://localhost:3077, never 3000) for a localhost origin (better for
  geolocation testing).
- Deploy (static): `vercel` from this folder (zero config), or any static host.

## Roadmap — likely next task: push notifications
The calendar reminder (＋Reminder button → .ics with a 30-min VALARM) already covers
~90% of "remind me before sweeping" with zero backend. True push is the open item:
- Needs deployment + a service worker + Web Push (VAPID) subscription, and a tiny
  backend/cron (e.g. Vercel cron or Cloudflare Worker) to fire notifications at
  sweep-time minus N.
- iOS gotcha: Web Push only works when the site is installed to the Home Screen as a
  PWA (needs a manifest + service worker). Plan for an "Add to Home Screen" prompt.
- Persist the user's saved spot/schedule (localStorage is fine post-deploy; note it
  is intentionally NOT used in the in-chat artifact version).

## UI features added 2026-06-09 (constraints — don't regress)
- **Basemap style**: Google tiles are styled with `MAP_STYLE` ("Parchment Draft" from
  styledmap.com, passed via createSession `styles`). Roads are deliberately neutral
  near-paper (#f6f1e6/#d8d2c4), NOT the theme's orange-tan — the amber "soon" curb lines
  must keep ~3:1 contrast against the road fill. CARTO fallback stays unstyled.
- **Desktop layout** (`@media min-width:768px`): the bottom sheet docks as a floating
  card bottom-left; top search cluster capped at 480px; zoom control moves bottomright
  (tracked live via `mqDesktop` change listener, not a one-time check).
- **Hover previews**: curb polylines bind a sticky Leaflet tooltip (`previewHtml`) on
  hover-capable pointers only (`CAN_HOVER`). The "sweeps DAY h–h" line must use
  `side.row` (the rule that produced `side.ns`), never `rows[0]` — multi-day sides are
  ~22% of SF and the tooltip otherwise contradicts itself.
- **Day filter** (`.dchip` row + `dayFilter`): a VISIBILITY lens only. It decides which
  sides are drawn; `side.rows`/`side.ns`/color/sheet/alerts always come from the FULL
  rule set, so a filtered view can never arm a reminder for the wrong sweep.
  `placeYou()` resets the filter — "where I parked" must see every curb side.
- **Locate** lives inside the search field (`.field .loc`, navigation glyph); there is
  no floating FAB anymore.
- **Google Cal button** (`openGoogleCal`): template URL with floating wall-clock times
  pinned via `&ctz=America/Los_Angeles`. It cannot set a notification — the sheet note
  reflects that; only .ics and push promise the 30-min lead.
- **Info menu** (`#infoBtn` ⓘ at the right of the search field → `#infoMenu`): the single
  hub for the other pages — How CURB works (opens the welcome explainer), Neighborhoods (`/n/`),
  Sweeping holidays (`/holidays`), Parking tickets (`/tickets`), About (`/about`). The old buried `lp-link` to /tickets in the Layers panel
  was removed; don't re-add scattered page links. Opens/closes like the Layers panel
  (outside-click + Esc, mirrored via `closeInfoMenu`).
- **Truck-route day**: routes are per-day (`drawRoutes` keys off `dayFilter ?? today`). The
  bottom-left legend shows a `#rtDayLeg` "Truck route · <Day>" line ONLY while routes are on,
  kept in sync by `updateRouteDay()` (called from the route toggle + `setDayFilter`). In "All"
  day mode the route shows today's run, so the label appends "today" — don't let All mode
  imply an all-days route (there is no such thing; one run per day per corridor).
- **Corner layout (Google-Maps style — don't re-scatter)**: top-left = logo + search + info
  ⓘ button + ONE day-chip row; top-right = the `.layers` control (button + `#layersPanel`).
  The panel is a Google-style 2-col TILE GRID (`.lgrid`/`.ltile`: preview symbol + label;
  active tile fills ink) — previews ALWAYS show the layer's true map appearance.
  Truck routes carries an amber .beta chip (font-style:normal — no italics rule). Active
  layers show as badges on the button (`refreshLayerBadges()`). Bottom-right: locate button
  stacked above the JOINED +/- zoom pill (one bordered container, divider between).
  Bottom-left: the tappable curb-color legend (.legend2/.lst — show/hide per status;
  hollow dashed swatch = hidden) + `#ovlLeg`, the DYNAMIC legend: every active overlay
  gets a row with its true symbol (`renderOvlLegend()`, called from all four toggles +
  `showArea`); tapping a row clicks the matching tile (single source of toggle logic).
  The permit row carries an inline area `<select>` (`#areaSelLeg`), mirrored by the
  panel's `#areaSelPanel` — both sync in `showArea`. Toggling Truck routes below z15
  auto-zooms to 16 (citywide view has no street data); routeLayer clears on zoom-out.
  Truck routes read `segCacheAll` (every side passing the day filter), NOT `segCache`
  (status-filtered, drives taps/nearest) — hiding all curb colors must leave routes
  visible on their own. Keep both caches cleared together (drawSegments start + z<15).
  Gotcha: the `hidden` attribute loses to any author `display:` rule — elements styled
  display:flex/grid need an explicit `[hidden]{display:none}` (rtday + adisc bit us).
- **Permit-area browser** (`showArea()`, `areaLayer`): area list fetched once into
  `AREAS` (`^[A-Z]{1,2}$` filters junk; colors via `areaColor()` from the sign-disc
  palette — same color drives disc, badge, legend swatch, map highlight, and sheet chip);
  selecting from either dropdown fetches that area citywide (≤2500 rows), draws a
  zoom-scaled highlight + hull boundary + big disc, fitBounds, and toasts the area's
  most-common rule as "typically … (2017 data)".
- **Loading/color-curb layer** (`loadToggle` → `loadOn`, `loadLayer`): toggle loads
  `6cqg-dxku` ⋈ meter coords ONCE (`loadCache`), renders colored dots per viewport; tap →
  popup with days/hours/limit. PLUS unmetered white zones (`whiteCache` ←
  `data/white-zones.json`, built by `npm run build:whitezones`): SFMTA Digital Curb
  ArcGIS layer `Curb_Zones_with_All_Policies` (services.arcgis.com/Zs2aNLFN00jrS4gG,
  anonymous/no-key but UNDOCUMENTED — snapshot at build time, never query live from
  clients) filtered to Passenger/Accessible Loading, grouped by CZ_ID, schedules merged,
  school-tagged via schools dataset 7e7j-59qk proximity (150m) + ZONE_SPECS text from the
  MTA.colorcurb point layer (25m). Drawn as white polylines with ink casing under the
  dots. This is the data hi6h-neyh's title excludes; re-check quarterly whether SFMTA
  ships the promised public CDS Curbs API (none as of June 2026) and migrate when live.
- **Enforcement overlay** (`ENF`/`enfFor`): lazy-loads `data/enforcement.json`; sheet shows
  a 🎯 callout + per-side line, tooltip shows a compact `tip-enf`. Keyed by cnn → JS dow.
  Degrades silently if the JSON is absent (e.g. before deploy). Rebuild with
  `npm run build:enforcement`.
- **Sheet structure (post-distill, don't regress)**: mobile opens at a 46dvh PEEK
  (`.sheet.open`, `.tall` expands via the grab button); order is verdict → where(+center
  icon) → 🎯 callout → actions → chips → sides → `<details>` data-notes. Exactly TWO
  actions: 🔔 Sweep alerts (the one filled primary) and Calendar (one button; first tap
  shows a Google/.ics chooser, remembered in `curbCalPref`, ▾ reopens it). UI glyphs are
  inline SVGs (`ICONS`) — emoji only in toasts/push copy. The date chip IS the today
  filter (toggles `dayFilter` to today).
  DENSITY RULES (2026-06-12 de-dup pass — each number appears ONCE): side rows use
  `relPhrase().short` (date + countdown only — the sign badge beside them owns
  day + window; never render the window twice); the 🎯 callout is exactly two lines
  (avg + minutes-into-window, then earliest + sample size — "latest seen" was cut as
  noise); other-side enfline = avg + count only (deep stats live in the callout when
  that side is active); meter chip says "Metered street" with the meter count in its
  title attr; the data-notes summary keeps "Data notes ▸" in a nowrap span (orphan
  arrow bug).
- **Canonical domain is `curb.guide`** — all og/twitter meta URLs + the OG card footer use
  it (absolute). Add `https://curb.guide/*` to the Google Maps key referrer allowlist.
- **Overview fallback (`ovMode`, don't regress)**: detail mode is gated by a `count(*)`
  probe, not zoom alone — wide windows at z15-16 can hold 10x the `SEG_CAP` (2,500) rows
  and a truncated fetch draws a misleading random subset. Over cap → `enterOverviewMode()`
  keeps the complete citywide overview (weight 3 at z15+, 2 below). All "are we in citywide
  view" checks (map click → flyTo, day/status recolor, route toggle auto-zoom, meter/loading
  guards) read `ovMode`, NOT `getZoom()<MIN_ZOOM_DATA`.
- **Performance invariants**: head carries preconnects to every data origin (fonts.gstatic,
  cdnjs, data.sf.gov, tile.googleapis.com, carto). The citywide overview draws in
  1,500-line chunks across frames (`drawOverview`, token-guarded) — never synchronously.
  Meters/loading zones load from the static `data/zones.json` (regen: `npm run build:zones`);
  the live Socrata join survives only as a fallback. Static data assets: enforcement.json,
  overview.json, zones.json — all `npm run build:*`, refresh every few months.
- **Socrata gotcha**: any `$where` containing `%` wildcards must be percent-encoded
  (see loadMeterChip) or the request dies before CORS and fails silently. Page big tables
  with a `:id` cursor (`:id > 'last'`), NOT deep `$offset` (times out past ~400k).

## Other backlog ideas
- Pin meters per-block (requires spatial join of meters to sweeping segments;
  currently street-level count only).
- Inferred sweeper-route animation from schedule adjacency + citation ordering, and a
  records-request push for FleetRoute/AVL — see `docs/sweeper-data-research.md`.

---

## PWA / Push scaffold (added — start here)

Files now present for the push feature:
- `manifest.json` — installable PWA (icons in `icons/`, theme #E0322E).
- `sw.js` — service worker: app-shell cache + `push` and `notificationclick`
  handlers. ALREADY FUNCTIONAL once a push arrives.
- `index.html` — now links the manifest, adds iOS PWA metas, and registers `sw.js`
  on load (guarded; no-op in sandbox).
- `api/_store.js` — subscription store backed by Upstash Redis (hash `curb:subs`,
  field = subscription.endpoint). Accepts `KV_REST_API_*` (Vercel Upstash integration)
  or `UPSTASH_REDIS_REST_*`. Exports saveSub / loadAllSubs / deleteSub / markNotified.
  Multi-watch (2026-10, GitHub #11 "both sides of the street"): a device keeps up to `MAX_WATCHES` = 5
  watches, one per curb side. Watch 0 is the device's own field (so every record from before is watch 0,
  untouched); watch n is `<endpoint>#<n>` (n 1..4) in the same hash (endpoints with a `#` are refused).
  Each watch is a complete record (own spot, rules, `notified`, savedAt), so the cron loops, `casUpdate`
  and the never-re-arm-a-Turn-off guarantee hold per watch unchanged; `loadAllSubs` returns `{ field, slot,
  endpoint }` per watch (`field` for advanceSpot / markNotified, `endpoint` = the device). Fixed slots, not
  side-named fields: a save reads the 5 known fields in ONE `HMGET` (raw strings) and `pickSlot` picks, in
  order, the armed watch on this side (in place, no duplicate), a watch turned off on this side (`offSide`
  remembers it, so off → on keeps its de-dupe), a pre-multi turned-off record (reused with its de-dupe, as
  before), an empty slot, a watch turned off on another side (fresh de-dupe), then a DEAD watch (`watchDead`
  in api/_schedule.js: savedAt past `MAX_WATCH_AGE`, or a one-shot spot with no rule, once its sweep window is
  over; never one whose window hasn't ended), fresh de-dupe, so dead watches can't hold slots forever; 5 live
  on other sides → `{ full: true }` (409 `alert limit reached`). Sides match on cnn + sideKey or cnn + blockside (auto-park
  keys by cnnrightleft), else corridor|limits|blockside. A save writes through `claimField` (HSETNX for an
  empty slot, else the same CAS script) and re-reads on a lost race, so two new sides tapped at once both
  land and a cron write between a save's read and write is not dropped. `deleteSub` / `deleteIosSub` remove
  all 5 fields (a dead device is pruned once). Storage is capped at 5 records per device.
  THE MULTI MARKER (don't drop it): the page puts `multi: 1` in every save's spot (arm, daily refresh, style
  save; web body and both iOS bridges, which forward the spot untouched). Both save endpoints read it from the
  raw spot before `sanitizeSpot` drops it. A save WITHOUT it comes from a page loaded before multi-watch (an
  open PWA tab, the iOS app's web view, which never reloads, an SW-cached navigation), which tells the user
  "Turning them on here moves them to this curb" / "<A> won't alert anymore" and can't see or turn off other
  watches. So it keeps the single-watch meaning (`legacy`, `pickLegacy`): it lands on this side's watch (armed
  or off on this side, de-dupe kept), else watch 0, never 409s, and turns off every other armed watch of the
  device (de-dupe and `offSide` kept), re-reading the slots after its write so a save landing meanwhile goes
  off too. Then the old page writes ONE side to `curbAlert`, which the new page reads as the whole truth.
  THE CAR SLOT: auto-park (`atBase`, `api/parked.js`; latent, nothing calls enable-auto-park today) tags its
  watch `car: true` and writes the slot already holding `car: true`, else the slot `pickSlot` gives it (409
  when 5 sides are live: parked.js says so, no "Alerts armed" push), so it follows the car and never
  overwrites a side the user armed. After its write it re-reads the slots and turns off another armed watch
  on the car's side (skipping the slot just written). A page save on the car's slot takes it over (drops the
  tag). `MAX_WATCH_AGE` (~120 days) lives in api/_schedule.js, imported by the store and the sender (and the
  page's `WATCH_MAX_AGE` is held equal by a test).
- `api/save-subscription.js` — persists `{ subscription, spot }` via the store, with
  input validation (https push-host allowlist, size caps, spot sanitize/clamp); like the iOS twin, only a
  brand-new endpoint is throttled (per client IP, 10 s), a re-save of a known one always lands. `DELETE
  { subscription, spot? }` turns alerts off: proven by endpoint + a constant-time `keys.auth` match, it
  DISARMS (`spot = null`, the cron skips it) so auto-park keeps resolving the subscription. `spot` names
  the side (`sanitizeSide`, clamped like sanitizeSpot): only that watch goes off, the others are never
  touched; no side (a page from before multi-watch) turns off every watch of the device. A POST without the
  multi marker moves the alerts (see THE MULTI MARKER above). Auto-park (`api/parked.js`) saves with
  `{ atBase: true }`: the car slot follows the car (see THE CAR SLOT), and another armed watch on that same
  side is turned off (no double push).
- `api/send-notifications.js` — the sender: loads subs, sends the touchpoint `dueAlert` says is due
  over web-push / APNs, de-dupes via `notified`, prunes on 410/404. A push's deep link names its side,
  `/b/<cnn>?side=<blockside>` (letters only, which /b/ passes on to the live map link), so with both sides
  of a block watched a tap opens the side the push is about (sw.js appends `&p=1` after a `?`). Auth: an Upstash QStash
  `Upstash-Signature` JWT (official `Receiver`, raw body — so the schedule's body must be EMPTY — and the exact URL
  `https://curb.guide/api/send-notifications`) OR `Bearer CRON_SECRET`; refuses anything else.
  `?test=ios` and `GET ?status=1` (last run time/outcome/trigger, no sends) are Bearer-only.
- Triggers — TWO primaries + one backup. Vercel Cron in `vercel.json` (`7,22,37,52 * * * *`, Bearer
  CRON_SECRET sent automatically; offset from QStash so the two alternate). The team is on Vercel Pro — Hobby
  rejects sub-daily crons, so REMOVE the `crons` block before any move to Hobby or deploys fail. PRIMARY: an Upstash QStash
  schedule, every 15 min, POST, EMPTY body (REQUIRED: on Vercel the runtime's helpers consume a
  non-empty body before the handler — `bodyParser:false` doesn't stop them — so even `{}` makes the
  signature check fail and every QStash run 401s), destination exactly the URL above; env
  `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`. QStash never holds CRON_SECRET (it also
  unlocks `?test=ios`, a push to every iOS device). BACKUP: `.github/workflows/sweep-alerts-cron.yml`
  curls with `Bearer ${{ secrets.CRON_SECRET }}` (repo secret, NEVER committed); a manual dispatch is a
  normal run and it deliberately has NO test input (a token able to dispatch workflows, like the
  monitor's QStash PAT, must not be able to broadcast `?test=ios`; run that test by hand with curl and
  the bearer). GitHub schedules are best-effort (Sep 2026: ~7 runs/day, not 96). Overlap is safe: a 120 s run lock — released once a run
  fully succeeds (web loop done, no APNs error), so a GitHub run just before a QStash tick no longer
  swallows that tick; deliberately NOT released on error (a retry would re-send a push whose
  markNotified failed) — plus the per-sweep `notified` de-dupe. Every run records itself in Upstash
  (`curb:cron`: last + last success, plus the last QStash-triggered run `lastQstash` {at, ok, error?}
  and last successful one `lastQstashOk` {at}, so backup runs can't hide a dead primary) for the
  monitor's `?status=1` check; optional `HC_PING_URL` (healthchecks.io) is pinged by successful QStash
  runs and `/fail` on errors. The monitor workflow can also be dispatched by QStash (`mode` input).
  A 200 run is not proof of delivery: each run counts attempted / sent / failed (by status) / pruned per
  channel (`checked` = devices with any record, off included, as before; `watches` = armed watches), and
  `judgeDelivery` keeps the last 6 devices tried per channel in `curb:cron` `delivery`. With several watches
  on a device, a failed send skips its other watches until the next tick (one failure and one timeout per
  device, never per watch) and a 410/404 prunes all of them once. Watch n's pushes use `<tag>-<n>` (web tag
  and apns-collapse-id) so two sides' eve pushes at 8 PM don't collapse into one notification. At
  least 3 failed and twice the deliveries (or the APNs pass erroring 2 runs in a row, or armed iOS
  watches with no APNs config) sets `delivery.failing`: HC gets `/fail` and the monitor's alerts-sender
  check fails. Devices, not sends, so one dead subscription retried every tick can't trip it; 410/404
  prunes never count.
- `.env.example` — VAPID keys (`npx web-push generate-vapid-keys`), KV/Upstash vars, CRON_SECRET,
  QStash signing keys, HC_PING_URL.

**Native iOS (APNs) — added 2026-06-16.** The iOS app is a WKWebView wrapper, so it gets native
push alongside Web Push:
- `api/_apns.js` — minimal APNs sender (ES256 .p8 JWT over `node:http2`, no deps; key via
  `APNS_KEY_P8_B64` preferred / `APNS_KEY_P8`). `api/save-ios-subscription.js` stores a hex APNs
  device token + spot in the `curb:apns` Upstash hash (sibling of `curb:subs`, identical shape).
  Only brand-new tokens are throttled (per client IP); re-saves of a known token always land (a
  per-token 60 s throttle used to drop block switches and style changes). Off: `DELETE {token, spot?}` or
  `POST {token, spot:{off:true, cnn, sideKey, corridor, limits, blockside}}` — the shipped app's bridge can
  only POST the page's spot, but it forwards that object untouched (builds 6 and 7 build the body
  themselves around it), which is how multi-watch works on iOS with NO app update: the side rides in the
  spot, and so does the `multi: 1` marker (no marker = a page from before, whose save moves the alerts).
  `{off:true}` alone (an old page) turns off every watch of the token. Off DISARMS (`spot = null`,
  like web) rather than deleting, so the de-dupe survives turning alerts back on. Watch n's iOS record has
  no `token` property (the field names the device), so code from before multi-watch, run against it after a
  rollback, would send to the field (refused by APNs) rather than repeat a push every tick.
- `api/send-notifications.js` runs a SECOND loop over `loadAllIosSubs()` with the IDENTICAL
  lead-window / night-before / dedupe / forever-watch logic, delivering over APNs instead of
  web-push; `?test=ios` (authed) sends a one-off delivery test, one per device. Env: `APNS_KEY_P8_B64`/`APNS_KEY_P8`,
  `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (see `docs/native-push-plan.md`).
- On the native wrapper the "🔔 Sweep alerts" button is diverted to `window.__curbNativePush`
  (the `curbPush` bridge → APNs registration), NOT the PWA "Add to Home Screen" hint.
- App Store rating ask (1.0.4): `ios/CURB/ReviewPolicy.swift` (pure rules) + `ReviewPrompt.swift` ask iOS for
  the rating sheet 3 s after the page a REAL sweep alert opened has loaded (payload `tag` starts `curb-sweep`;
  test pushes are `curb-test*`, so keep notify-core TAGS on that prefix), never on the first open (an open =
  one stay in the foreground), once per app version, never over a sheet or system prompt.
  `ios/CURB/ReviewPrompt.test.mjs` checks the tag contract and compiles the policy with swiftc when present.

### What's DONE vs TODO
DONE (all of it, end-to-end):
1. Client subscribe flow — "🔔 Sweep alerts" button beside ＋Reminder (`onAlertTap` in
   `index.html`): permission → `serviceWorker.ready` → `pushManager.subscribe({
   userVisibleOnly:true, applicationServerKey:<VAPID public> })` → POST `{ subscription,
   spot }` to `/api/save-subscription`. `spot = { corridor, limits, blockside,
   nextSweepISO: active.ns.start.toISOString(), leadMinutes: 30 }`.
2. Storage layer — `api/_store.js` (Upstash, keyed by endpoint), used by both routes.
3. iOS — `#iosHint` "Add to Home Screen" modal; tapping alerts on a non-installed iPhone
   diverts to it. Auto-shown once for un-installed iOS Safari.
4. Re-subscription + 410/404 prune; cron de-dupe via `notifiedFor`; VAPID-key self-heal.

Forever-watch (implemented): the saved `spot` carries `rules` — EVERY schedule row of the curb side
(multi-day sides are ~25% of SF; the side's holiday schedule is a rule too, stored as weekday 'holiday';
`sanitizeRules` drops invalid rows one by one, dedupes, caps at 16)
— plus `rule` (the row behind `nextSweepISO`, kept for back-compat). After each sweep window ends the
cron's `recomputeSpot` advances `nextSweepISO` to the EARLIEST next occurrence across the rules (plus
fresh anchors) via `advanceSpot` / `advanceIosSpot`, which re-read the record and skip the write if the
user turned the watch off or re-saved it since the run's snapshot (a Turn off must never be re-armed).
Those and `markNotified` / `markIosNotified` write through one compare-and-set EVAL (`casUpdate` in
api/_store.js), so a Turn off or block switch landing between a cron read and its write is never
overwritten either; don't turn them back into a plain HGET + HSET.
The `notified` de-dupe map is NEVER reset (not by
the advance, a re-save, a block switch or Turn off): each entry holds the sweep instant it fired for, so
it only blocks that sweep — an off → on of the same sweep can't re-send a push. A watch stops
auto-advancing once it goes stale past `MAX_WATCH_AGE` (~120 days, api/_schedule.js) so a frozen rule can't
track a city schedule change. In the sheet, ties between a side's rows go to the earliest next sweep.

Cadence (`lib/notify-core.js`, don't regress): Light = lead, Normal = eve + lead, Intense = eve +
morn + lead; sweeps starting before 07:00 SF get ONE "move it tonight" push from 21:00 SF the evening
before instead, at every level, derived at send time (sent after SF midnight — a late arm or tick — it
keeps key `tonight` but uses the `early` copy: no "tonight / before bed"). eve is eligible 20:00 →
min(23:00, sweep − lead); morn only when start−2h lands 06:00-21:59 SF on the sweep's own day; lead is skipped with
< 5 min left. The anchor rule is `alertAnchors()` in `lib/sweep-core.js`, shared by the page, the cron
re-arm and the send-time guard. `dueAlert` returns `expiresAt` (lead/tonight: the sweep; morn: sweep
− lead; eve: SF midnight) used for web-push TTL (min 60 s) and apns-expiration, and `urgent`
(lead/tonight: Urgency high + requireInteraction). No web-push Topic (Apple rejects it). Test pushes
are titled "Test · <which alert> (<when it really fires>)". The holiday table covers through
2029-01-01 (2027-2028 derived by rule; a test fails 150 days before it runs out).

Saved alerts (index.html): localStorage `curbAlert` is a MAP keyed on the curb side (`cnn|sideKey` →
{cnn, sideKey, corridor, limits, blockside, level, voice, armedAt, v}), up to `MAX_ALERTS` = 5 (= the
server's MAX_WATCHES, a test holds them equal); a single value (from before multi-watch, or written since by
a page loaded before it, over the map) becomes a one-entry map in `savedAlerts()` and REPLACES the map, never
merges: that page's save carried no marker, so the server turned every other watch off, and merging would show
sides as on that the server dropped (ios/page-bridge.test.mjs runs main's writer against the real endpoint).
Keyed on the side, NOT the
sweep instant — the old instant key read "off" after the first sweep while pushes kept coming. "On"
is claimed only while the watch is alive (< MAX_WATCH_AGE, web permission granted); legacy
`curbAlertKey` values migrate by corridor|limits|blockside; a matching sheet silently re-arms once a
day (a same-sweep re-save keeps the stored eve/morning anchors and `notified` — the sheet drops anchors
it thinks are past, and an 8:05pm refresh used to wipe that night's eve push; a save from a sheet left
open since before the cron re-armed — same side + rules, an older sweep that has already started — keeps
the stored spot and applies only level/voice, `staleResave` in api/_store.js). Tapping "✓ Alerts on"
offers Turn off, which names its side (web DELETE `spot`, iOS `{off:true, ...sideOf(spot)}`) and forgets
only that side. Any other side shows the normal 🔔 Sweep alerts, which ADDS a watch, with one muted line
under the actions (`#alertNote`): "Also on for Crestline Dr, NE side · Kansas St, West side"
(`alertLabel`: compound sides abbreviated, cross streets only to tell two blocks of a street apart). At 5
live watches the button reads "5 of 5 alerts in use" (`.btn.full`, dashed), the line adds "Turn one of them
off on its sheet to add this curb." and a tap toasts the limit without saving; the server's 409 reads the
same (build 7+ passes `save-failed:409`; build 6 can't tell, so the page checks before asking). Intensity /
Voice are global prefs: a change re-saves the open side at once and each other side on its next sheet open
(refreshWatch sees the style differ). A silent re-arm (`reArm`: refresh, style save) never undoes a Turn off:
web re-arms and Turn off DELETEs go through one queue (`webQueue`, like `_nativeQ`), so a re-arm in flight
lands before the DELETE; a re-arm reaching the front of its queue after a Turn off of its side is not sent
(it is sent only while `alertSpotMatches`), and one that a Turn off overtook in flight (`_offSeq`, bumped by
`turnOffAlerts`) answers 'off', so it is not marked armed. The iOS bridge comes in two shapes: build
<= 6 calls `__curbNativePushResult(ok, msg)` and `__curbRequestPush(spot)` resolves a boolean; build 7+
calls `__curbNativePushResult` with ONE object `{ok, reason, message, status}` (`reason` is a stable code:
saved, denied, denied-settings, save-failed, registration-failed, timeout, …; `message` the server/iOS
text; `status` the save's HTTP code) and adds `__curbRequestPushDetail(spot)`, which resolves that object
(`__curbRequestPush` stays boolean). The page prefers `__curbRequestPushDetail`, classifies on `reason`
(`denied*` → Settings guidance, never a report) and keeps the rest for reports (`ios save-failed:429 slow
down`). Every native call, test pushes included, goes through ONE queue (the app keeps one pending call);
failures report `push-save-failed` / `push-off-failed` via `curbReport`. Headless check:
`scripts/check-alerts-ui.mjs` (runs build 6's bridge and build 7's real pushScript);
`ios/page-bridge.test.mjs` runs the page's bridge code against both in vitest.

Setup to run live: see README "Push notifications". Env: VAPID_{PUBLIC,PRIVATE}_KEY,
VAPID_SUBJECT, CRON_SECRET, QSTASH_{CURRENT,NEXT}_SIGNING_KEY, HC_PING_URL (optional),
KV_REST_API_URL/TOKEN (Upstash). Embedded VAPID *public* key
lives in `index.html` (`const VAPID_PUBLIC_KEY`).

### Local dev note
Service workers + push need a secure origin. `npm run dev` (serve) gives http
localhost which is treated as secure for SW. For push end-to-end testing, deploy or
use a tunneled https origin; iOS testing requires the installed PWA.
