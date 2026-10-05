// Re-arm logic for the push "forever-watch" — kept pure (a helper, not a routed function) so it
// can be unit-tested under frozen clocks without touching the store or web-push.
//
// Side-effect import: the SF time core attaches nextSweep/alertAnchors to globalThis.
import '../lib/sweep-core.js';
import { sanitizeRule, sanitizeRules } from './_spot.js';
const { nextSweep, alertAnchors, isHolidayRow } = globalThis;

// A forever-watch stops auto-advancing once it hasn't been refreshed (by reopening the app with live data)
// for this long, so a frozen rule can't push wrong times forever after a city schedule change. One value for
// the sender (stops the re-arm) and the store (such a watch, once its sweep is over, frees its slot).
export const MAX_WATCH_AGE = 120 * 864e5; // ~120 days

// The side's rules: its weekday rows plus its posted holiday schedule ('holiday', api/_spot.js), which
// nextSweep places only on minor holidays, when the weekday rows are stopped (lib/sweep-core.js).
const rulesOf = (spot) => (Array.isArray(spot.rules) && spot.rules.length ? spot.rules : spot.rule ? [spot.rule] : []);

/** A watch saved before the holiday model (2026-10-05) has no Holiday rule even on a side that posts one: the
 *  page and server of the time dropped DataSF's weekday 'Holiday' row. Without it the re-arm skips the minor
 *  holiday and that side loses its holiday push. Returns the spot with its side's Holiday rules added, from
 *  `holidayRows(cnn)` (data/schedules.json rows [side, 7, fromH, toH, weeksMask, holidays]), or the same spot
 *  when it already has one, names no block, or its side posts no holiday schedule. The side is the stored
 *  blockside, case-insensitive (baked 'Northeast', DataSF 'NorthEast'); without one, the sideKey ('Northeas',
 *  clamped to 8 by sanitizeSpot) as the start of a baked side name, and a cnnrightleft key ('L', 'R', 'C')
 *  matches the rows DataSF gave no blockside. Pure; the cron persists the result only through an advance. */
export function withHolidayRules(spot, holidayRows) {
  if (!spot || !spot.cnn) return spot;
  const rules = rulesOf(spot);
  if (!rules.length || rules.some(isHolidayRow)) return spot;
  const rows = holidayRows(spot.cnn);
  if (!rows || !rows.length) return spot;
  const b = String(spot.blockside || '').toLowerCase(), k = String(spot.sideKey || '').toLowerCase();
  const onSide = (side) => {
    const s = String(side || '').toLowerCase();
    return b ? s === b : k.length > 1 ? s.startsWith(k) : s === '';
  };
  const bit = (mask, i) => ((mask >> i) & 1 ? '1' : '0');
  const add = rows.filter((r) => onSide(r[0])).map(([, , from, to, mask, hol]) => sanitizeRule({ weekday: 'Holiday', fromhour: from, tohour: to,
    week1: bit(mask, 0), week2: bit(mask, 1), week3: bit(mask, 2), week4: bit(mask, 3), week5: bit(mask, 4), holidays: hol ? '1' : '0' })).filter(Boolean);
  return add.length ? { ...spot, rules: sanitizeRules([...rules, ...add]) } : spot;
}
// How long the stored sweep can last: the longest window among the side's rules (SF's longest is 6 h); a
// day for a spot that carries no rule, whose window nobody knows.
function windowMs(rules) {
  if (!rules.length) return 864e5;
  let h = 1;
  for (const r of rules) {
    const from = parseInt(r.fromhour, 10), to = parseInt(r.tohour, 10);
    if (!Number.isNaN(from) && !Number.isNaN(to)) h = Math.max(h, to - from);
  }
  return h * 36e5;
}

/** True for an armed watch that can never push again and only holds one of the device's slots: one the
 *  cron no longer re-arms (savedAt older than MAX_WATCH_AGE) or a one-shot spot with no rule (nothing
 *  re-arms it), once its current sweep window is over. A watch whose window hasn't ended is never dead. */
export function watchDead(rec, now = Date.now()) {
  const spot = rec && rec.spot;
  if (!spot) return false;
  const rules = rulesOf(spot), start = Date.parse(spot.nextSweepISO);
  if (Number.isFinite(start) && now < start + windowMs(rules)) return false;
  return !rules.length || Boolean(rec.savedAt && now - rec.savedAt >= MAX_WATCH_AGE);
}

/** Given a stored spot carrying its recurring `rules` (or a legacy single `rule`), return an ADVANCED
 *  spot when the sweep has rolled to a new occurrence — the EARLIEST next sweep across the rules no
 *  longer matches spot.nextSweepISO — else null. The earliest next occurrence never moves earlier, so
 *  this can't flap; an overlapping second window that has already started gets no lead push.
 *  Pure w.r.t. the clock: nextSweep() reads the current time, so freeze it in tests.
 *
 *  Correctness note (the trap): at ~30-min-lead time nextSweep() still returns the SAME instant,
 *  so this returns null then — the advance only happens on the first tick AFTER the window ends,
 *  when nextSweep() skips today and rolls forward. Re-arm must therefore be its own pass, never
 *  coupled to "right after the lead push fired". */
export function recomputeSpot(spot) {
  if (!spot) return null;
  const rules = rulesOf(spot);
  let ns = null;
  for (const r of rules) {
    const n = nextSweep(r);
    if (n && (!ns || +n.start < +ns.start)) ns = n;
  }
  if (!ns) return null; // no occurrence within nextSweep's 150-day scan (e.g. a rule the city dropped)
  const iso = ns.start.toISOString();
  if (iso === spot.nextSweepISO) return null; // unchanged — nothing to advance
  // Anchors from the ONE rule the page also uses (lib/sweep-core.js alertAnchors): eve = 8pm SF the
  // evening before; morn only when start−2h lands 06:00-21:59 SF on the sweep day. A night sweep
  // (before 7am) carries neither — it gets the "tonight" push, derived at send time.
  const a = alertAnchors(ns.start);
  const out = { ...spot, nextSweepISO: iso };
  if (!a.night && +a.eve < +ns.start) out.eveningISO = a.eve.toISOString();
  else delete out.eveningISO;
  if (!a.night && a.morn) out.morningISO = a.morn.toISOString();
  else delete out.morningISO;
  return out;
}
