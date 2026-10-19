// lib/city.js: any city built by docs/multi-city/city-build.md, read the way lib/city-boston.js reads Boston.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

beforeAll(async () => { await import('./sweep-core.js'); await import('./city.js'); });
afterEach(() => { vi.useRealTimers(); });

const cfg = (o = {}) => ({ id: 'testville', tz: 'America/Los_Angeles', center: [37.8, -122.27], zoom: 14,
  bounds: [[37.7, -122.35], [37.9, -122.15]], holidays: { '2026-11-11': 'Veterans Day' }, holidayRule: 'all', ...o });
// one block: the left side swept 1st & 3rd Tuesday 9:30 to 11:30, the right side on two listed dates
const block = { c: '42', s: 'Grand Ave', l: 'Elm St - Oak St', n: [100, 199], o: 'L', g: [[-122.26, 37.81], [-122.25, 37.812]],
  d: [['L', 'North', [[2, '9:30', '11:30', 5, 0, 2]]], ['R', 'South', [[-1, 8, 18, 0, 0, 0, ['2026-11-11', '2026-11-12']]]]] };

describe('rows', () => {
  it('reads a weekly rule with minutes and a towable flag', () => {
    const [left] = globalThis.makeCity(cfg()).rowsOf(block);
    expect(left).toMatchObject({ cnn: '42', corridor: 'Grand Ave', blockside: 'North', cnnrightleft: 'L', weekday: 'Tue',
      fromhour: '9:30', tohour: '11:30', week1: '1', week2: '0', week3: '1', tow: '1' });
    expect(left.months).toBeUndefined();
  });
  it('reads a rule on listed dates', () => {
    const right = globalThis.makeCity(cfg()).rowsOf(block)[1];
    expect(right.weekday).toBe('');
    expect(right.dates).toEqual(['2026-11-11', '2026-11-12']);
  });
});

describe('holidays', () => {
  it('stop every sweep that day when holidayRule is "all": a listed date on a holiday is skipped', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 20, 0)));
    const city = globalThis.makeCity(cfg());
    expect(city.core.nextSweep(city.rowsOf(block)[1]).da).toBe(12);
  });
  it('spare overnight sweeps when holidayRule is "daytime"', () => {
    const city = globalThis.makeCity(cfg({ holidayRule: 'daytime' }));
    expect(city.suspended({ fromhour: '2' }, '2026-11-11')).toBe(false);
    expect(city.suspended({ fromhour: '9' }, '2026-11-11')).toBe(true);
  });
  it('spare a rule flagged to run on holidays', () => {
    expect(globalThis.makeCity(cfg()).suspended({ fromhour: '9', flags: 1 }, '2026-11-11')).toBe(false);
  });
});

describe('places', () => {
  it('finds the odd side of a block from a house number', () => {
    const city = globalThis.makeCity(cfg());
    const hit = city.findAddress([block], 151, 'Grand Avenue');
    expect(hit.block.c).toBe('42');
    expect(hit.side).toBe('North');
    expect(city.findAddress([block], 150, 'Grand Ave').side).toBe('South');
  });
  it('draws the overview with the block\'s whole line, as latlngs', () => {
    const [o] = globalThis.makeCity(cfg()).overview([{ ...block }]);
    expect(o.g).toEqual([[37.81, -122.26], [37.812, -122.25]]);
    expect(o.rules).toHaveLength(2);
  });
});

describe('words', () => {
  it('say a season the way people read it', () => {
    const { seasonText } = globalThis.makeCity(cfg());
    expect(seasonText([4, 5, 6, 7, 8, 9, 10, 11])).toBe('April to November');
    expect(seasonText([11, 12, 1, 2, 3])).toBe('November to March');
    expect(seasonText([1, 3, 5, 7, 9, 11])).toBe('in odd months');
    expect(seasonText([2, 4, 6, 8, 10, 12])).toBe('in even months');
    expect(seasonText([4, 5, 9, 10])).toBe('in April, May, September and October');
    expect(seasonText([6])).toBe('in June');
    expect(seasonText([])).toBeNull();
    expect(seasonText([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBeNull();
  });
  it('find a street however it is typed', () => {
    const { streetKey, findAddress } = globalThis.makeCity(cfg());
    expect(streetKey('West 82nd Street')).toBe(streetKey('W 82nd St'));
    expect(streetKey('w. 82 st')).toBe('W 82 ST');
    expect(streetKey('Swift Av')).toBe(streetKey('Swift Avenue'));
    expect(streetKey('rue Saint-Denis')).toBe(streetKey('Rue St Denis'));
    expect(streetKey('16th Street Northwest')).toBe(streetKey('16th St NW'));
    const b = { ...block, s: 'W 82nd St', n: [200, 299] };
    expect(findAddress([b], 211, 'West 82 Street').block.c).toBe('42');
  });
});

describe('winter alternate side parking (city.json winter: Madison)', () => {
  const W = { from: '2026-11-15', to: '2027-03-15', start: 1, end: 7 };
  const days = (from, to, odd) => { const o = []; for (let t = Date.parse(from + 'T12:00Z'); t <= Date.parse(to + 'T12:00Z'); t += 864e5) { const iso = new Date(t).toISOString().slice(0, 10); if (+iso.slice(8, 10) % 2 === (odd ? 1 : 0)) o.push(iso); } return o; };
  // the left side has the even house numbers, so it is closed on odd dates (park on the odd side then); the right on even
  const file = () => ({ dates: { odd: days(W.from, W.to, true), even: days(W.from, W.to, false) },
    b: [{ c: 'ST1', s: 'Jenifer St', l: 'S Few St - S Baldwin St', n: [1100, 1199], o: 'R', g: [[-89.364, 43.082], [-89.362, 43.083]],
      d: [['L', 'North', [[-1, 1, 7, 0, 0, 7, 'odd']]], ['R', 'South', [[-1, 1, 7, 0, 0, 7, 'even']]]] }] });
  const city = () => globalThis.makeCity(cfg({ tz: 'America/Chicago', winter: W }));
  const at = (iso) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };

  it('names a list once: every rule naming it shares that one array', () => {
    const f = file(), c = city(), [b] = c.expand(f), [left, right] = c.rowsOf(b);
    expect(left.dates).toBe(f.dates.odd);
    expect(right.dates).toBe(f.dates.even);
    expect(left.flags).toBe(7);
    expect(c.isWinterRule(left)).toBe(true);
  });
  it('applies only while the City enforces it: nothing while it waits, from its first night once it is on', () => {
    at('2026-11-30T22:00:00Z');   // Mon Nov 30, 4 PM in Madison: tonight's window is Tue Dec 1, 1 to 7 AM
    const c = city(), [left, right] = c.rowsOf(c.expand(file())[0]);
    expect(c.core.nextSweep(left)).toBe(null);
    c.setWinter({ state: 'on', from: '2026-12-01' });
    expect(c.core.nextSweep(left).start.toISOString()).toBe('2026-12-01T07:00:00.000Z');    // Dec 1 is odd: the even side closes
    expect(c.core.nextSweep(right).start.toISOString()).toBe('2026-12-02T07:00:00.000Z');
    c.setWinter({ state: 'on', from: '2026-12-02' });                                        // on from the next night only
    expect(c.core.nextSweep(left).start.toISOString()).toBe('2026-12-03T07:00:00.000Z');
    c.setWinter({ state: 'paused' });
    expect(c.core.nextSweep(left)).toBe(null);
    expect(c.setWinter({ state: 'on' }).state).toBe('waiting');                              // on with no first night: not on
    expect(c.setWinter(null).state).toBe('waiting');                                         // an unreadable switch
  });
  it('tonight is the coming night until its window ends at 7 AM; the odd side parks on odd dates', () => {
    const c = city();
    c.setWinter({ state: 'on', from: '2026-12-01' });
    at('2026-12-02T09:00:00Z');   // 3 AM Dec 2: inside the window of the night of Dec 1
    expect(c.winterNight()).toMatchObject({ iso: '2026-12-02', park: 'even', inWindow: true, inSeason: true, enforced: true });
    at('2026-12-02T13:30:00Z');   // 7:30 AM: that night is over, tonight is Dec 2 into Dec 3
    expect(c.winterNight()).toMatchObject({ iso: '2026-12-03', park: 'odd', inWindow: false, enforced: true });
    at('2026-10-19T03:00:00Z');   // October: before the season, not enforced even when switched on
    expect(c.winterNight()).toMatchObject({ inSeason: false, enforced: false });
  });
  it('tells a side by its house numbers: a side closed on odd dates is the even side', () => {
    const c = city(), [left, right] = c.rowsOf(c.expand(file())[0]);
    expect(c.winterSide([left]).parity).toBe('even');
    expect(c.winterSide([right]).parity).toBe('odd');
    expect(c.winterSide([{ weekday: 'Tue', fromhour: '8', tohour: '12', flags: 3 }])).toBe(null);
  });
  it('leaves a city without the rule as it was', () => {
    const c = globalThis.makeCity(cfg());
    expect(c.winter).toBe(null);
    expect(c.winterNight()).toBe(null);
    expect(c.suspended({ fromhour: '9', flags: 1 }, '2026-11-11')).toBe(false);
    expect(c.suspended({ fromhour: '9' }, '2026-11-11')).toBe(true);
  });
});

describe('a side-switching rule counted by the evening\'s date (city.json winter.night = "evening": Milwaukee)', () => {
  const W = { from: '2026-10-01', to: '2027-10-31', start: 2, end: 6, night: 'evening', permit: true };
  const city = () => { const c = globalThis.makeCity(cfg({ tz: 'America/Chicago', winter: W })); c.setWinter({ state: 'on', from: '2026-10-01' }); return c; };
  it('parks on the side of the evening\'s date: the night of Dec 1 (odd) into Dec 2, the odd side', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-01T22:00:00Z'));   // 4 PM Dec 1 in Milwaukee
    const c = city();
    expect(c.winterNight()).toMatchObject({ iso: '2026-12-02', park: 'odd', enforced: true });
    expect(c.winterPark('2027-02-01')).toBe('odd');   // the night of Jan 31 (odd) into Feb 1
    expect(c.winterPark('2027-03-01')).toBe('even');  // the night of Feb 28 (even) into Mar 1
  });
  it('knows each side by its house numbers, and a through highway\'s two rules: the winter ban on both sides, the standard rule after', () => {
    const c = city();
    const block = { c: 'MK1', s: 'S Clement Ave', l: 'E Idaho St - E Manitoba St', n: [2948, 2999], o: 'R', g: [[-87.894, 42.989], [-87.894, 42.990]],
      d: [['L', 'West', [[-1, 2, 6, 0, 0, 14, ['2026-12-01', '2026-12-02']], [-1, 2, 6, 0, 0, 6, ['2027-03-03']]]],
        ['R', 'East', [[-1, 2, 6, 0, 0, 14, ['2026-12-01', '2026-12-02']], [-1, 2, 6, 0, 0, 6, ['2027-03-02']]]]] };
    const rows = c.rowsOf(block), west = rows.filter((r) => r.cnnrightleft === 'L');
    expect(rows.map((r) => r.parity)).toEqual(['even', 'even', 'odd', 'odd']);
    const ws = c.winterSide(west);
    expect(ws.parity).toBe('even');
    expect(ws.rules).toHaveLength(2);
    expect([ws.closed('2026-12-02'), ws.both('2026-12-02')]).toEqual([true, true]);
    expect([ws.closed('2027-03-03'), ws.both('2027-03-03')]).toEqual([true, false]);
    expect(ws.closed('2027-03-02')).toBe(false);
  });
});
