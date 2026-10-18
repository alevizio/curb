// Norfolk's build (scripts/cities/norfolk.mjs): parsing the City's schedule rows, holidays, placing addresses on block
// sides, and the rules it writes. Rows are the City's own (house numbers cut to the hundred block); block lines and address
// ranges are real centerline segments. The last part checks data/norfolk/ when it has been built.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseCsvLine, parseAddress, normStreet, parseDescription, patternOf, isoDate, nthWeekday, descriptionMatches,
  dropHolidays, HOLIDAYS, rangeOf, sideByParity, holdsNumber, oddSide, nearestOnLine, snapAddress, flippedRanges,
  compass, streetLabel, titleCase, districtName, notACrossStreet, inPolygon, midpoint, ruleOf, WINDOW, FLAGS,
} from './norfolk.mjs';

// Real centerline segments (City of Norfolk Street Centerline, UNIQUE_NO, ranges, line).
const SEG = {
  westover1300: { UNIQUE_NO: 11473, FULLNAME: 'WESTOVER AVENUE', LADD_FR: '1301', LADD_TO: '1351', RADD_FR: '1300', RADD_TO: '1350',
    c: [[-76.307873, 36.86871], [-76.30826, 36.86952], [-76.308683, 36.870371]] },
  westover1400: { UNIQUE_NO: 11186, FULLNAME: 'WESTOVER AVENUE', LADD_FR: '1401', LADD_TO: '1461', RADD_FR: '1400', RADD_TO: '1460',
    c: [[-76.308683, 36.870371], [-76.30965, 36.872315]] },
  burleigh500: { UNIQUE_NO: 4982, FULLNAME: 'BURLEIGH AVENUE', LADD_FR: '501', LADD_TO: '531', RADD_FR: '500', RADD_TO: '528',
    c: [[-76.282172, 36.915027], [-76.285751, 36.91539], [-76.285765, 36.915391]] },
  granby7600: { UNIQUE_NO: 4985, FULLNAME: 'GRANBY STREET', LADD_FR: '0', LADD_TO: '0', RADD_FR: '7639', RADD_TO: '7601',
    c: [[-76.272494, 36.916384], [-76.272797, 36.914821], [-76.2728, 36.914812]] },
};
const seg = (k) => ({ id: String(SEG[k].UNIQUE_NO), p: SEG[k], c: SEG[k].c, key: normStreet(SEG[k].FULLNAME), name: streetLabel(SEG[k].FULLNAME) });
// A point `m` meters to the left (+) or right (-) of the middle of a segment's first piece.
function beside(c, m) {
  const [a, b] = c, kx = Math.cos(36.88 * Math.PI / 180) * 111320, ky = 110950;
  const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky, len = Math.hypot(dx, dy);
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  return [mx + (-dy / len) * m / kx, my + (dx / len) * m / ky];
}

// The City's rows, as the CSV export writes them (Address, Latitude, Longitude, Sweeping Date, Description, Signed, Frequency).
const ROW_EVEN = '1300 WESTOVER AVENUE,36.8695,-76.3082,11/04/2026,First Wednesday of November,Yes,Monthly';
const ROW_DAILY = '200 GRANBY STREET,36.8481,-76.2909,01/01/2026,Daily,No,Daily';
const EVEN_1300 = ['01/07', '02/04', '03/04', '04/01', '05/06', '06/03', '07/01', '08/05', '09/02', '10/07', '11/04', '12/02'];
const ODD_1300 = ['01/01', '02/05', '03/05', '04/02', '05/07', '06/04', '07/02', '08/06', '09/03', '10/01', '11/05', '12/03'];
const iso = (mmdd) => isoDate(`${mmdd}/2026`);

describe('the schedule rows', () => {
  it('splits a CSV line, quoted commas included', () => {
    expect(parseCsvLine(ROW_EVEN)).toEqual(['1300 WESTOVER AVENUE', '36.8695', '-76.3082', '11/04/2026', 'First Wednesday of November', 'Yes', 'Monthly']);
    expect(parseCsvLine('"1300 WESTOVER AVENUE, REAR",1,2')).toEqual(['1300 WESTOVER AVENUE, REAR', '1', '2']);
    expect(parseCsvLine(ROW_DAILY)[6]).toBe('Daily');
  });
  it('reads the house number and the street, with the direction as part of the street', () => {
    expect(parseAddress('1300 WESTOVER AVENUE')).toEqual({ num: 1300, street: 'WESTOVER AVENUE' });
    expect(parseAddress('200 W BUTE STREET')).toEqual({ num: 200, street: 'W BUTE STREET' });
    expect(parseAddress('100 A VIEW AVENUE')).toEqual({ num: 100, street: 'A VIEW AVENUE' });
    expect(parseAddress('1300A WESTOVER AVENUE')).toEqual({ num: 1300, street: 'WESTOVER AVENUE' });
    expect(parseAddress('1300 REDGATED AVENUE').street).toBe('REDGATE AVENUE');     // a typo in the schedule
    expect(parseAddress('100 Springfield Avenue').street).toBe('SPRINGFIELD AVENUE');
    expect(parseAddress('WESTOVER AVENUE')).toBeNull();
  });
  it('reads the day words and checks them against the date', () => {
    expect(parseDescription('Second Tuesday of November')).toEqual({ nth: 2, dow: 2, month: 11 });
    expect(parseDescription('Daily')).toEqual({ daily: true });
    expect(parseDescription('Quarterly')).toBeNull();
    expect(patternOf('First Wednesday of November')).toBe('First Wednesday');
    expect(isoDate('11/04/2026')).toBe('2026-11-04');
    expect(nthWeekday('2026-11-26')).toEqual({ nth: 4, dow: 4, month: 11 });
    expect(descriptionMatches('First Wednesday of November', '2026-11-04')).toBe(true);
    expect(descriptionMatches('First Wednesday of November', '2026-11-05')).toBe(false);
    expect(descriptionMatches('Fourth Thursday of November', '2026-11-26')).toBe(true);    // Thanksgiving, in the data
    expect(descriptionMatches('Daily', '2026-01-01')).toBe(true);
    for (const d of EVEN_1300) expect(descriptionMatches(`First Wednesday of ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+d.slice(0, 2) - 1]}`, iso(d))).toBe(true);
  });
});

describe('City holidays', () => {
  it('takes the holidays the data still lists off the dates: Thanksgiving, Christmas and the rest', () => {
    const fourthThu = ['01/22', '02/26', '03/26', '04/23', '05/28', '06/25', '07/23', '08/27', '09/24', '10/22', '11/26', '12/24'].map(iso);
    const fourthFri = ['01/23', '02/27', '03/27', '04/24', '05/22', '06/26', '07/24', '08/28', '09/25', '10/23', '11/27', '12/25'].map(iso);
    expect(dropHolidays(fourthThu).dropped).toEqual(['2026-11-26', '2026-12-24']);
    expect(dropHolidays(fourthFri).dropped).toEqual(['2026-11-27', '2026-12-25']);
    expect(dropHolidays(fourthThu).kept).toHaveLength(10);
    expect(dropHolidays(['2026-11-11', '2026-10-14', '2026-10-14']).kept).toEqual(['2026-10-14']);   // Veterans Day; sorted, unique
    expect(dropHolidays(ODD_1300.map(iso)).dropped).toEqual(['2026-01-01']);
  });
  it('lists the City Code holidays for 2026 and 2027, a Saturday one on the Friday before and a Sunday one on the Monday after', () => {
    const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
    const nth = (y, m, dow, n) => { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return ymd(y, m, 1 + ((dow - first + 7) % 7) + 7 * (n - 1)); };
    const last = (y, m, dow) => { const d = new Date(Date.UTC(y, m, 0)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7)); return d.toISOString().slice(0, 10); };
    const observed = (s) => { const d = new Date(s + 'T00:00:00Z'), w = d.getUTCDay(); if (w === 6) d.setUTCDate(d.getUTCDate() - 1); if (w === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    for (const y of [2026, 2027]) {
      const expected = [observed(ymd(y, 1, 1)), nth(y, 1, 1, 3), nth(y, 2, 1, 3), last(y, 5, 1), observed(ymd(y, 6, 19)), observed(ymd(y, 7, 4)),
        nth(y, 9, 1, 1), ymd(y, 11, +nth(y, 11, 1, 1).slice(8) + 1), observed(ymd(y, 11, 11)), nth(y, 11, 4, 4),
        ymd(y, 11, +nth(y, 11, 4, 4).slice(8) + 1)];
      const listed = Object.keys(HOLIDAYS).filter((d) => d.startsWith(y + '-'));
      for (const d of expected) expect(listed).toContain(d);
      // Christmas Eve and Christmas Day: Dec 24 and 25, or in 2027 (Christmas on a Saturday) Thursday 23 and Friday 24
      expect(listed.filter((d) => d >= `${y}-12-20`)).toEqual(y === 2026 ? ['2026-12-24', '2026-12-25'] : ['2027-12-23', '2027-12-24']);
      expect(listed).toHaveLength(13);
    }
    expect(HOLIDAYS['2026-11-03']).toBe('Election Day');
  });
});

describe('placing an address on its block and side', () => {
  it('reads address ranges and the side that holds a number', () => {
    expect(rangeOf('7639', '7601')).toEqual({ lo: 7601, hi: 7639, parity: 1 });
    expect(rangeOf('0', '0')).toBeNull();
    expect(rangeOf('1300', '1351')).toEqual({ lo: 1300, hi: 1351, parity: null });
    expect(sideByParity(SEG.burleigh500, 515)).toBe('L');
    expect(sideByParity(SEG.burleigh500, 520)).toBe('R');
    expect(sideByParity(SEG.granby7600, 7615)).toBe('R');
    expect(sideByParity(SEG.granby7600, 7614)).toBeNull();        // no even side: the point's position decides
    expect(holdsNumber(SEG.westover1300, 1330)).toBe(true);
    expect(holdsNumber(SEG.westover1300, 1430)).toBe(false);
    expect(oddSide(SEG.westover1300)).toBe('L');
    expect(oddSide(SEG.granby7600)).toBe('R');
  });
  it('measures which side of the line a point lies on', () => {
    const left = nearestOnLine(SEG.westover1300.c, beside(SEG.westover1300.c, 15));
    const right = nearestOnLine(SEG.westover1300.c, beside(SEG.westover1300.c, -15));
    expect(left.side).toBe('L');
    expect(right.side).toBe('R');
    expect(left.d).toBeGreaterThan(13);
    expect(left.d).toBeLessThan(17);
  });
  it('puts a number on the block whose range holds it and on its parity side, and falls back to the nearest block', () => {
    const streets = new Map([['WESTOVER AVENUE', [seg('westover1300'), seg('westover1400')]]]);
    const odd = snapAddress({ num: 1331, street: 'WESTOVER AVENUE', lon: beside(SEG.westover1300.c, 12)[0], lat: beside(SEG.westover1300.c, 12)[1] }, streets);
    expect([odd.seg.id, odd.how, odd.side, odd.paritySide, odd.geoSide]).toEqual(['11473', 'range', 'L', 'L', 'L']);
    // an even number whose point sits near the 1400 block still goes to the 1300 block, by its number
    const p = beside(SEG.westover1400.c, -12);
    const even = snapAddress({ num: 1330, street: 'WESTOVER AVENUE', lon: p[0], lat: p[1] }, streets);
    expect([even.seg.id, even.side]).toEqual(['11473', 'R']);
    // a number no block holds: the nearest block of the street, when it is close
    const near = snapAddress({ num: 1500, street: 'WESTOVER AVENUE', lon: p[0], lat: p[1] }, streets);
    expect([near.seg.id, near.how]).toEqual(['11186', 'nearest']);
    expect(snapAddress({ num: 10, street: 'WALKE STREET', lon: p[0], lat: p[1] }, streets).why).toBe('street not in the centerline');
    expect(snapAddress({ num: 1500, street: 'WESTOVER AVENUE', lon: -76.3, lat: 36.9 }, streets).why).toMatch(/nearest over 60 m/);
  });
  it('lets the points decide on a block whose ranges are on the wrong sides (Nicholson St: 40 of 40 near points)', () => {
    expect(flippedRanges({ ok: 0, bad: 40 })).toBe(true);
    expect(flippedRanges({ ok: 19, bad: 6 })).toBe(false);     // Conoga St: a few points across the street
    expect(flippedRanges({ ok: 0, bad: 2 })).toBe(false);
  });
});

describe('names and labels', () => {
  it('writes streets as people say them', () => {
    expect(streetLabel('W OLNEY ROAD')).toBe('W Olney Rd');
    expect(streetLabel('34TH STREET')).toBe('34th St');
    expect(streetLabel('BERKLEY AVENUE EX')).toBe('Berkley Ave Ext');
    expect(streetLabel('AVENUE H')).toBe('Avenue H');
    expect(streetLabel('STOCKLEY GARDENS')).toBe('Stockley Gardens');
    expect(streetLabel('MCKANN AVENUE')).toBe('McKann Ave');
    expect(streetLabel('I-64W HIGHWAY')).toBe('I-64W Hwy');
    expect(titleCase('SAINT PAULS')).toBe('Saint Pauls');
    expect(notACrossStreet('MISCELLANEOUS STREET')).toBe(true);
    expect(notACrossStreet('I-264E HIGHWAY')).toBe(true);
    expect(notACrossStreet('WESTOVER AVENUE')).toBe(false);
  });
  it('writes Planning District names, fixing the layer\'s spelling of Lafayette', () => {
    expect(districtName('LAYFAYETTE')).toBe('Lafayette');
    expect(districtName('LAMBERTS POINT / ODU')).toBe('Lamberts Point / ODU');
    expect(districtName('EDGEWATER - LARCHMONT')).toBe('Edgewater - Larchmont');
    expect(districtName('NORTH CHESAPEAKE BLVD.')).toBe('North Chesapeake Blvd');
    expect(districtName('WEST 21st STREET')).toBe('West 21st Street');
  });
  it('labels each curb by the way it faces', () => {
    const north = [[-76.3, 36.86], [-76.3, 36.87]];
    expect([compass(north, 'L'), compass(north, 'R')]).toEqual(['West', 'East']);
    expect([compass(SEG.westover1300.c, 'L'), compass(SEG.westover1300.c, 'R')]).toEqual(['West', 'East']);
  });
  it('finds a point in a polygon and the middle of a line', () => {
    const sq = { type: 'Polygon', coordinates: [[[-76.31, 36.86], [-76.30, 36.86], [-76.30, 36.87], [-76.31, 36.87], [-76.31, 36.86]]] };
    expect(inPolygon([-76.305, 36.865], sq)).toBe(true);
    expect(inPolygon([-76.295, 36.865], sq)).toBe(false);
    const m = midpoint([[-76.3, 36.86], [-76.3, 36.88]]);
    expect(m[1]).toBeCloseTo(36.87, 6);
  });
});

describe('the rules a block side gets', () => {
  it('turns the 1300 block of Westover Ave into one rule per side: no parking 8 to 2 on each date, towable', () => {
    const even = dropHolidays(EVEN_1300.map(iso)).kept, odd = dropHolidays(ODD_1300.map(iso)).kept;
    expect(WINDOW).toEqual([8, 14]);
    expect(FLAGS).toBe(2);
    expect(ruleOf(even)).toEqual([-1, 8, 14, 0, 0, 2, EVEN_1300.map(iso)]);
    expect(ruleOf(odd)).toEqual([-1, 8, 14, 0, 0, 2, ODD_1300.slice(1).map(iso)]);    // New Year's Day dropped
    expect(ruleOf(['2026-11-05', '2026-10-01', '2026-11-05'])[6]).toEqual(['2026-10-01', '2026-11-05']);
  });
});

const ROOT = new URL('../../data/norfolk/', import.meta.url);
const built = fs.existsSync(new URL('segments.json', ROOT));
describe.skipIf(!built)('the built data/norfolk', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(f, ROOT), 'utf8'));
  const seg6 = built ? read('segments.json') : null, city = built ? read('city.json') : null, report = built ? read('report.json') : null;
  const LABELS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
  it('has the format\'s meta and a few hundred signed blocks', () => {
    expect(seg6._meta).toMatchObject({ city: 'norfolk', time_zone: 'America/New_York' });
    expect(seg6._meta.season.from <= seg6._meta.season.to).toBe(true);
    expect(seg6.b.length).toBeGreaterThan(500);
    expect(seg6.b.length).toBe(seg6._meta.blocks);
    expect(seg6.b.reduce((n, b) => n + b.d.length, 0)).toBe(seg6._meta.sides);
  });
  it('writes every block and rule well formed, dates sorted, none on a City holiday', () => {
    const ids = new Set();
    for (const b of seg6.b) {
      expect(typeof b.c).toBe('string');
      expect(ids.has(b.c)).toBe(false);
      ids.add(b.c);
      expect(typeof b.s).toBe('string');
      expect(typeof b.l).toBe('string');
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      for (const [lo, la] of b.g) {
        expect(Math.round(lo * 1e6) / 1e6).toBe(lo);
        expect(Math.round(la * 1e6) / 1e6).toBe(la);
        expect(lo > -76.4 && lo < -76.1 && la > 36.8 && la < 37).toBe(true);
      }
      if (b.o) expect(['L', 'R']).toContain(b.o);
      if (b.n) expect(b.n[0]).toBeLessThanOrEqual(b.n[1]);
      expect(new Set(b.d.map((x) => x[0])).size).toBe(b.d.length);
      for (const [side, label, rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        expect(LABELS).toContain(label);
        for (const r of rules) {
          expect(r.slice(0, 6)).toEqual([-1, 8, 14, 0, 0, 2]);
          const dates = r[6];
          expect(dates.length).toBeGreaterThan(0);
          for (let i = 0; i < dates.length; i++) {
            expect(dates[i]).toMatch(/^2026-\d{2}-\d{2}$/);
            expect(HOLIDAYS[dates[i]]).toBeUndefined();
            expect(city.holidays[dates[i]]).toBeUndefined();
            if (i) expect(dates[i] > dates[i - 1]).toBe(true);
          }
        }
      }
    }
  });
  it('keeps the remaining 2026 sweeps (from 2026-10-18 to the end of the year) on every side', () => {
    for (const b of seg6.b) for (const [, , rules] of b.d) expect(rules.some((r) => r[6].some((d) => d >= '2026-10-18'))).toBe(true);
  });
  it('writes city.json in the city-build.md shape', () => {
    for (const k of ['id', 'name', 'region', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidaysSource', 'holidayRule', 'fine', 'tow',
      'fineSource', 'agency', 'scheduleUrl', 'sources', 'words']) expect(city).toHaveProperty(k);
    expect(city).toMatchObject({ id: 'norfolk', tz: 'America/New_York', holidayRule: 'all', fine: '$60', tow: 'sometimes' });
    expect(city.holidays).toEqual(HOLIDAYS);
    const [[s, w], [n, e]] = city.bounds;
    expect(city.center[0] > s && city.center[0] < n && city.center[1] > w && city.center[1] < e).toBe(true);
    expect([14, 15]).toContain(city.zoom);
    for (const k of ['rule', 'afterpass', 'dataNotes']) expect(city.words[k].length).toBeGreaterThan(20);
    for (const h of city.neighborhoods || []) expect(h.bbox.split(',').map(Number).every(Number.isFinite)).toBe(true);
  });
  it('reports counts, what was skipped and the ticket check', () => {
    for (const k of ['generated', 'inputs', 'output', 'skipped', 'season', 'checks', 'assumptions', 'unverified', 'questionsForCity']) expect(report).toHaveProperty(k);
    expect(report.output.blocks).toBe(seg6.b.length);
    expect(report.checks.tickets.inWindowShare).toBeGreaterThan(0.99);
    expect(report.checks.tickets.sameDayShare).toBeGreaterThan(0.9);
  });
  it('copies no house address into the output', () => {
    const text = fs.readFileSync(new URL('segments.json', ROOT), 'utf8') + fs.readFileSync(new URL('report.json', ROOT), 'utf8');
    expect(text).not.toMatch(/\b\d{2,5} [A-Z]{3,} (STREET|AVENUE|ROAD|DRIVE)\b/);
  });
});
