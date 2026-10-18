// Chicago's data build (scripts/cities/chicago.mjs): the zones' day lists, placing block sides in ward sections, the
// main street filter, the winter ban rules, names, and a check of the built data/chicago/segments.json when it exists.
// Real rows from the City's data (Street Sweeping Zones 2026, its schedule table, Street Center Lines), fetched 2026-10-18.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseDays, sectionDates, mergeSectionDates, unpaired, nextWorkday, aprilFirsts, weekday, HOLIDAYS, YEAR,
  sweepRule, winterRules, mergeRules, WINTER_MONTHS, compass, polygonIndex, sidePoints, vote, resolveSides, sideSections,
  placeBlock, classify, titleCase, areaName, streetName, crossName, coreName, simplify, round6, lineLength,
} from './chicago.mjs';

// ---- real rows -------------------------------------------------------------------------------------------------------

// Street Sweeping Zones - 2026 (2r7q-emq3), month fields of six sections.
const Z = {
  '0101': { ward_section: '0101', april: '1,2', may: '13,14', june: '26,29', july: null, august: '10,11', september: '22,23', october: null, november: '4,5' },
  '0102': { ward_section: '0102', april: '3,6', may: '15,18', june: '30', july: '1', august: '12,13', september: '24,25', october: null, november: '6,9' },
  '0204': { ward_section: '0204', april: '1,7,8,14,15,21,22,28,29', may: '5,6,12,13,19,20,26,27', june: '2,3,9,10,16,17,23,24,30', july: '1,7,8,14,15,21,22,28,29', august: '4,5,11,12,18,19,25,26', september: '1,2,8,9,15,16,22,23,29,30', october: '6,7,13,14,20,21,27,28', november: '3,4,10,17,18' },
  '34NA': { ward_section: '34NA', april: null, may: null, june: null, july: null, august: null, september: null, october: null, november: null },
  '3905': { ward_section: '3905', april: '13,14', may: null, june: '3,4', july: '27,28', august: null, september: '16,15', october: null, november: '6,9' },
  '4410': { ward_section: '4410', april: '2,3', may: '1,7', june: '4,5', july: '2', august: '6,7', september: '3,4', october: '1,2', november: '5,6' },
};
// Street Sweeping Schedule - 2026 (u5ai-3efk) for section 3905, as month cells (the City's ward 39 PDF reads September 16 and 17).
const T3905 = { april: '13,14', june: '3,4', july: '27,28', september: '16,17', november: '6,9' };
// Street Center Lines (pr57-gg9e).
const ADA = { p: { trans_id: '117112', fnode_id: '9722', tnode_id: '9654', pre_dir: 'N', street_nam: 'ADA', street_typ: 'ST', suf_dir: null, l_f_add: '500', l_t_add: '544', r_f_add: '501', r_t_add: '545', class: '4', status: 'N', l_parity: 'E', r_parity: 'O', f_cross: '1346|W|GRAND|AVE|', t_cross: '1337|W|OHIO|ST|' },
  c: [[-87.66077718240223, 41.89104356169731], [-87.66078157649594, 41.89118902774498], [-87.66078200740331, 41.891203303059086], [-87.6607874119, 41.89140772650012], [-87.66078936982316, 41.891481776726316], [-87.66079044467682, 41.89152191477989], [-87.66079390875262, 41.89165128753916], [-87.66080027839645, 41.89189136346203], [-87.66080451109832, 41.89204378491462], [-87.6608064893174, 41.89211502789461], [-87.66081626136152, 41.89250794518339]] };
const W82 = { p: { trans_id: '130468', pre_dir: 'W', street_nam: '82ND', street_typ: 'ST', suf_dir: null, class: '4', status: 'N', l_parity: 'O', r_parity: 'E', f_cross: '8200|S|MAY|ST|', t_cross: '8200|S|RACINE|AVE|' },
  c: [[-87.65237802903815, 41.745051119458374], [-87.652570731625, 41.74505118696598], [-87.65267052850075, 41.74504969774863], [-87.65298434787601, 41.74504541298596], [-87.65359236431605, 41.74503678902159]] };
const MILWAUKEE = { trans_id: '104241', pre_dir: 'N', street_nam: 'MILWAUKEE', street_typ: 'AVE', class: '3', status: 'N' };
const FULLERTON = { trans_id: '103495', pre_dir: 'W', street_nam: 'FULLERTON', street_typ: 'PKWY', class: '2', status: 'N' };
const WINTHROP_PRIVATE = { trans_id: '100535', pre_dir: 'N', street_nam: 'WINTHROP', street_typ: 'AVE', class: '4', status: 'P' };
const UNNAMED = { trans_id: '102665', pre_dir: null, street_nam: null, street_typ: null, class: '4', status: 'N', f_cross: '3927|N|CLARENDON|AVE|', t_cross: '3927|N|BROADWAY| |' };
const RAMP = { trans_id: '144385', pre_dir: 'N', street_nam: 'LA SALLE DR', street_typ: 'ER', class: '4', status: 'N' };

describe('the zones\' day lists', () => {
  it('reads a month cell into day numbers, and an empty one into none', () => {
    expect(parseDays('1,2')).toEqual([1, 2]);
    expect(parseDays(' 26, 29 ')).toEqual([26, 29]);
    expect(parseDays(null)).toEqual([]);
    expect(parseDays('')).toEqual([]);
  });
  it('stops on anything that is not a day list', () => {
    expect(() => parseDays('1-2')).toThrow();
    expect(() => parseDays('32')).toThrow();
    expect(() => sectionDates({ june: '31' })).toThrow();   // June has 30 days
  });
  it('turns a section into its sorted 2026 dates', () => {
    expect(sectionDates(Z['0101'])).toEqual(['2026-04-01', '2026-04-02', '2026-05-13', '2026-05-14', '2026-06-26', '2026-06-29',
      '2026-08-10', '2026-08-11', '2026-09-22', '2026-09-23', '2026-11-04', '2026-11-05']);
    expect(sectionDates(Z['34NA'])).toEqual([]);
  });
  it('keeps a pair that crosses the end of a month (June 30 and July 1)', () => {
    const d = sectionDates(Z['0102']);
    expect(d).toContain('2026-06-30');
    expect(d).toContain('2026-07-01');
    expect(nextWorkday('2026-06-30', HOLIDAYS)).toBe('2026-07-01');
    expect(unpaired(d, HOLIDAYS)).toEqual([]);
  });
  it('sorts a reversed cell, and takes both sources where the zones and the table differ (3905 in September)', () => {
    expect(sectionDates(Z['3905']).filter((d) => d.startsWith('2026-09'))).toEqual(['2026-09-15', '2026-09-16']);
    const m = mergeSectionDates(Z['3905'], T3905);
    expect(m.dates.filter((d) => d.startsWith('2026-09'))).toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
    expect(m.diff).toEqual({ zones: ['2026-09-15'], table: ['2026-09-17'] });
    expect(mergeSectionDates(Z['0101'], { april: '1,2', may: '13,14', june: '26,29', august: '10,11', september: '22,23', november: '4,5' }).diff).toBeNull();
  });
  it('finds the dates that are not part of a two day pair', () => {
    // a pair skips the weekend (Friday June 26, Monday June 29) and holidays (Friday July 3 is Independence Day)
    expect(nextWorkday('2026-06-26', HOLIDAYS)).toBe('2026-06-29');
    expect(nextWorkday('2026-07-02', HOLIDAYS)).toBe('2026-07-06');
    // 4410: May 1 and May 7 are lone days, July 2 has no partner
    expect(unpaired(sectionDates(Z['4410']), HOLIDAYS)).toEqual(['2026-05-01', '2026-05-07', '2026-07-02']);
    // weekly Tuesday and Wednesday: only the season's first Wednesday and the Tuesday before Veterans Day stand alone
    expect(unpaired(sectionDates(Z['0204']), HOLIDAYS)).toEqual(['2026-04-01', '2026-11-10']);
  });
  it('none of these sections is swept on a weekend or a City holiday', () => {
    for (const z of Object.values(Z)) for (const d of sectionDates(z)) {
      expect(weekday(d) % 6).not.toBe(0);
      expect(HOLIDAYS[d]).toBeUndefined();
    }
  });
});

describe('holidays', () => {
  it('2026 as the City lists them and 2027 on the same rules, all on weekdays', () => {
    const y26 = Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026')), y27 = Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027'));
    expect(y26).toHaveLength(13);
    expect(y27).toHaveLength(13);
    expect(Object.keys(HOLIDAYS).every((d) => weekday(d) >= 1 && weekday(d) <= 5)).toBe(true);
    expect(HOLIDAYS['2026-07-03']).toBe('Independence Day');      // July 4, 2026 is a Saturday
    expect(HOLIDAYS['2027-07-05']).toBe('Independence Day');      // July 4, 2027 is a Sunday
    expect(HOLIDAYS['2027-12-24']).toBe('Christmas Day');         // December 25, 2027 is a Saturday
    expect(weekday('2027-03-01')).toBe(1);                        // Pulaski Day: the first Monday of March
  });
});

describe('rules', () => {
  it('a street sweeping rule lists dates, 9 AM to 2 PM, ticket only', () => {
    expect(sweepRule(['2026-04-02', '2026-04-01', '2026-04-02'])).toEqual([-1, 9, 14, 0, 0, 0, ['2026-04-01', '2026-04-02']]);
  });
  it('the winter ban: every night 3 to 7 AM, December to March, towed and kept on holidays, plus the April 1 mornings', () => {
    expect(WINTER_MONTHS).toBe(2055);
    const r = winterRules(aprilFirsts('2026-10-18'));
    expect(r).toHaveLength(8);
    expect(r.slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6].map((dow) => [dow, 3, 7, 31, 2055, 3]));
    expect(r[7]).toEqual([-1, 3, 7, 0, 0, 3, ['2027-04-01', '2028-04-01']]);
  });
  it('the April 1 mornings are the coming one and the next', () => {
    expect(aprilFirsts('2026-10-18')).toEqual(['2027-04-01', '2028-04-01']);
    expect(aprilFirsts('2027-03-15')).toEqual(['2027-04-01', '2028-04-01']);
    expect(aprilFirsts('2027-04-01')).toEqual(['2027-04-01', '2028-04-01']);
    expect(aprilFirsts('2027-04-02')).toEqual(['2028-04-01', '2029-04-01']);
  });
  it('merges date list rules with the same window and flags, and keeps weekly rules once', () => {
    const m = mergeRules([sweepRule(['2026-04-01']), sweepRule(['2026-04-02', '2026-04-01']), ...winterRules(['2027-04-01']), ...winterRules(['2027-04-01'])]);
    expect(m[0]).toEqual([-1, 9, 14, 0, 0, 0, ['2026-04-01', '2026-04-02']]);
    expect(m).toHaveLength(1 + 8);
  });
});

describe('placing block sides in ward sections', () => {
  // Two tiny squares side by side (not the City's polygons): A west of x = -87.66, B east of it.
  const sq = (w, e) => ({ type: 'Polygon', coordinates: [[[w, 41.89], [e, 41.89], [e, 41.895], [w, 41.895], [w, 41.89]]] });
  const idx = polygonIndex([{ key: '0101', geometry: sq(-87.665, -87.6608) }, { key: '0102', geometry: sq(-87.6608, -87.655) }]);
  const at = (pt) => idx.at(pt[0], pt[1])[0] || null;
  const dates = (k) => (Z[k] ? sectionDates(Z[k]) : null);

  it('finds the section that holds a point', () => {
    expect(idx.at(-87.662, 41.892)).toEqual(['0101']);
    expect(idx.at(-87.658, 41.892)).toEqual(['0102']);
    expect(idx.at(-87.67, 41.892)).toEqual([]);
  });
  it('samples each side 7 m off the line: on N Ada St (drawn south to north) left is west, right is east', () => {
    const pts = sidePoints(ADA.c);
    expect(pts.L).toHaveLength(3);
    expect(pts.L.every(([lo], i) => lo < pts.R[i][0])).toBe(true);
    expect(compass(ADA.c, 'L')).toBe('West');
    expect(compass(ADA.c, 'R')).toBe('East');
    expect(compass(W82.c, 'L')).toBe('South');   // drawn east to west
  });
  it('a block inside one section: both sides get every date, both days of each pair', () => {
    const shifted = ADA.c.map(([lo, la]) => [lo - 0.002, la]);    // moved into square A
    const pts = sidePoints(shifted);
    const r = placeBlock(pts.L.map(at), pts.R.map(at), true, true, dates);
    expect(r.kind).toBe('inside');
    expect(r.sides.L).toEqual([sweepRule(sectionDates(Z['0101']))]);
    expect(r.sides.R).toEqual(r.sides.L);
    expect(r.sides.L[0][6]).toContain('2026-04-01');
    expect(r.sides.L[0][6]).toContain('2026-04-02');
  });
  it('a street that is the boundary of two sections: each side takes its own section\'s dates', () => {
    const onEdge = ADA.c.map(([, la]) => [-87.6608, la]);
    const pts = sidePoints(onEdge);
    const r = placeBlock(pts.L.map(at), pts.R.map(at), true, true, dates);
    expect(r.kind).toBe('boundary');
    expect([r.L, r.R]).toEqual(['0101', '0102']);
    expect(r.sides.L[0][6]).toEqual(sectionDates(Z['0101']));
    expect(r.sides.R[0][6]).toEqual(sectionDates(Z['0102']));
  });
  it('one side in no section: inside the city it takes the other side\'s section, outside Chicago it is left out', () => {
    expect(resolveSides([null, null, null], ['0101', '0101', '0101'], true, true)).toEqual({ L: '0101', R: '0101', kind: 'edge' });
    expect(resolveSides([null, null, null], ['0101', '0101', '0101'], false, true)).toEqual({ L: null, R: '0101', kind: 'cityLimit' });
    expect(resolveSides([null, null, null], [null, null, null], true, true).kind).toBe('outside');
    const edge = placeBlock([null, null, null], ['0101', '0101', '0101'], true, true, dates);
    expect(edge.sides.L).toEqual(edge.sides.R);
    expect(placeBlock([null, null, null], ['0101', '0101', '0101'], false, true, dates).sides.L).toBeUndefined();
  });
  it('a section boundary across the block gives that side both sections\' dates', () => {
    const r = resolveSides(['0101', '0101', '0101'], ['0101', '0102', '0102'], true, true);
    expect(r).toEqual({ L: '0101', R: '0102', kind: 'boundary' });
    expect(sideSections(['0101', '0101', '0101'], ['0101', '0102', '0102'], r)).toEqual({ L: ['0101'], R: ['0101', '0102'] });
    const p = placeBlock(['0101', '0101', '0101'], ['0101', '0102', '0102'], true, true, dates);
    expect(p.sides.R[0][6]).toEqual([...new Set([...sectionDates(Z['0101']), ...sectionDates(Z['0102'])])].sort());
  });
  it('a section without dates gives no rule (34NA, downtown)', () => {
    const r = placeBlock(['34NA', '34NA', '34NA'], ['34NA', '34NA', '34NA'], true, true, dates);
    expect(r.sides).toEqual({});
    expect(r.noDates).toBe(2);
  });
  it('vote: the most common section, ties to the middle sample', () => {
    expect(vote(['a', 'b', 'b'])).toBe('b');
    expect(vote(['a', 'b', null])).toBe('b');     // a tie goes to the middle sample
    expect(vote(['a', null, 'b'])).toBe('a');     // then to the first
    expect(vote([null, null, null])).toBeNull();
  });
});

describe('which streets are placed', () => {
  it('residential streets are, main streets are not (arterials and collectors have their own posted schedules)', () => {
    expect(classify(ADA.p)).toBe('residential');
    expect(classify(W82.p)).toBe('residential');
    expect(classify(MILWAUKEE)).toBe('mainStreet');    // class 3, collector (a winter ban route)
    expect(classify(FULLERTON)).toBe('mainStreet');    // class 2, arterial
  });
  it('private streets, ramps and unnamed lines are left out', () => {
    expect(classify(WINTHROP_PRIVATE)).toBe('status');
    expect(classify(RAMP)).toBe('otherClass');
    expect(classify(UNNAMED)).toBe('unnamed');
    expect(classify({ ...ADA.p, class: 'E' })).toBe('otherClass');
  });
});

describe('names', () => {
  it('writes streets as signed', () => {
    expect(streetName(ADA.p)).toBe('N Ada St');
    expect(streetName(W82.p)).toBe('W 82nd St');
    expect(streetName({ pre_dir: 'S', street_nam: 'DR MARTIN LUTHER KING JR', street_typ: 'DR' })).toBe('S Dr Martin Luther King Jr Dr');
    expect(streetName(UNNAMED)).toBe('');
    expect(titleCase('MCCLELLAN')).toBe('McClellan');
    expect(titleCase("O'BRIEN")).toBe("O'Brien");
    expect(areaName('OHARE')).toBe("O'Hare");
    expect(areaName('MCKINLEY PARK')).toBe('McKinley Park');
  });
  it('reads the cross street fields', () => {
    expect(crossName('8200|S|MAY|ST|')).toBe('S May St');
    expect(crossName('3927|N|BROADWAY| |')).toBe('N Broadway');
    expect(crossName('||DEAD END||')).toBe('Dead End');
    expect(crossName('1837|N|||')).toBe('');
    expect(crossName('3500|S|DAN RYAN 35TH ST|ER|')).toBe('');   // a ramp: the next real corner is used instead
  });
  it('matches winter routes without the direction', () => {
    expect(coreName('N KEDZIE AVE')).toBe('KEDZIE AVE');
    expect(coreName('103RD ST')).toBe('103RD ST');
    expect(coreName('E MIDWAY PLAISANCE')).toBe('MIDWAY PLAISANCE');
  });
});

describe('geometry', () => {
  it('drops only points on a straight line, and rounds to 6 decimals', () => {
    const g = simplify(ADA.c);
    expect(g.length).toBeLessThan(ADA.c.length);
    expect(Math.abs(lineLength(g) - lineLength(ADA.c))).toBeLessThan(0.05);
    expect(round6([[-87.66077718240223, 41.89104356169731]])).toEqual([[-87.660777, 41.891044]]);
  });
});

// ---- the built file ----------------------------------------------------------------------------------------------------

const BUILT = new URL('../../data/chicago/segments.json', import.meta.url);
describe.skipIf(!fs.existsSync(BUILT))('data/chicago/segments.json', () => {
  const data = fs.existsSync(BUILT) ? JSON.parse(fs.readFileSync(BUILT, 'utf8')) : { b: [] };
  const six = (v) => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-6;
  it('has the meta and a plausible number of blocks', () => {
    expect(data._meta.city).toBe('chicago');
    expect(data._meta.time_zone).toBe('America/Chicago');
    expect(data._meta.season).toEqual({ from: `${YEAR}-04-01`, to: `${YEAR}-11-20` });
    expect(data.b.length).toBeGreaterThan(30000);
    expect(data._meta.blocks).toBe(data.b.length);
  });
  it('every block has an id, a street, a line of 6 decimal coordinates and at least one side', () => {
    const ids = new Set(), bad = [];
    for (const b of data.b) {
      const why = [];
      if (typeof b.c !== 'string' || ids.has(b.c)) why.push('id');
      ids.add(b.c);
      if (typeof b.s !== 'string' || !b.s.trim()) why.push('street');
      if (typeof b.l !== 'string') why.push('cross streets');
      if (!(b.g.length >= 2) || !b.g.every(([lo, la]) => six(lo) && six(la) && lo > -87.95 && lo < -87.5 && la > 41.6 && la < 42.05)) why.push('line');
      if (!b.d.length) why.push('no side');
      if (!Object.keys(b).every((k) => ['c', 's', 'l', 'h', 'n', 'o', 'g', 'd'].includes(k))) why.push('extra field');
      if (why.length) bad.push([b.c, why]);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it('rules are well formed: sweeping dates sorted, in season, never on a weekend or a City holiday', () => {
    const bad = [], from = `${YEAR}-04-01`, to = `${YEAR}-11-20`;
    const dateOk = new Map();
    const okDate = (d) => {
      if (!dateOk.has(d)) dateOk.set(d, d >= from && d <= to && weekday(d) % 6 !== 0 && !HOLIDAYS[d]);
      return dateOk.get(d);
    };
    for (const b of data.b) for (const [side, label, rules] of b.d) {
      if (!['L', 'R'].includes(side) || typeof label !== 'string' || !label) bad.push([b.c, 'side']);
      for (const r of rules) {
        if (r[0] === -1) {
          const ds = r[6];
          let sorted = ds.length > 0;
          for (let i = 1; i < ds.length; i++) if (!(ds[i - 1] < ds[i])) sorted = false;
          if (r.length !== 7 || r[3] !== 0 || r[4] !== 0 || !sorted) bad.push([b.c, 'date list', r.slice(0, 6)]);
          if (r[1] === 9) {
            if (r.slice(0, 6).join() !== '-1,9,14,0,0,0' || !ds.every(okDate)) bad.push([b.c, 'sweeping', ds.filter((d) => !okDate(d))]);
          } else if (r.slice(0, 6).join() !== '-1,3,7,0,0,3' || !ds.every((d) => d.endsWith('-04-01'))) bad.push([b.c, 'winter dates']);
        } else if (r.length !== 6 || r.slice(1).join() !== '3,7,31,2055,3' || !(r[0] >= 0 && r[0] <= 6)) bad.push([b.c, 'weekly', r]);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
  it('a swept block lists the same dates on both sides unless it is a section boundary', () => {
    let same = 0, two = 0;
    for (const b of data.b) {
      const sw = b.d.map(([, , rules]) => rules.find((r) => r[1] === 9)).filter(Boolean);
      if (sw.length !== 2) continue;
      two++;
      if (sw[0][6].join() === sw[1][6].join()) same++;
    }
    expect(same / two).toBeGreaterThan(0.85);
  });
});
