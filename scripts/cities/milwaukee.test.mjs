// Milwaukee: night parking's alternate side rule and the winter ban on through highways and bus routes into CURB rules
// (scripts/cities/milwaukee.mjs). Rows below are real centerlines and DPW listing rows (fetched 2026-10-18), trimmed to the
// fields the build reads.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { streetName, oddSide, nightLists, alternateRule, banRule, classify, parseListing, LISTING_CLASS, compass, samples, inRings,
  YEAR, WINTER, HOURS, HOLIDAYS } from './milwaukee.mjs';

describe('street names', () => {
  it('reads the City\'s names as people write them', () => {
    expect(streetName({ StreetDirection: 'S', StreetName: '1ST', StreetType: 'PL' })).toBe('S 1st Pl');                     // OBJECTID 15
    expect(streetName({ StreetDirection: 'W', StreetName: 'GLENDALE', StreetType: 'AV' })).toBe('W Glendale Ave');           // 22878
    expect(streetName({ StreetDirection: 'W', StreetName: 'FOND DU LAC', StreetType: 'AV' })).toBe('W Fond du Lac Ave');     // 21768
    expect(streetName({ StreetDirection: 'W', StreetName: 'MC KINLEY', StreetType: 'AV' })).toBe('W McKinley Ave');          // 31506
    expect(streetName({ StreetDirection: 'N', StreetName: 'MARTIN L KING JR', StreetType: 'DR' })).toBe('N Martin L King Jr Dr'); // 801242
    expect(streetName({ StreetDirection: 'W', StreetName: 'CAPITOL', StreetType: 'SV' })).toBe('W Capitol Service Dr');      // 900932
  });
});

describe('odd and even sides', () => {
  it('finds the side with odd numbers from the left and right ranges', () => {
    // S 1st Pl 3400-3499 (OBJECTID 15): left 3400-3498, right 3401-3499
    expect(oddSide({ FromLeftAddress: 3400, ToLeftAddress: 3498, FromRightAddress: 3401, ToRightAddress: 3499 })).toBe('R');
    // W Glendale Ave 9100-9199 (22878): left 9101-9199
    expect(oddSide({ FromLeftAddress: 9101, ToLeftAddress: 9199, FromRightAddress: 9100, ToRightAddress: 9198 })).toBe('L');
  });
  it('gives a street numbered on one side the other parity across, and nothing without numbers', () => {
    expect(oddSide({ FromLeftAddress: 0, ToLeftAddress: 0, FromRightAddress: 3928, ToRightAddress: 3998 })).toBe('L');
    expect(oddSide({ FromLeftAddress: 101, ToLeftAddress: 199, FromRightAddress: 0, ToRightAddress: 0 })).toBe('L');
    expect(oddSide({ FromLeftAddress: 0, ToLeftAddress: 0, FromRightAddress: 0, ToRightAddress: 0 })).toBe(null);
  });
  it('labels the sides of a west-running block South (left) and North (right), a south-running one East and West', () => {
    const glendale = [[-88.026092, 43.101309], [-88.027571, 43.101318]];
    expect(compass(glendale, 'L')).toBe('South');
    expect(compass(glendale, 'R')).toBe('North');
    const firstPl = [[-87.911949, 42.98241], [-87.911948, 42.981043]];
    expect(compass(firstPl, 'L')).toBe('East');
    expect(compass(firstPl, 'R')).toBe('West');
  });
  it('samples a line every 5 m, ends trimmed', () => {
    const s = samples([[0, 0], [100, 0]]);
    expect(s.length).toBe(19);
    expect(s[0].p).toEqual([4, 0]);
    expect(s[0].d).toEqual([1, 0]);
  });
  it('tells a point inside a ring from one outside', () => {
    const ring = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    expect(inRings(ring, [5, 5])).toBe(true);
    expect(inRings(ring, [15, 5])).toBe(false);
  });
});

describe('the nights', () => {
  const L = nightLists();
  const sunday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay() === 0;
  it(`lists the year's mornings ${YEAR.from} to ${YEAR.to}, 2 to 6 AM, but Sundays and the holiday mornings`, () => {
    expect(HOURS).toEqual({ start: 2, end: 6 });
    const all = [...L.odd, ...L.even];
    expect(all.some(sunday)).toBe(false);
    for (const iso of ['2026-11-26', '2026-11-27', '2026-12-25', '2026-12-26', '2027-01-01', '2027-01-02', '2027-07-04', '2027-07-05']) expect(all).not.toContain(iso);
    expect(L.odd.filter((iso) => L.even.includes(iso))).toEqual([]);
    expect(all.length).toBe(L.odd.length + L.even.length);
    expect(all.length).toBeGreaterThan(320);
  });
  it('closes the side from the evening\'s date ("before midnight"), not the morning\'s', () => {
    // the night of Wed Sep 30 (even) into Thu Oct 1: cars park on the even side, so the odd side is closed
    expect(L.even[0]).toBe('2026-10-01');
    expect(L.odd[0]).toBe('2026-10-02');
    // Sun Jan 31 (odd) into Mon Feb 1: still the odd side, though Feb 1 is odd too
    expect(L.odd).toContain('2027-02-01');
    const eve = (iso) => +new Date(Date.parse(iso + 'T12:00:00Z') - 864e5).toISOString().slice(8, 10);
    expect(L.odd.every((iso) => eve(iso) % 2 === 1)).toBe(true);
    expect(L.even.every((iso) => eve(iso) % 2 === 0)).toBe(true);
  });
  it('splits the year at the winter months: blue streets alternate only then, red ones the rest of the year', () => {
    const inWinter = (iso) => iso >= WINTER.from && iso <= WINTER.to;
    expect([...L.wodd, ...L.weven].every(inWinter)).toBe(true);
    expect([...L.sodd, ...L.seven].some(inWinter)).toBe(false);
    expect(L.wodd.length + L.sodd.length).toBe(L.odd.length);
    expect(L.weven.length + L.seven.length).toBe(L.even.length);
  });
  it('bans night parking on red streets on the winter mornings but Sundays and holidays (DPW, 2026-10-22)', () => {
    expect(L.ban[0]).toBe(WINTER.from);
    expect(L.ban[L.ban.length - 1]).toBe(WINTER.to);
    expect(L.ban).toHaveLength(71);   // 90 winter mornings, less 13 Sundays and 6 holiday mornings
    expect(L.ban).not.toContain('2026-12-06');   // a Sunday
    expect(L.ban).not.toContain('2026-12-25');   // Christmas
    expect(L.ban).toEqual([...L.wodd, ...L.weven].sort());   // the mornings the blue streets alternate
  });
  it('starts winter after 8 PM on December 1 (DPW, 2026-10-22): its first morning is December 2', () => {
    expect(WINTER.from).toBe('2026-12-02');
    expect(L.ban).not.toContain('2026-12-01');
    expect(L.seven).toContain('2026-12-01');   // the night of Nov 30 (even) still follows the standard rule
    expect(L.weven).not.toContain('2026-12-01');
  });
  it('writes the rules as listed dates, named once', () => {
    expect(alternateRule('even')).toEqual([-1, 2, 6, 0, 0, 6, 'even']);   // towable side-switching rule
    expect(banRule()).toEqual([-1, 2, 6, 0, 0, 14, 'ban']);               // and closing both sides
  });
});

describe('holidays', () => {
  it('lists the seven night parking holidays of 2026 and 2027 and the morning after each (MCO 101-27-7-a)', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026'))).toHaveLength(14);
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027'))).toHaveLength(14);
    expect(HOLIDAYS['2027-01-18']).toBe('Martin Luther King Jr. Day');
    expect(HOLIDAYS['2027-01-19']).toMatch(/morning after/);
    expect(HOLIDAYS['2026-11-27']).toMatch(/Thanksgiving/);
    expect(HOLIDAYS['2026-12-31']).toBe(undefined);
  });
});

describe('the Exception Streets map', () => {
  it('puts the winter ban first, then both sides, then winter only alternate side (real coverages)', () => {
    expect(classify({ red: 0.55 })).toBe('ban');                          // N 21st St 3928-3999 (2455)
    expect(classify({ red: 0.29 })).toBe('alternate');                    // N 7th St 2900-2913 (798), past the red line's end at 2900
    expect(classify({ green: 0.5 })).toBe('both sides');                  // S 5th Pl 2300-2318 (477)
    expect(classify({ green: 0.33 })).toBe('alternate');                  // S 5th St 2600-2618 (556)
    expect(classify({ blue: 1 })).toBe('winter alternate');
    expect(classify({ red: 0.7, green: 1 })).toBe('ban');                 // "If a street is also red, follow red instructions"
  });
  it('reads DPW\'s listing of winter regulations that are not posted', () => {
    const html = '<table><tr><th>Address</th><th>Street</th><th>Click Restriction Type</th></tr><tr>\n\t<td class=\'parkingcell\' style=\'text-align:center;\'>100 - 745</td>\n\t<td class=\'parkingcell\'>S 1ST ST</td>\n\t<td class=\'parkingcell\'><a href=\'#letnum\' onclick="win=window.open(\'http://mpw.milwaukee.gov/park_info.htm#snowZone\', \'popup\', \'toolbar=no\');if(win.focus)win.focus();return false;">No Winter Parking/48 Hour Exception</a><br/></td>\n</tr><tr>\n\t<td class=\'parkingcell\' style=\'text-align:center;\'>2700 - 2999</td>\n\t<td class=\'parkingcell\'>W AUER AV</td>\n\t<td class=\'parkingcell\'><a href=\'#letnum\' onclick="window.open(\'http://mpw.milwaukee.gov/park_info.htm#alternateException\', \'_blank\', \'toolbar=no\')">Non Winter Exception to Alternate Side Night Parking</a></td>\n</tr></table>';
    const rows = parseListing(html);
    expect(rows).toEqual([
      { lo: 100, hi: 745, street: 'S 1ST ST', type: 'No Winter Parking/48 Hour Exception' },
      { lo: 2700, hi: 2999, street: 'W AUER AV', type: 'Non Winter Exception to Alternate Side Night Parking' },
    ]);
    expect(rows.map((r) => LISTING_CLASS[r.type])).toEqual(['ban', 'winter alternate']);
  });
  const cache = new URL('../../private/cache/milwaukee/', import.meta.url);
  it.skipIf(!fs.existsSync(new URL('exception-streets.json', cache)))('the cached map has both kinds of exception streets (cached copy)', () => {
    const ex = JSON.parse(fs.readFileSync(new URL('exception-streets.json', cache), 'utf8'));
    expect(ex.filter((f) => f.attributes.Layer === 'Level 2').length).toBeGreaterThan(1000);
    expect(ex.filter((f) => f.attributes.Layer === 'Level 1').length).toBeGreaterThan(10);
  });
  it.skipIf(!fs.existsSync(new URL('winter-listing.json', cache)))('the cached listing has its four main types (cached copy)', () => {
    const rows = parseListing(JSON.parse(fs.readFileSync(new URL('winter-listing.json', cache), 'utf8')));
    expect(rows.length).toBeGreaterThan(800);
    for (const t of Object.keys(LISTING_CLASS)) expect(rows.some((r) => r.type === t)).toBe(true);
  });
});

describe('data/milwaukee/segments.json', () => {
  const file = new URL('../../data/milwaukee/segments.json', import.meta.url);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  it.skipIf(!data)('holds the alternate side rule and the winter ban, on the file\'s named date lists, inside Milwaukee', () => {
    expect(data.dates).toEqual(nightLists());
    let alternate = 0, ban = 0;
    for (const b of data.b) {
      expect(typeof b.c).toBe('string');
      for (const [lng, lat] of b.g) { expect(lng).toBeGreaterThan(-88.1); expect(lng).toBeLessThan(-87.85); expect(lat).toBeGreaterThan(42.9); expect(lat).toBeLessThan(43.2); }
      for (const [side, , rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        for (const r of rules) {
          if (r[5] === 6) { alternate++; expect(r.slice(0, 6)).toEqual([-1, 2, 6, 0, 0, 6]); expect(['odd', 'even', 'wodd', 'weven', 'sodd', 'seven']).toContain(r[6]); }
          else { ban++; expect(r).toEqual([-1, 2, 6, 0, 0, 14, 'ban']); }
          // the odd side is closed on the nights cars park on the even side, and the other way
          if (b.o && r[5] === 6) expect(r[6].replace(/^[ws]/, '')).toBe(side === b.o ? 'even' : 'odd');
        }
      }
    }
    expect(alternate).toBeGreaterThan(25000);
    expect(ban).toBeGreaterThan(5000);
  });
  const city = JSON.parse(fs.readFileSync(new URL('../../data/milwaukee/city.json', import.meta.url), 'utf8'));
  it.skipIf(!data)('city.json carries the frame the page and the alert server read, and the switch is on', () => {
    expect(city.winter).toEqual({ ...YEAR, ...HOURS, night: 'evening', permit: true });
    expect(city.words.what).toBe('night parking');
    expect(city.holidays).toEqual(HOLIDAYS);
    for (const w of Object.values(city.words)) expect(w).not.toMatch(/[—–]| - /);   // no dashes as punctuation
    const sw = JSON.parse(fs.readFileSync(new URL('../../data/milwaukee/winter.json', import.meta.url), 'utf8'));
    expect(sw).toMatchObject({ state: 'on', from: YEAR.from });   // the ordinance applies every night
  });
});
