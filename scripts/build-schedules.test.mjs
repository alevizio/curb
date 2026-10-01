// Tests for the pure parts of the schedule bake (scripts/build-schedules.mjs): DataSF street-text
// cleanup, neighbor detection along a street, and the tags that keep block titles distinct.
import { describe, it, expect } from 'vitest';
import { cleanStreet, cleanEnd, cleanLimits, knownNames, blockRange, buildBlocks, neighbors, parseRanges, samePage } from './build-schedules.mjs';

const row = (o) => ({ cnn: '1000', corridor: 'Pierce St', limits: 'Pine St  -  California St', blockside: 'East', weekday: 'Mon',
  fromhour: '8', tohour: '10', week1: '1', week2: '0', week3: '1', week4: '0', week5: '0', holidays: '0',
  line: { type: 'LineString', coordinates: [[-122.44, 37.78], [-122.44, 37.781]] }, ...o });

describe('street text cleanup', () => {
  const known = new Set(['Mission Bay Blvd', 'Van Ness Ave', 'Naylor St', 'Taylor St', 'Vara St', 'Tara St', 'Corona St', 'Toyon Ln']);
  it('drops zero padding from numbered streets ("09th Ave" → "9th Ave")', () => {
    expect(cleanStreet('09th Ave')).toBe('9th Ave');
    expect(cleanStreet('01st St')).toBe('1st St');
    expect(cleanStreet('10th St')).toBe('10th St');
  });
  it('turns Start:/End: address placeholders and bare "End" into no cross street', () => {
    expect(cleanEnd('Start: 01-99 Block', known)).toBe('');
    expect(cleanEnd('End:  Block', known)).toBe('');
    expect(cleanEnd('ND', known)).toBe('');
    expect(cleanEnd('nd', known)).toBe('');
  });
  it('restores clipped first letters from known street names', () => {
    expect(cleanEnd('ission Bay Blvd', known)).toBe('Mission Bay Blvd');
    expect(cleanEnd('n Ness Ave', known)).toBe('Van Ness Ave');
    expect(cleanEnd('rona St End Loop', known)).toBe('Corona St End Loop');
    expect(cleanEnd('OYON LN', known)).toBe('Toyon Ln');
  });
  it('prefers a name already used on the same street when a clip is ambiguous', () => {
    expect(cleanEnd('AYLOR ST', known, new Set(['Naylor St']))).toBe('Naylor St');
    expect(cleanEnd('ara St', known, new Set(['Vara St']))).toBe('Vara St');
  });
  it('breaks a tie toward the name the street itself is built on', () => {
    // DataSF: Berry Extension St, "erry St - Mission Bay Blvd" — Berry St, not Perry St across town
    const k = new Set(['Perry St', 'Berry St', 'Cherry St', 'Mission Bay Blvd']);
    expect(cleanEnd('erry St', k, new Set(['Berry Extension St', 'Mission Bay Blvd']))).toBe('Berry St');
    expect(cleanEnd('erry St', new Set(['Berry St', 'Perry St']), new Set(['Perry Aly']))).toBe('Perry St');
  });
  it('keeps the first street of a multi-street corner', () => {
    expect(cleanEnd('Bay Shore Blvd \\ Bayview Park Rd', new Set(['Bay Shore Blvd']))).toBe('Bay Shore Blvd');
  });
  it('never repeats a street: same street at both ends, or the block\'s own street, collapse', () => {
    const k = new Set(['Albion St', 'Entrada Ct']);
    expect(cleanLimits('16th St', 'Albion St  -  Albion St', k)).toEqual(['Albion St', '']);
    expect(cleanLimits('Entrada Ct', 'Entrada Ct  -  Entrada Ct', k)).toEqual(['', '']);
    expect(cleanLimits('Lake St', 'Start: 01-99 Block  -  25th Ave', new Set(['25th Ave']))).toEqual(['25th Ave', '']);
  });
  it('reads address ranges out of placeholders for tags', () => {
    expect(blockRange('Dorado Ter  -  End: 161-199 Block')).toBe('161 to 199 block');
    expect(blockRange('lock Of  701  -  749')).toBe('701 to 749 block');
    expect(blockRange('Pine St  -  California St')).toBe('');
  });
  it('builds known names only from well-formed text', () => {
    const k = knownNames([row({ limits: 'ission Bay Blvd - Channel St' })]);
    expect(k.has('Pierce St')).toBe(true);
    expect(k.has('Channel St')).toBe(true);
    expect(k.has('ission Bay Blvd')).toBe(false);
  });
});

describe('buildBlocks', () => {
  it('groups rows per cnn, week flags as a mask, rows sorted Monday-first', () => {
    const [b] = buildBlocks([row({ weekday: 'Sun' }), row({ weekday: 'Tues', blockside: 'West' }), row({ weekday: 'Holiday' })]);
    expect(b.street).toBe('Pierce St');
    expect([b.a, b.b]).toEqual(['Pine St', 'California St']);
    expect(b.rows).toEqual([['West', 2, 8, 10, 5, 0], ['East', 0, 8, 10, 5, 0]]); // "Holiday" rows have no weekday
    expect(b.tag).toBe('');
  });
  it('drops rows whose cnn is not a plain number (the /b/ handler would 404 it; it lands in hrefs)', () => {
    const bs = buildBlocks([row({ cnn: '1"><script>x</script>' }), row({ cnn: '' }), row({ cnn: '2000.0' })]);
    expect(bs.map((b) => b.cnn)).toEqual(['2000']);
  });
  it('tags the two halves of a divided road by curb side so their titles differ', () => {
    const bs = buildBlocks([row({ cnn: '188101', corridor: '03rd St', limits: '18th St - 19th St' }),
      row({ cnn: '188201', corridor: '03rd St', limits: '18th St - 19th St', blockside: 'West' })]);
    expect(bs.map((b) => b.tag)).toEqual(['east side', 'west side']);
  });
  it('falls back to the roadway direction when both halves list the same sides', () => {
    const w = [[-122.4175, 37.7765], [-122.4163, 37.7774]];
    const bs = buildBlocks([
      row({ cnn: '8753101', corridor: 'Market St', blockside: 'NorthWest', line: { coordinates: [w[0], [-122.4169, 37.77690], w[1]] } }),
      row({ cnn: '8753101', corridor: 'Market St', blockside: 'SouthEast', line: { coordinates: [w[0], [-122.4169, 37.77690], w[1]] } }),
      row({ cnn: '8753201', corridor: 'Market St', blockside: 'NorthWest', line: { coordinates: [w[0], [-122.4170, 37.77700], w[1]] } }),
      row({ cnn: '8753201', corridor: 'Market St', blockside: 'SouthEast', line: { coordinates: [w[0], [-122.4170, 37.77700], w[1]] } }),
    ]);
    expect(bs.map((b) => b.tag)).toEqual(['southeast roadway', 'northwest roadway']);
  });
});

describe('neighbors', () => {
  const blk = (cnn, street, ends) => ({ cnn, street, ends });
  it('links blocks of the same street that share an endpoint, ignoring other streets and twins', () => {
    const A = [-122.44, 37.78], B = [-122.44, 37.781], C = [-122.44, 37.782];
    const adj = neighbors([
      blk('1000', 'Pierce St', [A, B]), blk('2000', 'Pierce St', [B, C]),
      blk('3000', 'Pine St', [B, [-122.441, 37.781]]),   // crosses at B, other street
      blk('2101', 'Pierce St', [B, C]),                  // twin of 2000 (same stretch)
    ]);
    expect(adj.get('1000')).toEqual(['', '2000']);
    expect(adj.get('2000')).toEqual(['1000', '']);
    expect(adj.get('3000')).toEqual(['', '']);
  });
});

describe('house-number ranges', () => {
  it('reads the EAS min/max per cnn, dropping junk cnns and the 0 placeholder', () => {
    const r = parseRanges([{ cnn: '870000', lo: '2900', hi: '2949' }, { cnn: '2672000.0', lo: '2600', hi: '2655' },
      { cnn: 'x"><b>', lo: '1', hi: '2' }, { cnn: '9510000', lo: '0', hi: '431' }, { cnn: '1000' }]);
    expect([...r]).toEqual([['870000', [2900, 2949]], ['2672000', [2600, 2655]]]);
  });
});

describe('samePage (carries the modified date)', () => {
  const entry = ['Pierce St', 'Pine St', 'California St', 3, [['East', 1, 8, 10, 31, 0]], '999', '2000', ''];
  const old = [...entry, '2026-09-01']; // baked before the range field existed
  it('keeps the date of an entry baked before ranges existed when only the range is new', () => {
    expect(samePage(old, 'Pacific Heights', entry, 'Pacific Heights', [2100, 2199])).toBe(true);
    expect(samePage(old, 'Pacific Heights', entry, 'Pacific Heights', [])).toBe(true);
  });
  it('moves it once a baked range changes, appears or goes away', () => {
    expect(samePage([...old, [2100, 2199]], 'Pacific Heights', entry, 'Pacific Heights', [2100, 2199])).toBe(true);
    expect(samePage([...old, [2100, 2199]], 'Pacific Heights', entry, 'Pacific Heights', [2100, 2150])).toBe(false);
    expect(samePage([...old, []], 'Pacific Heights', entry, 'Pacific Heights', [2100, 2199])).toBe(false);
    expect(samePage([...old, [2100, 2199]], 'Pacific Heights', entry, 'Pacific Heights', [])).toBe(false);
  });
  it('still moves it for a new block, a schedule change or another neighborhood (compared by name)', () => {
    expect(samePage(undefined, undefined, entry, 'Pacific Heights', [])).toBe(false);
    expect(samePage(old, 'Pacific Heights', [...entry.slice(0, 4), [['East', 2, 8, 10, 31, 0]], ...entry.slice(5)], 'Pacific Heights', [])).toBe(false);
    expect(samePage(old, 'Presidio', entry, 'Pacific Heights', [])).toBe(false);
    expect(samePage([...entry.slice(0, 3), 7, ...entry.slice(4), '2026-09-01'], 'Pacific Heights', entry, 'Pacific Heights', [])).toBe(true);
  });
});
