// POST { token, lat, lng } — the iOS-Shortcuts auto-park endpoint (ALE-168 Tier 2).
// A car-Bluetooth-disconnect automation fires this with the phone's location + the user's token.
// We find the nearest swept block, arm/refresh the watch on it, and send a confirmation push.
//
// Auth is the bearer token (minted by /api/enable-auto-park; only its hash is stored). Guardrails:
// rate-limit ≤1/min per token, reject coords outside the SF bbox, numbers-only Socrata query (no
// injection), and we NEVER persist the raw lat/lng — only the resolved block (one-spot privacy).
import webpush from 'web-push';
import { resolveToken, claimSlot, getSub, saveSub, deleteSub, storeReady } from './_store.js';
import { inSfBbox, polygonAround, pickParkedSpot } from './_geo.js';
import '../lib/sweep-core.js';
const { sfWallToInstant, fmtHour, DAYLBL } = globalThis;

const SWEEP = 'https://data.sfgov.org/resource/yhqp-riqs.json';
const RATE_MS = 60000; // ≤1 park per minute per token

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!storeReady()) { res.status(503).json({ error: 'store not configured' }); return; }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  try {
    const { token, lat, lng } = req.body || {};
    const rec = await resolveToken(token);
    if (!rec || !rec.endpoint) { res.status(401).json({ error: 'invalid token' }); return; }

    // Atomic ≤1/min claim BEFORE any work — TOCTOU-safe (no read-check-write race), and a valid-token
    // request with bad coords still consumes the slot, so it can't be spun to hammer Socrata.
    if (!(await claimSlot('park:' + token, RATE_MS))) { res.status(429).json({ error: 'rate limited' }); return; }

    const la = Number(lat), lo = Number(lng);
    if (!inSfBbox(la, lo)) { res.status(400).json({ error: 'coords outside SF' }); return; }

    // Nearest swept segments around the point — numbers-only POLYGON, fixed trusted host (no SSRF).
    const where = `intersects(line,'${polygonAround(la, lo, 60)}')`;
    const url = `${SWEEP}?$select=cnn,corridor,limits,blockside,cnnrightleft,weekday,fromhour,tohour,week1,week2,week3,week4,week5,holidays,line&$where=${encodeURIComponent(where)}&$limit=200`;
    let rows = [];
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'curb-parked' } });
      if (r.ok) rows = await r.json();
    } catch { /* fall through → no block found */ }

    const spot = pickParkedSpot(rows, la, lo);
    if (!spot) { res.status(200).json({ ok: false, note: 'no swept block found near you' }); return; }

    const sub = await getSub(rec.endpoint);
    if (!sub || !sub.subscription) { res.status(410).json({ error: 'subscription gone' }); return; }

    // Build + persist the watch (carries the recurring rule → forever-watch). saveSub stamps a fresh
    // savedAt (this IS live data) and resets de-dupe since it's a new sweep time.
    const ns = spot.ns;
    const prev = new Date(Date.UTC(ns.y, ns.mo - 1, ns.da) - 864e5);
    const eve = sfWallToInstant(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 20);
    const newSpot = {
      corridor: spot.corridor, limits: spot.limits, blockside: spot.blockside,
      nextSweepISO: ns.start.toISOString(), leadMinutes: 30,
      rule: spot.rule, cnn: spot.cnn, sideKey: spot.sideKey,
      ...(+eve < +ns.start ? { eveningISO: eve.toISOString() } : {}),
    };
    await saveSub(sub.subscription, newSpot);

    // Confirmation push (best-effort; prune a dead endpoint).
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const body = `${spot.corridor || 'This block'} — next sweep ${DAYLBL[ns.dow]} ${fmtHour(ns.fromH)}. Alerts armed.`;
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({ title: '🚗 Parked', body, url: '/', tag: 'curb-parked' }));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) await deleteSub(rec.endpoint);
      }
    }
    res.status(200).json({ ok: true, corridor: spot.corridor, nextSweepISO: newSpot.nextSweepISO });
  } catch (e) {
    console.error('parked failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
