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

// SFMTA pauses only "weekday daytime street sweeping (6am-2pm)" on most holidays; "nightly street sweeping
// (12am-6am)" keeps going except New Year's Day, Thanksgiving and Christmas. Most overnight rows are NOT
// flagged holidays=1 in DataSF, so the window itself has to decide (until 2026-10 the map skipped them).
describe('night routes on holidays — the window decides, not only the holidays flag', () => {
  const MON = { weekday: 'Mon' };
  // Tue 2026-10-06, noon PDT: the next Monday is the holiday (holidaySkip scans from today, so not a Monday)
  const atTueOct6 = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 6, 19, 0))); };
  const day = (ns) => `${ns.y}-${ns.mo}-${ns.da}`;

  it('a 12 to 2 AM Monday row still sweeps on Indigenous Peoples Day (Mon Oct 12 2026)', () => {
    atTueOct6();
    const rec = rule({ ...MON, fromhour: '0', tohour: '2' });
    const ns = globalThis.nextSweep(rec);
    expect(day(ns)).toBe('2026-10-12');
    expect(ns.start.getTime()).toBe(Date.UTC(2026, 9, 12, 7, 0)); // 12 AM PDT
    expect(globalThis.holidaySkip(rec)).toBe(null);
  });

  it('a 9 AM Monday row is still skipped that day, and named', () => {
    atTueOct6();
    const rec = rule({ ...MON, fromhour: '9', tohour: '11' });
    expect(day(globalThis.nextSweep(rec))).toBe('2026-10-19');
    expect(globalThis.holidaySkip(rec)).toMatchObject({ iso: '2026-10-12', name: 'Indigenous Peoples Day' });
  });

  it('every window inside 12 AM to 6 AM is a night route; one that runs past 6 AM is daytime', () => {
    const iso = '2026-10-12';
    for (const [f, t] of [['0', '2'], ['0', '6'], ['2', '6'], ['4', '6'], ['5', '6'], ['3', '5'], ['1', '2']]) {
      expect(globalThis.sweepSuspended(rule({ ...MON, fromhour: f, tohour: t }), iso), `${f} to ${t}`).toBe(false);
    }
    for (const [f, t] of [['5', '7'], ['6', '8'], ['7', '9'], ['8', '10']]) {
      expect(globalThis.sweepSuspended(rule({ ...MON, fromhour: f, tohour: t }), iso), `${f} to ${t}`).toBe(true);
    }
  });

  it('a flagged 7-day row (holidays=1) behaves exactly as before, even outside 12 AM to 6 AM', () => {
    atTueOct6();
    const rec = rule({ ...MON, fromhour: '6', tohour: '8', holidays: '1' });
    expect(day(globalThis.nextSweep(rec))).toBe('2026-10-12');
    expect(globalThis.holidaySkip(rec)).toBe(null);
    expect(globalThis.sweepSuspended(rec, '2026-12-25')).toBe(true);
    expect(globalThis.sweepSuspended(rec, '2026-11-27')).toBe(false);
  });

  it('Christmas and New Year\'s Day still stop night rows', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 11, 21, 20, 0))); // Mon 2026-12-21, noon PST
    const rec = rule({ weekday: 'Fri', fromhour: '2', tohour: '6' });              // Dec 25 and Jan 1 are both Fridays
    expect(day(globalThis.nextSweep(rec))).toBe('2027-1-8');
    expect(globalThis.holidaySkip(rec)).toMatchObject({ iso: '2026-12-25', name: 'Christmas' });
    expect(globalThis.sweepSuspended(rule({ weekday: 'Thu', fromhour: '0', tohour: '2' }), '2026-11-26')).toBe(true); // Thanksgiving
  });

  it('the day after Thanksgiving: night rows sweep, daytime rows do not', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 10, 23, 20, 0))); // Mon 2026-11-23
    expect(day(globalThis.nextSweep(rule({ weekday: 'Fri', fromhour: '4', tohour: '6' })))).toBe('2026-11-27');
    expect(day(globalThis.nextSweep(rule({ weekday: 'Fri', fromhour: '8', tohour: '10' })))).toBe('2026-12-4');
  });
});

// The 2027-2028 holiday rows are derived (SFMTA hadn't posted them yet). Re-derive them here by the
// rule and prove that rule reproduces every schedule SFMTA posted that we have a copy of, so the table
// can't silently drift from how SFMTA actually treats weekend holidays.
describe('holiday table — derivation + expiry guard', () => {
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nth = (y, m, wd, n) => { let c = 0; for (let d = 1; d <= 31; d++) if (dow(y, m, d) === wd && ++c === n) return iso(y, m, d); };
  const last = (y, m, wd) => { for (let d = 31; d >= 1; d--) { const t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCMonth() === m - 1 && t.getUTCDay() === wd) return iso(y, m, d); } };
  // SFMTA's holiday enforcement tables (sfmta.com, Wayback copies of 2021-12-01, 2022-01-15, 2022-12-15,
  // 2022-12-20, 2023-03-01, 2023-06-01, 2023-11-05, 2023-12-01, 2026-06-08, 2026-06-25 and the live page on
  // 2026-10-05). day = every date listed (weekday daytime sweeping not enforced); night = the dates whose
  // "Nightly Street Sweeping" column says Not Enforced. 2024 and 2025 had no usable copy.
  const POSTED = {
    2021: { day: ['2021-01-01', '2021-01-18', '2021-02-15', '2021-05-31', '2021-07-05', '2021-09-06', '2021-10-11', '2021-11-11',
      '2021-11-25', '2021-11-26', '2021-12-25'], night: ['2021-01-01', '2021-11-25', '2021-12-25'] },
    2022: { day: ['2022-01-01', '2022-01-17', '2022-02-21', '2022-05-30', '2022-06-20', '2022-07-04', '2022-09-05', '2022-10-10',
      '2022-11-11', '2022-11-24', '2022-11-25', '2022-12-25', '2022-12-26'], night: ['2022-01-01', '2022-11-24', '2022-12-25'] },
    2023: { day: ['2023-01-01', '2023-01-02', '2023-01-16', '2023-02-20', '2023-05-29', '2023-06-19', '2023-07-04', '2023-09-04',
      '2023-10-09', '2023-11-10', '2023-11-11', '2023-11-23', '2023-11-24', '2023-12-25'], night: ['2023-01-01', '2023-11-23', '2023-12-25'] },
    2026: { day: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12',
      '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25'], night: ['2026-01-01', '2026-11-26', '2026-12-25'] },
    2027: { day: ['2027-01-01'], night: ['2027-01-01'] }, // the 2026 page runs through New Year's Day 2027
  };
  // Weekend handling, as SFMTA posted it:
  // - New Year's Day and Christmas keep their own date (everything stops, night routes too); on a Sunday
  //   the Monday after is also listed, daytime only (2022-12-26, 2023-01-02); on a Saturday nothing else
  //   is (no Fri 2021-12-24 or 2021-12-31).
  // - Juneteenth and Independence Day move to the observed weekday only: Sat → Fri (2026-07-03, no 07-04),
  //   Sun → Mon (2021-07-05, 2022-06-20).
  // - Veterans Day on a Saturday listed both the Friday and the date (2023-11-10 and 11-11).
  const big = (y, m, d) => ({ day: dow(y, m, d) === 0 ? [iso(y, m, d), iso(y, m, d + 1)] : [iso(y, m, d)], night: [iso(y, m, d)] });
  const moved = (y, m, d) => { const w = dow(y, m, d); return [w === 6 ? iso(y, m, d - 1) : w === 0 ? iso(y, m, d + 1) : iso(y, m, d)]; };
  const both = (y, m, d) => { const w = dow(y, m, d); return w === 6 ? [iso(y, m, d - 1), iso(y, m, d)] : w === 0 ? [iso(y, m, d), iso(y, m, d + 1)] : [iso(y, m, d)]; };
  const derive = (y) => {
    const tg = nth(y, 11, 4, 4), [a, b, c] = tg.split('-').map(Number), ny = big(y, 1, 1), xm = big(y, 12, 25);
    return {
      day: [...ny.day, nth(y, 1, 1, 3), nth(y, 2, 1, 3), last(y, 5, 1), ...(y >= 2022 ? moved(y, 6, 19) : []), ...moved(y, 7, 4),
        nth(y, 9, 1, 1), nth(y, 10, 1, 2), ...both(y, 11, 11), tg, iso(a, b, c + 1), ...xm.day],
      night: [...ny.night, tg, ...xm.night],
    };
  };

  it('the rule reproduces every schedule SFMTA posted (2021, 2022, 2023, 2026)', () => {
    for (const y of [2021, 2022, 2023, 2026]) {
      const d = derive(y);
      expect(d.day, `${y} day`).toEqual(POSTED[y].day);
      expect(d.night, `${y} night`).toEqual(POSTED[y].night);
    }
  });

  it('the table\'s posted span (2026 through New Year\'s Day 2027) is exactly SFMTA\'s list', () => {
    const posted = (k) => [...POSTED[2026][k], ...POSTED[2027][k]];
    const have = (set) => [...set].filter((x) => x <= '2027-01-01').sort();
    expect(have(globalThis.HOL_DAY)).toEqual(posted('day'));
    expect(have(globalThis.HOL_NIGHT)).toEqual(posted('night'));
  });

  it('2027-2028 (+ New Year 2029) match the rule, and every date is named', () => {
    const want = (k) => [...new Set([...derive(2027)[k], ...derive(2028)[k], ...big(2029, 1, 1)[k]])].sort();
    const have = (set) => [...set].filter((x) => x >= '2027-01-01').sort();
    expect(have(globalThis.HOL_DAY)).toEqual(want('day'));
    expect(have(globalThis.HOL_NIGHT)).toEqual(want('night'));
    for (const x of globalThis.HOL_DAY) expect(globalThis.HOL_NAMES[x], x).toBeTruthy();
    expect(Object.keys(globalThis.HOL_NAMES).sort()).toEqual([...globalThis.HOL_DAY].sort()); // no stale names
  });

  it('weekend holidays: the dates SFMTA never posted are gone, the Veterans Day pair stays', () => {
    for (const x of ['2026-07-04', '2027-06-19', '2027-07-04', '2027-12-24', '2027-12-31']) {
      expect(globalThis.HOL_DAY.has(x), x).toBe(false);
      expect(globalThis.HOL_NIGHT.has(x), x).toBe(false);
    }
    for (const x of ['2027-06-18', '2027-07-05', '2028-11-10', '2028-11-11']) expect(globalThis.HOL_DAY.has(x), x).toBe(true);
    expect(globalThis.HOL_NIGHT.has('2027-12-25') && globalThis.HOL_NIGHT.has('2028-01-01')).toBe(true);
  });

  it('Fri Dec 24 2027 is a normal sweep day; Sat Dec 25 skips daytime and night rows', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2027, 11, 20, 20, 0))); // Mon 2027-12-20
    const fri = globalThis.nextSweep(rule({ weekday: 'Fri' }));
    expect(`${fri.y}-${fri.mo}-${fri.da}`).toBe('2027-12-24');
    const sat = globalThis.nextSweep(rule({ weekday: 'Sat', fromhour: '2', tohour: '6' }));
    expect(`${sat.y}-${sat.mo}-${sat.da}`).toBe('2028-1-8'); // skips Dec 25 and Jan 1, both Saturdays
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
  // sweepCountdown alone counts to the sweep's own date; the words people read count to its night (sweepWords)
  it('sweepCountdown counts a midnight sweep on its own SF date (a Mon 12 AM sweep is Monday)', () => {
    const mon0 = rule({ weekday: 'Mon', fromhour: '0', tohour: '2' });
    vi.useFakeTimers(); vi.setSystemTime(at('2026-09-27T06:00:00Z'));  // Sat 9/26 11 PM PDT, 25 h out
    expect(globalThis.sweepCountdown(globalThis.nextSweep(mon0), new Date())).toBe('in 2 days');
    vi.setSystemTime(at('2026-09-28T06:30:00Z'));                      // Sun 9/27 11:30 PM PDT
    expect(globalThis.sweepCountdown(globalThis.nextSweep(mon0), new Date())).toBe('in <1 hr');
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

describe('nextSweep(rec, after) — arming while the block is being swept', () => {
  // Owner report 2026-09-30: parked on Delmar St right after the sweeper (Wed 8 to 10 AM), the sheet said
  // "Sweeping now" and had no alert or calendar button. The sheet now arms the sweep after this window.
  it('during the window, plain nextSweep is the sweep in progress; with after = its end, next week', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 15, 49))); // Wed 2026-09-30 8:49 AM PDT
    const now = globalThis.nextSweep(rule());
    expect([now.mo, now.da, now.fromH]).toEqual([9, 30, 8]);
    expect(+now.start).toBe(Date.UTC(2026, 8, 30, 15, 0));
    const next = globalThis.nextSweep(rule(), now.end);
    expect([next.mo, next.da]).toEqual([10, 7]);
    expect(+next.start).toBe(Date.UTC(2026, 9, 7, 15, 0));
  });
  it('an `after` before the window still returns that window; no `after` behaves exactly as before', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 12, 0)));  // Wed 5 AM PDT
    expect(globalThis.nextSweep(rule(), Date.UTC(2026, 8, 30, 14, 0)).da).toBe(30);
    expect(globalThis.nextSweep(rule()).da).toBe(30);
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 18, 0)));                       // Wed 11 AM PDT, window over
    expect(globalThis.nextSweep(rule()).da).toBe(7);
  });
  it('skips a holiday for the next sweep too (a 1st-week-only rule jumps a month)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 7, 15, 30)));  // Wed 2026-10-07, 1st Wed
    const r = rule({ week2: '0', week3: '0', week4: '0', week5: '0' });
    const now = globalThis.nextSweep(r);
    expect(now.da).toBe(7);
    const next = globalThis.nextSweep(r, now.end);
    expect([next.mo, next.da]).toEqual([11, 4]);  // next 1st Wednesday
  });
});

describe('makeTimeCore — one core per city (docs/multi-city/)', () => {
  const MON = { weekday: 'Mon', fromhour: '8', tohour: '12' };
  const boston = () => globalThis.makeTimeCore({ tz: 'America/New_York' });
  const buenosAires = () => globalThis.makeTimeCore({ tz: 'America/Argentina/Buenos_Aires' });
  const APR_TO_NOV = [4, 5, 6, 7, 8, 9, 10, 11];

  it('the SF globals are the SF instance: same instants as a core built for America/Los_Angeles', () => {
    const la = globalThis.makeTimeCore({ tz: globalThis.SF_TZ });
    expect(la.wallToInstant(2026, 6, 17, 8).getTime()).toBe(globalThis.sfWallToInstant(2026, 6, 17, 8).getTime());
    expect(la.wallToInstant(2026, 3, 8, 2).getTime()).toBe(globalThis.sfWallToInstant(2026, 3, 8, 2).getTime());
  });

  it('Boston: wall time is Eastern, through both DST edges', () => {
    const c = boston();
    expect(c.wallToInstant(2026, 6, 17, 8).getTime()).toBe(Date.UTC(2026, 5, 17, 12, 0));  // EDT, UTC-4
    expect(c.wallToInstant(2026, 1, 14, 8).getTime()).toBe(Date.UTC(2026, 0, 14, 13, 0));  // EST, UTC-5
    expect(c.wallToInstant(2026, 3, 8, 2).getTime()).toBe(Date.UTC(2026, 2, 8, 7, 0));     // 2am does not exist → 3am EDT
    expect(c.parts(c.wallToInstant(2026, 11, 1, 1)).h).toBe(1);                            // 1am happens twice
  });

  it('Boston: "today" follows the city, not SF (9:30 PM Pacific is already tomorrow in Boston)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 5, 16, 4, 30)));          // Tue 12:30 AM EDT
    expect(boston().today()).toBe(2);
    expect(globalThis.todaySF()).toBe(1);                                                  // still Monday in SF
  });

  it('a rule with months sweeps only in season: after Nov 30 the next sweep is in April', () => {
    const c = boston(), rec = rule({ ...MON, months: APR_TO_NOV });
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 10, 29, 17, 0)));         // Sun 2026-11-29
    let ns = c.nextSweep(rec);
    expect([ns.y, ns.mo, ns.da]).toEqual([2026, 11, 30]);                                  // last Monday of the season
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 1, 17, 0)));                              // Tue 2026-12-01
    ns = c.nextSweep(rec);
    expect([ns.y, ns.mo, ns.da]).toEqual([2027, 4, 5]);                                    // first Monday of April
    expect(ns.start.getTime()).toBe(Date.UTC(2027, 3, 5, 12, 0));                          // 8am EDT
    expect(c.countdown(ns)).toBe('in 125 days');
  });

  it('a rule without months is year round, exactly as before', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 11, 1, 17, 0)));
    const ns = boston().nextSweep(rule(MON));
    expect([ns.y, ns.mo, ns.da]).toEqual([2026, 12, 7]);
  });

  it('holidays are per city: no table means no suspension; a city rule suspends and names the day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 19, 0)));           // Wed 2026-07-01
    const fri = rule({ weekday: 'Fri' });
    expect(boston().nextSweep(fri).da).toBe(3);                                            // SF suspends 7/3, this core has no table
    expect(globalThis.nextSweep(fri).da).toBe(10);
    const withHoliday = globalThis.makeTimeCore({ tz: 'America/New_York', suspended: (rec, iso) => iso === '2026-07-03', holidayName: () => 'Independence Day' });
    expect(withHoliday.nextSweep(fri).da).toBe(10);
    expect(withHoliday.holidaySkip(fri)).toMatchObject({ iso: '2026-07-03', name: 'Independence Day' });
  });

  it('Buenos Aires: UTC-3 all year (no DST), and the alert anchors use the city\'s evening', () => {
    const c = buenosAires();
    expect(c.wallToInstant(2026, 1, 14, 7).getTime()).toBe(Date.UTC(2026, 0, 14, 10, 0));
    expect(c.wallToInstant(2026, 7, 15, 7).getTime()).toBe(Date.UTC(2026, 6, 15, 10, 0));
    const a = c.alertAnchors(c.wallToInstant(2026, 7, 15, 9));                             // Wed 9 AM window
    expect(a.night).toBe(false);
    expect(a.eve.getTime()).toBe(Date.UTC(2026, 6, 14, 23, 0));                            // 8 PM Tuesday, Buenos Aires
    expect(a.morn.getTime()).toBe(Date.UTC(2026, 6, 15, 10, 0));                           // 7 AM, two hours before
  });

  it('Buenos Aires avenue ban (business days 7 to 21) runs on the same engine as a sweep window', () => {
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((weekday) => rule({ weekday, fromhour: '7', tohour: '21' }));
    const next = (c) => WEEKDAYS.map((r) => c.nextSweep(r)).sort((a, b) => a.start - b.start)[0];
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 3, 1, 0)));            // Fri 2026-10-02, 10 PM there
    let ns = next(buenosAires());
    expect([ns.mo, ns.da]).toEqual([10, 5]);                                               // free all weekend, back Monday
    expect(ns.start.getTime()).toBe(Date.UTC(2026, 9, 5, 10, 0));                          // 7:00, UTC-3
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 1, 0)));                               // Fri 2026-10-09, 10 PM there
    // Mon 2026-10-12 is a national holiday in Argentina: not a business day
    const withHolidays = globalThis.makeTimeCore({ tz: 'America/Argentina/Buenos_Aires', suspended: (rec, iso) => iso === '2026-10-12' });
    ns = next(withHolidays);
    expect([ns.mo, ns.da]).toEqual([10, 13]);                                              // Tuesday
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 7, 15, 0)));                               // Wed noon there: inside the window
    ns = next(buenosAires());
    expect(ns.start.getTime()).toBeLessThan(Date.now());
    expect(ns.end.getTime()).toBe(Date.UTC(2026, 9, 8, 0, 0));                             // until 21:00 Wednesday
  });

  for (const TZ of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    it(`device TZ=${TZ}: a Boston instant is the same everywhere`, () => {
      const out = execFileSync(process.execPath, ['-e',
        "import('./lib/sweep-core.js').then(()=>process.stdout.write(String(globalThis.makeTimeCore({tz:'America/New_York'}).wallToInstant(2026,6,17,8).getTime())))",
      ], { env: { ...process.env, TZ }, encoding: 'utf8' });
      expect(Number(out)).toBe(Date.UTC(2026, 5, 17, 12, 0));
    });
  }
});

describe('sweepWords — a sweep after midnight reads by the night people think in (owner, 2026-10-05)', () => {
  // "TUE 12AM-2AM" seen on Monday evening used to read "Tue 10/6, 12AM to 2AM": people took it for Tuesday
  // NIGHT and got ticketed. Owner's format: "Mon night 10/5 → Tue 12 to 2 AM · tonight".
  const at = (iso) => new Date(iso);
  const line = (w) => w.when + ' · ' + w.rel;
  const words = (o, nowIso) => {
    vi.useFakeTimers(); vi.setSystemTime(at(nowIso));
    const ns = globalThis.nextSweep(rule(o));
    return globalThis.sweepWords(ns, new Date());
  };
  const TUE0 = { weekday: 'Tue', fromhour: '0', tohour: '2' };

  it('a Tue 12 AM sweep seen Monday evening: "Mon night 10/5 → Tue 12 to 2 AM · tonight"', () => {
    const w = words(TUE0, '2026-10-06T03:00:00Z');                       // Mon 10/5 8 PM PDT
    expect(line(w)).toBe('Mon night 10/5 → Tue 12 to 2 AM · tonight');
    expect(w).toMatchObject({ night: true, day: 'Mon night 10/5', head: 'Mon night', win: 'Tue 12 to 2 AM' });
    expect(w.nightOf).toEqual({ dow: 1, y: 2026, mo: 10, da: 5 });
  });
  it('seen Monday morning it is still "tonight" (the hours countdown said "in 15 hr")', () => {
    expect(words(TUE0, '2026-10-05T16:00:00Z').rel).toBe('tonight');      // Mon 9 AM PDT
    expect(words(TUE0, '2026-10-06T06:45:00Z').rel).toBe('tonight');      // Mon 11:45 PM PDT
  });
  it('seen Sunday evening it is "tomorrow night" (the calendar countdown said "in 2 days")', () => {
    const w = words(TUE0, '2026-10-05T03:00:00Z');                       // Sun 10/4 8 PM PDT, 28 h out
    expect(line(w)).toBe('Mon night 10/5 → Tue 12 to 2 AM · tomorrow night');
  });
  it('a later week counts days to the night: "Thu night 10/8 → Fri 12 to 2 AM · in 3 days"', () => {
    const w = words({ weekday: 'Fri', fromhour: '0', tohour: '2' }, '2026-10-06T03:00:00Z');
    expect(line(w)).toBe('Thu night 10/8 → Fri 12 to 2 AM · in 3 days');
    expect(w.day).toBe('Thu night 10/8');
  });
  it('after that midnight, before the start, it counts hours like the push\'s morning copy', () => {
    const w = words({ weekday: 'Tue', fromhour: '2', tohour: '6' }, '2026-10-06T07:30:00Z'); // Tue 12:30 AM PDT
    expect(line(w)).toBe('Mon night 10/5 → Tue 2 to 6 AM · in 2 hr');
    expect(words({ weekday: 'Tue', fromhour: '2', tohour: '6' }, '2026-10-06T08:30:00Z').rel).toBe('in <1 hr');
  });
  // Before 6 AM people are still in the previous date's night: at Mon 12:30 AM "tonight" is Sunday night, the
  // one they are up in, so Monday night is "tomorrow night" (the calendar count said "tonight").
  it('Mon 12:30 AM: a Tue 2 AM sweep (Monday night) is "tomorrow night", not "tonight"', () => {
    const w = words({ weekday: 'Tue', fromhour: '2', tohour: '6' }, '2026-10-05T07:30:00Z');  // Mon 10/5 12:30 AM PDT
    expect(line(w)).toBe('Mon night 10/5 → Tue 2 to 6 AM · tomorrow night');
    expect(words(TUE0, '2026-10-05T07:30:00Z').rel).toBe('tomorrow night');
  });
  it('Mon 12:30 AM: a Mon 2 AM sweep is the night people are in, so it counts hours (90 min away)', () => {
    const w = words({ weekday: 'Mon', fromhour: '2', tohour: '6' }, '2026-10-05T07:30:00Z');
    expect(line(w)).toBe('Sun night 10/4 → Mon 2 to 6 AM · in 2 hr');
  });
  it('Mon 12:30 AM mid-sweep (Mon 12 to 2 AM): the next one is a week from the night people are in', () => {
    vi.useFakeTimers(); vi.setSystemTime(at('2026-10-05T07:30:00Z'));
    const r = rule({ weekday: 'Mon', fromhour: '0', tohour: '2', holidays: '1' }); // nightly table: 10/12 is not skipped
    const now = globalThis.nextSweep(r);
    expect(+new Date() >= +now.start && +new Date() < +now.end).toBe(true); // in progress: the page says "Sweeping now"
    const next = globalThis.nextSweep(r, now.end);
    // Sun night 10/4 → Sun night 10/11 is 7 nights (the calendar count from Monday said "in 6 days")
    expect(line(globalThis.sweepWords(next, new Date()))).toBe('Sun night 10/11 → Mon 12 to 2 AM · in 7 days');
  });
  it('Mon 5:59 AM is still Sunday night ("tomorrow night"); 6 AM is Monday ("tonight")', () => {
    expect(words(TUE0, '2026-10-05T12:59:00Z').rel).toBe('tomorrow night');             // Mon 5:59 AM PDT
    expect(words({ weekday: 'Mon', fromhour: '5', tohour: '7' }, '2026-10-05T12:59:00Z').rel).toBe('in <1 hr');
    expect(words({ weekday: 'Wed', fromhour: '0', tohour: '2' }, '2026-10-05T12:59:00Z').rel).toBe('in 2 days');
    expect(words(TUE0, '2026-10-05T13:00:00Z').rel).toBe('tonight');                     // Mon 6:00 AM PDT
    expect(words({ weekday: 'Wed', fromhour: '0', tohour: '2' }, '2026-10-05T13:00:00Z').rel).toBe('tomorrow night');
  });
  it('a day sweep keeps the calendar countdown before 6 AM (only the night words move)', () => {
    expect(words({ weekday: 'Tue', fromhour: '9', tohour: '11' }, '2026-10-05T07:30:00Z').rel).toBe('tomorrow');
    expect(words({ weekday: 'Mon', fromhour: '9', tohour: '11' }, '2026-10-05T07:30:00Z').rel).toBe('in 9 hr');
  });
  it('a 5 AM sweep is a night one: "Mon night 10/5 → Tue 5 to 7 AM · tonight"', () => {
    expect(line(words({ weekday: 'Tue', fromhour: '5', tohour: '7' }, '2026-10-06T03:00:00Z')))
      .toBe('Mon night 10/5 → Tue 5 to 7 AM · tonight');
  });
  it('6 AM is morning: worded by its own day (the push still sends "move it tonight" at 9 PM)', () => {
    const w = words({ weekday: 'Tue', fromhour: '6', tohour: '8' }, '2026-10-06T03:00:00Z');
    expect(line(w)).toBe('Tue 10/6, 6AM to 8AM · in 10 hr');
    expect(w).toMatchObject({ night: false, day: 'Tue 10/6', head: 'Tue 6AM', nightOf: null });
    expect(globalThis.NIGHT_WORDS_BEFORE_H).toBe(6);
    expect(globalThis.alertAnchors(globalThis.sfWallToInstant(2026, 10, 6, 6)).night).toBe(true);
  });
  it('a normal 9 AM sweep is unchanged: date, window, the old countdown', () => {
    for (const nowIso of ['2026-10-06T03:00:00Z', '2026-10-05T03:00:00Z', '2026-10-06T15:30:00Z']) {
      vi.useFakeTimers(); vi.setSystemTime(at(nowIso));
      const ns = globalThis.nextSweep(rule({ weekday: 'Tue', fromhour: '9', tohour: '11' }));
      const w = globalThis.sweepWords(ns, new Date());
      expect(w.when).toBe('Tue 10/6, 9AM to 11AM');
      expect(w).toMatchObject({ night: false, day: 'Tue 10/6', head: 'Tue 9AM', win: '9AM to 11AM' });
      expect(w.rel).toBe(globalThis.sweepCountdown(ns, new Date()));
    }
    expect(words({ weekday: 'Tue', fromhour: '9', tohour: '11' }, '2026-10-05T03:00:00Z').rel).toBe('in 2 days');
  });
  it('noon is a day sweep: "Tue 10/6, 12PM to 2PM"', () => {
    const w = words({ weekday: 'Tue', fromhour: '12', tohour: '14' }, '2026-10-06T03:00:00Z');
    expect(w).toMatchObject({ night: false, when: 'Tue 10/6, 12PM to 2PM', head: 'Tue 12PM' });
  });
  it('DST fall-back (Sun 2026-11-01): nights stay on SF calendar dates, hours stay real hours', () => {
    expect(line(words({ weekday: 'Sun', fromhour: '0', tohour: '2' }, '2026-11-01T03:00:00Z')))  // Sat 10/31 8 PM PDT
      .toBe('Sat night 10/31 → Sun 12 to 2 AM · tonight');
    // Sat evening → Mon 12 AM across the 25-hour Sunday: still "tomorrow night", never "in 2 days"
    expect(line(words({ weekday: 'Mon', fromhour: '0', tohour: '2' }, '2026-11-01T03:00:00Z')))
      .toBe('Sun night 11/1 → Mon 12 to 2 AM · tomorrow night');
    // Sun 12:30 AM PDT → 2 AM PST is 1.5 wall hours but 2.5 real hours
    expect(line(words({ weekday: 'Sun', fromhour: '2', tohour: '6' }, '2026-11-01T07:30:00Z')))
      .toBe('Sat night 10/31 → Sun 2 to 6 AM · in 3 hr');
    expect(words({ weekday: 'Mon', fromhour: '0', tohour: '2' }, '2026-11-02T07:30:00Z').rel).toBe('tonight'); // Sun 11:30 PM PST
  });
  it('a holiday skip: the next sweep after it is worded right, and the skipped one names its night', () => {
    // Sun 10/11 8 PM PDT; Mon 10/12 is Indigenous Peoples Day. A 5 to 7 AM row follows the daytime table
    // (only windows inside 12 AM to 6 AM are overnight routes), so tonight's sweep is off
    const MON5 = { weekday: 'Mon', fromhour: '5', tohour: '7' };
    expect(line(words(MON5, '2026-10-12T03:00:00Z'))).toBe('Sun night 10/18 → Mon 5 to 7 AM · in 7 days');
    const skip = globalThis.holidaySkip(rule(MON5));
    expect(skip).toMatchObject({ iso: '2026-10-12', name: 'Indigenous Peoples Day' });
    expect(globalThis.sweepDayWords(skip.y, skip.mo, skip.da, MON5.fromhour, MON5.tohour).when)
      .toBe('Sun night 10/11 → Mon 5 to 7 AM');
    // an overnight row (12 to 2 AM, flagged or not) sweeps through the minor holiday: still tonight
    const MON0 = { weekday: 'Mon', fromhour: '0', tohour: '2' };
    expect(line(words(MON0, '2026-10-12T03:00:00Z'))).toBe('Sun night 10/11 → Mon 12 to 2 AM · tonight');
    expect(line(words({ ...MON0, holidays: '1' }, '2026-10-12T03:00:00Z'))).toBe('Sun night 10/11 → Mon 12 to 2 AM · tonight');
  });
  it('the night before the 1st is the last day of the previous month (and year)', () => {
    expect(globalThis.sweepDayWords(2026, 8, 1, 0, 2).when).toBe('Fri night 7/31 → Sat 12 to 2 AM');
    expect(globalThis.sweepDayWords(2027, 1, 1, 2, 6).day).toBe('Thu night 12/31');
  });
  it('a window that ends after noon keeps the fmtHour pair', () => {
    expect(globalThis.sweepDayWords(2026, 10, 6, 5, 13).win).toBe('Tue 5AM to 1PM');
  });
  for (const TZ of ['Asia/Tokyo', 'Pacific/Honolulu', 'UTC']) {
    it(`device TZ=${TZ}: the same words (SF dates, not the device's)`, () => {
      const out = execFileSync(process.execPath, ['-e',
        "import('./lib/sweep-core.js').then(()=>{const g=globalThis;const ns={y:2026,mo:10,da:6,dow:2,fromH:0,toH:2,start:g.sfWallToInstant(2026,10,6,0),end:g.sfWallToInstant(2026,10,6,2)};const w=g.sweepWords(ns,new Date('2026-10-06T03:00:00Z'));process.stdout.write(w.when+' · '+w.rel)})",
      ], { env: { ...process.env, TZ }, encoding: 'utf8' });
      expect(out).toBe('Mon night 10/5 → Tue 12 to 2 AM · tonight');
    });
  }
});
