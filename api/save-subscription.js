// POST { subscription, spot } — store a Web Push subscription + the saved spot.
// spot = { corridor, limits, blockside, nextSweepISO, leadMinutes }
import { saveSub, storeReady } from './_store.js';

// Known browser push services. Endpoints are always https on one of these hosts.
const PUSH_HOST = /(\.googleapis\.com|\.push\.services\.mozilla\.com|\.notify\.windows\.com|\.push\.apple\.com)$/i;

function validSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1024) return false;
  let u; try { u = new URL(s.endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || !PUSH_HOST.test(u.hostname)) return false;
  if (s.keys != null) {
    const { p256dh, auth } = s.keys;
    if (typeof p256dh !== 'string' || typeof auth !== 'string') return false;
    if (p256dh.length > 256 || auth.length > 256) return false;
  }
  return true;
}

// Coerce/clamp the untrusted spot into the exact shape the cron expects, or null if unusable.
function sanitizeSpot(spot) {
  if (!spot || typeof spot !== 'object') return null;
  const t = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ts = Date.parse(spot.nextSweepISO);
  if (!Number.isFinite(ts)) return null; // no valid sweep time => nothing for the cron to fire on
  let lead = Number(spot.leadMinutes);
  if (!Number.isFinite(lead)) lead = 30;
  lead = Math.min(180, Math.max(1, Math.round(lead)));
  return {
    corridor: t(spot.corridor, 120),
    limits: t(spot.limits, 120),
    blockside: t(spot.blockside, 60),
    nextSweepISO: new Date(ts).toISOString(),
    leadMinutes: lead,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  try {
    const { subscription, spot } = req.body || {};
    if (!validSubscription(subscription)) { res.status(400).json({ error: 'invalid subscription' }); return; }
    const cleanSpot = sanitizeSpot(spot);
    if (!cleanSpot) { res.status(400).json({ error: 'invalid or missing spot' }); return; }
    if (!storeReady()) {
      res.status(503).json({ error: 'store not configured', note: 'set KV_REST_API_URL / KV_REST_API_TOKEN (Upstash) in your env' });
      return;
    }
    await saveSub(subscription, cleanSpot);
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    console.error('save-subscription failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
