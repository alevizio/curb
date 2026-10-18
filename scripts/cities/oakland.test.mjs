// Oakland's build (scripts/cities/oakland.mjs): the City's codes, real records from its layer, and the blocks it wrote.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DAY_CODES, NOT_SWEPT, TIME_CODES, HOLIDAYS, checkDomains, decodeSide, oddSide, numberedSide, streetKey, streetName,
  parseLocation, parseTime, weekdayOf, covers, compass, lineCoords,
} from './oakland.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// The layer's coded value domains as read from StreetSweeping/FeatureServer/0?f=json on 2026-10-18.
const DAY_DOMAIN = [['E', 'Everyday'], ['N-S', 'No Signage'], ['N', 'No Sweeping (Exempt)'], ['N-O', 'No Odd Addresses'],
  ['N-E', 'No Even Addresses'], ['W2', '2nd Wed'], ['W4', '4th Wed'], ['TH2', '2nd Thurs'], ['TH4', '4th Thurs'], ['F2', '2nd Fri'],
  ['F4', '4th Fri'], ['S', 'Every Sat'], ['SU', 'Every Sun'], ['THE', 'Every Thurs'], ['FE', 'Every Fri'], ['M2', '2nd Mon'],
  ['TH1', '1st Thurs'], ['F1', '1st Fri'], ['MWF', 'Every Mon, Wed, Fri'], ['TTHS', 'Every Tues, Thurs, Sat'], ['TTH', 'Every Tues, Thurs'],
  ['MF', 'Every Mon to Fri'], ['ME', 'Every Mon'], ['WE', 'Every Wed'], ['TE', 'Every Tues'], ['DM', 'It is shown in the different map.'],
  ['MS', 'It is a major street so it is not using Centerline, it uses 2 lines.'], ['NS', 'No Sweeping (Within City Of Oakland Limit)'],
  ['NS-UC', 'No Sweeping (Uncontrol Condition)'], ['NS-H', 'No Sweeping (HYW)'], ['NS-O', 'No Sweeping (Outside Of The City Limit)'],
  ['T2', '2nd Tues'], ['M1', '1st Mon'], ['T1', '1st Tues'], ['NS-A', 'No Sweeping(Alleyways)'], ['O', 'There is no this side of the street'],
  ['M13', '1st and 3rd Mon'], ['M24', '2nd and 4th Mon'], ['T13', '1st and 3rd Tues'], ['T24', '2nd and 4th Tues'], ['W13', '1st and 3rd Wed'],
  ['TH13', '1st and 3rd Thurs'], ['F13', '1st and 3rd Fri'], ['TFE', 'Every Tues and Fri'], ['MTHE', 'Every Mon and Thurs'],
  ['THFE', 'Every Thurs and Fri'], ['MFE', 'Every Mon and Fri'], ['TTHE', 'Every Tues and Thurs'], ['EEH', 'Everyday except Holidays'],
  ['EESSH', 'Everyday except Saturday, Sunday & Holidays'], ['FW', 'First Wednesday']];
const TIME_DOMAIN = [['M2', '3:00AM-6:00AM'], ['M3', '9:00AM-12:00PM'], ['A1', '12:30PM-3:30PM'], ['M1', '12:00AM-3:00AM'],
  ['M23', '2:00AM-3:00AM'], ['M68', '6:00AM-8:00AM'], ['NA', 'NA']];
const metaOf = (day = DAY_DOMAIN, time = TIME_DOMAIN) => ({ fields: [
  ...['DAY_ODD', 'DAY_EVEN'].map((name) => ({ name, domain: { codedValues: day.map(([code, n]) => ({ code, name: n })) } })),
  ...['TIME_ODD', 'TIME_EVEN'].map((name) => ({ name, domain: { codedValues: time.map(([code, n]) => ({ code, name: n })) } })),
] });

// Real records from the layer (street fields only).
const VERNON = { OBJECTID: 7420, DYNAMAP_ID: 469171243, PREFIX: ' ', NAME: 'Vernon', TYPE: 'St', SUFFIX: ' ', NAME_TYPE: 'R',
  L_F_ADD: '601', L_T_ADD: '673', R_F_ADD: '600', R_T_ADD: '672', ROUTE: '5M', DAY_ODD: 'W2', TIME_ODD: 'M3', DAY_EVEN: 'TH2', TIME_EVEN: 'M3' };
const BROADWAY = { OBJECTID: 1, DYNAMAP_ID: 395513328, PREFIX: ' ', NAME: 'Broadway', TYPE: ' ', SUFFIX: ' ', NAME_TYPE: 'R',
  L_F_ADD: '4301', L_T_ADD: '4799', R_F_ADD: ' ', R_T_ADD: ' ', ROUTE: '14', DAY_ODD: 'TTHS', TIME_ODD: 'M1', DAY_EVEN: 'MWF', TIME_EVEN: 'NA' };
const MONTGOMERY = { OBJECTID: 16, DYNAMAP_ID: 395513763, PREFIX: ' ', NAME: 'Montgomery', TYPE: 'St', SUFFIX: ' ', NAME_TYPE: 'R',
  L_F_ADD: '4218', L_T_ADD: '4200', R_F_ADD: '4219', R_T_ADD: '4201', ROUTE: '1', DAY_ODD: 'M24', TIME_ODD: 'M3', DAY_EVEN: 'T24', TIME_EVEN: 'M3' };
const FORTIETH = { OBJECTID: 3, DYNAMAP_ID: 395513367, PREFIX: ' ', NAME: '40th', TYPE: 'St', SUFFIX: ' ', NAME_TYPE: 'R',
  L_F_ADD: ' ', L_T_ADD: ' ', R_F_ADD: '1000', R_T_ADD: '1028', ROUTE: '1A', DAY_ODD: 'MS', TIME_ODD: 'NA', DAY_EVEN: 'T24', TIME_EVEN: 'M3' };
const BAYVIEW = { OBJECTID: 5627, DYNAMAP_ID: 469173791, PREFIX: ' ', NAME: 'Bayview', TYPE: 'Ave', SUFFIX: ' ', NAME_TYPE: 'R',
  L_F_ADD: '1100', L_T_ADD: '1124', R_F_ADD: '1048', R_T_ADD: '1098', ROUTE: '3', DAY_ODD: 'M24', TIME_ODD: 'M3', DAY_EVEN: 'T24', TIME_EVEN: 'M3' };

describe('the City\'s codes', () => {
  it('match the layer\'s domains word for word, and every domain code is handled', () => {
    expect(() => checkDomains(metaOf())).not.toThrow();
    for (const [code] of DAY_DOMAIN) expect(DAY_CODES[code] || NOT_SWEPT[code]).toBeTruthy();
    for (const [code] of TIME_DOMAIN) if (code !== 'NA') expect(TIME_CODES[code]).toBeTruthy();
  });
  it('stop the build when a code changes meaning or a new one appears', () => {
    const changed = DAY_DOMAIN.map(([c, n]) => (c === 'W2' ? [c, '2nd and 4th Wed'] : [c, n]));
    expect(() => checkDomains(metaOf(changed))).toThrow(/W2 now reads "2nd and 4th Wed"/);
    expect(() => checkDomains(metaOf([...DAY_DOMAIN, ['W24', '2nd and 4th Wed']]))).toThrow(/new code W24/);
    expect(() => checkDomains(metaOf(DAY_DOMAIN, [...TIME_DOMAIN, ['A2', '4:00PM-6:00PM']]))).toThrow(/new code A2/);
  });
  it('decode 1st and 3rd, 2nd and 4th, and a 12:30 to 3:30 window with minutes', () => {
    expect(decodeSide('M13', 'A1')).toEqual({ rules: [[1, '12:30', '15:30', 5, 0, 0]] });
    expect(decodeSide('T24', 'M3')).toEqual({ rules: [[2, 9, 12, 10, 0, 0]] });
    expect(decodeSide('F13', 'M3')).toEqual({ rules: [[5, 9, 12, 5, 0, 0]] });
  });
  it('decode "2nd Wed" as the 2nd Wednesday only, and "First Wednesday" as the 1st', () => {
    expect(decodeSide('W2', 'M3')).toEqual({ rules: [[3, 9, 12, 2, 0, 0]] });
    expect(decodeSide('FW', 'A1')).toEqual({ rules: [[3, '12:30', '15:30', 1, 0, 0]] });
    expect(decodeSide('TH4', 'A1').rules[0][3]).toBe(8);
  });
  it('decode the night routes: every Tue, Thu and Sat from midnight to 3 AM, Mon, Wed and Fri 3 to 6 AM', () => {
    expect(decodeSide('TTHS', 'M1')).toEqual({ rules: [[2, 0, 3, 31, 0, 0], [4, 0, 3, 31, 0, 0], [6, 0, 3, 31, 0, 0]] });
    expect(decodeSide('MWF', 'M2').rules.map((r) => r[0])).toEqual([1, 3, 5]);
    expect(decodeSide('EEH', 'M2').rules).toHaveLength(7);
    expect(decodeSide('EESSH', 'M1').rules.map((r) => r[0])).toEqual([1, 2, 3, 4, 5]);
  });
  it('leave out sides with no posted sweeping, and say why', () => {
    expect(decodeSide('N-S', 'NA').skip).toMatch(/no signs/);
    expect(decodeSide('NS', 'NA').skip).toBe('not swept');
    expect(decodeSide('MS', 'NA').skip).toMatch(/other line/);
    expect(decodeSide('missing', 'NA').skip).toMatch(/not in the domain/);
    expect(decodeSide('THE', 'NA').skip).toBe('a day but no hours');
    expect(decodeSide(null, null).skip).toBe('no day code');
  });
  it('throw on a code it does not know', () => {
    expect(() => decodeSide('W24', 'M3')).toThrow(/unknown day code/);
    expect(() => decodeSide('W2', 'M9')).toThrow(/unknown time code/);
  });
});

describe('real lines from the layer', () => {
  it('Vernon St (Grand Lake): odd numbers on the left, 2nd Wednesday; even on the right, 2nd Thursday', () => {
    expect(streetName(VERNON)).toBe('Vernon St');
    expect(oddSide(VERNON)).toBe('L');
    expect(decodeSide(VERNON.DAY_ODD, VERNON.TIME_ODD).rules).toEqual([[3, 9, 12, 2, 0, 0]]);
    expect(decodeSide(VERNON.DAY_EVEN, VERNON.TIME_EVEN).rules).toEqual([[4, 9, 12, 2, 0, 0]]);
  });
  it('Broadway at 43rd: numbers on one side only still tell which side is odd; the even side has no hours', () => {
    expect(streetName(BROADWAY)).toBe('Broadway');
    expect(oddSide(BROADWAY)).toBe('L');
    expect(decodeSide(BROADWAY.DAY_EVEN, BROADWAY.TIME_EVEN).skip).toBe('a day but no hours');
  });
  it('Montgomery St, numbered downhill (4218 to 4200): the odd numbers are on the right', () => {
    expect(oddSide(MONTGOMERY)).toBe('R');
  });
  it('40th St, a major street drawn as two lines: this line carries the even side, on the side of its numbers', () => {
    expect(decodeSide(FORTIETH.DAY_ODD, FORTIETH.TIME_ODD).skip).toMatch(/other line/);
    expect(numberedSide(FORTIETH)).toBe('R');
  });
  it('Bayview Ave, even numbers on both sides: no answer from the ranges', () => {
    expect(oddSide(BAYVIEW)).toBe(null);
  });
});

describe('tickets: addresses, times and windows', () => {
  it('reads the written address, a unit letter, a lettered street, and refuses an intersection', () => {
    expect(parseLocation('1971 89TH AVE')).toEqual({ n: 1971, street: '89TH AVE' });
    expect(parseLocation('9424 D ST')).toEqual({ n: 9424, street: 'D ST' });
    expect(parseLocation('1234A MAIN ST')).toEqual({ n: 1234, street: 'MAIN ST' });
    expect(parseLocation('28TH AVE@EAST 17TH ST')).toBe(null);
    expect(parseLocation('MARKET ST')).toBe(null);
  });
  it('spells a street one way for the ticket and the layer', () => {
    expect(streetKey('EAST 17TH STREET')).toBe(streetKey('E 17th St'));
    expect(streetKey('MLK JR WAY')).toBe(streetKey('Martin Luther King Jr Way'));
    expect(streetKey('THOMAS L BERKELEY WAY')).toBe(streetKey('Thomas L Berkley Way'));
    expect(streetKey('ST ELMO DR')).toBe(streetKey('Saint Elmo Dr'));
  });
  it('reads both time formats the portal uses', () => {
    expect(parseTime('14:35')).toBe(875);
    expect(parseTime('9:14')).toBe(554);
    expect(parseTime('2:35:00 PM')).toBe(875);
    expect(parseTime('12:49:00 PM')).toBe(769);
    expect(parseTime('12:05:00 AM')).toBe(5);
    expect(parseTime('noon')).toBe(null);
  });
  it('knows the weekday and its occurrence in the month', () => {
    expect(weekdayOf('2026-03-02')).toEqual({ dow: 1, nth: 1 });
    expect(weekdayOf('2026-10-14')).toEqual({ dow: 3, nth: 2 });
    expect(weekdayOf('2026-10-31')).toEqual({ dow: 6, nth: 5 });
  });
  it('puts a ticket in a window by weekday, week and minute', () => {
    const w2 = [3, 9, 12, 2, 0, 0], a1 = [1, '12:30', '15:30', 5, 0, 0];
    expect(covers(w2, 3, 2, 10 * 60)).toBe(true);
    expect(covers(w2, 3, 4, 10 * 60)).toBe(false);
    expect(covers(a1, 1, 3, 12 * 60 + 29)).toBe(false);
    expect(covers(a1, 1, 3, 12 * 60 + 30)).toBe(true);
    expect(covers(a1, 1, 3, 15 * 60 + 30)).toBe(false);
    expect(covers(a1, 1, 3, 15 * 60 + 35, 10)).toBe(true);
  });
});

describe('geometry', () => {
  const north = [[-122.25, 37.80], [-122.25, 37.801]], uturn = [[-122.25, 37.80], [-122.25, 37.801], [-122.2499, 37.801], [-122.2499, 37.80001]];
  it('names the side of a line by compass, and gives none for a line that turns back', () => {
    expect(compass(north, 'L')).toBe('West');
    expect(compass(north, 'R')).toBe('East');
    expect(compass(uturn, 'L')).toBe(null);
    expect(compass(uturn, 'L', true)).toBeTruthy();
  });
  it('joins a multi part line only when its parts meet', () => {
    expect(lineCoords({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]] })).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(lineCoords({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[5, 5], [6, 6]]] })).toBe(null);
    expect(lineCoords(null)).toBe(null);
  });
});

describe('the City\'s holidays', () => {
  it('list 2026 and 2027 as the Street Sweeping page does, observed days included', () => {
    const y = (yr) => Object.keys(HOLIDAYS).filter((d) => d.startsWith(yr));
    expect(y('2026')).toHaveLength(14);
    expect(y('2027')).toHaveLength(16);
    expect(HOLIDAYS['2026-07-03']).toBe('Independence Day (Observed)');
    expect(HOLIDAYS['2027-12-24']).toBe('Christmas Day (Observed)');
    for (const d of Object.keys(HOLIDAYS)) expect(new Date(d + 'T12:00:00Z').toISOString().slice(0, 10)).toBe(d);
  });
});

describe('the data the build wrote (data/oakland/)', () => {
  const seg = JSON.parse(fs.readFileSync(ROOT + 'data/oakland/segments.json', 'utf8'));
  const city = JSON.parse(fs.readFileSync(ROOT + 'data/oakland/city.json', 'utf8'));
  const block = (c) => seg.b.find((b) => b.c === c);
  it('has the shape of docs/multi-city/city-build.md', () => {
    expect(seg._meta.format).toMatch(/rule = \[jsDow/);
    expect(seg.b.length).toBeGreaterThan(9000);
    const ids = new Set();
    for (const b of seg.b) {
      expect(typeof b.c).toBe('string');
      expect(ids.has(b.c)).toBe(false); ids.add(b.c);
      expect(b.s).toBeTruthy();
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      for (const [x, y] of b.g) { expect(Math.round(x * 1e6) / 1e6).toBe(x); expect(x).toBeLessThan(-122); expect(y).toBeGreaterThan(37.6); }
      expect(b.d.length).toBeGreaterThanOrEqual(1);
      expect(new Set(b.d.map((d) => d[0])).size).toBe(b.d.length);
      for (const [lr, label, rules] of b.d) {
        expect(['L', 'R']).toContain(lr);
        expect(label).toBeTruthy();
        for (const [dow, from, to, weeks, months, flags] of rules) {
          expect(dow).toBeGreaterThanOrEqual(0); expect(dow).toBeLessThanOrEqual(6);
          expect(typeof from === 'number' || /^\d{1,2}:\d{2}$/.test(from)).toBe(true);
          expect(typeof to === 'number' || /^\d{1,2}:\d{2}$/.test(to)).toBe(true);
          expect(weeks).toBeGreaterThan(0); expect(weeks).toBeLessThanOrEqual(31);
          expect(months).toBe(0); expect(flags).toBe(0);
        }
      }
    }
  });
  it('stays under 6 MB', () => {
    expect(fs.statSync(ROOT + 'data/oakland/segments.json').size).toBeLessThan(6e6);
  });
  it('writes Vernon St between Santa Rosa and Monte Vista as the City\'s map gives it', () => {
    expect(block('469171243')).toMatchObject({ s: 'Vernon St', l: 'Santa Rosa Ave - Monte Vista Ave', h: 'Grand Lake', n: [600, 673], o: 'L',
      d: [['L', 'Northwest', [[3, 9, 12, 2, 0, 0]]], ['R', 'Southeast', [[4, 9, 12, 2, 0, 0]]]] });
  });
  it('keeps one block for a line the layer repeats under two names, with the schedule the tickets back', () => {
    // 61st Pl and its copy "61st St Pl" (odd and even swapped on the copy); the even side's tickets fall on Tuesdays
    expect(block('469168364').d).toEqual([['L', 'South', [[1, '12:30', '15:30', 10, 0, 0]]], ['R', 'North', [[2, '12:30', '15:30', 10, 0, 0]]]]);
  });
  it('swaps a block whose tickets show odd and even reversed (Market St, 61st to 62nd, a major street line)', () => {
    // the City gives this line's even side Mon, Wed and Fri midnight to 3 AM; its even numbered tickets fall on Tue, Thu and Sat
    expect(block('395510630').d).toEqual([['R', 'Northeast', [[2, 0, 3, 31, 0, 0], [4, 0, 3, 31, 0, 0], [6, 0, 3, 31, 0, 0]]]]);
  });
  it('city.json has what configs.mjs needs, and the City\'s holiday list', () => {
    for (const k of ['id', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidayRule', 'fine', 'tow']) expect(city[k]).toBeDefined();
    expect(city.id).toBe('oakland');
    expect(city.holidays).toEqual(HOLIDAYS);
    expect(city.holidayRule).toBe('all');
    const [[s, w], [n, e]] = city.bounds;
    expect(city.center[0]).toBeGreaterThan(s); expect(city.center[0]).toBeLessThan(n);
    expect(city.center[1]).toBeGreaterThan(w); expect(city.center[1]).toBeLessThan(e);
    for (const h of city.neighborhoods) expect(h.bbox.split(',').map(Number).every(Number.isFinite)).toBe(true);
  });
});

describe('with the shared time core (lib/city.js)', () => {
  beforeAll(async () => { await import('../../lib/sweep-core.js'); await import('../../lib/city.js'); });
  afterEach(() => { vi.useRealTimers(); });
  const seg = JSON.parse(fs.readFileSync(ROOT + 'data/oakland/segments.json', 'utf8'));
  const city = JSON.parse(fs.readFileSync(ROOT + 'data/oakland/city.json', 'utf8'));
  it('skips Veterans Day, the 2nd Wednesday of November 2026, on Vernon St\'s odd side: next is December 9', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 10, 1, 18, 0)));
    const place = globalThis.makeCity(city);
    const odd = place.rowsOf(seg.b.find((b) => b.c === '469171243')).find((r) => r.cnnrightleft === 'L');
    const n = place.core.nextSweep(odd);
    expect([n.y, n.mo, n.da, n.fromH]).toEqual([2026, 12, 9, 9]);
  });
  it('starts a 12:30 window at 12:30 Pacific time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 18, 18, 0)));
    const place = globalThis.makeCity(city);
    const row = place.rowsOf(seg.b.find((b) => b.c === '469168364'))[0];
    const n = place.core.nextSweep(row);
    expect(n.start.toISOString()).toBe('2026-10-26T19:30:00.000Z');   // 4th Monday, 12:30 PM PDT
  });
});
