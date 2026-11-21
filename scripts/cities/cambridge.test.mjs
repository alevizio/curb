// Cambridge's build (scripts/cities/cambridge.mjs): the City's 2026 Street Sweeping Schedule (uvf3-2xt3) read into one
// date list per district and side, a block side's district from its addresses, house numbers placed on the centerline's
// ranges, and the tickets' places.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseDay, nthDate, nthWeekday, scheduleLists, DISTRICTS, streetKey, baseName, ticketPlace, sideParity, oddSide, placeNumber,
  sideDistrict, nearestOnLine, compass, flippedRanges, SHIP_SHARE, MIN_SHARE, WINDOW } from './cambridge.mjs';

const MONTHS = ['april', 'may', 'june', 'july', 'aug', 'sep', 'oct', 'nov', 'dec'];
// The City's 20 rows as published 2026-10-22: each list's day, and the dates that are not that day (all as the City wrote them).
const DAYS = { 'A-Odd': '1st Wed', 'A-Even': '1st Thu', 'B-Odd': '1st Mon', 'B-Even': '1st Tue', 'C-Odd': '1st Fri', 'C-Even': '2nd Mon',
  'D-Odd': '2nd Tue', 'D-Even': '2nd Wed', 'E-Odd': '2nd Thu', 'E-Even': '2nd Fri', 'F-Odd': '3rd Mon', 'F-Even': '3rd Tue',
  'G-Odd': '3rd Wed', 'G-Even': '3rd Thu', 'H-Odd': '3rd Fri', 'H-Even': '4th Mon', 'J-Odd': '4th Tue', 'J-Even': '4th Wed',
  'K-Odd': '4th Thu', 'K-Even': '4th Fri' };
const LISTED = { 'B-Odd': { sep: '2026-08-31' }, 'B-Even': { sep: '2026-09-08' }, 'C-Odd': { july: '2026-06-30' }, 'C-Even': { oct: '2026-09-29' },
  'D-Even': { nov: '2026-10-29' }, 'F-Odd': { april: '2026-04-29' }, 'H-Odd': { june: '2026-06-29' }, 'H-Even': { may: '2026-05-29' },
  'K-Odd': { nov: '2026-11-30' }, 'K-Even': { dec: '2026-12-29' } };
const ROWS = Object.entries(DAYS).map(([k, day]) => {
  const [district, side] = k.split('-');
  const r = { district, side, day };
  MONTHS.forEach((m, i) => { r[m] = (LISTED[k]?.[m] || nthDate(2026, i + 4, parseDay(day))) + 'T00:00:00.000'; });
  return r;
});
const MAKE_UP = { '2026-04-20': '2026-04-29', '2026-05-25': '2026-05-29', '2026-06-19': '2026-06-29', '2026-07-03': '2026-06-30',
  '2026-09-07': '2026-08-31', '2026-10-12': '2026-09-29', '2026-11-11': '2026-10-29', '2026-11-26': '2026-11-30', '2026-12-25': '2026-12-29' };

describe('the schedule (uvf3-2xt3)', () => {
  it('reads the day on the signs and finds its dates', () => {
    expect(parseDay('1st Wed')).toEqual({ nth: 1, dow: 3 });
    expect(parseDay('4th Friday')).toEqual({ nth: 4, dow: 5 });
    expect(parseDay('5th Mon')).toBeNull();
    expect(parseDay('H')).toBeNull();
    expect(nthDate(2026, 9, { nth: 1, dow: 2 })).toBe('2026-09-01');
    expect(nthDate(2026, 11, { nth: 4, dow: 4 })).toBe('2026-11-26');         // Thanksgiving
    expect(nthWeekday('2025-06-04T00:00:00.000')).toEqual({ nth: 1, dow: 3 });
    expect(nthWeekday('2026-04-29')).toEqual({ nth: 5, dow: 3 });           // Patriots' Day make-up: a 5th weekday
  });
  it('gives each district and side its nine dates, make-up days included', () => {
    const { lists, days, moved, other } = scheduleLists(ROWS, MAKE_UP);
    expect(Object.keys(lists)).toHaveLength(20);
    expect(DISTRICTS).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K']);
    expect(lists['A-odd']).toEqual(['2026-04-01', '2026-05-06', '2026-06-03', '2026-07-01', '2026-08-05', '2026-09-02', '2026-10-07', '2026-11-04', '2026-12-02']);
    expect(lists['C-even']).toContain('2026-09-29');                         // Indigenous Peoples' Day, Oct 12, moved to Sep 29
    expect(lists['C-even']).not.toContain('2026-10-12');
    expect(days['K-odd']).toEqual({ nth: 4, dow: 4, words: '4th Thu' });
    expect(moved).toHaveLength(9);
    expect(moved.find((m) => m.list === 'B-odd')).toMatchObject({ regular: '2026-09-07', listed: '2026-08-31' });   // Labor Day
    // the one date that is neither the day on the signs nor a holiday's make-up day: B even's 1st Tuesday of September
    expect(other).toEqual([{ list: 'B-even', day: '1st Tue', regular: '2026-09-01', listed: '2026-09-08', holidayAdjustments: '' }]);
  });
  it('fails when the table changes shape', () => {
    expect(() => scheduleLists(ROWS.slice(1), MAKE_UP)).toThrow(/no row for district A, odd side/);
    expect(() => scheduleLists([...ROWS, ROWS[0]], MAKE_UP)).toThrow(/A-odd twice/);
    expect(() => scheduleLists(ROWS.map((r, i) => (i ? r : { ...r, day: 'Wednesday' })), MAKE_UP)).toThrow(/changed shape/);
    expect(() => scheduleLists(ROWS.map((r, i) => (i ? r : { ...r, sep: null })), MAKE_UP)).toThrow(/no sep date for A-odd/);
  });
});

describe('block sides', () => {
  // Magazine St between Glenwood Ave and Granite St (Magazin_St_2): odd numbers on the right
  const mag = { l_from: '172', l_to: '184', r_from: '171', r_to: '183' };
  const seg = (p, c = [[-71.113, 42.3574], [-71.1136, 42.3569]]) => ({ p, c });
  it('knows which side holds the odd numbers', () => {
    expect(sideParity(mag, 'L')).toBe(0);
    expect(sideParity(mag, 'R')).toBe(1);
    expect(oddSide(mag)).toBe('R');
    expect(oddSide({ l_from: '-1', l_to: '-1', r_from: '-1', r_to: '-1' })).toBeNull();
  });
  it('places a house number on the range of its parity', () => {
    const s = seg(mag);
    expect(placeNumber([s], 175)).toMatchObject({ s, side: 'R', d: 0 });
    expect(placeNumber([s], 180)).toMatchObject({ side: 'L', d: 0 });
    expect(placeNumber([s], 199)).toBeNull();
    expect(placeNumber([s], 199, { slack: 20 })).toMatchObject({ side: 'R', d: 16 });   // a ticket's typed number
    const a = seg(mag), b = seg({ ...mag });
    expect(placeNumber([a, b], 175, { near: (x) => (x === b ? 3 : 30) }).s).toBe(b);   // two ranges hold it: the nearer line
  });
  it('takes the district most of its addresses have, or none', () => {
    expect(MIN_SHARE).toBe(0.75);
    expect(sideDistrict({ C: 12 })).toEqual({ district: 'C', share: 1 });
    expect(sideDistrict({ K: 7, E: 2 })).toEqual({ district: 'K', share: 0.778 });   // Massachusetts Ave, Massach_Ave_43
    expect(sideDistrict({ D: 5, B: 2 })).toBeNull();                                // Inman St, Inman_St_8: 71%
    expect(sideDistrict({ J: 2 }, 10)).toBeNull();                                  // Concord Ave: most addresses have no district
    expect(sideDistrict({}, 3)).toBeNull();
  });
  it('tells the side of a line a point lies on, and the compass word for it', () => {
    const westToEast = [[-71.11, 42.37], [-71.10, 42.37]];
    expect(nearestOnLine(westToEast, [-71.105, 42.3701]).side).toBe('L');
    expect(nearestOnLine(westToEast, [-71.105, 42.3699]).side).toBe('R');
    expect(Math.round(nearestOnLine(westToEast, [-71.105, 42.3701]).d)).toBe(11);
    expect(compass(westToEast, 'L')).toBe('North');
    expect(compass(westToEast, 'R')).toBe('South');
    expect(flippedRanges({ ok: 1, bad: 19 })).toBe(true);                           // Lincoln Way
    expect(flippedRanges({ ok: 1, bad: 3 })).toBe(false);
  });
});

describe('the 2025 tickets', () => {
  it('reads a ticket location: an address or a corner', () => {
    expect(ticketPlace('701 main st')).toEqual({ num: 701, street: 'MAIN ST' });
    expect(ticketPlace('1-2 gore st')).toEqual({ num: 1, street: 'GORE ST' });
    expect(ticketPlace('plympton st&memorial dr')).toEqual({ cross: ['PLYMPTON ST', 'MEMORIAL DR'] });
    expect(ticketPlace('cambridge common')).toBeNull();
  });
  it('spells streets as the centerline does', () => {
    expect(streetKey('Mass Ave')).toBe('MASSACHUSETTS AVE');
    expect(streetKey('Alberta Terr')).toBe('ALBERTA TER');
    expect(streetKey('3rd St')).toBe('THIRD ST');
    expect(streetKey("O'Brien Hwy")).toBe('MONSIGNOR OBRIEN HWY');
    expect(baseName('ELM ST N')).toBe('ELM');
  });
  it('ships only when the tickets agree with the schedule, at the hours most signs post', () => {
    expect(SHIP_SHARE).toBe(0.9);
    expect(WINDOW).toEqual([8, 12]);
  });
});

// The City's real table, when it is in the cache (private/cache/cambridge/, gitignored).
const CACHED = fileURLToPath(new URL('../../private/cache/cambridge/schedule.json', import.meta.url));
describe.skipIf(!fs.existsSync(CACHED))('the cached schedule', () => {
  it('has 20 rows and the dates above', () => {
    const rows = JSON.parse(fs.readFileSync(CACHED, 'utf8'));
    const mine = scheduleLists(ROWS, MAKE_UP), theirs = scheduleLists(rows, MAKE_UP);
    expect(theirs.lists).toEqual(mine.lists);
    expect(theirs.other).toEqual(mine.other);
  });
});
