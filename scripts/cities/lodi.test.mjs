// Lodi's build (scripts/cities/lodi.mjs): reading the Borough Code's Schedule II (§ 560-38, "No Parking Certain Hours"),
// placing its rows on the State's street centerlines, then a check of the committed data/lodi/ files. The street lines
// in the placing tests are a made-up grid (Oak St crossed by five avenues, Loop Dr with a circle), not Lodi's.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  LODI, CODE_URL, norm, parseWhen, parseLimit, parseRow, codeRows, whyNot, segmentsOf, axisOf, ringOf, piecesOf, stretch, sideOf, ringSide, applyCode,
} from './lodi.mjs';

const P = (i, j) => [-74.09 + i * 0.001, 40.88 + j * 0.001];   // about 84 m a step east, 111 m a step north
const f = (id, name, coordinates, own = 'LR', cls = 'S1400') => ({
  properties: { RCL_NGUID: id, LST_PNAME: name.toUpperCase(), INCMUNI_L: own.includes('L') ? LODI : '882308', INCMUNI_R: own.includes('R') ? LODI : '882308', ROADCLASS: cls },
  geometry: { type: 'LineString', coordinates } });
const oak = (n, own, cls) => f(`oak-${n}`, 'Oak St', [P(n - 1, 0), P(n, 0)], own, cls);   // oak-1 … oak-4, west to east
const OAK = [1, 2, 3, 4].map((n) => oak(n));
const AVENUES = ['Ash', 'Birch', 'Cedar', 'Dogwood', 'Elm'].map((name, i) => f(`${name.toLowerCase()}-1`, `${name} Ave`, [P(i, -1), P(i, 1)]));
const FIR = f('fir-1', 'Fir Ave', [P(3, 0.3), P(3, 1)]);          // stops 33 m short of Oak St
const KIMMIG = f('kimmig-1', 'Kimmig Ave', [P(20, 5), P(20, 6)]);  // the name exists, a mile away
const LOOP = [
  f('loop-stem', 'Loop Dr', [P(10, 0), P(10, 1)]),
  f('loop-1', 'Loop Dr', [P(10, 1), P(10.5, 1.5)]), f('loop-2', 'Loop Dr', [P(10.5, 1.5), P(10, 2)]),
  f('loop-3', 'Loop Dr', [P(10, 2), P(9.5, 1.5)]), f('loop-4', 'Loop Dr', [P(9.5, 1.5), P(10, 1)]),
];
const PINE = f('pine-1', 'Pine Ave', [P(9, 0), P(11, 0)]);
const GRID = [...OAK, ...AVENUES, FIR, KIMMIG, ...LOOP, PINE];
const byName = (features) => {
  const m = new Map();
  for (const s of segmentsOf(features)) { if (!m.has(s.name)) m.set(s.name, []); m.get(s.name).push(s); }
  return m;
};
const ids = (segs) => segs.map((s) => s.id);
const row = (key) => codeRows().find((r) => r.key.startsWith(key));

describe('reading the schedule', () => {
  it('writes the Code\'s street names as the State\'s layer does', () => {
    expect(norm('South Main Street')).toBe('S Main St');
    expect(norm('St. Joseph Boulevard')).toBe('Saint Joseph Blvd');
    expect(norm('First Street')).toBe('1st St');
    expect(norm('Route No. 46')).toBe('Us Hwy 46');
    expect(norm('East Place')).toBe('East Pl');                  // a name, not a direction
    expect(norm('West Street')).toBe('West St');
    expect(norm('Arlene Grove')).toBe('Arlene Grv');
    expect(norm('Longvalley Road')).toBe('Long Valley Rd');
    expect(norm('Vreeland Avenue')).toBe('Vreeland St');         // the layer's type for the Code's street
    expect(norm('Jefferson Street')).toBe('Jefferson Ave');
    expect(norm('Park Avenue [Amended 5-21-2019 by Ord. No. 2019-10]')).toBe('Park Ave');
  });
  it('reads a weekly window, and nothing else', () => {
    expect(parseWhen('12:00 p.m. to 1:00 p.m., Friday')).toEqual({ days: [5], from: 12, to: 13 });
    expect(parseWhen('9:00 a.m. to 3:00 p.m., Monday through Friday')).toEqual({ days: [1, 2, 3, 4, 5], from: 9, to: 15 });
    expect(parseWhen('8:30 a.m. to 10:00 a.m., Tuesday')).toEqual({ days: [2], from: '8:30', to: 10 });
    expect(parseWhen('3:00 p.m. to 9:00 a.m., Monday')).toBeNull();        // overnight: not a sweeping window
    expect(parseWhen('9:00 a.m., Monday')).toBeNull();
    expect(parseWhen('9:00 a.m. to 3:00 p.m.')).toBeNull();                // no day
    expect(parseWhen('9:00 a.m. to 3:00 p.m., Monday and Thursday')).toBeNull();
  });
  it('reads a limit: a cross street, a distance from one, the terminus, the circle', () => {
    expect(parseLimit('the terminus')).toEqual({ end: true });
    expect(parseLimit('Circle')).toEqual({ circle: true });
    expect(parseLimit('a point 118 feet north of Union Street')).toEqual({ name: 'Union St', feet: 118, dir: 'N' });
    expect(parseLimit('westerly prolongation of Lincoln Place')).toEqual({ name: 'Lincoln Pl' });
    expect(parseLimit('easterly sideline of Prospect Street')).toEqual({ name: 'Prospect St' });
    expect(parseLimit('Route No. 46')).toEqual({ name: 'Us Hwy 46' });
    expect(parseLimit('St. Joseph\'s Plaza')).toEqual({ name: 'St Joseph\'s Plz' });
  });
  it('reads every row of the schedule once', () => {
    const rows = codeRows(), count = (side) => rows.filter((r) => r.side === side).length;
    expect(rows).toHaveLength(338);
    expect(new Set(rows.map((r) => r.key)).size).toBe(338);
    expect(['N', 'S', 'E', 'W', 'B', 'I', 'O'].map(count)).toEqual([71, 75, 87, 92, 11, 1, 1]);
    expect(rows.filter((r) => r.note)).toHaveLength(49);
    expect(rows.filter((r) => !whyNot(r))).toHaveLength(306);
  });
  it('reads a row: street, side, window, stretch, and the amendment note', () => {
    expect(row('Autumn Street|South')).toMatchObject({ street: 'Autumn St', side: 'S', time: { days: [4], from: 11, to: 12 }, stretches: [{ whole: true }],
      note: 'Amended 11-12-1991 by Ord. No. 192-8' });
    expect(row('Hancock Street|East').stretches).toEqual([{ from: { name: 'Trudy Dr' }, to: { end: true, dir: 'N' } }]);
    expect(row('South Main Street|West')).toMatchObject({ street: 'S Main St', stretches: [{ from: { name: 'Lincoln Pl' }, to: { name: 'Terrace Ave' } }] });
    expect(row('Barbara Court|Both')).toMatchObject({ side: 'B', stretches: [{ whole: true }] });
    expect(row('Massey Street|East').stretches).toEqual([{ from: { name: 'Union St' }, to: { name: 'Union St', feet: 118, dir: 'N' } }]);
    expect(parseRow('Oak Street|North|9:00 a.m. to 3:00 p.m., Monday|From 400 feet east of Main Street to Massey Street').stretches)
      .toEqual([{ from: { name: 'Main St', feet: 400, dir: 'E' }, to: { name: 'Massey St' } }]);
  });
  it('reads a row with two stretches, and the circle at the end of Marion Pepe Drive', () => {
    expect(row('Charles Street|South|9:00 a.m. to 3:00 p.m., Wednesday').stretches).toEqual([
      { from: { name: 'Passaic St' }, to: { name: 'Westervelt Pl' } }, { from: { name: 'Westminster Pl' }, to: { name: 'Harrison Ave' } }]);
    expect(row('Charles Street|South|9:00 a.m. to 10:00 a.m. Wednesday').time).toEqual({ days: [3], from: 9, to: 10 });   // the block between them
    expect(row('Marion Pepe Drive|East')).toMatchObject({ time: { days: [1] }, stretches: [{ from: { name: 'Terhune Ave' }, to: { circle: true } }] });
    expect(row('Marion Pepe Drive|Inner Circle')).toMatchObject({ side: 'I', time: { days: [1] } });
    expect(row('Marion Pepe Drive|Outer Circle')).toMatchObject({ side: 'O', time: { days: [4] } });
  });
  it('sets aside what is not a weekly sweeping window, saying why', () => {
    expect(whyNot(row('Liberty Street|North|All; except'))).toMatch(/^reads "All" with an exception/);
    expect(row('Davis Drive|West|All/All, except Tuesday')).toMatchObject({ time: null, stretches: [{ from: { name: 'Saint Joseph Blvd' }, to: { name: 'Union St' } }] });
    expect(whyNot(row('Woodside Avenue|West|7:30 a.m.'))).toMatch(/^weekday hours with exceptions/);
    expect(whyNot(row('St. Joseph\'s Plaza|East'))).toBe('location unreadable');
    expect(whyNot(row('Autumn Street|South'))).toBe('');
    const why = {};
    for (const r of codeRows()) { const w = whyNot(r).split(/[:(]/)[0].trim(); if (w) why[w] = (why[w] || 0) + 1; }
    expect(why).toEqual({ 'reads "All" with an exception': 21, 'the hours or the day are blank in the Code': 4, 'weekday hours with exceptions': 4, 'location unreadable': 3 });
  });
});

describe('placing it on the State\'s street lines', () => {
  const names = byName(GRID), street = names.get('Oak St'), loop = names.get('Loop Dr');
  const between = (from, to) => stretch(street, { from, to }, names);
  it('takes the blocks whose middle lies between two cross streets', () => {
    expect(ids(between({ name: 'Birch Ave' }, { name: 'Dogwood Ave' }).segs)).toEqual(['oak-2', 'oak-3']);
    expect(ids(between({ name: 'Dogwood Ave' }, { name: 'Birch Ave' }).segs)).toEqual(['oak-2', 'oak-3']);   // either order
    expect(stretch(street, { whole: true }, names)).toEqual({ segs: street, notes: [] });
  });
  it('places a street that stops short at its nearest point, and says so', () => {
    const r = between({ name: 'Birch Ave' }, { name: 'Fir Ave' });
    expect(ids(r.segs)).toEqual(['oak-2', 'oak-3']);
    expect(r.notes).toEqual([expect.stringMatching(/^Fir Ave does not meet the street in the layer: placed at its nearest point \(3\d m away\)$/)]);
  });
  it('reads a wrong street type as the one street of that name that crosses', () => {
    const r = between({ name: 'Birch Ave' }, { name: 'Elm St' });
    expect(ids(r.segs)).toEqual(['oak-2', 'oak-3', 'oak-4']);
    expect(r.notes).toEqual(['Elm St is not on the street in the layer: read as Elm Ave, the one Elm that meets it']);
  });
  it('leaves the stretch out when a limit cannot be placed, never reading it as the street\'s end', () => {
    const far = between({ name: 'Birch Ave' }, { name: 'Kimmig Ave' });
    expect(far).toMatchObject({ segs: [], error: 'a limit could not be placed: the stretch is not shown' });
    expect(far.notes).toEqual(['Kimmig Ave is nowhere near the street in the State\'s layer']);
    expect(between({ name: 'Birch Ave' }, { name: 'Nowhere Rd' })).toMatchObject({ segs: [], notes: ['Nowhere Rd is not in the State\'s layer'] });
  });
  it('measures feet along the street, only when the street runs that way', () => {
    const east = between({ name: 'Ash Ave', feet: 200, dir: 'E' }, { name: 'Elm Ave' });
    expect(ids(east.segs)).toEqual(['oak-2', 'oak-3', 'oak-4']);      // 61 m in: past the middle of the first block
    expect(east.notes).toEqual(['200 feet from Ash Ave measured in a straight line']);
    const north = between({ name: 'Ash Ave', feet: 200, dir: 'N' }, { name: 'Elm Ave' });
    expect(ids(north.segs)).toEqual(['oak-1', 'oak-2', 'oak-3', 'oak-4']);
    expect(north.notes).toEqual(['"200 feet N" of Ash Ave: the street does not run that way, distance not applied']);
    expect(between({ name: 'Ash Ave' }, { name: 'Ash Ave', feet: 100, dir: 'E' })).toMatchObject({ segs: [],
      notes: ['100 feet from Ash Ave measured in a straight line', 'no block has its middle inside the stretch (shorter than a block)'] });
  });
  it('takes the terminus as the end the Code points to', () => {
    expect(ids(between({ name: 'Cedar Ave' }, { end: true, dir: 'E' }).segs)).toEqual(['oak-3', 'oak-4']);
    expect(ids(between({ name: 'Cedar Ave' }, { end: true, dir: 'W' }).segs)).toEqual(['oak-1', 'oak-2']);
    expect(between({ name: 'Cedar Ave' }, { end: true })).toMatchObject({ segs: [], error: 'a limit could not be placed: the stretch is not shown',
      notes: ['the Code does not say which end of the street the terminus is'] });
  });
  it('finds the circle at a street\'s end, its stem, and the circle\'s inner side', () => {
    const ring = ringOf(loop);
    expect(ids(ring)).toEqual(['loop-1', 'loop-2', 'loop-3', 'loop-4']);
    expect(ringOf(street)).toEqual([]);
    expect(ids(stretch(loop, { from: { name: 'Pine Ave' }, to: { circle: true } }, names).segs)).toEqual(['loop-stem']);
    expect(stretch(street, { from: { name: 'Ash Ave' }, to: { circle: true } }, names).notes).toEqual(['the street has no circle in the State\'s layer']);
    expect(ringSide(ring[0], ring, 'I')).toBe('L');     // heading northeast, the middle of the circle is to its left
    expect(ringSide(ring[0], ring, 'O')).toBe('R');
    expect(ringSide(ring[2], ring, 'I')).toBe('L');
  });
  it('knows a street in separate pieces, and which side faces a compass direction', () => {
    expect(piecesOf(street)).toBe(1);
    expect(piecesOf([street[0], street[3]])).toBe(2);
    const axis = axisOf(street);
    expect(sideOf(street[0], 'N', axis)).toBe('L');     // drawn west to east: north is on its left
    expect(sideOf(street[0], 'S', axis)).toBe('R');
    expect(sideOf(street[0], 'E', axis)).toBeNull();    // the street runs east: it has no east side
  });
});

describe('laying the rows on the blocks', () => {
  const lay = (lines, features = GRID) => applyCode(lines.map(parseRow), segmentsOf(features));
  const rules = (r, id, side) => [...(r.sides.get(id)?.get(side)?.values() || [])];
  it('puts a row on the side it names, as a weekly rule not suspended on holidays', () => {
    const r = lay(['Oak Street|North|9:00 a.m. to 3:00 p.m., Monday|From Birch Avenue to Dogwood Avenue']);
    expect([...r.sides.keys()]).toEqual(['oak-2', 'oak-3']);
    expect(rules(r, 'oak-2', 'L')).toEqual([[1, 9, 15, 31, 0, 1]]);
    expect(r.sides.get('oak-2').has('R')).toBe(false);
    expect(r.rows).toEqual([{ key: 'Oak Street|North|9:00 a.m. to 3:00 p.m., Monday|From Birch Avenue to Dogwood Avenue', applied: 2, blocks: 2 }]);
  });
  it('keeps two rows on one side as two rules, and the same rule once', () => {
    const r = lay(['Oak Street|South|9:00 a.m. to 3:00 p.m., Wednesday|Entire length', 'Oak Street|South|9:00 a.m. to 10:00 a.m., Wednesday|From Ash Avenue to Birch Avenue',
      'Oak Street|South|9:00 a.m. to 3:00 p.m., Wednesday|From Ash Avenue to Cedar Avenue']);
    expect(rules(r, 'oak-1', 'R')).toEqual([[3, 9, 15, 31, 0, 1], [3, 9, 10, 31, 0, 1]]);
    expect(rules(r, 'oak-4', 'R')).toEqual([[3, 9, 15, 31, 0, 1]]);
  });
  it('never puts a rule on a side in a neighboring town, or on a highway', () => {
    const features = [oak(1), oak(2), oak(3, 'LR', 'S1100'), oak(4, 'L'), ...AVENUES];
    const south = lay(['Oak Street|South|9:00 a.m. to 3:00 p.m., Monday|Entire length'], features);
    expect([...south.sides.keys()]).toEqual(['oak-1', 'oak-2']);
    expect(south.rows[0]).toMatchObject({ applied: 2, blocks: 2, notes: expect.arrayContaining(['on a block that side is in a neighboring town: not shown']) });
    const both = lay(['Oak Street|Both|9:00 a.m. to 3:00 p.m., Monday|Entire length'], features);
    expect([...both.sides.get('oak-4').keys()]).toEqual(['L']);
    expect(both.rows[0].notes || []).not.toContain('on a block that side is in a neighboring town: not shown');
    expect(both.sides.has('oak-3')).toBe(false);
  });
  it('says when a street\'s blocks are in separate pieces', () => {
    const r = lay(['Oak Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length'], [oak(1), oak(4), ...AVENUES]);
    expect(r.inPieces).toEqual(['Oak St']);
    expect(r.rows[0]).toMatchObject({ applied: 2, notes: ['the street\'s Lodi blocks are in separate pieces: the row is on all of them'] });
    expect(lay(['Oak Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length']).inPieces).toEqual([]);
  });
  it('leaves a row off the map, with the reason, rather than guess', () => {
    const r = lay(['Oak Street|North|All; except 9:00 a.m. to 3:00 p.m., Tuesday|Entire length', 'Maple Street|North|9:00 a.m. to 3:00 p.m., Monday|Entire length',
      'Oak Street|East|9:00 a.m. to 3:00 p.m., Monday|Entire length', 'Oak Street|North|9:00 a.m. to 3:00 p.m., Monday|From Birch Avenue to Kimmig Avenue']);
    expect(r.sides.size).toBe(0);
    expect(r.rows[0]).toMatchObject({ applied: 0, setAside: expect.stringMatching(/^reads "All" with an exception/) });
    expect(r.rows[1].notes).toEqual(['no Maple St coded to Lodi in the State\'s layer']);
    expect(r.rows[2].notes).toEqual(['a block runs the way the Code names the side: side unclear there, not shown']);
    expect(r.rows[3].notes).toEqual(['Kimmig Ave is nowhere near the street in the State\'s layer', 'a limit could not be placed: the stretch is not shown']);
  });
  it('puts the circle\'s rows on the circle and the street\'s rows on the stem', () => {
    const r = lay(['Loop Drive|Inner Circle|9:00 a.m. to 3:00 p.m., Monday|Entire length', 'Loop Drive|Outer Circle|9:00 a.m. to 3:00 p.m., Thursday|Entire length',
      'Loop Drive|East|9:00 a.m. to 3:00 p.m., Monday|From Pine Avenue to Circle']);
    expect(rules(r, 'loop-1', 'L')).toEqual([[1, 9, 15, 31, 0, 1]]);
    expect(rules(r, 'loop-1', 'R')).toEqual([[4, 9, 15, 31, 0, 1]]);
    expect(rules(r, 'loop-stem', 'R')).toEqual([[1, 9, 15, 31, 0, 1]]);    // drawn south to north: east is on its right
    expect(r.sides.get('loop-stem').has('L')).toBe(false);
    expect(r.rows.map((x) => x.blocks)).toEqual([4, 4, 1]);
    expect(r.inPieces).toEqual([]);
  });
});

describe('the committed data', () => {
  const read = (n) => JSON.parse(fs.readFileSync(new URL(`../../data/lodi/${n}`, import.meta.url), 'utf8'));
  const segs = read('segments.json'), city = read('city.json'), report = read('report.json');
  const block = (c) => segs.b.find((b) => b.c === c);
  const side = (c, label) => block(c).d.find((x) => x[1] === label)[2];
  const at = (dow, from = 9, to = 15) => [dow, from, to, 31, 0, 1];
  it('shows the Code\'s rows on the blocks it names', () => {
    expect(block('0a27c8b6-1708-11e3-b5f2-0062151309ff')).toMatchObject({ s: 'Putnam St', l: 'Outwater Ln - Hamilton Ave', d: [['L', 'East', [at(2)]]] });
    expect(block('21c7e78a-1708-11e3-b5f2-0062151309ff')).toMatchObject({ s: 'James St', l: 'East Pl - Prospect St', d: [['R', 'South', [at(4)]]] });
    expect(block('840281b5-3579-411a-9c17-99f01507f16e')).toMatchObject({ s: 'James St', l: 'Grove St - Paterson Ave', d: [['L', 'North', [at(2)]]] });
    expect(block('1b804796-1708-11e3-b5f2-0062151309ff')).toMatchObject({ s: 'Adams Pl', l: 'Prospect St - S Main St' });
    expect(side('1b804796-1708-11e3-b5f2-0062151309ff', 'South')).toEqual([at(4)]);
    expect(side('1b804796-1708-11e3-b5f2-0062151309ff', 'North')).toEqual([at(1)]);
  });
  it('keeps a side\'s two windows, and the two sides of Marion Pepe Drive\'s stem', () => {
    expect(block('02f264de-1708-11e3-b5f2-0062151309ff')).toMatchObject({ s: '1st St', l: 'Passaic Ave - Bernice Pl' });
    expect(side('02f264de-1708-11e3-b5f2-0062151309ff', 'South')).toEqual([at(3, 9, 10), at(3)]);
    expect(side('02f264de-1708-11e3-b5f2-0062151309ff', 'North')).toEqual([at(1)]);
    expect(block('0b6920c6-1708-11e3-b5f2-0062151309ff')).toMatchObject({ s: 'Marion Pepe Dr', l: 'Terhune Ave' });
    expect(side('0b6920c6-1708-11e3-b5f2-0062151309ff', 'West')).toEqual([at(4)]);
    expect(side('0b6920c6-1708-11e3-b5f2-0062151309ff', 'East')).toEqual([at(1)]);
  });
  it('has valid blocks and rules: weekdays, all year, holidays included', () => {
    expect(new Set(segs.b.map((b) => b.c)).size).toBe(segs.b.length);
    const [[south, west], [north, east]] = city.bounds;
    for (const b of segs.b) {
      expect(b.d.length).toBeGreaterThan(0);
      for (const [lon, lat] of b.g) { expect(lat).toBeGreaterThanOrEqual(south); expect(lat).toBeLessThanOrEqual(north); expect(lon).toBeGreaterThanOrEqual(west); expect(lon).toBeLessThanOrEqual(east); }
      for (const [s, label, rules] of b.d) {
        expect(['L', 'R']).toContain(s);
        expect(['North', 'South', 'East', 'West']).toContain(label);
        expect(rules.length).toBeGreaterThan(0);
        for (const [dow, from, to, weeks, months, flags] of rules) {
          expect([1, 2, 3, 4, 5]).toContain(dow);
          expect(to).toBeGreaterThan(from);
          expect([weeks, months, flags]).toEqual([31, 0, 1]);
        }
      }
    }
  });
  it('accounts for every row of the schedule', () => {
    expect(report.inputs).toMatchObject({ codeRows: 338, codeRead: '2026-11-11' });
    expect(report.codeRows).toMatchObject({ applied: 295 });
    expect(report.codeRows.setAside).toHaveLength(32);
    expect(report.codeRows.notApplied).toHaveLength(11);
    expect(report.codeRows.applied + report.codeRows.setAside.length + report.codeRows.notApplied.length).toBe(codeRows().length);
    for (const r of report.codeRows.setAside) expect(r.why).toBeTruthy();
    for (const r of report.codeRows.notApplied) expect(r.notes.length).toBeGreaterThan(0);
    expect(report.output.blocks).toBe(segs.b.length);
    expect(segs.b).toHaveLength(496);
    expect(report.unverified.join(' ')).toMatch(/No block has been checked against the posted signs/);
  });
  it('gives the city\'s facts as the Code states them', () => {
    expect(Object.keys(city)).toEqual(['id', 'name', 'region', 'tz', 'center', 'zoom', 'bounds', 'holidays', 'holidayRule', 'fine', 'tow', 'fineSource', 'agency',
      'scheduleUrl', 'sources', 'words']);
    expect(city).toMatchObject({ id: 'lodi', name: 'Lodi', region: 'New Jersey', tz: 'America/New_York', holidays: {}, holidayRule: 'all', fine: 'up to $50', tow: 'no',
      fineSource: CODE_URL, scheduleUrl: CODE_URL, agency: 'Borough of Lodi' });
    expect(city.sources).toHaveLength(2);
    expect(Object.keys(city.words)).toEqual(['rule', 'afterpass', 'dataNotes', 'source']);
    expect(city.words.source).toBe('the Borough\'s parking code');
    expect(city.words.afterpass).toMatch(/the sign on your side wins/);
    expect(JSON.stringify(city.words)).not.toMatch(/[—–]/);
  });
});
