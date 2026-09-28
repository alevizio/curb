// TZ-matrix + edge-case tests for the SF-pinned sweep/time core (lib/sweep-core.js).
// The whole point of the core is that a sweep instant is correct regardless of the device's
// timezone and survives both 2026 DST transitions. These tests freeze the clock and assert
// ABSOLUTE instants (UTC ms), then prove device-TZ independence by recomputing the same value
// in child node processes pinned to LA / NY / Honolulu / Tokyo / UTC.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

// Importing the core for its side effect: it attaches everything to globalThis.
beforeAll(async () => { await import('./sweep-core.js'); });
afterEach(() => { vi.useRealTimers(); });

const rule = (o = {}) => ({
  weekday: 'Wed', fromhour: '8', tohour: '10',
  week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0', ...o,
});

describe('sfWallToInstant — DST edges', () => {
  it('spring-forward: 2am on 2026-03-08 does not exist → resolves forward to 3am PDT', () => {
    const inst = globalThis.sfWallToInstant(2026, 3, 8, 2);
    // 3:00 PDT (UTC-7) === 10:00 UTC
    expect(inst.getTime()).toBe(Date.UTC(2026, 2, 8, 10, 0));
    expect(globalThis.sfParts(inst).h).toBe(3);
  });
  it('fall-back: 1am on 2026-11-01 happens twice → resolves to a valid 1am instant', () => {
    const inst = globalThis.sfWallToInstant(2026, 11, 1, 1);
    expect(globalThis.sfParts(inst).h).toBe(1);
  });
  it('summer wall time maps to PDT (UTC-7)', () => {
    expect(globalThis.sfWallToInstant(2026, 6, 17, 8).getTime()).toBe(Date.UTC(2026, 5, 17, 15, 0));
  });
  it('winter wall time maps to PST (UTC-8)', () => {
    expect(globalThis.sfWallToInstant(2026, 1, 14, 8).getTime()).toBe(Date.UTC(2026, 0, 14, 16, 0));
  });
});

describe('nextSweep — calendar correctness', () => {
  it('returns the next matching weekday as a true SF instant', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 19, 0))); // Mon 2026-06-15
    const ns = globalThis.nextSweep(rule());
    expect(ns.y).toBe(2026); expect(ns.mo).toBe(6); expect(ns.da).toBe(17); // next Wed
    expect(ns.start.getTime()).toBe(Date.UTC(2026, 5, 17, 15, 0));          // 8am PDT
  });

  it('skips an occurrence that falls on a suspended holiday', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 19, 0))); // Wed 2026-07-01
    // Friday rule: 2026-07-03 is an observed holiday (HOL_DAY) → skip to 2026-07-10
    const ns = globalThis.nextSweep(rule({ weekday: 'Fri' }));
    expect(ns.mo).toBe(7); expect(ns.da).toBe(10);
  });

  it('nightly (holidays=1) rule sweeps THROUGH a minor holiday', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 19, 0)));
    // 2026-07-03 is in HOL_DAY but NOT HOL_NIGHT → a holidays=1 row still sweeps 7/3
    const ns = globalThis.nextSweep(rule({ weekday: 'Fri', holidays: '1' }));
    expect(ns.mo).toBe(7); expect(ns.da).toBe(3);
  });

  it('handles a week5-only rule across a month with no 5th occurrence', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 1, 19, 0))); // Mon 2026-06-01
    // June 2026 has only four Fridays; the next 5th-Friday is 2026-07-31.
    const ns = globalThis.nextSweep(rule({ weekday: 'Fri', week1: '0', week2: '0', week3: '0', week4: '0', week5: '1' }));
    expect(ns.mo).toBe(7); expect(ns.da).toBe(31);
  });

  it('returns null for an unparseable weekday', () => {
    expect(globalThis.nextSweep(rule({ weekday: 'Someday' }))).toBe(null);
  });
});

describe('holidaySkip — heads-up + Juneteenth regression', () => {
  it('Juneteenth (2026-06-19) is in the daytime suspension table and named', () => {
    expect(globalThis.HOL_DAY.has('2026-06-19')).toBe(true);
    expect(globalThis.HOL_NAMES['2026-06-19']).toBe('Juneteenth');
  });

  it('flags a Friday side whose next sweep lands on Juneteenth, and nextSweep rolls past it', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 16, 19, 0))); // Tue 2026-06-16 (SF)
    const hit = globalThis.holidaySkip(rule({ weekday: 'Fri' }));
    expect(hit).not.toBe(null);
    expect(hit.iso).toBe('2026-06-19');
    expect(hit.name).toBe('Juneteenth');
    expect(globalThis.nextSweep(rule({ weekday: 'Fri' })).da).toBe(26); // skips 6/19 → 6/26
  });

  it('returns null when the next sweep is a normal (non-holiday) day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 16, 19, 0)));
    expect(globalThis.holidaySkip(rule({ weekday: 'Wed' }))).toBe(null); // next Wed 6/17
  });

  it('does NOT flag a nightly (holidays=1) Friday side for Juneteenth — nightly sweeps through', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 16, 19, 0)));
    expect(globalThis.holidaySkip(rule({ weekday: 'Fri', holidays: '1' }))).toBe(null);
  });
});

// The 2027-2028 holiday rows are derived (SFMTA hadn't posted them yet). Re-derive them here by the
// same rule and prove that rule reproduces the verified 2026 list, so the table can't silently drift.
describe('holiday table — derivation + expiry guard', () => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nth = (y, m, wd, n) => { let c = 0; for (let d = 1; d <= 31; d++) if (dow(y, m, d) === wd && ++c === n) return iso(y, m, d); };
  const last = (y, m, wd) => { for (let d = 31; d >= 1; d--) { const t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCMonth() === m - 1 && t.getUTCDay() === wd) return iso(y, m, d); } };
  // fixed-date holiday: its date, plus the observed weekday when it falls on a weekend
  const fixed = (y, m, d) => { const w = dow(y, m, d); return w === 6 ? [iso(y, m, d - 1), iso(y, m, d)] : w === 0 ? [iso(y, m, d), iso(y, m, d + 1)] : [iso(y, m, d)]; };
  const derive = (y) => {
    const tg = nth(y, 11, 4, 4), [a, b, c] = tg.split('-').map(Number);
    return {
      day: [...fixed(y, 1, 1), nth(y, 1, 1, 3), nth(y, 2, 1, 3), last(y, 5, 1), ...fixed(y, 6, 19), ...fixed(y, 7, 4),
        nth(y, 9, 1, 1), nth(y, 10, 1, 2), ...fixed(y, 11, 11), tg, iso(a, b, c + 1), ...fixed(y, 12, 25)],
      night: [...fixed(y, 1, 1), tg, ...fixed(y, 12, 25)],
    };
  };

  it('the rule reproduces the SFMTA-verified 2026 list exactly', () => {
    const d = derive(2026);
    expect([...globalThis.HOL_DAY].filter((x) => x.startsWith('2026'))).toEqual(d.day);
    expect([...globalThis.HOL_NIGHT].filter((x) => x.startsWith('2026'))).toEqual(d.night);
  });

  it('2027-2028 (+ New Year 2029) match the rule, and every date is named', () => {
    const want = (k) => [...new Set([...derive(2027)[k], ...derive(2028)[k], ...fixed(2029, 1, 1)])].sort();
    const have = (set) => [...set].filter((x) => x >= '2027-01-01').sort();
    expect(have(globalThis.HOL_DAY)).toEqual(want('day'));
    expect(have(globalThis.HOL_NIGHT)).toEqual(want('night'));
    for (const x of globalThis.HOL_DAY) expect(globalThis.HOL_NAMES[x], x).toBeTruthy();
  });

  it('MLK + Presidents\' Day 2027 (both 3rd Mondays) now suspend a Mon week-3 daytime row', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2027, 0, 17, 20, 0))); // Sun 2027-01-17
    const ns = globalThis.nextSweep(rule({ weekday: 'Mon', week1: '0', week2: '0', week3: '1', week4: '0', week5: '0' }));
    expect(`${ns.y}-${ns.mo}-${ns.da}`).toBe('2027-3-15'); // skips Jan 18 (MLK) and Feb 15 (Presidents')
  });

  it('GUARD: the table reaches past nextSweep\'s 150-day scan horizon (fails when it needs a refresh)', () => {
    const lastDay = [...globalThis.HOL_DAY].sort().pop();
    const horizon = new Date(Date.now() + 150 * 864e5).toISOString().slice(0, 10);
    expect(lastDay >= horizon, `holiday table ends ${lastDay}; extend it (see lib/sweep-core.js)`).toBe(true);
  });
});

describe('alertAnchors — one rule for eve / tonight / morn / night sweeps', () => {
  const A = (y, mo, da, h) => globalThis.alertAnchors(globalThis.sfWallToInstant(y, mo, da, h));
  const sf = (d) => globalThis.sfParts(d);
  it('a 9 AM sweep: eve 8 PM + tonight 9 PM the day before, morn 7 AM, not a night sweep', () => {
    const a = A(2026, 6, 19, 9);
    expect(a.night).toBe(false);
    expect(sf(a.eve)).toMatchObject({ da: 18, h: 20 });
    expect(sf(a.tonight)).toMatchObject({ da: 18, h: 21 });
    expect(sf(a.morn)).toMatchObject({ da: 19, h: 7 });
  });
  it('8 AM keeps a 6 AM morning-of; 7 AM loses it (5 AM is too early) but is not a night sweep', () => {
    expect(sf(A(2026, 6, 19, 8).morn)).toMatchObject({ da: 19, h: 6 });
    expect(A(2026, 6, 19, 7).morn).toBe(null);
    expect(A(2026, 6, 19, 7).night).toBe(false);
  });
  it('0, 1, 2 and 6 AM are night sweeps with no morning-of (no 10 PM "sweep today")', () => {
    for (const h of [0, 1, 2, 6]) {
      const a = A(2026, 6, 19, h);
      expect(a.night, `${h} AM`).toBe(true);
      expect(a.morn, `${h} AM`).toBe(null);
      expect(sf(a.tonight), `${h} AM`).toMatchObject({ da: 18, h: 21 });
    }
  });
  it('DST fall-back weekend (Sun 2026-11-01 → Mon 11-02): anchors stay on SF wall time', () => {
    const a = A(2026, 11, 2, 8); // Mon 8 AM PST, eve on the 25-hour Sunday
    expect(sf(a.eve)).toMatchObject({ mo: 11, da: 1, h: 20 });
    expect(sf(a.morn)).toMatchObject({ mo: 11, da: 2, h: 6 });
    const n = A(2026, 11, 1, 1); // the repeated 1 AM on the change night
    expect(n.night).toBe(true);
    expect(sf(n.tonight)).toMatchObject({ mo: 10, da: 31, h: 21 });
  });
});

describe('sfDaysUntil / sweepCountdown — relative days are SF calendar days', () => {
  const at = (iso) => new Date(iso);
  it('counts SF dates, not hours/24', () => {
    const sunEve = at('2026-09-28T02:00:00Z'); // Sun 2026-09-27 7 PM PDT
    expect(globalThis.sfDaysUntil(2026, 9, 27, sunEve)).toBe(0);
    expect(globalThis.sfDaysUntil(2026, 9, 28, sunEve)).toBe(1);
    expect(globalThis.sfDaysUntil(2026, 9, 29, sunEve)).toBe(2);
    expect(globalThis.sfDaysUntil(2026, 9, 26, sunEve)).toBe(-1);
  });
  it('year end: 8 PM PST on Dec 31 is still Dec 31 in SF (already Jan 1 in UTC)', () => {
    const nye = at('2027-01-01T04:00:00Z');
    expect(globalThis.sfDaysUntil(2026, 12, 31, nye)).toBe(0);
    expect(globalThis.sfDaysUntil(2027, 1, 1, nye)).toBe(1);
    expect(globalThis.sfDaysUntil(2027, 1, 2, nye)).toBe(2);
  });
  it('DST edges: the 23-hour and 25-hour days count as one day each', () => {
    const springEve = at('2026-03-08T07:30:00Z');                          // Sat 3/7 11:30 PM PST
    expect(globalThis.sfDaysUntil(2026, 3, 8, springEve)).toBe(1);
    expect(globalThis.sfDaysUntil(2026, 3, 9, springEve)).toBe(2);
    expect(globalThis.sfDaysUntil(2026, 3, 9, at('2026-03-08T08:30:00Z'))).toBe(1); // Sun 12:30 AM PST
    const fallLate = at('2026-11-02T07:30:00Z');                           // Sun 11/1 11:30 PM PST
    expect(globalThis.sfDaysUntil(2026, 11, 1, fallLate)).toBe(0);
    expect(globalThis.sfDaysUntil(2026, 11, 2, fallLate)).toBe(1);
    expect(globalThis.sfDaysUntil(2026, 11, 2, at('2026-11-01T07:30:00Z'))).toBe(1); // Sun 12:30 AM PDT
  });
  it('Sunday evening → Tuesday sweep says "in 2 days", never "tomorrow"', () => {
    vi.useFakeTimers(); vi.setSystemTime(at('2026-09-28T02:00:00Z'));  // Sun 9/27 7 PM PDT, 38 h out
    const ns = globalThis.nextSweep(rule({ weekday: 'Tue', fromhour: '9', tohour: '11' }));
    expect(ns.da).toBe(29);
    expect(globalThis.sweepCountdown(ns, new Date())).toBe('in 2 days');
  });
  it('"tomorrow" only for the next SF date; hours while under a day away', () => {
    const mon = rule({ weekday: 'Mon', fromhour: '12', tohour: '14' });
    vi.useFakeTimers(); vi.setSystemTime(at('2026-09-27T15:00:00Z'));  // Sun 8 AM PDT, 28 h out
    expect(globalThis.sweepCountdown(globalThis.nextSweep(mon), new Date())).toBe('tomorrow');
    vi.setSystemTime(at('2026-09-27T20:00:00Z'));                      // Sun 1 PM PDT, 23 h out
    expect(globalThis.sweepCountdown(globalThis.nextSweep(mon), new Date())).toBe('in 23 hr');
    vi.setSystemTime(at('2026-09-28T18:30:00Z'));                      // Mon 11:30 AM PDT
    expect(globalThis.sweepCountdown(globalThis.nextSweep(mon), new Date())).toBe('in <1 hr');
  });
  it('spring-forward: Sat 8 AM PST → Sun 9 AM PDT is 24 real hours and "tomorrow"', () => {
    vi.useFakeTimers(); vi.setSystemTime(at('2026-03-07T16:00:00Z'));
    const ns = globalThis.nextSweep(rule({ weekday: 'Sun', fromhour: '9', tohour: '11' }));
    expect(ns.da).toBe(8);
    expect(globalThis.sweepCountdown(ns, new Date())).toBe('tomorrow');
  });
  it('fall-back: Sat 8 PM PDT → Mon 7 AM PST is 36 real hours and "in 2 days"', () => {
    vi.useFakeTimers(); vi.setSystemTime(at('2026-11-01T03:00:00Z'));
    const ns = globalThis.nextSweep(rule({ weekday: 'Mon', fromhour: '7', tohour: '9' }));
    expect(ns.da).toBe(2);
    expect(globalThis.sweepCountdown(ns, new Date())).toBe('in 2 days');
  });
});

describe('device-timezone independence (child processes)', () => {
  // sfWallToInstant is anchored to America/Los_Angeles, so the same SF wall time must produce
  // the SAME absolute instant no matter what TZ the running device is in.
  const expected = Date.UTC(2026, 5, 17, 15, 0); // 2026-06-17 08:00 PDT
  for (const TZ of ['America/Los_Angeles', 'America/New_York', 'Pacific/Honolulu', 'Asia/Tokyo', 'UTC']) {
    it(`TZ=${TZ} computes the identical instant`, () => {
      const out = execFileSync(process.execPath, ['-e',
        "import('./lib/sweep-core.js').then(()=>process.stdout.write(String(globalThis.sfWallToInstant(2026,6,17,8).getTime())))",
      ], { env: { ...process.env, TZ }, encoding: 'utf8' });
      expect(Number(out)).toBe(expected);
    });
  }
});
