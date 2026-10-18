// Paterson's parsing, names and matching, with real rows from the City's Street Sweeping Map and the State's centerlines.
import { describe, it, expect } from 'vitest';
import {
  clock, parseTime, rulesFor, FLAGS, streetName, titleCase, isStreetName, oddSide, houseRange, wardName, compass,
  lineIndex, matchBlock, TOL2, HOLIDAYS, HOLIDAYS_SEEN, round6,
} from './paterson.mjs';

// Every Time value on the City's map (2026-07-29), with how many lines carry it.
const TIMES = {
  'Daily 6:00AM - 8:00AM': [37, { days: [0, 1, 2, 3, 4, 5, 6], from: 6, to: 8 }],
  'Monday& Tuesday 1:00PM - 3:00PM': [15, { days: [1, 2], from: 13, to: 15 }],
  'Monday& Tuesday 1:00PM - 3:30PM': [112, { days: [1, 2], from: 13, to: '15:30' }],
  'Monday& Tuesday 8:00AM - 12:00PM': [131, { days: [1, 2], from: 8, to: 12 }],
  'Thursday& Friday 1:00PM - 3:30PM': [25, { days: [4, 5], from: 13, to: '15:30' }],
  'Thursday& Friday 8:00AM - 12:00PM': [36, { days: [4, 5], from: 8, to: 12 }],
  'Wednesday& Friday 1:00PM - 3:30PM': [10, { days: [3, 5], from: 13, to: '15:30' }],
  'Wednesday& Friday 8:00AM - 12:00PM': [14, { days: [3, 5], from: 8, to: 12 }],
  'Wednesday& Thursday 1:00PM - 3:30PM': [89, { days: [3, 4], from: 13, to: '15:30' }],
  'Wednesday& Thursday 8:00AM - 12:00PM': [104, { days: [3, 4], from: 8, to: 12 }],
};

describe('clock', () => {
  it('reads the map\'s times, whole hours as numbers and minutes as H:MM', () => {
    expect(clock('8:00AM')).toBe(8);
    expect(clock('12:00PM')).toBe(12);
    expect(clock('1:00PM')).toBe(13);
    expect(clock('3:30PM')).toBe('15:30');
    expect(clock('6:00AM')).toBe(6);
    expect(clock('12:00AM')).toBe(0);
    expect(clock('13:00PM')).toBeNull();
    expect(clock('noon')).toBeNull();
  });
});

describe('parseTime', () => {
  for (const [t, [, want]] of Object.entries(TIMES)) it(`reads "${t}"`, () => expect(parseTime(t)).toEqual(want));
  it('gives null for Bunker Hill\'s "Saturday" (no hours) and for anything else', () => {
    expect(parseTime('Saturday')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime('Monday& Monday 8:00AM - 12:00PM')).toBeNull();
    expect(parseTime('Funday& Tuesday 8:00AM - 12:00PM')).toBeNull();
  });
  it('covers 573 of the 601 lines (the other 28 are Bunker Hill)', () => {
    expect(Object.values(TIMES).reduce((s, [n]) => s + n, 0)).toBe(573);
  });
});

describe('rulesFor', () => {
  it('Route 3A&3B, Wednesday & Thursday 1 to 3:30 PM: one weekly, all-year, towable rule per day', () => {
    const row = { OBJECTID: 146, Route: 'Route 3A&3B', Time: 'Wednesday& Thursday 1:00PM - 3:30PM' };
    expect(rulesFor(parseTime(row.Time))).toEqual([[3, 13, '15:30', 31, 0, 2], [4, 13, '15:30', 31, 0, 2]]);
    expect(FLAGS).toBe(2);
  });
  it('Downtown daily 6 to 8 AM: one rule per day of the week', () => {
    const rules = rulesFor(parseTime('Daily 6:00AM - 8:00AM'));
    expect(rules).toHaveLength(7);
    expect(rules.map((r) => r[0])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rules.every((r) => r[1] === 6 && r[2] === 8 && r[3] === 31 && r[4] === 0)).toBe(true);
  });
});

describe('names and numbers (NJOGIS centerline rows)', () => {
  it('titles the State\'s short names', () => {
    expect(streetName({ LST_PNAME: 'E MAIN ST', PRIMENAME: 'East Main Street' })).toBe('E Main St');
    expect(streetName({ LST_PNAME: 'E 18TH ST' })).toBe('E 18th St');
    expect(streetName({ LST_PNAME: '21ST AVE' })).toBe('21st Ave');
    expect(titleCase('MCBRIDE AVE')).toBe('McBride Ave');
    expect(streetName({ LST_PNAME: null, ST_PREDIR: 'East', ST_NAME: 'Main', ST_POSTYP: 'Street' })).toBe('E Main St');
  });
  it('leaves out the State\'s "Unnamed Segment"', () => {
    expect(isStreetName('Unnamed Segment')).toBe(false);
    expect(isStreetName('')).toBe(false);
    expect(isStreetName('Beech St')).toBe(true);
  });
  it('finds the odd side from parity, else from the ranges', () => {
    // East Main Street, OBJECTID 54: left 77-57 odd, right 80-64 even
    const eMain = { FROMADDR_L: 77, TOADDR_L: 57, FROMADDR_R: 80, TOADDR_R: 64, PARITY_L: 'O', PARITY_R: 'E' };
    expect(oddSide(eMain)).toBe('L');
    expect(houseRange(eMain)).toEqual([57, 80]);
    // Beech Street, OBJECTID 2622: left 16-2 even, right 19-1 odd
    expect(oddSide({ FROMADDR_L: 16, TOADDR_L: 2, FROMADDR_R: 19, TOADDR_R: 1, PARITY_L: 'E', PARITY_R: 'O' })).toBe('R');
    expect(oddSide({ FROMADDR_L: 0, TOADDR_L: 0, FROMADDR_R: 0, TOADDR_R: 0, PARITY_L: 'Z', PARITY_R: 'Z' })).toBeNull();
    expect(oddSide({ FROMADDR_L: 11, TOADDR_L: 31, FROMADDR_R: 0, TOADDR_R: 0, PARITY_L: 'Z', PARITY_R: 'Z' })).toBe('L');
    expect(houseRange({ FROMADDR_L: 0, TOADDR_L: 0, FROMADDR_R: 0, TOADDR_R: 0 })).toBeNull();
  });
  it('names the wards as the City does', () => {
    expect(['1', '2', '3', '4', '6'].map(wardName)).toEqual(['1st Ward', '2nd Ward', '3rd Ward', '4th Ward', '6th Ward']);
  });
});

describe('sides', () => {
  it('labels L and R looking from the first point to the last', () => {
    const east = [[-74.17, 40.915], [-74.16, 40.915]];
    expect(compass(east, 'L')).toBe('North');
    expect(compass(east, 'R')).toBe('South');
    const north = [[-74.17, 40.91], [-74.17, 40.92]];
    expect(compass(north, 'L')).toBe('West');
    expect(compass(north, 'R')).toBe('East');
  });
  it('rounds to 6 decimals and drops repeated points', () => {
    expect(round6([[-74.1640912527, 40.9285768905], [-74.16409125, 40.92857689], [-74.1628166143, 40.9285207917]]))
      .toEqual([[-74.164091, 40.928577], [-74.162817, 40.928521]]);
  });
});

describe('laying a City line onto a block', () => {
  // A real block of Putnam St (Bunker Hill's line OBJECTID 1 runs along it) and copies of it moved or turned.
  const block = [[-74.164091, 40.928577], [-74.162817, 40.928521], [-74.162606, 40.928474]];
  const shift = (c, dLat) => c.map(([lo, la]) => [lo, la + dLat]);
  const line = (id, c) => ({ id, route: 'Route X', time: 'Monday& Tuesday 8:00AM - 12:00PM', parts: [c], rules: [] });
  it('matches a line drawn on the block', () => {
    const m = matchBlock(block, lineIndex([line('on', shift(block, 0.00003))]));   // 3 m off
    expect(m.cover).toBe(1);
  });
  it('ignores a cross street and a parallel street 20 m away, but the second pass reaches a drifting line', () => {
    const cross = [[-74.1634, 40.9278], [-74.1634, 40.9293]];
    expect(matchBlock(block, lineIndex([line('cross', cross)])).cover).toBe(0);
    const far = line('far', shift(block, 0.00018));   // about 20 m north
    expect(matchBlock(block, lineIndex([far])).cover).toBe(0);
    expect(matchBlock(block, lineIndex([far], TOL2), (it) => it.id === 'far').cover).toBe(1);
    expect(matchBlock(block, lineIndex([far], TOL2), () => false).cover).toBe(0);
  });
});

describe('holidays', () => {
  it('holds every City Hall closing seen on the City\'s 2026 calendars, and 2027', () => {
    for (const d of HOLIDAYS_SEEN) expect(HOLIDAYS[d]).toBeTruthy();
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027')).length).toBeGreaterThanOrEqual(12);
    for (const d of Object.keys(HOLIDAYS)) expect(new Date(d + 'T12:00:00Z').getUTCDay()).not.toBe(0);
  });
});
