// Vercel Cron handler (see vercel.json). Fires a push for any saved spot whose
// next sweep falls inside its lead window. Generate keys: npx web-push generate-vapid-keys
import webpush from 'web-push';
import {
  loadAllSubs, deleteSub, markNotified, advanceSpot, storeReady,
  loadAllIosSubs, deleteIosSub, markIosNotified, advanceIosSpot, claimSlot,
} from './_store.js';
import { recomputeSpot } from './_schedule.js';
import { apnsConfigured, getProviderToken, resetProviderToken, openSession, sendOne, primaryHost, altHost } from './_apns.js';
import { dueAlert } from '../lib/notify-core.js';

// A forever-watch stops auto-advancing once it hasn't been refreshed (by reopening the app with
// live data) for this long — bounds wrong-time pushes if the city changes a block's schedule.
const MAX_WATCH_AGE = 120 * 864e5; // ~120 days

// The cadence brain — which push is due for a spot right now, with what copy, at the user's chosen
// intensity + voice — lives in lib/notify-core.js. It's a pure, unit-tested module shared by BOTH
// transports here AND the /api/test-notification preview endpoint, so they can never diverge.
// dueAlert(spot, notifiedMap, now) -> { key, tag, title, body } | null.

// A notification tap opens the specific block when we know its cnn, else the map.
const deepLink = (spot) => (spot && spot.cnn ? '/b/' + spot.cnn : '/');

export default async function handler(req, res) {
  // Required: this endpoint dispatches pushes + spends store/web-push quota, so it must not run
  // unauthenticated. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically once the
  // env var is set; an external scheduler can send the same header.
  if (!process.env.CRON_SECRET) {
    res.status(503).json({ error: 'CRON_SECRET not set — refusing to run unauthenticated' }); return;
  }
  if ((req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }

  // Authed delivery test: ?test=ios sends a one-off push to every registered iOS token, bypassing
  // the due-window logic (and never touching spot/dedupe state) — to confirm end-to-end APNs
  // delivery on demand. Uses the same cross-host retry as the real loop.
  if ((req.query?.test || '') === 'ios') {
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

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    res.status(500).json({ error: 'VAPID keys not set (see .env.example)' }); return;
  }
  if (!storeReady()) {
    res.status(500).json({ error: 'store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)' }); return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Run-level lock: two schedulers drive this endpoint (the GitHub Action AND the vercel.json cron),
  // so two invocations can overlap. The per-sweep markNotified dedupe is a non-atomic read-modify-
  // write, so overlapping runs could both pass it and double-fire. A short atomic claim lets at most
  // one run process a given ~2-min window; a skipped run is a harmless no-op (the holder does the work,
  // and the 30-min lead window spans several 15-min ticks so nothing is missed). No-op in dev (no store).
  if (!(await claimSlot('cron-run', 120000))) {
    res.status(200).json({ ok: true, skipped: 'another run holds the lock' }); return;
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
      // advanced occurrence is in the future, so nothing pushes this tick → continue.
      if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
        const advanced = recomputeSpot(spot);
        if (advanced) { await advanceSpot(endpoint, advanced); rearmed++; continue; }
      }
      const due = dueAlert(spot, notified, now);
      if (!due) continue;
      const payload = JSON.stringify({ title: due.title, body: due.body, url: deepLink(spot), tag: due.tag });
      let delivered = false;
      try {
        await webpush.sendNotification(subscription, payload);
        delivered = true; sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) { await deleteSub(endpoint); pruned++; }
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
            if (advanced) { await advanceIosSpot(token, advanced); iosRearmed++; continue; }
          }
          const due = dueAlert(spot, notified, now);
          if (!due) continue;
          const aps = { aps: { alert: { title: due.title, body: due.body }, sound: 'default', 'thread-id': due.tag }, url: deepLink(spot), tag: due.tag };
          // apns-expiration = the sweep instant: if the device is offline now and reconnects AFTER the
          // truck has come, APNs drops the stale "move your car" alert instead of delivering it late.
          const exp = Math.floor(new Date(spot.nextSweepISO).getTime() / 1000);
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

    res.status(200).json({ ok: true, web: { checked: subs.length, sent, pruned, rearmed }, ios: { configured: iosConfigured, checked: iosSubs.length, sent: iosSent, pruned: iosPruned, rearmed: iosRearmed, ...(iosError ? { error: iosError } : {}) } });
  } catch (e) {
    console.error('send-notifications failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
