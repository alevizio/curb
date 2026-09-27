// Checks the committed output of build-hood-pages.mjs against data/schedules.json: every internal
// link on the /n/ pages lands on a real page, and retired pages are gone and redirected.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const S = JSON.parse(read('data/schedules.json'));
const pages = readdirSync(new URL('n/', ROOT)).filter((f) => f.endsWith('.html') && f !== 'index.html');

describe('neighborhood pages', () => {
  it('exist exactly for the neighborhoods /b/ pages link to (lib/hoods.js rule)', () => {
    const flagged = S.hoods.filter((h) => h[2]).map((h) => `${h[1]}.html`).sort();
    expect(pages.sort()).toEqual(flagged);
  });

  it('link every swept block of the neighborhood, and only blocks that render', () => {
    for (const f of pages) {
      const html = read(`n/${f}`);
      const linked = [...html.matchAll(/href="\/b\/(\d+)"/g)].map((m) => m[1]);
      const own = Object.entries(S.b).filter(([, e]) => S.hoods[e[3]] && `${S.hoods[e[3]][1]}.html` === f).map(([c]) => c);
      expect(linked.length, f).toBe(own.length);
      expect(linked.filter((c) => !S.b[c]), f).toEqual([]);
    }
  });

  it('only link neighborhood pages that exist', () => {
    for (const f of [...pages, 'index.html']) {
      const hrefs = [...read(`n/${f}`).matchAll(/href="\/n\/([a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(hrefs.filter((s) => !pages.includes(`${s}.html`)), f).toEqual([]);
    }
  });

  it('the home page links every neighborhood page, once, from its static HTML', () => {
    const block = read('index.html').match(/<!-- hoods:start[^>]*-->([\s\S]*?)<!-- hoods:end -->/)[1];
    const hrefs = [...block.matchAll(/href="\/n\/([a-z0-9-]+)"/g)].map((m) => `${m[1]}.html`);
    expect(hrefs.sort()).toEqual(pages.sort());
  });

  it('retired pages (Presidio, Golden Gate Park) are deleted and 301 to /n/', () => {
    const v = JSON.parse(read('vercel.json'));
    for (const s of ['presidio', 'golden-gate-park']) {
      expect(existsSync(new URL(`n/${s}.html`, ROOT))).toBe(false);
      expect(v.redirects).toContainEqual({ source: `/n/${s}`, destination: '/n/', statusCode: 301 });
    }
  });
});
