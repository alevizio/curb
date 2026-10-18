// Riverside's route decoding, week pairs and side placement, with real rows from the City's Street Sweeping Zones layer, the
// City's 2026 calendar and the County's street lines.
import { describe, it, expect } from 'vitest';
import {
  decodeZone, MAP_WEEKS, WINDOW, SPLIT, NO_WINDOW, occurrence, sweepsOn, HOLIDAYS, streetName, notAStreet, oddSide,
  houseRange, compass, sideRuns, cut, lengthM, pointAt, ll, xy,
} from './riverside.mjs';

// Real zones (OBJECTID, StreetSweepRoute, StreetSweepDay) as the layer serves them (edited 2026-09-23).
const ZONE_ROWS = [
  [103, '201A', 'Tuesday'], [65, '201P', 'Tuesday'], [72, '202A', 'Tuesday'], [32, '402A', 'Thursday'], [13, '403P', 'Thursday'],
  [29, '310A', 'Wednesday'], [116, '501A', 'Friday'], [128, '512P', 'Friday'], [99, '30911', 'Wednesday'],
  [78, '313A', 'Wednesday'], [7, '315P', 'Wednesday'], [6, '206/7', 'Tuesday'], [85, '506/7', 'Friday'], [3, 'NOSWEEP', 'NoSweep'],
];

describe('decodeZone', () => {
  const dec = Object.fromEntries(ZONE_ROWS.map(([id, code, day]) => [id, decodeZone(code, day)]));
  it('reads weekday, window and week pair from the code and the City\'s map', () => {
    expect(dec[103]).toEqual({ kind: 'both', rule: [2, '7:30', '11:30', 5, 0, 0] });      // 1st & 3rd Tue AM
    expect(dec[65]).toEqual({ kind: 'both', rule: [2, '11:30', '15:30', 5, 0, 0] });      // 1st & 3rd Tue PM
    expect(dec[72]).toEqual({ kind: 'both', rule: [2, '7:30', '11:30', 10, 0, 0] });      // 2nd & 4th Tue AM
    expect(dec[32]).toEqual({ kind: 'both', rule: [4, '7:30', '11:30', 10, 0, 0] });      // 2nd & 4th Thu AM
    expect(dec[13]).toEqual({ kind: 'both', rule: [4, '11:30', '15:30', 5, 0, 0] });      // 1st & 3rd Thu PM
    expect(dec[29]).toEqual({ kind: 'both', rule: [3, '7:30', '11:30', 10, 0, 0] });      // 2nd & 4th Wed AM
    expect(dec[116]).toEqual({ kind: 'both', rule: [5, '7:30', '11:30', 5, 0, 0] });      // 1st & 3rd Fri AM
    expect(dec[128]).toEqual({ kind: 'both', rule: [5, '11:30', '15:30', 10, 0, 0] });    // 2nd & 4th Fri PM
  });
  it('309/11: 1st & 3rd Wednesday, the odd side in the morning and the even side in the afternoon', () => {
    expect(dec[99]).toEqual({ kind: 'split', odd: [3, '7:30', '11:30', 5, 0, 0], even: [3, '11:30', '15:30', 5, 0, 0] });
  });
  it('leaves out what the City\'s map does not give', () => {
    expect(dec[78].skip).toMatch(/week pair unknown/);   // 313A, moved to Wednesday in 2023
    expect(dec[7].skip).toMatch(/week pair unknown/);    // 315P
    expect(dec[6].skip).toMatch(/no hours/);             // 206/7
    expect(dec[85].skip).toMatch(/no hours/);            // 506/7
    expect(dec[3].skip).toMatch(/NOSWEEP/);
  });
  it('refuses a code whose weekday disagrees with the layer\'s day, and codes it cannot read', () => {
    expect(decodeZone('201A', 'Friday').skip).toMatch(/does not match/);
    expect(decodeZone('30911', 'Tuesday').skip).toMatch(/does not match/);
    expect(decodeZone('9X', 'Tuesday').skip).toMatch(/not decoded/);
    expect(decodeZone('', 'Tuesday').skip).toBeTruthy();
  });
  it('matches the map: odd routes 1st & 3rd, even routes 2nd & 4th, on every route it shows', () => {
    for (const [route, weeks] of Object.entries(MAP_WEEKS)) expect(weeks).toBe(+route % 2 ? 5 : 10);
    expect(Object.keys(MAP_WEEKS)).toHaveLength(38);
    expect(MAP_WEEKS[313]).toBeUndefined();
    expect(MAP_WEEKS[315]).toBeUndefined();
    expect(Object.keys(NO_WINDOW).sort()).toEqual(['206/7', '208/9', '506/7']);
    expect(Object.keys(SPLIT)).toEqual(['30911']);
    expect(WINDOW).toEqual({ A: ['7:30', '11:30'], P: ['11:30', '15:30'] });
  });
});

describe('weeks of the month, against the City\'s 2026 calendar', () => {
  const blue = [2, '7:30', '11:30', 5, 0, 0], yellow = [2, '7:30', '11:30', 10, 0, 0];
  const at = (dow, rule) => [dow, ...rule.slice(1)];
  it('counts the weekday\'s occurrence in the month', () => {
    expect(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'].map(occurrence)).toEqual([1, 2, 3, 4, 5]);
  });
  it('colors the days as the calendar does (1st & 3rd blue, 2nd & 4th yellow, a 5th one blank)', () => {
    // read off the City's 2026 Street Sweeping Schedule postcard
    expect(sweepsOn(at(2, blue), '2026-10-06')).toBe(true);     // Tue Oct 6: blue
    expect(sweepsOn(at(2, yellow), '2026-10-13')).toBe(true);   // Tue Oct 13: yellow
    expect(sweepsOn(at(2, blue), '2026-10-13')).toBe(false);
    expect(sweepsOn(at(4, blue), '2026-10-15')).toBe(true);     // Thu Oct 15: blue
    expect(sweepsOn(at(4, blue), '2026-10-29')).toBe(false);    // Thu Oct 29: blank (5th Thursday)
    expect(sweepsOn(at(4, yellow), '2026-10-29')).toBe(false);
    expect(sweepsOn(at(3, blue), '2026-04-01')).toBe(true);     // Wed Apr 1: blue
    expect(sweepsOn(at(4, yellow), '2026-12-24')).toBe(true);   // Thu Dec 24: yellow
    expect(sweepsOn(at(4, blue), '2026-01-29')).toBe(false);    // Thu Jan 29: blank
    expect(sweepsOn(at(5, blue), '2026-01-02')).toBe(true);     // Fri Jan 2: blue
    expect(sweepsOn(at(5, blue), '2026-01-09')).toBe(false);    // Fri Jan 9: yellow
  });
});

describe('holidays', () => {
  it('lists every H on the City\'s 2026 calendar', () => {
    const marked = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-03-31', '2026-05-25', '2026-06-19', '2026-07-03',
      '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25'];
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026'))).toEqual(marked);
  });
  it('carries 2027 with the weekend rule (Saturday to Friday, Sunday to Monday)', () => {
    expect(HOLIDAYS['2027-06-18']).toMatch(/Juneteenth/);    // June 19, 2027 is a Saturday
    expect(HOLIDAYS['2027-07-05']).toMatch(/Independence/);  // July 4, 2027 is a Sunday
    expect(HOLIDAYS['2027-12-24']).toMatch(/Christmas/);     // December 25, 2027 is a Saturday
    for (const d of Object.keys(HOLIDAYS)) expect([0, 6]).not.toContain(new Date(d + 'T12:00:00Z').getUTCDay());
  });
});

describe('County street rows', () => {
  // Palm Ave, County Streets OBJECTID 5922914: left 5300-5398, right 5301-5399
  const palm = { CLASS: '10', L_F_ADD: '5300', L_T_ADD: '5398', R_F_ADD: '5301', R_T_ADD: '5399', STREET_NAME: 'PALM', STREET_SUFFIX: 'AVE', FULL_NAME: 'PALM AVE' };
  it('names, numbers and the odd side', () => {
    expect(streetName(palm)).toBe('Palm Ave');
    expect(streetName({ FULL_NAME: 'N ORANGE ST' })).toBe('N Orange St');
    expect(streetName({ FULL_NAME: '', PREFIX_DIRECTION: 'W', STREET_NAME: 'LA CADENA', STREET_SUFFIX: 'DR' })).toBe('W La Cadena Dr');
    expect(oddSide(palm)).toBe('R');
    expect(houseRange(palm)).toEqual([5300, 5399]);
    expect(oddSide({ L_F_ADD: '0', L_T_ADD: '0', R_F_ADD: '0', R_T_ADD: '0' })).toBeNull();
  });
  it('drops lines that are not streets', () => {
    for (const n of ['<access Road>', 'Ramp', 'Walkway', 'Street A', 'Hughes Alley', 'Noname']) expect(notAStreet(n)).toBe(true);
    for (const n of ['Palm Ave', 'Valley Dr', 'Laurel', 'Old 215 Frontage Rd']) expect(notAStreet(n)).toBe(false);
  });
});

describe('placing sides in zones', () => {
  const line = [ll([0, 0]), ll([120, 0])];   // 120 m going east
  it('labels L and R looking from the first point to the last', () => {
    expect(compass(line, 'L')).toBe('North');
    expect(compass(line, 'R')).toBe('South');
  });
  it('gives each side the zone it lies in, and cuts a block where a boundary crosses it', () => {
    // zone a north of the street, b south of it, c east of x = 80 m on both sides
    const zoneAt = (pt) => { const [x, y] = xy(pt); return x > 80 ? 'c' : y > 0 ? 'a' : 'b'; };
    const runs = sideRuns(line, zoneAt);
    expect(runs.map(([, , zl, zr]) => [zl, zr])).toEqual([['a', 'b'], ['c', 'c']]);
    expect(Math.round(runs[0][1])).toBe(80);
    const pieces = runs.map(([d0, d1]) => cut(line, d0, d1));
    expect(Math.round(pieces.reduce((s, p) => s + lengthM(p), 0))).toBe(120);
    expect(Math.round(xy(pieces[1][0])[0])).toBe(80);
  });
  it('a short run at a corner joins the zone along most of the block', () => {
    const short = [ll([0, 0]), ll([20, 0])];
    const zoneAt = (pt) => (xy(pt)[0] > 16 ? 'corner' : 'main');
    expect(sideRuns(short, zoneAt).map(([, , zl, zr]) => [zl, zr])).toEqual([['main', 'main']]);
  });
  it('measures along a bent line', () => {
    const bent = [ll([0, 0]), ll([30, 0]), ll([30, 40])];
    expect(Math.round(lengthM(bent))).toBe(70);
    const { p, u } = pointAt(bent, 50);
    expect(p.map(Math.round)).toEqual([30, 20]);
    expect(u.map((v) => Math.round(v))).toEqual([0, 1]);
  });
});
