// Washington, DC: decoding DDOT's Parking Zones into CURB rules (scripts/cities/washington-dc.mjs). Rows below are real
// zones and blocks from the District's data (fetched 2026-10-18), trimmed to the fields the build reads.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { slotMinutes, hm, jsDow, decodeZone, titleStreet, oddSide, compass, sideOf, marylandToLngLat, parseLocation, SEASON, HOLIDAYS }
  from './washington-dc.mjs';

const zone = (o) => ({ PARKINGGROUP: 'Sweeping', ...o });
const COMMON = new Set(['570-690', '750-870', '1320-300', '420-1140', '120-300', '60-300']);   // windows used by 20+ zones

describe('DDOT time slots and days', () => {
  it('reads 15-minute slots: minutes = 225 + 15 x slot', () => {
    expect(slotMinutes(23)).toBe(570);    // 9:30, the residential morning window's start
    expect(slotMinutes(31)).toBe(690);    // 11:30
    expect(slotMinutes(35)).toBe(750);    // 12:30
    expect(slotMinutes(43)).toBe(870);    // 2:30 PM
    expect(slotMinutes(13)).toBe(420);    // 7 AM ("7:00AM-8:30PM" on RPP signs is 13 to 67)
    expect(slotMinutes(67)).toBe(1230);   // 8:30 PM
    expect(slotMinutes(73)).toBe(1320);   // 10 PM (sign text "10pm-5am" is 73 to 5)
    expect(slotMinutes(5)).toBe(300);     // 5 AM
    expect(slotMinutes(81)).toBe(0);      // midnight ("7AM - MIDNIGHT" is 13 to 81)
    expect(slotMinutes(89)).toBe(120);    // 2 AM, on the zone's own day
  });
  it('reads DDOT\'s special codes: 0 = midnight, 97 to 99 blank, 100 "Anytime"', () => {
    expect(slotMinutes(0)).toBe(0);
    expect(slotMinutes(96)).toBe(225);   // 3:45 AM
    expect(slotMinutes(97)).toBe(null);
    expect(slotMinutes(100)).toBe(null);
    expect(slotMinutes(null)).toBe(null);
  });
  it('writes minutes as whole hours or "H:MM"', () => {
    expect(hm(570)).toBe('9:30');
    expect(hm(1320)).toBe(22);
    expect(hm(0)).toBe(0);
    expect(hm(875)).toBe('14:35');
  });
  it('turns DDOT days (1 = Monday .. 7 = Sunday) into JavaScript weekdays', () => {
    expect(jsDow(1)).toBe(1);
    expect(jsDow(4)).toBe(4);
    expect(jsDow(7)).toBe(0);
    expect(jsDow(8)).toBe(null);   // any day
    expect(jsDow(9)).toBe(null);   // school days
  });
});

describe('zones → rules', () => {
  it('a Wednesday morning zone: 9:30 to 11:30, every week, March to October', () => {
    const z = zone({ ZONEID: '0fe4bbb218c980276082db3c961576e2-right-2', SIDE: 'right', STARTDAY: 3, ENDDAY: 3, STARTTIME: 23, ENDTIME: 31,
      PARKINGDAYGROUP: 'Wednesday', PARKINGHOURGROUP: 'AM', DATA_ERRORS: 'Missing: | ' });
    expect(decodeZone(z, COMMON).rules).toEqual([[3, '9:30', '11:30', 31, 1020, 2]]);
    expect(SEASON).toBe(1020);
  });
  it('a Monday midday zone: 12:30 to 2:30 PM', () => {
    const z = zone({ ZONEID: '00292781fbb8fa2378947b07a88a1e5e-left-1', STARTDAY: 1, ENDDAY: 1, STARTTIME: 35, ENDTIME: 43 });
    expect(decodeZone(z, COMMON).rules).toEqual([[1, '12:30', '14:30', 31, 1020, 2]]);
  });
  it('Thursday 10 PM to Friday 5 AM is one night, on Thursday (DATA_ERRORS calls the day and time ranges invalid)', () => {
    const z = zone({ ZONEID: '00d26a63b6d3cc5c36907cd56256db04-left-3', STARTDAY: 4, ENDDAY: 5, STARTTIME: 73, ENDTIME: 5,
      DATA_ERRORS: 'Missing: | Invalid Day Range,Invalid Time Range' });
    expect(decodeZone(z, COMMON).rules).toEqual([[4, 22, 5, 31, 1020, 2]]);
  });
  it('a Wednesday 10 PM to 5 AM zone is Wednesday night (its tickets: Wed 10 to 11 PM and Thu 12 to 1 AM)', () => {
    const z = zone({ ZONEID: '085ebec9cc2aaa74b084bf4c566c0ccf-right-5', STARTDAY: 3, ENDDAY: 3, STARTTIME: 73, ENDTIME: 5 });
    expect(decodeZone(z, COMMON).rules).toEqual([[3, 22, 5, 31, 1020, 2]]);
  });
  it('a Thursday 2 AM to 5 AM zone is early Thursday (its tickets: Thu 2 to 4 AM)', () => {
    const z = zone({ ZONEID: '0dc6dec834942dc4096037b78fa3e71a-left-7', STARTDAY: 4, ENDDAY: 4, STARTTIME: 89, ENDTIME: 5 });
    expect(decodeZone(z, COMMON).rules).toEqual([[4, 2, 5, 31, 1020, 2]]);
  });
  it('"Full Day": 7 AM to 7 PM (its tickets start at 7 AM)', () => {
    const z = zone({ ZONEID: '00291aa0abb12fb220dfb9ece18c30a2-right-1', STARTDAY: 2, ENDDAY: 2, STARTTIME: 13, ENDTIME: 61, PARKINGHOURGROUP: 'Full Day' });
    expect(decodeZone(z, COMMON).rules).toEqual([[2, 7, 19, 31, 1020, 2]]);
  });
  it('leaves out a zone with no hours', () => {
    const z = zone({ ZONEID: '235f9e07bd74d91312c54d0c305562aa-right-2', STARTDAY: 8, ENDDAY: 8, STARTTIME: 100, ENDTIME: 100 });
    expect(decodeZone(z, COMMON)).toEqual({ skip: 'no hours' });
  });
  it('leaves out a night over several days ("Weekdays", 10 PM to 5 AM), which could be read two ways', () => {
    const z = zone({ ZONEID: 'a9768a467ba4c2c3fbc6de1aac5f6ec9-right-4', STARTDAY: 1, ENDDAY: 5, STARTTIME: 73, ENDTIME: 5 });
    expect(decodeZone(z, COMMON)).toEqual({ skip: 'night over several days' });
  });
  it('fixes an AM/PM slip when exactly one fix gives a common window', () => {
    const late = decodeZone(zone({ ZONEID: '0bff1fbcdfc1a74d93ed33d219cc1a00-left-5', STARTDAY: 4, ENDDAY: 4, STARTTIME: 23, ENDTIME: 79 }), COMMON);
    expect(late.rules).toEqual([[4, '9:30', '11:30', 31, 1020, 2]]);
    expect(late.fixed).toEqual({ was: ['9:30', '23:30'], now: ['9:30', '11:30'] });
    const pm = decodeZone(zone({ ZONEID: '45aa84581f7f777ceb8416b271930271-left-2', STARTDAY: 4, ENDDAY: 4, STARTTIME: 35, ENDTIME: 91 }), COMMON);
    expect(pm.rules).toEqual([[4, '12:30', '14:30', 31, 1020, 2]]);
    const both = decodeZone(zone({ ZONEID: '17ca8ac4336329d4a85c2485503f3587-left-1', STARTDAY: 1, ENDDAY: 1, STARTTIME: 71, ENDTIME: 79 }), COMMON);
    expect(both.rules).toEqual([[1, '9:30', '11:30', 31, 1020, 2]]);
  });
  it('leaves out a long window no single fix explains', () => {
    expect(decodeZone(zone({ STARTDAY: 1, ENDDAY: 1, STARTTIME: 13, ENDTIME: 67 }), COMMON)).toEqual({ skip: 'window over 12 hours' });
  });
  it('leaves out a zone DDOT notes has no sign, and reads a plaque with another season', () => {
    expect(decodeZone(zone({ STARTDAY: 2, ENDDAY: 2, STARTTIME: 23, ENDTIME: 31, SIGNTEXT: 'no sign posted' }), COMMON)).toEqual({ skip: 'no sign on the street (DDOT field note)' });
    expect(decodeZone(zone({ STARTDAY: 2, ENDDAY: 2, STARTTIME: 23, ENDTIME: 31, SIGNTEXT: 'MARCH 1 THRU DECEMBER 31 EXCEPT HOLIDAYS' }), COMMON).rules)
      .toEqual([[2, '9:30', '11:30', 31, 4092, 2]]);
  });
  it('repeats a daytime window over a range of days', () => {
    expect(decodeZone(zone({ STARTDAY: 1, ENDDAY: 3, STARTTIME: 23, ENDTIME: 31 }), COMMON).rules.map((r) => r[0])).toEqual([1, 2, 3]);
  });
});

describe('blocks', () => {
  // DDOT Roadway Block 8983811fbb030047bbcc944751e04dc3, 1600 block of 1st St NE, drawn north (increasing measure)
  const firstSt = { ROUTENAME: '1ST ST NE', ADDRESS_RANGE_LEFT_LOW: 1600, ADDRESS_RANGE_LEFT_HIGH: 1618, ADDRESS_RANGE_RIGHT_LOW: 1601, ADDRESS_RANGE_RIGHT_HIGH: 1619 };
  const firstStLine = [[-77.00655, 38.911125], [-77.006549, 38.911198], [-77.006547, 38.911404], [-77.006547, 38.911518], [-77.006548, 38.911793], [-77.006548, 38.911866]];
  it('writes street names the way people say them', () => {
    expect(titleStreet('1ST ST NE')).toBe('1st St NE');
    expect(titleStreet('MARTIN LUTHER KING JR AVE SE')).toBe('Martin Luther King Jr Ave SE');
    expect(titleStreet('EAST CAPITOL ST BN')).toBe('East Capitol St');
    expect(titleStreet('O ST NW')).toBe('O St NW');
    expect(titleStreet('MCLEAN AVE NW')).toBe('McLean Ave NW');
  });
  it('finds the odd side from the address ranges', () => {
    expect(oddSide(firstSt)).toBe('R');
    expect(oddSide({ ADDRESS_RANGE_LEFT_LOW: 5300, ADDRESS_RANGE_RIGHT_LOW: 5301 })).toBe('R');   // Macomb St NW
    expect(oddSide({ ADDRESS_RANGE_LEFT_LOW: 0, ADDRESS_RANGE_RIGHT_LOW: 0 })).toBe(null);
  });
  it('labels a north-running block\'s left side West and right side East', () => {
    expect(compass(firstStLine, 'L')).toBe('West');
    expect(compass(firstStLine, 'R')).toBe('East');
  });
  it('tells which side of the line a point is on', () => {
    expect(sideOf(firstStLine, [-77.0066, 38.9115]).side).toBe('L');   // west of 1st St NE
    expect(sideOf(firstStLine, [-77.0065, 38.9115]).side).toBe('R');
  });
});

describe('tickets', () => {
  it('projects Maryland State Plane meters to longitude and latitude', () => {
    const [lng, lat] = marylandToLngLat(401482.75, 137579.37);   // 1300 block of Childress St NE (its LATITUDE/LONGITUDE: 38.906, -76.983)
    expect(lng).toBeCloseTo(-76.98291, 4);
    expect(lat).toBeCloseTo(38.90607, 4);
  });
  it('reads the street and side from LOCATION, cut off or not', () => {
    expect(parseLocation('1300 BLOCK QUEEN ST NE WEST SIDE')).toEqual({ street: 'QUEEN ST NE', side: 'WEST' });
    expect(parseLocation('BLOCK OF 800 9TH ST NE WEST SIDE')).toEqual({ street: '9TH ST NE', side: 'WEST' });
    expect(parseLocation('1300 BLOCK CHILDRESS ST NE EAST *')).toEqual({ street: 'CHILDRESS ST NE', side: 'EAST' });
    expect(parseLocation('1700 BLOCK P ST NW SOUTH SI*').side).toBe('SOUTH');
    expect(parseLocation('BLOCK 2453 18TH ST NW').side).toBe(null);
  });
});

describe('holidays', () => {
  it('lists the District\'s legal holidays for 2026 and 2027, with the observed dates', () => {
    const y26 = Object.keys(HOLIDAYS).filter((d) => d.startsWith('2026')), y27 = Object.keys(HOLIDAYS).filter((d) => d.startsWith('2027'));
    expect(y26.length).toBe(12);
    expect(HOLIDAYS['2026-04-16']).toBe('DC Emancipation Day');
    expect(HOLIDAYS['2026-07-03']).toMatch(/observed/);
    expect(y27).toContain('2027-12-24');
    expect(y27).toContain('2027-12-31');   // New Year's Day 2028 falls on a Saturday
  });
});

describe('data/washington-dc/segments.json', () => {
  const file = new URL('../../data/washington-dc/segments.json', import.meta.url);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  it.skipIf(!data)('holds well-formed blocks inside the District', () => {
    const LABELS = new Set(['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast']);
    const t = (v) => typeof v === 'number' ? v >= 0 && v <= 24 : /^\d{1,2}:\d{2}$/.test(v);
    expect(data.b.length).toBeGreaterThan(1500);
    for (const b of data.b) {
      expect(typeof b.c).toBe('string');
      expect(b.g.length).toBeGreaterThan(1);
      for (const [lng, lat] of b.g) { expect(lng).toBeGreaterThan(-77.12); expect(lng).toBeLessThan(-76.9); expect(lat).toBeGreaterThan(38.79); expect(lat).toBeLessThan(39.0); }
      for (const [side, label, rules] of b.d) {
        expect(['L', 'R']).toContain(side);
        expect(LABELS.has(label)).toBe(true);
        for (const r of rules) {
          expect(r).toHaveLength(6);
          expect(r[0]).toBeGreaterThanOrEqual(0); expect(r[0]).toBeLessThanOrEqual(6);
          expect(t(r[1]) && t(r[2])).toBe(true);
          expect(r[3]).toBe(31); expect([1020, 4092]).toContain(r[4]); expect(r[5]).toBe(2);   // one plaque reads March 1 thru December 31
        }
      }
    }
  });
  it.skipIf(!data)('keeps 1st St NE, Q St to Quincy Pl: West side Wednesday, East side Tuesday and Thursday, 12:30 to 2:30', () => {
    const b = data.b.find((x) => x.c === '8983811fbb030047bbcc944751e04dc3');
    expect(b.s).toBe('1st St NE');
    expect(b.l).toBe('Q St NE - Quincy Pl NE');
    expect(b.o).toBe('R');
    expect(b.d).toEqual([['L', 'West', [[3, '12:30', '14:30', 31, 1020, 2]]],
      ['R', 'East', [[2, '12:30', '14:30', 31, 1020, 2], [4, '12:30', '14:30', 31, 1020, 2]]]]);
  });
});
