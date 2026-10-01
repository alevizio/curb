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
// The same database, with replies left as the stored strings (no JSON parsing): a compare-and-set must
// send back the exact bytes it read. Only casUpdate uses it (its HGETALL would return a flat array).
let _raw = null;
function rawRedis() {
  if (!URL_ || !TOKEN) return null;
  if (!_raw) _raw = new Redis({ url: URL_, token: TOKEN, automaticDeserialization: false });
  return _raw;
}

// One hash, field = subscription.endpoint, value = { subscription, spot, notified, savedAt, proofHash? }.
const KEY = 'curb:subs';

// Back-compat: older records carried two named de-dupe fields (notifiedFor / notifiedEveFor); the
// cadence engine (lib/notify-core.js) now uses a { eve, morn, lead } map keyed by touchpoint. Derive
// the map from whatever a record has, so live subscribers keep their de-dupe across the upgrade
// (worst case is one duplicate push during the one sweep cycle it takes every record to migrate).
function notifiedMap(rec) {
  if (rec && rec.notified && typeof rec.notified === 'object') return { ...rec.notified };
  const m = {};
  if (rec && rec.notifiedFor) m.lead = rec.notifiedFor;
  if (rec && rec.notifiedEveFor) m.eve = rec.notifiedEveFor;
  return m;
}

// A same-sweep re-save (the page's daily silent refresh, a style change) omits an anchor the page
// thinks is too close or past — e.g. opened at 8:05pm the night before, it sends no eveningISO — which
// would wipe the stored anchor before the next tick sends that push. The anchors of one sweep never
// change, and `notified` (kept on this path) stops a re-send, so keep the stored ones.
function carryAnchors(out, prevSpot) {
  if (!out) return;
  if (!out.eveningISO && prevSpot.eveningISO) out.eveningISO = prevSpot.eveningISO;
  if (!out.morningISO && prevSpot.morningISO) out.morningISO = prevSpot.morningISO;
}

// A save from a sheet left open since before the cron re-armed the watch (the iOS app in the
// background, a PWA tab) still carries the sweep that has since started: older than the stored one, for
// the SAME side and schedule. Taking it would move the watch back to that sweep until the next tick
// re-advances it. Such a save keeps the stored spot (sweep, anchors, rules) and applies only the style
// dials. Another side, a changed schedule or a future sweep is saved as sent.
function staleResave(prevSpot, spot) {
  const p = Date.parse(prevSpot.nextSweepISO), s = Date.parse(spot.nextSweepISO);
  const sameSide = prevSpot.cnn || spot.cnn
    ? prevSpot.cnn === spot.cnn && prevSpot.sideKey === spot.sideKey
    : prevSpot.corridor === spot.corridor && prevSpot.limits === spot.limits && prevSpot.blockside === spot.blockside;
  const sched = (x) => JSON.stringify(x.rules || x.rule || null);
  return s < p && s <= Date.now() && sameSide && sched(prevSpot) === sched(spot);
}
const withStyle = (prevSpot, spot) =>
  ({ ...prevSpot, ...(spot.level ? { level: spot.level } : {}), ...(spot.voice ? { voice: spot.voice } : {}) });

/** True once the store env vars are present (used to fail loudly instead of silently). */
export function storeReady() {
  return Boolean(URL_ && TOKEN);
}

/** Upsert a subscription + its saved spot, keyed by endpoint.
 *  The de-dupe map is always kept: each entry holds the sweep it fired for, so it can only ever block
 *  that same sweep. Re-tapping, turning alerts off and on, or switching blocks never re-sends a push
 *  already delivered, and never blocks a different sweep. */
export async function saveSub(subscription, spot) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  let notified = {};
  let out = spot || null;
  try {
    const v = await r.hget(KEY, subscription.endpoint);
    const prev = typeof v === 'string' ? safeParse(v) : v;
    if (prev) notified = notifiedMap(prev); // re-arming the SAME sweep must not let the cron re-push it
    if (prev && prev.spot && spot && staleResave(prev.spot, spot)) {
      out = withStyle(prev.spot, spot);
    } else if (prev && prev.spot && spot && prev.spot.nextSweepISO === spot.nextSweepISO) {
      // A re-tap that omits the recurrence rule must not DROP it (would silently revert the
      // forever-watch to one-shot). Carry the prior rule(s)/cnn/sideKey forward when absent.
      if (out && !out.rule && prev.spot.rule) {
        out.rule = prev.spot.rule;
        if (prev.spot.rules) out.rules = prev.spot.rules;
        if (prev.spot.cnn) out.cnn = prev.spot.cnn;
        if (prev.spot.sideKey) out.sideKey = prev.spot.sideKey;
      }
      carryAnchors(out, prev.spot);
    }
  } catch { /* best effort — worst case is one duplicate push */ }
  // savedAt = the last time the CLIENT armed/refreshed this watch with live data. The cron stops
  // re-arming once a watch goes stale past MAX_WATCH_AGE (see send-notifications) so a frozen rule
  // can't push wrong times forever after a city schedule change. advanceSpot preserves it.
  const record = { subscription, spot: out, notified, savedAt: Date.now() };
  await r.hset(KEY, { [subscription.endpoint]: JSON.stringify(record) });
}

// The cron computes a re-arm from the spot in its start-of-run snapshot. Before writing, the record is
// re-read: if the user turned alerts off (spot = null) or re-saved the watch since, their write wins and
// the re-arm is skipped (the next tick re-arms from what they saved). Otherwise a Turn off landing
// during a run was silently undone and the watch kept pushing someone who opted out.
const sameSpot = (a, b) => Boolean(a && b) && JSON.stringify(a) === JSON.stringify(b);

// That re-read alone still left a window: the cron's writes (advanceSpot, markNotified and their iOS
// twins) put back the WHOLE record they read, so a Turn off or a block switch landing between their
// read and their write was overwritten (pushing someone who opted out, or for the block they left).
// So each cron write is one Upstash EVAL, a compare-and-set: the field is written only if it still
// holds the exact string the cron read; otherwise nothing is written and the cron re-reads and decides
// again on the user's version. Chosen over moving `notified` into its own field: no migration of live
// records, and it also covers advanceSpot, whose decision depends on the spot. The user's writes stay
// plain HGET/HSET: they win any race, losing at worst a de-dupe entry (one repeat push), as before.
const CAS = "if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then redis.call('HSET', KEYS[1], ARGV[1], ARGV[3]) return 1 end return 0";

/** Rewrite one record with `edit(rec)` (→ the new record, or null to leave it) unless it changed
 *  meanwhile, in which case `edit` runs again on the fresh copy. → true once written, false if the
 *  record is gone or `edit` declined. */
async function casUpdate(key, field, edit) {
  const r = rawRedis();
  if (!r) return false;
  for (let i = 0; i < 3; i++) {
    const raw = await r.hget(key, field);
    const rec = typeof raw === 'string' ? safeParse(raw) : null;
    const next = rec && edit(rec);
    if (!next) return false;
    if (Number(await r.eval(CAS, [key], [field, raw, JSON.stringify(next)])) === 1) return true;
  }
  throw new Error('record kept changing during the cron write'); // like a store error: the run fails
}

/** Advance a subscription to its next computed sweep occurrence (the cron "forever-watch"
 *  re-arm), computed from `seenSpot`. Replaces the spot only if the record still holds exactly
 *  `seenSpot` (→ true); the de-dupe map is kept (its entries name the sweep they fired for, so the
 *  next sweep is free to fire). Preserves savedAt — the re-arm is clock-driven, not a fresh client
 *  refresh. */
export async function advanceSpot(endpoint, newSpot, seenSpot) {
  return casUpdate(KEY, endpoint, (rec) => {
    if (!sameSpot(rec.spot, seenSpot)) return null;
    rec.spot = newSpot;
    rec.notified = notifiedMap(rec);
    delete rec.notifiedFor; delete rec.notifiedEveFor;
    return rec;
  });
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
      return rec ? { endpoint, ...rec, notified: notifiedMap(rec) } : null;
    })
    .filter(Boolean);
}

/** Remove an expired/invalid subscription (called on push 410/404). */
export async function deleteSub(endpoint) {
  const r = redis();
  if (r) await r.hdel(KEY, endpoint);
}

/** Turn a web watch OFF ("✓ Alerts on" → Turn off). Ownership = the endpoint AND its keys.auth, which
 *  only the browser holding the subscription has, compared in constant time with the stored one.
 *  Disarms (spot = null — the cron skips spot-less records) rather than deleting, so auto-park and
 *  its tokens still resolve the subscription, and the de-dupe survives turning it back on for the same
 *  sweep. → 'ok' | 'not-found' | 'forbidden'. */
export async function disarmSub(endpoint, auth) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  const v = await r.hget(KEY, endpoint);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec) return 'not-found';
  const a = Buffer.from(String(auth || '')), b = Buffer.from(String(rec.subscription?.keys?.auth || ''));
  if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) return 'forbidden';
  rec.spot = null;
  rec.notified = notifiedMap(rec);
  await r.hset(KEY, { [endpoint]: JSON.stringify(rec) });
  return 'ok';
}

/** Record that we already pushed for a given sweep time, so the cron won't repeat.
 *  field: 'notifiedFor' (the ~30-min lead push) or 'notifiedEveFor' (night-before). */
export async function markNotified(endpoint, nextSweepISO, key = 'lead') {
  await casUpdate(KEY, endpoint, (rec) => {
    rec.notified = notifiedMap(rec);
    rec.notified[key] = nextSweepISO;
    delete rec.notifiedFor; delete rec.notifiedEveFor; // migrate off the legacy fields once touched
    return rec;
  });
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

/** Upsert an APNs device token + its saved spot. Mirrors saveSub: keeps the de-dupe map, carries
 *  the recurrence rule/cnn/sideKey forward on a same-time re-arm when omitted, and applies only the
 *  style of a stale-sheet re-save. */
export async function saveIosSub(token, spot) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  let notified = {};
  let out = spot || null;
  try {
    const v = await r.hget(KEY_IOS, token);
    const prev = typeof v === 'string' ? safeParse(v) : v;
    if (prev) notified = notifiedMap(prev);
    if (prev && prev.spot && spot && staleResave(prev.spot, spot)) {
      out = withStyle(prev.spot, spot);
    } else if (prev && prev.spot && spot && prev.spot.nextSweepISO === spot.nextSweepISO) {
      if (out && !out.rule && prev.spot.rule) {
        out.rule = prev.spot.rule;
        if (prev.spot.rules) out.rules = prev.spot.rules;
        if (prev.spot.cnn) out.cnn = prev.spot.cnn;
        if (prev.spot.sideKey) out.sideKey = prev.spot.sideKey;
      }
      carryAnchors(out, prev.spot);
    }
  } catch { /* best effort — worst case is one duplicate push */ }
  const record = { token, spot: out, notified, savedAt: Date.now(), platform: 'ios' };
  await r.hset(KEY_IOS, { [token]: JSON.stringify(record) });
}

/** Advance an iOS watch to its next computed occurrence (forever-watch re-arm). Like advanceSpot:
 *  only while the record still holds exactly `seenSpot` (→ true). */
export async function advanceIosSpot(token, newSpot, seenSpot) {
  return casUpdate(KEY_IOS, token, (rec) => {
    if (!sameSpot(rec.spot, seenSpot)) return null;
    rec.spot = newSpot;
    rec.notified = notifiedMap(rec);
    delete rec.notifiedFor; delete rec.notifiedEveFor;
    return rec;
  });
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
      return rec ? { token, ...rec, notified: notifiedMap(rec) } : null;
    })
    .filter(Boolean);
}

/** True if this APNs token already has a record (re-saves of a known token are never throttled). */
export async function hasIosSub(token) {
  const r = redis();
  if (!r) return false;
  return Boolean(await r.hexists(KEY_IOS, token));
}

/** Remove a dead APNs token (called on 410 Unregistered / 400 BadDeviceToken). */
export async function deleteIosSub(token) {
  const r = redis();
  if (r) await r.hdel(KEY_IOS, token);
}

/** Turn an iOS watch OFF. Like disarmSub: spot = null (the cron skips it) and the de-dupe map is kept,
 *  so turning alerts back on for the same sweep can't re-send a push already delivered. An unknown
 *  token stores nothing. */
export async function disarmIosSub(token) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  const v = await r.hget(KEY_IOS, token);
  const rec = typeof v === 'string' ? safeParse(v) : v;
  if (!rec) return;
  rec.spot = null;
  rec.notified = notifiedMap(rec);
  await r.hset(KEY_IOS, { [token]: JSON.stringify(rec) });
}

/** Record that we already pushed an iOS token for a given sweep time (per-window de-dupe). */
export async function markIosNotified(token, nextSweepISO, key = 'lead') {
  await casUpdate(KEY_IOS, token, (rec) => {
    rec.notified = notifiedMap(rec);
    rec.notified[key] = nextSweepISO;
    delete rec.notifiedFor; delete rec.notifiedEveFor;
    return rec;
  });
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

/** Free a claimSlot before it expires (the sender's run lock, once a run has fully succeeded). */
export async function releaseSlot(material) {
  const r = redis();
  if (r) await r.del('curb:rl:' + sha(material));
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

// ---- sender run record (read by the monitor via /api/send-notifications?status=1) ----
// `last` = the most recent run whatever its outcome; `ok` = the most recent successful one. Holds only
// counts/outcome/trigger — no subscription, token or spot.
// `qstash` / `qstashOk` = the same two, for QStash-triggered runs only, so the monitor can tell a dead
// primary scheduler apart even while GitHub backup runs keep `last`/`ok` fresh. `qstash` is
// { at, ok, error? } (ok is false only for an erroring run; a lock-skipped tick is a harmless no-op,
// flagged skipped:true) and `qstashOk` is { at }.
const CKEY = 'curb:cron';

/** Record one sender run: { at, trigger, outcome: 'ok'|'error'|'skipped', ... }. */
export async function saveRunStatus(status) {
  const r = redis();
  if (!r) return;
  const v = JSON.stringify(status);
  const fields = status.outcome === 'ok' ? { last: v, ok: v } : { last: v };
  if (status.trigger === 'qstash') {
    fields.qstash = JSON.stringify({ at: status.at, ok: status.outcome !== 'error',
      ...(status.outcome === 'skipped' ? { skipped: true } : {}), ...(status.error ? { error: status.error } : {}) });
    if (status.outcome === 'ok') fields.qstashOk = JSON.stringify({ at: status.at });
  }
  await r.hset(CKEY, fields);
}

/** { last, lastOk, lastQstash, lastQstashOk } — any may be null before the first such run. */
export async function loadRunStatus() {
  const r = redis();
  if (!r) return { last: null, lastOk: null, lastQstash: null, lastQstashOk: null };
  const all = (await r.hgetall(CKEY)) || {};
  const parse = (v) => (typeof v === 'string' ? safeParse(v) : v) || null;
  return { last: parse(all.last), lastOk: parse(all.ok), lastQstash: parse(all.qstash), lastQstashOk: parse(all.qstashOk) };
}

// ---- client error log (anonymous; see /privacy) ----
// A capped list of the most recent browser / iOS-wrapper errors, so the GitHub monitor can alert on
// real user-facing breakage. Entries carry no IP, no location, no subscription or token.
const EKEY = 'curb:errors';
const EMAX = 2000;

/** Append one normalized error entry (newest first), keeping only the last EMAX. */
export async function pushClientError(entry) {
  const r = redis();
  if (!r) return false;
  await r.lpush(EKEY, JSON.stringify(entry));
  await r.ltrim(EKEY, 0, EMAX - 1);
  return true;
}

/** Every stored entry, newest first. */
export async function readClientErrors() {
  const r = redis();
  if (!r) return [];
  const rows = (await r.lrange(EKEY, 0, EMAX - 1)) || [];
  return rows.map((v) => (typeof v === 'string' ? safeParse(v) : v)).filter(Boolean);
}

/** Global per-minute intake cap (abuse guard): true while this minute is still under `max`. */
export async function underErrorRate(max = 120) {
  const r = redis();
  if (!r) return true;
  const k = 'curb:errs:rate:' + Math.floor(Date.now() / 60000);
  const n = await r.incr(k);
  if (n === 1) await r.expire(k, 120);
  return n <= max;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
