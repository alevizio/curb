// Tests for lib/notify-core.js — run with the repo runner: `npm run test` (vitest).
// Frozen-clock proofs that each intensity level fires EXACTLY the right touchpoints with the right
// copy, de-dupes, and degrades gracefully. No store, no network — pure.
import { test, expect } from 'vitest';
import {
  dueAlert, plannedTimeline, renderOne, sfHour, touchpointsFor,
  LEVELS, VOICES, normLevel, normVoice, VALID_LEVELS, VALID_VOICES,
} from './notify-core.js';

// Steiner St, swept 9:00 AM PDT Thu Jun 19 2026. eve = 8pm PDT the night before; morn = 7am PDT.
const BASE = {
  corridor: 'Steiner St', blockside: 'North',
  nextSweepISO: '2026-06-19T16:00:00.000Z', // 9:00 AM PDT
  eveningISO:   '2026-06-19T03:00:00.000Z', // 8:00 PM PDT Jun 18
  morningISO:   '2026-06-19T14:00:00.000Z', // 7:00 AM PDT Jun 19
  leadMinutes: 30, tip: '9:11am',
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
  expect(dueAlert(spot({ level: 'normal', voice: 'deadpan' }), {}, T_EVE).body).toMatch(/9:11am/);
});

test('intense escalates the lead copy vs normal (same voice)', () => {
  const normal = dueAlert(spot({ level: 'normal', voice: 'cheeky' }), {}, T_LEAD).title;
  const intense = dueAlert(spot({ level: 'intense', voice: 'cheeky' }), {}, T_LEAD).title;
  expect(normal).not.toBe(intense);
});

// ---- ticket-data flex ----
test('tip is woven in when present, gracefully absent otherwise', () => {
  expect(dueAlert(spot({ level: 'normal', voice: 'deadpan' }), {}, T_EVE).body).toMatch(/Tickets here usually land ~9:11am/);
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

// ---- night sweeps (start before 07:00 SF): ONE "move it tonight" push, every level ----
// Midnight Fri Jun 19 2026 PDT = 07:00Z; 6 AM = 13:00Z. Tonight anchor = 9 PM PDT Jun 18 = 04:00Z Jun 19.
const NIGHT = (h, over = {}) => ({
  corridor: 'Mission St', blockside: 'East', leadMinutes: 30,
  nextSweepISO: new Date(Date.UTC(2026, 5, 19, 7 + h)).toISOString(),
  // what an old client / pre-fix re-arm stored for a night sweep: 8pm eve + a start−2h "morning-of"
  eveningISO: '2026-06-19T03:00:00.000Z', morningISO: new Date(Date.UTC(2026, 5, 19, 5 + h)).toISOString(),
  ...over,
});

test('night sweep: every level plans only the 9 PM tonight push', () => {
  for (const h of [0, 2, 6]) for (const level of VALID_LEVELS) {
    const plan = plannedTimeline(NIGHT(h, { level }));
    expect(plan.map((t) => t.key), `${h} AM ${level}`).toEqual(['tonight']);
    expect(plan[0].fireAtISO).toBe('2026-06-19T04:00:00.000Z');
  }
});

test('night sweep: tonight fires from 9 PM, not the 8 PM eve, not the 30-min lead, not a 10 PM "sweep today"', () => {
  const s = NIGHT(0, { level: 'intense' });
  expect(dueAlert(s, {}, at('2026-06-19T03:10:00Z'))).toBe(null);            // 8:10 PM: no eve
  const due = dueAlert(s, {}, at('2026-06-19T04:05:00Z'));                    // 9:05 PM
  expect(due.key).toBe('tonight');
  expect(due.title).toBe('🌙 Move it tonight');
  expect(due.body).toMatch(/midnight/);
  expect(dueAlert(s, { tonight: s.nextSweepISO }, at('2026-06-19T05:05:00Z'))).toBe(null); // 10:05 PM, already sent
  expect(dueAlert(s, { tonight: s.nextSweepISO }, at('2026-06-19T06:35:00Z'))).toBe(null); // 11:35 PM: no lead
});

test('night sweep: a late arm still gets it until shortly before the sweep', () => {
  const s = NIGHT(6, { level: 'light' });
  expect(dueAlert(s, {}, at('2026-06-19T09:00:00Z'))?.key).toBe('tonight');   // 2 AM
  expect(dueAlert(s, {}, at('2026-06-19T12:54:00Z'))?.key).toBe('tonight');   // 5:54 AM, 6 min left
  expect(dueAlert(s, {}, at('2026-06-19T12:57:00Z'))).toBe(null);             // 3 min left: too late
  expect(dueAlert(s, {}, at('2026-06-19T13:30:00Z'))).toBe(null);             // sweeping
});

test('night sweep: a push already sent for it by the old cadence blocks a second one', () => {
  const s = NIGHT(0);
  for (const k of ['eve', 'morn', 'lead']) expect(dueAlert(s, { [k]: s.nextSweepISO }, at('2026-06-19T04:05:00Z')), k).toBe(null);
});

test('tonight copy per voice stays on budget and never says "today" or "tomorrow"', () => {
  for (const voice of VALID_VOICES) for (const h of [0, 4]) {
    const t = plannedTimeline(NIGHT(h, { voice, tip: '12:40am' }))[0];
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.body.length).toBeLessThan(178);
    expect(`${t.title} ${t.body}`).not.toMatch(/today|tomorrow/i);
    expect(`${t.title} ${t.body}`).toMatch(h === 0 ? /midnight/ : /4 AM/);
  }
});

// ---- morning-of only when start−2h lands 06:00-21:59 SF on the sweep day (send-time guard) ----
test('7 AM sweep: a stored 5 AM morning-of never fires; 8 AM keeps its 6 AM one', () => {
  const s7 = spot({ level: 'intense', nextSweepISO: '2026-06-19T14:00:00.000Z', morningISO: '2026-06-19T12:00:00.000Z' });
  expect(dueAlert(s7, {}, at('2026-06-19T12:05:00Z'))).toBe(null);
  expect(plannedTimeline(s7).map((t) => t.key)).toEqual(['eve', 'lead']);
  const s8 = spot({ level: 'intense', nextSweepISO: '2026-06-19T15:00:00.000Z', morningISO: '2026-06-19T13:00:00.000Z' });
  expect(dueAlert(s8, {}, at('2026-06-19T13:05:00Z'))?.key).toBe('morn');
});

// ---- widened night-before window + late-lead skip ----
test('eve stays eligible until 11 PM (a late tick still delivers it), not after', () => {
  expect(dueAlert(spot(), {}, at('2026-06-19T05:50:00Z'))?.key).toBe('eve'); // 10:50 PM
  expect(dueAlert(spot(), {}, at('2026-06-19T06:05:00Z'))).toBe(null);       // 11:05 PM
});

test('lead is skipped with under 5 min to go', () => {
  expect(dueAlert(spot(), {}, at('2026-06-19T15:55:00Z'))?.key).toBe('lead'); // 5 min left
  expect(dueAlert(spot(), {}, at('2026-06-19T15:56:00Z'))).toBe(null);        // 4 min left
});

// ---- delivery deadline + urgency (web TTL / apns-expiration) ----
test('expiresAt: lead + tonight at the sweep, morn when the lead window opens, eve at SF midnight', () => {
  for (const leadMinutes of [15, 30, 60]) {
    const s = spot({ level: 'intense', leadMinutes });
    const sweep = at(BASE.nextSweepISO), leadMs = leadMinutes * 60000;
    expect(dueAlert(s, {}, sweep - leadMs + 60000).expiresAt).toBe(sweep);
    expect(dueAlert(s, {}, T_MORN).expiresAt).toBe(sweep - leadMs);
    expect(dueAlert(s, {}, T_EVE).expiresAt).toBe(at('2026-06-19T07:00:00Z')); // midnight PDT
  }
  const n = NIGHT(0);
  expect(dueAlert(n, {}, at('2026-06-19T04:05:00Z')).expiresAt).toBe(at(n.nextSweepISO));
});

test('urgent (high urgency + stays on screen) only for lead and tonight', () => {
  const s = spot({ level: 'intense' });
  expect(dueAlert(s, {}, T_LEAD).urgent).toBe(true);
  expect(dueAlert(s, {}, T_MORN).urgent).toBe(false);
  expect(dueAlert(s, {}, T_EVE).urgent).toBe(false);
  expect(dueAlert(NIGHT(0), {}, at('2026-06-19T04:05:00Z')).urgent).toBe(true);
});

test('DST fall-back weekend: eve Sun 8 PM PST expires at Mon 00:00 PST', () => {
  // Mon 2026-11-02 8 AM PST = 16:00Z; eve Sun 11-01 8 PM PST = 04:00Z Nov 2
  const s = spot({ nextSweepISO: '2026-11-02T16:00:00.000Z', eveningISO: '2026-11-02T04:00:00.000Z', morningISO: '2026-11-02T14:00:00.000Z', level: 'intense' });
  const eve = dueAlert(s, {}, at('2026-11-02T04:05:00Z'));
  expect(eve.key).toBe('eve');
  expect(eve.expiresAt).toBe(at('2026-11-02T08:00:00Z'));
  expect(dueAlert(s, {}, at('2026-11-02T14:05:00Z'))?.key).toBe('morn'); // 6:05 AM PST
});

test('touchpointsFor: the level cadence, or just tonight for a night sweep', () => {
  expect(touchpointsFor('intense', BASE.nextSweepISO)).toEqual(['eve', 'morn', 'lead']);
  expect(touchpointsFor('light', NIGHT(0).nextSweepISO)).toEqual(['tonight']);
  // 7 AM: start−2h is 5 AM, which never fires — the test push must not preview it
  expect(touchpointsFor('intense', '2026-06-19T14:00:00.000Z')).toEqual(['eve', 'lead']);
  expect(touchpointsFor('intense', '2026-06-19T15:00:00.000Z')).toEqual(['eve', 'morn', 'lead']); // 8 AM keeps 6 AM
});
