// POST { subscription, spot } — store a Web Push subscription + the saved spot.
// spot = { corridor, limits, blockside, nextSweepISO, leadMinutes, eveningISO?, rule?, rules?, cnn?, sideKey? }
// DELETE { subscription } — turn that subscription's alerts off (proven by its endpoint + keys.auth).
import { saveSub, ensureOwnerProof, storeReady, disarmSub, claimSlot, hasSub } from './_store.js';
// Spot/rule sanitizers live in a shared module (also used by save-ios-subscription) so web push and
// native APNs validate the forever-watch rule identically.
import { sanitizeSpot } from './_spot.js';

// Known browser push services. Endpoints are always https on one of these hosts.
const PUSH_HOST = /(\.googleapis\.com|\.push\.services\.mozilla\.com|\.notify\.windows\.com|\.push\.apple\.com)$/i;
// A brand-new endpoint per client IP at most this often (same guard as save-ios-subscription; see below).
const NEW_SUB_MS = 10000;
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

function validSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1024) return false;
  let u; try { u = new URL(s.endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || !PUSH_HOST.test(u.hostname)) return false;
  // keys are REQUIRED (web-push needs them, and a keyless record can't be ownership-proved later)
  const k = s.keys;
  if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return false;
  if (k.p256dh.length > 256 || k.auth.length > 256) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    try {
      const { subscription } = req.body || {};
      if (!validSubscription(subscription)) { res.status(400).json({ error: 'invalid subscription' }); return; }
      if (!storeReady()) { res.status(503).json({ error: 'store not configured' }); return; }
      const r = await disarmSub(subscription.endpoint, subscription.keys.auth);
      if (r === 'not-found') { res.status(404).json({ error: 'no alerts for this subscription' }); return; }
      if (r === 'forbidden') { res.status(403).json({ error: 'not your subscription' }); return; }
      res.status(200).json({ ok: true, off: true });
    } catch (e) {
      console.error('save-subscription delete failed:', e);
      res.status(500).json({ error: 'internal error' });
    }
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST or DELETE only' }); return; }
  try {
    const { subscription, spot } = req.body || {};
    if (!validSubscription(subscription)) { res.status(400).json({ error: 'invalid subscription' }); return; }
    const cleanSpot = sanitizeSpot(spot);
    if (!cleanSpot) { res.status(400).json({ error: 'invalid or missing spot' }); return; }
    if (!storeReady()) {
      res.status(503).json({ error: 'store not configured', note: 'set KV_REST_API_URL / KV_REST_API_TOKEN (Upstash) in your env' });
      return;
    }
    // Flood guard: every stored endpoint costs the sender a push request per due tick, one at a time, so
    // a script posting thousands of fake (but well-formed) endpoints could push each run past its 60 s
    // limit and drop the real alerts after them. Only a NEW endpoint costs a record, so throttle those
    // per client IP; re-saving a known endpoint (a block switch, an Intensity/Voice change, the daily
    // refresh) is an overwrite and must always land. claimSlot hashes its key; true in dev.
    if (!(await hasSub(subscription.endpoint)) && !(await claimSlot('webnew:' + clientIp(req), NEW_SUB_MS))) {
      res.status(429).json({ error: 'slow down' }); return;
    }
    await saveSub(subscription, cleanSpot);
    // Mint the auto-park ownership proof on first save; return the plaintext exactly once so the
    // client can stash it for /api/enable-auto-park. Decoupled from keys.auth (which the cron must
    // keep in plaintext to send pushes), so a store read-leak can't forge it.
    const ownerProof = await ensureOwnerProof(subscription.endpoint);
    res.status(200).json({ ok: true, stored: true, ...(ownerProof ? { ownerProof } : {}) });
  } catch (e) {
    console.error('save-subscription failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
