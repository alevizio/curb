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
- Basemap: official Google Map Tiles API when `GMAPS_KEY` (or `window.GMAPS_KEY`) is set —
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
1. Street sweeping — `yhqp-riqs`
   https://data.sfgov.org/resource/yhqp-riqs.json
   Fields: cnn (segment id), corridor, limits (cross streets), blockside,
   cnnrightleft (L/R vs digitized direction), weekday, fromhour, tohour,
   week1..week5 ("1"/"0" = Nth occurrence of that weekday in the month),
   line (GeoJSON LineString). CURRENT data.
2. Parking meters — `8vzz-qzz9`
   https://data.sfgov.org/resource/8vzz-qzz9.json
   Fields: street_name (UPPERCASE), cap_color, on_offstreet_type, lat/long, etc.
   CURRENT data. Used only for a street-level count (no spatial join — see limits).
3. Parking regulations / RPP — `hi6h-neyh`
   https://data.sfgov.org/resource/hi6h-neyh.json
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
   NOT geocoded since ~2021 (address strings only, zero-padded + typos). CURB joins
   citation address → CNN via EAS (3mea-di5p), keyed by stripZeros(number)|street_name.
   Precomputed offline into `data/enforcement.json` — see `scripts/build-enforcement.mjs`
   and `docs/sweeper-data-research.md`. Powers the "🎯 Ticketed ~9:14a" lines.

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
- scripts/build-enforcement.mjs + data/enforcement.json — precomputed citation enforcement
  times (`npm run build:enforcement`).
- docs/ — sweeper-data research + ready-to-send public-records requests.
- README.md — human-facing run/deploy notes.

## Run / deploy
- Local: just open index.html, or `npx serve .` for a localhost origin (better for
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
- **Google Cal button** (`openGoogleCal`): template URL with floating wall-clock times
  pinned via `&ctz=America/Los_Angeles`. It cannot set a notification — the sheet note
  reflects that; only .ics and push promise the 30-min lead.
- **Corner layout (Google-Maps style — don't re-scatter)**: top-left = logo + search +
  ONE day-chip row; top-right = the `.layers` control (button + `#layersPanel`). Panel rows are
  [map-symbol] [label] [eye] — the symbol ALWAYS shows the layer's true map appearance
  (it IS the legend; off rows dim to .42 but stay readable), the eye toggles visibility.
  Truck routes carries an amber .beta chip (font-style:normal — no italics rule). Active
  layers show as badges on the button (`refreshLayerBadges()`). Bottom-right: locate button
  stacked above the JOINED +/- zoom pill (one bordered container, divider between).
  Bottom-left: the tappable curb-color legend (.legend2/.lst — show/hide per status;
  hollow dashed swatch = hidden) + the sheet. Toggling Truck routes below z15
  auto-zooms to 16 (citywide view has no street data); routeLayer clears on zoom-out.
- **Permit-area browser** (`#areaGrid` discs → `showArea()`, `areaLayer`): disc grid of
  all RPP areas (fetched once, `^[A-Z]{1,2}$` filters junk; colors via `areaColor()` from
  the sign-disc palette — same color drives disc, badge, map highlight, and sheet chip);
  selecting fetches that area citywide (≤2500 rows), draws a zoom-scaled highlight,
  fitBounds, and toasts the area's most-common rule as "typically … (2017 data)".
- **Loading/color-curb layer** (`loadToggle` → `loadOn`, `loadLayer`): toggle loads
  `6cqg-dxku` ⋈ meter coords ONCE (`loadCache`), renders colored dots per viewport; tap →
  popup with days/hours/limit. Metered zones only (note in the toggle toast).
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
- **Canonical domain is `curb.guide`** — all og/twitter meta URLs + the OG card footer use
  it (absolute). Add `https://curb.guide/*` to the Google Maps key referrer allowlist.
- **Performance invariants**: head carries preconnects to every data origin (fonts.gstatic,
  cdnjs, data.sfgov.org, tile.googleapis.com, carto). The citywide overview draws in
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
  input validation (https push-host allowlist, size caps, spot sanitize/clamp).
- `api/send-notifications.js` — Vercel cron handler; loads subs, sends web-push for any
  spot whose `nextSweepISO` is within `leadMinutes`, de-dupes via `notifiedFor`, deletes
  on 410/404. Requires `CRON_SECRET` (Bearer) — refuses to run unauthenticated.
- `vercel.json` — cron every 15 min (needs Vercel Pro; Hobby throttles to ~daily — use an
  external scheduler hitting the endpoint with `Authorization: Bearer <CRON_SECRET>`).
- `.env.example` — VAPID keys (`npx web-push generate-vapid-keys`), KV/Upstash vars, CRON_SECRET.

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

Known limitation (by design — `spot` carries only a single `nextSweepISO`, no recurrence
rule): an alert is **one-shot**. After that sweep passes, the button reverts from
"✓ Alerts on" to "🔔 Sweep alerts" (the saved-alert key includes `nextSweepISO`), cueing a
re-tap to arm the next occurrence. True recurrence would need to persist the sweep rule
(weekday + week flags + hours) and recompute server-side — intentionally out of scope.

Setup to run live: see README "Push notifications". Env: VAPID_{PUBLIC,PRIVATE}_KEY,
VAPID_SUBJECT, CRON_SECRET, KV_REST_API_URL/TOKEN (Upstash). Embedded VAPID *public* key
lives in `index.html` (`const VAPID_PUBLIC_KEY`).

### Local dev note
Service workers + push need a secure origin. `npm run dev` (serve) gives http
localhost which is treated as secure for SW. For push end-to-end testing, deploy or
use a tunneled https origin; iOS testing requires the installed PWA.
