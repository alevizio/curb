// Saint Paul's build (scripts/cities/saint-paul.mjs): parsing and placing real rows of the City's Street Sweeping layer,
// then a check of the committed data/saint-paul/ files. Rows copied from the layer on 2026-10-18 (only the fields the
// build reads; geometry to 7 decimals, Weide St's in full).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  localDate, titleCase, cleanName, scrubHouseNumbers, oddSide, houseRange, compass, lineOf, round6, skipReason, blockOf,
  ruleFor, lineGrid, nameFromCenterlines, sameDirection, inPolygon, districtName, limits, HOLIDAYS, FROM, TO, FLAGS, weekday,
} from './saint-paul.mjs';

const row = (properties, coordinates, type = 'LineString') => ({ properties, geometry: { type, coordinates } });
const blank = { L_F_ADD: 0, L_T_ADD: 0, R_F_ADD: 0, R_T_ADD: 0, STREETALL: null, F_XSTREET: null, T_XSTREET: null, NIGHT_N_E: null, NIGHT_S_W: null };

const WEIDE = row({ OBJECTID: 74, L_F_ADD: 1591, L_T_ADD: 1619, R_F_ADD: 1592, R_T_ADD: 1620, STREETALL: 'WEIDE ST', F_XSTREET: 'IOWA AVE E',
  T_XSTREET: 'IDAHO AVE E', DAY_RTE: 'A-5', NIGHT_N_E: null, NIGHT_S_W: null, SweepDate: 1792476060000, SweepOperation: 'Seasonal' },
[[-93.0677285013535, 44.9892598541657], [-93.0677241297194, 44.9901668241134]]);   // full precision, as the City serves it
const ROBERT = row({ OBJECTID: 75, L_F_ADD: 126, L_T_ADD: 202, R_F_ADD: 127, R_T_ADD: 203, STREETALL: 'ROBERT ST S', F_XSTREET: 'FAIRFIELD AVE W',
  T_XSTREET: 'PLATO BLVD E', DAY_RTE: '', NIGHT_N_E: 'T-1-E', NIGHT_S_W: 'T-1-W', SweepDate: null, SweepOperation: 'Arterial' },
[[-93.0842273, 44.9403841], [-93.0826294, 44.9384668]]);
const I94 = row({ ...blank, OBJECTID: 81, STREETALL: 'INTERSTATE 94', F_XSTREET: 'EB I94 TO MARION ST', T_XSTREET: 'EB I94 TO WB 7TH ST W',
  DAY_RTE: '', SweepDate: null, SweepOperation: 'Highway' },
[[-93.1146065, 44.9509785], [-93.1157801, 44.9511222], [-93.116128, 44.9511619], [-93.1181559, 44.9513929], [-93.1189941, 44.9514973]]);
const SLIVER = row({ OBJECTID: 89, L_F_ADD: 1059, L_T_ADD: 1061, R_F_ADD: 1060, R_T_ADD: 1062, STREETALL: null, F_XSTREET: 'EARL ST',
  T_XSTREET: 'EARL ST SERVICE DRIVE EAST', DAY_RTE: 'B-15', NIGHT_N_E: null, NIGHT_S_W: null, SweepDate: 1794290460000, SweepOperation: 'Seasonal' },
[[-93.0558479, 44.9658013], [-93.0556753, 44.9658013]]);
const SYLVAN = row({ OBJECTID: 635, L_F_ADD: 747, L_T_ADD: 753, R_F_ADD: 748, R_T_ADD: 754, STREETALL: 'SYLVAN ST', F_XSTREET: 'DEAD END',
  T_XSTREET: 'ACKER ST W', DAY_RTE: '', NIGHT_N_E: null, NIGHT_S_W: null, SweepDate: null, SweepOperation: 'Seasonal' },
[[-93.1014321, 44.9640283], [-93.1014253, 44.9637728]]);
const OGDEN = row({ OBJECTID: 3557, L_F_ADD: 2050, L_T_ADD: 2068, R_F_ADD: 2051, R_T_ADD: 2067, STREETALL: 'OGDEN AVE', F_XSTREET: 'HIGHWAY 61',
  T_XSTREET: 'DEAD END', DAY_RTE: 'B-5', NIGHT_N_E: null, NIGHT_S_W: null, SweepDate: 1793253660000, SweepOperation: 'Seasonal' },
[[-93.0129629, 44.9089134], [-93.012713, 44.9089545], [-93.0126905, 44.9089545], [-93.0126748, 44.9089514], [-93.0126586, 44.9089371],
  [-93.0123848, 44.9084682], [-93.0123658, 44.9084438], [-93.0123361, 44.908415], [-93.0122873, 44.9083937], [-93.012233, 44.9083777],
  [-93.0121673, 44.9083684], [-93.0117576, 44.9083684]]);
const ACCESS = row({ OBJECTID: 12239, L_F_ADD: null, L_T_ADD: null, R_F_ADD: null, R_T_ADD: null, STREETALL: 'ACCESS ROAD TO 506 RANDOLPH AVE',
  F_XSTREET: 'RANDOLPH AVE', T_XSTREET: 'DEAD END', DAY_RTE: 'C-8', NIGHT_N_E: null, NIGHT_S_W: null, SweepDate: 1792389660000, SweepOperation: 'Seasonal' },
[[-93.1210382, 44.926814], [-93.1209159, 44.9268276], [-93.1208522, 44.9268552], [-93.1208204, 44.9268812], [-93.120803, 44.9269263], [-93.12078, 44.9271547]]);
// Griggs St N between Ashland and Laurel: swept, but its street name is blank in the sweeping layer
const GRIGGS_BLANK = row({ ...blank, OBJECTID: 5766, DAY_RTE: 'D-4', SweepDate: 1794463260000, SweepOperation: 'Seasonal' },
  [[-93.1517183, 44.9439639], [-93.1517184, 44.9450197]]);
// the City's 2019 centerlines around it
const CENTERLINES = [
  { p: { OBJECTID: 8370, STREETALL: 'GRIGGS ST N', F_XSTREET: 'ASHLAND AVE', T_XSTREET: 'LAUREL AVE', L_F_ADD: 85, L_T_ADD: 119, R_F_ADD: 86, R_T_ADD: 120 },
    line: [[-93.1517261, 44.9439719], [-93.1517246, 44.9449749], [-93.151708, 44.944976], [-93.1516901, 44.9449807], [-93.1516754, 44.9449877],
      [-93.1516635, 44.9449962], [-93.151655, 44.9450055], [-93.1516493, 44.9450156], [-93.1516463, 44.9450246], [-93.1516456, 44.9450292]] },
  { p: { OBJECTID: 5697, STREETALL: 'GRIGGS ST N', F_XSTREET: 'PORTLAND AVE', T_XSTREET: 'ASHLAND AVE', L_F_ADD: 49, L_T_ADD: 83, R_F_ADD: 50, R_T_ADD: 84 },
    line: [[-93.1517948, 44.9429177], [-93.1517935, 44.9429284], [-93.1517892, 44.9429386], [-93.1517807, 44.94295], [-93.1517688, 44.9429597],
      [-93.1517551, 44.9429665], [-93.1517412, 44.942971], [-93.1517284, 44.9429733], [-93.1517141, 44.9429738], [-93.1517261, 44.9439719]] },
  { p: { OBJECTID: 5500, STREETALL: 'GRIGGS ST N', F_XSTREET: 'LAUREL AVE', T_XSTREET: 'HAGUE AVE', L_F_ADD: 121, L_T_ADD: 143, R_F_ADD: 122, R_T_ADD: 144 },
    line: [[-93.1518092, 44.9450339], [-93.1518075, 44.9450451], [-93.151801, 44.9450582], [-93.1517909, 44.9450696], [-93.1517772, 44.9450791],
      [-93.1517621, 44.9450854], [-93.1517425, 44.9450898], [-93.1517265, 44.9450911], [-93.151726, 44.9458229]] },
];
// Aurora Ave: a cul-de-sac drawn as two parts, the street and its bulb
const AURORA = row({ OBJECTID: 10477, L_F_ADD: 500, L_T_ADD: 580, R_F_ADD: 501, R_T_ADD: 581, STREETALL: 'AURORA AVE', F_XSTREET: 'MACKUBIN ST',
  T_XSTREET: 'CUL-DE-SAC', DAY_RTE: 'E-4', NIGHT_N_E: null, NIGHT_S_W: null, SweepDate: 1793599260000, SweepOperation: 'Seasonal' },
[[[-93.1212394, 44.9548699], [-93.1225127, 44.9548693], [-93.1226135, 44.9548552], [-93.122659, 44.9548231], [-93.1226995, 44.9547874], [-93.122701, 44.9544547]],
  [[-93.122701, 44.9544547], [-93.1227019, 44.9542473], [-93.1227523, 44.9542366], [-93.1229436, 44.9542693], [-93.1229687, 44.954298],
    [-93.1229732, 44.9544196], [-93.1229428, 44.9544481], [-93.122701, 44.9544547]]], 'MultiLineString');

describe('sweep dates', () => {
  it('reads SweepDate (06:01 UTC) as the calendar date in Saint Paul, across the end of daylight time', () => {
    expect(localDate(WEIDE.properties.SweepDate)).toBe('2026-10-20');
    expect(localDate(ACCESS.properties.SweepDate)).toBe('2026-10-19');
    expect(localDate(SLIVER.properties.SweepDate)).toBe('2026-11-10');      // after Nov 1: 06:01 UTC is 12:01 AM CST
    expect(localDate(Date.UTC(2026, 10, 2, 5, 30))).toBe('2026-11-01');      // 11:30 PM CST the night before
  });
  it('makes the posted rule: no parking 8 AM to 6 PM on the date, towable, dates sorted and unique', () => {
    expect([FROM, TO, FLAGS]).toEqual([8, 18, 2]);
    expect(ruleFor(['2026-11-12', '2026-10-20', '2026-11-12'])).toEqual([-1, 8, 18, 0, 0, 2, ['2026-10-20', '2026-11-12']]);
  });
});

describe('street names', () => {
  it('writes names as people say them', () => {
    expect(titleCase('RUTH ST N')).toBe('Ruth St N');
    expect(titleCase('MCKNIGHT RD N')).toBe('McKnight Rd N');
    expect(titleCase('7TH ST W')).toBe('7th St W');
    expect(titleCase('SAINT ALBANS ST N')).toBe('Saint Albans St N');
    expect(titleCase('JOHNSON PKWY SERVICE RD W')).toBe('Johnson Pkwy Service Rd W');
    expect(titleCase('CUL-DE-SAC')).toBe('Cul-de-sac');
    expect(titleCase('EB I94 TO WB 7TH ST W')).toBe('EB I94 To WB 7th St W');
  });
  it('never lets a house number through, but keeps highway numbers', () => {
    expect(cleanName('ACCESS ROAD TO 506 RANDOLPH AVE')).toBe('Access Road To Randolph Ave');
    expect(cleanName('1157 - 1177 EDGCUMBE RD')).toBe('Edgcumbe Rd');
    expect(cleanName('1172 - 1178 AND 1188 - 1194 ST CLAIR AVE')).toBe('St Clair Ave');
    expect(cleanName('1180 EDGCUMBE RD')).toBe('Edgcumbe Rd');
    expect(scrubHouseNumbers('HIGHWAY 61')).toBe('HIGHWAY 61');
    expect(cleanName('SB HWY 280 TO KASOTA AVE')).toBe('SB Hwy 280 To Kasota Ave');
    expect(limits('HIGHWAY 61', 'DEAD END')).toBe('Highway 61 - Dead End');
    expect(limits('DESOTO ST', 'DESOTO ST')).toBe('Desoto St');
    expect(limits(null, 'ACKER ST W')).toBe('Acker St W');
  });
  it('closes up the planning districts\' hyphens', () => {
    expect(districtName('Payne - Phalen')).toBe('Payne-Phalen');
    expect(districtName("Dayton's Bluff")).toBe("Dayton's Bluff");
  });
});

describe('house numbers and sides', () => {
  it('finds the odd side from the left and right ranges', () => {
    expect(oddSide(WEIDE.properties)).toBe('L');             // 1591-1619 on the left
    expect(oddSide(OGDEN.properties)).toBe('R');             // 2051-2067 on the right
    expect(oddSide(GRIGGS_BLANK.properties)).toBe(null);     // no ranges
    expect(houseRange(WEIDE.properties)).toEqual([1591, 1620]);
    expect(houseRange(ACCESS.properties)).toBe(null);
  });
  it('labels sides by compass: left of a northbound line is West', () => {
    const north = [[-93.1, 44.95], [-93.1, 44.951]], east = [[-93.1, 44.95], [-93.099, 44.95]];
    expect([compass(north, 'L'), compass(north, 'R')]).toEqual(['West', 'East']);
    expect([compass(east, 'L'), compass(east, 'R')]).toEqual(['North', 'South']);
  });
});

describe('which rows become blocks', () => {
  it('leaves out arterials, highways, unscheduled blocks and unnamed slivers, with a reason', () => {
    expect(skipReason(ROBERT.properties, ROBERT.geometry.coordinates)).toMatch(/^arterial/);
    expect(skipReason(I94.properties, I94.geometry.coordinates)).toMatch(/^highway/);
    expect(skipReason(SYLVAN.properties, SYLVAN.geometry.coordinates)).toMatch(/^residential block with no sweep date/);
    expect(skipReason(SLIVER.properties, SLIVER.geometry.coordinates)).toMatch(/^unnamed piece under 20 m/);
    expect(skipReason(GRIGGS_BLANK.properties, GRIGGS_BLANK.geometry.coordinates)).toBe(null);   // 117 m: named from a centerline
    expect(skipReason(WEIDE.properties, WEIDE.geometry.coordinates)).toBe(null);
  });
  it('joins a cul-de-sac drawn in two parts into one line', () => {
    const { line, how } = lineOf(AURORA.geometry);
    expect(how).toBe('joined');
    expect(line.length).toBe(13);
    expect(line[0]).toEqual([-93.1212394, 44.9548699]);
  });
  it('rounds to 6 decimals and drops repeated points', () => {
    expect(round6([[-93.1234567, 44.9876543], [-93.12345671, 44.98765429], [-93.1, 44.9]])).toEqual([[-93.123457, 44.987654], [-93.1, 44.9]]);
  });
});

describe('a real block, end to end', () => {
  it('Weide St, Iowa Ave E to Idaho Ave E: both sides, Oct 20, 8 AM to 6 PM', () => {
    expect(blockOf(WEIDE.properties, WEIDE.geometry.coordinates, { hood: 'Payne-Phalen' })).toEqual({
      c: '74', s: 'Weide St', l: 'Iowa Ave E - Idaho Ave E', h: 'Payne-Phalen', n: [1591, 1620], o: 'L',
      g: [[-93.067729, 44.98926], [-93.067724, 44.990167]],
      d: [['L', 'West', [[-1, 8, 18, 0, 0, 2, ['2026-10-20']]]], ['R', 'East', [[-1, 8, 18, 0, 0, 2, ['2026-10-20']]]]],
    });
  });
  it('gives each side its own copy of the rule', () => {
    const b = blockOf(OGDEN.properties, OGDEN.geometry.coordinates);
    expect(b.d[0][2][0]).not.toBe(b.d[1][2][0]);
    expect(b.d[0][2][0][6]).not.toBe(b.d[1][2][0][6]);
    expect(b.d[0][2]).toEqual([[-1, 8, 18, 0, 0, 2, ['2026-10-29']]]);
    expect(b.l).toBe('Highway 61 - Dead End');
  });
  it('names a blank block from the centerline under it, ranges included', () => {
    const near = lineGrid(CENTERLINES, 50, 10);
    const cl = nameFromCenterlines(GRIGGS_BLANK.geometry.coordinates, near);
    expect(cl.p.OBJECTID).toBe(8370);
    expect(sameDirection(GRIGGS_BLANK.geometry.coordinates, cl.line)).toBe(true);
    const b = blockOf(GRIGGS_BLANK.properties, GRIGGS_BLANK.geometry.coordinates, { name: cl.p.STREETALL, from: cl.p.F_XSTREET, to: cl.p.T_XSTREET, addr: cl.p });
    expect([b.s, b.l, b.n, b.o]).toEqual(['Griggs St N', 'Ashland Ave - Laurel Ave', [85, 120], 'L']);
    expect(b.d[0][2]).toEqual([[-1, 8, 18, 0, 0, 2, ['2026-11-12']]]);
  });
  it('drops the house number from an access road\'s name', () => {
    expect(blockOf(ACCESS.properties, ACCESS.geometry.coordinates).s).toBe('Access Road To Randolph Ave');
  });
  it('finds a point inside a district polygon', () => {
    const sq = { type: 'Polygon', coordinates: [[[-93.2, 44.9], [-93.1, 44.9], [-93.1, 45], [-93.2, 45], [-93.2, 44.9]]] };
    expect(inPolygon([-93.15, 44.95], sq)).toBe(true);
    expect(inPolygon([-93.05, 44.95], sq)).toBe(false);
  });
});

describe('holidays', () => {
  it('lists the City\'s eleven holidays for 2026 and 2027, with the weekend rule', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026'))).toHaveLength(11);
    expect(HOLIDAYS['2026-07-03']).toMatch(/Independence/);      // July 4, 2026 is a Saturday
    expect(HOLIDAYS['2027-06-18']).toMatch(/Juneteenth/);        // June 19, 2027 is a Saturday
    expect(HOLIDAYS['2027-12-24']).toMatch(/Christmas/);         // Dec 25, 2027 is a Saturday
    expect(HOLIDAYS['2027-12-31']).toMatch(/New Year/);          // Jan 1, 2028 is a Saturday
    for (const d of Object.keys(HOLIDAYS)) expect([0, 6]).not.toContain(weekday(d));
  });
});

// ---------- the committed data ----------------------------------------------------------------------------------------
const DATA = new URL('../../data/saint-paul/', import.meta.url);
const has = fs.existsSync(new URL('segments.json', DATA));
describe.skipIf(!has)('data/saint-paul', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(f, DATA), 'utf8'));
  const segs = has ? read('segments.json') : null, city = has ? read('city.json') : null, report = has ? read('report.json') : null;
  const LABELS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];

  it('has the shape of city-build.md', () => {
    expect(segs._meta.city).toBe('saint-paul');
    expect(segs._meta.time_zone).toBe('America/Chicago');
    expect(segs.b.length).toBe(segs._meta.blocks);
    expect(segs.b.length).toBeGreaterThan(5000);
    expect(new Set(segs.b.map((b) => b.c)).size).toBe(segs.b.length);
  });
  it('writes every block with a street, a line in 6 decimals and both sides', { timeout: 30000 }, () => {
    for (const b of segs.b) {
      expect(typeof b.c).toBe('string');
      expect(b.s.length).toBeGreaterThan(0);
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      for (const [lo, la] of b.g) {
        expect(Math.round(lo * 1e6) / 1e6).toBe(lo);
        expect(Math.round(la * 1e6) / 1e6).toBe(la);
        expect(lo).toBeGreaterThan(-93.25); expect(lo).toBeLessThan(-92.95);
        expect(la).toBeGreaterThan(44.88); expect(la).toBeLessThan(45.0);
      }
      expect(b.d.map((x) => x[0])).toEqual(['L', 'R']);
      for (const [, label] of b.d) expect(LABELS).toContain(label);
      expect(b.d[0][1]).not.toBe(b.d[1][1]);
      expect(b.d[0][2]).toEqual(b.d[1][2]);
      if (b.o) expect(['L', 'R']).toContain(b.o);
      if (b.n) expect(b.n[0]).toBeLessThanOrEqual(b.n[1]);
    }
  });
  it('lists only real sweep dates: weekdays in the season, sorted, never a City holiday', () => {
    const { from, to } = segs._meta.season;
    for (const b of segs.b) for (const [, , rules] of b.d) for (const r of rules) {
      expect(r.slice(0, 6)).toEqual([-1, 8, 18, 0, 0, 2]);
      expect(r[6].length).toBeGreaterThan(0);
      expect([...r[6]].sort()).toEqual(r[6]);
      expect(new Set(r[6]).size).toBe(r[6].length);
      for (const d of r[6]) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(d >= from && d <= to).toBe(true);
        expect([0, 6]).not.toContain(weekday(d));
        expect(city.holidays[d]).toBeUndefined();
      }
    }
  });
  it('carries no house numbers in street or cross street names', () => {
    for (const b of segs.b) expect(scrubHouseNumbers(b.s + ' ' + b.l)).toBe((b.s + ' ' + b.l).toUpperCase().replace(/\s+/g, ' ').trim());
  });
  it('writes city.json as the page expects', () => {
    for (const k of ['id', 'name', 'region', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidaysSource', 'holidayRule', 'fine', 'tow',
      'fineSource', 'agency', 'scheduleUrl', 'sources', 'words', 'neighborhoods']) expect(city).toHaveProperty(k);
    expect(city.holidayRule).toBe('all');
    expect(['no', 'yes', 'sometimes']).toContain(city.tow);
    const [[s, w], [n, e]] = city.bounds;
    expect(city.center[0] > s && city.center[0] < n && city.center[1] > w && city.center[1] < e).toBe(true);
    for (const b of segs.b) for (const [lo, la] of b.g) expect(la >= s && la <= n && lo >= w && lo <= e).toBe(true);
    expect(city.neighborhoods).toHaveLength(17);
    for (const h of city.neighborhoods) expect(h.bbox).toMatch(/^-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+$/);
    for (const k of ['rule', 'afterpass', 'dataNotes']) expect(city.words[k].length).toBeGreaterThan(20);
    expect(JSON.stringify(city.words)).not.toMatch(/[—–]/);
  });
  it('agrees with report.json', () => {
    expect(report.output.blocks).toBe(segs.b.length);
    expect(report.checks.datesOnHolidays).toEqual([]);
    expect(report.checks.routesWithMoreThanOneDate).toBe(0);
  });
});
