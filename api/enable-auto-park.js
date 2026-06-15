// POST { subscription, action? } — mint or revoke an auto-park token for a Shortcut (ALE-168 T2).
//   action 'enable' (default) -> { token }   (show once; the user pastes it into the iOS Shortcut)
//   action 'revoke'           -> { ok: true } (deletes every token bound to this subscription)
//
// Ownership is proved with the `ownerProof` minted at subscribe time (NOT keys.auth, which must stay
// plaintext for push delivery and would be exposed by a store read-leak). Rate-limited per endpoint.
import { randomUUID } from 'node:crypto';
import { saveToken, deleteTokensForEndpoint, verifyOwnerProof, claimSlot, storeReady } from './_store.js';

const PUSH_HOST = /(\.googleapis\.com|\.push\.services\.mozilla\.com|\.notify\.windows\.com|\.push\.apple\.com)$/i;
function validSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1024) return false;
  let u; try { u = new URL(s.endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || !PUSH_HOST.test(u.hostname)) return false;
  if (!s.keys || typeof s.keys.auth !== 'string' || s.keys.auth.length > 256) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!storeReady()) { res.status(503).json({ error: 'store not configured' }); return; }
  try {
    const { subscription, ownerProof, action } = req.body || {};
    if (!validSubscription(subscription)) { res.status(400).json({ error: 'invalid subscription' }); return; }
    const endpoint = subscription.endpoint;

    // Per-endpoint throttle (atomic) — caps token-mint churn + subscription-existence probing.
    if (!(await claimSlot('eap:' + endpoint, 60000))) { res.status(429).json({ error: 'slow down' }); return; }

    // Single ownership gate: the proof must verify. One generic 403 for both "no such sub" and
    // "wrong proof" so the endpoint isn't an existence oracle.
    if (!(await verifyOwnerProof(endpoint, ownerProof))) { res.status(403).json({ error: 'could not authorize' }); return; }

    if (action === 'revoke') {
      await deleteTokensForEndpoint(endpoint);
      res.status(200).json({ ok: true, revoked: true });
      return;
    }
    // enable: one fresh token bound to this endpoint (high-entropy; only the hash is stored)
    const token = randomUUID();
    await saveToken(token, endpoint);
    res.status(200).json({ ok: true, token });
  } catch (e) {
    console.error('enable-auto-park failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
}
