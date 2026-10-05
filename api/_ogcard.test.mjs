// Tests for the /api/og share card (api/_ogcard.js). Named _ogcard.test.mjs so Vercel never routes it
// as a function (the "_" prefix).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { renderCard } from './_ogcard.js';

const ROOT = new URL('../', import.meta.url);

describe('og share card', () => {
  it('renders a 1200x630 PNG for a real block', async () => {
    const png = await renderCard({ corridor: 'Steiner St', limits: 'Laussat St to Haight St', day: 'WED', window: '9 TO 11AM', enf: '9:05am' });
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200); // IHDR width
    expect(png.readUInt32BE(20)).toBe(630); // IHDR height
  });

  // Vercel's file tracer does not follow these runtime wasm reads, so each one must be in includeFiles.
  // Without hb.wasm, satori 0.33+ (harfbuzzjs) aborts on import: the og function crashes on cold start.
  it('vercel.json ships every wasm file the card pipeline reads at runtime', () => {
    const inc = JSON.parse(readFileSync(new URL('vercel.json', ROOT), 'utf8')).functions['api/og.js'].includeFiles;
    for (const f of ['node_modules/@resvg/resvg-wasm/index_bg.wasm', 'node_modules/harfbuzzjs/hb.wasm']) {
      expect(existsSync(new URL(f, ROOT)), f).toBe(true);
      expect(inc, f).toContain(f);
    }
  });
});
