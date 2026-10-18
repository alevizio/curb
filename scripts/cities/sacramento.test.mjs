// Sacramento's data build (scripts/cities/sacramento.mjs): reading the City's on-street parking points, placing them on
// the County's centerlines, one rule per block side, weekly or monthly from the 2018 sign inventory, and the holidays.
// Fixtures are real field values from the City's data (2026-10-18), without the space addresses.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { dayOf, parseHour, pointStreet, sideAt, compass, fits, sideRule, inventoryStatus, DAY_SIDE, HOLIDAYS } from './sacramento.mjs';

const ROOT = new URL('../../', import.meta.url);
const pt = (PKGSDAY, o = {}) => ({ STREET: 'D', SUFFIX: null, PREFIX: 'ST', EVENODD: 'EVEN', PKGSDAY, PKGSWBEG: '8 am', PKGSWEND: '12 pm', ...o });
// County centerline of E St, 16th to 17th (UNIQUE_ID 20880), drawn east-southeast
const E_ST = [[-121.482856, 38.583583], [-121.481529, 38.583229]];

describe('reading the parking points', () => {
  it('reads the sweeping day, and "1ST" as the first week of the month', () => {
    expect(dayOf('TUES')).toEqual({ dow: 2, first: false });
    expect(dayOf('THUR')).toEqual({ dow: 4, first: false });
    expect(dayOf('1ST WED')).toEqual({ dow: 3, first: true });
    expect(dayOf('FRI')).toBeNull();
    expect(dayOf(null)).toBeNull();
  });
  it('reads the hours', () => {
    expect([parseHour('8 am'), parseHour('12 pm'), parseHour('11 am'), parseHour('10 am'), parseHour(null)]).toEqual([8, 12, 11, 10, null]);
  });
  it('spells the street the way the County does', () => {
    expect(pointStreet({ STREET: '23', SUFFIX: 'RD', PREFIX: 'ST' })).toBe('23RD ST');
    expect(pointStreet({ STREET: '11', SUFFIX: 'TH', PREFIX: 'ST' })).toBe('11TH ST');
    expect(pointStreet({ STREET: '11', SUFFIX: null, PREFIX: 'ST' })).toBe('11TH ST');
    expect(pointStreet({ STREET: 'E', SUFFIX: null, PREFIX: 'ST' })).toBe('E ST');
    expect(pointStreet({ STREET: 'O', SUFFIX: 'ST', PREFIX: '' })).toBe('O ST');
    expect(pointStreet({ STREET: 'Capitol', SUFFIX: null, PREFIX: 'AVE' })).toBe('CAPITOL AVE');
    expect(pointStreet({ STREET: 'North D', SUFFIX: null, PREFIX: 'ST' })).toBe('N D ST');   // the build tries D ST next
  });
});

describe('placing a point on its side of the street', () => {
  const LAT0 = 38.57, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132, xy = ([lo, la]) => [lo * KX, la * KY];
  it('puts a space 6 m south of E St on its right side (drawn eastward), and one north on the left', () => {
    const line = E_ST.map(xy);
    const south = sideAt(line, xy([-121.4822, 38.58335])), north = sideAt(line, xy([-121.4822, 38.58346]));
    expect(south.side).toBe('R'); expect(north.side).toBe('L');
    expect(south.d).toBeLessThan(10);
    expect([compass(E_ST, 'L'), compass(E_ST, 'R')]).toEqual(['North', 'South']);
  });
  it('accepts the compass word when it holds the City\'s word for the day', () => {
    expect(fits('Southeast', DAY_SIDE[1])).toBe(true);
    expect(fits('North', DAY_SIDE[1])).toBe(false);
    expect(fits('Northwest', DAY_SIDE[3])).toBe(true);
  });
});

describe('one rule per block side', () => {
  it('a weekly side: every Monday 8 to noon, all year, not stopped by holidays', () => {
    expect(sideRule([pt('MON'), pt('MON'), pt('MON')], 'South', 'weekly').rule).toEqual([1, 8, 12, 31, 0, 1]);
  });
  it('a monthly side: the first Tuesday of the month', () => {
    expect(sideRule([pt('TUES'), pt('TUES')], 'North', 'monthly').rule).toEqual([2, 8, 12, 1, 0, 1]);
  });
  it('a "1ST" day in the parking data is monthly, whatever the inventory says', () => {
    const r = sideRule([pt('1ST WED', { STREET: '10', SUFFIX: 'TH' }), pt('WED', { STREET: '10', SUFFIX: 'TH' })], 'West', 'weekly');
    expect(r.rule).toEqual([3, 8, 12, 1, 0, 1]);
    expect(r.weeklyFrom).toBe('1ST in the parking data');
  });
  it('no inventory record: weekly, the stricter reading', () => {
    const r = sideRule([pt('THUR')], 'East', null);
    expect(r.rule[3]).toBe(31);
    expect(r.weeklyFrom).toMatch(/weekly assumed/);
  });
  it('keeps the day most points give; a corner space with the cross street\'s day is outvoted', () => {
    const r = sideRule([...Array(9)].map(() => pt('MON')).concat([pt('WED')]), 'South', 'weekly');
    expect(r.dow).toBe(1);
    expect(r.otherDays).toEqual([[3, 1]]);
  });
  it('a tie goes to the day whose City side is the side\'s compass side (25th St, Q St to Quill Aly)', () => {
    const pts = [pt('WED'), pt('WED'), pt('WED'), pt('MON'), pt('MON'), pt('MON')];
    expect(sideRule(pts, 'West', 'weekly').dow).toBe(3);
    expect(sideRule(pts, 'South', 'weekly').dow).toBe(1);
  });
  it('keeps the hours most points give, 8 to noon when none has hours', () => {
    expect(sideRule([pt('MON', { PKGSWEND: '11 am' }), pt('MON', { PKGSWEND: '11 am' }), pt('MON')], 'South', 'weekly').rule.slice(1, 3)).toEqual([8, 11]);
    expect(sideRule([pt('MON', { PKGSWBEG: null, PKGSWEND: null })], 'South', 'weekly').rule.slice(1, 3)).toEqual([8, 12]);
  });
});

describe('the 2018 sign inventory: weekly or monthly', () => {
  it('reads the 2018 status and the "needs weekly" flag', () => {
    expect(inventoryStatus({ Status: 'NoChange', STNEEDWKLY: 'YES' })).toBe('weekly');
    expect(inventoryStatus({ Status: 'NewWeekly', STNEEDWKLY: 'YES' })).toBe('weekly');
    expect(inventoryStatus({ Status: 'ToMonthly', STNEEDWKLY: 'NO' })).toBe('monthly');
    expect(inventoryStatus({ Status: 'ToMonthly', STNEEDWKLY: 'YES' })).toBe('monthly');
    expect(inventoryStatus({ Status: 'NewMonthly', STNEEDWKLY: 'NO' })).toBe('monthly');
    expect(inventoryStatus({ Status: 'NoChange', STNEEDWKLY: 'NO' })).toBe('monthly');
    expect(inventoryStatus({ Status: 'NoChange', STNEEDWKLY: null })).toBeNull();
    expect(inventoryStatus(undefined)).toBeNull();
  });
});

describe('holidays', () => {
  it('lists the City\'s 2026 holidays and the 2027 ones by its rule, all weekdays', () => {
    const y = (yr) => Object.keys(HOLIDAYS).filter((d) => d.startsWith(yr));
    expect(y('2026')).toHaveLength(12);
    expect(y('2027')).toHaveLength(13);
    for (const d of Object.keys(HOLIDAYS)) expect([1, 2, 3, 4, 5]).toContain(new Date(d + 'T12:00:00Z').getUTCDay());
    expect(HOLIDAYS['2026-11-27']).toMatch(/Thanksgiving/);
  });
  it('runs out at the end of 2027: extend it before then (fails from 2027-08-01)', () => {
    expect(new Date() < new Date('2027-08-01T00:00:00Z')).toBe(true);
  });
});

describe('data/sacramento (the committed build output)', () => {
  const seg = JSON.parse(fs.readFileSync(new URL('data/sacramento/segments.json', ROOT), 'utf8'));
  const city = JSON.parse(fs.readFileSync(new URL('data/sacramento/city.json', ROOT), 'utf8'));
  it('has every restricted block once, with valid rules inside the city', () => {
    expect(seg.b.length).toBeGreaterThan(500);
    expect(new Set(seg.b.map((b) => b.c)).size).toBe(seg.b.length);
    const [[s, w], [n, e]] = city.bounds;
    for (const b of seg.b) {
      expect(new Set(b.d.map(([side]) => side)).size).toBe(b.d.length);
      for (const [side, label, rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        expect(label).toMatch(/^(North|South|East|West)(east|west)?$/);
        expect(rules).toHaveLength(1);
        const [dow, from, to, weeks, months, flags] = rules[0];
        expect([1, 2, 3, 4]).toContain(dow);
        expect(from).toBe(8); expect([10, 11, 12]).toContain(to);
        expect([1, 31]).toContain(weeks);
        expect(months).toBe(0); expect(flags).toBe(1);
      }
      for (const [lo, la] of b.g) { expect(la).toBeGreaterThan(s); expect(la).toBeLessThan(n); expect(lo).toBeGreaterThan(w); expect(lo).toBeLessThan(e); }
    }
  });
  it('keeps real blocks as the City\'s data has them', () => {
    const at = (c) => seg.b.find((b) => b.c === c);
    expect(at('20479')).toMatchObject({ s: 'D St', l: 'Democracy Aly - 8th St', h: 'Alkali Flat',
      d: [['L', 'North', [[2, 8, 12, 1, 0, 1]]], ['R', 'South', [[1, 8, 12, 1, 0, 1]]]] });
    expect(at('22380')).toMatchObject({ s: 'Capitol Ave', l: '17th St - 18th St', n: [1700, 1730], o: 'L',
      d: [['L', 'North', [[2, 8, 11, 31, 0, 1]]], ['R', 'South', [[1, 8, 11, 31, 0, 1]]]] });
  });
});
