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
