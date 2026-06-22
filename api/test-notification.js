// POST /api/test-notification — the user-facing "send me a test" path. Delivers ONE (or all three)
// real CURB push(es) to the CALLER'S OWN device, at a chosen level + voice, so you can feel the
// cadence and read the copy on your lock screen without waiting for a real sweep.
//
// Security model: you can only ever target your OWN web-push subscription or APNs token (which you
// already possess), so the worst anyone can do is spam themselves — no auth needed beyond a short
// per-identity rate cap. Copy is rendered by the SAME pure lib/notify-core.js the cron uses, so a
// test is byte-identical to the real thing.
//
// ?dryRun=1  -> returns the rendered payloads WITHOUT sending (QA: inspect copy end-to-end, no device).
// Body: { which?: 'eve'|'morn'|'lead'|'all', level?, voice?, spot?, subscription? | token? }
import webpush from 'web-push';
import { renderOne, normLevel, normVoice, LEVELS } from '../lib/notify-core.js';
import { apnsConfigured, getProviderToken, openSession, sendOne, altHost } from './_apns.js';
import { claimSlot } from './_store.js';

const HEX_TOKEN = /^[0-9a-fA-F]{64,200}$/;
// Same push-service allowlist as save-subscription.js — without it the web-push branch is an SSRF
// (it would POST to any https URL the caller hands us). A real subscription is always one of these.
const PUSH_HOST = /(\.googleapis\.com|\.push\.services\.mozilla\.com|\.notify\.windows\.com|\.push\.apple\.com)$/i;
function validWebSub(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1024) return false;
  let u; try { u = new URL(s.endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || !PUSH_HOST.test(u.hostname)) return false;
  return Boolean(s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string');
}
const WHICH = ['eve', 'morn', 'lead', 'all'];
// Distinct tags so a test never collapses/replaces a genuinely-armed alert's pending notification.
const testTag = (key) => 'curb-test-' + key;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  try {
    const body = req.body || {};
    const dryRun = Boolean(req.query?.dryRun ?? body.dryRun);
    const level = normLevel(body.level);
    const voice = normVoice(body.voice);
    const which = WHICH.includes(body.which) ? body.which : 'lead';

    // A demo sweep 30 min out, carrying the caller's real block context (name/side/ticket-time) so the
    // copy reads naturally. renderOne only needs nextSweepISO + corridor/tip — not the eve/morn anchors.
    const real = (body.spot && typeof body.spot === 'object') ? body.spot : {};
    const spot = {
      corridor: String(real.corridor || '').slice(0, 120) || 'Your block',
      blockside: String(real.blockside || '').slice(0, 60),
      tip: String(real.tip || '').replace(/[^0-9apmAPM:.\s~-]/g, '').trim().slice(0, 14),
      nextSweepISO: new Date(Date.now() + 30 * 60000).toISOString(),
      level, voice,
    };
    // "all" replays the caller's ACTUAL cadence for their chosen level (Light=1, Normal=2, Intense=3).
    const plan = (which === 'all' ? LEVELS[level].touchpoints : [which]).map((tp) => {
      const mins = tp === 'lead' ? 30 : tp === 'morn' ? 120 : undefined;
      const r = renderOne(spot, tp, { level, voice, mins });
      return { key: r.key, tag: testTag(r.key), title: r.title, body: r.body };
    });

    if (dryRun) { res.status(200).json({ ok: true, dryRun: true, level, voice, which, plan }); return; }

    // ---- deliver to the caller's own device ----
    const token = typeof body.token === 'string' ? body.token.toLowerCase() : '';
    const sub = body.subscription;

    if (HEX_TOKEN.test(token)) {
      if (!(await claimSlot('testpush:' + token, 8000))) { res.status(429).json({ error: 'slow down' }); return; }
      if (!apnsConfigured()) { res.status(400).json({ error: 'APNs not configured' }); return; }
      const results = await sendApns(token, plan);
      res.status(200).json({ ok: results.every((r) => r.status === 200), transport: 'apns', results });
      return;
    }
    if (validWebSub(sub)) {
      if (!(await claimSlot('testpush:' + sub.endpoint, 8000))) { res.status(429).json({ error: 'slow down' }); return; }
      const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
      if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) { res.status(500).json({ error: 'VAPID keys not set' }); return; }
      webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const results = [];
      for (const p of plan) {
        try {
          await webpush.sendNotification(sub, JSON.stringify({ title: p.title, body: p.body, url: '/', tag: p.tag }));
          results.push({ key: p.key, ok: true });
        } catch (e) {
          results.push({ key: p.key, ok: false, status: e.statusCode || 0 });
        }
      }
      res.status(200).json({ ok: results.every((r) => r.ok), transport: 'webpush', results });
      return;
    }
    res.status(400).json({ error: 'provide a web-push subscription or an iOS token (or use ?dryRun=1)' });
  } catch (e) {
    console.error('test-notification failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}

// One APNs http2 session for the (1–3) test pushes; cross-host retry once on a token-environment
// mismatch (sandbox vs production), exactly like the cron. A test alert has no real deadline.
async function sendApns(token, plan) {
  const jwt = getProviderToken();
  const session = openSession();
  let alt = null;
  const results = [];
  const exp = Math.floor(Date.now() / 1000) + 300;
  try {
    for (const p of plan) {
      const aps = { aps: { alert: { title: p.title, body: p.body }, sound: 'default', 'thread-id': p.tag }, url: '/', tag: p.tag };
      let { status, reason } = await sendOne(session, jwt, token, aps, p.tag, exp);
      if (status === 410 || (status === 400 && /BadDeviceToken|Unregistered/i.test(reason))) {
        if (!alt) alt = openSession(altHost());
        ({ status, reason } = await sendOne(alt, jwt, token, aps, p.tag, exp));
      }
      results.push({ key: p.key, status, reason });
    }
  } finally {
    try { session.close(); } catch { /* already closed */ }
    try { if (alt) alt.close(); } catch { /* already closed */ }
  }
  return results;
}
