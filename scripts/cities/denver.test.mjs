// Denver: sweep codes, sign texts and blocks into CURB rules (scripts/cities/denver.mjs). Rows below are real segments of
// ODC_TRANS_STREET_L and real sign descriptions from the City's sign inventory (fetched 2026-10-18), trimmed to the fields
// the build reads.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decodeSweep, dayRule, sweepPart, parseDaySign, parseNightSign, nightRules, titleStreet, oddSide, compass, sideOf,
  SEASON, HOURS, NOON_HOURS, HOLIDAYS } from './denver.mjs';

// N Pennsylvania St, E 13th Ave to E 14th Ave (MASTERID 4340), drawn north; odd numbers on the left (west)
const penn = { MASTERID: 4340, FULLNAME: 'N PENNSYLVANIA ST', FROMNAME: 'E 13TH AVE/TRAFFIC SIGNAL', TONAME: 'E 14TH AVE/TRAFFIC SIGNAL',
  L_F_ADD: 1301, L_T_ADD: 1399, R_F_ADD: 1300, R_T_ADD: 1398, LEFTSWEEP: '13', RIGHTSWEEP: '14', SSSID: '211111Y1' };
const pennLine = [[-104.981097, 39.736884], [-104.981081, 39.738431]];
// W 10th Ave, N Utica St to the signal (MASTERID 20461), drawn west; odd numbers on the right (north)
const tenth = { MASTERID: 20461, FULLNAME: 'W 10TH AVE', L_F_ADD: 4500, L_T_ADD: 4550, R_F_ADD: 4455, R_T_ADD: 4549, LEFTSWEEP: '26', RIGHTSWEEP: '25', SSSID: '221111Y1' };
const tenthLine = [[-105.045148, 39.733044], [-105.04552, 39.733046]];

describe('sweep codes', () => {
  it('reads week of the month, then weekday (1 = Sunday, so 3 = Tuesday)', () => {
    expect(decodeSweep('23')).toEqual({ week: 2, dow: 2 });   // 2nd Tuesday
    expect(decodeSweep(penn.LEFTSWEEP)).toEqual({ week: 1, dow: 2 });    // 1st Tuesday (the City's lookup: "West side: 1st Tuesday")
    expect(decodeSweep(penn.RIGHTSWEEP)).toEqual({ week: 1, dow: 3 });   // 1st Wednesday
    expect(decodeSweep('36')).toEqual({ week: 3, dow: 5 });   // 3rd Friday
    expect(decodeSweep('45')).toEqual({ week: 4, dow: 4 });   // 4th Thursday
  });
  it('has no day rule for a week with no set day, night sweeping, streets the City does not maintain, or no data', () => {
    for (const c of ['10', '20', '30', '40', 'N', 'NDM', '2X', '', null, undefined]) expect(decodeSweep(c)).toBe(null);
  });
  it('makes a monthly rule: one week of the month, 8 AM to 5 PM, April to November, towable', () => {
    expect(SEASON).toBe(2040);
    expect(HOURS).toEqual([8, 17]);
    expect(dayRule({ week: 2, dow: 2 })).toEqual([2, 8, 17, 2, 2040, 2]);
    expect(dayRule({ week: 4, dow: 5 }, NOON_HOURS)).toEqual([5, 8, 12, 8, 2040, 2]);
    expect(dayRule({ week: 1, dow: 4 }, [8, 16.5])).toEqual([4, 8, '16:30', 1, 2040, 2]);
  });
});

describe('sign texts (the City\'s sign inventory)', () => {
  it('reads the sweeping panel of a combination sign, not the other panel\'s hours', () => {
    expect(sweepPart('3 HR PAID PARK 8AM-7PM (LEFT) / STREET SWEEPING THURSDAY 2AM-6AM')).toBe('STREET SWEEPING THURSDAY 2AM-6AM');
    expect(sweepPart('STREET SWEEPING 1ST TUES (TOP)/ 2HR PARKING 8AM-6PM (BOTTOM')).toBe('STREET SWEEPING 1ST TUES (TOP)');
  });
  it('reads a daytime sign\'s week, day and hours', () => {
    expect(parseDaySign('STREET SWEEPING 1ST THURSDAY 8AM-5PM')).toEqual({ week: 1, dow: 4, to: 17 });
    expect(parseDaySign('STREET SWEEPING NO PARKING THIS SIDE 2ND TUESDAY APR THRU NOV 8AM - 5PM (TAZ)/RESERVED PARKING (RIGHT)')).toEqual({ week: 2, dow: 2, to: 17 });
    expect(parseDaySign('STREET SWEEPING 1ST TUESDAY 8AM-12NOON TAZ')).toEqual({ week: 1, dow: 2, to: 12 });
    expect(parseDaySign('STREET SWEEPING 3RD WEDNESDAY')).toEqual({ week: 3, dow: 3, to: null });
    expect(parseDaySign('NO PARKING ANYTIME TAZ (LEFT)/STREET SWEEPING 1ST FRIDAY TAZ (RIGHT)')).toEqual({ week: 1, dow: 5, to: null });
    // the 8AM-6PM is the 2-hour parking panel's
    expect(parseDaySign('STREET SWEEPING 1ST WEDNESDAY (TOP)/ 2HR PARKING 8AM-6PM(BOTTOM)')).toEqual({ week: 1, dow: 3, to: null });
  });
  it('reads overnight signs: nights, weeks and hours', () => {
    expect(parseNightSign('STREET SWEEPING 2AM-6AM MONDAY AND WEDNESDAY TAZ')).toEqual({ days: [1, 3], weeks: 31, from: 2, to: 6, fixed: false });
    expect(parseNightSign('STREET SWEEPING SIGN 2AM-6AM TUESDAY AND THURSDAY TAZ')).toEqual({ days: [2, 4], weeks: 31, from: 2, to: 6, fixed: false });
    expect(parseNightSign('STREET SWEEPING THURSDAY 2AM-6AM')).toEqual({ days: [4], weeks: 31, from: 2, to: 6, fixed: false });
    expect(parseNightSign('STREET SWEEPING 2ND AND 4TH MONDAY 2AM-8AM')).toEqual({ days: [1], weeks: 10, from: 2, to: 8, fixed: false });
    expect(parseNightSign('NO PARKING ANYTIME (LEFT) STREET SWEEPING 3RD MONDAY 2AM-6AM ( RIGHT)')).toEqual({ days: [1], weeks: 4, from: 2, to: 6, fixed: false });
    expect(parseNightSign('SWEEP, MONDAY AND WEDNESDAY, 0206, TAZ')).toEqual({ days: [1, 3], weeks: 31, from: 2, to: 6, fixed: false });
    expect(parseNightSign('STREET SWEEPING TUES&THURS 2AM-6AM')).toEqual({ days: [2, 4], weeks: 31, from: 2, to: 6, fixed: false });
  });
  it('fixes "2AM-6PM" to 6 AM, skips another panel\'s night hours, and needs a day', () => {
    expect(parseNightSign('STREET SWEEPING 2AM-6PM MONDAY & WEDNESDAY')).toEqual({ days: [1, 3], weeks: 31, from: 2, to: 6, fixed: true });
    expect(parseNightSign('Pass loading 5AM-2AM Loading only all times ( left) Street sweeping  Tuesday & Thursday 2AM-6AM (right)'))
      .toEqual({ days: [2, 4], weeks: 31, from: 2, to: 6, fixed: false });
    expect(parseNightSign('PASSENGER LOADING 5PM-2AM (LEFT) / STREET SWEEPING TUESDAY THURSDAY')).toBe(null);
    expect(parseNightSign('2 HR PARKING 6AM-6PM (BOTTOM)/ STREET SWEEPING 2AM-6AM (TOP)')).toBe(null);
    expect(parseNightSign('STREET SWEEPING 1ST THURSDAY 8AM-5PM')).toBe(null);
  });
  it('makes night rules for every night, all year, on holidays too', () => {
    expect(nightRules({ days: [1, 3], weeks: 31, from: 2, to: 6 })).toEqual([[1, 2, 6, 31, 0, 3], [3, 2, 6, 31, 0, 3]]);
  });
});

describe('blocks', () => {
  it('writes street names the way people say them', () => {
    expect(titleStreet('N PENNSYLVANIA ST')).toBe('N Pennsylvania St');
    expect(titleStreet('E 17TH AVENUE PKWY')).toBe('E 17th Avenue Pkwy');
    expect(titleStreet('W 10TH AVE')).toBe('W 10th Ave');
    expect(titleStreet('E 13TH AVE/TRAFFIC SIGNAL')).toBe('E 13th Ave/Traffic Signal');
  });
  it('finds the odd side from the address ranges, also with numbers on one side only', () => {
    expect(oddSide(penn)).toBe('L');
    expect(oddSide(tenth)).toBe('R');
    expect(oddSide({ L_F_ADD: 4901, L_T_ADD: 4999, R_F_ADD: 0, R_T_ADD: 0 })).toBe('L');   // E 17th Avenue Pkwy along a park
    expect(oddSide({ L_F_ADD: 0, L_T_ADD: 0, R_F_ADD: 754, R_T_ADD: 798 })).toBe('L');     // E Buchtel Blvd: evens on the right
  });
  it('labels sides by compass: west and east of a north-running street, south and north of a west-running one', () => {
    expect(compass(pennLine, 'L')).toBe('West');
    expect(compass(pennLine, 'R')).toBe('East');
    expect(compass(tenthLine, 'L')).toBe('South');
    expect(compass(tenthLine, 'R')).toBe('North');
  });
  it('puts a sign on the side of the line it stands on', () => {
    expect(sideOf(pennLine, [-104.98118, 39.7376]).side).toBe('L');   // west curb of N Pennsylvania St
    expect(sideOf(pennLine, [-104.98100, 39.7376]).side).toBe('R');
  });
});

describe('holidays', () => {
  it('lists the City\'s holidays for 2026 and 2027, with the observed dates', () => {
    expect(Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026'))).toHaveLength(12);
    expect(HOLIDAYS['2026-11-11']).toBe('Veterans Day');      // a 2nd Wednesday: the City's lookup leaves it out
    expect(HOLIDAYS['2026-11-26']).toBe('Thanksgiving Day');  // a 4th Thursday
    expect(HOLIDAYS['2027-12-31']).toMatch(/observed/);
  });
});

describe('data/denver/segments.json', () => {
  const file = new URL('../../data/denver/segments.json', import.meta.url);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  it.skipIf(!data || !data.b.length)('holds monthly day rules and overnight rules inside Denver', () => {
    let day = 0, night = 0;
    for (const b of data.b) {
      for (const [lng, lat] of b.g) { expect(lng).toBeGreaterThan(-105.12); expect(lng).toBeLessThan(-104.6); expect(lat).toBeGreaterThan(39.6); expect(lat).toBeLessThan(39.92); }
      for (const [side, , rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        for (const r of rules) {
          if (r[4] === 2040) { day++; expect([2, 3, 4, 5]).toContain(r[0]); expect([1, 2, 4, 8]).toContain(r[3]); expect(r[1]).toBe(8); expect([12, 17]).toContain(r[2]); expect(r[5]).toBe(2); }
          else { night++; expect(r[4]).toBe(0); expect(r[1]).toBeLessThanOrEqual(4); expect(r[2]).toBeLessThanOrEqual(8); expect(r[5]).toBe(3); }
        }
      }
    }
    expect(day).toBeGreaterThan(20000);
    expect(night).toBeGreaterThan(300);
  });
  it.skipIf(!data || !data.b.length)('keeps N Pennsylvania St, 13th to 14th: west side 1st Tuesday, east side 1st Wednesday, 8 to 5', () => {
    const b = data.b.find((x) => x.c === '4340');
    expect(b.s).toBe('N Pennsylvania St');
    expect(b.d).toEqual([['L', 'West', [[2, 8, 17, 1, 2040, 2]]], ['R', 'East', [[3, 8, 17, 1, 2040, 2]]]]);
  });
});
