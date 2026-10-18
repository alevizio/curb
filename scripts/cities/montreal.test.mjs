// scripts/cities/montreal.mjs: the street cleaning sign decoder on real panel texts from the City's sign inventory
// (Signalisation, stationnement sur rue, 2026-10-18), the season, the sides, the names and the holidays.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { decodeRpa, readRpa, seasonMonths, isCleaningSeason, along, compass, xy, streetName, boroughName,
  quebecHolidays, parseCSV, simplify, FLAGS, GRID_ANGLE } from './montreal.mjs';

const APR_NOV = 2040, MAR_NOV = 2044, MAR_OCT = 1020, APR_OCT = 1016;
const r = (dow, from, to, months = APR_NOV) => [dow, from, to, 31, months, FLAGS];
const days = (list, from, to, months) => list.map((d) => r(d, from, to, months));

// [text exactly as the City writes it (String.raw keeps the backslash), expected rules]
const CLEANING = [
  [String.raw`\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC`, [r(3, '8:30', '11:30')]],
  [String.raw`\P 8h30-11h30 LUNDI 1AVRIL AU 1DEC`, [r(1, '8:30', '11:30')]],
  [String.raw`\\P 12h30-15h30 MERCREDI 1 AVRIL AU 1 DEC`, [r(3, '12:30', '15:30')]],
  [String.raw`\P 12h30-15h30 MARDI 1AVRIL AU 1DEC`, [r(2, '12:30', '15:30')]],
  [String.raw`\P 13h-14h MAR. 1 AVRIL AU 1 DEC.`, [r(2, 13, 14)]],
  [String.raw`\P 10h-11h MARDI 1 AVRIL AU 1 DEC`, [r(2, 10, 11)]],
  [String.raw`\P 9h30-10h30 JEUDI 1 AVRIL AU 1 DEC`, [r(4, '9:30', '10:30')]],
  [String.raw`\P 8h30-09h30 JEUDI 1 AVRIL AU 1 DEC`, [r(4, '8:30', '9:30')]],
  [String.raw`\P 7h-8h LUN A VEN 1 AVRIL AU 1 DEC`, days([1, 2, 3, 4, 5], 7, 8)],
  [String.raw`\P 7h-9h MARDI JEUDI 1 AVRIL AU 1 DEC`, days([2, 4], 7, 9)],
  [String.raw`\P 07h-09h LUNDI MERCREDI 1 AVRIL AU 1 DEC`, days([1, 3], 7, 9)],
  [String.raw`\P 8h-9h LUNDI VENDREDI 1 AVRIL AU 1 DEC`, days([1, 5], 8, 9)],            // a list, not a range
  [String.raw`\P 7h-9h LUNDI MERCREDI SAMEDI 1 AVRIL AU 1 DEC`, days([1, 3, 6], 7, 9)],
  [String.raw`\P 7h-9h MARDI JEUDI DIMANCHE 1 AVRIL AU 1 DEC`, days([0, 2, 4], 7, 9)],
  [String.raw`\P 7h30-8h30  SAMEDI DIMANCHE 1 AVRIL AU 1 DEC`, days([0, 6], '7:30', '8:30')],
  [String.raw`\P 8h-9h DIMANCHE 1 AVRIL AU 1 DEC`, [r(0, 8, 9)]],
  [String.raw`\P 8h15-10h MARDI MERCREDI 1 AVRIL AU 1 DEC`, days([2, 3], '8:15', 10)],
  [String.raw`\P 5H-7H 1 AVRIL AU 1 DEC`, days([0, 1, 2, 3, 4, 5, 6], 5, 7)],            // no day: every day
  [String.raw`\P 23H30-0h30 MARDI JEUDI 1 AVRIL AU 1 DEC`, days([2, 4], '23:30', '0:30')], // past midnight
  [String.raw`\P 23h30-0h30 LUNDI MARDI JEUDI VENDREDI 1 AVRIL AU 1 DEC`, days([1, 2, 4, 5], '23:30', '0:30')],
  [String.raw`\P 19h-24h JEUDI  1 AVRIL AU 1 DEC`, [r(4, 19, 24)]],
  [String.raw`/P 19h-24h MARDI 1 AVRIL AU 1 DEC`, [r(2, 19, 24)]],                        // a slash for the backslash
  [String.raw`\P9h30-11h30 MARDI 1 AVRIL AU 1 DEC`, [r(2, '9:30', '11:30')]],             // no space after \P
  [String.raw`\P 19h30-20h30 LUNDRI 1 AVRIL AU 1 DEC`, [r(1, '19:30', '20:30')]],          // LUNDRI (typo)
  [String.raw`\P 6h30-7h30 LUNDI JEUDI 1 AVIL AU 1 DEC`, days([1, 4], '6:30', '7:30')],    // AVIL (typo)
  [String.raw`\P 7h30-8h30 1 AVRILS AU 1 DEC`, days([0, 1, 2, 3, 4, 5, 6], '7:30', '8:30')],
  [String.raw`\P 9h-12h LUNDI JEUDI 1 AVRILAU 1 DEC`, days([1, 4], 9, 12)],
  [String.raw`\P 22h30-23h30 MARDI JEUDI 1 AVRIL ET 1 DEC`, days([2, 4], '22:30', '23:30')],
  // Outremont: April 1 to November 30, \A (no stopping) on some commercial streets
  [String.raw`\P 8h - 12h JEUDI 1ER AVRIL - 30 NOV`, [r(4, 8, 12)]],
  [String.raw`\P 8h - 12h LUNDI 1ER AVRIL - 30 NOV `, [r(1, 8, 12)]],
  [String.raw`\A 8h - 9h MER ET VEN 1er AVRIL - 30 NOV`, days([3, 5], 8, 9)],
  [String.raw`\A 6h30 - 9h LUN et JEU 1er AVRIL - 30 NOV`, days([1, 4], '6:30', 9)],
  [String.raw`\A 7h - 7h30 LUNDI 1er AVRIL - 30 NOV`, [r(1, 7, '7:30')]],
  // Saint-Laurent: March 1 to December 1, or April 15 to November 15 (some panels have no \P in their text)
  [String.raw`\p 08h - 12h mercredi 1er mars - 1er déc`, [r(3, 8, 12, MAR_NOV)]],
  [String.raw`\p13h - 17h mercredi 1er mars - 1er déc`, [r(3, 13, 17, MAR_NOV)]],
  [String.raw`9H à 12H - LUNDI - 15 AVR au 15 NOV`, [r(1, 9, 12, APR_OCT)]],
  [String.raw`9H À 12H - MARDI - 15 AVR AU 15 NOV - ENTRETIEN`, [r(2, 9, 12, APR_OCT)]],
  [String.raw`13H À 17H MAR JEU 15 AVR - 15 NOV`, days([2, 4], 13, 17, APR_OCT)],
  [String.raw`13H À 17H LUN MER VEN 15 AVR - 15 NOV`, days([1, 3, 5], 13, 17, APR_OCT)],
  // Lachine: March 15 to November 15 (and a few panels in Mercier–Hochelaga-Maisonneuve)
  [String.raw`\P 9H @ 12H MERCREDI 15 MARS AU 15 NOVEMBRE`, [r(3, 9, 12, MAR_OCT)]],
  [String.raw`\P 9H @ 12H LUNDI 15 MARS au 15 NOVEMBRE`, [r(1, 9, 12, MAR_OCT)]],
  [String.raw`\P 12h -16h JEUDI15 MARS AU 15 NOVEMBRE`, [r(4, 12, 16, MAR_OCT)]],
  [String.raw`\P 8h-12h MERCREDI 15 MARS AU 15 NOV`, [r(3, 8, 12, MAR_OCT)]],
  [String.raw`\P 13h-16h MERCREDI DU 15 AVRIL AU 15 NOV`, [r(3, 13, 16, APR_OCT)]],
];

describe('decodeRpa: street cleaning panels', () => {
  it.each(CLEANING)('%s', (text, rules) => {
    const d = decodeRpa(text);
    expect(d.cleaning).toBe(true);
    expect(d.rules).toEqual(rules);
  });
  it('has at least 30 real panel texts', () => { expect(CLEANING.length).toBeGreaterThanOrEqual(30); });
  it('tells no parking from no stopping, and marks the texts without \\P', () => {
    expect(decodeRpa(String.raw`\P 10h-11h MARDI 1 AVRIL AU 1 DEC`).ban).toBe('P');
    expect(decodeRpa(String.raw`\A 8h - 9h MER ET VEN 1er AVRIL - 30 NOV`).ban).toBe('A');
    expect(decodeRpa('9H à 12H - LUNDI - 15 AVR au 15 NOV').implied).toBe(true);
  });
  it('reads the season exactly, whatever the months show', () => {
    expect(decodeRpa(String.raw`\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC`).season).toEqual({ start: [4, 1], end: [12, 1] });
    expect(decodeRpa(String.raw`\P 9H @ 12H MERCREDI 15 MARS AU 15 NOVEMBRE`).season).toEqual({ start: [3, 15], end: [11, 15] });
  });
});

// [text, why it is not street cleaning]
const OTHER = [
  [String.raw`\P EN TOUT TEMPS`, 'always'],
  [String.raw`\A EN TOUT TEMPS`, 'always'],
  [String.raw`\P EXCEPTE HANDICAPES (PICTO)`, 'always'],
  ['P 2h 8h - 22h', 'not a ban'],
  ['PANONCEAU EXCEPTÉ DETENTEURS DE PERMIS SECTEUR XX', 'not a ban'],
  ['Stationnement réservé véhicule de promenade, VEN, 8h-12h, 1er AVRIL AU 1ER DÉC REMORQUAGE À VOS FRAIS', 'not a ban'],
  [String.raw`\P 9h-23h EXCEPTE S3R`, 'no season'],
  [String.raw`\A 15h30-18h30 LUN. AU VEN.`, 'no season'],
  [String.raw`\P 9h-17h MARDI`, 'no season'],
  ['8H À 17H - LUN MER VEN', 'no season'],
  [String.raw`\P ENTRETIEN (ORANGE) 07h-19h ou 19h-07h (flexible)`, 'no season'],
  [String.raw`\P 08h-17h LUN A VEN SEPT A JUIN`, 'other season'],
  [String.raw`\P 1 DEC AU 1 MARS`, 'other season'],
  [String.raw`\P 14h-20h JEUDI 1 JUIN AU 31 OCT`, 'other season'],
  [String.raw`\P 7h-23h LUN A VEN 1 AVRIL AU 31 OCT`, 'other season'],
  [String.raw`\P EXCEPTE 8h - 12h MERCREDI 1er AVRIL - 30 NOV`, 'exception'],
  [String.raw`\P EXCEPTÉ LUNDI 12H-16H 15 MARS AU 15 NOVEMBRE`, 'exception'],
  [String.raw`\P 8h à 12h du lundi au vendredi 1 avril au 30 nov. excepté véhicules municipaux`, 'exception'],
  [String.raw`\P EXCEPTE MOTOS 1 AVRIL AU 1 NOV`, 'exception'],
  [String.raw`\P 1 AVRIL  AU 1 DEC`, 'no hours'],
  [String.raw`\P 1ER AVRIL - 30 NOV`, 'no hours'],
  [String.raw`\P RESERVE CORPS DIPLOMATIQUE \P 8h - 12h JEUDI 1ER AVRIL - 30 NOV`, 'unread'],   // from the code table
];

describe('decodeRpa: everything else is left out, with a reason', () => {
  it.each(OTHER)('%s', (text, why) => {
    const d = decodeRpa(text);
    expect(d.cleaning).toBe(false);
    expect(d.why).toBe(why);
  });
});

describe('readRpa: windows and their days', () => {
  it('gives one list of days to every window', () => {
    expect(readRpa(String.raw`\P 7h-9h ET 14h-16h LUN A VEN SEPT À JUIN`).clauses).toEqual([
      { from: 7, to: 9, days: [1, 2, 3, 4, 5] }, { from: 14, to: 16, days: [1, 2, 3, 4, 5] }]);
  });
  it('keeps each window with its own days', () => {
    expect(readRpa(String.raw`\P 16h-23h LUN A VEN ET 09h-23h SAM ET DIM EXCEPTE S3R`).clauses).toEqual([
      { from: 16, to: 23, days: [1, 2, 3, 4, 5] }, { from: 9, to: 23, days: [0, 6] }]);
  });
  it('reads "du lundi au vendredi"', () => {
    expect(readRpa(String.raw`\P 8h à 12h du lundi au vendredi 1 avril au 30 nov. excepté véhicules municipaux`).clauses)
      .toEqual([{ from: 8, to: 12, days: [1, 2, 3, 4, 5] }]);
  });
});

describe('the season as months', () => {
  it('counts a month when the dates cover more than half of it', () => {
    expect(seasonMonths({ start: [4, 1], end: [12, 1] })).toBe(APR_NOV);     // December 1 alone is left out
    expect(seasonMonths({ start: [4, 1], end: [11, 30] })).toBe(APR_NOV);
    expect(seasonMonths({ start: [3, 1], end: [12, 1] })).toBe(MAR_NOV);
    expect(seasonMonths({ start: [3, 15], end: [11, 15] })).toBe(MAR_OCT);   // 17 of 31 March days, 15 of 30 in November
    expect(seasonMonths({ start: [4, 15], end: [11, 15] })).toBe(APR_OCT);   // 16 of 30 April days
    expect(seasonMonths({ start: [4, 16], end: [11, 15] })).toBe(1008);      // LaSalle: May to October
    expect(seasonMonths({ start: [4, 1], end: [11, 14] })).toBe(APR_OCT);    // Verdun
    expect(seasonMonths({ start: [12, 1], end: [3, 1] })).toBe(2048 + 1 + 2); // over New Year: December to February
  });
  it('knows the cleaning seasons from the others', () => {
    expect(isCleaningSeason({ start: [4, 1], end: [12, 1] })).toBe(true);
    expect(isCleaningSeason({ start: [3, 15], end: [11, 15] })).toBe(true);
    expect(isCleaningSeason({ start: [4, 1], end: [10, 31] })).toBe(false);
    expect(isCleaningSeason({ start: [12, 1], end: [3, 1] })).toBe(false);
    expect(isCleaningSeason({ months: [9, 6] })).toBe(false);
  });
});

describe('sides', () => {
  const east = [[-73.6, 45.5], [-73.59, 45.5]].map(xy);
  it('L is left looking from the first point to the last', () => {
    expect(along(east, xy([-73.595, 45.5001])).side).toBe('L');    // north of an eastbound line
    expect(along(east, xy([-73.595, 45.4999])).side).toBe('R');
  });
  it('reads a point outside a bend on the right side', () => {
    const bend = [[0, 0], [100, 0], [100, 100]];                  // east, then north: the outside of the bend is southeast
    expect(along(bend, [110, -10]).side).toBe('R');
    expect(along(bend, [90, 10]).side).toBe('L');
  });
  it('names the sides in the street grid\'s directions (grid north is 57° west of true north)', () => {
    expect(GRID_ANGLE).toBe(57);
    const up = [[-73.740805, 45.51896], [-73.741926, 45.519667]];     // avenue Adhémar-Mailhiot: up the grid, true northwest
    expect(compass(up, 'L')).toBe('West');
    expect(compass(up, 'R')).toBe('East');
    expect(compass(up, 'L', 0)).toBe('Southwest');                    // in true north, as Boston names them
    expect(compass(up, 'R', 0)).toBe('Northeast');
    // rue Sherbrooke Est between rue Saint-Donat and avenue Mercier (Géobase 1450639): the mountain side is north
    const sherbrooke = [[-73.532426, 45.601004], [-73.531981, 45.601747]];
    expect(compass(sherbrooke, 'L')).toBe('North');
    expect(compass(sherbrooke, 'R')).toBe('South');
    // a street running true north is a diagonal on the grid
    const trueNorth = [[-73.6, 45.5], [-73.6, 45.51]];
    expect(compass(trueNorth, 'L')).toBe('Northwest');
    expect(compass(trueNorth, 'R')).toBe('Southeast');
  });
  it('puts the real poles of a block on their sides (avenue Adhémar-Mailhiot, ID_TRC 1010001)', () => {
    const g = [[-73.740805, 45.51896], [-73.740875, 45.518989], [-73.740927, 45.519021], [-73.741887, 45.51964], [-73.741926, 45.519667]].map(xy);
    expect(along(g, xy([-73.741702, 45.519445])).side).toBe('L');    // pole 139224, "\P 10h-11h MERCREDI 1 AVRIL AU 1 DEC"
    expect(along(g, xy([-73.741062, 45.519185])).side).toBe('R');    // pole 139219, "\P 9h30-10h30 JEUDI 1 AVRIL AU 1 DEC"
  });
  it('simplifies a line by at most the tolerance', () => {
    expect(simplify([[0, 0], [50, 0.5], [100, 0]], 1)).toEqual([[0, 0], [100, 0]]);
    expect(simplify([[0, 0], [50, 3], [100, 0]], 1)).toHaveLength(3);
  });
});

describe('names', () => {
  it('writes streets as Montréal does', () => {
    expect(streetName({ ODONYME: 'Rue Saint-Denis ', TYP_VOIE: 'rue' })).toBe('rue Saint-Denis');
    expect(streetName({ ODONYME: "Boulevard de l'Acadie ", TYP_VOIE: 'boulevard' })).toBe("boulevard de l'Acadie");
    expect(streetName({ ODONYME: 'Avenue du Mont-Royal Est', TYP_VOIE: 'avenue' })).toBe('avenue du Mont-Royal Est');
    expect(streetName({ ODONYME: '6e Avenue', TYP_VOIE: 'avenue' })).toBe('6e Avenue');
    expect(streetName({ ODONYME: 'Le Boulevard', TYP_VOIE: null })).toBe('Le Boulevard');
  });
  it('writes boroughs as montreal.ca does', () => {
    expect(boroughName('Côte-des-Neiges-Notre-Dame-de-Grâce')).toBe('Côte-des-Neiges–Notre-Dame-de-Grâce');
    expect(boroughName('Mercier - Hochelaga-Maisonneuve')).toBe('Mercier–Hochelaga-Maisonneuve');
    expect(boroughName('Rosemont-La Petite-Patrie')).toBe('Rosemont–La Petite-Patrie');
    expect(boroughName('Ville-Marie')).toBe('Ville-Marie');
    expect(boroughName('N/A')).toBe('');
  });
});

describe('holidays', () => {
  it('lists Québec\'s statutory holidays by rule', () => {
    expect(Object.keys(quebecHolidays(2026))).toEqual(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-18', '2026-06-24',
      '2026-07-01', '2026-09-07', '2026-10-12', '2026-12-25']);
    expect(quebecHolidays(2027)).toMatchObject({ '2027-03-26': 'Good Friday', '2027-05-24': "National Patriots' Day", '2027-10-11': 'Thanksgiving' });
  });
});

describe('parseCSV', () => {
  it('reads quoted fields with commas and backslashes', () => {
    const { rows } = parseCSV('A,B,C\n41,"\\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC","Mercier - Hochelaga-Maisonneuve"\n1,"say ""hi"", ok",\n');
    expect(rows).toEqual([{ A: '41', B: String.raw`\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC`, C: 'Mercier - Hochelaga-Maisonneuve' }, { A: '1', B: 'say "hi", ok', C: '' }]);
  });
});

// The page and the alert server read segments.json through lib/city.js: the decoded rules must give the right sweeps.
describe('with lib/city.js', () => {
  beforeAll(async () => { await import('../../lib/sweep-core.js'); await import('../../lib/city.js'); });
  afterEach(() => { vi.useRealTimers(); });
  const cfg = { id: 'montreal', tz: 'America/Toronto', center: [45.5249, -73.5901], zoom: 15, bounds: [[45.43, -73.75], [45.71, -73.47]],
    holidays: { ...quebecHolidays(2026), ...quebecHolidays(2027) }, holidayRule: 'all' };
  const block = (rules) => ({ c: '1', s: 'rue Test', l: 'A - B', g: [[-73.59, 45.52], [-73.589, 45.521]], d: [['L', 'Northwest', rules]] });
  const next = (text) => { const city = globalThis.makeCity(cfg); return city.core.nextSweep(city.rowsOf(block(decodeRpa(text).rules))[0]); };
  it('finds the next Wednesday morning, in Montréal time', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T16:00:00Z'));        // Sunday Oct 18, noon in Montréal
    const n = next(String.raw`\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC`);
    expect([n.mo, n.da]).toEqual([10, 21]);
    expect(n.start.toISOString()).toBe('2026-10-21T12:30:00.000Z');                // 8:30 EDT
  });
  it('keeps the sweep on a holiday (Thanksgiving, Monday Oct 12, 2026)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T16:00:00Z'));
    const n = next(String.raw`\P 8h30-11h30 LUNDI 1AVRIL AU 1DEC`);
    expect([n.mo, n.da]).toEqual([10, 12]);
  });
  it('stops after November and starts again in April', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-28T16:00:00Z'));        // Saturday Nov 28
    const n = next(String.raw`\P 10h-11h MARDI 1 AVRIL AU 1 DEC`);
    expect([n.y, n.mo, n.da]).toEqual([2027, 4, 6]);                               // Dec 1 is not in the months
  });
  it('runs a window past midnight into the next morning', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T16:00:00Z'));
    const n = next(String.raw`\P 23H30-0h30 MARDI JEUDI 1 AVRIL AU 1 DEC`);
    expect([n.mo, n.da]).toEqual([10, 20]);
    expect(n.end.toISOString()).toBe('2026-10-21T04:30:00.000Z');                  // Wednesday 0:30 EDT
  });
});
