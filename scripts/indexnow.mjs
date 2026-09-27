#!/usr/bin/env node
// Tell IndexNow (Bing, Yandex, Seznam, Naver… — Google doesn't take part) which curb.guide URLs
// changed, so they recrawl in hours instead of whenever. "Changed" = URLs added, removed, or with a
// new <lastmod> between two versions of sitemap.xml + sitemap-blocks.xml: a git ref vs the working
// tree. Free, no account: the key file <KEY>.txt at the site root proves we own the host.
//
//   npm run indexnow -- [--since <git-ref>] [--dry-run]
//     --since    compare against this commit's sitemaps (default HEAD~1, the refresh commit's parent)
//     --dry-run  print the URLs, send nothing
// Run only once the new sitemaps are live (data-refresh waits for the deploy), or crawlers fetch
// the old pages.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KEY = '71aabb1f18854413823b971dfe671c61';
const HOST = 'curb.guide';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const SITEMAPS = ['sitemap.xml', 'sitemap-blocks.xml'];
const BATCH = 10000; // IndexNow's per-request URL cap

/** <loc> → <lastmod> ('' when absent) for one sitemap. */
export const parseSitemap = (xml) => new Map([...String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)]
  .map((m) => [m[1].match(/<loc>(.*?)<\/loc>/)?.[1], m[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1] || ''])
  .filter(([loc]) => loc));

/** URLs added, removed (engines should drop them) or re-dated between two sitemap sets. */
export function changedUrls(before, after) {
  const a = new Map(before.flatMap((m) => [...m])), b = new Map(after.flatMap((m) => [...m]));
  const out = [...b].filter(([loc, mod]) => !a.has(loc) || a.get(loc) !== mod).map(([loc]) => loc);
  for (const loc of a.keys()) if (!b.has(loc)) out.push(loc);
  return out.filter((u) => u.startsWith(`https://${HOST}/`));
}

/** POST the URLs in batches; resolves to the HTTP statuses, throws on a rejected batch. */
export async function submit(urls, f = fetch) {
  const statuses = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    const r = await f(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls.slice(i, i + BATCH) }),
    });
    // 200 = accepted, 202 = accepted while the key is still being checked; 403 = key file not
    // reachable, 422 = URL not on this host, 429 = slow down
    if (r.status !== 200 && r.status !== 202) throw new Error(`IndexNow answered ${r.status} for batch ${i / BATCH + 1}`);
    statuses.push(r.status);
  }
  return statuses;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : 'HEAD~1';
  const root = fileURLToPath(new URL('../', import.meta.url));
  const old = (file) => {
    try { return execFileSync('git', ['show', `${since}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
  };
  const urls = changedUrls(SITEMAPS.map((f) => parseSitemap(old(f))), SITEMAPS.map((f) => parseSitemap(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))));
  console.error(`[indexnow] ${urls.length} changed URLs since ${since}`);
  if (args.includes('--dry-run')) console.log(urls.join('\n'));
  else if (urls.length) console.error(`[indexnow] submitted — ${(await submit(urls)).join(', ')}`);
}
