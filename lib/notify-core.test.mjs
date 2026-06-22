// Tests for lib/notify-core.js — run with the repo runner: `npm run test` (vitest).
// Frozen-clock proofs that each intensity level fires EXACTLY the right touchpoints with the right
// copy, de-dupes, and degrades gracefully. No store, no network — pure.
import { test, expect } from 'vitest';
import {
  dueAlert, plannedTimeline, renderOne, sfHour,
  LEVELS, VOICES, normLevel, normVoice, VALID_LEVELS, VALID_VOICES,
} from './notify-core.js';

// Steiner St, swept 9:00 AM PDT Thu Jun 19 2026. eve = 8pm PDT the night before; morn = 7am PDT.
const BASE = {
  corridor: 'Steiner St', blockside: 'North',
  nextSweepISO: '2026-06-19T16:00:00.000Z', // 9:00 AM PDT
  eveningISO:   '2026-06-19T03:00:00.000Z', // 8:00 PM PDT Jun 18
  morningISO:   '2026-06-19T14:00:00.000Z', // 7:00 AM PDT Jun 19
  leadMinutes: 30, tip: '9:14am',
};
const spot = (over = {}) => ({ ...BASE, ...over });
const at = (iso) => Date.parse(iso);

const T_EVE     = at('2026-06-19T03:05:00Z'); // inside eve window
const T_MORN    = at('2026-06-19T14:05:00Z'); // inside morn window
const T_LEAD    = at('2026-06-19T15:40:00Z'); // 20 min before sweep
const T_BETWEEN = at('2026-06-19T10:00:00Z'); // no window
const T_AFTER   = at('2026-06-19T16:30:00Z'); // sweep already passed

// ---- time formatting ----
test('sfHour renders SF wall-clock and trims :00', () => {
  expect(sfHour('2026-06-19T16:00:00Z')).toBe('9 AM');
  expect(sfHour('2026-06-19T16:30:00Z')).toBe('9:30 AM');
  expect(sfHour('2026-06-19T19:00:00Z')).toBe('12 PM');
  expect(sfHour('not-a-date')).toBe('');
});

// ---- cadence: which touchpoints each level plans ----
test('level → planned touchpoints', () => {
  expect(plannedTimeline(spot({ level: 'light' })).map(t => t.key)).toEqual(['lead']);
  expect(plannedTimeline(spot({ level: 'normal' })).map(t => t.key)).toEqual(['eve', 'lead']);
  expect(plannedTimeline(spot({ level: 'intense' })).map(t => t.key)).toEqual(['eve', 'morn', 'lead']);
});

test('plannedTimeline is sorted by fire time', () => {
  const times = plannedTimeline(spot({ level: 'intense' })).map(t => Date.parse(t.fireAtISO));
  expect(times).toEqual([...times].sort((a, b) => a - b));
});

// ---- dueAlert: night-before window ----
test('eve fires for normal + intense, not light', () => {
  expect(dueAlert(spot({ level: 'normal' }), {}, T_EVE)?.key).toBe('eve');
  expect(dueAlert(spot({ level: 'intense' }), {}, T_EVE)?.key).toBe('eve');
  expect(dueAlert(spot({ level: 'light' }), {}, T_EVE)).toBe(null);
});

// ---- dueAlert: morning-of window ----
test('morn fires only for intense', () => {
  expect(dueAlert(spot({ level: 'intense' }), {}, T_MORN)?.key).toBe('morn');
  expect(dueAlert(spot({ level: 'normal' }), {}, T_MORN)).toBe(null);
  expect(dueAlert(spot({ level: 'light' }), {}, T_MORN)).toBe(null);
});

// ---- dueAlert: 30-min lead window (all levels) ----
test('lead fires at every level with a sane countdown', () => {
  for (const level of VALID_LEVELS) {
    const due = dueAlert(spot({ level }), {}, T_LEAD);
    expect(due?.key, `lead should fire for ${level}`).toBe('lead');
    expect(`${due.title} ${due.body}`).toMatch(/min/); // countdown lives in title (intense) or body
    expect(`${due.title} ${due.body}`).toMatch(/20/);  // ~20 min before the 9 AM sweep
  }
});

test('lead boundary: fires at exactly leadMinutes out, not a minute earlier', () => {
  expect(dueAlert(spot(), {}, at('2026-06-19T15:30:00Z'))?.key).toBe('lead'); // delta == 30m
  expect(dueAlert(spot(), {}, at('2026-06-19T15:29:00Z'))).toBe(null);        // delta == 31m, no window
});

// ---- de-dupe ----
test('a touchpoint does not re-fire once notified for this sweep', () => {
  expect(dueAlert(spot({ level: 'normal' }), { lead: BASE.nextSweepISO }, T_LEAD)).toBe(null);
  expect(dueAlert(spot({ level: 'normal' }), { eve: BASE.nextSweepISO }, T_EVE)).toBe(null);
  // a stale dedupe value (a different/old sweep) still allows firing
  expect(dueAlert(spot({ level: 'normal' }), { lead: '2020-01-01T00:00:00Z' }, T_LEAD)?.key).toBe('lead');
});

// ---- nothing fires outside windows / after the sweep ----
test('null between windows and after the sweep', () => {
  for (const level of VALID_LEVELS) {
    expect(dueAlert(spot({ level }), {}, T_BETWEEN)).toBe(null);
    expect(dueAlert(spot({ level }), {}, T_AFTER)).toBe(null);
  }
});

test('at most one push is due on any given tick (mutual exclusivity)', () => {
  const s = spot({ level: 'intense' });
  for (const t of [T_EVE, T_MORN, T_LEAD]) {
    const keys = ['eve', 'morn', 'lead'].filter(k => {
      const d = dueAlert(s, {}, t);
      return d && d.key === k;
    });
    expect(keys.length, `exactly one due at ${new Date(t).toISOString()}`).toBe(1);
  }
});

// ---- voice personality ----
test('voice colours the copy', () => {
  expect(dueAlert(spot({ level: 'intense', voice: 'drill' }), {}, T_LEAD).title).toMatch(/NOT A DRILL/);
  expect(dueAlert(spot({ level: 'normal', voice: 'cheeky' }), {}, T_LEAD).title).toBe('🚗 Move the car');
  expect(dueAlert(spot({ level: 'normal', voice: 'deadpan' }), {}, T_EVE).body).toMatch(/9:14am/);
});

test('intense escalates the lead copy vs normal (same voice)', () => {
  const normal = dueAlert(spot({ level: 'normal', voice: 'cheeky' }), {}, T_LEAD).title;
  const intense = dueAlert(spot({ level: 'intense', voice: 'cheeky' }), {}, T_LEAD).title;
  expect(normal).not.toBe(intense);
});

// ---- ticket-data flex ----
test('tip is woven in when present, gracefully absent otherwise', () => {
  expect(dueAlert(spot({ level: 'normal', voice: 'deadpan' }), {}, T_EVE).body).toMatch(/Tickets here usually land ~9:14am/);
  const noTip = dueAlert(spot({ level: 'normal', voice: 'deadpan', tip: undefined }), {}, T_EVE).body;
  expect(noTip).not.toMatch(/~/);
  expect(noTip).toMatch(/Plan accordingly/);
});

// ---- graceful degradation ----
test('no eveningISO → eve never fires', () => {
  const s = spot({ level: 'normal', eveningISO: undefined });
  expect(dueAlert(s, {}, T_EVE)).toBe(null);
  expect(plannedTimeline(s).map(t => t.key)).toEqual(['lead']);
});

test('no morningISO → morn never fires', () => {
  const s = spot({ level: 'intense', morningISO: undefined });
  expect(dueAlert(s, {}, T_MORN)).toBe(null);
  expect(plannedTimeline(s).map(t => t.key)).toEqual(['eve', 'lead']);
});

test('unknown level/voice coerce to defaults', () => {
  expect(normLevel('zzz')).toBe('normal');
  expect(normVoice('zzz')).toBe('cheeky');
  expect(dueAlert(spot({ level: 'zzz' }), {}, T_EVE)?.key).toBe('eve'); // behaves as normal
});

test('missing/invalid spot is safe', () => {
  expect(dueAlert(null, {}, T_LEAD)).toBe(null);
  expect(dueAlert({}, {}, T_LEAD)).toBe(null);
  expect(dueAlert({ nextSweepISO: 'nope' }, {}, T_LEAD)).toBe(null);
  expect(plannedTimeline(null)).toEqual([]);
});

// ---- push payload sanity (lock-screen length budget) ----
test('every rendered push has a title and a body under the length budget', () => {
  for (const level of VALID_LEVELS) for (const voice of VALID_VOICES) {
    for (const tp of plannedTimeline(spot({ level, voice }))) {
      expect(tp.title.length, `${level}/${voice}/${tp.key} title`).toBeGreaterThan(0);
      expect(tp.body.length, `${level}/${voice}/${tp.key} body len=${tp.body.length}`).toBeGreaterThan(0);
      expect(tp.body.length, `${level}/${voice}/${tp.key} body len=${tp.body.length}`).toBeLessThan(178);
      expect(tp.tag).toBeTruthy();
    }
  }
});

// ---- renderOne (the test-push endpoint) ----
test('renderOne renders a chosen touchpoint with an explicit countdown', () => {
  const r = renderOne(spot(), 'lead', { level: 'intense', voice: 'drill', mins: 30 });
  expect(r.title).toMatch(/30/);
  expect(r.title).toMatch(/NOT A DRILL/);
  expect(r.tag).toBe('curb-sweep');
});

test('metadata lists are coherent', () => {
  expect(VALID_LEVELS).toEqual(Object.keys(LEVELS));
  expect(VALID_VOICES).toEqual(Object.keys(VOICES));
});
