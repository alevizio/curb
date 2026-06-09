# CURB

San Francisco street-parking rules on a map: street sweeping schedules, the next
sweep time per curb side, metered-street info, and residential permit (RPP) zones.
One-tap calendar reminder before the next sweep, plus a PWA with true Web Push
move-your-car alerts.

Static front-end (no build) + serverless API routes (Vercel) for Web Push.

## Run locally
```bash
npm install            # for the web-push dep used by the API
npm run dev            # = npx serve . -l 3000  (http://localhost:3000)
```
Open http://localhost:3000. A localhost origin is needed for geolocation + service worker.

## Deploy
```bash
npm run deploy         # = vercel
```

## Push notifications (wired end-to-end)
The "🔔 Sweep alerts" button in the detail sheet subscribes the device to Web Push and
saves its spot; a Vercel cron pushes "move your car" ~30 min before the next sweep.

Setup (one time):
1. **VAPID keys** — `npx web-push generate-vapid-keys`. The public key is embedded in
   `index.html` (`VAPID_PUBLIC_KEY`); both keys go in env (see `.env.example`). If you
   rotate keys, update the constant in `index.html` too.
2. **Subscription store** — add the **Upstash for Redis** integration on Vercel (Storage
   tab). It sets `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically. `api/_store.js`
   also accepts `UPSTASH_REDIS_REST_URL` / `_TOKEN` for a standalone Upstash DB.
3. **Env vars on Vercel** — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
   `CRON_SECRET` (required — the cron refuses to run without it), plus the KV vars from step 2.
4. **Cron** — `vercel.json` runs `/api/send-notifications` every 15 min. **Note:** the
   15-min cadence needs **Vercel Pro**; on Hobby, Vercel throttles crons to ~once/day. As a
   fallback, point any external scheduler (e.g. cron-job.org) at the endpoint with header
   `Authorization: Bearer <CRON_SECRET>`.

iOS: Web Push only works once CURB is installed to the Home Screen (the app shows an
"Add to Home Screen" hint for un-installed iPhones).

## Map basemap (Google Maps, optional)
With a Google **Map Tiles API** key the basemap uses official Google tiles; without one it
falls back to keyless CARTO Voyager. The key is a *client* key — **restrict it by HTTP referrer
+ API** in Google Cloud Console (add `http://localhost:3000/*`, `https://*.vercel.app/*`, and
your domain).

The key is kept out of this public repo:
- **Local:** copy `config.example.js` → `config.js` (gitignored) and paste your key.
- **Deployed:** set `GMAPS_KEY` in your Vercel env. `api/config.js` serves it to the client and
  `vercel.json` rewrites `/config.js` → `/api/config`, so nothing changes in `index.html`.

## Data
- Street sweeping: DataSF `yhqp-riqs`
- Parking meters: DataSF `8vzz-qzz9`
- Parking regulations / RPP: DataSF `hi6h-neyh` (2017 set; may be incomplete)
- Address search: DataSF `3mea-di5p` (Enterprise Addressing System, updated nightly)

The posted street sign is always the source of truth. There is no live
space-availability data for SF (SFpark sensors retired in 2014).

See `CLAUDE.md` for architecture, data schemas, and the roadmap.
