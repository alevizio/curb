// Hoboken's build (scripts/cities/hoboken.mjs): parsing the Hoboken Code's alternate side parking schedule (§ 190-28)
// and the City's schedule page, placing rows on real segments of the City's "Hoboken Streets" layer, then a check of
// the committed data/hoboken/ files. Segments copied from the layer on 2026-10-18 (coordinates to 7 decimals).
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  streetName, parseWhen, parseLocation, parseRow, codeRows, pageRows, sideFacing, compass4, segmentsOf, stretch, lineOf, HOLIDAYS, SET_ASIDE,
} from './hoboken.mjs';

const f = (FID, FULLNAME, coordinates, values = {}, multi = false) => ({ properties: { FID, FULLNAME, ...values },
  geometry: { type: multi ? 'MultiLineString' : 'LineString', coordinates } });
const HARRISON = [
  f(6, 'Harrison St', [[-74.0415802, 40.7406872], [-74.0411939, 40.74196]], { STREETCLEANINGE: 'Thursday - 2 pm to 3 pm', STREETCLEANINGW: 'Friday - 2 pm to 3 pm' }),
  f(23, 'Harrison St', [[-74.0401339, 40.7454242], [-74.0398913, 40.7462545]]),
  f(112, 'Harrison St', [[-74.0429276, 40.7362834], [-74.0425144, 40.7376039]]),
  f(114, 'Harrison St', [[-74.0425144, 40.7376039], [-74.0422, 40.7386997]]),
  f(121, 'Harrison St', [[-74.0422, 40.7386997], [-74.0419844, 40.7394008]]),
  f(186, 'Harrison St', [[-74.0419844, 40.7394008], [-74.0415802, 40.7406872]]),
  f(187, 'Harrison St', [[-74.0411939, 40.74196], [-74.0409962, 40.7425861]]),
  f(188, 'Harrison St', [[-74.0409962, 40.7425861], [-74.0407986, 40.7432259]]),
];
const FIFTH = [f(249, '5th St', [[-74.0410861, 40.7443149], [-74.0413466, 40.7443625]]), f(250, '5th St', [[-74.0395859, 40.7440018], [-74.0410861, 40.7443149]])];
const SIXTH = [f(33, '6th St', [[-74.0391996, 40.7452609], [-74.0401339, 40.7454242]]), f(307, '6th St', [[-74.0401339, 40.7454242], [-74.0405471, 40.7454991]])];
const FIFTEENTH = [
  f(31, '15th St', [[-74.0292822, 40.7550877], [-74.0302614, 40.755217]]), f(47, '15th St', [[-74.0284108, 40.7549244], [-74.0292822, 40.7550877]]),
  f(71, '15th St', [[-74.0246649, 40.7542031], [-74.0257518, 40.7544004]]), f(495, '15th St', [[-74.0330731, 40.7557138], [-74.0339984, 40.7558703]]),
  f(497, '15th St', [[-74.0321389, 40.7555436], [-74.0330731, 40.7557138]]), f(499, '15th St', [[-74.0311956, 40.7553871], [-74.0321389, 40.7555436]]),
  f(501, '15th St', [[-74.0302614, 40.755217], [-74.0311956, 40.7553871]]), f(506, '15th St', [[-74.0274946, 40.7547475], [-74.0284108, 40.7549244]]),
  f(507, '15th St', [[-74.0265603, 40.7545774], [-74.0274946, 40.7547475]]), f(508, '15th St', [[-74.0257518, 40.7544004], [-74.0265603, 40.7545774]]),
  f(509, '15th St', [[-74.024081, 40.7540806], [-74.0246649, 40.7542031]]),
];
const SINATRA_N = [f(48, 'Sinatra Dr N', [[-74.0241528, 40.7538084], [-74.0232994, 40.7536179], [-74.023506, 40.7527741]])];
const PARK = [f(505, 'Park Ave', [[-74.0287792, 40.7537131], [-74.0284108, 40.7549244]]), f(511, 'Park Ave', [[-74.0284108, 40.7549244], [-74.0280515, 40.7561425]])];
const WASHINGTON = f(341, 'Washington St', [[-74.0286893, 40.7447572], [-74.0282941, 40.7460163]],
  { STREETCLEANINGE: 'Monday through Friday - 8 am to 9 am', STREETCLEANINGW: 'Monday through Friday - 8 am to 9 am' });
const UNNAMED = f(524, null, [[-74.0337918, 40.7533389], [-74.0341601, 40.7521276]], { STREETCLEANINGE: 'Thursday - 10 am to 11 am', STREETCLEANINGW: 'Friday - 10 am to 11 am' });
const BROKEN = f(58, 'Marshall St', [[[-74.0425234, 40.7408438], [-74.0424425, 40.7410684]], [[-74.0423168, 40.7414903], [-74.0423347, 40.741749]]], {}, true);
const bySt = (...features) => {
  const m = new Map();
  for (const s of segmentsOf(features)) { if (!m.has(s.name)) m.set(s.name, []); m.get(s.name).push(s); }
  return m;
};

describe('reading the schedule', () => {
  it('writes the Code\'s street names as the layer does', () => {
    expect(streetName('Fifteenth Street')).toBe('15th St');
    expect(streetName('Eight Street')).toBe('8th St');           // the Code's typo for Eighth
    expect(streetName('Observer Hwy.')).toBe('Observer Hwy');
    expect(streetName('Sinatra Drive North')).toBe('Sinatra Dr N');
    expect(streetName('Castle Point Terrace')).toBe('Castle Point Ter');
    expect(streetName('Washington Street*')).toBe('Washington St');
  });
  it('reads days and hours in the Code\'s, the page\'s and the layer\'s wordings', () => {
    expect(parseWhen('Monday/ 11:00 a.m. to 12:00 noon')).toEqual({ days: [1], from: 11, to: 12 });
    expect(parseWhen('Tuesday/ 11:00 am. to 12:00 noon')).toEqual({ days: [2], from: 11, to: 12 });
    expect(parseWhen('Wednesday/ 1:00 p.m. to 2:00 p.m.')).toEqual({ days: [3], from: 13, to: 14 });
    expect(parseWhen('9:00 a.m. to 10:00 a.m. Monday through Friday')).toEqual({ days: [1, 2, 3, 4, 5], from: 9, to: 10 });
    expect(parseWhen('Monday, Tuesday, Wednesday, Thursday, Friday/8:00 a.m. to 9:00 a.m.').days).toEqual([1, 2, 3, 4, 5]);
    expect(parseWhen('Monday- 2pm to 3pm')).toEqual({ days: [1], from: 14, to: 15 });
    expect(parseWhen('Monday-Friday - 8 am to 9 am').days).toEqual([1, 2, 3, 4, 5]);
    expect(parseWhen('')).toBeNull();
  });
  it('reads every kind of stretch the Code uses', () => {
    expect(parseLocation('Newark Street to Sixteenth Street')).toEqual([['Newark Street', 'Sixteenth Street']]);
    expect(parseLocation('Eighth Street and Tenth Street')).toEqual([['Eighth Street', 'Tenth Street']]);
    expect(parseLocation('Between Newark Street and Seventh Street')).toEqual([['Newark Street', 'Seventh Street']]);
    expect(parseLocation('Observer Highway to Seventh Street, Eighth Street to north boundary'))
      .toEqual([['Observer Highway', 'Seventh Street'], ['Eighth Street', 'north boundary']]);
    expect(parseLocation('Southerly curbline of Fifteenth Street to the northerly curbline of Eight Street')).toEqual([['Fifteenth Street', 'Eight Street']]);
    expect(parseLocation('Newark Street to the south boundary')).toEqual([['Newark Street', 'south boundary']]);
  });
  it('parses all 118 rows of § 190-28, and sets one aside with its reason', () => {
    const rows = codeRows();
    expect(rows).toHaveLength(118);
    expect(rows.every((r) => r.ok && r.side && r.stretches.length)).toBe(true);
    expect(rows.filter((r) => SET_ASIDE[r.key]).map((r) => r.key)).toEqual(['Washington Street|West|Between Newark Street and Seventh Street']);
    expect(parseRow('Grove Street|Both|Monday/ 1:00 p.m. to 2:00 p.m.|Newark Street to the south boundary')).toMatchObject({ street: 'Grove St', side: 'B', days: [1], from: 13, to: 14 });
  });
  it('reads the City\'s page table once per row (each row is in the page twice)', () => {
    const cell = (t) => `<div class="table-content bottom"><a href="#" class="w-inline-block"><div>${t}</div></a></div>`;
    const item = (cells) => `<div role="listitem" class="w-dyn-item"><div class="table_wrapper w-condition-invisible">${cells.map((t) => `<div class="table-content"><h4>${t}</h4></div>`).join('')}</div><div class="table_wrapper">${cells.map(cell).join('')}</div></div>`;
    const html = `${cell('Street')}${cell('Side')}${cell('Days &amp; Hours')}${cell('Location')}`
      + item(['Adams St.', 'West', 'Monday - 11 am to 12 noon', 'Newark St. to Sixteenth St.'])
      + item(['Adams St.', 'East', 'Tuesday - 11 am to 12 noon', 'Newark St. to Sixteenth St.'])
      + '<h5 class="footer-title">CONTACT INFORMATION</h5>';
    expect(pageRows(html)).toEqual([
      { street: 'Adams St.', side: 'West', when: 'Monday - 11 am to 12 noon', location: 'Newark St. to Sixteenth St.' },
      { street: 'Adams St.', side: 'East', when: 'Tuesday - 11 am to 12 noon', location: 'Newark St. to Sixteenth St.' },
    ]);
  });
});

describe('placing it on the City\'s street lines', () => {
  it('finds the East and West sides of Washington St whichever way the line runs', () => {
    const c = WASHINGTON.geometry.coordinates;   // drawn northward
    expect(sideFacing(c, 'E').side).toBe('R');
    expect(sideFacing(c, 'W').side).toBe('L');
    expect([compass4(c, 'L'), compass4(c, 'R')]).toEqual(['West', 'East']);
  });
  it('names the unnamed Jefferson St segment, and drops a line whose parts do not join', () => {
    expect(segmentsOf([UNNAMED])[0].name).toBe('Jefferson St');
    expect(lineOf(BROKEN.geometry)).toBeNull();
    expect(segmentsOf([BROKEN])).toEqual([]);
  });
  it('puts Harrison St\'s "Fifth Street to the northern boundary" on the block north of 6th St only (5th St never meets it)', () => {
    const r = stretch('Harrison St', ['Fifth Street', 'northern boundary'], bySt(...HARRISON, ...FIFTH, ...SIXTH));
    expect(r.segs.map((s) => s.id)).toEqual(['23']);
    expect(r.notes[0]).toMatch(/crosses/);
  });
  it('puts 15th St\'s "Sinatra Drive to Park Avenue" east of Park Ave (Sinatra Dr N stops short of 15th St)', () => {
    const r = stretch('15th St', ['Sinatra Drive', 'Park Avenue'], bySt(...FIFTEENTH, ...SINATRA_N, ...PARK));
    expect(r.segs.map((s) => s.id).sort()).toEqual(['506', '507', '508', '509', '71']);
    const west = stretch('15th St', ['Park Avenue', 'Madison Street'], bySt(...FIFTEENTH, ...PARK));
    expect(west.segs.map((s) => s.id).sort()).toEqual(['31', '47', '495', '497', '499', '501']);   // no Madison St here: the street's west end
  });
  it('has the City\'s 2026 holidays and a 2027 by the same rule', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d < '2027')).toHaveLength(15);
    expect(HOLIDAYS['2026-11-03']).toBe('Election Day');
    expect(HOLIDAYS['2027-11-02']).toBe('Election Day');
  });
});

describe('the committed data', () => {
  const read = (n) => JSON.parse(fs.readFileSync(new URL(`../../data/hoboken/${n}`, import.meta.url), 'utf8'));
  const segs = read('segments.json'), city = read('city.json'), report = read('report.json');
  const block = (c) => segs.b.find((b) => b.c === c);
  const side = (c, label) => block(c).d.find((x) => x[1] === label)[2];
  const weekdays = (from, to) => [1, 2, 3, 4, 5].map((d) => [d, from, to, 31, 0, 0]);
  it('follows the Code where the 2019 layer is older', () => {
    expect(side('341', 'East')).toEqual(weekdays(9, 10));       // Washington St, 7th to 8th St: 9 to 10 AM since 2019 (B-105)
    expect(side('341', 'West')).toEqual(weekdays(8, 9));
    expect(side('364', 'North')).toEqual([[5, 15, 16, 31, 0, 0]]);   // 9th St west of Willow: sides swapped in 2021 (B-371)
    expect(side('364', 'South')).toEqual([[3, 15, 16, 31, 0, 0]]);
    expect(side('153', 'West')).toEqual([[1, 10, 11, 31, 0, 0]]);    // Sinatra Dr south of 4th St: West side since 2020 (B-292)
    expect(block('153').d).toHaveLength(1);
    expect(block('23').d).toEqual([['R', 'East', [[1, 15, 16, 31, 0, 0]]]]);   // Harrison St north of 6th St (Z-67, 2010)
  });
  it('shows the Code\'s names: Henderson St and River Terrace', () => {
    expect(block('27')).toMatchObject({ s: 'Henderson St', l: 'Newark St' });
    expect(block('27').d.map((x) => x[2])).toEqual([[[1, 13, 14, 31, 0, 0]], [[1, 13, 14, 31, 0, 0]]]);
    expect(block('13')).toMatchObject({ s: 'River Ter', l: '5th St - 6th St' });
    expect(side('13', 'East')).toEqual([[3, 11, 12, 31, 0, 0]]);
    expect(block('524')).toMatchObject({ s: 'Jefferson St', l: '13th St - 12th St' });
  });
  it('has valid blocks and rules, all year', () => {
    expect(new Set(segs.b.map((b) => b.c)).size).toBe(segs.b.length);
    for (const b of segs.b) for (const [s, label, rules] of b.d) {
      expect(['L', 'R']).toContain(s);
      expect(['North', 'South', 'East', 'West']).toContain(label);
      for (const [dow, from, to, weeks, months, flags] of rules) {
        expect([1, 2, 3, 4, 5]).toContain(dow);
        expect(to - from).toBe(1);
        expect([weeks, months, flags]).toEqual([31, 0, 0]);
      }
    }
  });
  it('writes city.json as the page expects, and agrees with report.json', () => {
    for (const k of ['id', 'name', 'region', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidaysSource', 'holidayRule', 'fine', 'tow',
      'fineSource', 'agency', 'scheduleUrl', 'sources', 'words']) expect(city).toHaveProperty(k);
    expect(city).toMatchObject({ id: 'hoboken', tz: 'America/New_York', holidayRule: 'all', fine: '$50', tow: 'sometimes' });
    const [[s, w], [n, e]] = city.bounds;
    for (const b of segs.b) for (const [lo, la] of b.g) expect(la >= s && la <= n && lo >= w && lo <= e).toBe(true);
    expect(JSON.stringify(city.words)).not.toMatch(/[—–]/);
    expect(city.holidays).toEqual(HOLIDAYS);
    expect(report.output.blocks).toBe(segs.b.length);
    expect(report.codeRows.applied + report.codeRows.setAside.length).toBe(118);
    expect(report.codeRows.notApplied).toEqual([]);
  });
});
