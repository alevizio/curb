// POST { token, platform:'ios', bundleId, spot } — store a native APNs device token + saved spot.
// The native counterpart of save-subscription.js. The token is a hex APNs device token (NOT a
// web-push subscription), stored in the curb:apns hash; the spot is sanitized by the SAME shared
// sanitizeSpot as web push, so the cron sees an identical forever-watch shape.
import { saveIosSub, storeReady, claimSlot } from './_store.js';
import { sanitizeSpot } from './_spot.js';

// APNs device tokens are hex strings — historically 64 chars, but Apple has said they may grow, so
// accept a generous length-bounded hex range rather than a hard 64.
const HEX_TOKEN = /^[0-9a-fA-F]{64,200}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
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
    const cleanSpot = sanitizeSpot(spot);
    if (!cleanSpot) { res.status(400).json({ error: 'invalid or missing spot' }); return; }
    if (!storeReady()) {
      res.status(503).json({ error: 'store not configured', note: 'set KV_REST_API_URL / KV_REST_API_TOKEN (Upstash) in your env' });
      return;
    }
    // Atomic per-token throttle: a real device registers ~once, so cap re-registration to ~1/min to
    // bound store bloat + APNs fan-out from forged-but-valid-hex tokens. claimSlot hashes the token
    // into its key (never stored raw) and returns true in dev (no store), so the happy path stays green.
    if (!(await claimSlot('iossub:' + token.toLowerCase(), 60000))) {
      res.status(429).json({ error: 'slow down' }); return;
    }
    await saveIosSub(token.toLowerCase(), cleanSpot);
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    console.error('save-ios-subscription failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
