// scripts/cities/toronto.mjs: reading the City's Chapter 950 schedules, placing them on the Toronto Centreline, and the
// built data/toronto/ (snow routes while a Major Snowstorm Condition is declared; the former North York's 2 to 6 AM ban).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normName, parseHighway, parseBetween, parseEnd, buildGraph, placeEntry, scheduleEntry, inForce, eachRecord, editDistance,
  sidesNamed, compass, oddSide, snowDates, snowRules, nightRules, ticketAddress, csvFields, shortKey, SNOW, NIGHT, SNOW_FLAGS, NIGHT_FLAGS,
  CITY_LIST_ONLY, WORDS } from './toronto.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, ROOT), 'utf8'));

describe('street names', () => {
  it('match the schedules\' legal names to the centreline\'s', () => {
    expect(normName('St. Clair Avenue West')).toBe(normName('St Clair Avenue West'));
    expect(normName("Queen's Park")).toBe('QUEENS PARK');
    expect(normName('Duplex Avenue (NY)')).toBe('DUPLEX AVENUE');
    // a type or direction the schedule shortened
    expect(normName('Roe Ave (NY)')).toBe('ROE AVENUE');
    expect(normName('Armour Blvd')).toBe('ARMOUR BOULEVARD');
    expect(normName('Sheppard Ave E')).toBe('SHEPPARD AVENUE EAST');
    expect(normName('Lake Shore Boulevard West')).toBe('LAKE SHORE BOULEVARD WEST');
    expect(editDistance('SHAPPARD AVENUE WEST', 'SHEPPARD AVENUE WEST')).toBe(1);
    // the tickets' spelling
    expect(shortKey('MC CAUL ST')).toBe(shortKey('McCaul St'));
  });
});

describe('a schedule entry, as the City writes it', () => {
  it('reads the street, its former municipality and the sides it names', () => {
    expect(parseHighway('Maxwell Street (east side)')).toEqual({ names: ['Maxwell Street'], qual: null, sides: ['east'], leg: null });
    expect(parseHighway('Bob Yuill Drive, east and south sides')).toMatchObject({ names: ['Bob Yuill Drive'], sides: ['east', 'south'] });
    expect(parseHighway('Whitburn Crescent (west,north and east sides)').sides).toEqual(['west', 'north', 'east']);
    expect(parseHighway('Duplex Avenue (NY), west side')).toMatchObject({ names: ['Duplex Avenue'], qual: 'NY', sides: ['west'] });
    expect(parseHighway('Spadina Avenue and Spadina Crescent').names).toEqual(['Spadina Avenue', 'Spadina Crescent']);
    expect(parseHighway('Joyce Parkway (south leg)')).toMatchObject({ names: ['Joyce Parkway'], leg: 'south leg' });
  });
  it('reads the limits: cross streets, a street\'s end, points some metres along, the entire length', () => {
    expect(parseBetween('Greenland Road (north intersection) and Greenland Road (south intersection)')).toEqual({ sides: null,
      a: { type: 'cross', names: ['Greenland Road'], which: 'north' }, z: { type: 'cross', names: ['Greenland Road'], which: 'south' } });
    expect(parseBetween('Newton Drive and the north end of Frivick Court').z).toEqual({ type: 'end', dir: 'north', street: 'Frivick Court' });
    expect(parseBetween('Keele Street and Cuffley Crescent North/Cuffley Crescent South').z.names).toEqual(['Cuffley Crescent North', 'Cuffley Crescent South']);
    expect(parseBetween('A point 30.5 metres north of Milverton Boulevard and O’Connor Drive').a)
      .toEqual({ type: 'offset', dist: 30.5, dir: 'north', ref: { type: 'cross', names: ['Milverton Boulevard'], which: null }, rel: false });
    expect(parseBetween('Yorkland Road and a point 150 metres east').z).toEqual({ type: 'offset', dist: 150, dir: 'east', ref: null, rel: true });
    expect(parseBetween('A point 38.8 metres north of Glenvale Boulevard and a point 5.2 metres north thereof').z).toMatchObject({ dist: 5.2, rel: true });
    expect(parseBetween('The entire length')).toEqual({ entire: true, sides: null });
    // the schedule's own slips: no direction, "iof", no "of", sides before "between"
    expect(parseEnd('a point 148.5 metres of Avenue Road')).toMatchObject({ type: 'offset', dist: 148.5, dir: null });
    expect(parseEnd('a point 39.6 metres east iof St. Ives Avenue')).toMatchObject({ dir: 'east', ref: { names: ['St. Ives Avenue'] } });
    expect(parseEnd('A point 100 metres east Rialto Drive')).toMatchObject({ dir: 'east', ref: { names: ['Rialto Drive'] } });
    expect(parseBetween('West and north side, between a point 88 metres south of Milford Avenue and Sheffield Street').sides).toEqual(['west', 'north']);
    expect(parseEnd('the north/south leg of Flaming Roseway').type).toBe('leg');
  });
  it('keeps the fields the build uses, never the record\'s staff fields', () => {
    const rec = { id: 'x', templateId: '950-17A', __Owner: 'someone', Owner2: null, latestRegulationActionByStatus: 'Added', latestRegulationActionByLaw: '1494-2025',
      latestRegulationActionEffectiveDate: '2025-12-17', regulationActions: [{ regulationOwner: 'someone' }],
      tableData: [{ key: 'Highway', value: 'Danforth Avenue' }, { key: 'Between', value: 'Main Street and Dawes Road' }],
      geoData: [{ from: 'Danforth Ave', to: 'Main St', lat: 43.68, lon: -79.3, geoID: '1' }] };
    const e = scheduleEntry(rec);
    expect(e).toEqual({ id: 'x', schedule: '950-17A', Highway: 'Danforth Avenue', Between: 'Main Street and Dawes Road', status: 'Added', bylaw: '1494-2025',
      effective: '2025-12-17', expiry: null, geo: [{ to: 'Main St', lat: 43.68, lon: -79.3 }] });
    expect(JSON.stringify(e)).not.toMatch(/someone|Owner/);
    expect(inForce(e, '2026-10-20')).toBe(true);
    expect(inForce({ ...e, status: 'Repealed' }, '2026-10-20')).toBe(false);
    expect(inForce({ ...e, effective: '2027-01-01' }, '2026-10-20')).toBe(false);
  });
});

describe('the schedules file, read one record at a time', () => {
  it('splits the records, braces and quotes inside strings included, and parses only those kept', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'curb-toronto-')), 'files.json');
    fs.writeFileSync(f, '{"@odata.count":3,"value":[{"templateId":"950-04","t":"a { b } \\" c [d]"},{"templateId":"950-10","x":{"y":[1,2]}},{"templateId":"950-17A","n":{"m":"}"}}]}');
    const kept = [];
    let seen = 0;
    await eachRecord(f, (text) => { seen++; return /950-(04|17A)/.test(text); }, (r) => kept.push(r));
    expect(seen).toBe(3);
    expect(kept).toEqual([{ templateId: '950-04', t: 'a { b } " c [d]' }, { templateId: '950-17A', n: { m: '}' } }]);
    fs.writeFileSync(f, '{"value":[{"templateId":"950-04"');
    await expect(eachRecord(f, () => true, () => {})).rejects.toThrow(/truncated/);
  });
});

// Real Toronto Centreline segments (fetched 2026-10-20): McCaul Street from College Street to Queen Street West (a snow route),
// Blue Ridge Road off Sheppard Avenue East and Deepwood Crescent on Greenland Road (Schedule IV), and every segment meeting them.
// [CENTRELINE_ID, legal name, name, class, from intersection, to intersection, line]
const FIXTURE = [[30107001,"McCaul Street","McCaul St","Collector",30106999,30106996,[[-79.392803,43.657539],[-79.392877,43.657713]]],[30107004,"McCaul - Orde Parkette Trail","McCaul - Orde Parkette Trl","Trail",30106999,30107002,[[-79.392803,43.657539],[-79.392704,43.657571],[-79.392665,43.657598],[-79.392639,43.657624],[-79.392609,43.657668],[-79.392588,43.657709],[-79.39256,43.657759],[-79.392551,43.657785],[-79.392546,43.657805],[-79.392546,43.657825],[-79.392556,43.657859],[-79.392576,43.657907],[-79.39259,43.657933],[-79.3926,43.657946],[-79.392624,43.657966],[-79.392655,43.657992]]],[30107000,"McCaul Street","McCaul St","Collector",14023067,30106999,[[-79.392441,43.656681],[-79.392803,43.657539]]],[30106998,"McCaul Street","McCaul St","Collector",30106996,13465455,[[-79.392877,43.657713],[-79.393018,43.65804]]],[30107003,"McCaul - Orde Parkette Trail","McCaul - Orde Parkette Trl","Trail",30106996,30107002,[[-79.392877,43.657713],[-79.392775,43.657737],[-79.392762,43.657745],[-79.392755,43.657759],[-79.392729,43.657825],[-79.392699,43.657903],[-79.39267,43.657962],[-79.392655,43.657992]]],[10906562,"McCaul Street","McCaul St","Collector",13466717,13466650,[[-79.389684,43.650165],[-79.389875,43.650603]]],[10486451,"Queen Street West","Queen St W","Major Arterial",13466708,13466717,[[-79.38944,43.650218],[-79.389684,43.650165]]],[10486392,"Queen Street West","Queen St W","Major Arterial",13466717,13466736,[[-79.389684,43.650165],[-79.390238,43.650047]]],[14041513,"Renfrew Place","Renfrew Pl","Laneway",14041514,13466650,[[-79.38933,43.650705],[-79.389875,43.650603]]],[10486959,"McCaul Street","McCaul St","Collector",13466650,13466500,[[-79.389875,43.650603],[-79.390247,43.651493]]],[1145364,"Renfrew Place","Renfrew Pl","Laneway",13466650,13466673,[[-79.389875,43.650603],[-79.390432,43.65048]]],[10947999,"McCaul Street","McCaul St","Collector",13466500,13466350,[[-79.390247,43.651493],[-79.390635,43.65242]]],[6924949,"Stephanie Street","Stephanie St","Local",13466500,13466521,[[-79.390247,43.651493],[-79.390806,43.651366]]],[7796189,"Grange Road","Grange Rd","Local",13466350,13466384,[[-79.390635,43.65242],[-79.391531,43.652227]]],[12631085,"McCaul Street","McCaul St","Collector",13466350,13466064,[[-79.390635,43.65242],[-79.391433,43.654317]]],[14022820,"McCaul Street","McCaul St","Collector",13465455,14022823,[[-79.393018,43.65804],[-79.393038,43.658091]]],[30106995,"Orde Street","Orde St","Local",30106993,13465455,[[-79.392765,43.658097],[-79.393018,43.65804]]],[442803,"Deepwood Crescent","Deepwood Cres","Local",13452311,13452394,[[-79.336891,43.736809],[-79.336882,43.737831],[-79.336863,43.737901],[-79.336841,43.737959],[-79.336793,43.738001],[-79.336723,43.738039],[-79.336651,43.738058],[-79.336553,43.738061],[-79.336457,43.738058],[-79.335854,43.738043],[-79.335764,43.738024],[-79.335692,43.737998],[-79.335632,43.737939],[-79.33561,43.737883],[-79.335592,43.737805],[-79.335542,43.737384],[-79.335543,43.737291],[-79.33555,43.737201],[-79.335549,43.737125],[-79.335575,43.737037],[-79.335659,43.736646],[-79.335728,43.736389],[-79.335767,43.73632],[-79.335819,43.736271],[-79.335901,43.736231],[-79.336007,43.736214],[-79.336136,43.736213],[-79.336497,43.736222],[-79.336849,43.736234]]],[442802,"Greenland Road","Greenland Rd","Local",13452394,13452311,[[-79.336849,43.736234],[-79.336891,43.736809]]],[442732,"Greenland Road","Greenland Rd","Local",13452311,13452085,[[-79.336891,43.736809],[-79.33766,43.737],[-79.337759,43.737032],[-79.33784,43.737089],[-79.337896,43.737153],[-79.337919,43.737225],[-79.337948,43.737324],[-79.338112,43.737955],[-79.338218,43.738291]]],[442896,"Greenland Road","Greenland Rd","Local",13452524,13452394,[[-79.336847,43.735414],[-79.336849,43.736234]]],[7939836,"Blue Ridge Road","Blue Ridge Rd","Local",13447460,13447391,[[-79.3742,43.769714],[-79.374264,43.770006],[-79.374293,43.770137]]],[30059375,"Sheppard Avenue East","Sheppard Ave E","Major Arterial",30059373,13447460,[[-79.375664,43.769402],[-79.375311,43.769475],[-79.3742,43.769714]]],[438793,"Sheppard Avenue East","Sheppard Ave E","Major Arterial",13447460,13447350,[[-79.3742,43.769714],[-79.372752,43.770022],[-79.371336,43.770344]]],[60067207,"Billes Heights","Billes Hts","Pending",60067208,13447460,[[-79.373669,43.768373],[-79.3742,43.769714]]],[7939832,"Blue Ridge Road","Blue Ridge Rd","Local",13447391,13447279,[[-79.374293,43.770137],[-79.374458,43.770879]]],[438751,"Protea Gardens","Protea Gdns","Local",13447391,13447297,[[-79.374293,43.770137],[-79.371478,43.770727]]],[438678,"Blue Ridge Road","Blue Ridge Rd","Local",13447279,13447123,[[-79.374458,43.770879],[-79.374659,43.771822]]],[4504023,"Maureen Drive","Maureen Dr","Local",13447171,13447279,[[-79.371651,43.771482],[-79.373082,43.771178],[-79.374458,43.770879]]],[438594,"Arrowstook Road","Arrowstook Rd","Local",13447123,13447176,[[-79.374659,43.771822],[-79.374787,43.771768],[-79.374987,43.771698],[-79.375109,43.77166],[-79.375267,43.771634],[-79.375415,43.771614],[-79.375652,43.771569],[-79.375831,43.771523]]],[438552,"Arrowstook Road","Arrowstook Rd","Local",13447024,13447123,[[-79.371899,43.772479],[-79.372837,43.772283],[-79.374132,43.772],[-79.37431,43.77195],[-79.37447,43.771896],[-79.374659,43.771822]]],[438553,"Blue Ridge Road","Blue Ridge Rd","Local",13447123,13446978,[[-79.374659,43.771822],[-79.374905,43.772881]]],[14022835,"McCaul Street","McCaul St","Collector",13466064,14022837,[[-79.391433,43.654317],[-79.391636,43.654795]]],[1144804,"Dundas Street West","Dundas St W","Major Arterial",13466064,13466136,[[-79.391433,43.654317],[-79.39386,43.653823]]],[7796276,"Dundas Street West","Dundas St W","Major Arterial",13466030,13466064,[[-79.390309,43.65448],[-79.390459,43.654503],[-79.390545,43.654497],[-79.390661,43.654478],[-79.391433,43.654317]]],[14022821,"McCaul Street","McCaul St","Collector",14022823,14022824,[[-79.393038,43.658091],[-79.393313,43.658735]]],[14041898,"Ln 2 S College W Mc Caul","Ln 2 S College W Mc Caul","Laneway",14022823,14041899,[[-79.393038,43.658091],[-79.393621,43.65797],[-79.393481,43.657626]]],[14041598,"Ln 1 S College W Mc Caul","Ln 1 S College W Mc Caul","Laneway",14022824,14041600,[[-79.393313,43.658735],[-79.393898,43.658605]]],[14022822,"McCaul Street","McCaul St","Collector",14022824,13465273,[[-79.393313,43.658735],[-79.393503,43.659199]]],[20040435,"College Street","College St","Major Arterial",13465166,13465273,[[-79.390472,43.659847],[-79.392591,43.659397],[-79.393503,43.659199]]],[1143955,"College Street","College St","Major Arterial",13465273,13465293,[[-79.393503,43.659199],[-79.394066,43.659078]]],[14022836,"McCaul Street","McCaul St","Collector",14022837,13465903,[[-79.391636,43.654795],[-79.391844,43.655292]]],[14041194,"Ln N Dundas W Mc Caul","Ln N Dundas W Mc Caul","Laneway",14022837,14041195,[[-79.391636,43.654795],[-79.393346,43.654436]]],[14022770,"D'Arcy Street","D'Arcy St","Local",13465903,14022772,[[-79.391844,43.655292],[-79.393561,43.654935]]],[14023082,"McCaul Street","McCaul St","Collector",13465903,14023084,[[-79.391844,43.655292],[-79.39201,43.655698]]],[14023083,"McCaul Street","McCaul St","Collector",14023084,13465830,[[-79.39201,43.655698],[-79.392048,43.655802]]],[30074181,"Ln N D Arcy W Mc Caul","Ln N D Arcy W Mc Caul","Laneway",14023084,14042425,[[-79.39201,43.655698],[-79.392568,43.655579],[-79.392616,43.655699]]],[14042421,"Ln S Baldwin W Mc Caul","Ln S Baldwin W Mc Caul","Laneway",13465830,14042425,[[-79.392048,43.655802],[-79.392616,43.655699]]],[7795711,"McCaul Street","McCaul St","Collector",13465830,13465756,[[-79.392048,43.655802],[-79.392253,43.656269]]],[1144491,"Elm Street","Elm St","Collector",13465786,13465830,[[-79.390963,43.656033],[-79.392048,43.655802]]],[12580124,"Howard Drive","Howard Dr","Local",13446893,13446978,[[-79.372154,43.773475],[-79.372711,43.773356],[-79.374397,43.772996],[-79.374781,43.772912],[-79.374905,43.772881]]],[438472,"Howard Drive","Howard Dr","Local",13446978,13447008,[[-79.374905,43.772881],[-79.375502,43.77278],[-79.37588,43.772695],[-79.37598,43.772688],[-79.376012,43.772686],[-79.376068,43.772654]]],[60067027,"Blue Ridge Road","Blue Ridge Rd","Local",13446978,60067029,[[-79.374905,43.772881],[-79.37502,43.77341]]],[14041607,"Silverstein Lane","Silverstein Lane","Laneway",14023067,14041609,[[-79.392441,43.656681],[-79.393071,43.656547]]],[14023065,"McCaul Street","McCaul St","Collector",13465756,14023067,[[-79.392253,43.656269],[-79.392441,43.656681]]],[1144455,"Baldwin Street","Baldwin St","Local",13465756,13465801,[[-79.392253,43.656269],[-79.393464,43.656012]]],[60067050,"Blue Ridge Park Trail","Blue Ridge Park Trl","Trail",60067029,30102139,[[-79.37502,43.77341],[-79.374912,43.77343],[-79.374752,43.773468],[-79.37469,43.77349],[-79.374659,43.773506],[-79.374629,43.773518],[-79.374597,43.773534],[-79.374549,43.773566],[-79.374486,43.773613],[-79.374346,43.773724],[-79.373975,43.774014],[-79.373824,43.774116]]]];
const G = buildGraph(FIXTURE.map(([id, legal, name, cls, a, b, c]) => ({ properties: { CENTRELINE_ID: id, LINEAR_NAME_FULL_LEGAL: legal, LINEAR_NAME_FULL: name,
  FEATURE_CODE_DESC: cls, FROM_INTERSECTION_ID: a, TO_INTERSECTION_ID: b, JURISDICTION: 'CITY OF TORONTO' }, geometry: { type: 'MultiLineString', coordinates: [c] } })));
const ids = (r) => [...r.segs].filter(([, v]) => v.frac >= 0.5).map(([si, v]) => `${G.segs[si].id}:${v.sides.join('')}`).sort();

describe('placing entries on the centreline', () => {
  it('a snow route by its cross streets\' names: McCaul Street, College Street to Queen Street West', () => {
    const r = placeEntry(G, { Highway: 'McCaul Street', Between: 'College Street and Queen Street West', geo: [] });
    expect(r.ok).toBe(true);
    const mc = FIXTURE.filter((f) => f[2] === 'McCaul St').map((f) => String(f[0]));
    expect(ids(r).map((x) => x.split(':')[0])).toEqual(mc.sort());   // every block of it, both sides
    expect(ids(r).every((x) => x.endsWith(':LR'))).toBe(true);
  });
  it('a crescent between its two corners on one street: Deepwood Crescent', () => {
    expect(ids(placeEntry(G, { Highway: 'Deepwood Crescent', Between: 'Greenland Road (north intersection) and Greenland Road (south intersection)', geo: [] })))
      .toEqual(['442803:LR']);
  });
  it('a point some metres past a cross street: Blue Ridge Road, Sheppard Avenue East to 52 metres north of Howard Drive (by-law 183-2024)', () => {
    const geo = [{ to: 'Sheppard Ave E', lat: 43.769713725, lon: -79.374199811 }];
    const whole = placeEntry(G, { Highway: 'Blue Ridge Road', Between: 'Sheppard Avenue East and the north end of Blue Ridge Road', geo });
    const kept = placeEntry(G, { Highway: 'Blue Ridge Road', Between: 'Sheppard Avenue East and a point 52 metres north of Howard Drive', geo });
    expect(ids(whole)).toEqual(['438553:LR', '438678:LR', '60067027:LR', '7939832:LR', '7939836:LR']);
    // the last block, 60 m past Howard Drive, is covered to 52 m: most of it, so the ban stays on every block
    expect(ids(kept)).toEqual(ids(whole));
    const last = [...kept.segs].find(([si]) => G.segs[si].id === '60067027')[1];
    expect(last.frac).toBeGreaterThan(0.75);
    expect(last.frac).toBeLessThan(1);
  });
  it('one side, by the direction the street runs: a side named "east" is the side facing east', () => {
    const r = placeEntry(G, { Highway: 'McCaul Street (east side)', Between: 'College Street and Queen Street West', geo: [] });
    for (const [si, v] of r.segs) expect(v.sides).toHaveLength(1);
    expect(sidesNamed([[-79.39, 43.65], [-79.39, 43.66]], ['east'])).toEqual(['R']);    // drawn north: east is on the right
    expect(sidesNamed([[-79.39, 43.66], [-79.39, 43.65]], ['east'])).toEqual(['L']);
    expect(sidesNamed([[-79.39, 43.65], [-79.39, 43.66]], ['north'])).toEqual([]);      // a street running north has no north side
    expect(compass([[-79.39, 43.65], [-79.38, 43.65]], 'L')).toBe('North');
  });
  it('says why when it can\'t: a street not on the centreline, a leg', () => {
    expect(placeEntry(G, { Highway: 'Nowhere Street', Between: 'College Street and Queen Street West', geo: [] })).toEqual({ ok: false, why: 'street not on the centreline' });
    expect(placeEntry(G, { Highway: 'McCaul Street', Between: 'College Street and the north/south leg of McCaul Street', geo: [] }).why).toMatch(/leg/);
  });
});

describe('the rules', () => {
  it('a snow route closes both sides all day on every date of the season, while the switch is on', () => {
    expect(snowRules()).toEqual([[-1, 0, 24, 0, 0, 15, 'snow1'], [-1, 0, 24, 0, 0, 15, 'snow2']]);
    expect(SNOW_FLAGS).toBe(1 | 2 | 4 | 8);
    const d = snowDates();
    expect(d.snow1[0]).toBe(SNOW.from);
    expect(d.snow2[d.snow2.length - 1]).toBe(SNOW.to);
    expect(d.snow1.length + d.snow2.length).toBe(181);
    // a saved alert keeps 96 dates a rule (api/_spot.js): each list fits, so a watch covers the whole season
    expect(Math.max(d.snow1.length, d.snow2.length)).toBeLessThanOrEqual(96);
  });
  it('the North York ban: 2 to 6 AM every night, December to March, on holidays too, towable, a no parking rule', () => {
    expect(nightRules()).toHaveLength(7);
    expect(nightRules()[0]).toEqual([0, 2, 6, 31, 1 | 2 | 4 | 2048, NIGHT_FLAGS]);
    expect(NIGHT_FLAGS).toBe(1 | 2 | 32);
    expect(NIGHT).toEqual({ start: 2, end: 6, months: [12, 1, 2, 3] });
  });
  it('odd and even sides from the centreline\'s parity fields', () => {
    expect(oddSide({ PARITY_L: 'E', PARITY_R: 'O' })).toBe('R');
    expect(oddSide({ PARITY_L: 'O', PARITY_R: 'E' })).toBe('L');
    expect(oddSide({ PARITY_L: 'E', PARITY_R: 'N' })).toBe('R');   // numbers on one side: the other is odd
    expect(oddSide({ PARITY_L: 'N', PARITY_R: 'N' })).toBe(null);
  });
  it('the tickets\' addresses and lines', () => {
    expect(ticketAddress('390 SENTINEL RD')).toEqual({ number: 390, key: 'SENTINELRD' });
    expect(ticketAddress('NR')).toBe(null);
    expect(csvFields('"***65822","20250101",8,"STAND VEH.-PROHIBIT TIME/DAY",120,"0002","NR","390 SENTINEL RD",,,"ON"'))
      .toEqual(['***65822', '20250101', '8', 'STAND VEH.-PROHIBIT TIME/DAY', '120', '0002', 'NR', '390 SENTINEL RD', '', '', 'ON']);
  });
});

describe('the built data/toronto/', () => {
  const seg = read('data/toronto/segments.json'), city = read('data/toronto/city.json'), report = read('data/toronto/report.json');
  const blocks = seg.b, byId = new Map(blocks.map((b) => [b.c, b]));
  const rulesOf = (b) => b.d.flatMap(([, , r]) => r);
  it('has every block once, each side with a rule and a line on the map', () => {
    expect(blocks.length).toBeGreaterThan(10000);
    expect(byId.size).toBe(blocks.length);
    for (const b of blocks) {
      expect(b.g.length).toBeGreaterThanOrEqual(2);
      expect(b.d.length).toBeGreaterThanOrEqual(1);
      for (const [side, label, rules] of b.d) { expect(['L', 'R']).toContain(side); expect(label).toMatch(/^(North|South|East|West|Northeast|Northwest|Southeast|Southwest)$/); expect(rules.length).toBeGreaterThan(0); }
    }
    expect(seg.dates.snow1.length).toBeLessThanOrEqual(96);
    expect(seg.dates.snow2.length).toBeLessThanOrEqual(96);
  });
  it('snow routes: Queen Street West both sides, McCaul Street, every streetcar street downtown', () => {
    const queen = blocks.filter((b) => b.s === 'Queen St W' && b.h === 'Old Toronto');
    expect(queen.length).toBeGreaterThan(50);
    for (const b of queen) { expect(b.d.map(([s]) => s).sort()).toEqual(['L', 'R']); expect(b.d.every(([, , r]) => r.some((x) => x[5] === SNOW_FLAGS))).toBe(true); }
    for (const st of ['McCaul St', 'King St W', 'Spadina Ave', 'College St', 'Dundas St W', 'Bathurst St', 'Broadview Ave', 'Gerrard St E'])
      expect(blocks.some((b) => b.s === st && rulesOf(b).some((x) => x[5] & 4)), st).toBe(true);
    // a side street downtown is not one
    expect(blocks.some((b) => b.s === 'John St' && rulesOf(b).some((x) => x[5] & 4))).toBe(false);
    // the one the City's list has and the dataset marks repealed (Lower Coxwell Avenue, now Emdaabiimok Avenue)
    expect(CITY_LIST_ONLY.map((e) => e.Highway)).toEqual(['Emdaabiimok Avenue']);
    expect(blocks.some((b) => b.s === 'Emdaabiimok Ave' && rulesOf(b).some((x) => x[5] & 4))).toBe(true);
  });
  it('North York: the ban on its streets, both sides; not in the old city; not where Council took it off', () => {
    const ny = blocks.filter((b) => rulesOf(b).some((x) => x[5] === NIGHT_FLAGS));
    expect(ny.length).toBeGreaterThan(8000);
    // all in North York but a few streets on its boundary that Schedule IV lists (their middle just outside)
    expect(ny.filter((b) => b.h !== 'North York').length).toBeLessThan(25);
    for (const st of ['Queen St W', 'Palmerston Ave', 'Danforth Ave']) expect(blocks.filter((b) => b.s === st).every((b) => !rulesOf(b).some((x) => x[5] & 32)), st).toBe(true);
    // St. Dennis Drive (by-law 114-2018) and Eddystone Avenue (312-2014): taken off Schedule IV, whole street
    for (const st of ['St Dennis Dr', 'Eddystone Ave']) {
      const bs = blocks.filter((b) => b.s === st);
      expect(bs.every((b) => !rulesOf(b).some((x) => x[5] & 32)), st).toBe(true);
    }
    // Maxwell Street (425-2020): the west side south of Cocksfield Avenue only; the east side keeps the ban
    const maxwell = blocks.filter((b) => b.s === 'Maxwell St');
    expect(maxwell.some((b) => b.d.length === 1)).toBe(true);
    expect(maxwell.filter((b) => b.d.length === 2).length).toBeGreaterThan(maxwell.filter((b) => b.d.length === 1).length);
  });
  it('city.json: the switch rule, its season and the words', () => {
    expect(city).toMatchObject({ id: 'toronto', tz: 'America/Toronto', winter: { from: SNOW.from, to: SNOW.to, start: 0, end: 24, declared: true } });
    expect(city.credit).toBe('Uses City of Toronto data under the Open Government Licence – Toronto.');
    for (const s of city.sources) expect(s.url).toMatch(/^https:/);
    // the words a resident reads: no dashes as punctuation, no "~" before numbers, no italics
    for (const [k, v] of Object.entries(WORDS)) expect(v, k).not.toMatch(/—|~| - |<\/?(i|em)>/);
    expect(read('data/toronto/winter.json').state).toMatch(/^(waiting|on|paused)$/);
  });
  it('report.json: every entry placed or said why, the exemptions, and last winter\'s tickets on the map', () => {
    expect(report.snowRoutes.placed).toBeGreaterThanOrEqual(report.snowRoutes.inForce - 2);
    expect(report.northYork.schedule.placed / report.northYork.schedule.inForce).toBeGreaterThan(0.94);
    for (const x of report.northYork.notPlaced) expect(x.why).toBeTruthy();
    expect(report.northYork.exemptionsApplied).toBeGreaterThan(30);
    for (const x of report.northYork.exemptions) expect(x.applied || x.why).toBeTruthy();
    expect(report.tickets2025.northYork.onRulePct).toBeGreaterThan(95);
    expect(report.tickets2025.snowRoutes.onRulePct).toBeGreaterThan(90);
    // no names of people anywhere in what the build writes
    expect(JSON.stringify(report)).not.toMatch(/__Owner|regulationOwner|Owner2/);
  });
});
