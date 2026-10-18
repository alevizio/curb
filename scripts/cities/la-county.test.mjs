// Unincorporated LA County build (scripts/cities/la-county.mjs): the County's fields, and curb lines laid on centerlines, on
// real rows: the 4800 block of Eagle St in East Los Angeles (CAMS centerline) with the Public Works curb lines around it.
import { describe, it, expect } from 'vitest';
import { parseSchedule, parseTime, parseFrequency, isPosted, sampleWithDir, EdgeIndex, layCurbs, countyHolidays } from './la-county.mjs';
import { xy, compass } from './los-angeles.mjs';

describe('the County\'s fields', () => {
  it('reads days, hours and frequency as Public Works writes them', () => {
    expect(parseSchedule('Thursday')).toEqual([4]);
    expect(parseSchedule('Monday Friday')).toEqual([1, 5]);
    expect(parseSchedule('As Needed')).toEqual([]);
    expect(parseSchedule('Any Day')).toEqual([]);
    expect(parseTime('8:00 AM - 12:00 PM')).toEqual([8, 12]);
    expect(parseTime(' 7:00 AM - 11:00 AM')).toEqual([7, 11]);
    expect(parseTime('7:00 AM - 11:00AM')).toEqual([7, 11]);
    expect(parseTime('12:00  PM -4:00 PM')).toEqual([12, 16]);
    expect(parseTime('7:00 A.M. - 11:00 A.M.')).toEqual([7, 11]);
    expect(parseTime('3:00 AM - 1:30 PM Mon, 2:00 AM - 10:00 AM Friday')).toBe(null);
    expect(parseTime('All Day')).toBe(null);
    expect(parseTime('Hand Sweeping')).toBe(null);
    expect(parseFrequency('WEEKLY')).toBe(31);
    expect(parseFrequency('TWICE WEEKLY')).toBe(31);
    expect(parseFrequency('TWICE MONTHLY - WEEK 2 AND WEEK 4')).toBe(10);
    expect(parseFrequency('AS NEEDED')).toBe(0);
    expect(isPosted({ POSTED: 'YES' })).toBe(true);
    expect(isPosted({ POSTED: 'INPRG' })).toBe(false);
    expect(isPosted({ POSTED: null })).toBe(false);
  });
});

describe('curb lines onto centerlines (Eagle St, East Los Angeles)', () => {
  const lines = FIX.centerlines.map((f) => ({ id: f.properties.SourceID, p: f.properties, c: f.geometry.coordinates, pts: f.geometry.coordinates.map(xy) }));
  const curbs = FIX.curbs.map((f) => ({ id: f.properties.OBJECTID, p: f.properties, c: f.geometry.coordinates, pts: f.geometry.coordinates.map(xy),
    days: parseSchedule(f.properties.SCHEDULE), win: parseTime(f.properties.TIME), weeks: parseFrequency(f.properties.FREQUENCY) }));
  const index = new EdgeIndex(lines);
  const { sides } = layCurbs(curbs, index);
  const eagle = lines.find((L) => L.id === FIX.block);
  it('samples a curb line away from its rounded corners', () => {
    const C = curbs.find((x) => x.id === FIX.L[0]);
    const sp = sampleWithDir(C.pts);
    expect(sp.length).toBeGreaterThan(10);
    for (const q of sp) expect(Math.hypot(q.ux, q.uy)).toBeCloseTo(1, 6);
  });
  it('puts each curb on the side of the street it runs along', () => {
    const s = sides.get(FIX.block);
    expect(s.L.map((C) => C.id)).toEqual(FIX.L);
    expect(s.R.map((C) => C.id)).toEqual(FIX.R);
    expect(s.L[0].p.SCHEDULE).toBe('Friday');
    expect(s.R[0].p.SCHEDULE).toBe('Monday');
    expect(compass(eagle.c, 'L')).toBe('North');
    expect(compass(eagle.c, 'R')).toBe('South');
  });
  it('counts a curb that turns the corner on both streets it runs along, each on its own side', () => {
    // curb line 123284 (Monday) runs along the south side of Eagle St and turns up S Ferris Ave
    const on = [...sides].filter(([, s]) => [...s.L, ...s.R].some((C) => C.id === 123284)).map(([, s]) => s.line.p.FullName).sort();
    expect(on).toEqual(['Eagle St', 'S Ferris Ave']);
    // and no curb lands on both sides of one block
    for (const [, s] of sides) for (const C of s.L) expect(s.R).not.toContain(C);
  });
  it('finds no centerline for a point far from any street', () => {
    const [x, y] = xy(eagle.c[0]);
    expect(index.nearest({ x: x + 500, y: y + 500, ux: 1, uy: 0 })).toBe(null);
  });
});

describe('County holidays', () => {
  it('list the holidays Public Works names, moved off weekends', () => {
    const h = countyHolidays(2026);
    expect(h['2026-03-31']).toBe('César Chávez Day');
    expect(h['2026-07-03']).toBe('Independence Day (observed)');
    expect(h['2026-11-27']).toBe('Day after Thanksgiving');
    expect(Object.keys(h).length).toBe(13);
    expect(countyHolidays(2027)['2027-12-31']).toBe("New Year's Day (observed)");
  });
});

// Real rows (fetched 2026-10-18): CAMS centerlines around the 4800 block of Eagle St and the posted Public Works curb lines
// near it (day, hours, frequency only).
const FIX = {"centerlines":[{"properties":{"SourceID":"7CEF5A14-AAF3-416A-871F-DE6A495F2C3D","FullName":"Eagle St","From_L":4731,"To_L":4799,"From_R":4730,"To_R":4798,"Parity_L":"Odd","Parity_R":"Even","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.163681,34.028935],[-118.162504,34.028683]]}},{"properties":{"SourceID":"965D19D1-92A1-4A18-90C4-19B6DB52D5D2","FullName":"S Fetterly Ave","From_L":500,"To_L":598,"From_R":501,"To_R":599,"Parity_L":"Even","Parity_R":"Odd","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.162504,34.028683],[-118.163019,34.027002],[-118.163197,34.026412]]}},{"properties":{"SourceID":"3E99C200-22A4-468E-8D3F-AEBC36B993EF","FullName":"S Fetterly Ave","From_L":400,"To_L":498,"From_R":401,"To_R":499,"Parity_L":"Even","Parity_R":"Odd","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.161797,34.030948],[-118.162251,34.029511],[-118.162504,34.028683]]}},{"properties":{"SourceID":"C3F90972-E7D7-43FB-A294-F9BD29E605C1","FullName":"S Ferris Ave","From_L":500,"To_L":598,"From_R":501,"To_R":599,"Parity_L":"Even","Parity_R":"Odd","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.161312,34.028426],[-118.161711,34.027117],[-118.162004,34.026159]]}},{"properties":{"SourceID":"61188693-C301-482C-8FCF-3F8694066E7B","FullName":"Eagle St","From_L":4801,"To_L":4899,"From_R":4800,"To_R":4898,"Parity_L":"Odd","Parity_R":"Even","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.162504,34.028683],[-118.161634,34.028497],[-118.161312,34.028426]]}},{"properties":{"SourceID":"405636A6-3D53-49F5-A876-219341C6503F","FullName":"Eagle St","From_L":4901,"To_L":4947,"From_R":4900,"To_R":4940,"Parity_L":"Odd","Parity_R":"Even","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.161312,34.028426],[-118.160129,34.028179]]}},{"properties":{"SourceID":"BCBDB0DB-213A-4E39-AF8B-A2A79FE8FE53","FullName":"S Ferris Ave","From_L":400,"To_L":498,"From_R":401,"To_R":499,"Parity_L":"Even","Parity_R":"Odd","Elevation":"Surface"},"geometry":{"type":"LineString","coordinates":[[-118.160628,34.030699],[-118.160835,34.029999],[-118.161312,34.028426]]}}],"curbs":[{"properties":{"OBJECTID":117874,"SCHEDULE":"Friday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.161379,34.028512],[-118.161385,34.028512],[-118.16139,34.028511],[-118.161397,34.028511],[-118.161406,34.028512],[-118.162352,34.02871],[-118.162366,34.028714],[-118.162377,34.028719],[-118.162388,34.028725],[-118.162399,34.028736],[-118.162407,34.028745]]}},{"properties":{"OBJECTID":117893,"SCHEDULE":"Friday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.162598,34.028645],[-118.162594,34.02864],[-118.162592,34.028631],[-118.162595,34.028619],[-118.163234,34.026513],[-118.163239,34.026505],[-118.163247,34.026499]]}},{"properties":{"OBJECTID":117924,"SCHEDULE":"Friday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.162571,34.028778],[-118.162582,34.028773],[-118.162599,34.02877],[-118.16262,34.028769],[-118.162647,34.028771],[-118.163585,34.02897],[-118.163597,34.028974],[-118.163605,34.028979],[-118.16361,34.028985]]}},{"properties":{"OBJECTID":118183,"SCHEDULE":"Friday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.161905,34.030909],[-118.161904,34.030904],[-118.161903,34.030897],[-118.161903,34.030891],[-118.162537,34.02881],[-118.162548,34.028794],[-118.16256,34.028783],[-118.162571,34.028778]]}},{"properties":{"OBJECTID":123091,"SCHEDULE":"Monday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.163111,34.026473],[-118.163113,34.026481],[-118.163113,34.026495],[-118.16311,34.026512],[-118.16248,34.028572],[-118.162474,34.028583],[-118.162466,34.028592],[-118.162457,34.0286],[-118.162446,34.028606]]}},{"properties":{"OBJECTID":123270,"SCHEDULE":"Monday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.161273,34.028371],[-118.161262,34.028374],[-118.161248,34.028374],[-118.160257,34.028164],[-118.160247,34.028162],[-118.160239,34.028159],[-118.160233,34.028155],[-118.160229,34.02815],[-118.160227,34.028144]]}},{"properties":{"OBJECTID":123284,"SCHEDULE":"Monday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.162446,34.028606],[-118.162427,34.028612],[-118.162402,34.028614],[-118.162387,34.028613],[-118.161441,34.028414],[-118.161431,34.028412],[-118.161424,34.028409],[-118.161418,34.028406],[-118.161414,34.028402],[-118.16141,34.028399],[-118.161408,34.028393],[-118.161406,34.028389],[-118.161406,34.028384],[-118.161407,34.028379],[-118.162038,34.026303],[-118.162043,34.026293],[-118.162048,34.026285],[-118.162058,34.026276],[-118.162072,34.026267],[-118.162086,34.026262]]}},{"properties":{"OBJECTID":123290,"SCHEDULE":"Monday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.162407,34.028745],[-118.162413,34.028757],[-118.162416,34.028771],[-118.162416,34.028785],[-118.162414,34.028801],[-118.161784,34.030866],[-118.16178,34.030876],[-118.161775,34.030883],[-118.161769,34.030887],[-118.161759,34.030889],[-118.161746,34.030888],[-118.16172,34.030883],[-118.160725,34.030671],[-118.160718,34.030669],[-118.160715,34.030667],[-118.160712,34.030665],[-118.160711,34.030662],[-118.160711,34.030658],[-118.160711,34.030653],[-118.160712,34.030648],[-118.161362,34.028526],[-118.161364,34.028521],[-118.161368,34.028517],[-118.161373,34.028515],[-118.161379,34.028512]]}},{"properties":{"OBJECTID":123297,"SCHEDULE":"Monday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.163637,34.02887],[-118.163627,34.028872],[-118.163613,34.028872],[-118.163591,34.028868],[-118.162621,34.028662],[-118.16261,34.028657],[-118.162602,34.028652],[-118.162598,34.028645]]}},{"properties":{"OBJECTID":132906,"SCHEDULE":"Friday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.161912,34.026231],[-118.161917,34.026243],[-118.161919,34.026257],[-118.16192,34.026271],[-118.161917,34.026287],[-118.161289,34.028354],[-118.161285,34.028362],[-118.16128,34.028367],[-118.161273,34.028371]]}},{"properties":{"OBJECTID":133145,"SCHEDULE":"Friday","TIME":"8:00 AM - 12:00 PM","POSTED":"Yes","FREQUENCY":"WEEKLY"},"geometry":{"type":"LineString","coordinates":[[-118.160203,34.028277],[-118.160215,34.028275],[-118.16023,34.028272],[-118.160252,34.028272],[-118.160276,34.028274],[-118.160296,34.028278],[-118.161211,34.028471],[-118.161219,34.028474],[-118.161227,34.028478],[-118.161232,34.028482],[-118.161236,34.028487],[-118.161239,34.028493],[-118.16124,34.028499],[-118.16124,34.028507],[-118.161238,34.028518],[-118.160601,34.030619],[-118.160598,34.030624],[-118.160594,34.03063],[-118.160586,34.030636]]}}],"block":"61188693-C301-482C-8FCF-3F8694066E7B","L":[117874],"R":[123284]};
