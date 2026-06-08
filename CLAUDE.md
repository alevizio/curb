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
  back to keyless CARTO Voyager raster tiles when no key / on any failure. The Google key is a
  client key (referrer-restrict it). Leaflet stays the map engine either way.
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

## Other backlog ideas
- Pin meters per-block (requires spatial join of meters to sweeping segments;
  currently street-level count only).
- Color-curb zones (red/yellow/white/green/blue) — not in current datasets here.

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
