// POST { token, lat, lng } — the iPhone app's Save Parking Spot: an App Intent that a Shortcuts automation runs when the
// car's CarPlay or Bluetooth disconnects. POST { token, clear: true } — Clear Parking Spot, run when it connects again
// (the car drives off).
// The native twin of parked.js: the same block pick (api/_park.js) and the car's own watch (parkIosCar), on the device's
// APNs token in curb:apns, so the sender's iOS loop alerts for it like any other watch. The app shows the confirmation
// itself, a local notification built from the title, body and url below, so nothing is pushed from here.
// Holding the token is the same bar as saving a watch for it (save-ios-subscription.js). Guardrails as in parked.js: one
// park a minute per token, claimed before any work; a brand-new token at most every 10 s per client IP; SF only; and the
// raw lat/lng are never stored, only the block they resolve to.
import { parkIosCar, disarmIosCar, hasIosSub, claimSlot, storeReady, MAX_WATCHES } from './_store.js';
import { inSfBbox } from './_geo.js';
import { parkedWatchAt } from './_park.js';
import { sanitizeSpot } from './_spot.js';
import { cityOf } from '../lib/cities.js';
import '../lib/sweep-core.js';
const { alertAnchors } = globalThis;

const HEX_TOKEN = /^[0-9a-fA-F]{64,200}$/;
const RATE_MS = 60000;      // ≤1 park a minute per token (each one asks DataSF)
const CLEAR_MS = 5000;      // a clear is one store write
const NEW_TOKEN_MS = 10000; // a token with no record yet costs one: per client IP, as save-ios-subscription.js
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!storeReady()) { res.status(503).json({ error: 'store not configured' }); return; }
  try {
    const { token, lat, lng, clear, level, voice } = req.body || {};
    if (typeof token !== 'string' || !HEX_TOKEN.test(token)) { res.status(400).json({ error: 'invalid device token' }); return; }
    const tok = token.toLowerCase();

    if (clear === true) {
      if (!(await claimSlot('unpark:' + tok, CLEAR_MS))) { res.status(429).json({ error: 'slow down' }); return; }
      res.status(200).json({ ok: true, cleared: await disarmIosCar(tok) });
      return;
    }

    if (!(await hasIosSub(tok)) && !(await claimSlot('iosnew:' + clientIp(req), NEW_TOKEN_MS))) {
      res.status(429).json({ error: 'slow down' }); return;
    }
    // Claimed before the coords are read: a bad request still spends the minute, so it can't be spun to hammer DataSF.
    if (!(await claimSlot('park:' + tok, RATE_MS))) { res.status(429).json({ error: 'rate limited' }); return; }

    const la = Number(lat), lo = Number(lng);
    if (!inSfBbox(la, lo)) { res.status(400).json({ error: 'outside SF' }); return; }

    const found = await parkedWatchAt(la, lo);
    if (!found) { res.status(200).json({ ok: false, error: 'no swept block found' }); return; }

    // The watch a sheet would save for this side (index.html alertSpotFor): the user's Intensity and Voice, which the app
    // passes on from the page, and the night-before and morning anchors by the same rule (none for a night sweep, none
    // already past). sanitizeSpot gives it the exact shape every other watch has.
    const start = Date.parse(found.watch.nextSweepISO), a = alertAnchors(start), soon = Date.now() + 6e5;
    const w = sanitizeSpot({
      ...found.watch, eveningISO: undefined, level, voice,
      ...(!a.night && +a.eve > soon && +a.eve < start ? { eveningISO: a.eve.toISOString() } : {}),
      ...(!a.night && a.morn && +a.morn > soon ? { morningISO: a.morn.toISOString() } : {}),
    });
    const saved = await parkIosCar(tok, w);
    if (saved.full) { res.status(409).json({ ok: false, error: 'alert limit reached', max: MAX_WATCHES }); return; }

    res.status(200).json({
      ok: true,
      covered: Boolean(saved.covered),
      title: '🚗 Parked',
      body: saved.covered ? found.line + ' Your alerts are already on here.' : found.body,
      // the block's page, naming the side (letters only, as the alerts' own deep link)
      url: cityOf(w).blockLink(w.cnn, /^[A-Za-z]{1,12}$/.test(w.blockside || '') ? w.blockside : ''),
      spot: { corridor: w.corridor, limits: w.limits, blockside: w.blockside, cnn: w.cnn, sideKey: w.sideKey, nextSweepISO: w.nextSweepISO },
    });
  } catch (e) {
    console.error('parked-ios failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
