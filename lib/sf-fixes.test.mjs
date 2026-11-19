// Fixes to the City's sweeping rows: a fix replaces one side's rows only while the City still publishes the rows it was
// written against, keeps DataSF's row shape, and never touches another side or block.
import { describe, it, expect } from 'vitest';
import './sf-fixes.js';
const { applySweepFixes, staleSweepFixes, SF_SWEEP_FIXES } = globalThis;

// Shotwell St, 16th to 17th (issue #66), as DataSF publishes it.
const LINE = { type: 'LineString', coordinates: [[-122.4166, 37.7650], [-122.4164, 37.7633]] };
const row = (blockside, cnnrightleft, weekday, fromhour, tohour, weeks = '11111', cnn = '11834000') => ({
  cnn, corridor: 'Shotwell St', limits: '16th St  -  17th St', blockside, cnnrightleft, weekday, fromhour, tohour,
  week1: weeks[0], week2: weeks[1], week3: weeks[2], week4: weeks[3], week5: weeks[4], holidays: '0', line: LINE,
});
const SHOTWELL = () => [
  row('West', 'R', 'Tues', '8', '10'),
  row('East', 'L', 'Wed', '12', '14'),
  row('West', 'R', 'Fri', '8', '10'),
];
const sideRows = (rows, side) => rows.filter((r) => r.blockside === side);

describe('applySweepFixes', () => {
  it('moves the east side of Shotwell, 16th to 17th, to Thursday 8 to 10 AM', () => {
    const east = sideRows(applySweepFixes(SHOTWELL()), 'East');
    expect(east).toHaveLength(1);
    expect(east[0]).toMatchObject({ weekday: 'Thu', fromhour: '8', tohour: '10', week1: '1', week5: '1' });
  });

  it('keeps the row in DataSF shape: strings, the side\'s line and cnnrightleft', () => {
    const east = sideRows(applySweepFixes(SHOTWELL()), 'East')[0];
    expect(east).toMatchObject({ cnn: '11834000', corridor: 'Shotwell St', cnnrightleft: 'L', holidays: '0' });
    expect(east.line).toBe(LINE);
    expect(Object.keys(east).sort()).toEqual(Object.keys(row('East', 'L', 'Wed', '12', '14')).sort());
  });

  it('leaves the west side and other blocks exactly as the City has them', () => {
    const other = row('North', 'R', 'Mon', '8', '10', '11111', '999000');
    const out = applySweepFixes([...SHOTWELL(), other]);
    expect(sideRows(out, 'West')).toEqual(sideRows(SHOTWELL(), 'West'));
    expect(out).toContainEqual(other);
  });

  it('does not change the rows it was given', () => {
    const rows = SHOTWELL();
    applySweepFixes(rows);
    expect(rows).toEqual(SHOTWELL());
  });

  it('goes quiet once the City changes that side', () => {
    const changed = [row('West', 'R', 'Tues', '8', '10'), row('East', 'L', 'Thu', '9', '11'), row('West', 'R', 'Fri', '8', '10')];
    expect(applySweepFixes(changed)).toEqual(changed);
    const added = [...SHOTWELL(), row('East', 'L', 'Holiday', '4', '6')];
    expect(applySweepFixes(added)).toEqual(added);
    const weeks = [row('West', 'R', 'Tues', '8', '10'), row('East', 'L', 'Wed', '12', '14', '10100')];
    expect(applySweepFixes(weeks)).toEqual(weeks);
  });

  it('passes empty or missing input through', () => {
    expect(applySweepFixes([])).toEqual([]);
    expect(applySweepFixes(undefined)).toBeUndefined();
    const west = sideRows(SHOTWELL(), 'West');
    expect(applySweepFixes(west)).toEqual(west);
  });
});

describe('every fix in the list', () => {
  const sig = (rows) => rows.map((r) => [r.weekday, +r.fromhour, +r.tohour, [r.week1, r.week2, r.week3, r.week4, r.week5].join('')].join('|')).sort().join(';');
  const now = (f) => f.now.map((n) => n.join('|')).sort().join(';');
  const other = (f) => row('Elsewhere', f.lr === 'L' ? 'R' : 'L', 'Mon', '8', '10', '11111', f.cnn);

  it('turns the City\'s rows it was written against into its own', () => {
    for (const f of SF_SWEEP_FIXES) {
      const city = [...f.was.map((w) => row(f.side, f.lr || 'L', w[0], String(w[1]), String(w[2]), w[3], f.cnn)), other(f)];
      expect(sig(applySweepFixes(city).filter((r) => r.blockside === f.side)), f.cnn + ' ' + f.side).toBe(now(f));
    }
  });

  it('builds a side the City doesn\'t list from the block\'s other side, on its own side of the line', () => {
    const unlisted = SF_SWEEP_FIXES.filter((f) => !f.was.length);
    expect(unlisted.length).toBeGreaterThan(0);
    for (const f of unlisted) {
      expect(f.lr).toMatch(/^[LR]$/);
      const added = applySweepFixes([other(f)]).filter((r) => r.blockside === f.side);
      expect(added.length).toBe(f.now.length);
      for (const r of added) expect(r).toMatchObject({ cnn: f.cnn, cnnrightleft: f.lr, line: LINE, holidays: '0' });
    }
  });

  it('adds nothing for an unlisted side when its block isn\'t in the rows', () => {
    const f = SF_SWEEP_FIXES.find((x) => !x.was.length);
    const elsewhere = [row('North', 'R', 'Mon', '8', '10', '11111', '999000')];
    expect(applySweepFixes(elsewhere)).toEqual(elsewhere);
    expect(f).toBeDefined();
  });
});

describe('staleSweepFixes', () => {
  it('is empty while the City still publishes what each fix was written against', () => {
    const rows = SF_SWEEP_FIXES.flatMap((f) => f.was.map((w) => row(f.side, 'L', w[0], String(w[1]), String(w[2]), w[3], f.cnn)));
    expect(staleSweepFixes(rows)).toEqual([]);
  });

  it('names a fix whose side the City changed or dropped', () => {
    const changed = [row('West', 'R', 'Tues', '8', '10'), row('East', 'L', 'Thu', '8', '10')];
    expect(staleSweepFixes(changed).map((f) => f.cnn)).toContain('11834000');
    expect(staleSweepFixes([]).length).toBe(SF_SWEEP_FIXES.filter((f) => f.was.length).length);  // an unlisted side stays unlisted
  });
});

describe('SF_SWEEP_FIXES', () => {
  const DAYS = ['Mon', 'Tues', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Holiday'];  // DataSF's spellings
  const okRow = ([day, from, to, weeks]) => DAYS.includes(day) && Number.isInteger(from) && Number.isInteger(to)
    && from >= 0 && to <= 24 && from < to && /^[01]{5}$/.test(weeks) && weeks.includes('1');

  it('every fix names a block side, what the City says, the fix and why', () => {
    for (const f of SF_SWEEP_FIXES) {
      expect(f.cnn).toMatch(/^\d{1,12}$/);
      expect(f.side).toMatch(/^[A-Za-z]+$/);
      expect(f.was.every(okRow) && (f.was.length > 0 || /^[LR]$/.test(f.lr))).toBe(true);  // an unlisted side says which way it faces
      expect(f.now.length && f.now.every(okRow)).toBe(true);
      expect(f.why.length).toBeGreaterThan(20);
    }
  });

  it('has one fix per block side, and none that changes nothing', () => {
    const keys = SF_SWEEP_FIXES.map((f) => f.cnn + '|' + f.side);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of SF_SWEEP_FIXES) expect(JSON.stringify(f.now)).not.toBe(JSON.stringify(f.was));
  });
});
