// Pittsburgh's build (scripts/cities/pittsburgh.mjs): decoding the sweep codes of real rows of the City's Street
// Centerline (PavementPublic), placing them on the drawn line's left and right, then a check of the committed
// data/pittsburgh/ files. Rows copied from the layer on 2026-10-18 (only the fields the build reads; coordinates to 7
// decimals).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  decode, rulesOf, titleCase, limits, hoodOf, officialHoods, compass, lineOf, oddSide, houseRange, blockOf, opdcCheck, HOLIDAYS, FROM, TO, MONTHS,
} from './pittsburgh.mjs';

const row = (properties, geometry) => ({ properties: { retired: null, class: '', ...properties }, geometry });
const line = (coordinates) => ({ type: 'LineString', coordinates });
const HAMILTON = row({ carteid: '17398', streetname: 'HAMILTON AVE', fromstreet: 'ROSEDALE ST', tostreet: 'MULFORD ST', lleft: 7833, hleft: 7835,
  lrgt: 7834, hrgt: 7836, hood_left: 'HOMEWOOD SOUTH', hood_right: 'HOMEWOOD SOUTH', sweep_left: '2SW10A-4M', sweep_right: '2SW10B-4T' },
line([[-79.8860163, 40.4520069], [-79.8856575, 40.4519258], [-79.8856045, 40.4519139]]));
const ATWOOD = row({ carteid: '1974', streetname: 'ATWOOD ST', fromstreet: 'LOUISA ST', tostreet: 'BATES ST', lleft: 301, hleft: 369, lrgt: 300,
  hrgt: 370, hood_left: 'CENTRAL OAKLAND', hood_right: 'CENTRAL OAKLAND', sweep_left: '3SW4-3M', sweep_right: '3SW5-3T' },
line([[-79.9558814, 40.439699], [-79.955622, 40.4394897], [-79.9553876, 40.4392978], [-79.955142, 40.4390973], [-79.9548969, 40.4388967],
  [-79.9546514, 40.4386963], [-79.9544037, 40.4384973], [-79.9541555, 40.4382989], [-79.953929, 40.4381178]]));
const OAKLAND = row({ carteid: '3617', streetname: 'OAKLAND AVE', fromstreet: 'BATES ST', tostreet: 'DAWSON ST', lleft: 401, hleft: 429, lrgt: 402,
  hrgt: 430, hood_left: 'CENTRAL OAKLAND', hood_right: 'CENTRAL OAKLAND', sweep_left: '3SW7-3R', sweep_right: '3SW6-3W' },
line([[-79.9534142, 40.4386253], [-79.9533898, 40.4385507], [-79.9528734, 40.4382432], [-79.9525899, 40.4380747], [-79.9521218, 40.4378109]]));
const BIDWELL = row({ carteid: '1762', streetname: 'BIDWELL ST', fromstreet: 'LIVERPOOL ST', tostreet: 'DECATUR ST', lleft: 1501, hleft: 1515,
  lrgt: 1500, hrgt: 1514, hood_left: 'MANCHESTER', hood_right: 'MANCHESTER', sweep_left: '1SW10-1R', sweep_right: '1SW10-1R' },
line([[-80.0215875, 40.4559034], [-80.0216735, 40.4561742], [-80.0217318, 40.4563583]]));
const FIFTH = row({ carteid: '56', streetname: 'FIFTH AVE', fromstreet: 'LOTHROP ST', tostreet: 'MEYRAN AVE', lleft: 3523, hleft: 3525, lrgt: 3524,
  hrgt: 3526, hood_left: 'WEST OAKLAND', hood_right: 'CENTRAL OAKLAND', sweep_left: '3SW1-3MW', sweep_right: '3SW1-3MW' },
line([[-79.9593868, 40.4411201], [-79.9591722, 40.4412739]]));
const NOBLESTOWN = row({ carteid: '20303', streetname: 'NOBLESTOWN RD', fromstreet: 'NOBLESTOWN RD', tostreet: 'CRAFTON BLVD', lleft: 1737, hleft: 1737,
  lrgt: 1736, hrgt: 1736, hood_left: 'WESTWOOD', hood_right: 'CRAFTON HEIGHTS', sweep_left: '5SW8-2W', sweep_right: '5SW9-2R' },
{ type: 'MultiLineString', coordinates: [[[-80.0536593, 40.4379855], [-80.0536836, 40.4379833]], [[-80.0536823, 40.4379833], [-80.0540358, 40.4379501]]] });
const CRAIG_RETIRED = row({ carteid: '19923', streetname: 'N CRAIG ST', fromstreet: 'BAYARD ST', tostreet: 'CENTRE AVE', lleft: 201, hleft: 279,
  lrgt: 200, hrgt: 280, hood_left: 'NORTH OAKLAND', hood_right: 'NORTH OAKLAND', sweep_left: '3SW4-3M', sweep_right: '3SW5-3T', retired: 1679356800000 },
line([[-79.9517799, 40.4515019], [-79.9518053, 40.4515433], [-79.9519738, 40.451819], [-79.9520211, 40.4518915]]));
const OFFICIAL = officialHoods(['Homewood South', 'Central Oakland', 'West Oakland', 'Manchester', 'South Side Flats', 'Westwood', 'St. Clair']);

describe('the sweep codes', () => {
  it('decodes division, route and day as the City\'s data dictionary describes them', () => {
    expect(decode('5SW8-2W')).toEqual({ division: 5, route: '8', week: 2, days: [3] });         // the dictionary's own example
    expect(decode('2SW10A-4M')).toEqual({ division: 2, route: '10A', week: 4, days: [1] });
    expect(decode('2SW10B-4T')).toEqual({ division: 2, route: '10B', week: 4, days: [2] });
    expect(decode('1SW10-1R')).toEqual({ division: 1, route: '10', week: 1, days: [4] });       // R = Thursday
    expect(decode('3SW1-3MW')).toEqual({ division: 3, route: '1', week: 3, days: [1, 3] });     // read as both days
    expect(decode('')).toBeNull();
    expect(decode('SW10-4M')).toBeNull();
  });
  it('turns a code into rules: its weekday, its week of the month, April to November, 8 AM to 2:30 PM', () => {
    expect(rulesOf(decode('2SW10A-4M'))).toEqual([[1, 8, '14:30', 8, 2040, 0]]);
    expect(rulesOf(decode('3SW1-3MW'))).toEqual([[1, FROM, TO, 4, MONTHS, 0], [3, FROM, TO, 4, MONTHS, 0]]);
  });
});

describe('names', () => {
  it('writes streets as people do', () => {
    expect(titleCase('HAMILTON AVE')).toBe('Hamilton Ave');
    expect(titleCase('N ST CLAIR ST')).toBe('N St Clair St');
    expect(titleCase('MCKEE PL')).toBe('McKee Pl');
    expect(titleCase('MACON AVE')).toBe('Macon Ave');
    expect(titleCase('FEDERAL ST S')).toBe('Federal St S');
    expect(titleCase('43 1/2 ST')).toBe('43 1/2 St');
    expect(titleCase('UNNAMED97AB WAY')).toBe('Unnamed Way');
    expect(titleCase('BIRMINGHAM BRG')).toBe('Birmingham Bridge');
    expect(titleCase('BLVD OF THE ALLIES RAMP')).toBe('Blvd of the Allies Ramp');
    expect(titleCase('I-279 HOV')).toBe('I-279 HOV');
  });
  it('names cross streets from the first point to the last, and neighborhoods as the City spells them', () => {
    expect(limits(HAMILTON.properties)).toBe('Rosedale St - Mulford St');
    expect(limits(NOBLESTOWN.properties)).toBe('Crafton Blvd');   // the end that is not at a cross street carries the street's own name
    expect(hoodOf(HAMILTON.properties, OFFICIAL)).toBe('Homewood South');
    expect(hoodOf({ hood_left: 'SOUTHSIDE FLATS' }, OFFICIAL)).toBe('South Side Flats');
    expect(hoodOf({ hood_left: 'OUTSIDE OF CITY', hood_right: 'WESTWOOD' }, OFFICIAL)).toBe('Westwood');
    expect(hoodOf({ hood_left: 'ST CLAIR' }, OFFICIAL)).toBe('St. Clair');
  });
});

describe('sides', () => {
  it('reads left and right as the drawn line\'s: Hamilton Ave\'s left, the odd side, is 4th Monday', () => {
    const { block } = blockOf(HAMILTON, OFFICIAL);
    expect(block).toMatchObject({ c: '17398', s: 'Hamilton Ave', l: 'Rosedale St - Mulford St', h: 'Homewood South', n: [7833, 7836], o: 'L' });
    expect(block.d).toEqual([['L', 'North', [[1, 8, '14:30', 8, 2040, 0]]], ['R', 'South', [[2, 8, '14:30', 8, 2040, 0]]]]);
  });
  it('agrees with OPDC\'s list on Atwood St\'s 300 block (odd side 3rd Monday, even side 3rd Tuesday)', () => {
    const { block } = blockOf(ATWOOD, OFFICIAL);
    expect(oddSide(ATWOOD.properties)).toBe('L');
    expect(block.d.map(([s, , r]) => [s, r[0][0], r[0][3]])).toEqual([['L', 1, 4], ['R', 2, 4]]);
    const check = opdcCheck([ATWOOD, OAKLAND]);
    expect(check.rows.find((r) => r.street === 'ATWOOD ST' && r.part === '300')).toMatchObject({ agree: 2, otherSide: 0 });
    // Oakland Ave is one of the streets where OPDC names the other side (reported, not changed)
    expect(check.rows.find((r) => r.street === 'OAKLAND AVE')).toMatchObject({ agree: 0, otherSide: 2 });
  });
  it('gives both sides the same day when one code is on both, and two rules to a 3MW side', () => {
    expect(blockOf(BIDWELL, OFFICIAL).block.d.map(([s, , r]) => [s, r])).toEqual([['L', [[4, 8, '14:30', 1, 2040, 0]]], ['R', [[4, 8, '14:30', 1, 2040, 0]]]]);
    const fifth = blockOf(FIFTH, OFFICIAL).block;
    expect(fifth.d[0][2].map((r) => r[0])).toEqual([1, 3]);
    expect(fifth.h).toBe('West Oakland');
  });
  it('joins a two part line that meets end to start, and skips retired segments', () => {
    expect(lineOf(NOBLESTOWN.geometry)).toHaveLength(3);
    expect(compass(lineOf(NOBLESTOWN.geometry), 'L')).toBe('South');   // drawn westward
    expect(blockOf(NOBLESTOWN, OFFICIAL).block.d.map(([s, , r]) => [s, r[0][0], r[0][3]])).toEqual([['L', 3, 2], ['R', 4, 2]]);
    expect(blockOf(CRAIG_RETIRED, OFFICIAL).skip).toMatch(/retired/);
    expect(houseRange(HAMILTON.properties)).toEqual([7833, 7836]);
  });
  it('has the City\'s 2026 holidays (City Clerk calendar) and a 2027 by the same rule', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d < '2027')).toEqual(['2026-01-01', '2026-01-19', '2026-04-03', '2026-05-25', '2026-06-19',
      '2026-07-03', '2026-09-07', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25']);
    expect(HOLIDAYS['2026-02-16']).toBeUndefined();   // Presidents' Day is not a City holiday
    expect(HOLIDAYS['2027-07-05']).toBe('Independence Day (observed)');
  });
});

describe('the committed data', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/pittsburgh/${f}`, import.meta.url), 'utf8'));
  const segs = read('segments.json'), city = read('city.json'), report = read('report.json');
  it('has every coded segment once, with valid rules', () => {
    expect(segs.b.length).toBeGreaterThan(3500);
    expect(new Set(segs.b.map((b) => b.c)).size).toBe(segs.b.length);
    for (const b of segs.b) {
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      for (const [side, , rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        for (const [dow, from, to, weeks, months, flags] of rules) {
          expect([1, 2, 3, 4, 5]).toContain(dow);
          expect([from, to, months, flags]).toEqual([8, '14:30', 2040, 0]);
          expect([1, 2, 4, 8, 16]).toContain(weeks);
        }
      }
    }
  });
  it('writes city.json as the page expects', () => {
    for (const k of ['id', 'name', 'region', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidaysSource', 'holidayRule', 'fine', 'tow',
      'fineSource', 'agency', 'scheduleUrl', 'sources', 'words', 'neighborhoods']) expect(city).toHaveProperty(k);
    expect(city).toMatchObject({ id: 'pittsburgh', tz: 'America/New_York', holidayRule: 'all', fine: '$30', tow: 'no' });
    const [[s, w], [n, e]] = city.bounds;
    expect(city.center[0] > s && city.center[0] < n && city.center[1] > w && city.center[1] < e).toBe(true);
    for (const b of segs.b) for (const [lo, la] of b.g) expect(la >= s && la <= n && lo >= w && lo <= e).toBe(true);
    for (const h of city.neighborhoods) expect(h.bbox).toMatch(/^-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4}$/);
    expect(JSON.stringify(city.words)).not.toMatch(/[—–]/);
    expect(city.holidays).toEqual(HOLIDAYS);
  });
  it('agrees with report.json, and the side checks hold', () => {
    expect(report.output.blocks).toBe(segs.b.length);
    expect(report.inputs.withSweepCode).toBe(segs.b.length + report.skipped.reduce((n, x) => n + x.count, 0));
    expect(report.decoding.unreadable).toEqual({});
    expect(report.checks.sideByAddress.rising / report.checks.sideByAddress.withNumbers).toBeGreaterThan(0.99);
    expect(report.checks.opdcOakland.agree).toBeGreaterThan(3 * report.checks.opdcOakland.otherSide);
  });
});
