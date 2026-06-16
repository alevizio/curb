// Vercel Cron handler (see vercel.json). Fires a push for any saved spot whose
// next sweep falls inside its lead window. Generate keys: npx web-push generate-vapid-keys
import webpush from 'web-push';
import {
  loadAllSubs, deleteSub, markNotified, advanceSpot, storeReady,
  loadAllIosSubs, deleteIosSub, markIosNotified, advanceIosSpot,
} from './_store.js';
import { recomputeSpot } from './_schedule.js';
import { apnsConfigured, getProviderToken, openSession, sendOne } from './_apns.js';

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
    const iosSubs = apnsConfigured() ? await loadAllIosSubs() : [];
    if (iosSubs.length) {
      const jwt = getProviderToken();
      const session = openSession(); // ONE http2 session for the whole run; closed in finally
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
          const { status, reason } = await sendOne(session, jwt, token, aps, due.tag);
          let delivered = false;
          if (status === 200) { delivered = true; iosSent++; }
          else if (status === 410 || (status === 400 && /BadDeviceToken|Unregistered/i.test(reason))) { await deleteIosSub(token); iosPruned++; }
          if (delivered) await markIosNotified(token, spot.nextSweepISO, due.field);
        }
      } finally {
        try { session.close(); } catch { /* already closed */ }
      }
    }

    res.status(200).json({ ok: true, web: { checked: subs.length, sent, pruned, rearmed }, ios: { checked: iosSubs.length, sent: iosSent, pruned: iosPruned, rearmed: iosRearmed } });
  } catch (e) {
    console.error('send-notifications failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
