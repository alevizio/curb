// Cambridge's build (scripts/cities/cambridge.mjs): reading Schedule M (the City's 2014 street cleaning table, a PDF),
// its words, the 2025 tickets' places, and the side letters. The small PDF below is built the way the City's file is
// (one BT … ET block per cell, positions and kerning copied from it) with real rows.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { pdfCells, scheduleRows, parseDays, parseHours, streetKey, baseName, crossKind, ticketPlace, nthWeekday, sideFor, compass, SHIP_SHARE } from './cambridge.mjs';

const cell = (x, y, tj) => `BT\n1 0 0 1 ${x} ${y} Tm\n[${tj}] TJ\nET\n`;
const CONTENT = [
  'q\n/F1 9.96 Tf\n',
  cell(76.2, 535.54, '(Str)-3(ee)-3(t)'), cell(146.9, 535.54, '(Side)'), cell(207.74, 535.54, '(F)-2(ro)-7(m)'), cell(309.53, 535.54, '(To)'),
  cell(392.69, 535.54, '(Da)-6(y)-5(s)'), cell(461.71, 535.54, '(H)-4(o)-5(urs)'), cell(527, 548.16, '(I)3(ns)5(t)-3(a)-5(ll )'),
  // Aberdeen Ave N, Mt Auburn St to Huron Ave, 4th Wednesday 8AM-2PM (page 1, first row)
  cell(60.48, 521.02, '(A)11(b)-5(er)-5(d)-5(ee)-3(n)6( )-2(A)11(v)6(e)'), cell(152.78, 521.02, '(N)'), cell(192.26, 521.02, '(Mt )-4(A)11(u)6(b)-5(u)6(r)-3(n)6( )-2(St)'),
  cell(293.57, 521.02, '(Hu)5(r)-3(o)-5(n)6( )-2(A)11(v)6(e)'), cell(372.77, 521.02, '(4)-5(th)7( )-2(W)-7(ed)-7(n)6(esd)-3(ay)'), cell(453.55, 521.02, '(8)-5(A)11(M-)5(2)-5(P)-9(M)'),
  // Fairoaks St S (page 8): its To cell wraps over two lines, and it carries an install date and regulation number
  cell(307, 213.05, "(200'W of Cameron )"),
  cell(67, 200.33, '(Fairoaks St)'), cell(154, 200.33, '(S)'), cell(175, 200.33, "(26'W of Cameron Ave)"), cell(307, 200.33, '(Ave)'),
  cell(377, 200.33, '(3rd Thursday)'), cell(454, 200.33, '(8AM-2PM)'), cell(521, 200.33, '(1/2/2013)'), cell(584, 200.33, '(2012-010)'),
  // the page footer
  cell(345, 95.064, '(CITY OF CAMBRIDGE)'), cell(55, 57.984, '(Revision 9/15/2014)'),
  'Q\n',
].join('');
function pdf(content) {
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([Buffer.from('%PDF-1.5\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type/Pages/Count 1/Kids[ 3 0 R] >>\nendobj\n'
    + '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[ 0 0 792 612]/Contents 4 0 R>>\nendobj\n'
    + `4 0 obj\n<</Filter/FlateDecode/Length ${stream.length}>>\nstream\n`, 'latin1'), stream,
  Buffer.from('\nendstream\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n', 'latin1')]);
}

describe('Schedule M (PDF)', () => {
  it('reads each cell with its page and position, kerning removed', () => {
    const cells = pdfCells(pdf(CONTENT));
    expect(cells.find((c) => c.y === 521.02 && c.x === 60.48)).toEqual({ p: 1, x: 60.48, y: 521.02, t: 'Aberdeen Ave' });
    expect(cells.some((c) => c.t === "26'W of Cameron Ave")).toBe(true);
  });
  it('turns cells into rows, joining a wrapped cell and dropping the header and footer', () => {
    expect(scheduleRows(pdfCells(pdf(CONTENT)))).toEqual([
      { page: 1, street: 'Aberdeen Ave', side: 'N', from: 'Mt Auburn St', to: 'Huron Ave', days: '4th Wednesday', hours: '8AM-2PM' },
      { page: 1, street: 'Fairoaks St', side: 'S', from: "26'W of Cameron Ave", to: "200'W of Cameron Ave", days: '3rd Thursday', hours: '8AM-2PM',
        installed: '1/2/2013', installReg: '2012-010' },
    ]);
  });
  it('fails when the columns move or the header is gone', () => {
    expect(() => scheduleRows(pdfCells(pdf(CONTENT.replace('1 0 0 1 146.9 535.54 Tm', '1 0 0 1 250 535.54 Tm'))))).toThrow(/header "Side" moved/);
    expect(() => scheduleRows(pdfCells(pdf(CONTENT.replace('[(Str)-3(ee)-3(t)]', '[(Name)]'))))).toThrow(/no header/);
  });
});

describe('the table words', () => {
  it('reads the day and the hours', () => {
    expect(parseDays('4th Wednesday')).toEqual({ nth: 4, dow: 3 });
    expect(parseDays('1st Monday')).toEqual({ nth: 1, dow: 1 });
    expect(parseDays('None')).toBeNull();                                   // South St, page 22
    expect(parseHours('8AM-2PM')).toEqual([8, 14]);
    expect(parseHours('7am-10am')).toEqual([7, 10]);                       // Huron Ave, page 13
  });
  it('spells streets as the centerline does', () => {
    expect(streetKey('Mass Ave')).toBe('MASSACHUSETTS AVE');
    expect(streetKey('Alberta Terr')).toBe('ALBERTA TER');
    expect(streetKey('3rd St')).toBe('THIRD ST');
    expect(streetKey("O'Brien Hwy")).toBe('MONSIGNOR OBRIEN HWY');
    expect(streetKey('Fountian Terr')).toBe('FOUNTAIN TER');
    expect(baseName('ELM ST N')).toBe('ELM');
  });
  it('knows the cross street words that are a street end', () => {
    expect(['Dead End', 'Turn Around', 'Somerville Line', 'Belmont City Line', 'RR Tracks', 'Elm St (Somerville)', 'None', 'Huron Ave'].map(crossKind))
      .toEqual(['deadEnd', 'deadEnd', 'cityLine', 'cityLine', 'cityLine', 'cityLine', 'none', 'street']);
  });
});

describe('the 2025 tickets', () => {
  it('reads a ticket location: an address or a corner', () => {
    expect(ticketPlace('701 main st')).toEqual({ num: 701, street: 'MAIN ST' });
    expect(ticketPlace('1-2 gore st')).toEqual({ num: 1, street: 'GORE ST' });
    expect(ticketPlace('plympton st&memorial dr')).toEqual({ cross: ['PLYMPTON ST', 'MEMORIAL DR'] });
  });
  it('knows which weekday of the month a date is (5th weekdays are make-up days)', () => {
    expect(nthWeekday('2025-06-04T00:00:00.000')).toEqual({ nth: 1, dow: 3 });
    expect(nthWeekday('2025-06-30')).toEqual({ nth: 5, dow: 1 });
    expect(nthWeekday('2026-04-29')).toEqual({ nth: 5, dow: 3 });           // Patriots' Day make-up, from the City's page
  });
  it('ships only when the tickets agree with the table', () => expect(SHIP_SHARE).toBe(0.9));
});

describe('side letters', () => {
  const westToEast = [[-71.11, 42.37], [-71.10, 42.37]], southToNorth = [[-71.11, 42.36], [-71.11, 42.37]];
  it('a north side of a street drawn west to east is L', () => {
    expect(sideFor('N', westToEast)).toBe('L');
    expect(sideFor('S', westToEast)).toBe('R');
    expect(sideFor('E', southToNorth)).toBe('R');
    expect(compass(westToEast, 'L')).toBe('North');
  });
  it('a letter along the street cannot be told', () => {
    expect(sideFor('N', southToNorth)).toBeNull();
    expect(sideFor('N', [[-71.11, 42.36], [-71.1095, 42.37]], 0.35)).toBeNull();   // within about 20 degrees of north
  });
});

// The City's real file, when it is in the cache (private/cache/cambridge/, gitignored).
const PDF = fileURLToPath(new URL('../../private/cache/cambridge/schedule-m-2014.pdf', import.meta.url));
describe.skipIf(!fs.existsSync(PDF))('the cached Schedule M', () => {
  it('has its 946 rows, first to last', () => {
    const rows = scheduleRows(pdfCells(fs.readFileSync(PDF)));
    expect(rows.length).toBe(946);
    expect(rows[0]).toMatchObject({ street: 'Aberdeen Ave', side: 'N', from: 'Mt Auburn St', to: 'Huron Ave', days: '4th Wednesday', hours: '8AM-2PM' });
    expect(rows.at(-1)).toMatchObject({ street: 'York St', side: 'S', from: 'Willow St', to: 'Berkshire St', days: '1st Thursday' });
    expect(rows.find((r) => r.street === 'Fairoaks St').to).toBe("200'W of Cameron Ave");
    expect(rows.filter((r) => /^7am-10am$/i.test(r.hours)).length).toBe(33);
  });
});
