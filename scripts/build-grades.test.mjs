// The grade build's arithmetic, and the data file's promises about the blocks it was checked on.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { metres, sampleAlong, gradeOf, wayAlong, MIN_GRADE } from './build-grades.mjs';

describe('sampleAlong', () => {
  it('spaces points evenly along a bent line, both ends included', () => {
    const line = [[-122.44, 37.76], [-122.44, 37.761], [-122.439, 37.761]];
    const { points, length } = sampleAlong(line, 5);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual(line[0]);
    expect(points[4][0]).toBeCloseTo(line[2][0], 9);
    expect(points[4][1]).toBeCloseTo(line[2][1], 9);
    expect(length).toBeCloseTo(metres(line[0], line[1]) + metres(line[1], line[2]), 6);
    for (let i = 1; i < 5; i++) expect(metres(points[i - 1], points[i]) / (length / 4)).toBeLessThan(1.001);
  });
});

describe('gradeOf', () => {
  it('reads the steepest quarter, not end to end: a block flattens at the cross streets', () => {
    // flat for a quarter, then 10 m rise in each of the next two 25 m quarters, then flat
    const g = gradeOf([100, 100, 110, 120, 120], 100);
    expect(g.grade).toBeCloseTo(40, 6);
    expect(g.dir).toBe(1);
  });

  it('says which way the block climbs along its line', () => {
    expect(gradeOf([120, 115, 110, 105, 100], 200).dir).toBe(-1);
    expect(gradeOf([100, 101, 102, 103, 104], 200).dir).toBe(1);
  });

  it('calls a block that climbs and then drops neither', () => {
    expect(gradeOf([100, 105, 110, 105, 100], 100).dir).toBe(0);
  });

  it('keeps one direction when the other way is only a small wobble', () => {
    expect(gradeOf([100, 105, 104.9, 110, 115], 100).dir).toBe(1);
  });

  it('goes end to end on a short block, where quarters are lidar noise', () => {
    expect(gradeOf([100, 102, 100, 102, 101], 20).grade).toBeCloseTo(5, 6);
  });

  it('does not believe one steep quarter among flat ones: a bridge, a tunnel, an overpass', () => {
    // 3rd St's bridge: the first samples are the water under it
    expect(gradeOf([-1.1, -1.1, 3.9, 3.7, 3.6], 51).grade).toBeCloseTo((4.7 / 51) * 100, 6);
    // the higher of the other quarters when that beats end to end
    expect(gradeOf([100, 104, 100, 112, 112], 100).grade).toBeCloseTo(16, 6);
  });

  it('believes a steep block whose quarters agree', () => {
    expect(gradeOf([100, 104, 112, 120, 124], 100).grade).toBeCloseTo(32, 6);
  });

  it('gives nothing for a block with no length', () => {
    expect(gradeOf([100, 100, 100, 100, 100], 0)).toBeNull();
  });
});

describe('wayAlong', () => {
  const line = [[0, 0], [0, 1]], reversed = [[0, 1], [0, 0]];
  it('keeps the way when the two datasets draw the block the same way round', () => {
    expect(wayAlong('F', line, line)).toBe('F');
    expect(wayAlong('T', line, line)).toBe('T');
  });
  it('flips it when they draw it the other way round', () => {
    expect(wayAlong('F', line, reversed)).toBe('T');
    expect(wayAlong('T', line, reversed)).toBe('F');
  });
  it('leaves two way alone and an empty oneway unknown', () => {
    expect(wayAlong('B', line, reversed)).toBe('B');
    expect(wayAlong(undefined, line, line)).toBe('');
  });
});

describe('data/grades.json', () => {
  const { b, _meta } = JSON.parse(readFileSync(new URL('../data/grades.json', import.meta.url), 'utf8'));
  it("agrees with the City's published grades", () => {
    expect(b['1201000'][0] / 10).toBeCloseTo(31.5, 0);   // 22nd St, Church to Vicksburg
    expect(b['13552000'][0] / 10).toBeCloseTo(26, 0);     // Webster St, Vallejo to Broadway
    expect(b['5559000'][0] / 10).toBeCloseTo(24, 0);     // Fillmore St, Vallejo to Broadway
  });

  it('keeps only blocks at the minimum grade, in the shape lib/hill.js reads', () => {
    expect(_meta.minGrade).toBe(MIN_GRADE);
    for (const [g, dir, way] of Object.values(b)) {
      expect(g).toBeGreaterThanOrEqual(MIN_GRADE * 10);
      expect(g).toBeLessThanOrEqual(450);
      expect([1, -1, 0]).toContain(dir);
      expect(['B', 'F', 'T', '']).toContain(way);
    }
  });

  it("reads the block behind this feature: 838 Buena Vista Ave West, a two way street falling along its line", () => {
    const [g, dir, way] = b['3370000'];
    expect(g).toBeGreaterThan(70);
    expect(g).toBeLessThan(100);
    expect(dir).toBe(-1);
    expect(way).toBe('B');
  });
});
