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

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
