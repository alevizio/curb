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
const normDay = globalThis.normDay;

// A recurring sweep rule the cron can recompute the next occurrence from (the "forever-watch").
// Validated with nextSweep's own guards (weekday must normalize, fromhour must parse) — anything
// off returns null and the sub degrades to a pure one-shot. latlng is NEVER accepted (privacy:
// precise coords stay client-only in localStorage).
export function sanitizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  if (normDay(rule.weekday) === null) return null;
  const fromH = parseInt(rule.fromhour, 10);
  if (Number.isNaN(fromH)) return null;
  const bit = (v) => (String(v) === '1' ? '1' : '0');
  return {
    // store a canonical 3-char label (never arbitrary client text); guard above ensures a valid index
    weekday: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][normDay(rule.weekday)],
    fromhour: String(fromH),
    tohour: String(parseInt(rule.tohour, 10) || fromH + 1),
    week1: bit(rule.week1), week2: bit(rule.week2), week3: bit(rule.week3),
    week4: bit(rule.week4), week5: bit(rule.week5),
    holidays: bit(rule.holidays),
  };
}

// Coerce/clamp the untrusted spot into the exact shape the cron expects, or null if unusable.
export function sanitizeSpot(spot) {
  if (!spot || typeof spot !== 'object') return null;
  const t = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ts = Date.parse(spot.nextSweepISO);
  if (!Number.isFinite(ts)) return null; // no valid sweep time => nothing for the cron to fire on
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
  };
  if (Number.isFinite(ev) && ev < ts) out.eveningISO = new Date(ev).toISOString();
  // morning-of anchor for the Intense level (set client-side / by recomputeSpot); must precede sweep.
  const mn = Date.parse(spot.morningISO);
  if (Number.isFinite(mn) && mn < ts) out.morningISO = new Date(mn).toISOString();
  // notification dials: intensity (cadence) + voice (tone), both coerced to a known value.
  out.level = normLevel(spot.level);
  out.voice = normVoice(spot.voice);
  // optional ticket-time flex woven into copy (e.g. "9:14am") — accept ONLY a clean time string,
  // never arbitrary client text, so nothing odd can ever land in a push body.
  const tipRaw = String(spot.tip || '').trim().slice(0, 14);
  if (/^~?\d{1,2}:\d{2}\s?[ap]\.?m\.?$/i.test(tipRaw)) out.tip = tipRaw;
  const rule = sanitizeRule(spot.rule);
  if (rule) {
    out.rule = rule;
    out.cnn = String(spot.cnn || '').replace(/[^0-9]/g, '').slice(0, 12);
    out.sideKey = t(spot.sideKey, 8);
  }
  return out;
}
