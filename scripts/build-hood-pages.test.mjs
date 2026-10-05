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

  it('say San Francisco (or SF) in the title, description and H1, with unique titles under 60 characters', () => {
    const titles = new Set();
    for (const f of pages) {
      const html = read(`n/${f}`);
      const title = html.match(/<title>(.*?)<\/title>/)[1];
      const desc = html.match(/<meta name="description" content="(.*?)"/)[1];
      const h1 = html.match(/<h1>(.*?)<\/h1>/)[1];
      for (const t of [title, desc, h1]) expect(t, f).toMatch(/\b(San Francisco|SF)\b/);
      expect(title.length, f).toBeLessThan(60);
      expect(desc.length, f).toBeLessThanOrEqual(165);
      expect(titles.has(title), f).toBe(false);
      titles.add(title);
    }
  });

  it('"Open the map" opens the map framed on that neighborhood (/?bbox=), not the default center', () => {
    const maps = JSON.parse(read('data/hood-maps.json'));
    for (const f of pages) {
      const cta = read(`n/${f}`).match(/<a class="btn" href="([^"]*)">Open the map/)[1];
      expect(cta, f).toBe(`/?bbox=${maps[f.replace('.html', '')].bbox.join(',')}`);
    }
  });

  // The holiday model (lib/sweep-core.js sweepSuspended, told on /holidays): regular sweeps stop on every listed holiday,
  // overnight routes included; blocks with a posted holiday schedule are swept at those hours, except on New Year's
  // Day, Thanksgiving and Christmas. The FAQ (visible and in the FAQPage JSON-LD) must say the same.
  it('the holidays FAQ tells the holiday model, in the page and its JSON-LD', () => {
    for (const f of pages) {
      const html = read(`n/${f}`);
      const faq = html.match(/<summary>Is street cleaning enforced on holidays\?<\/summary><p>(.*?)<\/p>/)[1];
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'][0].mainEntity
        .find((q) => /holidays\?$/.test(q.name)).acceptedAnswer.text;
      for (const t of [faq.replace(/<\/?b>/g, '').replace(/&#39;|&apos;/g, "'"), ld]) {
        expect(t, f).toMatch(/^Regular street sweeping stops on every city holiday SFMTA lists/);
        expect(t, f).toContain('overnight routes included');
        expect(t, f).toMatch(/About \d{3} blocks post a holiday schedule on their sign, like HOLIDAYS 4 TO 6AM/);
        expect(t, f).toContain("except on New Year's Day, Thanksgiving and Christmas, when nothing is swept");
        expect(t, f).not.toMatch(/routes still run|—/);
      }
    }
  });

  it('retired pages (Presidio, Golden Gate Park) are deleted and 301 to /n/', () => {
    const v = JSON.parse(read('vercel.json'));
    for (const s of ['presidio', 'golden-gate-park']) {
      expect(existsSync(new URL(`n/${s}.html`, ROOT))).toBe(false);
      expect(v.redirects).toContainEqual({ source: `/n/${s}`, destination: '/n/', statusCode: 301 });
    }
  });
});
