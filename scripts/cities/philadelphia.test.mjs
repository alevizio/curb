// Philadelphia's build (scripts/cities/philadelphia.mjs): parsing and placing real rows of the City's SweepPHL "Route
// Locations" layer, then a check of the committed data/philadelphia/ files. Rows copied from the layer on 2026-10-18
// (only the fields the build reads; coordinates to 7 decimals).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  titleCase, parseWindow, sideDays, oddSide, houseRange, skipReason, compass, limitsOf, blockOf, HOLIDAYS, MONTHS, WEEKS, FLAGS,
} from './philadelphia.mjs';

const row = (properties, coordinates) => ({ properties, geometry: { type: 'LineString', coordinates } });
const YORK = row({ SEG_ID: 541441, STNAME: 'W YORK ST', L_F_ADD: 518, L_T_ADD: 536, R_F_ADD: 521, R_T_ADD: 535, CLASS: 4, FNODE_: 15481,
  TNODE_: 15469, Name: 'West Fairhill', Day: 'MON', Time: '11AM - 1PM', EVEN_SIDE_DAY: 'MON', ODD_SIDE_DAY: 'MON' },
[[-75.1418648, 39.9876099], [-75.1425124, 39.9876882]]);
const CLARISSA = row({ SEG_ID: 621522, STNAME: 'CLARISSA ST', L_F_ADD: 4400, L_T_ADD: 4498, R_F_ADD: 4401, R_T_ADD: 4499, CLASS: 3,
  FNODE_: 11517, TNODE_: 11214, Name: 'Nicetown', Day: 'MON - WED', Time: '11AM - 1PM', EVEN_SIDE_DAY: 'MON', ODD_SIDE_DAY: null },
[[-75.1603237, 40.0193304], [-75.1606339, 40.0197852], [-75.1606937, 40.0200865], [-75.1606759, 40.0201922], [-75.1606588, 40.0202768],
  [-75.1606428, 40.0203348], [-75.1605889, 40.0204822], [-75.1602074, 40.021321]]);
const ALLEGHENY = row({ SEG_ID: 642433, STNAME: 'E ALLEGHENY AVE', L_F_ADD: 861, L_T_ADD: 899, R_F_ADD: 860, R_T_ADD: 898, CLASS: 2,
  FNODE_: 14074, TNODE_: 14066, Name: 'Kensington', Day: 'TUE - THU', Time: '11AM - 1PM', EVEN_SIDE_DAY: 'THU', ODD_SIDE_DAY: null },
[[-75.1137847, 39.9965537], [-75.1134953, 39.9965175], [-75.113358, 39.9965265]]);
const N26TH = row({ SEG_ID: 520621, STNAME: 'N 26TH ST', L_F_ADD: 3100, L_T_ADD: 3198, R_F_ADD: 3101, R_T_ADD: 3199, CLASS: 4,
  FNODE_: 13364, TNODE_: 13161, Name: 'Strawberry Mansion', Day: 'WED', Time: '9AM - 11AM', EVEN_SIDE_DAY: null, ODD_SIDE_DAY: null },
[[-75.1726265, 40.002522], [-75.1722819, 40.0040964]]);
const GLENWOOD = row({ SEG_ID: 520850, STNAME: 'W GLENWOOD AVE', L_F_ADD: 2000, L_T_ADD: 2012, R_F_ADD: 2001, R_T_ADD: 2035, CLASS: 4,
  FNODE_: 14796, TNODE_: 14859, Name: 'North Central', Day: 'MON', Time: '1PM - 3PMl', EVEN_SIDE_DAY: 'MON', ODD_SIDE_DAY: 'MON' },
[[-75.1645481, 39.9926375], [-75.1650467, 39.9923874]]);
const OREGON = row({ SEG_ID: 240436, STNAME: '  OREGON                        AVE', L_F_ADD: 630, L_T_ADD: 698, R_F_ADD: 631, R_T_ADD: 699,
  CLASS: 2, FNODE_: 27277, TNODE_: 27274, Name: 'South Philly', Day: 'TUE', Time: '9AM - 11AM', EVEN_SIDE_DAY: 'TUE', ODD_SIDE_DAY: 'TUE' },
[[-75.1595217, 39.9152559], [-75.159846, 39.9152952]]);
const WAYNE = row({ SEG_ID: 620432, STNAME: 'WAYNE AVE', L_F_ADD: 0, L_T_ADD: 0, R_F_ADD: 0, R_T_ADD: 0, CLASS: 5, FNODE_: 11697,
  TNODE_: 11685, Name: 'Nicetown', Day: 'MON - THU', Time: '11AM - 1PM', EVEN_SIDE_DAY: 'MON', ODD_SIDE_DAY: 'THU' },
[[-75.1571034, 40.0177403], [-75.1571751, 40.017828]]);
const RAMP = { SEG_ID: 640549, STNAME: 'W ROOSEVELT BLVD RAMP B', L_F_ADD: 0, L_T_ADD: 0, R_F_ADD: 0, R_T_ADD: 0, CLASS: 1 };
const SEPTA = { SEG_ID: 621883, STNAME: 'SEPTA DWY', L_F_ADD: 0, L_T_ADD: 0, R_F_ADD: 0, R_T_ADD: 0, CLASS: 6 };
const POLETT = { SEG_ID: 543630, STNAME: 'POLETT WALK', L_F_ADD: 1300, L_T_ADD: 1340, R_F_ADD: 1301, R_T_ADD: 1339, CLASS: 12 };
const ASPEN = { SEG_ID: 423270, STNAME: 'ASPEN ST', L_F_ADD: 4650, L_T_ADD: 4698, R_F_ADD: 4651, R_T_ADD: 4699, CLASS: 6 };
// The Street Centerline's streets at W York St's and Clarissa St's nodes (real rows, 2026-10-18).
const NODES = new Map([[15481, new Set(['N REESE ST', 'W YORK ST'])], [15469, new Set(['N FAIRHILL ST', 'W YORK ST'])],
  [11517, new Set(['CLARISSA ST', 'NEWCOMB ST'])], [11214, new Set(['CLARISSA ST', 'WAYNE AVE', 'WINDRIM AVE'])]]);

describe('names and windows', () => {
  it('writes street names as people do, without the layer\'s padding', () => {
    expect(titleCase('W YORK ST')).toBe('W York St');
    expect(titleCase(OREGON.properties.STNAME)).toBe('Oregon Ave');
    expect(titleCase('N 26TH ST')).toBe('N 26th St');
    expect(titleCase('MC KEAN ST')).toBe('McKean St');
    expect(titleCase('O ST')).toBe('O St');
    expect(titleCase('VAN KIRK ST')).toBe('Van Kirk St');
  });
  it('reads the three posted windows, and the typo in ten rows', () => {
    expect(parseWindow('9AM - 11AM')).toEqual([9, 11]);
    expect(parseWindow('11AM - 1PM')).toEqual([11, 13]);
    expect(parseWindow('1PM - 3PM')).toEqual([13, 15]);
    expect(parseWindow(GLENWOOD.properties.Time)).toEqual([13, 15]);
    expect(parseWindow('')).toBeNull();
  });
});

describe('each side\'s day', () => {
  it('uses EVEN_SIDE_DAY and ODD_SIDE_DAY when both are there', () => {
    expect(sideDays(YORK.properties)).toEqual({ even: 1, odd: 1, filled: null });
    expect(sideDays(WAYNE.properties)).toEqual({ even: 1, odd: 4, filled: null });
  });
  it('fills a blank side from Day, whichever order Day lists the pair in', () => {
    expect(sideDays(CLARISSA.properties)).toEqual({ even: 1, odd: 3, filled: 'odd side from Day' });   // "MON - WED", even MON
    expect(sideDays(ALLEGHENY.properties)).toEqual({ even: 4, odd: 2, filled: 'odd side from Day' }); // "TUE - THU", even THU
    expect(sideDays(N26TH.properties)).toEqual({ even: 3, odd: 3, filled: 'both sides from Day' });
  });
  it('finds the odd side from the address ranges', () => {
    expect(oddSide(YORK.properties)).toBe('R');
    expect(oddSide(ALLEGHENY.properties)).toBe('L');
    expect(oddSide(WAYNE.properties)).toBeNull();
    expect(houseRange(YORK.properties)).toEqual([518, 536]);
    expect(houseRange(WAYNE.properties)).toBeNull();
  });
});

describe('blocks', () => {
  it('names W York St\'s sides by the way they face: odd numbers on the north side', () => {
    const c = YORK.geometry.coordinates;   // drawn east to west, addresses rising westward
    expect([compass(c, 'L'), compass(c, 'R')]).toEqual(['South', 'North']);
  });
  it('builds W York St (both sides Monday, 11 AM to 1 PM, April to October)', () => {
    const { block } = blockOf(YORK, NODES);
    expect(block).toMatchObject({ c: '541441', s: 'W York St', l: 'N Reese St - N Fairhill St',
      h: 'West Fairhill', n: [518, 536], o: 'R' });
    expect(block.d).toEqual([['L', 'South', [[1, 11, 13, 31, 1016, 0]]], ['R', 'North', [[1, 11, 13, 31, 1016, 0]]]]);
  });
  it('puts each day on its side when they differ: Clarissa St even Monday, odd Wednesday', () => {
    const { block, filled } = blockOf(CLARISSA, NODES);
    expect(filled).toBe('odd side from Day');
    expect(block.l).toBe('Newcomb St - Wayne Ave');
    expect(block.d).toEqual([['L', 'West', [[1, 11, 13, WEEKS, MONTHS, FLAGS]]], ['R', 'East', [[3, 11, 13, WEEKS, MONTHS, FLAGS]]]]);
    const allegheny = blockOf(ALLEGHENY).block;   // odd side on the left: Tuesday north, Thursday south
    expect(allegheny.d.map(([s, label, r]) => [s, label, r[0][0]])).toEqual([['L', 'North', 2], ['R', 'South', 4]]);
  });
  it('writes the program areas as the City\'s schedule page does', () => {
    expect(blockOf(OREGON).block.h).toBe('South Philadelphia');
    expect(blockOf(OREGON).block.s).toBe('Oregon Ave');
  });
  it('leaves out what cannot be parked on, and never guesses a side', () => {
    expect(skipReason(RAMP)).toMatch(/expressway/);
    expect(skipReason(POLETT)).toMatch(/closed to traffic/);
    expect(skipReason(SEPTA)).toMatch(/driveway/);
    expect(skipReason(ASPEN)).toBeNull();   // class 6 with house numbers stays
    expect(blockOf(WAYNE).skip).toMatch(/different days/);
  });
  it('has the City\'s holidays for 2026 as its API lists them (2026-10-18), and 2027', () => {
    const api = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-04', '2026-09-07', '2026-10-12',
      '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25'];
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026'))).toEqual(api);
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027'))).toHaveLength(13);
    expect(limitsOf(YORK.properties, NODES)).toBe('N Reese St - N Fairhill St');
  });
});

describe('the committed data', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../data/philadelphia/${f}`, import.meta.url), 'utf8'));
  const segs = read('segments.json'), city = read('city.json'), report = read('report.json');
  it('has every swept block once, with valid rules', () => {
    expect(segs.b.length).toBeGreaterThan(8000);
    expect(new Set(segs.b.map((b) => b.c)).size).toBe(segs.b.length);
    const windows = new Set();
    for (const b of segs.b) {
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      expect(b.d.length).toBeGreaterThanOrEqual(1);
      for (const [side, label, rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        expect(label).toMatch(/^(North|South|East|West|Northeast|Northwest|Southeast|Southwest)$/);
        for (const [dow, from, to, weeks, months, flags] of rules) {
          expect([1, 2, 3, 4]).toContain(dow);
          expect([weeks, months, flags]).toEqual([31, 1016, 0]);
          windows.add(`${from}-${to}`);
        }
      }
    }
    expect([...windows].sort()).toEqual(['11-13', '13-15', '9-11']);
    expect(fs.statSync(new URL('../../data/philadelphia/segments.json', import.meta.url)).size).toBeLessThan(6e6);
  });
  it('writes city.json as the page expects', () => {
    for (const k of ['id', 'name', 'region', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidaysSource', 'holidayRule', 'fine', 'tow',
      'fineSource', 'agency', 'scheduleUrl', 'sources', 'words', 'neighborhoods']) expect(city).toHaveProperty(k);
    expect(city).toMatchObject({ id: 'philadelphia', tz: 'America/New_York', holidayRule: 'all', fine: '$31', tow: 'no' });
    const [[s, w], [n, e]] = city.bounds;
    expect(city.center[0] > s && city.center[0] < n && city.center[1] > w && city.center[1] < e).toBe(true);
    for (const b of segs.b) for (const [lo, la] of b.g) expect(la >= s && la <= n && lo >= w && lo <= e).toBe(true);
    expect(city.neighborhoods.map((h) => h.name)).toHaveLength(14);
    for (const h of city.neighborhoods) expect(h.bbox).toMatch(/^-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4}$/);
    expect(JSON.stringify(city.words)).not.toMatch(/[—–]/);
    expect(city.holidays).toEqual(HOLIDAYS);
  });
  it('agrees with report.json', () => {
    expect(report.output.blocks).toBe(segs.b.length);
    expect(report.inputs.routeRows).toBe(segs.b.length + report.skipped.reduce((n, x) => n + x.count, 0) + report.inputs.duplicateSegIds);
  });
});
