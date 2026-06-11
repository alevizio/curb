# Launch hardening — verified research digest (2026-06-11)

Five-lens deep research, every load-bearing claim adversarially re-verified.
Full transcript stats: 6 agents, 156 tool calls. Actions split: quick fixes
shipped same-day; the rest tracked in Linear WEB-49.

## Shipped same-day
- nextSweep loop 70→150 days (119-day max gap between consecutive 5th-weekday
  occurrences would silently gray-out week5-only rules).
- DST guard: spring-forward collapses 2–3am windows to zero length
  (`new Date(2026,2,8,2,0)` normalizes to 3:00 PDT — verified empirically);
  zero/inverted windows now get a 1-hour floor so "sweeping now" can render.
- Canvas renderers pinned to the map at init (leaflet 1.9.4 #9542 stale
  `_redrawRequest` freeze when containers are recreated — fixed only in v2),
  and the overview draw-token bumps before layer removal so chunked draws
  can't interleave.
- Share pages: theme-color (Discord accent), og:image:width/height (Facebook
  first-share), no site-name dup in og:title (Apple TN3156).

## Tracked in WEB-49 (pre-launch priority order)
1. **Holidays** — we never fetch the `holidays` flag; ~10 SFMTA-observed
   holidays/yr produce false "move your car" + false push for ~93% of blocks,
   and 824 weekday="Holiday" rows (real nightly sweeps) are invisible.
2. **SF-pinned time core** — all Dates are device-local: NY phones get push/.ics
   3h early; Honolulu shows green 30min before a real sweep; Tokyo never sees
   "sweeping now". Validated fix: ~20-line Intl `sfWallToInstant()` two-pass
   offset correction (handles both 2026 DST edges from any device TZ).
3. **Overview recolor-not-rebuild** — clearLayers+recreate of 12k canvas lines
   per filter change hits unfixed leaflet#8538 memory growth in long-lived tabs.
4. **Per-block dynamic OG images** — @vercel/og on Node runtime; 500KB bundle
   cap incl. fonts (ttf/otf/woff, NO woff2); flat PNG lands ~30–150KB.
5. **TZ-matrix tests** (Vitest under TZ=LA/NY/HNL/Tokyo/UTC) + Playwright map
   soak with heap snapshots.

## Operational facts worth remembering
- **Unfurl scrapers run zero JS** (Apple TN3156 explicit); iMessage fetches from
  the *sender's device IP* with a UA containing both `facebookexternalhit` and
  `Twitterbot`; budget ≈1–2s TTFB → share pages must come from CDN cache.
- **WhatsApp og:image**: ~600KB hard cap (3rd-party consensus; target ≤300KB),
  no SVG/GIF, caches days–weeks with NO refresh tool → card must be right
  before first share. Slack re-scrapes in ~30min (fastest test loop);
  Facebook Sharing Debugger forces a re-scrape.
- **Socrata**: anonymous requests throttle per source IP from a shared pool —
  browser-distributed traffic is per-USER-IP, so launch spikes are fine;
  an X-App-Token is identification not authentication (public exposure =
  quota attribution only) and CORS preflight allows it. SODA3 endpoints
  require tokens; SODA 2.1 `/resource/` (what we use) has no announced sunset.
- **iOS Web Push**: Home-Screen install required; permission needs direct user
  gesture; subscriptions get revoked after repeated pushes that don't show a
  notification (commonly reported as 3 strikes — Apple doesn't document the
  number) → sw.js must ALWAYS `event.waitUntil(showNotification())` (it does).
  Declarative Web Push (iOS 18.4+, `"web_push": 8030`) is a safe upgrade path.
- **Web Share**: desktop Firefox has none, Chrome <128 Windows/ChromeOS only —
  the clipboard fallback IS the desktop path (HN traffic). AbortError = cancel.
- **iOS PWA links**: shared links ALWAYS open in Safari, never the installed
  app — /b/ landing pages must never assume installation.
