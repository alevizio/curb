// San Jose's data build (scripts/cities/san-jose.mjs): the monthly day, the residential sign's two windows, the major
// roads' posted text per side, and the holidays, on real rows of the City's sweeping routes (2023-12-14 / 2026-08-24).
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { parseMonthly, parseWindows, parsePosted, sideFacing, crossName, HOLIDAYS, CITY_HOLIDAYS } from './san-jose.mjs';

const ROOT = new URL('../../', import.meta.url);

describe('parseMonthly: the residential day', () => {
  it('reads the nth weekday of the month as a weekday and a week bit', () => {
    expect(parseMonthly('1st Friday of the Month')).toEqual({ dow: 5, weeks: 1 });       // Marten Ave, Signed Route
    expect(parseMonthly('4th Wednesday of the Month')).toEqual({ dow: 3, weeks: 8 });
    expect(parseMonthly('3rd Monday of the Month')).toEqual({ dow: 1, weeks: 4 });
  });
  it('refuses the side by side rows (only on routes without signs)', () => {
    expect(parseMonthly('West Side: 1st Monday of the Month; East Side: 2nd Wednesday of the Month')).toBe(null);
    expect(parseMonthly('South Side Swept Only: 1st Monday of the Month')).toBe(null);
  });
});

describe('parseWindows: the residential sign\'s hours', () => {
  it('reads the two windows around the lunch break', () => {
    expect(parseWindows('7AM to NOON  12:30PM to 5PM')).toEqual([[7, 12], ['12:30', 17]]);
    expect(parseWindows('9AM to NOON  1PM to 4PM     ')).toEqual([[9, 12], [13, 16]]);
    expect(parseWindows('8AM to 12PM  12:30PM to 4:30PM')).toEqual([[8, 12], ['12:30', '16:30']]);
    expect(parseWindows('7:30AM to 12:30PM')).toEqual([['7:30', '12:30']]);
  });
  it('merges the hours of two signs on one row, so every hour either names is covered', () => {
    expect(parseWindows('8AM to NOON  1PM to 5PM  9AM to NOON 1PM to 4PM')).toEqual([[8, 12], [13, 17]]);
    expect(parseWindows('10AM to NOON  1PM to 3PM  9AM to NOON 1PM to 4PM')).toEqual([[9, 12], [13, 16]]);
    expect(parseWindows('9AM to NOON  1PM to 4PM  9AM to 11AM NOON to 2PM')).toEqual([[9, 16]]);
  });
  it('gives nothing for a signed row with no hours (Linkhorne Ct)', () => {
    expect(parseWindows('')).toEqual([]);
    expect(parseWindows(null)).toEqual([]);
  });
});

describe('parsePosted: a major road\'s sign for each side', () => {
  it('reads a different night for each side', () => {
    expect(parsePosted('West Side: No Parking Tuesday 1am-6am, East Side: No Parking Wednesday 1am-6am').rules).toEqual([
      { side: 'W', dows: [2], weeks: 31, from: 1, to: 6 }, { side: 'E', dows: [3], weeks: 31, from: 1, to: 6 }]);
    expect(parsePosted('North Side: No Parking Thursdays 1am-6am, South Side: No Parking Mondays 1am-6am').rules.map((r) => [r.side, r.dows]))
      .toEqual([['N', [4]], ['S', [1]]]);
  });
  it('reads the weeks of the month, and both sides at once', () => {
    expect(parsePosted('North Side: No Parking 1st and 3rd Monday 1am-6am, South Side: No Parking 2nd and 4th Monday 1am-6am').rules.map((r) => [r.side, r.weeks]))
      .toEqual([['N', 5], ['S', 10]]);
    expect(parsePosted('Both Sides: Mondays and Thursdays 3am-6am').rules).toEqual([{ side: 'B', dows: [1, 4], weeks: 31, from: 3, to: 6 }]);
    expect(parsePosted('Both Sides: No Parking 1st and 3rd Thursday 6am-8am').rules).toEqual([{ side: 'B', dows: [4], weeks: 5, from: 6, to: 8 }]);
  });
  it('reads "any day" as every day, drops a parenthesis, and lets a window run past midnight', () => {
    expect(parsePosted('Both Sides: No Parking Anyday from 3am-6am').rules[0].dows).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parsePosted('West Side: No Parking Tuesday 1am-6am, East Side: No Parking Wednesday 1am-6am (Diagonal Spaces Parking Allowed)').rules.length).toBe(2);
    expect(parsePosted('Both Sides: No Parking 2nd and 4th Monday 6pm-8am').rules).toEqual([{ side: 'B', dows: [1], weeks: 10, from: 18, to: 8 }]);
    expect(parsePosted('Both Sides: No Parking 1st and 3rd Wednesday 12am-2am').rules[0]).toMatchObject({ from: 0, to: 2 });
  });
  it('leaves out signs that are not a sweeping window', () => {
    const p = parsePosted('North Side: No Parking 3am-6am Any Day, South Side: No Stopping Anytime');
    expect(p.rules.map((r) => r.side)).toEqual(['N']);
    expect(p.other).toEqual(['South: No Stopping Anytime']);
    for (const t of ['Both Sides: 2 Hour Parking', 'East Side: Loading Zone Only', 'Both Sides: No Parking Anytime Except for Market/Almaden Permit',
      'Both Sides: No Parking 6am-10pm Sat-Sun, and 10pm-6am Any Day', 'North Side: 30 Minute Parking'])
      expect(parsePosted(t).rules).toEqual([]);
  });
});

describe('sideFacing and names', () => {
  it('finds the side facing a compass word', () => {
    const east = [[-121.89, 37.33], [-121.88, 37.33]], north = [[-121.89, 37.33], [-121.89, 37.34]];
    expect([sideFacing(east, 'N'), sideFacing(east, 'S')]).toEqual(['L', 'R']);
    expect([sideFacing(north, 'W'), sideFacing(north, 'E')]).toEqual(['L', 'R']);
  });
  it('writes the cross streets for people', () => {
    expect(crossName('MT KENYA DR')).toBe('Mt Kenya Dr');
    expect(crossName('SANTA TERESA BL')).toBe('Santa Teresa Blvd');
    expect(crossName('CALERO AV')).toBe('Calero Ave');
    expect(crossName('EOS')).toBe('End');
    expect(crossName('Market St')).toBe('Market St');
  });
});

describe('holidays: the City\'s lookup calendar', () => {
  it('lists the posted days whose residential sweep moves for New Year\'s Day, Thanksgiving and Christmas', () => {
    expect(Object.keys(HOLIDAYS).sort()).toEqual(['2026-01-01', '2026-01-02', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01', '2027-11-25', '2027-11-26']);
  });
  it('keeps residential sweeps on the other City holidays (Indigenous Peoples Day, Veterans Day, MLK Day)', () => {
    for (const d of ['2026-10-12', '2026-11-11', '2027-01-18', '2027-02-15']) expect(HOLIDAYS[d]).toBeUndefined();
  });
  it('lists the other City holidays, which stop the major road sweeps: weekdays, none already a holiday for everyone', () => {
    expect(Object.keys(CITY_HOLIDAYS)).toHaveLength(11);
    for (const d of Object.keys(CITY_HOLIDAYS)) {
      expect(HOLIDAYS[d]).toBeUndefined();
      expect([1, 2, 3, 4, 5]).toContain(new Date(d + 'T12:00:00Z').getUTCDay());
    }
    expect(CITY_HOLIDAYS['2027-07-05']).toBe('Independence Day');   // observed: July 4, 2027 is a Sunday
  });
});

describe('the built data, read by lib/city.js', () => {
  beforeAll(async () => { await import('../../lib/sweep-core.js'); await import('../../lib/city.js'); });
  afterEach(() => { vi.useRealTimers(); });
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`data/san-jose/${f}`, ROOT), 'utf8'));
  it('Marten Ave (1st Friday, 7 AM to noon and 12:30 to 5 PM): no sweep on New Year\'s Day, the next on Feb 5', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-30T20:00:00Z'));
    const city = globalThis.makeCity(read('city.json'));
    const marten = read('segments.json').b.find((b) => b.c === '11964');
    const rows = city.rowsOf(marten).filter((r) => r.cnnrightleft === 'L');
    expect(rows.map((r) => [r.weekday, r.fromhour, r.tohour, r.week1])).toEqual([['Fri', '7', '12', '1'], ['Fri', '12:30', '17', '1']]);
    const next = rows.map((r) => city.core.nextSweep(r)).sort((a, b) => a.start - b.start)[0];
    expect([next.y, next.mo, next.da, next.fromH]).toEqual([2027, 2, 5, 7]);
  });
  it('flags every major road rule 16, and only those', () => {
    const rules = read('segments.json').b.flatMap((b) => b.d.flatMap(([, , r]) => r));
    expect(rules.filter((r) => r[5] === 16).length).toBe(521);
    expect(rules.every((r) => r[5] === 0 || r[5] === 16)).toBe(true);
  });
  it('S 1st St (a major road, 3 to 6 AM every day): no Wednesday sweep on Veterans Day, the next on Nov 18', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T20:00:00Z'));
    const city = globalThis.makeCity(read('city.json'));
    const row = city.rowsOf(read('segments.json').b.find((b) => b.c === '9553')).find((r) => r.cnnrightleft === 'L' && r.weekday === 'Wed');
    expect([row.fromhour, row.tohour, row.flags]).toEqual(['3', '6', 16]);
    expect(city.core.holidaySkip(row)).toMatchObject({ iso: '2026-11-11', name: 'Veterans Day' });
    const next = city.core.nextSweep(row);
    expect([next.mo, next.da, next.fromH]).toEqual([11, 18, 3]);
  });
});
