// Sweep-alert sender: fires a push for any saved spot with a touchpoint due now (web push + APNs).
// Generate keys: npx web-push generate-vapid-keys
//
// Triggers (vercel.json has no cron — Vercel Hobby runs crons ~once a day):
//  - PRIMARY: an Upstash QStash schedule POSTs here every 15 min, signed with an Upstash-Signature JWT
//    that is verified below against the raw body and SELF_URL. QStash never holds CRON_SECRET.
//  - BACKUP: .github/workflows/sweep-alerts-cron.yml GETs with `Authorization: Bearer CRON_SECRET`.
//    GitHub schedules are best-effort (Sep 2026: ~7 runs/day, not 96), so it only fills gaps.
// Overlapping runs are safe: the run lock + per-sweep de-dupe below.
//  - GET ?status=1 (Bearer only) returns the last run's time/outcome/trigger for the monitor, plus the
//    last QStash-triggered run (lastQstash {at, ok, error?}) and last successful one (lastQstashOk {at});
//    no sends.
//  - HC_PING_URL (optional healthchecks.io check): pinged on successful QStash runs, /fail on errors,
//    so a dead primary scheduler emails the owner even while the GitHub backup limps along.
import webpush from 'web-push';
import { Receiver } from '@upstash/qstash';
import {
  loadAllSubs, deleteSub, markNotified, advanceSpot, storeReady,
  loadAllIosSubs, deleteIosSub, markIosNotified, advanceIosSpot, claimSlot, releaseSlot,
  saveRunStatus, loadRunStatus,
} from './_store.js';
import { recomputeSpot } from './_schedule.js';
import { apnsConfigured, getProviderToken, resetProviderToken, openSession, sendOne, primaryHost, altHost } from './_apns.js';
import { dueAlert } from '../lib/notify-core.js';

// A forever-watch stops auto-advancing once it hasn't been refreshed (by reopening the app with
// live data) for this long — bounds wrong-time pushes if the city changes a block's schedule.
const MAX_WATCH_AGE = 120 * 864e5; // ~120 days
// The run lock's lifetime: longer than the 60 s maxDuration (vercel.json), so it outlives any run.
const RUN_LOCK_MS = 120000;

// The cadence brain — which push is due for a spot right now, with what copy, at the user's chosen
// intensity + voice — lives in lib/notify-core.js. It's a pure, unit-tested module shared by BOTH
// transports here AND the /api/test-notification preview endpoint, so they can never diverge.
// dueAlert(spot, notifiedMap, now) -> { key, tag, title, body } | null.

// A notification tap opens the specific block when we know its cnn, else the map.
const deepLink = (spot) => (spot && spot.cnn ? '/b/' + spot.cnn : '/');

// The QStash JWT's `sub` claim is the schedule's destination URL; the schedule must target exactly this
// (no query string), so a signed request can never reach ?test / ?status.
const SELF_URL = 'https://curb.guide/api/send-notifications';

// The QStash signature covers a hash of the exact request bytes, so Vercel must not parse the body
// (documented for plain Node functions). Nothing here reads a parsed body.
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;           // body parser ran anyway (text)
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

/** 'qstash' (valid Upstash-Signature) | 'bearer' (CRON_SECRET) | null. */
async function authenticate(req) {
  const sig = req.headers['upstash-signature'];
  if (sig) {
    const { QSTASH_CURRENT_SIGNING_KEY: cur, QSTASH_NEXT_SIGNING_KEY: next } = process.env;
    if (!cur || !next) return null;
    try {
      // devMode:false — a stray QSTASH_DEV env must never swap in Upstash's public dev keys.
      await new Receiver({ currentSigningKey: cur, nextSigningKey: next, devMode: false })
        .verify({ signature: String(sig), body: await rawBody(req), url: SELF_URL });
      return 'qstash';
    } catch { return null; }
  }
  const secret = process.env.CRON_SECRET;
  return secret && (req.headers.authorization || '') === `Bearer ${secret}` ? 'bearer' : null;
}

/** healthchecks.io: success only for QStash runs (the sparse GitHub backup must not mask a dead
 *  primary), /fail for an erroring run from either trigger. Best effort, never throws. */
async function pingHealth(trigger, outcome) {
  const url = process.env.HC_PING_URL;
  if (!url || outcome === 'skipped' || (outcome === 'ok' && trigger !== 'qstash')) return;
  try { await fetch(outcome === 'ok' ? url : url + '/fail', { signal: AbortSignal.timeout(5000) }); } catch { /* ignored */ }
}

export default async function handler(req, res) {
  // Required: this endpoint dispatches pushes + spends store/web-push quota, so it must not run
  // unauthenticated — a QStash signature or the CRON_SECRET bearer, nothing else.
  if (!process.env.CRON_SECRET && !(process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)) {
    res.status(503).json({ error: 'neither CRON_SECRET nor QSTASH_*_SIGNING_KEY set — refusing to run unauthenticated' }); return;
  }
  const trigger = await authenticate(req);
  if (!trigger) { res.status(401).json({ error: 'unauthorized' }); return; }
  const test = req.query?.test || '';
  const statusMode = req.query?.status || '';
  // ?test pushes to every iOS device and ?status reads the run log: CRON_SECRET holders only.
  if ((test || statusMode) && trigger !== 'bearer') { res.status(403).json({ error: 'forbidden' }); return; }

  // Read-only status for the monitor: when the sender last ran, how it went, who triggered it.
  if (statusMode) {
    if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
    if (!storeReady()) { res.status(500).json({ error: 'store not configured' }); return; }
    res.status(200).json({ ok: true, now: new Date().toISOString(), ...(await loadRunStatus()) });
    return;
  }

  // Authed delivery test: ?test=ios sends a one-off push to every registered iOS token, bypassing
  // the due-window logic (and never touching spot/dedupe state) — to confirm end-to-end APNs
  // delivery on demand. Uses the same cross-host retry as the real loop.
  if (test === 'ios') {
    if (!storeReady()) { res.status(500).json({ error: 'store not configured' }); return; }
    if (!apnsConfigured()) { res.status(400).json({ error: 'APNs not configured' }); return; }
    const tokens = await loadAllIosSubs();
    const results = [];
    if (tokens.length) {
      let session, alt = null;
      try {
        const jwt = getProviderToken();
        session = openSession();
        const aps = { aps: { alert: { title: 'CURB test ✅', body: 'Native push is working — you can move your car with confidence.' }, sound: 'default' }, url: '/', tag: 'curb-test' };
        const testExp = Math.floor(Date.now() / 1000) + 300; // a test alert has no real deadline — let APNs drop it after 5 min if undeliverable
        for (const { token } of tokens) {
          let { status, reason } = await sendOne(session, jwt, token, aps, 'curb-test', testExp);
          if (status === 410 || (status === 400 && /BadDeviceToken|Unregistered/i.test(reason))) {
            if (!alt) alt = openSession(altHost());
            ({ status, reason } = await sendOne(alt, jwt, token, aps, 'curb-test', testExp));
          }
          results.push({ status, reason });
        }
      } catch (e) {
        res.status(200).json({ ok: false, test: 'ios', tokens: tokens.length, error: e.message || String(e) }); return;
      } finally {
        try { session && session.close(); } catch {}
        try { alt && alt.close(); } catch {}
      }
    }
    res.status(200).json({ ok: true, test: 'ios', tokens: tokens.length, results });
    return;
  }

  // Every real run is recorded (for ?status=1) and reported to healthchecks before responding.
  const started = Date.now();
  const finish = async (code, body, detail) => {
    const outcome = code !== 200 ? 'error' : body.skipped ? 'skipped' : 'ok';
    try {
      await saveRunStatus({ at: new Date(started).toISOString(), trigger, outcome, ms: Date.now() - started,
        ...(body.web ? { web: body.web, ios: body.ios } : {}), ...(body.error ? { error: detail || body.error } : {}) });
    } catch { /* a status write must never fail the run */ }
    await pingHealth(trigger, outcome);
    res.status(code).json(body);
  };

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    await finish(500, { error: 'VAPID keys not set (see .env.example)' }); return;
  }
  if (!storeReady()) {
    await finish(500, { error: 'store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)' }); return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Run-level lock: two schedulers drive this endpoint (QStash AND the GitHub backup), so two
  // invocations can overlap. The per-sweep markNotified dedupe is a non-atomic read-modify-write, so
  // overlapping runs could both pass it and double-fire. A short atomic claim (longer than the 60s
  // maxDuration) lets at most one run process a given ~2-min window; a skipped run is a harmless no-op.
  // Released as soon as a run has fully succeeded (every markNotified landed), so a GitHub run a minute
  // before a QStash tick no longer swallows that tick and delays its pushes by 15 min.
  // Deliberately NOT released on error: a retry would then re-send any push whose markNotified failed.
  // No-op in dev (no store).
  if (!(await claimSlot('cron-run', RUN_LOCK_MS))) {
    await finish(200, { ok: true, skipped: 'another run holds the lock' }); return;
  }

  try {
    const now = Date.now();
    let sent = 0, pruned = 0, rearmed = 0;
    let iosSent = 0, iosPruned = 0, iosRearmed = 0;

    // ---- Web Push ----
    const subs = await loadAllSubs();
    for (const { endpoint, subscription, spot, notified, savedAt } of subs) {
      if (!spot || !spot.nextSweepISO) continue;
      // Forever-watch re-arm: advance to the next occurrence once the window ends (its OWN pass —
      // never coupled to the lead push, which still returns the same instant at lead time). Stops
      // while stale (MAX_WATCH_AGE) so a frozen rule can't track a city schedule change. The
      // advanced occurrence is in the future, so nothing pushes this tick → continue. Skipped when the
      // user turned the watch off or re-saved it since the snapshot (advanceSpot re-reads it).
      if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
        const advanced = recomputeSpot(spot);
        if (advanced) { if (await advanceSpot(endpoint, advanced, spot)) rearmed++; continue; }
      }
      const due = dueAlert(spot, notified, now);
      if (!due) continue;
      const payload = JSON.stringify({ title: due.title, body: due.body, url: deepLink(spot), tag: due.tag, requireInteraction: due.urgent });
      // Bounded TTL (web-push's default is 4 weeks: an offline phone would get "move your car" days
      // late) + high urgency for act-now pushes (Android Doze holds normal ones). No Topic header:
      // Apple's web push service rejects it, which would silently drop every Safari/iOS PWA alert.
      const opts = { TTL: Math.max(60, Math.floor((due.expiresAt - Date.now()) / 1000)), urgency: due.urgent ? 'high' : 'normal' };
      let delivered = false;
      try {
        await webpush.sendNotification(subscription, payload, opts);
        delivered = true; sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) { await deleteSub(endpoint); pruned++; }
        else console.error('web push failed:', err.statusCode || 0, String(err.body || err.message || '').slice(0, 200));
      }
      // De-dupe write lives OUTSIDE the send try/catch: a transient store error here must not be
      // mistaken for a send failure (which would let the next 15-min tick re-push the same sweep).
      if (delivered) await markNotified(endpoint, spot.nextSweepISO, due.key);
    }

    // ---- Native APNs (iOS) ---- identical windows / dedupe / re-arm, different transport. Skipped
    // entirely until the APNS_* env vars are set, so the web-push path is unaffected before then.
    // Always load so `checked` reflects how many iOS watches actually exist (independent of whether
    // the APNs key is present) — this disambiguates "no device registered" from "key not loaded".
    const iosConfigured = apnsConfigured();
    const iosSubs = await loadAllIosSubs();
    let iosError = null; // isolate APNs failures so they can't 500 the cron or block web push
    if (iosConfigured && iosSubs.length) try {
      let jwt = getProviderToken(); // throws on a malformed .p8 — caught below, not fatal
      let jwtReset = false; // re-mint the provider JWT at most once per run on a 403 ExpiredProviderToken
      const session = openSession(); // ONE http2 session on the primary host; closed in finally
      let altSession = null; // opened lazily only if a token mismatches the primary environment
      const isBadToken = (s, r) => s === 410 || (s === 400 && /BadDeviceToken|Unregistered/i.test(r));
      try {
        for (const { token, spot, notified, savedAt } of iosSubs) {
          if (!spot || !spot.nextSweepISO) continue;
          if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
            const advanced = recomputeSpot(spot);
            if (advanced) { if (await advanceIosSpot(token, advanced, spot)) iosRearmed++; continue; }
          }
          const due = dueAlert(spot, notified, now);
          if (!due) continue;
          const aps = { aps: { alert: { title: due.title, body: due.body }, sound: 'default', 'thread-id': due.tag }, url: deepLink(spot), tag: due.tag };
          // apns-expiration = when this push stops being worth delivering (notify-core expiresAt: the
          // sweep for lead/tonight, SF midnight for the "tomorrow" eve push): a device that reconnects
          // later never shows a stale or wrong-day alert.
          const exp = Math.floor(due.expiresAt / 1000);
          let { status, reason } = await sendOne(session, jwt, token, aps, due.tag, exp);
          // Cross-host retry: a device's token environment (sandbox vs production) follows the build,
          // so the primary host can reject a valid token as BadDeviceToken. Try the OTHER host once
          // before pruning — only then is the token genuinely dead.
          if (isBadToken(status, reason)) {
            try {
              if (!altSession) altSession = openSession(altHost());
              ({ status, reason } = await sendOne(altSession, jwt, token, aps, due.tag, exp));
            } catch { /* alt host unreachable — fall through to prune below */ }
          }
          // 403 ExpiredProviderToken => the cached ES256 JWT went stale on this warm instance (clock
          // skew / key change). Re-mint ONCE per run and resend — never per-token, or APNs 429s the
          // mint. The guard makes the rest of the batch reuse the fresh token.
          if (status === 403 && /ExpiredProviderToken|InvalidProviderToken/i.test(reason) && !jwtReset) {
            jwtReset = true;
            resetProviderToken();
            jwt = getProviderToken();
            ({ status, reason } = await sendOne(session, jwt, token, aps, due.tag, exp));
          }
          let delivered = false;
          if (status === 200) { delivered = true; iosSent++; }
          else if (isBadToken(status, reason)) { await deleteIosSub(token); iosPruned++; }
          if (delivered) await markIosNotified(token, spot.nextSweepISO, due.key);
        }
      } finally {
        try { session.close(); } catch { /* already closed */ }
        try { if (altSession) altSession.close(); } catch { /* already closed */ }
      }
    } catch (e) {
      iosError = e.message || String(e); // e.g. a PEM parse error — non-secret, helps diagnose
      console.error('APNs pass failed:', e);
    }

    // Fully successful = the web loop finished (any store error throws past here) and the APNs pass
    // did too (its errors, markIosNotified's included, land in iosError). Only then free the lock —
    // and only while it is surely still ours (maxDuration 60 s < RUN_LOCK_MS). If the release fails,
    // the lock simply expires.
    if (!iosError && Date.now() - started < RUN_LOCK_MS) {
      try { await releaseSlot('cron-run'); } catch { /* expires on its own */ }
    }
    await finish(200, { ok: true, web: { checked: subs.length, sent, pruned, rearmed }, ios: { configured: iosConfigured, checked: iosSubs.length, sent: iosSent, pruned: iosPruned, rearmed: iosRearmed, ...(iosError ? { error: iosError } : {}) } });
  } catch (e) {
    console.error('send-notifications failed:', e);
    await finish(500, { error: 'internal error' }, String((e && e.message) || e).slice(0, 200));
  }
}
