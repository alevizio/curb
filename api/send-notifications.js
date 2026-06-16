// Vercel Cron handler (see vercel.json). Fires a push for any saved spot whose
// next sweep falls inside its lead window. Generate keys: npx web-push generate-vapid-keys
import webpush from 'web-push';
import {
  loadAllSubs, deleteSub, markNotified, advanceSpot, storeReady,
  loadAllIosSubs, deleteIosSub, markIosNotified, advanceIosSpot,
} from './_store.js';
import { recomputeSpot } from './_schedule.js';
import { apnsConfigured, getProviderToken, openSession, sendOne, primaryHost, altHost } from './_apns.js';

// A forever-watch stops auto-advancing once it hasn't been refreshed (by reopening the app with
// live data) for this long — bounds wrong-time pushes if the city changes a block's schedule.
const MAX_WATCH_AGE = 120 * 864e5; // ~120 days

// Which alert (if any) is due for a spot right now — shared by both transports so web push and
// native APNs fire on the exact same windows with the exact same copy. Returns { field, title,
// body, tag } or null. Two escalating pushes per sweep, never more: night-before (~8pm SF) = calm
// planning; ~30-min lead = urgent. Each window de-dupes independently per sweep time.
function dueAlert(spot, notifiedFor, notifiedEveFor, now) {
  const lead = (spot.leadMinutes ?? 30) * 60000;
  const delta = new Date(spot.nextSweepISO).getTime() - now;
  const side = spot.blockside ? ` (${spot.blockside})` : '';
  const eve = spot.eveningISO ? new Date(spot.eveningISO).getTime() : null;
  if (eve && now >= eve && now < eve + 45 * 60000 && delta > lead && notifiedEveFor !== spot.nextSweepISO) {
    return { field: 'notifiedEveFor', title: 'Street cleaning tomorrow 🧹', body: `${spot.corridor || 'Your block'}${side} gets swept tomorrow — plan where to move.`, tag: 'curb-sweep-eve' };
  }
  if (delta > 0 && delta <= lead && notifiedFor !== spot.nextSweepISO) {
    const mins = Math.max(1, Math.round(delta / 60000));
    return { field: 'notifiedFor', title: 'Move your car 🧹', body: `Sweeping ${spot.corridor || 'your block'}${side} in ~${mins} min.`, tag: 'curb-sweep' };
  }
  return null;
}

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
        for (const { token } of tokens) {
          let { status, reason } = await sendOne(session, jwt, token, aps, 'curb-test');
          if (status === 410 || (status === 400 && /BadDeviceToken|Unregistered/i.test(reason))) {
            if (!alt) alt = openSession(altHost());
            ({ status, reason } = await sendOne(alt, jwt, token, aps, 'curb-test'));
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

  try {
    const now = Date.now();
    let sent = 0, pruned = 0, rearmed = 0;
    let iosSent = 0, iosPruned = 0, iosRearmed = 0;

    // ---- Web Push ----
    const subs = await loadAllSubs();
    for (const { endpoint, subscription, spot, notifiedFor, notifiedEveFor, savedAt } of subs) {
      if (!spot || !spot.nextSweepISO) continue;
      // Forever-watch re-arm: advance to the next occurrence once the window ends (its OWN pass —
      // never coupled to the lead push, which still returns the same instant at lead time). Stops
      // while stale (MAX_WATCH_AGE) so a frozen rule can't track a city schedule change. The
      // advanced occurrence is in the future, so nothing pushes this tick → continue.
      if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
        const advanced = recomputeSpot(spot);
        if (advanced) { await advanceSpot(endpoint, advanced); rearmed++; continue; }
      }
      const due = dueAlert(spot, notifiedFor, notifiedEveFor, now);
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
      if (delivered) await markNotified(endpoint, spot.nextSweepISO, due.field);
    }

    // ---- Native APNs (iOS) ---- identical windows / dedupe / re-arm, different transport. Skipped
    // entirely until the APNS_* env vars are set, so the web-push path is unaffected before then.
    // Always load so `checked` reflects how many iOS watches actually exist (independent of whether
    // the APNs key is present) — this disambiguates "no device registered" from "key not loaded".
    const iosConfigured = apnsConfigured();
    const iosSubs = await loadAllIosSubs();
    let iosError = null; // isolate APNs failures so they can't 500 the cron or block web push
    if (iosConfigured && iosSubs.length) try {
      const jwt = getProviderToken(); // throws on a malformed .p8 — caught below, not fatal
      const session = openSession(); // ONE http2 session on the primary host; closed in finally
      let altSession = null; // opened lazily only if a token mismatches the primary environment
      const isBadToken = (s, r) => s === 410 || (s === 400 && /BadDeviceToken|Unregistered/i.test(r));
      try {
        for (const { token, spot, notifiedFor, notifiedEveFor, savedAt } of iosSubs) {
          if (!spot || !spot.nextSweepISO) continue;
          if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
            const advanced = recomputeSpot(spot);
            if (advanced) { await advanceIosSpot(token, advanced); iosRearmed++; continue; }
          }
          const due = dueAlert(spot, notifiedFor, notifiedEveFor, now);
          if (!due) continue;
          const aps = { aps: { alert: { title: due.title, body: due.body }, sound: 'default', 'thread-id': due.tag }, url: deepLink(spot), tag: due.tag };
          let { status, reason } = await sendOne(session, jwt, token, aps, due.tag);
          // Cross-host retry: a device's token environment (sandbox vs production) follows the build,
          // so the primary host can reject a valid token as BadDeviceToken. Try the OTHER host once
          // before pruning — only then is the token genuinely dead.
          if (isBadToken(status, reason)) {
            try {
              if (!altSession) altSession = openSession(altHost());
              ({ status, reason } = await sendOne(altSession, jwt, token, aps, due.tag));
            } catch { /* alt host unreachable — fall through to prune below */ }
          }
          let delivered = false;
          if (status === 200) { delivered = true; iosSent++; }
          else if (isBadToken(status, reason)) { await deleteIosSub(token); iosPruned++; }
          if (delivered) await markIosNotified(token, spot.nextSweepISO, due.field);
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
