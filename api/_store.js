// Shared subscription store, backed by Upstash Redis (REST).
//
// Works with EITHER:
//   - a standalone Upstash database   -> UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   - the Vercel Marketplace "Upstash for Redis" integration (a.k.a. Vercel KV)
//     -> KV_REST_API_URL / KV_REST_API_TOKEN
//
// Files prefixed with "_" are treated as helpers by Vercel and are NOT routed as
// functions, so this module is import-only.
import { Redis } from '@upstash/redis';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let _redis = null;
function redis() {
  if (!URL_ || !TOKEN) return null;
  if (!_redis) _redis = new Redis({ url: URL_, token: TOKEN });
  return _redis;
}

// One hash, field = subscription.endpoint, value = { subscription, spot, notifiedFor }.
const KEY = 'curb:subs';

/** True once the store env vars are present (used to fail loudly instead of silently). */
export function storeReady() {
  return Boolean(URL_ && TOKEN);
}

/** Upsert a subscription + its saved spot, keyed by endpoint.
 *  Notify state resets for a NEW sweep time but is preserved when the user re-arms
 *  the same sweep (re-tapping the button must not let the cron push twice). */
export async function saveSub(subscription, spot) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  let notifiedFor = null, notifiedEveFor = null;
  const out = spot || null;
  try {
    const v = await r.hget(KEY, subscription.endpoint);
    const prev = typeof v === 'string' ? safeParse(v) : v;
    if (prev && prev.spot && spot && prev.spot.nextSweepISO === spot.nextSweepISO) {
      notifiedFor = prev.notifiedFor ?? null;
      notifiedEveFor = prev.notifiedEveFor ?? null;
      // A re-tap that omits the recurrence rule must not DROP it (would silently revert the
      // forever-watch to one-shot). Carry the prior rule/cnn/sideKey forward when absent.
      if (out && !out.rule && prev.spot.rule) {
        out.rule = prev.spot.rule;
        if (prev.spot.cnn) out.cnn = prev.spot.cnn;
        if (prev.spot.sideKey) out.sideKey = prev.spot.sideKey;
      }
    }
  } catch { /* best effort — worst case is one duplicate push */ }
  // savedAt = the last time the CLIENT armed/refreshed this watch with live data. The cron stops
  // re-arming once a watch goes stale past MAX_WATCH_AGE (see send-notifications) so a frozen rule
  // can't push wrong times forever after a city schedule change. advanceSpot preserves it.
  const record = { subscription, spot: out, notifiedFor, notifiedEveFor, savedAt: Date.now() };
  await r.hset(KEY, { [subscription.endpoint]: JSON.stringify(record) });
}

/** Advance a subscription to its next computed sweep occurrence (the cron "forever-watch"
 *  re-arm). Replaces the spot and RESETS the per-window de-dupe so the next sweep can fire.
 *  Preserves savedAt — the re-arm is clock-driven, not a fresh client refresh. */
export async function advanceSpot(endpoint, newSpot) {
  const r = redis();
  if (!r) return;
  const v = await r.hget(KEY, endpoint);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec) return;
  rec.spot = newSpot;
  rec.notifiedFor = null;
  rec.notifiedEveFor = null;
  await r.hset(KEY, { [endpoint]: JSON.stringify(rec) });
}

/** Load every stored record as { endpoint, subscription, spot, notifiedFor }. */
export async function loadAllSubs() {
  const r = redis();
  if (!r) return [];
  const all = await r.hgetall(KEY);
  if (!all) return [];
  return Object.entries(all)
    .map(([endpoint, v]) => {
      const rec = typeof v === 'string' ? safeParse(v) : v; // Upstash may auto-deserialize
      return rec ? { endpoint, ...rec } : null;
    })
    .filter(Boolean);
}

/** Remove an expired/invalid subscription (called on push 410/404). */
export async function deleteSub(endpoint) {
  const r = redis();
  if (r) await r.hdel(KEY, endpoint);
}

/** Record that we already pushed for a given sweep time, so the cron won't repeat.
 *  field: 'notifiedFor' (the ~30-min lead push) or 'notifiedEveFor' (night-before). */
export async function markNotified(endpoint, nextSweepISO, field = 'notifiedFor') {
  const r = redis();
  if (!r) return;
  const v = await r.hget(KEY, endpoint);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec) return;
  rec[field] = nextSweepISO;
  await r.hset(KEY, { [endpoint]: JSON.stringify(rec) });
}

/** Load a single subscription record by endpoint, or null. */
export async function getSub(endpoint) {
  const r = redis();
  if (!r) return null;
  const v = await r.hget(KEY, endpoint);
  return (typeof v === 'string' ? safeParse(v) : v) || null;
}

// ---- native iOS (APNs) subscriptions ----
// A sibling hash with the IDENTICAL record shape, keyed by the hex APNs device token instead of a
// web-push endpoint. The spot/rule sub-shape is byte-identical to curb:subs, so recomputeSpot() and
// the entire forever-watch + lead-window + dedupe logic apply unchanged — only the key, the load/
// advance/mark/delete helpers, and the delivery transport (APNs vs web-push) differ. No web-push
// field (endpoint/p256dh/auth) ever appears here, so validSubscription() never sees a hex token.
const KEY_IOS = 'curb:apns';

/** Upsert an APNs device token + its saved spot. Mirrors saveSub: preserves the per-window de-dupe
 *  on a same-time re-arm and carries the recurrence rule/cnn/sideKey forward when omitted. */
export async function saveIosSub(token, spot) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  let notifiedFor = null, notifiedEveFor = null;
  const out = spot || null;
  try {
    const v = await r.hget(KEY_IOS, token);
    const prev = typeof v === 'string' ? safeParse(v) : v;
    if (prev && prev.spot && spot && prev.spot.nextSweepISO === spot.nextSweepISO) {
      notifiedFor = prev.notifiedFor ?? null;
      notifiedEveFor = prev.notifiedEveFor ?? null;
      if (out && !out.rule && prev.spot.rule) {
        out.rule = prev.spot.rule;
        if (prev.spot.cnn) out.cnn = prev.spot.cnn;
        if (prev.spot.sideKey) out.sideKey = prev.spot.sideKey;
      }
    }
  } catch { /* best effort — worst case is one duplicate push */ }
  const record = { token, spot: out, notifiedFor, notifiedEveFor, savedAt: Date.now(), platform: 'ios' };
  await r.hset(KEY_IOS, { [token]: JSON.stringify(record) });
}

/** Advance an iOS watch to its next computed occurrence (forever-watch re-arm). */
export async function advanceIosSpot(token, newSpot) {
  const r = redis();
  if (!r) return;
  const v = await r.hget(KEY_IOS, token);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec) return;
  rec.spot = newSpot;
  rec.notifiedFor = null;
  rec.notifiedEveFor = null;
  await r.hset(KEY_IOS, { [token]: JSON.stringify(rec) });
}

/** Load every iOS record as { token, spot, notifiedFor, notifiedEveFor, savedAt }. */
export async function loadAllIosSubs() {
  const r = redis();
  if (!r) return [];
  const all = await r.hgetall(KEY_IOS);
  if (!all) return [];
  return Object.entries(all)
    .map(([token, v]) => {
      const rec = typeof v === 'string' ? safeParse(v) : v;
      return rec ? { token, ...rec } : null;
    })
    .filter(Boolean);
}

/** Remove a dead APNs token (called on 410 Unregistered / 400 BadDeviceToken). */
export async function deleteIosSub(token) {
  const r = redis();
  if (r) await r.hdel(KEY_IOS, token);
}

/** Record that we already pushed an iOS token for a given sweep time (per-window de-dupe). */
export async function markIosNotified(token, nextSweepISO, field = 'notifiedFor') {
  const r = redis();
  if (!r) return;
  const v = await r.hget(KEY_IOS, token);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec) return;
  rec[field] = nextSweepISO;
  await r.hset(KEY_IOS, { [token]: JSON.stringify(rec) });
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// ---- subscription ownership proof (ALE-168 Tier 2 auth) ----
// keys.auth must be stored in plaintext (web-push needs it to encrypt payloads), so it can't be the
// mint credential — a store read-leak would expose it. Instead, mint a SEPARATE random ownerProof at
// subscribe time, store only its hash, and reveal the plaintext exactly once. enable-auto-park then
// proves ownership with the proof, which never has to live anywhere the cron can read.
/** Mint an ownerProof for an endpoint if it has none; return the plaintext ONCE (null if already set). */
export async function ensureOwnerProof(endpoint) {
  const r = redis();
  if (!r) return null;
  const v = await r.hget(KEY, endpoint);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec || rec.proofHash) return null; // no sub, or proof already minted (can't re-reveal)
  const proof = randomUUID();
  rec.proofHash = sha(proof);
  await r.hset(KEY, { [endpoint]: JSON.stringify(rec) });
  return proof;
}

/** Constant-time check of a presented ownerProof against the stored hash. */
export async function verifyOwnerProof(endpoint, proof) {
  const r = redis();
  if (!r || !proof) return false;
  const v = await r.hget(KEY, endpoint);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec || !rec.proofHash) return false;
  const a = Buffer.from(sha(proof)), b = Buffer.from(rec.proofHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Atomic single-use rate slot: true if claimed, false if one already exists within `ms`.
 *  `material` is hashed into the key so a secret (token/endpoint) never lands in the keyspace. */
export async function claimSlot(material, ms = 60000) {
  const r = redis();
  if (!r) return true; // no store (dev) → don't block
  const ok = await r.set('curb:rl:' + sha(material), '1', { nx: true, px: ms });
  return ok === 'OK' || ok === true;
}

// ---- auto-park tokens (ALE-168 Tier 2) ----
// A separate hash maps SHA-256(token) -> { endpoint }. Only the HASH is stored, so a store leak
// can't be replayed as a live bearer token. The plaintext token is shown to the client once and
// lives in the user's Shortcut. Rate-limiting is a separate atomic claimSlot() on the token.
const TKEY = 'curb:tokens';
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/** Mint: bind a token to a subscription endpoint (idempotent per token hash). */
export async function saveToken(token, endpoint) {
  const r = redis();
  if (!r) throw new Error('store not configured');
  await r.hset(TKEY, { [hashToken(token)]: JSON.stringify({ endpoint }) });
}

/** Resolve a presented token to its { endpoint }, or null if unknown. */
export async function resolveToken(token) {
  const r = redis();
  if (!r || !token) return null;
  const v = await r.hget(TKEY, hashToken(token));
  return (typeof v === 'string' ? safeParse(v) : v) || null;
}

/** Revoke every token bound to an endpoint (called from the app's "disable auto-park"). */
export async function deleteTokensForEndpoint(endpoint) {
  const r = redis();
  if (!r) return;
  const all = await r.hgetall(TKEY);
  if (!all) return;
  for (const [h, v] of Object.entries(all)) {
    const rec = typeof v === 'string' ? safeParse(v) : v;
    if (rec && rec.endpoint === endpoint) await r.hdel(TKEY, h);
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
