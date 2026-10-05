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
import { watchDead } from './_schedule.js';

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

// One hash, field = subscription.endpoint (watch 0) or `<endpoint>#<n>` (watch n, see MAX_WATCHES below),
// value = { subscription, spot, notified, savedAt, proofHash? (watch 0 only), offSide?, car? (auto-park's) }.
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

// What a save writes over the watch it lands on: a re-save of the same sweep keeps the stored rule and
// anchors, a stale-sheet re-save keeps the stored spot and applies only its style (see above).
function carryForward(prev, spot) {
  let out = spot || null;
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
  return out;
}

/** True once the store env vars are present (used to fail loudly instead of silently). */
export function storeReady() {
  return Boolean(URL_ && TOKEN);
}

// ---- watches: up to MAX_WATCHES per device, one per curb side ----
// A device (a web-push endpoint or an APNs token) keeps up to MAX_WATCHES independent watches, so one
// phone can follow both sides of a street. Watch 0 lives in the device's own field, which makes every
// record written before multi-watch watch 0, unchanged; watch n lives in `<device>#<n>` in the same hash.
// Each is a complete record (its own spot, rules, `notified` de-dupe and savedAt), so the cron loops, the
// compare-and-set writes and the never-re-arm-a-Turn-off guarantee work per watch exactly as they did per
// device. Fixed slots rather than fields named after the side: one HMGET of the 5 known fields tells a save
// which watch already holds its side and how many are armed, and a device can never hold more than 5
// records (side-named fields would keep a record for every side ever armed and turned off).
export const MAX_WATCHES = 5;
const slotField = (base, n) => (n ? `${base}#${n}` : base);
const SLOT_RE = new RegExp(`#([1-${MAX_WATCHES - 1}])$`);
/** A hash field → { base: the device's endpoint / token, slot }. (Endpoints with a '#' are refused.) */
export function splitField(field) {
  const m = SLOT_RE.exec(field);
  return m ? { base: field.slice(0, m.index), slot: Number(m[1]) } : { base: field, slot: 0 };
}

/** Two spots name the same curb side: the same cnn and sideKey, or the same cnn and blockside (auto-park
 *  keys a side by cnnrightleft, 'L'/'R', where the page uses the blockside, 'North'); else the block's text
 *  (a spot without a rule, from an old cached page, carries no cnn). */
export function sameSide(a, b) {
  if (!a || !b) return false;
  if (a.cnn && b.cnn) return a.cnn === b.cnn && ((a.sideKey || '') === (b.sideKey || '') || Boolean(a.blockside && a.blockside === b.blockside));
  return (a.corridor || '') === (b.corridor || '') && (a.limits || '') === (b.limits || '') && (a.blockside || '') === (b.blockside || '');
}
// A turned-off watch keeps naming its side (`offSide`), so turning that side back on finds its de-dupe.
const sideOf = (s) => ({ cnn: s.cnn || '', sideKey: s.sideKey || '', corridor: s.corridor || '', limits: s.limits || '', blockside: s.blockside || '' });

/** The device's MAX_WATCHES slots, read in one HMGET as the exact stored strings (a save's write is a
 *  compare-and-set against them): [{ n, field, raw, rec }], rec null for an empty slot. */
async function readWatches(key, base) {
  const fields = Array.from({ length: MAX_WATCHES }, (_, n) => slotField(base, n));
  const raws = await rawRedis().hmget(key, ...fields);
  return fields.map((field, n) => {
    const raw = Array.isArray(raws) && typeof raws[n] === 'string' ? raws[n] : null;
    return { n, field, raw, rec: raw ? safeParse(raw) : null };
  });
}

const armed = (s) => Boolean(s.rec && s.rec.spot);
const off = (s) => Boolean(s.rec && !s.rec.spot);
const onSide = (spot) => (s) => armed(s) && sameSide(s.rec.spot, spot);
const offOnSide = (spot) => (s) => off(s) && Boolean(s.rec.offSide) && sameSide(s.rec.offSide, spot);
const preMultiOff = (s) => off(s) && !s.rec.offSide;

// Which watch a save of `spot` writes, first match wins:
//  1. the watch already on this side, armed → updated in place (no duplicate watch);
//  2. a watch turned off on this side → re-armed with its de-dupe, so off → on of one sweep can't repeat a push;
//  3. a watch turned off before sides were recorded (a pre-multi record) → reused with its de-dupe, as
//     every save did before;
//  4. an empty slot → a fresh watch;
//  5. a watch turned off on another side → reused with a fresh de-dupe (its entries name the other side's
//     sweeps and could block this side's push for the same instant);
//  6. a dead watch (watchDead: stale or one-shot, its sweep over, so it can never push again) → reused with a
//     fresh de-dupe, else such watches would hold slots forever and a device could be full with nothing to free.
// → { n, keep } (keep = carry that watch's de-dupe and spot forward), or null when 5 watches are live.
function pickSlot(slots, spot, now = Date.now()) {
  const order = [
    [onSide(spot), true],
    [offOnSide(spot), true],
    [preMultiOff, true],
    [(s) => !s.rec, false],
    [off, false],
    [(s) => armed(s) && watchDead(s.rec, now), false],
  ];
  for (const [test, keep] of order) { const s = slots.find(test); if (s) return { n: s.n, keep }; }
  return null;
}

// A save from a page loaded before multi-watch (an open PWA tab, the iOS app's web view, which never
// reloads, a navigation the service worker cached) carries no `multi` marker in its spot, and means what it
// meant then: "move my alerts to this curb" (that page says so, and then has no way to turn the old side
// off). So it lands on the watch already on this side, else watch 0, and saveWatch turns off every other
// armed watch of the device. De-dupe as in pickSlot: kept on this side's watch or a pre-multi off record.
function pickLegacy(slots, spot) {
  const s = slots.find(onSide(spot)) || slots.find(offOnSide(spot));
  return s ? { n: s.n, keep: true } : { n: 0, keep: preMultiOff(slots[0]) };
}

// A save lands only if its slot still holds what the save read (empty: HSETNX, else the CAS script below),
// so two saves racing for one empty slot (two new sides tapped at once) can't overwrite each other, and a
// cron write landing in between is never lost: the loser re-reads and decides again.
async function claimField(key, field, raw, value) {
  const r = rawRedis();
  if (raw == null) return Number(await r.hsetnx(key, field, value)) === 1;
  try { return Number(await r.eval(CAS, [key], [field, raw, value])) === 1; }
  catch (e) {
    console.error('compare-and-set unavailable, plain write:', String(e && e.message || e).slice(0, 120));
    await r.hset(key, { [field]: value });
    return true;
  }
}

/** Save `spot` as one of the device's watches: the one on its side, else a new one (pickSlot).
 *  `legacy` (a save from a page that predates multi-watch, see pickLegacy) lands on this side's watch or
 *  watch 0 and turns off every other armed watch: alerts MOVE here, as that page promises.
 *  `atBase` (auto-park) writes the car's watch, the one tagged `car: true`, else a slot pickSlot gives it
 *  (then tagged), so the watch follows the car and never overwrites a side the user armed; another armed
 *  watch on the car's side is turned off so it doesn't push twice. Both re-read the slots after their write,
 *  so a save landing meanwhile is seen. `record(n, spot, notified)` builds the stored value.
 *  The de-dupe map of the watch is kept: each entry holds the sweep it fired for, so it only ever blocks
 *  that same sweep (re-taps, off → on and re-saves never re-send a push already delivered).
 *  → { slot } | { full: true } (MAX_WATCHES live, none on this side). */
async function saveWatch(key, base, spot, { atBase = false, legacy = false }, record) {
  for (let i = 0; i < 3; i++) {
    const slots = await readWatches(key, base);
    const car = atBase && slots.find((s) => s.rec && s.rec.car);
    const pick = car ? { n: car.n, keep: true } : legacy ? pickLegacy(slots, spot) : pickSlot(slots, spot);
    if (!pick) return { full: true };
    const s = slots[pick.n], prev = pick.keep ? s.rec : null;
    const out = carryForward(prev, spot);
    // savedAt = the last time the CLIENT armed/refreshed this watch with live data. The cron stops
    // re-arming once a watch goes stale past MAX_WATCH_AGE (api/_schedule.js) so a frozen rule can't push
    // wrong times forever after a city schedule change. advanceSpot preserves it.
    const value = JSON.stringify({ ...record(pick.n, out, prev ? notifiedMap(prev) : {}), ...(atBase ? { car: true } : {}) });
    if (!(await claimField(key, s.field, s.raw, value))) continue;
    if ((atBase || legacy) && spot) {
      // turned off: legacy → every other armed watch; atBase → another armed watch on the car's side
      const goes = (rec) => Boolean(rec.spot) && (legacy || sameSide(rec.spot, spot));
      for (const t of await readWatches(key, base)) {
        if (t.n !== pick.n && t.rec && goes(t.rec)) await casUpdate(key, t.field, (rec) => (goes(rec) ? disarmRec(rec) : null));
      }
    }
    return { slot: pick.n };
  }
  throw new Error('watches kept changing during the save');
}

// Turned off: spot = null (the cron skips spot-less records), the de-dupe map kept, the side remembered.
function disarmRec(rec) {
  if (rec.spot) rec.offSide = sideOf(rec.spot);
  rec.spot = null;
  rec.notified = notifiedMap(rec);
  return rec;
}

/** Turn off the device's watch on `side` (every armed watch when side is null: a Turn off from a page
 *  that predates multi-watch meant the device). Plain write, like every user write before. */
async function disarmWatches(key, slots, side) {
  const out = {};
  for (const s of slots) {
    if (!s.rec || !s.rec.spot || (side && !sameSide(s.rec.spot, side))) continue;
    out[s.field] = JSON.stringify(disarmRec(s.rec));
  }
  if (Object.keys(out).length) await redis().hset(key, out);
}

/** Upsert a subscription + one saved spot (see saveWatch: `atBase` auto-park, `legacy` a pre-multi page).
 *  → { slot } | { full: true }. */
export async function saveSub(subscription, spot, { atBase = false, legacy = false } = {}) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  return saveWatch(KEY, subscription.endpoint, spot, { atBase, legacy },
    (n, out, notified) => ({ subscription, spot: out, notified, savedAt: Date.now() }));
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
// records, and it also covers advanceSpot, whose decision depends on the spot. A user's save goes through
// the same script (claimField: it re-reads and decides again rather than overwrite); a Turn off stays a
// plain HSET: it wins any race, losing at worst a de-dupe entry (one repeat push), as before.
// Every one of these writes one watch's field (see MAX_WATCHES), so they hold per watch.
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
    let won;
    try { won = Number(await r.eval(CAS, [key], [field, raw, JSON.stringify(next)])) === 1; }
    catch (e) {
      // Safety net, not the design: if the store ever refuses EVAL, write the way this code always did
      // (plain HSET, the old race included) rather than fail. A failed markNotified after a delivered
      // push would let the next tick repeat that push every 15 minutes.
      console.error('compare-and-set unavailable, plain write:', String(e && e.message || e).slice(0, 120));
      await r.hset(key, { [field]: JSON.stringify(next) });
      return true;
    }
    if (won) return true;
  }
  throw new Error('record kept changing during the cron write'); // like a store error: the run fails
}

/** Advance one watch (its hash `field`, from loadAllSubs) to its next computed sweep occurrence (the
 *  cron "forever-watch" re-arm), computed from `seenSpot`. Replaces the spot only if the record still
 *  holds exactly `seenSpot` (→ true); the de-dupe map is kept (its entries name the sweep they fired for,
 *  so the next sweep is free to fire). Preserves savedAt — the re-arm is clock-driven, not a fresh client
 *  refresh. */
export async function advanceSpot(field, newSpot, seenSpot) {
  return casUpdate(KEY, field, (rec) => {
    if (!sameSpot(rec.spot, seenSpot)) return null;
    rec.spot = newSpot;
    rec.notified = notifiedMap(rec);
    delete rec.notifiedFor; delete rec.notifiedEveFor;
    return rec;
  });
}

/** Load every stored watch as { field, slot, endpoint (the device), subscription, spot, notified, savedAt }.
 *  `field` addresses the watch's own record (advanceSpot / markNotified); `endpoint` the device. */
export async function loadAllSubs() {
  const r = redis();
  if (!r) return [];
  const all = await r.hgetall(KEY);
  if (!all) return [];
  return Object.entries(all)
    .map(([field, v]) => {
      const rec = typeof v === 'string' ? safeParse(v) : v; // Upstash may auto-deserialize
      if (!rec) return null;
      const { base, slot } = splitField(field);
      return { ...rec, field, slot, endpoint: base, notified: notifiedMap(rec) };
    })
    .filter(Boolean);
}

/** True if this endpoint already has a record (re-saves of a known endpoint are never throttled). */
export async function hasSub(endpoint) {
  const r = redis();
  if (!r) return false;
  return Boolean(await r.hexists(KEY, endpoint));
}

const allSlots = (base) => Array.from({ length: MAX_WATCHES }, (_, n) => slotField(base, n));

/** Remove an expired/invalid subscription with every watch on it (called on push 410/404): one HDEL. */
export async function deleteSub(endpoint) {
  const r = redis();
  if (r) await r.hdel(KEY, ...allSlots(endpoint));
}

/** Turn a web watch OFF ("✓ Alerts on" → Turn off): the one on `side` (sanitizeSide), or every watch of the
 *  device when side is null (a page from before multi-watch). Ownership = the endpoint AND its keys.auth,
 *  which only the browser holding the subscription has, compared in constant time with the stored one.
 *  Disarms (spot = null — the cron skips spot-less records) rather than deleting, so auto-park and
 *  its tokens still resolve the subscription, and the de-dupe survives turning it back on for the same
 *  sweep. Other watches are never touched. → 'ok' (also when no armed watch is on that side) |
 *  'not-found' | 'forbidden'. */
export async function disarmSub(endpoint, auth, side = null) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  const slots = await readWatches(KEY, endpoint);
  const owner = slots.find((s) => s.rec); // watch 0 first
  if (!owner) return 'not-found';
  const a = Buffer.from(String(auth || '')), b = Buffer.from(String(owner.rec.subscription?.keys?.auth || ''));
  if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) return 'forbidden';
  await disarmWatches(KEY, slots, side);
  return 'ok';
}

/** Record that we already pushed one watch (its hash `field`) for a given sweep time and touchpoint, so
 *  the cron won't repeat it. */
export async function markNotified(field, nextSweepISO, key = 'lead') {
  await casUpdate(KEY, field, (rec) => {
    rec.notified = notifiedMap(rec);
    rec.notified[key] = nextSweepISO;
    delete rec.notifiedFor; delete rec.notifiedEveFor; // migrate off the legacy fields once touched
    return rec;
  });
}

/** Load a device's watch-0 record by endpoint (auto-park resolves the subscription with it), or null. */
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
// Watches as in curb:subs: watch 0 at `<token>`, watch n at `<token>#<n>`. Watch n's record carries NO
// `token` property (the field names the device): code from before multi-watch, should it ever run against
// these records again (a rollback), reads the field as the token, which APNs refuses, instead of sending
// with the real token and marking the de-dupe on watch 0, which would repeat that push every tick.
const KEY_IOS = 'curb:apns';

/** Upsert an APNs device token + one saved spot. Mirrors saveSub (see saveWatch; `legacy` = a page from
 *  before multi-watch, in the app's web view). → { slot } | { full }. */
export async function saveIosSub(token, spot, { legacy = false } = {}) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  return saveWatch(KEY_IOS, token, spot, { legacy },
    (n, out, notified) => ({ ...(n ? {} : { token }), spot: out, notified, savedAt: Date.now(), platform: 'ios' }));
}

/** Advance one iOS watch (its hash `field`) to its next computed occurrence (forever-watch re-arm). Like
 *  advanceSpot: only while the record still holds exactly `seenSpot` (→ true). */
export async function advanceIosSpot(field, newSpot, seenSpot) {
  return casUpdate(KEY_IOS, field, (rec) => {
    if (!sameSpot(rec.spot, seenSpot)) return null;
    rec.spot = newSpot;
    rec.notified = notifiedMap(rec);
    delete rec.notifiedFor; delete rec.notifiedEveFor;
    return rec;
  });
}

/** Load every iOS watch as { field, slot, token (the device), spot, notified, savedAt }. */
export async function loadAllIosSubs() {
  const r = redis();
  if (!r) return [];
  const all = await r.hgetall(KEY_IOS);
  if (!all) return [];
  return Object.entries(all)
    .map(([field, v]) => {
      const rec = typeof v === 'string' ? safeParse(v) : v;
      if (!rec) return null;
      const { base, slot } = splitField(field);
      return { ...rec, field, slot, token: base, notified: notifiedMap(rec) };
    })
    .filter(Boolean);
}

/** True if this APNs token already has a record (re-saves of a known token are never throttled). */
export async function hasIosSub(token) {
  const r = redis();
  if (!r) return false;
  return Boolean(await r.hexists(KEY_IOS, token));
}

/** Remove a dead APNs token with every watch on it (called on 410 Unregistered / 400 BadDeviceToken). */
export async function deleteIosSub(token) {
  const r = redis();
  if (r) await r.hdel(KEY_IOS, ...allSlots(token));
}

/** Turn an iOS watch OFF: the one on `side`, or every watch of the token when side is null (the page's
 *  {off:true} before multi-watch). Like disarmSub: spot = null (the cron skips it) and the de-dupe map is
 *  kept, so turning alerts back on for the same sweep can't re-send a push already delivered. An unknown
 *  token stores nothing. */
export async function disarmIosSub(token, side = null) {
  const r = redis();
  if (!r) throw new Error('store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)');
  await disarmWatches(KEY_IOS, await readWatches(KEY_IOS, token), side);
}

/** Record that we already pushed one iOS watch (its hash `field`) for a given sweep time (per-window de-dupe). */
export async function markIosNotified(field, nextSweepISO, key = 'lead') {
  await casUpdate(KEY_IOS, field, (rec) => {
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
// `delivery` = the sender's rolling view of whether pushes actually arrive (judgeDelivery in
// send-notifications): the last few devices tried per channel, each as an 8-hex hash of its endpoint or
// token (only to tell devices apart) with ok or the failure status, plus `failing` while it judges a
// channel broken. Rewritten by every full run, in the same HSET.
const CKEY = 'curb:cron';

/** Record one sender run: { at, trigger, outcome: 'ok'|'error'|'skipped', ... } (+ the delivery window). */
export async function saveRunStatus(status, delivery) {
  const r = redis();
  if (!r) return;
  const v = JSON.stringify(status);
  const fields = status.outcome === 'ok' ? { last: v, ok: v } : { last: v };
  if (status.trigger === 'qstash') {
    fields.qstash = JSON.stringify({ at: status.at, ok: status.outcome !== 'error',
      ...(status.outcome === 'skipped' ? { skipped: true } : {}), ...(status.error ? { error: status.error } : {}) });
    if (status.outcome === 'ok') fields.qstashOk = JSON.stringify({ at: status.at });
  }
  if (delivery) fields.delivery = JSON.stringify(delivery);
  await r.hset(CKEY, fields);
}

/** The stored delivery window, or null (the one extra read a full run makes). */
export async function loadDelivery() {
  const r = redis();
  if (!r) return null;
  const v = await r.hget(CKEY, 'delivery');
  return (typeof v === 'string' ? safeParse(v) : v) || null;
}

/** { last, lastOk, lastQstash, lastQstashOk, delivery } — any may be null before the first such run. */
export async function loadRunStatus() {
  const r = redis();
  if (!r) return { last: null, lastOk: null, lastQstash: null, lastQstashOk: null, delivery: null };
  const all = (await r.hgetall(CKEY)) || {};
  const parse = (v) => (typeof v === 'string' ? safeParse(v) : v) || null;
  return { last: parse(all.last), lastOk: parse(all.ok), lastQstash: parse(all.qstash), lastQstashOk: parse(all.qstashOk), delivery: parse(all.delivery) };
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
