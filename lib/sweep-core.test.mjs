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
