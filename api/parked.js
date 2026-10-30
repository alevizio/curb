// POST { token, lat, lng } — the iOS-Shortcuts auto-park endpoint (ALE-168 Tier 2).
// A car-Bluetooth-disconnect automation fires this with the phone's location + the user's token.
// We find the nearest swept block, arm/refresh the watch on it, and send a confirmation push.
//
// Auth is the bearer token (minted by /api/enable-auto-park; only its hash is stored). Guardrails:
// rate-limit ≤1/min per token, reject coords outside the SF bbox, numbers-only Socrata query (no
// injection), and we NEVER persist the raw lat/lng — only the resolved block (one-spot privacy).
import webpush from 'web-push';
import { resolveToken, claimSlot, getSub, saveSub, deleteSub, storeReady, MAX_WATCHES } from './_store.js';
import { inSfBbox } from './_geo.js';
import { parkedWatchAt } from './_park.js';

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

    // Nearest swept block around the point (api/_park.js), as the watch to arm.
    const found = await parkedWatchAt(la, lo);
    if (!found) { res.status(200).json({ ok: false, note: 'no swept block found near you' }); return; }

    const sub = await getSub(rec.endpoint);
    if (!sub || !sub.subscription) { res.status(410).json({ error: 'subscription gone' }); return; }

    // Persist the watch (carries the recurring rule → forever-watch). saveSub stamps a fresh
    // savedAt (this IS live data); its de-dupe entries name the sweep they fired for, so a new sweep fires.
    // atBase: the car's watch (tagged car:true, else the slot a page save would get) follows the car, as
    // the single watch did before multi-watch (a new watch per park would pile up and keep alerting for
    // every spot the car has left); a watch the user set on that same side is turned off so it doesn't push
    // twice. Other watches are left alone, so with 5 sides already armed there is no room: say so.
    const newSpot = found.watch;
    const saved = await saveSub(sub.subscription, newSpot, { atBase: true });
    if (saved.full) { res.status(409).json({ ok: false, error: 'alert limit reached', max: MAX_WATCHES }); return; }

    // Confirmation push (best-effort; prune a dead endpoint).
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      try {
        // an immediate confirmation: worthless (and names a stale spot) if delivered hours later
        await webpush.sendNotification(sub.subscription, JSON.stringify({ title: '🚗 Parked', body: found.body, url: '/', tag: 'curb-parked' }), { TTL: 3600 });
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) await deleteSub(rec.endpoint);
      }
    }
    res.status(200).json({ ok: true, corridor: found.spot.corridor, nextSweepISO: newSpot.nextSweepISO });
  } catch (e) {
    console.error('parked failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
