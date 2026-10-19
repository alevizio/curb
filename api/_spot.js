// Shared spot/rule sanitizers — the single source of truth for the exact shape the cron expects.
// Imported by BOTH api/save-subscription.js (web push) and api/save-ios-subscription.js (APNs), so
// the two transports can never silently diverge on what counts as a valid forever-watch rule.
//
// Files prefixed with "_" are helpers (not routed as functions) — import-only.
//
// Side-effect import: attaches the SF time core (normDay/nextSweep/…) to globalThis so we can
// validate an incoming recurrence rule with the EXACT guards the cron's nextSweep() uses.
import '../lib/sweep-core.js';
import { normLevel, normVoice } from '../lib/notify-core.js';
import { CITIES } from '../lib/cities.js';
const normDay = globalThis.normDay, toHours = globalThis.toHours;

// A window end as the rule stores it: a whole hour exactly as before ("8"), or a time with minutes ("9:30", the
// other cities' data, docs/multi-city/city-build.md). null when unreadable.
function canonTime(v) {
  const h = toHours(v);
  if (Number.isNaN(h) || h < 0 || h > 24) return null;
  const hr = Math.floor(h), mi = Math.round((h - hr) * 60);
  return mi ? hr + ':' + String(mi).padStart(2, '0') : String(hr);
}
// A rule on listed dates (cities that publish dates, not a weekday pattern): valid dates, deduplicated, in order. Room for
// a season of side-switching nights (Madison: 62 odd dates from November 15 to March 15; Milwaukee's year-round lists, sent
// from today on, 96 closings cover about six months, past a watch's 165-day age).
export const MAX_DATES = 96;
const listedDates = (v) => (Array.isArray(v) ? [...new Set(v.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).map(String))].sort().slice(0, MAX_DATES) : null);

// A recurring sweep rule the cron can recompute the next occurrence from (the "forever-watch").
// Validated with nextSweep's own guards (weekday must normalize, fromhour must parse) — anything
// off returns null and the sub degrades to a pure one-shot. latlng is NEVER accepted (privacy:
// precise coords stay client-only in localStorage). A side's weekday 'Holiday' row (its posted holiday
// schedule, sweeping on minor holidays only) is a rule like any other, stored as 'holiday'.
const LABEL = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'holiday']; // index = normDay (7 = Holiday)
export function sanitizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const dates = listedDates(rule.dates);
  if (dates && !dates.length) return null;
  const dow = dates ? null : normDay(rule.weekday);
  if (!dates && (dow === null || !LABEL[dow])) return null;
  const from = canonTime(rule.fromhour);
  if (from === null) return null;
  const fromH = parseInt(from, 10);
  const to = canonTime(rule.tohour);
  const bit = (v) => (String(v) === '1' ? '1' : '0');
  const out = {
    // store a canonical label (never arbitrary client text); guard above ensures a valid index
    ...(dates ? { dates } : { weekday: LABEL[dow] }),
    fromhour: from,
    // an end of 0 or none: one hour after the start, as always
    tohour: to !== null && to !== '0' ? to : String(fromH + 1),
    week1: bit(rule.week1), week2: bit(rule.week2), week3: bit(rule.week3),
    week4: bit(rule.week4), week5: bit(rule.week5),
    holidays: bit(rule.holidays),
  };
  // a rule that runs on holidays anyway (1), a side-switching rule, applied only while the City enforces it (4; lib/city.js),
  // one closing both sides (8), or a City crew sweep that the City's other holidays stop too (16); absent on every San
  // Francisco and Boston rule
  const flags = Number(rule.flags) & 29;
  if (flags) out.flags = flags;
  // A seasonal rule's months (Boston sweeps April to November): kept only when they leave some month out, so a
  // rule swept all year, every SF rule among them, stores exactly as before.
  const months = Array.isArray(rule.months) ? [...new Set(rule.months.map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b) : [];
  if (months.length && months.length < 12) out.months = months;
  return out;
}

// The cities a spot can name (lib/cities.js); no city is San Francisco, and an unknown one is refused rather than
// timed as SF.
const CITY_IDS = Object.keys(CITIES).filter((id) => id !== 'sf');
const cityField = (v) => (CITY_IDS.includes(v) ? { city: v } : {});
// A block id as its city writes it: San Francisco's and Boston's are digits (kept exactly as before); the other
// cities keep their own ids, which can carry letters and dashes (San Diego "SS-018818", Oakland "395510630-1").
const blockId = (v, city) => (city !== 'boston' && CITY_IDS.includes(city)
  ? String(v || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 40)
  : String(v || '').replace(/[^0-9]/g, '').slice(0, 12));
const unknownCity = (v) => v != null && v !== '' && !CITY_IDS.includes(v);

// Every rule of the curb side: a quarter of SF sides are swept on several days (or on one weekday split
// across week bits), and a single `rule` alerted on only one of them. The cron re-arms to the EARLIEST
// next sweep across all of them, the side's holiday schedule (weekday 'Holiday', ~590 blocks) included.
// Invalid rows are dropped one by one, duplicates collapse, and the list is capped — 30 real sides have
// 12 distinct weekly rules, 13 with a holiday schedule.
export const MAX_RULES = 16;
export function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [], seen = new Set();
  for (const r of rules) {
    const c = sanitizeRule(r);
    if (!c) continue;
    const k = JSON.stringify(c);
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

// The curb side a Turn off names ({ off:true, cnn, sideKey, corridor, limits, blockside } from the iOS
// bridge, or the web DELETE's `spot`), clamped exactly like sanitizeSpot so it compares equal to the
// stored spot of that side. null when it names nothing: a page from before multi-watch, whose Turn off
// means every watch on the device.
export function sanitizeSide(spot) {
  if (!spot || typeof spot !== 'object') return null;
  const t = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const side = {
    cnn: blockId(spot.cnn, spot.city),
    sideKey: t(spot.sideKey, 8),
    corridor: t(spot.corridor, 120),
    limits: t(spot.limits, 120),
    blockside: t(spot.blockside, 60),
    ...cityField(spot.city),
  };
  return side.cnn || side.corridor || side.limits || side.blockside ? side : null;
}

// Coerce/clamp the untrusted spot into the exact shape the cron expects, or null if unusable.
export function sanitizeSpot(spot) {
  if (!spot || typeof spot !== 'object') return null;
  const t = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ts = Date.parse(spot.nextSweepISO);
  if (!Number.isFinite(ts)) return null; // no valid sweep time => nothing for the cron to fire on
  if (unknownCity(spot.city)) return null;
  let lead = Number(spot.leadMinutes);
  if (!Number.isFinite(lead)) lead = 30;
  // Floor at 15 (the cron interval) so the lead window can never be narrower than a tick gap and get
  // skipped; cap at 60 so it stays well under the morning-of anchor (120 min) and that window survives.
  lead = Math.min(60, Math.max(15, Math.round(lead)));
  // optional night-before push: must parse and precede the sweep itself
  const ev = Date.parse(spot.eveningISO);
  const out = {
    corridor: t(spot.corridor, 120),
    limits: t(spot.limits, 120),
    blockside: t(spot.blockside, 60),
    nextSweepISO: new Date(ts).toISOString(),
    leadMinutes: lead,
    ...cityField(spot.city),
  };
  if (Number.isFinite(ev) && ev < ts) out.eveningISO = new Date(ev).toISOString();
  // morning-of anchor for the Intense level (set client-side / by recomputeSpot); must precede sweep.
  const mn = Date.parse(spot.morningISO);
  if (Number.isFinite(mn) && mn < ts) out.morningISO = new Date(mn).toISOString();
  // notification dials: intensity (cadence) + voice (tone), both coerced to a known value.
  out.level = normLevel(spot.level);
  out.voice = normVoice(spot.voice);
  // optional ticket-time flex woven into copy (e.g. "9:11am") — accept ONLY a clean time string,
  // never arbitrary client text, so nothing odd can ever land in a push body.
  const tipRaw = String(spot.tip || '').trim().slice(0, 14);
  if (/^~?\d{1,2}:\d{2}\s?[ap]\.?m\.?$/i.test(tipRaw)) out.tip = tipRaw;
  // `rule` stays for back-compat (stored watches + cached pages send only it); `rules` wins when present.
  const rule = sanitizeRule(spot.rule);
  const rules = sanitizeRules(spot.rules);
  if (rule || rules.length) {
    out.rule = rule || rules[0];
    if (rules.length) out.rules = rules;
    out.cnn = blockId(spot.cnn, spot.city);
    out.sideKey = t(spot.sideKey, 8);
  }
  return out;
}
