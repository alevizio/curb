#!/usr/bin/env node
// Sanity-checks the built data/*.json assets BEFORE they're committed by the monthly
// refresh Action. The point is to fail LOUDLY if a Socrata (or ArcGIS) source changes
// shape — a renamed column or an empty page silently produces a tiny/garbage file, and
// without this guard the cron would happily commit it and break the live map.
//
// Bounds are deliberately wide (~±50% of the 2026-06 baseline) — they catch
// catastrophe (empty / 10x duplicated / structurally wrong), not normal drift.
//
// Run: npm run validate:data   (exits non-zero on any failure)

import { readFileSync } from 'node:fs';

const here = new URL('../data/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, here), 'utf8'));

const errors = [];
const check = (file, label, value, min, max) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    errors.push(`${file}: ${label} is not a number (got ${JSON.stringify(value)}) — source shape changed?`);
  } else if (value < min || value > max) {
    errors.push(`${file}: ${label} = ${value} outside sane bounds [${min}, ${max}]`);
  } else {
    console.error(`  ok  ${file}: ${label} = ${value} (in [${min}, ${max}])`);
  }
};

try {
  // enforcement.json — object keyed by cnn, counts live in _meta
  const enf = load('enforcement.json');
  check('enforcement.json', 'meta.blocks', enf._meta?.blocks, 5000, 20000);
  check('enforcement.json', 'meta.side_days', enf._meta?.side_days, 8000, 40000);
  check('enforcement.json', 'keyed entries', Object.keys(enf).filter((k) => k !== '_meta').length, 5000, 20000);

  // overview.json — { _meta, b:[...] }
  const ov = load('overview.json');
  check('overview.json', 'b[] length', Array.isArray(ov.b) ? ov.b.length : NaN, 8000, 20000);
  check('overview.json', 'meta.blocks', ov._meta?.blocks, 8000, 20000);

  // zones.json — { _meta, meters:[...], zones:[...] }
  const zones = load('zones.json');
  check('zones.json', 'meters[] length', Array.isArray(zones.meters) ? zones.meters.length : NaN, 25000, 60000);
  check('zones.json', 'zones[] length', Array.isArray(zones.zones) ? zones.zones.length : NaN, 2500, 12000);

  // white-zones.json — { _meta, zones:[...] }
  const white = load('white-zones.json');
  check('white-zones.json', 'zones[] length', Array.isArray(white.zones) ? white.zones.length : NaN, 800, 6000);

  // stats.json — several small aggregate arrays
  const stats = load('stats.json');
  check('stats.json', 'hoods[] length', Array.isArray(stats.hoods) ? stats.hoods.length : NaN, 30, 60);
  check('stats.json', 'topStreets[] length', Array.isArray(stats.topStreets) ? stats.topStreets.length : NaN, 15, 50);
  check('stats.json', 'sweepDow[] length', Array.isArray(stats.sweepDow) ? stats.sweepDow.length : NaN, 7, 7);
  check('stats.json', 'sweepHour[] length', Array.isArray(stats.sweepHour) ? stats.sweepHour.length : NaN, 18, 26);

  // sweeps.json — sweeper-GPS pass times keyed by cnn (#26-5451), counts live in _meta
  const sw = load('sweeps.json');
  check('sweeps.json', 'meta.blocks', sw._meta?.blocks, 50, 400);
  check('sweeps.json', 'keyed entries', Object.keys(sw).filter((k) => k !== '_meta').length, 50, 400);
} catch (e) {
  errors.push(`failed to read/parse a data file: ${e.message}`);
}

if (errors.length) {
  console.error('\n✗ data validation FAILED:');
  for (const e of errors) console.error('  - ' + e);
  console.error('\nA source likely changed shape. Inspect the build output before committing.');
  process.exit(1);
}
console.error('\n✓ all data assets within sane bounds');
