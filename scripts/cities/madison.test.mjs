// Madison: posted street sweeping signs and the winter alternate side rule into CURB rules (scripts/cities/madison.mjs).
// Rows below are real signs and centerlines from the City's map services (fetched 2026-10-18), trimmed to the fields the
// build reads.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { clockMinutes, parseSign, sweepRule, winterDates, oddSide, compass, samples, kmlRings, inRings, SEASONS, WINTER, HOLIDAYS } from './madison.mjs';

describe('sign text', () => {
  it('reads clock times', () => {
    expect(clockMinutes('8AM')).toBe(480);
    expect(clockMinutes('10:30AM')).toBe(630);
    expect(clockMinutes('12PM')).toBe(720);
    expect(clockMinutes('Noon')).toBe(720);
    expect(clockMinutes('2PM')).toBe(840);
    expect(clockMinutes('12AM')).toBe(0);
    expect(clockMinutes('')).toBe(null);
  });
  it('a year-round sign: No Parking 8AM-12PM Thursdays (sign 396)', () => {
    const s = parseSign({ OBJECTID: 396, Type: 'SSA', Day: 'Thursdays', StartTime: '8AM', EndTime: '12PM', May1_Nov15: 'False', Mar16_Nov30: 'False',
      Restr_txt_full: 'No Parking 8AM-12PM Thursdays', DateRemoved: null });
    expect(sweepRule(s)).toEqual([4, 8, 12, 31, 0, 3]);
  });
  it('a seasonal sign: No Parking 10:30AM-2PM Mondays May1-Nov15 (sign 1084) runs May to November', () => {
    const s = parseSign({ OBJECTID: 1084, Type: 'SS', Day: 'Mondays', StartTime: '10:30AM', EndTime: '2PM', May1_Nov15: 'True', Mar16_Nov30: 'False',
      Restr_txt_full: 'No Parking 10:30AM-2PM Mondays May1-Nov15', DateRemoved: null });
    expect(sweepRule(s)).toEqual([1, '10:30', 14, 31, 2032, 3]);
    expect(SEASONS['MAY1-NOV15']).toBe(2032);
  });
  it('takes the season from the text when its flag is empty (sign 317, Mar16-Nov30)', () => {
    const s = parseSign({ OBJECTID: 317, Type: 'SS', Day: 'Mondays', StartTime: '8AM', EndTime: '11:30AM', May1_Nov15: 'False', Mar16_Nov30: null,
      Restr_txt_full: 'No Parking 8AM-11:30AM Mondays Mar16-Nov30', DateRemoved: null });
    expect(sweepRule(s)).toEqual([1, 8, '11:30', 31, 2044, 3]);
  });
  it('trusts the sign text over a mistyped field (sign 6059: StartTime 8PM, text 8AM)', () => {
    const s = parseSign({ OBJECTID: 6059, Day: 'Mondays', StartTime: '8PM', EndTime: '12PM', Restr_txt_full: 'No Parking 8AM-12PM Mondays' });
    expect(sweepRule(s)).toEqual([1, 8, 12, 31, 0, 3]);
  });
  it('reads "8am-Noon" and spaced dashes from the text when the fields are empty (signs 18894, 17285)', () => {
    expect(sweepRule(parseSign({ OBJECTID: 18894, Day: 'Tuesdays', StartTime: null, EndTime: null, Restr_txt_full: 'No Parking 8am-Noon Tuesdays' })))
      .toEqual([2, 8, 12, 31, 0, 3]);
    expect(sweepRule(parseSign({ OBJECTID: 17285, Day: 'Tuesdays', StartTime: '10:30AM', EndTime: '2PM', Restr_txt_full: 'No Parking 10:30AM - 2PM Tuesdays' })))
      .toEqual([2, '10:30', 14, 31, 0, 3]);
  });
  it('fixes "8AM-9:30PM" to 8 to 9:30 AM (sign 926) and says so', () => {
    const s = parseSign({ OBJECTID: 926, Day: 'Thursdays', StartTime: '8AM', EndTime: '9:30PM', Restr_txt_full: 'No Parking 8AM-9:30PM Thursdays' });
    expect(sweepRule(s)).toEqual([4, 8, '9:30', 31, 0, 3]);
    expect(s.fixed).toEqual({ was: [8, '21:30'], now: [8, '9:30'] });
  });
  it('leaves out removed signs and signs with no text or hours', () => {
    expect(parseSign({ OBJECTID: 20117, Day: 'Wednesdays', StartTime: '10:30AM', EndTime: '2PM', Restr_txt_full: 'No Parking 10:30AM-2PM Wednesdays', DateRemoved: 1698796800000 }))
      .toEqual({ skip: 'sign removed' });
    expect(parseSign({ OBJECTID: 18895, Day: 'Tuesdays', StartTime: null, EndTime: null, Restr_txt_full: null })).toEqual({ skip: 'no hours' });
  });
});

describe('the winter rule', () => {
  const { odd, even } = winterDates();
  it(`covers ${WINTER.from} to ${WINTER.to}, every date once`, () => {
    expect(odd.length + even.length).toBe(121);
    expect(odd[0]).toBe('2026-11-15');
    expect(even[0]).toBe('2026-11-16');
    expect(odd[odd.length - 1]).toBe('2027-03-15');
    expect(new Set([...odd, ...even]).size).toBe(121);
  });
  it('splits dates by the day of the month: Dec 31 and Jan 1 are both odd', () => {
    expect(odd).toContain('2026-12-31');
    expect(odd).toContain('2027-01-01');
    expect(even).toContain('2027-02-28');
    expect(even).toContain('2027-03-02');
    expect(odd).not.toContain('2027-03-02');
  });
});

describe('the Snow Emergency Zone map', () => {
  const kml = '<kml><Document><Placemark><name>Snow Emergency Zone</name><Polygon><outerBoundaryIs><LinearRing><coordinates>\n'
    + '-89.40,43.06,0 -89.36,43.06,0 -89.36,43.09,0 -89.40,43.09,0 -89.40,43.06,0\n</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>';
  it('reads the polygon\'s coordinates from the KML', () => {
    const rings = kmlRings(kml);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual([-89.40, 43.06]);
    expect(rings[0]).toHaveLength(5);
  });
  it('tells a point inside from one outside', () => {
    const rings = kmlRings(kml);
    expect(inRings(rings, [-89.384, 43.0747])).toBe(true);    // Capitol Square
    expect(inRings(rings, [-89.30, 43.10])).toBe(false);
  });
  const file = new URL('../../private/cache/madison/snow-emergency-zone.kml', import.meta.url);
  it.skipIf(!fs.existsSync(file))('the City\'s map holds the isthmus and leaves out the far east side (cached copy)', () => {
    const rings = kmlRings(fs.readFileSync(file, 'utf8'));
    expect(rings).toHaveLength(1);
    expect(inRings(rings, [-89.3841, 43.0747])).toBe(true);   // Capitol Square
    expect(inRings(rings, [-89.3527, 43.0912])).toBe(true);   // Atwood Ave at Schenk's Corners, in the Atwood neighborhood
    expect(inRings(rings, [-89.2900, 43.1100])).toBe(false);  // the far east side
    expect(inRings(rings, [-89.5000, 43.0600])).toBe(false);  // the far west side
  });
});

describe('holidays', () => {
  it('lists the City\'s eight parking holidays for 2026 and 2027, on their calendar dates', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026'))).toHaveLength(8);
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027'))).toHaveLength(8);
    expect(HOLIDAYS['2026-07-04']).toBe('Independence Day');
    expect(HOLIDAYS['2026-11-27']).toBe(undefined);   // Ho-Chunk Day: offices close, parking is enforced
  });
});

describe('blocks', () => {
  it('finds the odd side from the address ranges, also with numbers on one side only', () => {
    expect(oddSide({ l_lo_addr: 101, l_hi_addr: 121, r_lo_addr: 100, r_hi_addr: 120 })).toBe('L');   // Ardmore Dr (ST06177)
    expect(oddSide({ l_lo_addr: 2, r_lo_addr: 1 })).toBe('R');
    expect(oddSide({ l_lo_addr: null, l_hi_addr: null, r_lo_addr: 4714, r_hi_addr: 4798 })).toBe('L');
    expect(oddSide({ l_lo_addr: null, r_lo_addr: null })).toBe(null);
  });
  it('labels the sides of a west-running block South (left) and North (right)', () => {
    const ardmore = [[-89.384195, 43.042811], [-89.385697, 43.042819], [-89.385789, 43.04284], [-89.385868, 43.042876]];
    expect(compass(ardmore, 'L')).toBe('South');
    expect(compass(ardmore, 'R')).toBe('North');
  });
  it('samples a sign line every 4 m, ends trimmed, with its direction', () => {
    const line = [[-89.33675463699107, 43.09662509354958], [-89.33636184797419, 43.096887036396424]];   // sign 1, about 43 m
    const s = samples(line);
    expect(s.length).toBeGreaterThan(8);
    expect(Math.hypot(...s[0].d)).toBeCloseTo(1, 6);
  });
});

describe('data/madison/segments.json', () => {
  const file = new URL('../../data/madison/segments.json', import.meta.url);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  it.skipIf(!data)('holds weekly sweeping rules and the winter rule (named date lists), inside Madison', () => {
    let weekly = 0, listed = 0;
    if (data._meta.winter) {
      expect(data.dates.odd.every((iso) => +iso.slice(8, 10) % 2 === 1)).toBe(true);
      expect(data.dates.even.every((iso) => +iso.slice(8, 10) % 2 === 0)).toBe(true);
      expect(data.dates.odd.length + data.dates.even.length).toBe(121);
    }
    for (const b of data.b) {
      for (const [lng, lat] of b.g) { expect(lng).toBeGreaterThan(-89.6); expect(lng).toBeLessThan(-89.2); expect(lat).toBeGreaterThan(42.98); expect(lat).toBeLessThan(43.2); }
      for (const [side, , rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        for (const r of rules) {
          // the winter rule: 1 to 7 AM, flags 7 (holidays too, towable, a winter rule), on one of the file's two lists
          if (r[0] === -1) { listed++; expect(r.slice(0, 6)).toEqual([-1, 1, 7, 0, 0, 7]); expect(['odd', 'even']).toContain(r[6]); }
          else { weekly++; expect(r[0]).toBeGreaterThanOrEqual(1); expect(r[0]).toBeLessThanOrEqual(5); expect(r[3]).toBe(31); }
        }
      }
      // a block side's winter dates are the other parity's: the odd side is closed on even dates
      if (b.o) {
        const oddSideRules = (b.d.find((d) => d[0] === b.o) || [])[2] || [];
        const w = oddSideRules.find((r) => r[0] === -1);
        if (w) expect(w[6]).toBe('even');
      }
    }
    expect(weekly).toBeGreaterThan(1000);
    if (data._meta.winter) expect(listed).toBeGreaterThan(1000);   // the default build; --without-winter leaves it out
    else expect(listed).toBe(0);
  });
  const city = JSON.parse(fs.readFileSync(new URL('../../data/madison/city.json', import.meta.url), 'utf8'));
  it.skipIf(!data || !data._meta.winter)('city.json carries the season the page and the alert server read, and the switch starts off', () => {
    expect(city.winter).toEqual(WINTER);
    const sw = JSON.parse(fs.readFileSync(new URL('../../data/madison/winter.json', import.meta.url), 'utf8'));
    expect(['waiting', 'on', 'paused']).toContain(sw.state);
  });
});
