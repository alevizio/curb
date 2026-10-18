// San Diego's data build (scripts/cities/san-diego.mjs): the schedule parser, the side placement, the ticket votes, the
// names and the holidays, on real rows of the City's Street Sweeping Schedule (data.sandiego.gov, 2026-05-05).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  parseSchedule, sideOf, compass, placeRules, ticketVotes, settle, buildSides, sweepsOn, streetName, streetKey,
  parseAddress, hoodName, stateplaneToLonLat, HOLIDAYS, EVEN_MONTHS, ODD_MONTHS,
} from './san-diego.mjs';

const ROOT = new URL('../../', import.meta.url);
const rule = (side, days, weeks, months, from, to, extra = {}) => ({ side, days, weeks, months, from, to, ...extra });

// Real segments (sapid, street, schedule, line), as the City publishes them.
const HAINES = { sapid: 'SS-012897', rd20full: 'HAINES ST', schedule: 'Posted (7am - 10am), NS 1st Thu, SS 1st Wed', llowaddr: '4000', rlowaddr: '4001',
  g: [[-117.240439, 32.791933], [-117.240916, 32.793556]] };
const BROADWAY = { sapid: 'SS-004924', rd20full: 'BROADWAY', schedule: 'Posted (3am - 6am), NS Mon,Wed & Fri; SS Tue & Thu',
  g: [[-117.163825, 32.715717], [-117.162902, 32.71571]] };
const GLENROY = { sapid: 'SS-012254', schedule: 'Posted (7am - 11am), Even Month 1st Tue (NS/WS), Odd Month 1st Tue (SS/ES)',
  g: [[-117.077163, 32.797354], [-117.076982, 32.79753], [-117.076835, 32.79766], [-117.076708, 32.797765], [-117.076549, 32.797886]] };
const EL_CAJON = { sapid: 'SS-009960', schedule: 'Posted (2am - 5am), Every Tues & Wed', g: [[-117.047082, 32.76869], [-117.044854, 32.768735]] };

describe('parseSchedule: the schedule text, as written', () => {
  it('reads a side per part, with the hours said once for both', () => {
    expect(parseSchedule(HAINES.schedule).rules).toEqual([rule('N', [4], 1, 0, 7, 10), rule('S', [3], 1, 0, 7, 10)]);
  });
  it('reads odd and even months, with the side after the days', () => {
    expect(parseSchedule('Posted (10am - 1pm), Even Month 3rd Thu (ES), Odd Month 3rd Thu (WS)').rules)
      .toEqual([rule('E', [4], 4, EVEN_MONTHS, 10, 13), rule('W', [4], 4, ODD_MONTHS, 10, 13)]);
    expect(parseSchedule('Posted (7am-11am), ES 3rd THUR Even Month, WS 3rd THUR Odd Month').rules)
      .toEqual([rule('E', [4], 4, EVEN_MONTHS, 7, 11), rule('W', [4], 4, ODD_MONTHS, 7, 11)]);
  });
  it('reads several days for one side, across commas and semicolons', () => {
    expect(parseSchedule(BROADWAY.schedule).rules).toEqual([rule('N', [1, 3, 5], 31, 0, 3, 6), rule('S', [2, 4], 31, 0, 3, 6)]);
    expect(parseSchedule('Posted (3am - 6am), WS Mon,Wed,& Fri; ES Tue & Thu').rules).toEqual([rule('W', [1, 3, 5], 31, 0, 3, 6), rule('E', [2, 4], 31, 0, 3, 6)]);
  });
  it('reads a window per side with the days said once at the end', () => {
    expect(parseSchedule('Posted NS(10am - 1pm), SS(7am - 10am) 1st Mon').rules).toEqual([rule('N', [1], 1, 0, 10, 13), rule('S', [1], 1, 0, 7, 10)]);
    expect(parseSchedule('Posted, (7am-10am) NS, (10am-1pm) SS, 2nd Friday, Every Month').rules).toEqual([rule('N', [5], 2, 0, 7, 10), rule('S', [5], 2, 0, 10, 13)]);
    expect(parseSchedule('Posted, (10am - 1pm) WS, 3rd Mon (7am - 10am) ES, 3rd Mon').rules).toEqual([rule('W', [1], 4, 0, 10, 13), rule('E', [1], 4, 0, 7, 10)]);
  });
  it('reads a side named twice or by three letters as one diagonal side', () => {
    expect(parseSchedule(GLENROY.schedule).rules).toEqual([rule('NW', [2], 1, EVEN_MONTHS, 7, 11), rule('SE', [2], 1, ODD_MONTHS, 7, 11)]);
    expect(parseSchedule('Posted (7am - 11am), Even Month 1st Tue (SES), Odd Month 1st Tue (NWS)').rules.map((r) => r.side)).toEqual(['SE', 'NW']);
    expect(parseSchedule('Posted, (8am-10am) NS & WS Every Month 2nd Monday, (10am-12pm) SS & ES Every Month 2nd Monday').rules)
      .toEqual([rule('NW', [1], 2, 0, 8, 10), rule('SE', [1], 2, 0, 10, 12)]);
  });
  it('reads schedule2 as its own part, with its own hours', () => {
    expect(parseSchedule('Posted (10am - 1pm), SS 3rd Mon', 'Posted (7am - 10am), NS 3rd Mon').rules).toEqual([rule('S', [1], 4, 0, 10, 13), rule('N', [1], 4, 0, 7, 10)]);
  });
  it('reads weeks, overnight hours and noon', () => {
    expect(parseSchedule('Posted, WS 2nd & 4th Monday (12am-3am), ES 1st & 3rd Monday (12am-3am)').rules).toEqual([rule('W', [1], 10, 0, 0, 3), rule('E', [1], 5, 0, 0, 3)]);
    expect(parseSchedule('Posted (10am-12pm) SS Mon & Fri, NS Tue & Thu\n').rules).toEqual([rule('S', [1, 5], 31, 0, 10, 12), rule('N', [2, 4], 31, 0, 10, 12)]);
    expect(parseSchedule('Posted (12AM - 3AM), SS Thu, NS Fri').rules[0]).toEqual(rule('S', [4], 31, 0, 0, 3));
  });
  it('leaves out the sides that are not posted', () => {
    expect(parseSchedule('Posted, (10am to 1pm) ES 1st Monday, Not Posted, WS').rules).toEqual([rule('E', [1], 1, 0, 10, 13)]);
    expect(parseSchedule('Posted (2am - 6am), SS Fri, NS Not Posted Mon').rules).toEqual([rule('S', [5], 31, 0, 2, 6)]);
    expect(parseSchedule('Posted (10am - 1pm), ES 4th Mon', 'Not Posted, WS 2nd Mon').rules).toEqual([rule('E', [1], 8, 0, 10, 13)]);
    expect(parseSchedule('Posted ES Thu (12am - 3am), Not Posted, WS Fri').rules).toEqual([rule('E', [4], 31, 0, 0, 3)]);
  });
  it('puts days with no side on the side across from the one not posted, or on both sides', () => {
    expect(parseSchedule('Posted (8am - 10am), Tue & Fri, SS Not Posted', 'SS Not Posted').rules).toEqual([rule('N', [2, 5], 31, 0, 8, 10)]);
    expect(parseSchedule(EL_CAJON.schedule).rules).toEqual([rule('BOTH', [2, 3], 31, 0, 2, 5, { unnamed: true })]);
    expect(parseSchedule('Posted (12am - 3am), Both Sides Wed').rules).toEqual([rule('BOTH', [3], 31, 0, 0, 3)]);
    expect(parseSchedule('Posted Tue Both Sides (10am-12pm), Thu Both Sides (8am-10am)').rules).toEqual([rule('BOTH', [2], 31, 0, 10, 12), rule('BOTH', [4], 31, 0, 8, 10)]);
  });
  it('returns no rule, and says why, for the four posted segments it cannot read', () => {
    const red = parseSchedule('Red Curb ES Mon & Thu, WS Tue & Fri\r\n');
    expect(red.rules).toEqual([]);
    expect(red.problems).toContain('unknown word "RED"');
    expect(parseSchedule('Posted (12am-3am), WS, Not Posted, ES')).toEqual({ rules: [], problems: ['no day for W'] });
  });
  const cache = fileURLToPath(new URL('private/cache/san-diego/street_sweeping_datasd.geojson', ROOT));
  it.skipIf(!fs.existsSync(cache))('reads every posted schedule in the cached data but the two known ones (needs the raw download)', () => {
    const bad = new Set();
    for (const f of JSON.parse(fs.readFileSync(cache, 'utf8')).features) {
      if (f.properties.posted !== 'P') continue;
      const r = parseSchedule(f.properties.schedule, f.properties.schedule2);
      if (r.problems.length) bad.add(f.properties.schedule.trim());
    }
    expect([...bad].sort()).toEqual(['Posted (12am-3am), WS, Not Posted, ES', 'Red Curb ES Mon & Thu, WS Tue & Fri']);
  });
});

describe('sideOf and compass: which side of the line a compass side is', () => {
  it('puts north on the left of a line drawn eastward (Broadway)', () => {
    expect(sideOf(BROADWAY.g, 'N')).toEqual({ side: 'L', conf: expect.closeTo(1, 2) });
    expect(sideOf(BROADWAY.g, 'S').side).toBe('R');
    expect([compass(BROADWAY.g, 'L'), compass(BROADWAY.g, 'R')]).toEqual(['North', 'South']);
  });
  it('puts northwest on the left of a line drawn northeast (Glenroy St)', () => {
    expect(sideOf(GLENROY.g, 'NW')).toEqual({ side: 'L', conf: expect.closeTo(1, 1) });
    expect(sideOf(GLENROY.g, 'SE').side).toBe('R');
  });
  it('marks a "north side" on a street that runs north to south as ambiguous (Haines St)', () => {
    const { conf } = sideOf(HAINES.g, 'N');
    expect(conf).toBeLessThan(0.35);
    expect(sideOf(HAINES.g, 'W')).toEqual({ side: 'L', conf: expect.closeTo(0.96, 1) });
    expect(placeRules(parseSchedule(HAINES.schedule).rules, HAINES.g).map((p) => p.ambiguous)).toEqual([true, true]);
  });
});

describe('tickets settle what the text leaves open', () => {
  const t = (odd, iso) => { const [y, mo, da] = iso.split('-').map(Number); return { odd, y, mo, da }; };
  it('Haines St: the 1st Thursday ("NS") tickets are on the even, west side, so north means west there', () => {
    const placed = placeRules(parseSchedule(HAINES.schedule).rules, HAINES.g);
    const tickets = [...Array(6)].map(() => t(false, '2026-02-05')).concat([...Array(6)].map(() => t(true, '2026-02-04')));   // 1st Thu, 1st Wed
    const votes = ticketVotes(placed, tickets);
    expect(votes.axes).toEqual({ NS: { firstOdd: 0, firstEven: 12 } });
    const settled = settle(votes);
    expect(settled.axes).toEqual({ NS: false });
    const { sides } = buildSides(placed, HAINES.g, 'R', settled);      // odd numbers (4001-4099) on the right
    expect([...sides].map(([s, v]) => [s, v.label, [...v.rules.values()]])).toEqual([
      ['L', 'West', [[4, 7, 10, 1, 0, 0]]], ['R', 'East', [[3, 7, 10, 1, 0, 0]]]]);
  });
  it('without enough tickets, the compass guess stays (4 tickets are not enough)', () => {
    const placed = placeRules(parseSchedule(HAINES.schedule).rules, HAINES.g);
    const settled = settle(ticketVotes(placed, [...Array(4)].map(() => t(false, '2026-02-05'))));
    expect(settled.axes).toEqual({});
    const { sides, notes } = buildSides(placed, HAINES.g, 'R', settled);
    expect([...sides.keys()]).toEqual(['R', 'L']);
    expect(notes.map((n) => n.kind)).toEqual(['compass guess', 'compass guess']);
  });
  it('the street decides when the block cannot', () => {
    expect(settle({ axes: {}, days: {} }, { axes: { NS: { firstOdd: 1, firstEven: 30 } }, days: {} })).toEqual({ axes: { NS: false }, days: null, from: { NS: 'street' } });
  });
  it('El Cajon Blvd "Every Tues & Wed": Tuesday on the even side, Wednesday on the odd side, as its tickets are', () => {
    const placed = placeRules(parseSchedule(EL_CAJON.schedule).rules, EL_CAJON.g);
    expect(placed[0].ambiguous).toBe(true);
    const tickets = [...Array(8)].map(() => t(false, '2026-03-10')).concat([...Array(8)].map(() => t(true, '2026-03-11')), [t(true, '2026-03-10')]);
    const settled = settle(ticketVotes(placed, tickets));
    expect(settled.days).toEqual({ 2: 'even', 3: 'odd' });
    const { sides } = buildSides(placed, EL_CAJON.g, 'R', settled);
    expect([...sides].map(([s, v]) => [s, v.label, [...v.rules.values()]])).toEqual([
      ['L', 'North', [[2, 2, 5, 31, 0, 0]]], ['R', 'South', [[3, 2, 5, 31, 0, 0]]]]);
  });
  it('a two day rule whose days share a side is not split', () => {
    const placed = placeRules(parseSchedule(EL_CAJON.schedule).rules, EL_CAJON.g);
    const tickets = [...Array(8)].map(() => t(true, '2026-03-10')).concat([...Array(8)].map(() => t(true, '2026-03-11')));
    const { sides } = buildSides(placed, EL_CAJON.g, 'R', settle(ticketVotes(placed, tickets)));
    expect([...sides.get('L').rules.values()]).toEqual([[2, 2, 5, 31, 0, 0], [3, 2, 5, 31, 0, 0]]);
  });
  it('a clear side is never moved', () => {
    const placed = placeRules(parseSchedule(BROADWAY.schedule).rules, BROADWAY.g);
    expect(placed.some((p) => p.ambiguous)).toBe(false);
    const { sides } = buildSides(placed, BROADWAY.g, 'R', null);
    expect([...sides.keys()]).toEqual(['L', 'R']);
    expect(sides.get('L').label).toBe('North');
  });
});

describe('sweepsOn: weekday, week of the month and month', () => {
  it('reads the 1st Thursday and odd or even months', () => {
    expect(sweepsOn([4, 7, 10, 1, 0], 2026, 2, 5)).toBe(true);
    expect(sweepsOn([4, 7, 10, 1, 0], 2026, 2, 12)).toBe(false);
    expect(sweepsOn([4, 10, 13, 4, EVEN_MONTHS], 2026, 2, 19)).toBe(true);    // 3rd Thursday of February (even)
    expect(sweepsOn([4, 10, 13, 4, EVEN_MONTHS], 2026, 3, 19)).toBe(false);   // 3rd Thursday of March (odd)
    expect(sweepsOn([4, 10, 13, 4, ODD_MONTHS], 2026, 3, 19)).toBe(true);
  });
});

describe('names, addresses and coordinates', () => {
  it('writes street names the way people say them', () => {
    expect(['01ST AV', 'W POINT LOMA BL', 'CAM DEL ORO', '25TH (SB) ST', 'TORREY PINES (FTG) BL', 'AVNDA DE LA PLAYA', 'EAST MTN VIEW DR', 'A ST', 'LA JOLLA SCENIC S DR'].map(streetName))
      .toEqual(['1st Ave', 'W Point Loma Blvd', 'Camino del Oro', '25th St', 'Torrey Pines Blvd (frontage)', 'Avenida de la Playa', 'East Mountain View Dr', 'A St', 'La Jolla Scenic S Dr']);
    expect(hoodName('Mid-City:City Heights')).toBe('City Heights');
    expect(hoodName('Mid-City:Eastern Area')).toBe('Mid-City Eastern Area');
    expect(hoodName('Pacific Beach')).toBe('Pacific Beach');
  });
  it('reads a ticket address into a number and a street key the schedule shares', () => {
    expect(parseAddress('1100 28TH ST')).toEqual({ num: 1100, key: '28TH ST' });
    expect(parseAddress('3000 MISSION BLVD')).toEqual({ num: 3000, key: streetKey('MISSION BL') });
    expect(parseAddress('500 10TH AV').key).toBe(streetKey('10TH AV'));
    expect(streetKey('01ST AV')).toBe(streetKey('1ST AVE'));
    expect(parseAddress('WEST C/L 4900 PARAMOUNT DR')).toBeNull();
  });
  it('turns SANDAG state plane feet into longitude and latitude', () => {
    const [lon, lat] = stateplaneToLonLat(6279119.937, 1840176.065);   // a SANDAG address point downtown
    expect(lon).toBeCloseTo(-117.16857, 4);
    expect(lat).toBeCloseTo(32.71225, 4);
  });
});

describe('holidays', () => {
  it('lists the City\'s eleven 2026 holidays and twelve 2027 dates, all weekdays', () => {
    const y = (yr) => Object.keys(HOLIDAYS).filter((d) => d.startsWith(yr));
    expect(y('2026')).toHaveLength(11);
    expect(y('2027')).toHaveLength(12);   // Friday, Dec. 31, 2027 is New Year's Day 2028 (a Saturday) observed
    for (const d of Object.keys(HOLIDAYS)) expect([1, 2, 3, 4, 5]).toContain(new Date(d + 'T12:00:00Z').getUTCDay());
    expect(HOLIDAYS['2026-03-31']).toBe('Cesar Chavez Day');
    expect(HOLIDAYS['2026-07-03']).toMatch(/Independence/);
  });
  it('runs out at the end of 2027: extend it before then (fails from 2027-08-01)', () => {
    expect(new Date() < new Date('2027-08-01T00:00:00Z')).toBe(true);
  });
});

describe('data/san-diego (the committed build output)', () => {
  const seg = JSON.parse(fs.readFileSync(new URL('data/san-diego/segments.json', ROOT), 'utf8'));
  const city = JSON.parse(fs.readFileSync(new URL('data/san-diego/city.json', ROOT), 'utf8'));
  it('has every posted block once, with one or two sides and valid rules inside the city', () => {
    expect(seg.b.length).toBeGreaterThan(3000);
    expect(new Set(seg.b.map((b) => b.c)).size).toBe(seg.b.length);
    const [[s, w], [n, e]] = city.bounds;
    for (const b of seg.b) {
      expect(b.d.length).toBeGreaterThanOrEqual(1);
      expect(new Set(b.d.map(([side]) => side)).size).toBe(b.d.length);
      for (const [side, label, rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        expect(label).toMatch(/^(North|South|East|West)(east|west)?$/);
        for (const [dow, from, to, weeks, months, flags] of rules) {
          expect(dow).toBeGreaterThanOrEqual(1); expect(dow).toBeLessThanOrEqual(5);
          expect(typeof from).toBe('number'); expect(typeof to).toBe('number');
          expect(weeks).toBeGreaterThan(0); expect(weeks).toBeLessThanOrEqual(31);
          expect([0, EVEN_MONTHS, ODD_MONTHS]).toContain(months);
          expect(flags).toBe(0);
        }
      }
      for (const [lo, la] of b.g) { expect(la).toBeGreaterThanOrEqual(s - 0.01); expect(la).toBeLessThanOrEqual(n + 0.01); expect(lo).toBeGreaterThanOrEqual(w - 0.01); expect(lo).toBeLessThanOrEqual(e + 0.01); }
    }
  });
  it('keeps the real blocks above as the tickets show them', () => {
    const at = (c) => seg.b.find((b) => b.c === c);
    expect(at('SS-012897').d).toEqual([['L', 'West', [[4, 7, 10, 1, 0, 0]]], ['R', 'East', [[3, 7, 10, 1, 0, 0]]]]);
    expect(at('SS-009960').d).toEqual([['L', 'North', [[2, 2, 5, 31, 0, 0]]], ['R', 'South', [[3, 2, 5, 31, 0, 0]]]]);
    expect(at('SS-004924')).toMatchObject({ s: 'Broadway', l: '1st Ave - 2nd Ave', h: 'Downtown', n: [100, 199], o: 'R' });
  });
});

