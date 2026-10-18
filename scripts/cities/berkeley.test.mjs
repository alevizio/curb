// Berkeley's data build (scripts/cities/berkeley.mjs): the PDF row reader, the rules, the street names, the sides and the
// placement, on real rows of the City's Residential Street Sweeping Schedule (PDFs created 2018-02-08 and 2025-09-25) and
// real segments of its Street Sweep Status centerline (PubWorks MapServer layer 28, read 2026-10-18).
import { describe, it, expect } from 'vitest';
import {
  rowsFromItems, parseRow, ruleOf, routeAgrees, streetKey, streetName, numbersOf, coverage, sideOf, compass, segmentOf,
  oddSideFromPoints, placeRow, optOuts, inOptOut, buildGraph, walkRow, crossAt, HOLIDAYS, WINDOWS,
} from './berkeley.mjs';

// Text items as pdfjs reads them: the A-G file (2018) prints "1st Fri" as "1", a raised "st" and "Fri".
const AG_PAGE1 = [{ s: '61', x: 22.2, y: 604.3 }, { s: 'Acroft Ct', x: 45.7, y: 604.3 }, { s: 'S', x: 150.3, y: 604.3 }, { s: '1400', x: 170.1, y: 604.3 },
  { s: '1498', x: 219.7, y: 604.3 }, { s: '1', x: 269.2, y: 602.1 }, { s: 'st', x: 274.7, y: 607.1 }, { s: 'Fri', x: 283.5, y: 602.1 }, { s: 'AM', x: 339.3, y: 604.3 },
  { s: 'Acton', x: 368.4, y: 604.3 }, { s: 'Terminus', x: 463.3, y: 604.3 }, { s: '61', x: 22.2, y: 574.5 }, { s: 'Acton', x: 45.7, y: 574.5 },
  { s: 'E', x: 150.3, y: 574.5 }, { s: '1201', x: 170.1, y: 574.5 }, { s: '1301', x: 219.7, y: 574.5 }, { s: '1', x: 269.2, y: 572.4 }, { s: 'st', x: 274.7, y: 577.3 },
  { s: 'Fri', x: 283.5, y: 572.4 }, { s: 'PM', x: 339.3, y: 574.5 }, { s: 'City Limit', x: 368.4, y: 574.5 }, { s: 'Hopkins', x: 463.3, y: 574.5 },
  { s: '22', x: 22.2, y: 559.7 }, { s: 'Acton', x: 45.7, y: 559.7 }, { s: 'W', x: 148.6, y: 559.7 }, { s: '1330', x: 170.1, y: 559.7 }, { s: '1398', x: 219.7, y: 559.7 },
  { s: '2', x: 269.2, y: 557.5 }, { s: 'nd', x: 274.7, y: 562.4 }, { s: 'Mon', x: 285.8, y: 557.5 }, { s: 'PM', x: 339.3, y: 559.7 }, { s: 'Gilman', x: 368.4, y: 559.7 },
  { s: 'Hopkins', x: 463.3, y: 559.7 }, { s: '1300', x: 548.2, y: 559.7 },
  // the page's header row, which is no row
  { s: 'Rte', x: 24.1, y: 634 }, { s: 'Street Name', x: 62.3, y: 634 }, { s: 'Day of', x: 282.1, y: 634 }, { s: 'Opt-Out', x: 549.6, y: 634 }];
// The H-Z file (2025) on its last page: shifted left, "2nd Mon" in one item.
const HZ_PAGE7 = [{ s: '22', x: 20.2, y: 626.4 }, { s: 'Watkins', x: 45.4, y: 626.4 }, { s: 'N', x: 140.4, y: 626.4 }, { s: '1300', x: 169.9, y: 626.4 },
  { s: '1398', x: 215.3, y: 626.4 }, { s: '2nd Mon', x: 264.9, y: 626.4 }, { s: 'PM', x: 325.4, y: 626.4 }, { s: 'Neilson', x: 365.7, y: 626.4 },
  { s: 'Tevlin', x: 460.8, y: 626.4 }, { s: '33', x: 20.2, y: 602.2 }, { s: 'Webster', x: 45.4, y: 602.2 }, { s: 'S', x: 140.4, y: 602.2 },
  { s: '2250', x: 169.9, y: 602.2 }, { s: '2398', x: 215.3, y: 602.2 }, { s: '3rd Tue', x: 264.9, y: 602.2 }, { s: 'AM', x: 325.4, y: 602.2 },
  { s: 'Deakin', x: 365.7, y: 602.2 }, { s: 'Telegraph', x: 460.8, y: 602.2 }];

// Real centerline segments (Street Sweep Status), as the layer gives them.
const feature = (properties, coordinates) => ({ properties, geometry: { type: 'LineString', coordinates } });
const WARD_1500 = feature({ OBJECTID: 1950, F_ADDR: 1500, T_ADDR: 1598, F_ADDL: 1501, T_ADDL: 1599, STR_NAM: 'WARD', STR_TYP: 'ST', mech_sweep: 'enforced' },
  [[-122.279976, 37.857816], [-122.277797, 37.858099]]);
const WARD_1600 = feature({ OBJECTID: 2741, F_ADDR: 1600, T_ADDR: 1698, F_ADDL: 1601, T_ADDL: 1699, STR_NAM: 'WARD', STR_TYP: 'ST', mech_sweep: 'enforced' },
  [[-122.277797, 37.858099], [-122.27721, 37.858176], [-122.276983, 37.858172], [-122.275603, 37.85835]]);
const ACTON_1600 = feature({ OBJECTID: 2716, F_ADDR: 1600, T_ADDR: 1622, F_ADDL: 1601, T_ADDL: 1623, STR_NAM: 'ACTON', STR_TYP: 'ST', mech_sweep: 'enforced' },
  [[-122.28501, 37.876383], [-122.284872, 37.875203]]);
const ACTON_1624 = feature({ OBJECTID: 2720, F_ADDR: 1624, T_ADDR: 1698, F_ADDL: 1625, T_ADDL: 1699, STR_NAM: 'ACTON', STR_TYP: 'ST', mech_sweep: 'enforced' },
  [[-122.284872, 37.875203], [-122.284798, 37.874562]]);
const CURTIS_1300 = feature({ OBJECTID: 1202, F_ADDR: 1300, T_ADDR: 1498, F_ADDL: 1301, T_ADDL: 1499, STR_NAM: 'CURTIS', STR_TYP: 'ST', mech_sweep: 'exempt' },
  [[-122.290007, 37.881441], [-122.291413, 37.877729], [-122.291415, 37.877664], [-122.291147, 37.876845], [-122.291088, 37.876765]]);
const byBaseOf = (segs) => { const m = new Map(); for (const s of segs) { if (!m.has(s.base)) m.set(s.base, []); m.get(s.base).push(s); } return m; };

describe('rowsFromItems: the PDF rows, from text items', () => {
  it('anchors a row on its route and gathers the raised "st" and the weekday a few points off its baseline', () => {
    const rows = rowsFromItems(AG_PAGE1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ rte: '61', street: 'Acroft Ct', side: 'S', from: '1400', to: '1498', day: '1 st Fri', ampm: 'AM', fromSt: 'Acton', toSt: 'Terminus' });
    expect(rows[2]).toEqual({ rte: '22', street: 'Acton', side: 'W', from: '1330', to: '1398', day: '2 nd Mon', ampm: 'PM', fromSt: 'Gilman', toSt: 'Hopkins', optOut: '1300' });
  });
  it('reads the 2025 file, shifted left with the day in one item', () => {
    expect(rowsFromItems(HZ_PAGE7)[1]).toEqual({ rte: '33', street: 'Webster', side: 'S', from: '2250', to: '2398', day: '3rd Tue', ampm: 'AM', fromSt: 'Deakin', toSt: 'Telegraph' });
  });
});

describe('parseRow and ruleOf: a row and its rule', () => {
  it('reads the week, the weekday and AM or PM', () => {
    const r = parseRow(rowsFromItems(AG_PAGE1)[0]);
    expect(r).toMatchObject({ street: 'Acroft Ct', side: 'S', from: 1400, to: 1498, week: 1, dow: 5, ampm: 'AM', optOut: [], problems: [] });
    expect(ruleOf(r)).toEqual([5, 9, 12, 1, 0, 0]);
    expect(ruleOf(parseRow(rowsFromItems(HZ_PAGE7)[0]))).toEqual([1, '12:30', '15:30', 2, 0, 0]);   // 2nd Mon PM
    expect(ruleOf(parseRow(rowsFromItems(HZ_PAGE7)[1]))).toEqual([2, 9, 12, 4, 0, 0]);               // 3rd Tue AM
  });
  it('has the hours read on the posted signs', () => {
    expect(WINDOWS).toEqual({ AM: [9, 12], PM: ['12:30', '15:30'] });
  });
  it('reads "4thFri", "E/W" (both sides), two opt-out blocks and a missing "to" number', () => {
    expect(parseRow({ rte: '64', street: 'Etna', side: 'W', from: '2500', to: '2698', day: '4thFri', ampm: 'AM' })).toMatchObject({ week: 4, dow: 5, problems: [] });
    expect(parseRow({ rte: '43', street: 'Regent', side: 'E/W', from: '2700', to: '2799', day: '3rd Wed', ampm: 'AM' }).side).toBe('BOTH');
    expect(parseRow({ rte: '61', street: 'Curtis', side: 'E', from: '1201', to: '1499', day: '1 st Fri', ampm: 'PM', optOut: '13/1400' }).optOut).toEqual([1300, 1400]);
    const dwight = parseRow({ rte: '34', street: 'Dwight', side: 'N', from: '2801', day: '4 th Tue', ampm: 'PM', fromSt: 'Piedmont', toSt: 'Fernwald' });
    expect(dwight).toMatchObject({ from: 2801, to: 2899, problems: [] });
    expect(dwight.notes[0]).toMatch(/assumed/);
  });
  it('says why a row cannot be read', () => {
    expect(parseRow({ rte: '61', street: 'X', side: 'Q', from: '1', to: '9', day: 'Fri', ampm: 'Noon' }).problems).toHaveLength(3);
  });
  it('checks the route number against the day: "61" is the 1st Friday', () => {
    expect(routeAgrees(parseRow(rowsFromItems(AG_PAGE1)[0]))).toBe(true);
    expect(routeAgrees({ rte: '61', dow: 1, week: 1 })).toBe(false);
  });
});

describe('streetKey and streetName: one key per street', () => {
  it('matches the schedule, the centerline and the address points', () => {
    expect(streetKey('6 th Street')).toEqual({ base: '6TH', type: 'ST' });
    expect(streetKey('6TH', 'ST')).toEqual({ base: '6TH', type: 'ST' });
    expect(streetKey('SIXTH')).toEqual({ base: '6TH', type: '' });
    expect(streetKey('M L King').base).toBe(streetKey('MARTIN LUTHER KING JR', 'WY').base);
    expect(streetKey('Acton Crescent')).toEqual(streetKey('ACTON', 'CR'));
    expect(streetKey('Claremont Cresc')).toEqual(streetKey('CLAREMONT', 'CS'));
    expect(streetKey('Acton')).toEqual({ base: 'ACTON', type: '' });
    expect(streetKey('McGee').base).toBe(streetKey('MC GEE', 'AV').base);
  });
  it('writes names as people say them', () => {
    expect(streetName('MARTIN LUTHER KING JR', 'WY')).toBe('Martin Luther King Jr Way');
    expect(streetName('MC GEE', 'AV')).toBe('McGee Ave');
    expect(streetName('6TH', 'ST')).toBe('6th St');
    expect(streetName('ACTON', 'CRES')).toBe('Acton Crescent');
    expect(streetName('THE ALAMEDA', '')).toBe('The Alameda');
  });
});

describe('numbers and sides of a centerline segment', () => {
  it('reads each side\'s numbers and the odd side from the ranges', () => {
    expect(numbersOf(WARD_1500.properties)).toEqual({ L: [1501, 1599], R: [1500, 1598], odd: 'L', oddSpan: [1501, 1599], evenSpan: [1500, 1598], all: [1500, 1599] });
  });
  it('measures how much of a side a row\'s range covers', () => {
    expect(coverage([1500, 1598], 1500, 1998)).toBe(1);
    expect(coverage([1500, 1598], 1600, 1998)).toBe(0);
    expect(coverage([1400, 1499], 1400, 1414)).toBeCloseTo(0.16, 2);
  });
  it('knows which side of a line faces a compass direction, first point to last', () => {
    const ward = WARD_1600.geometry.coordinates;                    // drawn west to east: left is north
    expect(sideOf(ward, 'N')).toMatchObject({ side: 'L' });
    expect(sideOf(ward, 'S').side).toBe('R');
    expect(sideOf(ward, 'S').conf).toBeGreaterThan(0.95);
    expect(compass(ward, 'L')).toBe('North');
    const acton = ACTON_1624.geometry.coordinates;                  // drawn north to south: left is east
    expect(sideOf(acton, 'E').side).toBe('L');
    expect(compass(acton, 'R')).toBe('West');
  });
  it('settles the odd side from address points, against the ranges', () => {
    const s = segmentOf(WARD_1500);
    const north = (n, t) => [n, -122.279976 + t * 0.002179, 37.857816 + t * 0.000283 + 0.00012];
    const south = (n, t) => [n, -122.279976 + t * 0.002179, 37.857816 + t * 0.000283 - 0.00012];
    expect(oddSideFromPoints(s, [north(1511, 0.1), north(1525, 0.3), south(1520, 0.5), south(1540, 0.7), north(1561, 0.9)])).toEqual({ odd: 'L', n: 5, share: 1 });
    expect(oddSideFromPoints(s, [south(1511, 0.1), south(1525, 0.3), north(1520, 0.5), north(1540, 0.7)]).odd).toBe('R');   // the ranges' way round, wrong
    expect(oddSideFromPoints(s, [north(1511, 0.1), north(1525, 0.3)]).odd).toBe(null);                                     // too few to say
    expect(oddSideFromPoints(s, [north(1711, 0.1), north(1725, 0.3), north(1741, 0.5), north(1761, 0.7)]).n).toBe(0);    // other numbers
  });
});

describe('placeRow: a row on the street\'s segments', () => {
  const segs = [WARD_1500, WARD_1600, ACTON_1600, ACTON_1624].map(segmentOf);
  const byBase = byBaseOf(segs);
  it('puts "Ward S 1500-1998, 1st Tue AM" on the south side of both blocks (the sign on the 1600 block reads 9 to 12, 1st Tuesday)', () => {
    const row = parseRow({ rte: '31', street: 'Ward', side: 'S', from: '1500', to: '1998', day: '1st Tue', ampm: 'AM', fromSt: 'Sacramento', toSt: 'Milvia' });
    const { hits } = placeRow(row, byBase);
    expect(hits.map((h) => [h.s.id, h.side, compass(h.s.c, h.side)])).toEqual([['1950', 'R', 'South'], ['2741', 'R', 'South']]);
    expect(ruleOf(row)).toEqual([2, 9, 12, 1, 0, 0]);
  });
  it('puts "Acton E 1601-1699, 1st Wed PM" on the east side, as the 12:30 to 3:30 sign on that block says', () => {
    const row = parseRow({ rte: '41', street: 'Acton', side: 'E', from: '1601', to: '1699', day: '1 st Wed', ampm: 'PM', fromSt: 'Lincoln', toSt: 'Cedar' });
    const { hits } = placeRow(row, byBase);
    expect(hits.map((h) => [h.s.id, compass(h.s.c, h.side)])).toEqual([['2716', 'East'], ['2720', 'East']]);
    expect(ruleOf(row)).toEqual([3, '12:30', '15:30', 1, 0, 0]);
  });
  it('places nothing for numbers the street does not hold, and says so', () => {
    const row = parseRow({ rte: '41', street: 'Acton', side: 'E', from: '3601', to: '3699', day: '1 st Wed', ampm: 'PM' });
    expect(placeRow(row, byBase).hits).toEqual([]);
    expect(placeRow({ ...row, street: 'Dover' }, byBase).why).toMatch(/not on the centerline/);
  });
});

describe('opt-out blocks', () => {
  it('collects every block a street\'s rows name, and leaves off a segment inside them', () => {
    const rows = [parseRow({ rte: '61', street: 'Curtis', side: 'E', from: '1201', to: '1499', day: '1 st Fri', ampm: 'PM', optOut: '13/1400' })];
    const opt = optOuts(rows);
    expect([...opt.get('CURTIS')]).toEqual([1300, 1400]);
    expect(inOptOut(segmentOf(CURTIS_1300), opt.get('CURTIS'))).toBe('1300/1400');   // the City's layer: "exempt" too
    expect(inOptOut(segmentOf(WARD_1500), new Set([1500]))).toBe('1500');
    expect(inOptOut(segmentOf(WARD_1500), new Set([1600]))).toBe(null);
  });
});

describe('the street graph: cross streets and walks', () => {
  // A street with a cul-de-sac end: Main from Oak to its end, Oak crossing at the first node.
  const line = (id, name, type, c, nums) => segmentOf(feature({ OBJECTID: id, STR_NAM: name, STR_TYP: type, F_ADDL: nums[0] + 1, T_ADDL: nums[1] + 1, F_ADDR: nums[0], T_ADDR: nums[1] }, c));
  const segs = [
    line(1, 'MAIN', 'ST', [[-122.27, 37.87], [-122.27, 37.871]], [100, 198]),
    line(2, 'MAIN', 'ST', [[-122.27, 37.871], [-122.27, 37.872]], [200, 298]),
    line(3, 'OAK', 'ST', [[-122.271, 37.87], [-122.27, 37.87]], [10, 98]),
    line(4, 'ELM', 'ST', [[-122.27, 37.871], [-122.269, 37.871]], [10, 98]),
  ];
  const nodes = buildGraph(segs), byBase = byBaseOf(segs);
  it('names the cross streets at each end of a block', () => {
    expect(crossAt(segs[0], segs[0].a, nodes)).toBe('Oak St');
    expect(crossAt(segs[0], segs[0].b, nodes)).toBe('Elm St');
    expect(crossAt(segs[1], segs[1].b, nodes)).toBe('');
  });
  it('walks a row between its cross streets, or to the street\'s dead end for "Terminus"', () => {
    const walk = (fromSt, toSt, from = 100, to = 298) => (walkRow({ street: 'Main', fromSt, toSt, from, to }, byBase.get('MAIN'), nodes) || []).map((s) => s.id);
    expect(walk('Oak', 'Elm')).toEqual(['1']);
    expect(walk('Elm', 'Terminus')).toEqual(['2']);
    expect(walk('Oak', 'Terminus')).toEqual(['1', '2']);
    expect(walk('Oak', 'Ohlone Park')).toEqual([]);
  });
});

describe('holidays', () => {
  it('lists the City\'s 2026 and 2027 holidays, on real dates', () => {
    const dates = Object.keys(HOLIDAYS);
    expect(dates.filter((d) => d.startsWith('2026'))).toHaveLength(15);
    expect(dates.filter((d) => d.startsWith('2027'))).toHaveLength(15);
    for (const d of dates) expect(new Date(d + 'T12:00:00Z').toISOString().slice(0, 10)).toBe(d);
    // observed days fall on weekdays; Lincoln's Birthday and Malcolm X's Birthday are Berkeley's own
    for (const d of dates) expect([0, 6]).not.toContain(new Date(d + 'T12:00:00Z').getUTCDay());
    expect(HOLIDAYS['2026-02-12']).toMatch(/Lincoln/);
    expect(HOLIDAYS['2027-05-17']).toMatch(/Malcolm X/);
    expect(HOLIDAYS['2027-12-24']).toMatch(/Christmas/);
  });
});
