// Somerville's build (scripts/cities/somerville.mjs): the City's section pages, their days and stretches, and the data
// it writes. The page fixtures are two real pages (nodes 26577 and 26443, read 2026-10-18), cut to their article.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseSection, parseHours, parseSchedule, parseStretch, streetKey, baseName, sideOfPoint, compass, MONTHS, NIGHT_ENDS } from './somerville.mjs';

const field = (name, label, value) => `
  <div  data-component-id="radix:field" class="field field--name-${name} field--type-list-string field--label-above field--item">
    <div  class="field__label">${label}</div>
          <div  class="field__item">${value}</div>
      </div>`;
const page = (node, about, body, street, suffix, side, day, hours, list) => `<html><body><main>
<article  data-history-node-id="${node}" about="${about}" data-component-id="radix:node" class="node street-sweeping-section street-sweeping-section--full node--full node--street-sweeping-section--full view-mode--full">
  <div  class="node__content">
            <div  data-component-id="radix:field" class="field field--name-body field--type-text-with-summary field--label-hidden field--item"><p>${body}</p>
</div>${field('field-street-name', 'Street Name', street)}${field('field-street-suffix', 'Street Suffix', suffix)}${field('field-sweeping-side', 'Sweeping side', side)}${field('field-sweeping-day', 'Sweeping Day', day)}${field('field-sweeping-hours', 'Sweeping hours', hours)}${field('field-mailing-list', 'Mailing List', list)}
      </div>
</article></main></body></html>`;
const EVERGREEN = page(26577, '/content/evergreen-avenue-odd-side-1st-and-3rd-friday', 'from School St to Marshall St', 'Evergreen', 'Avenue', 'odd', '1st and 3rd Friday', '8 a.m. - 12 p.m.', 'fri_odd');
const HIGHLAND = page(26443, '/content/street-sweeping-section', 'High School Concourse', 'Highland', 'Avenue', 'either', 'Saturday Night', '12 a.m. - 7:30 a.m.', 'sat_night');

describe('section pages', () => {
  it('reads a street side with its stretch', () => {
    expect(parseSection(EVERGREEN, 26577)).toEqual({ node: 26577, street: 'Evergreen', suffix: 'Avenue', stretch: 'from School St to Marshall St',
      side: 'odd', day: '1st and 3rd Friday', hours: '8 a.m. - 12 p.m.' });
  });
  it('reads a night page for both sides', () => {
    expect(parseSection(HIGHLAND, 26443)).toMatchObject({ street: 'Highland', side: 'either', day: 'Saturday Night', hours: '12 a.m. - 7:30 a.m.', stretch: 'High School Concourse' });
  });
  it('is null for other pages (a resident address node) and fails when a section lost a field', () => {
    expect(parseSection('<article data-history-node-id="27391" class="node resident-address">…</article>', 27391)).toBeNull();
    expect(() => parseSection(EVERGREEN.replace(/field--name-field-sweeping-day/, 'field--name-field-something'), 26577)).toThrow(/sweeping-day/);
  });
});

describe('days and hours', () => {
  it('reads the hours', () => {
    expect(parseHours('8 a.m. - 12 p.m.')).toEqual([8, 12]);
    expect(parseHours('12 a.m. - 6 a.m.')).toEqual([0, 6]);
    expect(parseHours('12 a.m. - 7:30 a.m.')).toEqual([0, '7:30']);
    expect(parseHours('noon')).toBeNull();
  });
  it('the 1st and 3rd are the odd side, the 2nd and 4th the even side, April to December, towable', () => {
    expect(parseSchedule('1st and 3rd Friday', '8 a.m. - 12 p.m.', 'odd')).toEqual({ kind: 'day', side: 'odd', sideOnPage: 'odd', rule: [5, 8, 12, 5, 4088, 2] });
    expect(parseSchedule('2nd and 4th Monday', '8 a.m. - 12 p.m.', 'even').rule).toEqual([1, 8, 12, 10, MONTHS, 2]);
    expect(MONTHS).toBe(4088);
  });
  it('the weeks win over a page side that contradicts them (McGrath Highway, node 26352)', () => {
    expect(parseSchedule('2nd and 4th Tuesday', '8 a.m. - 12 p.m.', 'odd')).toMatchObject({ side: 'even', sideOnPage: 'odd', rule: [2, 8, 12, 10, 4088, 2] });
  });
  it('night sweeps are every week on the named weekday from midnight', () => {
    expect(parseSchedule('Wednesday Night', '12 a.m. - 6 a.m.', 'odd')).toEqual({ kind: 'night', side: 'odd', sideOnPage: 'odd', rule: [3, 0, 6, 31, 4088, 2] });
    expect(parseSchedule('Saturday Night', '12 a.m. - 7:30 a.m.', 'either')).toMatchObject({ side: 'both', rule: [6, 0, '7:30', 31, 4088, 2] });
    expect(parseSchedule('Wednesday', '12 a.m. - 6 a.m.', 'even')).toMatchObject({ kind: 'night', rule: [3, 0, 6, 31, 4088, 2] });   // College Ave
    expect(parseSchedule('Every day', '8 a.m. - 12 p.m.', 'odd')).toBeNull();
    expect(NIGHT_ENDS).toEqual({ BROADWAY: 8 });
  });
});

describe('stretches', () => {
  it('reads "from X to Y" in its spellings', () => {
    expect(parseStretch('from School St to Marshall St', 'odd')).toEqual({ from: 'School St', to: 'Marshall St' });
    expect(parseStretch('Greenville St to Somerville Ave.', 'odd')).toEqual({ from: 'Greenville St', to: 'Somerville Ave' });
    expect(parseStretch('Short end- Mt Vernon to Crescent Sts', 'even')).toEqual({ from: 'Mt Vernon', to: 'Crescent St' });
    expect(parseStretch('from Medford St. to R.R. bridge', 'odd')).toEqual({ from: 'Medford St', to: 'R.R. bridge' });
  });
  it('reads street ends, squares and whole streets', () => {
    expect(parseStretch('Taylor St. end', 'odd')).toEqual({ end: 'Taylor St' });
    expect(parseStretch('Union Sq.', 'either')).toEqual({ square: ['Union Sq'] });
    expect(parseStretch('Magoun Sq., Ball Sq., Teele Sq.', 'either')).toEqual({ square: ['Magoun Sq', 'Ball Sq', 'Teele Sq'] });
    for (const t of ['', '(excluding meters)', '(paved street)', 'Somerville side of street', 'Mall Area', 'under 93', 'to city line'])
      expect(parseStretch(t, 'odd')).toEqual({ whole: true });
    expect(parseStretch('at Medford city line', 'odd')).toEqual({ atCityLine: true });
  });
  it('leaves out a side where parking is banned anyway, and stretches it cannot place', () => {
    expect(parseStretch('No Parking either side', 'odd').skip).toMatch(/no parking/);
    expect(parseStretch('Odd side No Parking anytime', 'odd').skip).toMatch(/no parking/);
    expect(parseStretch('Odd side No Parking anytime', 'even')).toEqual({ whole: true });
    expect(parseStretch('Parking allowed on the Odd Side only', 'even').skip).toMatch(/no parking/);
    expect(parseStretch('Posted No Parking Anytime on the even side', 'odd')).toEqual({ whole: true });
    expect(parseStretch('High School Concourse', 'either').skip).toMatch(/not understood/);
  });
});

describe('names and geometry', () => {
  it('spells a street one way', () => {
    expect(streetKey('Mt. Vernon Street')).toBe('MOUNT VERNON ST');
    expect(streetKey('MOUNT VERNON STREET')).toBe('MOUNT VERNON ST');
    expect(streetKey('Sommerville Avenue')).toBe('SOMERVILLE AVE');
    expect(streetKey('Lombardi Street')).toBe('A ALFRED LOMBARDI ST');
    expect(streetKey('Broadway')).toBe('BROADWAY');
    expect(baseName('POWDER HOUSE BLVD')).toBe('POWDER HOUSE');
  });
  it('L is the left looking from the first point to the last', () => {
    const westToEast = [[-71.11, 42.39], [-71.10, 42.39]];
    expect(sideOfPoint(westToEast, [-71.105, 42.3902]).side).toBe('L');           // a point north of an eastward line
    expect(sideOfPoint(westToEast, [-71.105, 42.3898]).side).toBe('R');
    expect(compass(westToEast, 'L')).toBe('North');
    expect(compass(westToEast, 'R')).toBe('South');
    expect(compass([[-71.10, 42.39], [-71.10, 42.40]], 'L')).toBe('West');      // walking north, left is west
  });
});

// The data the build wrote, when it is there: the spec's shape (docs/multi-city/city-build.md).
const SEG = fileURLToPath(new URL('../../data/somerville/segments.json', import.meta.url));
describe.skipIf(!fs.existsSync(SEG))('data/somerville/segments.json', () => {
  const data = fs.existsSync(SEG) ? JSON.parse(fs.readFileSync(SEG, 'utf8')) : { b: [] };
  it('has every block with c, s, l, g and sides with rules', () => {
    expect(data.b.length).toBeGreaterThan(1500);
    const hour = (v) => (Number.isInteger(v) && v >= 0 && v <= 24) || /^\d{1,2}:\d\d$/.test(v);
    for (const b of data.b) {
      expect(!!(typeof b.c === 'string' && b.c && typeof b.s === 'string' && b.s && typeof b.l === 'string' && b.l)).toBe(true);
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      for (const p of b.g) for (const v of p) expect(String(v).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
      expect(b.d.length).toBeGreaterThan(0);
      for (const [side, label, rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        expect(label).toMatch(/^(North|South|East|West|Northeast|Northwest|Southeast|Southwest)$/);
        expect(rules.length).toBeGreaterThan(0);
        for (const [dow, from, to, weeks, months, flags] of rules) {
          expect(dow >= 0 && dow <= 6 && hour(from) && hour(to) && [5, 10, 31].includes(weeks) && months === 4088 && flags === 2).toBe(true);
        }
      }
    }
    expect(new Set(data.b.map((b) => b.c)).size).toBe(data.b.length);
  });
});
