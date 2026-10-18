// Santa Monica's data build (scripts/cities/santa-monica.mjs): the schedule reader, the curb placement, the cross
// streets and the holidays, on real rows of the City's Street Sweeping and Street Centerlines layers (2026-10-18).
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { parseSchedule, matchCurbs, keepRules, limits, compass, titleCase, addresses, HOLIDAYS } from './santa-monica.mjs';

const ROOT = new URL('../../', import.meta.url);
const rule = (dow, from, to) => [dow, from, to, 31, 0, 0];

// Real rows. Pico Blvd between 3rd St and 4th St (Street Centerlines objectid_1 5674) and the curb lines along it.
const PICO = { id: 5674, name: 'PICO BLVD', coords: [[-118.488095, 34.009068], [-118.487383, 34.009559], [-118.487287, 34.009626]],
  props: { adlf: 305, adlt: 331, adrf: 300, adrt: 332 } };
const PICO_NORTH = { id: 17892, day: 'TRSat', time: '3-6',
  coords: [[[-118.487448, 34.009668], [-118.48786, 34.009379], [-118.48911, 34.008517], [-118.489634, 34.008146]]] };
const PICO_SOUTH = { id: 17984, day: 'MWF', time: '3-6',
  coords: [[[-118.488015, 34.008994], [-118.487787, 34.009153], [-118.487634, 34.009258], [-118.487337, 34.009463], [-118.48729, 34.009459]]] };
// Hollister Ave between 4th St and 5th St (objectid_1 6200): Tuesday 9-11 on one curb, Monday 3-5 on the other.
const HOLLISTER = { id: 6200, name: 'HOLLISTER AVE', coords: [[-118.483386, 34.005837], [-118.483288, 34.005905], [-118.482611, 34.006376], [-118.482536, 34.006428]] };
const HOLLISTER_NW = { id: 17703, day: 'Tuesday', time: '9-11', coords: [[[-118.482669, 34.006438], [-118.483025, 34.006192], [-118.483113, 34.00613], [-118.483333, 34.005978]]] };
const HOLLISTER_SE = { id: 17792, day: 'Monday', time: '3-5', coords: [[[-118.483215, 34.005829], [-118.483209, 34.005868], [-118.482963, 34.006041], [-118.482862, 34.006111], [-118.482559, 34.006323]]] };
const curb = (c) => ({ ...c, rules: parseSchedule(c.day, c.time).rules, label: `${c.day} ${c.time}` });

describe('parseSchedule: the day and the hours without AM or PM', () => {
  it('reads daytime windows from 9 AM to 5 PM: an hour before 7 is in the afternoon', () => {
    expect(parseSchedule('Thursday', '12-2').rules).toEqual([rule(4, 12, 14)]);
    expect(parseSchedule('Tuesday', '9-11').rules).toEqual([rule(2, 9, 11)]);
    expect(parseSchedule('Friday', '3-5').rules).toEqual([rule(5, 15, 17)]);
    expect(parseSchedule('Thursday', '11-1').rules).toEqual([rule(4, 11, 13)]);
    expect(parseSchedule('Friday', '7-9').rules).toEqual([rule(5, 7, 9)]);
  });
  it('keeps minutes as "H:MM", and reads the longer windows and the typo "9--11"', () => {
    expect(parseSchedule('Monday', '3:30-5').rules).toEqual([rule(1, '15:30', 17)]);
    expect(parseSchedule('Friday', '10-2').rules).toEqual([rule(5, 10, 14)]);
    expect(parseSchedule('Thursday', '12-3').rules).toEqual([rule(4, 12, 15)]);
    expect(parseSchedule('Tuesday', '9--11').rules).toEqual([rule(2, 9, 11)]);
    expect(parseSchedule('Sunday', '11-1').rules).toEqual([rule(0, 11, 13)]);
  });
  it('reads Pico Blvd\'s three nights a week as 3 to 6 AM: Mon/Wed/Fri and Tue/Thu/Sat', () => {
    expect(parseSchedule('MWF', '3-6').rules).toEqual([rule(1, 3, 6), rule(3, 3, 6), rule(5, 3, 6)]);
    expect(parseSchedule('TRSat', '3-6').rules).toEqual([rule(2, 3, 6), rule(4, 3, 6), rule(6, 3, 6)]);
  });
  it('says why a row cannot be read', () => {
    expect(parseSchedule('null', ' ').why).toBe('no day');
    expect(parseSchedule('null', '3:30-5').why).toBe('no day');
    expect(parseSchedule('Wednesday', ' ').why).toBe('no hours');
    expect(parseSchedule('Wednesday', '5-3').why).toBe('hours "5-3"');
  });
});

describe('matchCurbs: each curb line goes to the side of the street it runs along', () => {
  it('puts Pico Blvd\'s north curb (Tue/Thu/Sat) on the left of the centerline and the south curb (Mon/Wed/Fri) on the right', () => {
    const m = matchCurbs([curb(PICO_NORTH), curb(PICO_SOUTH)], [PICO]);
    expect([...m.sides.keys()].sort()).toEqual(['5674|L', '5674|R']);
    expect(keepRules(m.sides.get('5674|L'), 90).rules).toEqual([rule(2, 3, 6), rule(4, 3, 6), rule(6, 3, 6)]);
    expect(keepRules(m.sides.get('5674|R'), 90).rules).toEqual([rule(1, 3, 6), rule(3, 3, 6), rule(5, 3, 6)]);
    expect(compass(PICO.coords, 'L')).toBe('Northwest');
    expect(compass(PICO.coords, 'R')).toBe('Southeast');
  });
  it('splits Hollister Ave\'s two curbs between its two sides, Tuesday 9 to 11 AM and Monday 3 to 5 PM', () => {
    const m = matchCurbs([curb(HOLLISTER_NW), curb(HOLLISTER_SE)], [HOLLISTER]);
    expect(keepRules(m.sides.get('6200|L'), 95).rules).toEqual([rule(2, 9, 11)]);
    expect(keepRules(m.sides.get('6200|R'), 95).rules).toEqual([rule(1, 15, 17)]);
  });
  it('leaves a curb with no street running the same way within 30 m unplaced', () => {
    const far = { id: 1, rules: [rule(1, 9, 11)], coords: [PICO.coords.map(([x, y]) => [x - 0.0005, y + 0.0005])] };   // ~70 m north-west
    const across = { id: 2, rules: [rule(1, 9, 11)], coords: [[[-118.4875, 34.0091], [-118.4879, 34.0095]]] };            // crosses Pico
    const m = matchCurbs([far, across], [PICO]);
    expect(m.sides.size).toBe(0);
    expect(m.unassigned.map((u) => u.id)).toEqual([1, 2]);
  });
});

describe('keepRules: how much of a block a curb schedule must cover', () => {
  const side = (...scheds) => ({ len: 0, scheds: new Map(scheds.map(([label, len, rules]) => [label, { rules, len }])) });
  it('keeps a schedule covering 15% of the block and 15 m, and drops a curb corner reaching in from a cross street', () => {
    const s = side(['Tuesday 9-11', 90, [rule(2, 9, 11)]], ['Friday 1-3', 8, [rule(5, 13, 15)]]);
    expect(keepRules(s, 100)).toEqual({ rules: [rule(2, 9, 11)], kept: 1 });
  });
  it('keeps both halves of a side swept on two days, and counts them', () => {
    const s = side(['Thursday 9-11', 53, [rule(4, 9, 11)]], ['Friday 11-1', 52, [rule(5, 11, 13)]]);
    expect(keepRules(s, 243)).toEqual({ rules: [rule(4, 9, 11), rule(5, 11, 13)], kept: 2 });
  });
  it('keeps a short block fully covered by its curb (60% of a block under 25 m)', () => {
    expect(keepRules(side(['Friday 1-3', 15, [rule(5, 13, 15)]]), 20).rules).toEqual([rule(5, 13, 15)]);
  });
});

describe('limits: cross streets, through the splits the layer makes', () => {
  // 14th St runs north in two pieces split where nothing crosses; Wilshire meets the south end 6 m off the node,
  // Arizona meets the north end at the node.
  const at = (x, y) => [-118.49 + x / 92000, 34.03 + y / 110950];
  const A = { id: 1, name: '14TH ST', coords: [at(0, 0), at(0, 60)] }, B = { id: 2, name: '14TH ST', coords: [at(0, 60), at(0, 120)] };
  const wilshire = { id: 3, name: 'WILSHIRE BLVD', coords: [at(-80, -6), at(80, -6)] };
  const arizona = { id: 4, name: 'ARIZONA AVE', coords: [at(-80, 120), at(80, 120)] };
  it('finds both cross streets from each piece', () => {
    const ends = limits([A, B, wilshire, arizona]);
    expect(ends.get(A)).toEqual(['WILSHIRE BLVD', 'ARIZONA AVE']);
    expect(ends.get(B)).toEqual(['WILSHIRE BLVD', 'ARIZONA AVE']);
  });
});

describe('names and numbers', () => {
  it('writes the layer\'s capitals for people', () => {
    expect(titleCase('PICO BLVD')).toBe('Pico Blvd');
    expect(titleCase('14TH ST')).toBe('14th St');
    expect(titleCase("O'CONNELL AVE")).toBe("O'Connell Ave");
    expect(titleCase('OCEAN PARK BLVD')).toBe('Ocean Park Blvd');
  });
  it('reads the house numbers and the odd side from the address ranges (Pico Blvd 300 to 332, odd on the left)', () => {
    expect(addresses([{ piece: PICO, fwd: true }])).toEqual({ n: [300, 332], o: 'L' });
    expect(addresses([{ piece: PICO, fwd: false }]).o).toBe('R');
  });
});

describe('holidays: santamonica.gov/street-sweeping', () => {
  it('lists the 13 holidays, kept on the weekday the page says', () => {
    expect(HOLIDAYS['2026-11-27']).toBe('Day after Thanksgiving');
    expect(HOLIDAYS['2026-03-30']).toBe('Farmworkers Day');          // last Monday of March
    expect(HOLIDAYS['2027-07-05']).toBe('Independence Day (observed)');   // Sunday July 4 → Monday
    expect(HOLIDAYS['2027-12-24']).toMatch(/Christmas Day \(observed\)/);   // Saturday Christmas → Friday
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027')).length).toBe(12);
  });
  it('sweeps on the 2026 exceptions: Juneteenth and Independence Day (Fri Jul 3, Sat Jul 4)', () => {
    for (const d of ['2026-06-19', '2026-07-03', '2026-07-04']) expect(HOLIDAYS[d]).toBeUndefined();
  });
});

describe('the built data, read by lib/city.js', () => {
  beforeAll(async () => { await import('../../lib/sweep-core.js'); await import('../../lib/city.js'); });
  afterEach(() => { vi.useRealTimers(); });
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`data/santa-monica/${f}`, ROOT), 'utf8'));
  it('skips Thanksgiving and the day after, and sweeps Pico Blvd\'s south curb at 3 AM on the Monday after', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T20:00:00Z'));   // Wednesday noon in Santa Monica
    const city = globalThis.makeCity(read('city.json'));
    const pico = read('segments.json').b.find((b) => b.c === '5674');
    const south = city.rowsOf(pico).filter((r) => r.cnnrightleft === 'R');
    const next = south.map((r) => city.core.nextSweep(r)).sort((a, b) => a.start - b.start)[0];
    expect([next.mo, next.da, next.fromH, next.toH]).toEqual([11, 30, 3, 6]);   // Fri Nov 27 is a holiday
  });
});
