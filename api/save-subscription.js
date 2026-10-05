// POST { subscription, spot } — store a Web Push subscription + one saved spot: the watch on that curb side
// (updated in place) or a new one, up to MAX_WATCHES per device (409 past that).
// spot = { corridor, limits, blockside, nextSweepISO, leadMinutes, eveningISO?, rule?, rules?, cnn?, sideKey?, multi? }
// `multi: 1` = a page that knows about multi-watch. A spot without it comes from a page loaded before (an
// open tab, a cached navigation) and MOVES the alerts to its curb, as that page tells the user (saveSub legacy).
// DELETE { subscription, spot? } — turn alerts off (proven by its endpoint + keys.auth): the watch on the
// side `spot` names, or every watch of the subscription when it names none (a page from before multi-watch).
import { saveSub, ensureOwnerProof, storeReady, disarmSub, claimSlot, hasSub, MAX_WATCHES } from './_store.js';
// Spot/rule sanitizers live in a shared module (also used by save-ios-subscription) so web push and
// native APNs validate the forever-watch rule identically.
import { sanitizeSpot, sanitizeSide } from './_spot.js';

// Known browser push services. Endpoints are always https on one of these hosts.
const PUSH_HOST = /(\.googleapis\.com|\.push\.services\.mozilla\.com|\.notify\.windows\.com|\.push\.apple\.com)$/i;
// A brand-new endpoint per client IP at most this often (same guard as save-ios-subscription; see below).
const NEW_SUB_MS = 10000;
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

function validSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1024) return false;
  // '#' separates a device from its watch number in the store (`<endpoint>#2`); no push service uses one
  if (s.endpoint.includes('#')) return false;
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
      const { subscription, spot } = req.body || {};
      if (!validSubscription(subscription)) { res.status(400).json({ error: 'invalid subscription' }); return; }
      if (!storeReady()) { res.status(503).json({ error: 'store not configured' }); return; }
      const r = await disarmSub(subscription.endpoint, subscription.keys.auth, sanitizeSide(spot));
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
    // the marker is read from the raw spot (sanitizeSpot drops it): none = a page from before multi-watch
    const saved = await saveSub(subscription, cleanSpot, { legacy: Number(spot.multi) !== 1 });
    // MAX_WATCHES armed on other sides: the page says how to free one (it normally knows before asking)
    if (saved.full) { res.status(409).json({ error: 'alert limit reached', max: MAX_WATCHES }); return; }
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
