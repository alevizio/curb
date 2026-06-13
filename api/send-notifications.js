// Vercel Cron handler (see vercel.json). Fires a push for any saved spot whose
// next sweep falls inside its lead window. Generate keys: npx web-push generate-vapid-keys
import webpush from 'web-push';
import { loadAllSubs, deleteSub, markNotified, storeReady } from './_store.js';

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
    const subs = await loadAllSubs();
    const now = Date.now();
    let sent = 0, pruned = 0;

    for (const { endpoint, subscription, spot, notifiedFor, notifiedEveFor } of subs) {
      if (!spot || !spot.nextSweepISO) continue;
      const lead = (spot.leadMinutes ?? 30) * 60000;
      const delta = new Date(spot.nextSweepISO).getTime() - now;

      // Two escalating pushes per sweep, never more: night-before (~8pm SF, computed
      // client-side as a true instant) = calm planning; ~30-min lead = urgent.
      // Each window de-dupes independently per sweep time; old subs without
      // eveningISO behave exactly as before.
      let payload = null, field = null;
      const eve = spot.eveningISO ? new Date(spot.eveningISO).getTime() : null;
      if (eve && now >= eve && now < eve + 45 * 60000 && delta > lead && notifiedEveFor !== spot.nextSweepISO) {
        payload = JSON.stringify({
          title: 'Street cleaning tomorrow 🧹',
          body: `${spot.corridor || 'Your block'}${spot.blockside ? ` (${spot.blockside})` : ''} gets swept tomorrow — plan where to move.`,
          url: '/',
          tag: 'curb-sweep-eve'
        });
        field = 'notifiedEveFor';
      } else if (delta > 0 && delta <= lead && notifiedFor !== spot.nextSweepISO) {
        const mins = Math.max(1, Math.round(delta / 60000));
        payload = JSON.stringify({
          title: 'Move your car 🧹',
          body: `Sweeping ${spot.corridor || 'your block'}${spot.blockside ? ` (${spot.blockside})` : ''} in ~${mins} min.`,
          url: '/',
          tag: 'curb-sweep'
        });
        field = 'notifiedFor';
      }
      if (!payload) continue;

      let delivered = false;
      try {
        await webpush.sendNotification(subscription, payload);
        delivered = true; sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) { await deleteSub(endpoint); pruned++; }
      }
      // De-dupe write lives OUTSIDE the send try/catch: a transient store error here must not be
      // mistaken for a send failure (which would let the next 15-min tick re-push the same sweep).
      if (delivered) await markNotified(endpoint, spot.nextSweepISO, field);
    }
    res.status(200).json({ ok: true, checked: subs.length, sent, pruned });
  } catch (e) {
    console.error('send-notifications failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
