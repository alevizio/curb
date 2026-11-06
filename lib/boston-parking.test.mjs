// Parking mode's rules (lib/boston-parking.js) on the City's real records, including stretches from the 5 Nov 2026 street check.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';

let P, D, blocks;
const HOL = { '2026-11-11': 'Veterans Day' };
const TUE_2PM = () => P.at(2026, 11, 10, 14, 0);
const rulesOf = (c, side) => { const b = blocks.get(c); return b && (b.d.find(([s]) => s === side) || [])[2]; };
const near = (lat, lng, pick = () => true) => {
  let best = null, bd = Infinity;
  for (const z of D.zones) {
    if (!pick(z)) continue;
    const m = z.g[Math.floor(z.g.length / 2)], d = Math.hypot((m[0] - lat) * 111320, (m[1] - lng) * 82000);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
};
const answer = (z, T = TUE_2PM()) => P.grade(D, z, T, rulesOf, HOL);

beforeAll(async () => {
  await import('./boston-parking.js'); P = globalThis.BOS_PARK;
  D = P.decode(JSON.parse(fs.readFileSync(new URL('../data/boston/zones.json', import.meta.url))));
  blocks = new Map(JSON.parse(fs.readFileSync(new URL('../data/boston/segments.json', import.meta.url))).b.map((b) => [b.c, b]));
});

const sign = (o) => ({ pr: 50, st: 'no', ...o });
const data = (policies, unread = 0) => ({ p: policies, rs: [[policies.map((_, i) => i), unread]] });
const says = (policies, { short = 0, unread = 0, T = TUE_2PM(), onSchedule = true } = {}) => P.gradeSigns(data(policies, unread), 0, short, onSchedule, T).st;

describe('the rules, in order', () => {
  it('no usable sign means No sign on record, never Clear', () => {
    expect(P.gradeSigns(data([]), -1, 0, false, TUE_2PM()).st).toBe('unknown');
  });
  it('a short stretch takes the lowest priority number in force', () => {
    expect(says([sign({ pr: 80, st: 'limit' }), sign({ pr: 1, st: 'no' })], { short: 1 })).toBe('no');
  });
  it('a hydrant, bus stop or accessible sign is a note on a long stretch, and speaks on a short one', () => {
    const hydrant = sign({ pr: 1, n: 1 });
    expect(says([hydrant])).toBe('clear');
    expect(says([hydrant], { unread: 1 })).toBe('check');
    expect(says([hydrant], { short: 1 })).toBe('no');
  });
  it('a meter wins while it runs, over block-wide signs of a higher priority', () => {
    const noParking = sign({ pr: 38, w: [[127, 360, 1200, 0, 0]] }), meter = sign({ pr: 83, st: 'paid', m: 1, w: [[126, 480, 1200, 0, 0]] });
    expect(says([noParking, meter])).toBe('paid');
  });
  it('signs that allow and forbid parking at once say Check the sign', () => {
    expect(says([sign({ pr: 3 }), sign({ pr: 80, st: 'limit' })])).toBe('check');
  });
  it('a long plain No Parking says Check the sign, and a long No Stopping stays no', () => {
    expect(says([sign({ pl: 1 })])).toBe('check');
    expect(says([sign({ stop: 1 })])).toBe('no');
    expect(says([sign({ pl: 1 })], { short: 1 })).toBe('no');
  });
  it('with nothing in force, Clear needs every sign read', () => {
    const offHours = sign({ w: [[127, 300, 420, 0, 0]] });
    expect(says([offHours])).toBe('clear');
    expect(says([offHours], { unread: 1 })).toBe('check');
  });
  it('a named period is never in force', () => {
    expect(says([sign({ per: 'snow emergency' })])).toBe('clear');
  });
  it('a street cleaning sign counts only where the City lists no schedule', () => {
    const cleaning = sign({ sw: 1, w: [[4, 840, 900, 0, 0]] });  // Tuesdays 2 to 3 PM
    expect(says([cleaning], { onSchedule: true })).toBe('clear');
    expect(says([cleaning], { onSchedule: false })).toBe('sweep');
  });
});

describe('time', () => {
  const T = (d, h, mi = 0) => P.at(2026, 11, d, h, mi);
  it('reads days, hours, weeks and months', () => {
    const wed8to12 = { w: [[1 << 3, 480, 720, 0, 0]] };
    expect(P.inForce(wed8to12, T(11, 9))).toBe(true);
    expect(P.inForce(wed8to12, T(11, 12))).toBe(false);
    expect(P.inForce(wed8to12, T(10, 9))).toBe(false);
    const firstTue = { w: [[1 << 2, 480, 720, 1, 0]] };
    expect(P.inForce(firstTue, T(3, 9))).toBe(true);
    expect(P.inForce(firstTue, T(10, 9))).toBe(false);
    const aprToNov = { w: [[127, 0, 0, 0, 2040]] };
    expect(P.inForce(aprToNov, T(10, 9))).toBe(true);
    expect(P.inForce(aprToNov, P.at(2026, 12, 1, 9))).toBe(false);
  });
  it('gives the small hours of an overnight rule to the day it started', () => {
    const monNight = { w: [[1 << 1, 1320, 360, 0, 0]] };  // Mon 10 PM to 6 AM
    expect(P.inForce(monNight, T(9, 23))).toBe(true);
    expect(P.inForce(monNight, T(10, 3))).toBe(true);
    expect(P.inForce(monNight, T(10, 7))).toBe(false);
    expect(P.inForce(monNight, T(11, 3))).toBe(false);
  });
  it('frees meters on City holidays and leaves other rules on', () => {
    const allWeek = [[127, 480, 1200, 0, 0]];
    expect(P.inForce({ m: 1, w: allWeek }, T(11, 14), HOL)).toBe(false);
    expect(P.inForce({ w: allWeek }, T(11, 14), HOL)).toBe(true);
  });
  it('stops daytime sweeping on City holidays and keeps the overnight program', () => {
    const wednesday = (from, to) => [[3, from, to, 0, 0, 0]];
    expect(P.sweepOn(wednesday(8, 12), T(11, 9), HOL)).toBe(false);
    expect(P.sweepOn(wednesday(0, 7), T(11, 3), HOL)).toBe(true);
    expect(P.sweepOn(wednesday(8, 12), T(4, 9), HOL)).toBe(true);
  });
  it('finds the next change and draws the day', () => {
    const answerAt = (t) => ({ st: t.dow > 0 && t.min >= 480 && t.min < 1200 ? 'paid' : 'clear' });
    const next = P.nextChange(answerAt, TUE_2PM());
    expect(next.T.min).toBe(1200);
    expect(next.st).toBe('clear');
    expect(P.dayBar(answerAt, TUE_2PM())).toEqual([{ from: 0, to: 480, st: 'clear' }, { from: 480, to: 1200, st: 'paid' }, { from: 1200, to: 1440, st: 'clear' }]);
  });
  it('says the day when the change is on another day', () => {
    const answerAt = (t) => ({ st: t.dow === 2 ? 'clear' : 'no' });
    const T0 = TUE_2PM(), a = P.words({ st: 'clear' }, P.nextChange(answerAt, T0), T0);
    expect(a.head).toBe('Clear until Wed 12 AM');
  });
});

describe('the sheet says', () => {
  it('what to pay and until when', () => {
    const w = P.words({ st: 'paid', why: 'metered', top: { rate: 3.75, max: 120 } }, { T: P.at(2026, 11, 10, 20), st: 'clear' }, TUE_2PM());
    expect(w).toEqual({ head: 'Pay until 8 PM', rate: 3.75, sub: '2 hr max. No meter after 8 PM.' });
  });
  it('why a curb says Check the sign', () => {
    const sub = (why) => P.words({ st: 'check', why }, null, TUE_2PM()).sub;
    expect(sub('unread')).toMatch(/couldn't be read/);
    expect(sub('conflict')).toMatch(/disagree/);
    expect(sub('long-no-parking')).toMatch(/only part/);
  });
  it('never says a long No Stopping covers the whole stretch', () => {
    expect(P.words({ st: 'no', why: 'single', top: { stop: 1 } }, null, TUE_2PM())).toEqual({ head: 'No stopping', sub: 'On record along this stretch. It may cover only part of it.' });
  });
});

describe('the stretches from the street check, Tue 2 PM', () => {
  it('146 to 190 Newbury St pays, at the cars\' rate', () => {
    const a = answer(near(42.35048, -71.07945, (z) => z.rs >= 0 && !z.short));
    expect(a.st).toBe('paid');
    expect(a.top.rate).toBe(3.75);
  });
  it('307 W First St, cars in stalls on a No Parking record, says Check the sign', () => {
    expect(answer(near(42.339577, -71.046969, (z) => z.rs >= 0 && !z.short)).st).toBe('check');
  });
  it('8 Dearborn St, a 2 hr limit behind an unreadable photo, no longer says Clear', () => {
    expect(answer(near(42.329705, -71.078753, (z) => z.rs >= 0 && !z.short)).st).toBe('check');
  });
  it('220 Lake St, posted no stopping any time, says no', () => {
    expect(answer(near(42.347405, -71.161379, (z) => z.rs >= 0 && !z.short)).st).toBe('no');
  });
  it('6 Cenacle Rd, posted resident permit only, says permit', () => {
    expect(answer(near(42.346382, -71.161634, (z) => z.rs >= 0 && !z.short)).st).toBe('restricted');
  });
});

describe('zones.json', () => {
  it('holds every City record once and no motorcycle meter', () => {
    expect(D.zones.length).toBe(54185);
    expect(D.p.some((p) => p.rate === 0.5)).toBe(false);
  });
  it('decodes to Boston', () => {
    for (const z of D.zones.slice(0, 500)) for (const [lat, lng] of z.g) {
      expect(lat).toBeGreaterThan(42.2); expect(lat).toBeLessThan(42.42);
      expect(lng).toBeGreaterThan(-71.21); expect(lng).toBeLessThan(-70.97);
    }
  });
});
