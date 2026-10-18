// Glendale's data build (scripts/cities/glendale.mjs): the posted windows, the curb placement on real rows of the
// City's PW/StreetSweeping and Common/Streets layers (2026-10-18), the unnamed streets and the holidays.
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { parseWindow, parseSchedule, nameUnnamed, xy, HOLIDAYS, SHIFT_IS_POSTED, isShiftWindow } from './glendale.mjs';
import { matchCurbs, keepRules, compass, addresses } from './santa-monica.mjs';

const ROOT = new URL('../../', import.meta.url);
const rule = (dow, from, to) => [dow, from, to, 31, 0, 0];

// Real rows: E Harvard St between S Jackson St and S Isabel St (Streets OBJECTID 3371) and the curb lines along it.
// On Street View the north curb's sign reads Wednesday (2025 imagery), as the data does.
const HARVARD = { id: 3371, name: 'E Harvard St', coords: [[-118.249448, 34.144526], [-118.248814, 34.144527]],
  props: { From_L: 551, To_L: 599, From_R: 550, To_R: 598 } };
const SOUTH_CURB = { id: 1869, Day: 'Tuesday', Time: '8AM-11AM', coords: [[[-118.249434, 34.144381], [-118.249186, 34.144385], [-118.248837, 34.144389]]] };
// curb 2063, its run of near duplicate vertices thinned to three
const NORTH_CURB = { id: 2063, Day: 'Wednesday', Time: '8AM-11AM', coords: [[[-118.248958, 34.144607], [-118.248978, 34.144607], [-118.249432, 34.144599]]] };
const curb = (c) => ({ ...c, rules: parseSchedule(c.Day, c.Time).rules, label: `${c.Day} ${c.Time}` });

describe('parseWindow: the posted hours as the City writes them', () => {
  it('reads the common windows', () => {
    expect(parseWindow('8AM-3PM')).toEqual({ from: 8, to: 15 });
    expect(parseWindow('8AM-10AM')).toEqual({ from: 8, to: 10 });
    expect(parseWindow('12PM-2PM')).toEqual({ from: 12, to: 14 });
    expect(parseWindow('3AM-6AM')).toEqual({ from: 3, to: 6 });
  });
  it('reads minutes written without a colon, and ends without AM or PM', () => {
    expect(parseWindow('3AM-630AM')).toEqual({ from: 3, to: '6:30' });
    expect(parseWindow('8-12pm')).toEqual({ from: 8, to: 12 });
    expect(parseWindow('10-12')).toEqual({ from: 10, to: 12 });
    expect(parseWindow('10-12PM')).toEqual({ from: 10, to: 12 });
    expect(parseWindow('9-12PM')).toEqual({ from: 9, to: 12 });
  });
  it('refuses what it cannot read', () => {
    expect(parseWindow('')).toBe(null);
    expect(parseWindow('noon')).toBe(null);
    expect(parseWindow('3PM-8AM')).toBe(null);
  });
});

describe('parseSchedule: day and window', () => {
  it('reads the day in any case', () => {
    expect(parseSchedule('Tuesday', '8AM-11AM').rules).toEqual([rule(2, 8, 11)]);
    expect(parseSchedule('MONDAY', '8AM-12PM').rules).toEqual([rule(1, 8, 12)]);
    expect(parseSchedule('THURSDAY', '9-12PM').rules).toEqual([rule(4, 9, 12)]);
    expect(parseSchedule('Monday', '3AM-630AM').rules).toEqual([rule(1, 3, '6:30')]);
  });
  it('leaves out a line with hours but no day (452 in the data)', () => {
    expect(parseSchedule(null, '8AM-10AM').why).toBe('no day');
  });
});

describe('the 8 AM to 3 PM shift window', () => {
  it('is told apart from posted windows, and left off the map by default', () => {
    expect(isShiftWindow(parseSchedule('Tuesday', '8AM-3PM').rules[0])).toBe(true);
    expect(isShiftWindow(parseSchedule('Tuesday', '8AM-11AM').rules[0])).toBe(false);
    expect(isShiftWindow(parseSchedule('Monday', '3AM-630AM').rules[0])).toBe(false);
    expect(SHIFT_IS_POSTED).toBe(false);
  });
});

describe('sides: the lines are curbs, one per side', () => {
  it('puts E Harvard St\'s north curb (Wednesday) on the left and its south curb (Tuesday) on the right', () => {
    const m = matchCurbs([curb(SOUTH_CURB), curb(NORTH_CURB)], [HARVARD], { project: xy });
    expect(keepRules(m.sides.get('3371|L'), 58).rules).toEqual([rule(3, 8, 11)]);
    expect(keepRules(m.sides.get('3371|R'), 58).rules).toEqual([rule(2, 8, 11)]);
    expect(compass(HARVARD.coords, 'L', xy)).toBe('North');
    expect(compass(HARVARD.coords, 'R', xy)).toBe('South');
  });
  it('reads the house numbers: 550 to 599, odd on the left (north)', () => {
    expect(addresses([{ piece: HARVARD, fwd: true }], ['From_L', 'To_L', 'From_R', 'To_R'])).toEqual({ n: [550, 599], o: 'L' });
  });
});

describe('nameUnnamed: a centerline with no name takes the name of the street it continues', () => {
  const at = (x, y) => [-118.25 + x / 92100, 34.16 + y / 110950];
  it('names a piece that continues a named street in a straight line, through another unnamed piece', () => {
    const named = { id: 1, name: 'Wilson Ave', coords: [at(0, 0), at(100, 0)] };
    const u1 = { id: 2, name: null, coords: [at(100, 0), at(200, 2)] };
    const u2 = { id: 3, name: null, coords: [at(200, 2), at(300, 0)] };
    const side = { id: 4, name: null, coords: [at(200, 2), at(200, 100)] };   // turns off at 90°
    expect(nameUnnamed([named, u1, u2, side])).toBe(2);
    expect([u1.name, u2.name, side.name]).toEqual(['Wilson Ave', 'Wilson Ave', null]);
    expect(u1.inferred).toBe(true);
  });
  it('leaves a piece between two different streets unnamed', () => {
    const a = { id: 1, name: 'Brand Blvd', coords: [at(0, 0), at(0, 100)] };
    const u = { id: 2, name: null, coords: [at(0, 100), at(0, 200)] };
    const b = { id: 3, name: 'N Brand Blvd', coords: [at(0, 200), at(0, 300)] };
    expect(nameUnnamed([a, u, b])).toBe(0);
    expect(u.name).toBe(null);
  });
});

describe('holidays: glendalerecycles.com/street-sweeping', () => {
  it('lists the 9 holidays on their own dates, and no Friday after Thanksgiving', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026')).length).toBe(9);
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027')).length).toBe(9);
    expect(HOLIDAYS['2026-11-11']).toBe('Veterans Day');
    expect(HOLIDAYS['2026-11-27']).toBeUndefined();
    expect(HOLIDAYS['2027-07-05']).toBeUndefined();   // the page names no observed day
  });
});

describe('the built data, read by lib/city.js', () => {
  beforeAll(async () => { await import('../../lib/sweep-core.js'); await import('../../lib/city.js'); });
  afterEach(() => { vi.useRealTimers(); });
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`data/glendale/${f}`, ROOT), 'utf8'));
  it('skips Veterans Day: E Harvard St\'s north curb is next swept Wednesday Nov 18, 8 to 11 AM', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T20:00:00Z'));   // Tuesday noon in Glendale
    const city = globalThis.makeCity(read('city.json'));
    const harvard = read('segments.json').b.find((b) => b.c === '3371');
    const north = city.rowsOf(harvard).find((r) => r.cnnrightleft === 'L');
    const next = city.core.nextSweep(north);
    expect([next.mo, next.da, next.fromH, next.toH]).toEqual([11, 18, 8, 11]);
  });
});
