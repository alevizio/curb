// New York City: reading DOT's broom signs and joining them to the street centerlines (scripts/cities/new-york.mjs). Sign
// texts and rows are real: Parking Regulation Locations and Signs (nfid-uabd) and the CSCL centerline (inkn-q76z), fetched
// 2026-10-18 and trimmed to the fields the build reads. The last block checks the built data/new-york/ when it exists.
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { isBroomSign, parseSign, hm, rulesOf, streetKey, nameVariants, likeness, sameStreet, streetLabel, toLngLat, parseIcs,
  houseNumber, oddSide, ticketTime, ruleCovers, prepSegments, joinSigns } from './new-york.mjs';

const hhmm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
// a sign text → "<JS weekdays> <from>-<to>", or the parser's reason for reading nothing
const read = (text) => { const p = parseSign(text); return p.error || `${p.days.join('')} ${hhmm(p.from)}-${hhmm(p.to)}`; };

describe('broom signs', () => {
  it('reads the common designs', () => {
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 9AM-10:30AM <-> (SUPERSEDES SP-413C)')).toBe('14 9:00-10:30');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 11:30AM-1PM <-> (SUPERSEDES SP-361C)')).toBe('25 11:30-13:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) TUESDAY 9:30AM-11AM<-> (SUPERSEDES SP-382C)')).toBe('2 9:30-11:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY 11:30AM-1PM --> (SUPERSEDES SP-379CA & SP-454CA)')).toBe('1 11:30-13:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY WEDNESDAY FRIDAY 11:30AM-1PM <-> (SUPERSEDES SP-544C)')).toBe('135 11:30-13:00');
  });
  it('reads "except Sunday" as Monday to Saturday and a dash between days as a range', () => {
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) 7:30AM-8AM EXCEPT SUNDAY <->')).toBe('123456 7:30-8:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY-FRIDAY 7:30AM-8AM <-> (SUPERSEDES SP-857C)')).toBe('12345 7:30-8:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) W/ (MOON/STARS SYMBOLS) TUESDAY THURSDAY SUNDAY 2AM-6AM --> (SUPERSEDES SP-45CA)')).toBe('024 2:00-6:00');
  });
  it('reads midnight and noon', () => {
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMBOLS) TUESDAY FRIDAY MIDNIGHT-3AM <-> (SUPERSEDES SP-841C)')).toBe('25 0:00-3:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMBOLS) WEDNESDAY 12AM-5AM <-> (SUPERSEDES SP-733C)')).toBe('3 0:00-5:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) TUESDAY 10:30AM-NOON <-> (SUPERSEDES SP-383C)')).toBe('2 10:30-12:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY NOON-1:30PM <-> (SUPERSEDES SP-362C)')).toBe('25 12:00-13:30');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 11AM-12:30PM <-> (SUPERSEDES SP-853C)')).toBe('14 11:00-12:30');
  });
  it('reads the old designs, hours first and days short', () => {
    expect(read("NO PARKING (SANITATION BROOM SYMBOL) 8:30-10AM TUES <--> (DON'T LITTER)(SUPERSEDED BY PS-28B)")).toBe('2 8:30-10:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) 11:30AM TO 1PM TUES & FRI <----> (SUPERSEDED BY PS-80B)')).toBe('25 11:30-13:00');
    expect(read('NIGHT REGULATION (MOON & STARS SYMBOLS) NO PARKING (SANITATION BROOM SYMBOL) MIDNIGHT TO-3AM MON WED FRI <->(SUPERSEDES SP-338C DATED 7-10-97)(SUPERSEDED BY PS-123B)')).toBe('135 0:00-3:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL)8AM 11AM TUES & THURS <---> (SUPERSEDES SP-175C DATED 5-24-84) (SUPERSEDED BY PS-169B)')).toBe('24 8:00-11:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) 9:30 -11AM FRI <-->SUPERSEDES SP-465C DATED 7-9-97(12X18)(SUPERSEDED BY PS-36B)')).toBe('5 9:30-11:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL)11:30AM-1PM FRI<--->SUPERSEDES SP-403C DATED 6-17-92) (SUPERSEDED BY PS-41B)')).toBe('5 11:30-13:00');
    expect(read('NO PARKING (SANITATION SYMBOL)8-9AM FRIDAY (SUPERSEDED BY PS-69B)')).toBe('5 8:00-9:00');
  });
  it('gets through the typos in the City\'s texts', () => {
    expect(read('NO PARKING (SANITATION BRROM SYMBOL) MOON & STARS (SYMBOLS) FRIDAY 3AM-6AM <-> (SUPERSEDES SP-554C)')).toBe('5 3:00-6:00');
    expect(read('NO PARKING (SANITATION BROOMM SYMBOL) FRIDAY 10:30AM-NOON --> (SUPERSEDES SP-401CA)')).toBe('5 10:30-12:00');
    expect(read('NO PARKING (SANITATIOJN BROOM SYMBOL) MOON & STARS (SYMBOLS) 3AM-6AM EXCEPT SUNDAY --> (SUPERSEDES SP-795CA)')).toBe('123456 3:00-6:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY WEDNESDAY THURDAY 9:30AM-11AM --> (SUPERSEDES SP-691CA)')).toBe('134 9:30-11:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDA 9AM-9:30AM <-> (SUPERSEDES SP-590C)')).toBe('14 9:00-9:30');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMBOLS) MODAY WEDNESDAY FRIDAY MIDNIGHT-8AM --> (SUPERSEDES SP-89CA)')).toBe('135 0:00-8:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MONDAY TUESDAY THU RSDAY FRIDAY 6AM-7:30AM -->')).toBe('1245 6:00-7:30');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 10A M-11:30AM --> (SUPERSEDES SP-847CA)')).toBe('25 10:00-11:30');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) SATURDAY 11:30AM-1 M --> (SUPERSEDES SP-409CA)')).toBe('6 11:30-13:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) 11:30AM TO 1 PM FRIW/ SINGLE ARROW (SUPERSEDES SP-403CA DATED 6-17-92)(SUPERSEDED BY PS-41BA)')).toBe('5 11:30-13:00');
    expect(read('NIGHT REGULATION (MOON & STARS SYMBOLS) NP PARKING (SANITATION BROOM SYMBOL) 3AM-6AM TUES & FRI <--> (SUPERSEDED BY SP-833C)')).toBe('25 3:00-6:00');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMB OLS) MONDAY FRIDAY MIDNIGHT-3AM <->')).toBe('15 0:00-3:00');
  });
  it('marks night signs, and lists words it does not know (a made-up sign)', () => {
    expect(parseSign('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMBOLS) MONDAY THURSDAY 3AM-6AM <-> (SUPERSEDES SP-842C)').night).toBe(true);
    expect(parseSign('NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 8AM-9:30AM <-> (SUPERSEDES SP-412C)').night).toBe(false);
    expect(parseSign('NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 8AM-9:30AM SCHOOL DAYS').unknown).toEqual(['SCHOOL', 'DAYS']);
  });
  it('leaves out signs that are not street cleaning, and broom signs without days or hours', () => {
    expect(isBroomSign('STAR (SYMBOL) AVO DEPT OF SANITATION MONDAY-FRIDAY 7AM-7PM <-> (SUPERSEDES PS-103E)')).toBe(false);
    expect(isBroomSign('BLUE COURSE (SANITATION RIDER)')).toBe(false);
    expect(read('NO STANDING ANYTIME <-> (SUPERSEDES SP-1044B, SP-10B, SP-216B & SP-270B)')).toBe('not a broom sign');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) <-> (SUPERSEDES SP-864C)')).toBe('no hours');
    expect(read('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMBOLS) <-> (SUPERSEDES SP-863C)')).toBe('no hours');
    expect(read('NO PARKING <----> SANITATION BROOM (SYMBOL) XYY-XYY "DAY" THRU "DAY" (TIMES & DAYS TO BE SPECIFIED) (FOR CIRCULAR BUS SIGNS)')).toBe('no hours');
  });
  it('writes rules in the format: whole hours as numbers, minutes as "H:MM", every week, all year, no flags', () => {
    expect([hm(540), hm(630), hm(0), hm(750), hm(1440)]).toEqual([9, '10:30', 0, '12:30', 24]);
    expect(rulesOf(parseSign('NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 9AM-10:30AM <-> (SUPERSEDES SP-413C)')))
      .toEqual([[1, 9, '10:30', 31, 0, 0], [4, 9, '10:30', 31, 0, 0]]);
    expect(rulesOf(parseSign('NO PARKING (SANITATION BROOM SYMBOL) MOON & STARS (SYMBOLS) TUESDAY FRIDAY MIDNIGHT-3AM <-> (SUPERSEDES SP-841C)')))
      .toEqual([[2, 0, 3, 31, 0, 0], [5, 0, 3, 31, 0, 0]]);
  });
});

describe('street names', () => {
  it('spells a street one way in both datasets', () => {
    expect(streetKey('EAST  115 STREET')).toBe(streetKey('E  115 ST'));
    expect(streetKey('MC CLELLAN STREET')).toBe(streetKey('MCCLELLAN ST'));
    expect(streetKey('B   69 STREET')).toBe(streetKey('BCH 69 ST'));
    expect(streetKey('THIRD AVENUE')).toBe(streetKey('3 AVE'));
    expect(streetKey('PELHAM PARKWAY SOUTH')).toBe(streetKey('PELHAM PKWY S'));
    expect(streetKey('CONEY IS AVENUE')).toBe(streetKey('CONEY ISLAND AVE'));
    expect(streetKey('WEST 110 STREET')).not.toBe(streetKey('W 111 ST'));
  });
  it('tries the roadway a sign\'s suffix names first, and the name without roadway words', () => {
    expect(nameVariants('ASTORIA BOULEVARD', 'N')).toEqual(['ASTORIABLVDN', 'ASTORIABLVD']);
    expect(nameVariants('QUEENS BOULEVARD', 'N S/R')[0]).toBe('QUEENSBLVDN');
    expect(nameVariants('37 AVENUE CENTER ROADWAY')).toContain('37AVE');
    expect(nameVariants('ASCH LOOP NORTH')).toContain('ASCHLOOP');
  });
  it('finds a misspelled cross street among the streets that meet the street, never another number', () => {
    expect(sameStreet(streetKey('BEVERLY ROAD'), streetKey('BEVERLEY RD'))).toBeGreaterThan(0.8);
    expect(sameStreet(streetKey('CONDUIT AVENUE'), streetKey('N CONDUIT AVE'))).toBeGreaterThan(0);
    expect(sameStreet(streetKey('MOWBRAY PLACE'), streetKey('MOWBRAY DR'))).toBeGreaterThan(0);
    expect(likeness(streetKey('EAST 18 STREET'), streetKey('E 19 ST'))).toBe(0);
    expect(sameStreet(streetKey('EAST 18 STREET'), streetKey('E 19 ST'))).toBe(0);
    expect(sameStreet(streetKey('PARK PLACE'), streetKey('PROSPECT PL'))).toBe(0);
  });
  it('writes CSCL labels the way people say them', () => {
    expect(streetLabel('W 115 ST')).toBe('W 115th St');
    expect(streetLabel('3 AVE')).toBe('3rd Ave');
    expect(streetLabel('E 111 ST')).toBe('E 111th St');
    expect(streetLabel('BCH 116 ST')).toBe('Beach 116th St');
    expect(streetLabel('AVE J')).toBe('Avenue J');
    expect(streetLabel('MC DONALD AVE')).toBe('McDonald Ave');
    expect(streetLabel('MAC DOUGAL ST')).toBe('MacDougal St');
    expect(streetLabel('AVE OF THE AMERICAS')).toBe('Avenue of the Americas');
    expect(streetLabel("O'BRIEN PL")).toBe("O'Brien Pl");
    expect(streetLabel('ADAM CLAYTON POWELL JR BLVD')).toBe('Adam Clayton Powell Jr Blvd');
    expect(streetLabel('32 AVE')).toBe('32nd Ave');
  });
});

describe('sign points', () => {
  it('turns State Plane feet (EPSG:2263) into longitude and latitude, as proj4 does', () => {
    // [x, y] in US feet → proj4 2.12 with EPSG:2263's definition
    for (const [x, y, lng, lat] of [[1002311, 228865, -73.934771071, 40.794839117], [913175, 120122, -74.255547359, 40.496097271],
      [1067382, 272844, -73.699217027, 40.915175049], [987000, 190000, -73.990084015, 40.688182415]]) {
      const [a, b] = toLngLat(x, y);
      expect(a).toBeCloseTo(lng, 8);
      expect(b).toBeCloseTo(lat, 8);
    }
  });
});

describe('the ASP suspension calendar', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DESCRIPTION:Alternate Side Parking suspended for Idul-Fitr (Eid Al-Fitr). Parking meters will be in effect.',
    'DTEND;VALUE=DATE:20260322', 'DTSTART;VALUE=DATE:20260320', 'SUMMARY;LANGUAGE=en-us:Alternate Side Parking Suspended', 'END:VEVENT',
    'BEGIN:VEVENT', 'DESCRIPTION:Alternate Side Parking suspended for Lunar New Year’s Eve. Parking meters will be in effect.',
    'DTEND;VALUE=DATE:20260217', 'DTSTART;VALUE=DATE:20260216', 'END:VEVENT',
    'BEGIN:VEVENT', 'DESCRIPTION:Alternate Side Parking suspended for Washington’s Birthday (Presidents Day). Par', '\tking meters will be in effect.',
    'DTEND;VALUE=DATE:20260217', 'DTSTART;VALUE=DATE:20260216', 'END:VEVENT',
    'BEGIN:VEVENT', 'DESCRIPTION:Alternate Side Parking suspended for All Saints\' Day. Parking meters will be in effect.',
    'DTEND;TZID="Eastern Standard Time":20261102T000000', 'DTSTART;TZID="Eastern Standard Time":20261101T000000', 'END:VEVENT',
    'BEGIN:VEVENT', 'DESCRIPTION:Alternate Side Parking suspended for the seventh and eighth days of Passover. Parking meters will be in effect',
    ' .', 'DTEND;VALUE=DATE:20260410', 'DTSTART;VALUE=DATE:20260408', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  it('lists every day off, two-day events as two days, with the City\'s names', () => {
    expect(parseIcs(ics)).toEqual({
      '2026-02-16': "Lunar New Year's Eve and Washington's Birthday (Presidents Day)",
      '2026-03-20': 'Idul-Fitr (Eid Al-Fitr)', '2026-03-21': 'Idul-Fitr (Eid Al-Fitr)',
      '2026-04-08': 'Passover (seventh and eighth days)', '2026-04-09': 'Passover (seventh and eighth days)',
      '2026-11-01': "All Saints' Day",
    });
  });
});

describe('house numbers, sides and ticket times', () => {
  it('reads Queens hyphenated numbers', () => {
    expect([houseNumber('22-001'), houseNumber('37-12'), houseNumber('145'), houseNumber(''), houseNumber('12A')]).toEqual([22001, 37012, 145, null, null]);
  });
  it('finds the odd side, also from a range CSCL starts at 0', () => {
    expect(oddSide(['2', '98', '1', '99'])).toBe('R');
    expect(oddSide(['240', '298', '0', '299'])).toBe('R');     // W 82 St, Broadway to West End Ave
    expect(oddSide(['22-001', '22-099', '22-000', '22-098'])).toBe('L');
    expect(oddSide([undefined, undefined, undefined, undefined])).toBe(null);
  });
  it('reads a ticket\'s time and whether a rule covers it', () => {
    expect(ticketTime('0910A')).toEqual({ min: 550, mer: 'A' });
    expect(ticketTime('0942P')).toEqual({ min: 1302, mer: 'P' });
    expect(ticketTime('1205A')).toEqual({ min: 5, mer: 'A' });
    expect(ticketTime('0909')).toEqual({ min: 549, mer: null });
    expect(ruleCovers([1, 9, '10:30', 31, 0, 0], 1, 600)).toBe(true);
    expect(ruleCovers([1, 9, '10:30', 31, 0, 0], 1, 630)).toBe(false);
    expect(ruleCovers([1, 9, '10:30', 31, 0, 0], 4, 600)).toBe(false);
    expect(ruleCovers([2, 0, 3, 31, 0, 0], 2, 90)).toBe(true);
    expect(ruleCovers([5, 23, 2, 31, 0, 0], 6, 60)).toBe(true);    // Friday 11 PM to Saturday 2 AM, at Saturday 1 AM
  });
});

// Real rows: CSCL lines around two blocks and every broom sign of their orders.
const FIX = {
  // W 82 St between Columbus Ave and Amsterdam Ave (Manhattan), both sides
  w82: {
    segs: [
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.977827547,40.783839031],[-73.977366398,40.784472696]]]},"physicalid":"3920","boroughcode":"1","full_street_name":"AMSTERDAM AVE","stname_label":"AMSTERDAM AVE","rw_type":"1","b5sc":"111710","l_low_hn":"418","l_high_hn":"436","r_low_hn":"419","r_high_hn":"439"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.973597567,40.784546383],[-73.9731352,40.785178402]]]},"physicalid":"2251","boroughcode":"1","full_street_name":"COLUMBUS AVE","stname_label":"COLUMBUS AVE","rw_type":"1","b5sc":"115710","l_low_hn":"480","l_high_hn":"498","r_low_hn":"479","r_high_hn":"497"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.974059477,40.783909375],[-73.976903344,40.785106071]]]},"physicalid":"89788","boroughcode":"1","full_street_name":"W  82 ST","stname_label":"W 82 ST","rw_type":"1","b5sc":"135410","l_low_hn":"100","l_high_hn":"198","r_low_hn":"101","r_high_hn":"199"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.970761425,40.783348392],[-73.972251869,40.783977973],[-73.972412475,40.784045813],[-73.972630294,40.784137819],[-73.97270747,40.784170418],[-73.973597567,40.784546383]]]},"physicalid":"172147","boroughcode":"1","full_street_name":"W  83 ST","stname_label":"W 83 ST","rw_type":"1","b5sc":"135430","l_low_hn":"2","l_high_hn":"98","r_low_hn":"1","r_high_hn":"99"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.971224216,40.78271451],[-73.974059477,40.783909375]]]},"physicalid":"89789","boroughcode":"1","full_street_name":"W  82 ST","stname_label":"W 82 ST","rw_type":"1","b5sc":"135410","l_low_hn":"2","l_high_hn":"98","r_low_hn":"1","r_high_hn":"99"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.97454175,40.783250792],[-73.974059477,40.783909375]]]},"physicalid":"2248","boroughcode":"1","full_street_name":"COLUMBUS AVE","stname_label":"COLUMBUS AVE","rw_type":"1","b5sc":"115710","l_low_hn":"438","l_high_hn":"458","r_low_hn":"439","r_high_hn":"459"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.976903344,40.785106071],[-73.976440778,40.785743154]]]},"physicalid":"3803","boroughcode":"1","full_street_name":"AMSTERDAM AVE","stname_label":"AMSTERDAM AVE","rw_type":"1","b5sc":"111710","l_low_hn":"458","l_high_hn":"478","r_low_hn":"459","r_high_hn":"479"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.977366398,40.784472696],[-73.978896351,40.785118114]]]},"physicalid":"72640","boroughcode":"1","full_street_name":"W  81 ST","stname_label":"W 81 ST","rw_type":"1","b5sc":"135390","l_low_hn":"200","l_high_hn":"236","r_low_hn":"201","r_high_hn":"235"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.977366398,40.784472696],[-73.976903344,40.785106071]]]},"physicalid":"3919","boroughcode":"1","full_street_name":"AMSTERDAM AVE","stname_label":"AMSTERDAM AVE","rw_type":"1","b5sc":"111710","l_low_hn":"438","l_high_hn":"456","r_low_hn":"441","r_high_hn":"457"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.97454175,40.783250792],[-73.977366398,40.784472696]]]},"physicalid":"72641","boroughcode":"1","full_street_name":"W  81 ST","stname_label":"W 81 ST","rw_type":"1","b5sc":"135390","l_low_hn":"100","l_high_hn":"198","r_low_hn":"101","r_high_hn":"199"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.973597567,40.784546383],[-73.976440778,40.785743154]]]},"physicalid":"3749","boroughcode":"1","full_street_name":"W  83 ST","stname_label":"W 83 ST","rw_type":"1","b5sc":"135430","l_low_hn":"100","l_high_hn":"198","r_low_hn":"101","r_high_hn":"199"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.974059477,40.783909375],[-73.973597567,40.784546383]]]},"physicalid":"2250","boroughcode":"1","full_street_name":"COLUMBUS AVE","stname_label":"COLUMBUS AVE","rw_type":"1","b5sc":"115710","l_low_hn":"460","l_high_hn":"478","r_low_hn":"461","r_high_hn":"477"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.976903344,40.785106071],[-73.977903357,40.785529687],[-73.977946329,40.78554789],[-73.978426899,40.785751458]]]},"physicalid":"183559","boroughcode":"1","full_street_name":"W  82 ST","stname_label":"W 82 ST","rw_type":"1","b5sc":"135410","l_low_hn":"0","l_high_hn":"238","r_low_hn":"201","r_high_hn":"239"},
    ],
    signs: [
      {"order_number":"S-376817","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"S","sign_code":"PS-55BA","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 11AM-12:30PM --> (SUPERSEDES SP-360CA)","distance_from_intersection":"154","sign_x_coord":"990799","sign_y_coord":"225209"},
      {"order_number":"S-376817","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"S","sign_code":"PS-55BA","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 11AM-12:30PM --> (SUPERSEDES SP-360CA)","distance_from_intersection":"518","sign_x_coord":"991117","sign_y_coord":"225032"},
      {"order_number":"S-376817","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"S","sign_code":"PS-55B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 11AM-12:30PM <-> (SUPERSEDES SP-360C)","distance_from_intersection":"39","sign_x_coord":"990699","sign_y_coord":"225265"},
      {"order_number":"S-01754745","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"N","sign_code":"PS-18BA","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 11AM-12:30PM --> (SUPERSEDES SP-853CA)","distance_from_intersection":"426","sign_x_coord":"991051","sign_y_coord":"225103"},
      {"order_number":"S-01754745","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"N","sign_code":"PS-18B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 11AM-12:30PM <-> (SUPERSEDES SP-853C)","distance_from_intersection":"268","sign_x_coord":"990913","sign_y_coord":"225179"},
      {"order_number":"S-01754745","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"N","sign_code":"PS-18B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 11AM-12:30PM <-> (SUPERSEDES SP-853C)","distance_from_intersection":"166","sign_x_coord":"990824","sign_y_coord":"225229"},
      {"order_number":"S-01754745","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"N","sign_code":"PS-18BA","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) MONDAY THURSDAY 11AM-12:30PM --> (SUPERSEDES SP-853CA)","distance_from_intersection":"53","sign_x_coord":"990692","sign_y_coord":"225284"},
      {"order_number":"S-376817","borough":"Manhattan","on_street":"WEST   82 STREET","from_street":"AMSTERDAM AVENUE","to_street":"COLUMBUS AVENUE","side_of_street":"S","sign_code":"PS-55B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) TUESDAY FRIDAY 11AM-12:30PM <-> (SUPERSEDES SP-360C)","distance_from_intersection":"409","sign_x_coord":"991022","sign_y_coord":"225085"},
    ],
  },
  // 141 St between Vleigh Pl and 77 Ave (Queens), east side; its signs have no points
  q141: {
    segs: [
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820650769,40.719429298],[-73.820447381,40.719403107],[-73.818398351,40.720010904]]]},"physicalid":"75038","boroughcode":"4","full_street_name":"78 AVE","stname_label":"78 AVE","rw_type":"1","b5sc":"416190","l_low_hn":"141-007","l_high_hn":"143-099","r_low_hn":"141-000","r_high_hn":"143-098"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820650769,40.719429298],[-73.820524817,40.719336555]]]},"physicalid":"189449","boroughcode":"4","full_street_name":"141 ST","stname_label":"141 ST","rw_type":"1","b5sc":"422740"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.821533866,40.721252993],[-73.821055291,40.720260895]]]},"physicalid":"100223","boroughcode":"4","full_street_name":"141 ST","stname_label":"141 ST","rw_type":"1","b5sc":"422740","l_low_hn":"77-001","l_high_hn":"77-029","r_low_hn":"77-000","r_high_hn":"77-028"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.821213739,40.719704237],[-73.821230437,40.719660598],[-73.821231059,40.719609981],[-73.821210616,40.719557935],[-73.821169042,40.719512134],[-73.821112319,40.71947916],[-73.821049885,40.719461673],[-73.820990326,40.719458096]]]},"physicalid":"100225","boroughcode":"4","full_street_name":"141 ST","stname_label":"141 ST","rw_type":"1","b5sc":"422740","l_low_hn":"77-051","l_high_hn":"77-099","r_low_hn":"78-000","r_high_hn":"78-002"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820990326,40.719458096],[-73.820650769,40.719429298]]]},"physicalid":"75041","boroughcode":"4","full_street_name":"78 AVE","stname_label":"78 AVE","rw_type":"1","b5sc":"416190","l_low_hn":"141-001","l_high_hn":"141-005","r_low_hn":"138-046","r_high_hn":"140-098"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820609679,40.720148646],[-73.820650769,40.719429298]]]},"physicalid":"84558","boroughcode":"4","full_street_name":"VLEIGH PL","stname_label":"VLEIGH PL","rw_type":"1","b5sc":"466690","l_low_hn":"77-037","l_high_hn":"77-099","r_low_hn":"77-034","r_high_hn":"77-098"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.821055291,40.720260895],[-73.821155258,40.720149792],[-73.821213739,40.719704237]]]},"physicalid":"100224","boroughcode":"4","full_street_name":"141 ST","stname_label":"141 ST","rw_type":"1","b5sc":"422740","l_low_hn":"77-031","l_high_hn":"77-049","r_low_hn":"77-030","r_high_hn":"77-098"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.823231568,40.719879198],[-73.822725062,40.719850963],[-73.822219567,40.719812361],[-73.821715603,40.719763432],[-73.821213739,40.719704237]]]},"physicalid":"10274","boroughcode":"4","full_street_name":"78 AVE","stname_label":"78 AVE","rw_type":"1","b5sc":"416190","l_low_hn":"138-001","l_high_hn":"140-099","r_low_hn":"138-000","r_high_hn":"138-044"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820072092,40.721054271],[-73.820065955,40.72094222],[-73.820065944,40.720942067],[-73.820065969,40.720941914],[-73.820082694,40.720827224],[-73.820082719,40.720827044],[-73.820082778,40.720826882],[-73.820123457,40.720713454],[-73.820123504,40.720713328],[-73.820123576,40.72071322],[-73.820187639,40.720605286],[-73.820187674,40.720605231],[-73.820187721,40.720605178],[-73.820272803,40.720506822],[-73.82027285,40.720506759],[-73.820272921,40.720506705],[-73.820375094,40.720421208],[-73.820375177,40.720421136],[-73.820375272,40.720421073],[-73.820489879,40.720350462],[-73.820609679,40.720148646]]]},"physicalid":"84557","boroughcode":"4","full_street_name":"VLEIGH PL","stname_label":"VLEIGH PL","rw_type":"1","b5sc":"466690","l_low_hn":"77-001","l_high_hn":"77-035","r_low_hn":"0","r_high_hn":"77-032"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820471701,40.719217176],[-73.820529561,40.719194415],[-73.820584388,40.719167659],[-73.820635708,40.719137139]],[[-73.820635708,40.719137139],[-73.820683076,40.719103121],[-73.820726081,40.719065899],[-73.820764351,40.719025796]]]},"physicalid":"95617","boroughcode":"4","full_street_name":"VLEIGH PL","stname_label":"VLEIGH PL","rw_type":"1","b5sc":"466690"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.823450174,40.720906639],[-73.82285839,40.721013602],[-73.821533866,40.721252993]]]},"physicalid":"10702","boroughcode":"4","full_street_name":"77 AVE","stname_label":"77 AVE","rw_type":"1","b5sc":"416040","l_low_hn":"138-001","l_high_hn":"138-049","r_low_hn":"138-000","r_high_hn":"140-098"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820471701,40.719217176],[-73.820223536,40.718701056]]]},"physicalid":"4524","boroughcode":"4","full_street_name":"141 ST","stname_label":"141 ST","rw_type":"1","b5sc":"422740","l_low_hn":"78-001","l_high_hn":"78-049","r_low_hn":"78-004","r_high_hn":"78-048"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820609679,40.720148646],[-73.820174665,40.720241558],[-73.818760915,40.720668254]]]},"physicalid":"23440","boroughcode":"4","full_street_name":"77 RD","stname_label":"77 RD","rw_type":"1","b5sc":"416090","l_low_hn":"141-001","l_high_hn":"143-099","r_low_hn":"141-000","r_high_hn":"143-098"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820524817,40.719336555],[-73.820471701,40.719217176]]]},"physicalid":"4525","boroughcode":"4","full_street_name":"141 ST","stname_label":"141 ST","rw_type":"1","b5sc":"422740"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.821533866,40.721252993],[-73.820634178,40.721415785],[-73.820162556,40.721501112]]]},"physicalid":"10703","boroughcode":"4","full_street_name":"77 AVE","stname_label":"77 AVE","rw_type":"1","b5sc":"416040","l_low_hn":"138-051","l_high_hn":"141-045","r_low_hn":"141-000","r_high_hn":"141-034"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820650769,40.719429298],[-73.820703093,40.719357633]],[[-73.820703093,40.719357633],[-73.820706186,40.719301709],[-73.820712143,40.71924592],[-73.820720953,40.71919035]],[[-73.820720953,40.71919035],[-73.820732603,40.719135083],[-73.820747077,40.719080204],[-73.820764351,40.719025796]]]},"physicalid":"189451","boroughcode":"4","full_street_name":"VLEIGH PL","stname_label":"VLEIGH PL","rw_type":"1","b5sc":"466690","l_low_hn":"78-001","l_high_hn":"78-013","r_low_hn":"78-000","r_high_hn":"78-014"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820764351,40.719025796],[-73.820923168,40.718710431]]]},"physicalid":"95616","boroughcode":"4","full_street_name":"VLEIGH PL","stname_label":"VLEIGH PL","rw_type":"1","b5sc":"466690","l_low_hn":"78-015","l_high_hn":"78-029","r_low_hn":"78-016","r_high_hn":"78-028"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.821055291,40.720260895],[-73.820976701,40.720274064],[-73.820892465,40.720274519],[-73.820808089,40.720260844],[-73.820729655,40.720233508],[-73.820662413,40.720194888],[-73.820609679,40.720148646]]]},"physicalid":"23441","boroughcode":"4","full_street_name":"77 RD","stname_label":"77 RD","rw_type":"1","b5sc":"416090"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.82285839,40.721013602],[-73.822871778,40.721053335],[-73.82291208,40.721173129],[-73.822939331,40.721269652],[-73.822939757,40.72127411],[-73.822939752,40.721280378],[-73.82293963,40.721286195],[-73.822939179,40.721290949],[-73.822934635,40.721299605],[-73.822925197,40.721305822],[-73.822910186,40.721311625],[-73.822892558,40.72131756],[-73.822885415,40.721319565],[-73.822768025,40.721342357],[-73.822200299,40.72144478]]]},"physicalid":"108798","boroughcode":"4","full_street_name":"ALLEY","stname_label":"ALLEY","rw_type":"10","b5sc":"413170"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820634178,40.721415785],[-73.820646591,40.721460659],[-73.820653729,40.721486713],[-73.820705826,40.721779127]]]},"physicalid":"107674","boroughcode":"4","full_street_name":"ALLEY","stname_label":"ALLEY","rw_type":"10","b5sc":"413170"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.820705826,40.721779127],[-73.820829134,40.721757274],[-73.821437884,40.721674014],[-73.822073932,40.721593277],[-73.822273296,40.721576403]]]},"physicalid":"107673","boroughcode":"4","full_street_name":"ALLEY","stname_label":"ALLEY","rw_type":"10","b5sc":"413170"},
      {"the_geom":{"type":"MultiLineString","coordinates":[[[-73.821035625,40.723419138],[-73.821024167,40.723362091],[-73.820916326,40.722824849],[-73.820872673,40.72257416],[-73.820825889,40.722361206],[-73.820758531,40.722061106],[-73.820705826,40.721779127]]]},"physicalid":"107669","boroughcode":"4","full_street_name":"ALLEY","stname_label":"ALLEY","rw_type":"10","b5sc":"413170"},
    ],
    signs: [
      {"order_number":"S-01646434","borough":"Queens","on_street":"141 STREET","from_street":"VLEIGH PLACE","to_street":"77 AVENUE","side_of_street":"E","sign_code":"PS-31B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) FRIDAY 8:30AM-10AM <-> (SUPERSEDES SP-464C)","distance_from_intersection":"49"},
      {"order_number":"S-01646434","borough":"Queens","on_street":"141 STREET","from_street":"VLEIGH PLACE","to_street":"77 AVENUE","side_of_street":"E","sign_code":"PS-31B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) FRIDAY 8:30AM-10AM <-> (SUPERSEDES SP-464C)","distance_from_intersection":"139"},
      {"order_number":"S-01646434","borough":"Queens","on_street":"141 STREET","from_street":"VLEIGH PLACE","to_street":"77 AVENUE","side_of_street":"E","sign_code":"PS-31B","sign_description":"NO PARKING (SANITATION BROOM SYMBOL) FRIDAY 8:30AM-10AM <-> (SUPERSEDES SP-464C)","distance_from_intersection":"308"},
    ],
  },
};
const rulesOn = (bySeg, segs, id) => {
  const si = segs.findIndex((s) => s.id === id), e = bySeg.get(si);
  return e && Object.fromEntries(['L', 'R'].filter((s) => e[s]).map((s) => [s, [[...e[s].labels.keys()].join('/'), [...e[s].rules.values()]]]));
};

describe('the join, on real rows', () => {
  it('W 82 St, Columbus Ave to Amsterdam Ave: north side Mon and Thu, south side Tue and Fri, on CSCL line 89788', () => {
    const segs = prepSegments(FIX.w82.segs), { bySeg, orders } = joinSigns(FIX.w82.signs, segs);
    expect(orders.map((o) => o.how)).toEqual(['walk', 'walk']);
    expect([...bySeg.keys()].map((si) => segs[si].id)).toEqual(['89788']);
    // the line runs west from Columbus Ave, so its left is the south side
    expect(rulesOn(bySeg, segs, '89788')).toEqual({
      L: ['South', [[2, 11, '12:30', 31, 0, 0], [5, 11, '12:30', 31, 0, 0]]],
      R: ['North', [[1, 11, '12:30', 31, 0, 0], [4, 11, '12:30', 31, 0, 0]]],
    });
  });
  it('places the same block by its cross streets alone when the signs have no points', () => {
    const segs = prepSegments(FIX.w82.segs), bare = FIX.w82.signs.map(({ sign_x_coord, sign_y_coord, ...r }) => r);
    const { bySeg, orders } = joinSigns(bare, segs);
    expect(orders.every((o) => o.how === 'walk' && o.withPoints === 0)).toBe(true);
    expect(rulesOn(bySeg, segs, '89788').R[0]).toBe('North');
  });
  it('141 St, Vleigh Pl to 77 Ave (Queens): walks through the 29 m jog along 78 Ave, which gets no rule', () => {
    const segs = prepSegments(FIX.q141.segs), { bySeg, orders } = joinSigns(FIX.q141.signs, segs);
    expect(orders[0]).toMatchObject({ how: 'walk', bridged: true, segIds: ['100225', '100224', '100223'] });
    for (const id of ['100223', '100224', '100225']) expect(rulesOn(bySeg, segs, id)).toEqual({ L: ['East', [[5, '8:30', 10, 31, 0, 0]]] });
    expect([...bySeg.keys()].every((si) => segs[si].key === streetKey('141 ST'))).toBe(true);
  });
});

const BUILT = new URL('../../data/new-york/segments.json', import.meta.url);
// the built file is 38k blocks: these checks take seconds on a CI runner
describe.skipIf(!fs.existsSync(BUILT))('data/new-york/', { timeout: 30000 }, () => {
  const data = fs.existsSync(BUILT) ? JSON.parse(fs.readFileSync(BUILT, 'utf8')) : { b: [] };
  const city = fs.existsSync(BUILT) ? JSON.parse(fs.readFileSync(new URL('../../data/new-york/city.json', import.meta.url), 'utf8')) : {};
  const report = fs.existsSync(BUILT) ? JSON.parse(fs.readFileSync(new URL('../../data/new-york/report.json', import.meta.url), 'utf8')) : {};
  const block = (s, l) => data.b.find((b) => b.s === s && b.l === l);
  const side = (b, label) => b.d.find((x) => x[1] === label)[2];
  const time = (v) => (typeof v === 'number' ? Number.isInteger(v) && v >= 0 && v <= 24 : /^([0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(v));

  it('writes every block in the format', () => {
    expect(data.b.length).toBeGreaterThan(35000);
    expect(new Set(data.b.map((b) => b.c)).size).toBe(data.b.length);
    for (const b of data.b) {
      expect(typeof b.c).toBe('string');
      expect(b.s.length).toBeGreaterThan(0);
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      for (const [lng, lat] of b.g) {
        expect(lng > -74.3 && lng < -73.69 && lat > 40.49 && lat < 40.92).toBe(true);
        expect(Math.round(lng * 1e6) / 1e6).toBe(lng);
      }
      expect(new Set(b.d.map((x) => x[0])).size).toBe(b.d.length);
      for (const [lr, label, rules] of b.d) {
        expect(['L', 'R']).toContain(lr);
        expect(['North', 'South', 'East', 'West']).toContain(label);
        expect(rules.length).toBeGreaterThan(0);
        for (const r of rules) {
          expect(r.length).toBe(6);
          expect(r[0] >= 0 && r[0] <= 6 && time(r[1]) && time(r[2]) && r[3] === 31 && r[4] === 0 && r[5] === 0).toBe(true);
        }
      }
      if (b.o) expect(['L', 'R']).toContain(b.o);
      if (b.n) expect(b.n[0] <= b.n[1]).toBe(true);
    }
  });
  // The borough files are local build output (gitignored: no page reads them yet), so this runs where they were built.
  const splitBuilt = (city.parts?.files || []).every((p) => fs.existsSync(new URL(`../../data/new-york/${p.file}`, import.meta.url)));
  it.skipIf(!splitBuilt)('splits the city by borough in the same format, every block once', () => {
    const parts = city.parts.files;
    expect(parts.map((p) => p.id)).toEqual(expect.arrayContaining(['manhattan', 'bronx', 'brooklyn', 'queens']));
    let n = 0;
    for (const p of parts) {
      const f = JSON.parse(fs.readFileSync(new URL(`../../data/new-york/${p.file}`, import.meta.url), 'utf8'));
      expect(f.b.length).toBe(p.blocks);
      expect(p.bytes).toBeLessThan(6.5 * 1048576);
      n += f.b.length;
    }
    expect(n).toBe(data.b.length);
  });
  it('has the Upper West Side and Park Slope blocks the signs say', () => {
    const w82 = block('W 82nd St', 'Columbus Ave - Amsterdam Ave');
    expect(side(w82, 'North')).toEqual([[1, 11, '12:30', 31, 0, 0], [4, 11, '12:30', 31, 0, 0]]);
    expect(side(w82, 'South')).toEqual([[2, 11, '12:30', 31, 0, 0], [5, 11, '12:30', 31, 0, 0]]);
    expect(w82.h).toBe('Upper West Side (Central)');
    const w74 = block('W 74th St', 'Columbus Ave - Amsterdam Ave');
    expect(side(w74, 'North')).toEqual([[1, 9, '10:30', 31, 0, 0], [4, 9, '10:30', 31, 0, 0]]);
    const fifth = block('5th St', '7th Ave - 8th Ave');
    expect(fifth.h).toBe('Park Slope');
    expect(side(fifth, 'North')).toEqual([[5, 9, '10:30', 31, 0, 0]]);
    expect(side(fifth, 'South')).toEqual([[2, 9, '10:30', 31, 0, 0]]);
  });
  it('has the daily and overnight programs: 37th Ave in Jackson Heights, Forsyth St after midnight', () => {
    const jh = block('37th Ave', '82nd St - 83rd St');
    expect(side(jh, 'North')).toEqual([1, 2, 3, 4, 5, 6].map((d) => [d, '8:30', 9, 31, 0, 0]));
    expect(side(jh, 'South')).toEqual([1, 2, 3, 4, 5, 6].map((d) => [d, 8, '8:30', 31, 0, 0]));
    const forsyth = block('Forsyth St', 'Grand St - Broome St');
    expect(side(forsyth, 'East')).toEqual([2, 4, 6].map((d) => [d, 0, 3, 31, 0, 0]));
    expect(side(forsyth, 'West')).toEqual([1, 3, 5].map((d) => [d, 0, 3, 31, 0, 0]));
  });
  it('knows the City\'s facts: Eastern time, the ASP suspension days, a $65 ticket and no tow', () => {
    expect(city).toMatchObject({ id: 'new-york', tz: 'America/New_York', holidayRule: 'all', fine: '$65', tow: 'no', zoom: 15 });
    expect(city.holidays['2026-11-26']).toBe('Thanksgiving Day');
    expect(city.holidays['2026-12-25']).toBe('Christmas Day');
    expect(Object.keys(city.holidays).filter((d) => d.startsWith('2026')).length).toBeGreaterThanOrEqual(40);
    const [[s, w], [n, e]] = city.bounds;
    expect(city.center[0] > s && city.center[0] < n && city.center[1] > w && city.center[1] < e).toBe(true);
  });
  it('reads nearly every sign, places nearly every block side, and agrees with the tickets', () => {
    expect(report.signs.share).toBeGreaterThan(0.99);
    expect(report.blockSides.placedShare).toBeGreaterThan(0.98);
    expect(report.ticketCheck.summary.dayAndHourMatch).toBeGreaterThan(0.9);
    expect(report.ticketCheck.summary.matchOnlyOnOtherSide).toBeLessThan(0.05);
  });
});
