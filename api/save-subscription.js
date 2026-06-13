// POST { subscription, spot } — store a Web Push subscription + the saved spot.
// spot = { corridor, limits, blockside, nextSweepISO, leadMinutes, eveningISO?, rule?, cnn?, sideKey? }
import { saveSub, ensureOwnerProof, storeReady } from './_store.js';
// Side-effect import: attaches the SF time core (normDay/nextSweep/…) to globalThis so we can
// validate an incoming recurrence rule with the EXACT guards the cron's nextSweep() uses.
import '../lib/sweep-core.js';
const normDay = globalThis.normDay;

// A recurring sweep rule the cron can recompute the next occurrence from (the "forever-watch").
// Validated with nextSweep's own guards (weekday must normalize, fromhour must parse) — anything
// off returns null and the sub degrades to a pure one-shot. latlng is NEVER accepted (privacy:
// precise coords stay client-only in localStorage).
function sanitizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  if (normDay(rule.weekday) === null) return null;
  const fromH = parseInt(rule.fromhour, 10);
  if (Number.isNaN(fromH)) return null;
  const bit = (v) => (String(v) === '1' ? '1' : '0');
  return {
    // store a canonical 3-char label (never arbitrary client text); guard above ensures a valid index
    weekday: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][normDay(rule.weekday)],
    fromhour: String(fromH),
    tohour: String(parseInt(rule.tohour, 10) || fromH + 1),
    week1: bit(rule.week1), week2: bit(rule.week2), week3: bit(rule.week3),
    week4: bit(rule.week4), week5: bit(rule.week5),
    holidays: bit(rule.holidays),
  };
}

// Known browser push services. Endpoints are always https on one of these hosts.
const PUSH_HOST = /(\.googleapis\.com|\.push\.services\.mozilla\.com|\.notify\.windows\.com|\.push\.apple\.com)$/i;

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

// Coerce/clamp the untrusted spot into the exact shape the cron expects, or null if unusable.
function sanitizeSpot(spot) {
  if (!spot || typeof spot !== 'object') return null;
  const t = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ts = Date.parse(spot.nextSweepISO);
  if (!Number.isFinite(ts)) return null; // no valid sweep time => nothing for the cron to fire on
  let lead = Number(spot.leadMinutes);
  if (!Number.isFinite(lead)) lead = 30;
  lead = Math.min(180, Math.max(1, Math.round(lead)));
  // optional night-before push: must parse and precede the sweep itself
  const ev = Date.parse(spot.eveningISO);
  const out = {
    corridor: t(spot.corridor, 120),
    limits: t(spot.limits, 120),
    blockside: t(spot.blockside, 60),
    nextSweepISO: new Date(ts).toISOString(),
    leadMinutes: lead,
  };
  if (Number.isFinite(ev) && ev < ts) out.eveningISO = new Date(ev).toISOString();
  const rule = sanitizeRule(spot.rule);
  if (rule) {
    out.rule = rule;
    out.cnn = String(spot.cnn || '').replace(/[^0-9]/g, '').slice(0, 12);
    out.sideKey = t(spot.sideKey, 8);
  }
  return out;
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
