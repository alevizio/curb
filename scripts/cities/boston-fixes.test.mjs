// The fixes scripts/cities/boston.mjs makes to the City's data (scripts/cities/boston-fixes.mjs).
import { describe, it, expect } from 'vitest';
import { RENAME, titleCase, nameKey, streetIndex, streetFit, classify, shortcut } from './boston-fixes.mjs';

// [lng, lat] at x meters east and y meters north of a point in Boston
const KX = Math.cos(42.33 * Math.PI / 180) * 111320, KY = 111132;
const at = (x, y) => [-71.07 + x / KX, 42.33 + y / KY];
const line = (...pts) => pts.map(([x, y]) => at(x, y));

describe('street names', () => {
  it('writes SAM capitals for people', () => {
    expect(titleCase("ALLEN'S ALY")).toBe("Allen's Aly");
    expect(titleCase('MCLELLAN ST')).toBe('McLellan St');
    expect(titleCase("O'CONNELL RD")).toBe("O'Connell Rd");
    expect(titleCase('E 9TH ST')).toBe('E 9th St');
  });
  it('fixes each wrong schedule name to a different one, with a reason', () => {
    for (const [from, [to, why]] of Object.entries(RENAME)) {
      expect(to).not.toBe(from);
      expect(why.length).toBeGreaterThan(5);
    }
    expect(RENAME['Yawkey Way'][0]).toBe('Jersey St');
  });
  it('matches OpenStreetMap spellings to the schedule\'s', () => {
    expect(nameKey('Essex Street')).toBe(nameKey('Essex St'));
    expect(nameKey('Saint James Avenue')).toBe(nameKey('St James Ave'));
    expect(nameKey('East Eighth Street')).toBe(nameKey('E Eighth St'));
  });
});

describe('block lines against the basemap\'s streets', () => {
  const streets = [
    { k: 'minor_road', d: 'residential', n: 'Elm Street', c: line([0, 0], [200, 0]) },
    { k: 'path', d: 'pedestrian', n: 'Winter Street', c: line([0, 100], [200, 100]) },
    { k: 'major_road', d: 'secondary', n: 'Essex Street', c: line([0, 300], [200, 300]) },
    { k: 'path', d: 'sidewalk', n: '', c: line([0, 500], [200, 500]) },
  ];
  const grid = streetIndex(streets);
  it('keeps a block on a street for cars', () => {
    const fit = streetFit(line([20, 2], [180, 2]), grid, 'Elm St');
    expect(fit.car).toBe(1);
    expect(fit.worst).toBeLessThanOrEqual(2.1);
    expect(classify(fit)).toBe(null);
  });
  it('finds a block along a pedestrian street', () => {
    const fit = streetFit(line([20, 101], [180, 101]), grid, 'Winter St');
    expect(fit.walk).toBe(1);
    expect(classify(fit)).toBe('pedestrian');
  });
  it('finds a block with no street under it, and a sidewalk is not a street', () => {
    expect(classify(streetFit(line([20, 200], [180, 200]), grid, 'Eliot Pl'))).toBe('off-map');
    expect(classify(streetFit(line([20, 501], [180, 501]), grid, 'Eliot Pl'))).toBe('off-map');
  });
  it('allows 15 m from a street of the same name, not from another one', () => {
    expect(classify(streetFit(line([20, 312], [180, 312]), grid, 'Essex St'))).toBe(null);
    expect(classify(streetFit(line([20, 312], [180, 312]), grid, 'Summer St'))).toBe('off-map');
  });
  it('counts a block that is mostly on a street as on it', () => {
    // 150 m on Elm St, then a 50 m stub where the basemap has nothing
    expect(classify(streetFit(line([0, 1], [150, 1], [150, 51]), grid, 'Elm St'))).toBe(null);
  });
});

describe('the zoomed out view\'s old straight lines', () => {
  it('measures how far a block strays from the line between its ends', () => {
    expect(shortcut(line([0, 0], [100, 0]))).toBe(0);
    expect(shortcut(line([0, 0], [100, 0], [100, 100]))).toBeCloseTo(70.7, 0);
  });
});
