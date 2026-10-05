// POST { token, platform:'ios', bundleId, spot } — store a native APNs device token + one saved spot.
// The native counterpart of save-subscription.js. The token is a hex APNs device token (NOT a
// web-push subscription), stored in the curb:apns hash; the spot is sanitized by the SAME shared
// sanitizeSpot as web push, so the cron sees an identical forever-watch shape, and lands on the watch for
// its curb side or a new one, up to MAX_WATCHES per device (409 past that).
// The shipped app (builds 6 and 7) builds the body itself but forwards the page's spot object untouched,
// so everything multi-watch needs rides in the spot: no app update.
// Turn alerts off: DELETE { token, spot? }, or — because the shipped app's bridge can only POST whatever
// spot the page hands it, and the page never learns the token — POST { token, spot: { off: true, cnn,
// sideKey, corridor, limits, blockside } }: the watch on that side, or every watch of the token when the
// spot names no side (a page from before multi-watch sends just { off: true }).
// Holding the token is the same bar as saving a watch for it.
import { saveIosSub, storeReady, claimSlot, hasIosSub, disarmIosSub, MAX_WATCHES } from './_store.js';
import { sanitizeSpot, sanitizeSide } from './_spot.js';

// APNs device tokens are hex strings — historically 64 chars, but Apple has said they may grow, so
// accept a generous length-bounded hex range rather than a hard 64.
const HEX_TOKEN = /^[0-9a-fA-F]{64,200}$/;
// A brand-new token per client IP at most this often (store-bloat guard; see below).
const NEW_TOKEN_MS = 10000;
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') { res.status(405).json({ error: 'POST or DELETE only' }); return; }
  try {
    const { token, bundleId, spot } = req.body || {};
    if (typeof token !== 'string' || !HEX_TOKEN.test(token)) {
      res.status(400).json({ error: 'invalid device token' }); return;
    }
    // Best-effort sanity check, not a security control: if the client sends a bundle id it must be
    // ours, to catch a stray token from another app — but registrations can omit it.
    const expected = process.env.APNS_BUNDLE_ID || 'guide.curb.ios';
    if (bundleId && bundleId !== expected) {
      res.status(400).json({ error: 'bundle mismatch' }); return;
    }
    const tok = token.toLowerCase();
    // Off is checked BEFORE sanitizeSpot ({off:true} has no sweep → would 400) and never throttled,
    // so "arm, then turn off right away" works. It disarms rather than deletes, keeping the de-dupe
    // so turning alerts back on for the same sweep can't re-send a push already delivered.
    if (req.method === 'DELETE' || (spot && spot.off === true)) {
      if (!storeReady()) { res.status(503).json({ error: 'store not configured' }); return; }
      await disarmIosSub(tok, sanitizeSide(spot));
      res.status(200).json({ ok: true, off: true });
      return;
    }
    const cleanSpot = sanitizeSpot(spot);
    if (!cleanSpot) { res.status(400).json({ error: 'invalid or missing spot' }); return; }
    if (!storeReady()) {
      res.status(503).json({ error: 'store not configured', note: 'set KV_REST_API_URL / KV_REST_API_TOKEN (Upstash) in your env' });
      return;
    }
    // Store-bloat guard for forged-but-valid-hex tokens: only a NEW token costs a record, so throttle
    // new tokens per client IP. Re-saving a known token (a new block, an Intensity/Voice change seconds
    // apart) is an idempotent overwrite and must never 429 — the old per-token 60 s throttle silently
    // dropped those, leaving the old block/level armed. claimSlot hashes its key; true in dev.
    if (!(await hasIosSub(tok)) && !(await claimSlot('iosnew:' + clientIp(req), NEW_TOKEN_MS))) {
      res.status(429).json({ error: 'slow down' }); return;
    }
    const saved = await saveIosSub(tok, cleanSpot);
    // the app hands `error` to the page as the message (save-failed, status 409)
    if (saved.full) { res.status(409).json({ error: 'alert limit reached', max: MAX_WATCHES }); return; }
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    console.error('save-ios-subscription failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
