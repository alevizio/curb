// San Mateo's data check (scripts/cities/san-mateo.mjs): the signs' words (SignedNoParking_10_2019), the schedule's words
// (StreeSweep_Times, September 2026), the street key, the side a signed piece runs along, and the comparison, on real
// values from the City's layers.
import { describe, it, expect } from 'vitest';
import { parseDays, parseWeeks, parseSignTime, parseSweepTime, signRules, scheduleRules, streetKey, streetIndex, signSides, compare } from './san-mateo.mjs';

describe('the signs\' and the schedule\'s words', () => {
  it('reads days', () => {
    expect(parseDays('THU')).toEqual([4]);
    expect(parseDays('MWF')).toEqual([1, 3, 5]);
    expect(parseDays('M/W/F')).toEqual([1, 3, 5]);
    expect(parseDays('WEDNESDAY')).toEqual([3]);
    expect(parseDays('SPT')).toBe(null);
  });
  it('reads weeks, and leaves "BI-WEEKLY" (every other week) unread', () => {
    expect(parseWeeks('1/3')).toBe(5);
    expect(parseWeeks('2/4')).toBe(10);
    expect(parseWeeks('1st/3rd')).toBe(5);
    expect(parseWeeks('2nd/4th')).toBe(10);
    expect(parseWeeks('WEEKLY')).toBe(31);
    expect(parseWeeks('BI-WEEKLY')).toBe(null);
  });
  it('reads a sign\'s hours, the meridiem said once for the end', () => {
    expect(parseSignTime('7-9 AM')).toEqual([7, 9]);
    expect(parseSignTime('4-6 AM')).toEqual([4, 6]);
    expect(parseSignTime('11-1 PM')).toEqual([11, 13]);
    expect(parseSignTime('12-2 PM')).toEqual([12, 14]);
    expect(parseSignTime('7-7:30 AM')).toEqual([7, '7:30']);
    expect(parseSignTime('8 to 10')).toBe(null);
  });
  it('reads the schedule\'s sweep times', () => {
    expect(parseSweepTime('5:00am to 7:00am')).toEqual([5, 7]);
    expect(parseSweepTime('NOON to 2:00pm')).toEqual([12, 14]);
    expect(parseSweepTime('11:30am to 2:00pm')).toEqual(['11:30', 14]);
    expect(parseSweepTime('8:30am to 10:30am')).toEqual(['8:30', '10:30']);
    expect(parseSweepTime(' ')).toBe(null);
  });
  it('turns a real sign and a real schedule record into rules', () => {
    expect(signRules({ Route: '10B', Day_: 'THU', Week: '2/4', Time_: '8-10 AM', ST_NAME: 'STUDIO', Type: 'CIR' })).toEqual([[4, 8, 10, 10, 0, 0]]);
    expect(signRules({ Route: 'DT', Day_: 'MWF', Week: 'WEEKLY', Time_: '4-6 AM' })).toEqual([[1, 4, 6, 31, 0, 0], [3, 4, 6, 31, 0, 0], [5, 4, 6, 31, 0, 0]]);
    expect(scheduleRules({ NEW_DAY: 'TUESDAY', NEW_WEEK: '1st/3rd', SWEEP_TIME: '7:00am to 9:00am' })).toEqual([[2, 7, 9, 5, 0, 0]]);
    expect(scheduleRules({ NEW_DAY: 'SATURDAY', NEW_WEEK: 'BI-WEEKLY', SWEEP_TIME: '3:00am to 7:00am' })).toBe(null);
  });
});

describe('streetKey: one key for the signs, the parcels and the centerline', () => {
  it('drops the direction and the type, and leading zeros', () => {
    expect(streetKey('S CLAREMONT', 'ST')).toBe('CLAREMONT');
    expect(streetKey('CLAREMONT ST N')).toBe('CLAREMONT');
    expect(streetKey('01ST AVE')).toBe('1ST');
    expect(streetKey('1ST', 'AVE')).toBe('1ST');
    expect(streetKey('EL CAMINO REAL', ' ')).toBe('EL CAMINO REAL');
    expect(streetKey('N BAYSHORE BLVD')).toBe(streetKey('BAYSHORE', 'BLVD'));
  });
});

describe('signSides and compare', () => {
  // A centerline drawn west to east, and a signed piece 9 m north of it (the layer draws signs along the curb).
  const street = { key: 'RAMONA', properties: {}, geometry: { type: 'LineString', coordinates: [[-122.3300, 37.5600], [-122.3280, 37.5600]] } };
  const other = { key: 'POPLAR', properties: {}, geometry: { type: 'LineString', coordinates: [[-122.3300, 37.5601], [-122.3280, 37.5601]] } };
  const nearest = streetIndex([street, other]);
  const sign = (lat) => ({ geometry: { type: 'LineString', coordinates: [[-122.3297, lat], [-122.3283, lat]] } });
  it('puts a signed piece on the side of its own street it runs along', () => {
    expect(signSides(sign(37.56008), 'RAMONA', nearest)).toEqual([expect.objectContaining({ si: 0, side: 'L' })]);   // north of a west-east line: left
    expect(signSides(sign(37.55992), 'RAMONA', nearest)).toEqual([expect.objectContaining({ si: 0, side: 'R' })]);
    expect(signSides(sign(37.5603), 'RAMONA', nearest)).toEqual([]);                                                   // 33 m off: no side
  });
  it('compares a sign with today\'s schedule: days and weeks first, then hours', () => {
    const s = [[2, 7, 9, 5, 0, 0]];
    expect(compare(s, [[2, 7, 9, 5, 0, 0]])).toBe('agree');
    expect(compare(s, [[2, 9, 11, 5, 0, 0]])).toBe('hours differ');
    expect(compare(s, [[4, 7, 9, 5, 0, 0]])).toBe('days differ');
    expect(compare(s, [[2, 7, 9, 10, 0, 0]])).toBe('days differ');
    expect(compare(s, null)).toBe('no schedule');
  });
});
