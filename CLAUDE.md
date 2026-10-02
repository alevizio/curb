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
   line (GeoJSON LineString). CURRENT data.
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
  hub for the other pages — How CURB works (opens the welcome explainer), Parking tickets
  (`/tickets`), About (`/about`). The old buried `lp-link` to /tickets in the Layers panel
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
- `api/save-subscription.js` — persists `{ subscription, spot }` via the store, with
  input validation (https push-host allowlist, size caps, spot sanitize/clamp); like the iOS twin, only a
  brand-new endpoint is throttled (per client IP, 10 s), a re-save of a known one always lands. `DELETE
  { subscription }` turns alerts off: proven by endpoint + a constant-time `keys.auth` match, it
  DISARMS (`spot = null`, the cron skips it) so auto-park keeps resolving the subscription.
- `api/send-notifications.js` — the sender: loads subs, sends the touchpoint `dueAlert` says is due
  over web-push / APNs, de-dupes via `notified`, prunes on 410/404. Auth: an Upstash QStash
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
  channel, and `judgeDelivery` keeps the last 6 devices tried per channel in `curb:cron` `delivery`. At
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
  per-token 60 s throttle used to drop block switches and style changes). Off: `DELETE {token}` or
  `POST {token, spot:{off:true}}` — the shipped app's bridge can only POST the page's spot. Off DISARMS
  (`spot = null`, like web) rather than deleting, so the de-dupe survives turning alerts back on.
- `api/send-notifications.js` runs a SECOND loop over `loadAllIosSubs()` with the IDENTICAL
  lead-window / night-before / dedupe / forever-watch logic, delivering over APNs instead of
  web-push; `?test=ios` (authed) sends a one-off delivery test. Env: `APNS_KEY_P8_B64`/`APNS_KEY_P8`,
  `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (see `docs/native-push-plan.md`).
- On the native wrapper the "🔔 Sweep alerts" button is diverted to `window.__curbNativePush`
  (the `curbPush` bridge → APNs registration), NOT the PWA "Add to Home Screen" hint.

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
(multi-day sides are ~25% of SF; `sanitizeRules` drops invalid rows one by one, dedupes, caps at 16)
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
auto-advancing once it goes stale past `MAX_WATCH_AGE` (~120 days) so a frozen rule can't track a city
schedule change. In the sheet, ties between a side's rows go to the earliest next sweep.

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

Saved alert (index.html): localStorage `curbAlert` keyed on the curb side (cnn|sideKey), NOT the
sweep instant — the old instant key read "off" after the first sweep while pushes kept coming. "On"
is claimed only while the watch is alive (< MAX_WATCH_AGE, web permission granted); legacy
`curbAlertKey` values migrate by corridor|limits|blockside; a matching sheet silently re-arms once a
day (a same-sweep re-save keeps the stored eve/morning anchors and `notified` — the sheet drops anchors
it thinks are past, and an 8:05pm refresh used to wipe that night's eve push; a save from a sheet left
open since before the cron re-armed — same side + rules, an older sweep that has already started — keeps
the stored spot and applies only level/voice, `staleResave` in api/_store.js). Tapping "✓ Alerts on"
offers Turn off; other blocks show "Alerts are on for <block>". The iOS bridge comes in two shapes: build
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
