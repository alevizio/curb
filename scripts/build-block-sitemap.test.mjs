// Checks the committed sitemaps: every URL carries a real <lastmod>, and every block URL is one the
// /b/ handler serves (a cnn in data/schedules.json) — a sitemap must never list a 404.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gitDate } from './lastmod.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const urls = (xml) => [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  loc: m[1].match(/<loc>(.*?)<\/loc>/)[1], lastmod: (m[1].match(/<lastmod>(.*?)<\/lastmod>/) || [])[1] }));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

describe('sitemap-blocks.xml', () => {
  const S = JSON.parse(read('data/schedules.json')).b;
  const list = urls(read('sitemap-blocks.xml'));
  it('lists every baked block exactly once', () => {
    const locs = list.map(({ loc }) => loc.replace('https://curb.guide/b/', ''));
    expect(new Set(locs).size).toBe(locs.length);
    expect([...locs].sort()).toEqual(Object.keys(S).sort());
  });
  it('lists only baked blocks, each with a lastmod no older than its schedule entry', () => {
    expect(list.length).toBeGreaterThan(8000);
    const bad = list.filter(({ loc, lastmod }) => {
      const cnn = loc.replace('https://curb.guide/b/', '');
      return !S[cnn] || !DAY.test(lastmod || '') || lastmod < S[cnn][8];
    });
    expect(bad).toEqual([]);
  });
});

describe('sitemap.xml', () => {
  const list = urls(read('sitemap.xml'));
  it('has /support, no retired pages, and a lastmod on every URL', () => {
    const locs = list.map((u) => u.loc);
    expect(locs).toContain('https://curb.guide/support');
    expect(locs).not.toContain('https://curb.guide/n/presidio');
    expect(locs).not.toContain('https://curb.guide/n/golden-gate-park');
    expect(list.filter((u) => !DAY.test(u.lastmod || ''))).toEqual([]);
  });
});

describe('gitDate', () => {
  it('dates a committed file by its last commit, and a missing one as null', () => {
    expect(gitDate('LICENSE')).toMatch(DAY);
    expect(gitDate('no/such/file.html')).toBe(null);
  });
});

describe('robots.txt', () => {
  it('advertises both sitemaps and lets share cards through while /api/ stays blocked', () => {
    const r = read('robots.txt');
    expect(r).toMatch(/^Allow: \/api\/og$/m);
    expect(r).toMatch(/^Disallow: \/api\/$/m);
    expect(r).toContain('Sitemap: https://curb.guide/sitemap.xml');
    expect(r).toContain('Sitemap: https://curb.guide/sitemap-blocks.xml');
  });

  // The longest matching rule wins (RFC 9309); Allow wins a tie.
  const allowed = (path) => {
    const rules = [...read('robots.txt').matchAll(/^(Allow|Disallow): (\S+)$/gm)].map((m) => ({ allow: m[1] === 'Allow', prefix: m[2] }));
    const hit = rules.filter((x) => path.startsWith(x.prefix)).sort((a, b) => b.prefix.length - a.prefix.length || b.allow - a.allow)[0];
    return !hit || hit.allow;
  };
  it('keeps crawlers off the live map deep links, and the pages that link to them stay crawlable', () => {
    for (const p of ['/?b=13065000', '/?b=13065000&side=West', '/?bbox=-122.43,37.75,-122.40,37.77']) expect(allowed(p), p).toBe(false);
    for (const p of ['/', '/b/13065000', '/b/13065000?side=West', '/n/mission', '/about', '/tickets', '/api/og?b=13065000', '/sitemap-blocks.xml']) expect(allowed(p), p).toBe(true);
    expect(allowed('/api/block?cnn=1')).toBe(false);
  });
  it('is one group that names Meta\'s crawlers, so the matcher above is the whole story', () => {
    const lines = read('robots.txt').split('\n').filter((l) => /^(User-agent|Allow|Disallow):/.test(l));
    const firstRule = lines.findIndex((l) => !l.startsWith('User-agent:'));
    expect(lines.slice(firstRule).some((l) => l.startsWith('User-agent:'))).toBe(false);
    expect(lines.slice(0, firstRule)).toEqual(['User-agent: *', 'User-agent: meta-externalagent', 'User-agent: meta-webindexer']);
    // first-match parsers stop at the first rule that matches, so nothing broad may come before a Disallow
    expect(lines).not.toContain('Allow: /');
  });
});
