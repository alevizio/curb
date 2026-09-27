// Tests for the IndexNow submitter (scripts/indexnow.mjs) — fetch is mocked; nothing is sent.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KEY, parseSitemap, changedUrls, submit } from './indexnow.mjs';

const sm = (...urls) => parseSitemap(`<urlset>${urls.map(([loc, mod]) => `<url><loc>${loc}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`).join('')}</urlset>`);
const B = 'https://curb.guide';

describe('changedUrls', () => {
  it('returns added, re-dated and removed URLs, not unchanged ones', () => {
    const before = [sm([`${B}/`, '2026-09-01'], [`${B}/n/presidio`, '2026-09-01']), sm([`${B}/b/1`, '2026-09-01'], [`${B}/b/2`, '2026-09-01'])];
    const after = [sm([`${B}/`, '2026-09-01'], [`${B}/support`, '2026-06-29']), sm([`${B}/b/1`, '2026-10-01'], [`${B}/b/2`, '2026-09-01'])];
    expect(changedUrls(before, after).sort()).toEqual([`${B}/b/1`, `${B}/n/presidio`, `${B}/support`]);
  });
  it('treats every URL as new when there is no previous sitemap', () => {
    expect(changedUrls([parseSitemap('')], [sm([`${B}/`, ''])])).toEqual([`${B}/`]);
  });
  it('never submits another host', () => {
    expect(changedUrls([new Map()], [sm(['https://curb-nu.vercel.app/', '2026-09-27'])])).toEqual([]);
  });
});

describe('submit', () => {
  it('POSTs host, key, key location and the URLs, in batches of 10,000', async () => {
    const calls = [];
    const f = async (url, opts) => { calls.push({ url, opts }); return { status: 200 }; };
    const urls = Array.from({ length: 10001 }, (_, i) => `${B}/b/${i}`);
    expect(await submit(urls, f)).toEqual([200, 200]);
    expect(calls[0].url).toBe('https://api.indexnow.org/indexnow');
    expect(calls[0].opts.method).toBe('POST');
    const body = JSON.parse(calls[0].opts.body);
    expect(body).toMatchObject({ host: 'curb.guide', key: KEY, keyLocation: `https://curb.guide/${KEY}.txt` });
    expect(body.urlList).toHaveLength(10000);
    expect(JSON.parse(calls[1].opts.body).urlList).toEqual([`${B}/b/10000`]);
  });
  it('accepts 202 (key still being verified) and throws on a rejected batch', async () => {
    expect(await submit([`${B}/`], async () => ({ status: 202 }))).toEqual([202]);
    await expect(submit([`${B}/`], async () => ({ status: 403 }))).rejects.toThrow('IndexNow answered 403');
  });
});

describe('key file', () => {
  it('is served from the site root and matches the key the script sends', () => {
    expect(KEY).toMatch(/^[a-f0-9]{32}$/);
    expect(readFileSync(new URL(`../${KEY}.txt`, import.meta.url), 'utf8').trim()).toBe(KEY);
  });
});
