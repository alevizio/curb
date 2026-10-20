// Tests for lib/notify-core.js — run with the repo runner: `npm run test` (vitest).
// Frozen-clock proofs that each intensity level fires EXACTLY the right touchpoints with the right
// copy, de-dupes, and degrades gracefully. No store, no network — pure.
import { test, expect, vi } from 'vitest';
import { CITIES } from './cities.js';
import {
  dueAlert, plannedTimeline, renderOne, sfHour, touchpointsFor, winterPlan,
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

// A side's posted holiday schedule (a 'holiday' rule) sweeps on minor holidays at its own hours: the push says so
// and leaves out the ticket tip, an average of the block's weekly sweeps at other hours.
test('holiday-schedule sweep: the push says "holiday hours" and never quotes the weekly ticket time', () => {
  const MON = { weekday: 'mon', fromhour: '2', tohour: '6', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
  const HOL = { ...MON, weekday: 'holiday', fromhour: '4', tohour: '6' };
  const hol = { corridor: 'Columbus Ave', blockside: 'Southwest', nextSweepISO: '2026-10-12T11:00:00.000Z', leadMinutes: 30, tip: '2:15am', rule: HOL, rules: [MON, HOL] };
  for (const voice of VALID_VOICES) for (const level of VALID_LEVELS) {
    const due = dueAlert({ ...hol, voice, level }, {}, at('2026-10-12T04:05:00Z'));       // Sun 10/11 9:05 PM PDT
    const text = `${due.title} ${due.body}`;
    expect(due.key, `${voice} ${level}`).toBe('tonight');
    expect(text, `${voice} ${level}`).toContain('4 AM (holiday hours)');
    expect(text, `${voice} ${level}`).not.toMatch(/2:15/);
    expect(due.body.length).toBeLessThan(178);
  }
  // the same watch on an ordinary Monday: its weekly sweep, the tip, no holiday words
  const mon = dueAlert({ ...hol, voice: 'deadpan', nextSweepISO: '2026-10-19T09:00:00.000Z' }, {}, at('2026-10-19T04:05:00Z'));
  expect(`${mon.title} ${mon.body}`).toMatch(/2 AM/);
  expect(mon.body).toContain('~2:15am');
  expect(`${mon.title} ${mon.body}`).not.toMatch(/holiday/);
  // a watch without a holiday rule is never worded as one, whatever the date
  expect(`${dueAlert({ ...hol, rules: [MON], rule: MON, voice: 'deadpan' }, {}, at('2026-10-12T04:05:00Z')).title}`).not.toMatch(/holiday/);
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

test('night sweep sent after SF midnight: the same push, worded for that morning in every voice', () => {
  for (const voice of VALID_VOICES) {
    // a 6 AM sweep armed late (the 5:00 AM tick) and a 1 AM sweep (a 12:30 AM tick)
    for (const [h, when] of [[6, '2026-06-19T12:00:00Z'], [1, '2026-06-19T07:30:00Z']]) {
      const s = NIGHT(h, { voice, level: 'light', tip: '6:20am' });
      const due = dueAlert(s, {}, at(when));
      expect(due, `${voice} ${h} AM`).toMatchObject({ key: 'tonight', tag: 'curb-sweep', urgent: true, expiresAt: Date.parse(s.nextSweepISO) });
      const text = `${due.title} ${due.body}`;
      expect(text).not.toMatch(/tonight|bed|sleep|overnight|tomorrow/i);
      expect(text).toContain(`${h} AM`);
      expect(text).toContain('Mission St');
      expect(due.body.length).toBeLessThan(178);
      expect(dueAlert(s, { tonight: s.nextSweepISO }, at(when))).toBe(null);   // de-dupe unchanged
    }
    // before midnight it is still the tonight copy, up to a midnight sweep's last eligible minute
    const nine = dueAlert(NIGHT(6, { voice }), {}, at('2026-06-19T04:05:00Z'));  // 9:05 PM
    expect(`${nine.title} ${nine.body}`).toMatch(/tonight/i);
    const late = dueAlert(NIGHT(0, { voice }), {}, at('2026-06-19T06:54:00Z'));  // 11:54 PM, midnight sweep
    expect(`${late.title} ${late.body}`).toMatch(/tonight/i);
  }
});

// Every push this module can render: each voice × level × touchpoint, plus the after-midnight
// `early` copy, with and without a ticket tip.
const everyPush = () => {
  const out = [];
  for (const voice of VALID_VOICES) for (const level of VALID_LEVELS) for (const tip of ['9:11am', undefined]) {
    const t = tip ? 'tip' : 'no tip';
    for (const tp of ['eve', 'morn', 'lead', 'tonight']) out.push({ id: `${voice}/${level}/${tp}/${t}`, ...renderOne(spot({ tip }), tp, { level, voice }) });
    out.push({ id: `${voice}/${level}/early/${t}`, ...dueAlert(NIGHT(1, { voice, level, tip }), {}, at('2026-06-19T07:30:00Z')) });
  }
  return out;
};

test('push copy uses the canonical numbers: $105 fine, ~77% in the first 45 min', () => {
  const all = everyPush();
  for (const p of all) expect(`${p.title} ${p.body}`, p.id).not.toMatch(/\$108|87%|22 min|659/);
  expect(all.find((p) => p.id === 'cheeky/intense/lead/tip').body).toMatch(/\$105 ticket/);
  expect(all.find((p) => p.id === 'deadpan/normal/morn/no tip').body).toMatch(/~77% of tickets land in the first 45 min/);
});

test('push copy has no dashes (no em/en dash, no spaced hyphen)', () => {
  for (const p of everyPush()) expect(`${p.title} ${p.body}`, p.id).not.toMatch(/[—–]| - /);
  for (const m of [...Object.values(LEVELS), ...Object.values(VOICES)]) expect(`${m.label} ${m.blurb}`).not.toMatch(/[—–]| - /);
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

// ---- Boston spots (city: 'boston'): Eastern time, Boston's fine, no SF ticket statistics ----
// A St, swept 9 AM EST Tue Nov 3 2026 (14:00Z); an overnight block swept at midnight Tue Oct 27 (04:00Z, EDT).
const BOS_DAY = { corridor: 'A St', blockside: 'Southeast', city: 'boston', nextSweepISO: '2026-11-03T14:00:00.000Z',
  eveningISO: '2026-11-03T01:00:00.000Z', morningISO: '2026-11-03T12:00:00.000Z', leadMinutes: 30, level: 'intense', voice: 'cheeky' };
const BOS_NIGHT = { corridor: 'Boylston St', blockside: 'North', city: 'boston', nextSweepISO: '2026-10-27T04:00:00.000Z', leadMinutes: 30, level: 'normal', voice: 'cheeky' };

test('Boston: the lead push names the sweep in Boston time and Boston\'s fine', () => {
  const p = dueAlert(BOS_DAY, {}, Date.parse('2026-11-03T13:35:00Z'));   // 8:35 AM in Boston
  expect(p.key).toBe('lead');
  expect(p.body).toContain('at 9 AM');
  expect(p.body).toContain('$40 ticket');
  expect(p.body).not.toContain('$105');
});
test('a city with no published fine: the lead push says "a ticket", never "a  ticket"', () => {
  CITIES.nofine = { ...CITIES.boston, id: 'nofine', fine: '' };
  try {
    const p = dueAlert({ ...BOS_DAY, city: 'nofine' }, {}, Date.parse('2026-11-03T13:35:00Z'));
    expect(p.key).toBe('lead');
    expect(p.body).toBe('A St (Southeast) sweeps at 9 AM. Last easy chance before a ticket.');
  } finally { delete CITIES.nofine; }
});
test('Boston: no SF ticket statistic in the deadpan morning push', () => {
  const p = dueAlert({ ...BOS_DAY, voice: 'deadpan' }, {}, Date.parse('2026-11-03T12:05:00Z'));   // 7:05 AM in Boston
  expect(p.key).toBe('morn');
  expect(p.body).not.toContain('77%');
  expect(p.body).toBe('A St (Southeast) sweeps today. Just saying.');
});
test('Boston: an overnight sweep gets one push from 9 PM Boston time, worded for midnight', () => {
  expect(dueAlert(BOS_NIGHT, {}, Date.parse('2026-10-27T00:55:00Z'))).toBeNull();      // 8:55 PM in Boston
  const p = dueAlert(BOS_NIGHT, {}, Date.parse('2026-10-27T01:05:00Z'));               // 9:05 PM in Boston
  expect(p.key).toBe('tonight');
  expect(p.body).toContain('at midnight');
  expect(touchpointsFor('intense', BOS_NIGHT.nextSweepISO, BOS_NIGHT)).toEqual(['tonight']);
  expect(plannedTimeline(BOS_NIGHT)[0].fireAtISO).toBe('2026-10-27T01:00:00.000Z');
});
test('Boston: after midnight in Boston the same push says "before the sweep", not "tonight"', () => {
  const late = { ...BOS_NIGHT, nextSweepISO: '2026-10-27T08:00:00.000Z' };              // a 4 AM sweep
  expect(dueAlert(late, {}, Date.parse('2026-10-27T04:30:00Z')).title).toBe('🚗 Move it before the sweep');   // 12:30 AM in Boston
});

// ---- winter alternate side parking (Madison, city.json `winter`): quiet until the City turns it on ----
const seasonDays = (odd) => { const o = []; for (let t = Date.parse('2026-11-15T12:00Z'); t <= Date.parse('2027-03-15T12:00Z'); t += 864e5) { const iso = new Date(t).toISOString().slice(0, 10); if (+iso.slice(8, 10) % 2 === (odd ? 1 : 0)) o.push(iso); } return o.slice(0, 64); };
// Jenifer St, its even side: closed 1 to 7 AM on odd dates (park on the odd side then); saved for the night of Nov 30
const WINTER_RULE = { dates: seasonDays(true), fromhour: '1', tohour: '7', week1: '0', week2: '0', week3: '0', week4: '0', week5: '0', holidays: '0', flags: 5 };
const MAD = (over = {}) => ({ corridor: 'Jenifer St', blockside: 'North', city: 'madison', cnn: 'ST1', sideKey: 'North', leadMinutes: 30, level: 'normal', voice: 'drill',
  rule: WINTER_RULE, rules: [WINTER_RULE], nextSweepISO: '2026-12-01T07:00:00.000Z', ...over });   // Tue Dec 1, 1 AM in Madison
const ON = { state: 'on', from: '2026-12-01', at: '2026-11-30T22:10:00Z', reason: 'Madison called its first plowing.' };
const withWinter = (st, t, fn) => {
  const place = CITIES.madison.place;
  place.setWinter(st); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t);
  try { fn(); } finally { place.setWinter({ state: 'waiting' }); vi.useRealTimers(); }
};

test('winter: a night Madison does not enforce sends nothing, though its stored night is due', () => {
  const t = at('2026-12-01T03:30:00Z');   // 9:30 PM Nov 30 in Madison
  withWinter({ state: 'waiting' }, t, () => {
    expect(dueAlert(MAD(), {}, t)).toMatchObject({ key: 'tonight' });   // what the gate holds back
    expect(winterPlan(MAD(), {}, t)).toEqual({ due: null });
  });
  withWinter({ state: 'paused' }, t, () => expect(winterPlan(MAD(), {}, t)).toEqual({ due: null }));
});

test('winter: once the City turns it on, one "starts tonight" push, then the night push in parking words', () => {
  const t = at('2026-11-30T22:20:00Z');   // 4:20 PM Nov 30, ten minutes after the switch
  withWinter(ON, t, () => {
    const start = winterPlan(MAD(), {}, t).due;
    expect(start).toMatchObject({ key: 'winter', tag: 'curb-winter', urgent: false, mark: '2026-12-01',
      title: 'Alternate side parking starts tonight', body: 'Madison called its first plowing. Tonight, park on the odd side, 1 to 7 AM.' });
    expect(start.expiresAt).toBe(at('2026-12-01T13:00:00Z'));   // the end of that first night, 7 AM
    // sent once: the switch's first night is the de-dupe value
    expect(winterPlan(MAD(), { winter: '2026-12-01' }, t)).toBe(null);
  });
  const nine = at('2026-12-01T03:30:00Z');   // 9:30 PM: the side closes tonight
  withWinter(ON, nine, () => {
    expect(winterPlan(MAD(), { winter: '2026-12-01' }, nine)).toBe(null);
    const p = dueAlert(MAD(), { winter: '2026-12-01' }, nine);
    expect(p).toMatchObject({ key: 'tonight', title: 'Move to the odd side tonight', body: 'Jenifer St, even side: no parking 1 to 7 AM.', urgent: true });
    for (const s of [p.title, p.body]) expect(s).not.toMatch(/[—–]| - |swept|sweep/i);
  });
  const late = at('2026-12-01T06:10:00Z');   // 12:10 AM: the same push, worded for that morning
  withWinter(ON, late, () => expect(dueAlert(MAD(), { winter: '2026-12-01' }, late)).toMatchObject({ key: 'tonight', title: 'Move to the odd side by 1 AM' }));
});

test('winter: no "starts tonight" push once that first night is over', () => {
  const t = at('2026-12-01T14:00:00Z');   // 8 AM Dec 1
  withWinter(ON, t, () => {
    const plan = winterPlan(MAD(), {}, t);
    expect(plan && plan.due && plan.due.key).not.toBe('winter');
  });
});

test('winter: a watch with no winter rule is left to the sweeping cadence', () => {
  expect(winterPlan(spot(), {}, T_LEAD)).toBe(null);
  expect(winterPlan({ ...BOS_DAY }, {}, Date.parse('2026-11-03T13:35:00Z'))).toBe(null);
});

test('winter: the "send me a test" render and the planned timeline use the parking words', () => {
  expect(renderOne(MAD(), 'tonight')).toMatchObject({ title: 'Move to the odd side tonight' });
  expect(plannedTimeline(MAD())[0]).toMatchObject({ key: 'tonight', title: 'Move to the odd side tonight' });
});

// ---- Milwaukee: the side named by the evening's date, all year, and a winter ban on both sides of bus routes ----
const MKE_ALT = { dates: ['2026-12-02', '2026-12-04'], fromhour: '2', tohour: '6', week1: '0', week2: '0', week3: '0', week4: '0', week5: '0', holidays: '0', flags: 4 };
const MKE_BAN = { ...MKE_ALT, dates: ['2026-12-01', '2026-12-02', '2026-12-03'], flags: 12 };
const MKE = (rules, over = {}) => ({ corridor: 'S Clement Ave', blockside: 'West', city: 'milwaukee', cnn: '16956', sideKey: 'West', leadMinutes: 30, level: 'normal', voice: 'cheeky',
  rule: rules[0], rules, nextSweepISO: '2026-12-02T08:00:00.000Z', ...over });   // Wed Dec 2, 2 AM in Milwaukee

test('Milwaukee: the night of Dec 1 (odd) into Dec 2 parks on the odd side, by the evening\'s date', () => {
  const t = at('2026-12-02T03:30:00Z');   // 9:30 PM Dec 1
  const p = dueAlert(MKE([MKE_ALT]), {}, t);
  expect(p).toMatchObject({ key: 'tonight', title: 'Move to the odd side tonight', body: 'S Clement Ave, even side: no parking 2 to 6 AM.' });
});

test('Milwaukee: a night both sides close says to leave the street', () => {
  const t = at('2026-12-02T03:30:00Z');
  const p = dueAlert(MKE([MKE_BAN, MKE_ALT]), {}, t);
  expect(p).toMatchObject({ key: 'tonight', title: 'Move off S Clement Ave tonight', body: 'No parking on either side, 2 to 6 AM. Park on a side street.' });
  for (const s of [p.title, p.body]) expect(s).not.toMatch(/[—–]| - |swept|sweep/i);
});

// ---- Toronto: a snow route is a declared rule (city.json winter.declared): one push when the City declares a Major
// Snowstorm Condition, none while it lasts or while none is; the North York ban is a no parking rule (flag 32) ----
const torDays = (from, n) => { const o = []; for (let t = Date.parse(from + 'T12:00Z'), i = 0; i < n; i++, t += 864e5) o.push(new Date(t).toISOString().slice(0, 10)); return o; };
const T_S1 = { dates: torDays('2026-11-01', 91), fromhour: '0', tohour: '24', week1: '0', week2: '0', week3: '0', week4: '0', week5: '0', holidays: '0', flags: 13 };
const T_S2 = { ...T_S1, dates: torDays('2027-01-31', 90) };
const T_NIGHT = (d) => ({ weekday: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d], fromhour: '2', tohour: '6', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0', months: [1, 2, 3, 12], flags: 33 });
const TOR_SNOW = (over = {}) => ({ corridor: 'Queen St W', blockside: 'South', city: 'toronto', cnn: '10784605', sideKey: 'L', leadMinutes: 30, level: 'normal', voice: 'drill',
  rule: T_S1, rules: [T_S1, T_S2], nextSweepISO: '2027-01-26T05:00:00.000Z', ...over });   // Tue Jan 26 2027, midnight in Toronto
const TOR_NY = (over = {}) => ({ corridor: 'Kenneth Ave', blockside: 'West', city: 'toronto', cnn: '437100', sideKey: 'L', leadMinutes: 30, level: 'intense', voice: 'cheeky',
  rule: T_NIGHT(3), rules: [0, 1, 2, 3, 4, 5, 6].map(T_NIGHT), nextSweepISO: '2026-12-02T07:00:00.000Z', ...over });   // Wed Dec 2, 2 AM in Toronto
const TOR_ON = { state: 'on', from: '2027-01-26', at: '2027-01-26T15:00:00Z', reason: 'Toronto declared a Major Snowstorm Condition.' };
const withToronto = (st, t, fn) => {
  const place = CITIES.toronto.place;
  place.setWinter(st); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t);
  try { fn(); } finally { place.setWinter({ state: 'waiting' }); vi.useRealTimers(); }
};

test('Toronto: a snow route sends nothing while no snowstorm is declared, though its stored day comes up', () => {
  const t = at('2027-01-26T02:30:00Z');   // 9:30 PM Jan 25
  withToronto({ state: 'waiting' }, t, () => expect(winterPlan(TOR_SNOW(), {}, t)).toEqual({ due: null }));
  withToronto({ state: 'paused' }, t, () => expect(winterPlan(TOR_SNOW(), {}, t)).toEqual({ due: null }));
});

test('Toronto: one push when the City declares it (what happened, move off this snow route, towing), then none while it lasts', () => {
  const t = at('2027-01-26T15:10:00Z');   // 10:10 AM, ten minutes after the switch
  withToronto(TOR_ON, t, () => {
    const p = winterPlan(TOR_SNOW(), {}, t).due;
    expect(p).toMatchObject({ key: 'winter', tag: 'curb-winter', urgent: true, mark: '2027-01-26', title: 'Move your car off Queen St W',
      body: 'Toronto declared a Major Snowstorm Condition. Queen St W is a snow route: no parking until the City ends it. Parked cars get towed.' });
    expect(p.expiresAt).toBe(at('2027-01-27T15:00:00Z'));   // a day after the switch
    for (const s of [p.title, p.body]) expect(s).not.toMatch(/[—–~]| - |swept|sweep/i);
    expect(winterPlan(TOR_SNOW(), { winter: '2027-01-26' }, t)).toEqual({ due: null });   // once
  });
  // the evening after: no "move it tonight" for the next day of the declaration
  const eve = at('2027-01-27T02:30:00Z');
  withToronto(TOR_ON, eve, () => expect(winterPlan(TOR_SNOW({ nextSweepISO: '2027-01-27T05:00:00.000Z' }), { winter: '2027-01-26' }, eve)).toEqual({ due: null }));
  // switched on at 11:50 PM: a day to reach every watch, not ten minutes
  const late = at('2027-01-27T12:00:00Z');
  withToronto({ ...TOR_ON, at: '2027-01-27T04:50:00Z' }, late, () => expect(winterPlan(TOR_SNOW(), {}, late).due).toMatchObject({ key: 'winter' }));
  // a switch with no reason: the City's name says it
  withToronto({ state: 'on', from: '2027-01-26', at: '2027-01-26T15:00:00Z' }, t, () => expect(winterPlan(TOR_SNOW(), {}, t).due.body).toMatch(/^Toronto declared a Major Snowstorm Condition\. /));
  // another declaration, another day: again
  const feb = at('2027-02-10T15:10:00Z');
  withToronto({ state: 'on', from: '2027-02-10', at: '2027-02-10T15:00:00Z' }, feb, () =>
    expect(winterPlan(TOR_SNOW({ nextSweepISO: '2027-02-10T05:00:00.000Z' }), { winter: '2027-01-26' }, feb).due).toMatchObject({ key: 'winter', mark: '2027-02-10' }));
  // its test push is that push
  expect(renderOne(TOR_SNOW(), 'tonight')).toMatchObject({ key: 'winter', title: 'Move your car off Queen St W' });
});

test('Toronto: the North York ban gets the one night push of a 2 AM rule, in no parking words, at every level and voice', () => {
  const nine = at('2026-12-02T02:30:00Z');   // 9:30 PM Dec 1
  withToronto({ state: 'waiting' }, nine, () => {
    expect(winterPlan(TOR_NY(), {}, nine)).toBe(null);
    for (const voice of ['cheeky', 'drill', 'deadpan']) for (const level of ['light', 'normal', 'intense']) {
      const p = dueAlert(TOR_NY({ voice, level }), {}, nine);
      expect(p).toMatchObject({ key: 'tonight', title: 'Move your car tonight', body: 'Kenneth Ave (West): no parking 2 to 6 AM.', urgent: true });
      for (const s of [p.title, p.body]) expect(s).not.toMatch(/[—–~]| - |swept|sweep/i);
    }
  });
  const late = at('2026-12-02T05:30:00Z');   // 12:30 AM: worded for that morning
  withToronto({ state: 'waiting' }, late, () => expect(dueAlert(TOR_NY(), {}, late)).toMatchObject({ key: 'tonight', title: 'Move your car by 2 AM' }));
  expect(touchpointsFor('intense', TOR_NY().nextSweepISO, TOR_NY())).toEqual(['tonight']);
  expect(plannedTimeline(TOR_NY())[0]).toMatchObject({ key: 'tonight', title: 'Move your car tonight' });
  expect(renderOne(TOR_NY(), 'tonight')).toMatchObject({ title: 'Move your car tonight' });
  // a side with both rules, before any declaration: its ban night is the push
  withToronto({ state: 'waiting' }, nine, () => {
    const both = TOR_NY({ rules: [T_S1, T_S2, ...TOR_NY().rules] });
    expect(winterPlan(both, {}, nine)).toBe(null);
    expect(dueAlert(both, {}, nine)).toMatchObject({ title: 'Move your car tonight' });
  });
});

// Toronto's two new kinds of rule are its own: no other city's data has a declared winter rule or a no parking rule (flag
// 32), so their alerts run exactly as before (the tests above for San Francisco, Boston, Madison and Milwaukee are unchanged).
test('only Toronto has a declared winter rule or no parking rules', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  for (const [id, c] of Object.entries(CITIES)) if (id !== 'toronto') expect(Boolean(c.place && c.place.winter && c.place.winter.declared), id).toBe(false);
  const data = new URL('../data/', import.meta.url);
  for (const id of readdirSync(data)) {
    const f = new URL(`${id}/segments.json`, data);
    if (id === 'toronto' || !existsSync(f)) continue;
    const seg = JSON.parse(readFileSync(f, 'utf8'));
    if (!Array.isArray(seg.b) || !seg.b.length || !Array.isArray(seg.b[0].d)) continue;   // Boston's own format
    expect(seg.b.some((b) => b.d.some(([, , rules]) => rules.some((r) => r[5] & 32))), id).toBe(false);
  }
});
