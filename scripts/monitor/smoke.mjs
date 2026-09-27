// CURB production smoke checks — run every 30 min by .github/workflows/monitor.yml (free Actions).
// Each check hits curb.guide the way a visitor's browser would and returns { name, status, detail }
// with status 'ok' | 'fail' | 'skip'. The DataSF URLs are read straight out of the live index.html, so
// a host move like data.sfgov.org → data.sf.gov (Sep 2026) is caught within one run, not by users.
//
//   node scripts/monitor/smoke.mjs [--digest] [--out results.json]
//     default   uptime + data + basemap + SEO pages + alerts-timer freshness + error spike
//     --digest  nightly: error groups seen >= 3 times in the last 24h (from /api/client-error)
// Env: MONITOR_SITE (default https://curb.guide), CRON_SECRET (error log; skipped if unset),
//      GITHUB_TOKEN + GITHUB_REPOSITORY (alerts-timer freshness; skipped if unset).
import { writeFileSync } from 'node:fs';

export const SITE = process.env.MONITOR_SITE || 'https://curb.guide';
const UA = 'Mozilla/5.0 (curb-monitor; +https://github.com/alevizio/curb)';
const ORIGIN = 'https://curb.guide';
// A known-good block (Market St, Larkin–Polk) and a small Mission polygon with plenty of curbs.
const BLOCK_CNN = '8753101';
const POLY = "POLYGON((-122.42 37.76,-122.41 37.76,-122.41 37.77,-122.42 37.77,-122.42 37.76))";
const TILE = { z: 16, x: 10483, y: 25333 }; // Mission, inside the baked SF set
export const ALERTS_MAX_AGE_MIN = 90;       // sweep-alerts-cron is */15 but GitHub schedules can lag
export const ERROR_SPIKE = 25;               // errors per 30 min that mean "something broke for many"
export const DIGEST_MIN = 3;                 // nightly: only groups seen at least this often

const ok = (name, detail = '') => ({ name, status: 'ok', detail });
const fail = (name, detail) => ({ name, status: 'fail', detail });
const skip = (name, detail) => ({ name, status: 'skip', detail });

async function get(f, url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 20000);
  try {
    return await f(url, { redirect: 'manual', ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}
const moved = (r) => r.status >= 300 && r.status < 400 ? ` → ${r.headers.get('location') || '?'}` : '';

/** Pull the dataset URLs and the basemap template out of the live page source. */
export function parsePage(html) {
  const data = {};
  for (const m of html.matchAll(/const (SWEEP|METER|RPP|ADDR|LOADRULES)="([^"]+)"/g)) data[m[1]] = m[2];
  const bm = html.match(/const SELF_BASEMAP='([^']*)'/);
  return { data, basemap: bm ? bm[1] : null, hasMap: html.includes('id="map"') };
}

export async function checkHome(f) {
  const r = await get(f, SITE + '/');
  if (r.status !== 200) return { result: fail('home page', `HTTP ${r.status}${moved(r)}`) };
  const page = parsePage(await r.text());
  if (!page.hasMap) return { result: fail('home page', 'loaded but the map container is missing'), page };
  if (Object.keys(page.data).length < 5) return { result: fail('home page', `found ${Object.keys(page.data).length}/5 DataSF URLs in index.html`), page };
  return { result: ok('home page'), page };
}

/** Every dataset the app uses must answer a browser-style CORS request directly (no redirect). */
export async function checkDataSF(f, data) {
  const out = [];
  for (const [name, url] of Object.entries(data)) {
    const label = `DataSF ${name}`;
    try {
      const r = await get(f, `${url}?$limit=1`, { headers: { origin: ORIGIN } });
      const acao = r.headers.get('access-control-allow-origin');
      if (r.status !== 200) { out.push(fail(label, `HTTP ${r.status}${moved(r)} for ${url}`)); continue; }
      if (acao !== '*' && acao !== ORIGIN) { out.push(fail(label, `no CORS for curb.guide (allow-origin: ${acao || 'none'}) — browsers will block it`)); continue; }
      const rows = await r.json();
      out.push(Array.isArray(rows) && rows.length ? ok(label) : fail(label, 'answered but returned no rows'));
    } catch (e) { out.push(fail(label, `request failed: ${e.message}`)); }
  }
  // The exact query shape the map uses to decide detail vs. overview (a count inside a polygon).
  if (data.SWEEP) {
    try {
      const q = new URLSearchParams({ $select: 'count(*)', $where: `intersects(line,'${POLY}')` });
      const r = await get(f, `${data.SWEEP}?${q}`, { headers: { origin: ORIGIN } });
      const n = r.status === 200 ? Number((await r.json())[0]?.count) : NaN;
      out.push(n > 0 ? ok('DataSF spatial query', `${n} curb rows in the test area`) : fail('DataSF spatial query', `HTTP ${r.status}${moved(r)}, count=${n}`));
    } catch (e) { out.push(fail('DataSF spatial query', `request failed: ${e.message}`)); }
  }
  return out;
}

export async function checkBasemap(f, template) {
  if (!template) return fail('basemap tiles', 'SELF_BASEMAP is empty in index.html — the map fell back to Google/CARTO (CARTO shows an "API KEY REQUIRED" watermark)');
  const path = template.replace('{z}', TILE.z).replace('{x}', TILE.x).replace('{y}', TILE.y);
  const url = path.startsWith('http') ? path : SITE + path;
  const r = await get(f, url);
  const type = r.headers.get('content-type') || '';
  const size = r.status === 200 ? (await r.arrayBuffer()).byteLength : 0;
  return r.status === 200 && type.startsWith('image/') && size > 2000
    ? ok('basemap tiles', `${size} bytes`)
    : fail('basemap tiles', `HTTP ${r.status}${moved(r)}, ${type || 'no type'}, ${size} bytes for ${url}`);
}

/** Server-rendered SEO pages: a /b/ block page that 302s home means its DataSF fetch failed. */
export async function checkPages(f) {
  const out = [];
  const b = await get(f, `${SITE}/b/${BLOCK_CNN}`);
  const bhtml = b.status === 200 ? await b.text() : '';
  out.push(b.status === 200 && bhtml.includes('STREET CLEANING')
    ? ok('block page /b/')
    : fail('block page /b/', b.status === 302 ? `redirects home${moved(b)} — its DataSF fetch is failing (all ~10k block pages are affected)` : `HTTP ${b.status}, schedule missing`));
  const n = await get(f, `${SITE}/n/mission`);
  out.push(n.status === 200 && (await n.text()).includes('<title>') ? ok('neighborhood page /n/') : fail('neighborhood page /n/', `HTTP ${n.status}${moved(n)}`));
  for (const sm of ['/sitemap.xml', '/sitemap-blocks.xml']) {
    const r = await get(f, SITE + sm);
    out.push(r.status === 200 && (await r.text()).includes('<urlset') ? ok(`sitemap ${sm}`) : fail(`sitemap ${sm}`, `HTTP ${r.status}${moved(r)}`));
  }
  const d = await get(f, `${SITE}/data/enforcement.json`);
  let keys = 0;
  if (d.status === 200) { try { keys = Object.keys(await d.json()).length; } catch { keys = 0; } }
  out.push(keys > 1000 ? ok('ticket-time data', `${keys} blocks`) : fail('ticket-time data', `HTTP ${d.status}, ${keys} blocks`));
  return out;
}

/** The push alerts only go out when the sweep-alerts-cron workflow actually runs and succeeds. */
export async function checkAlertsTimer(f, now = Date.now()) {
  const name = 'alerts timer (sweep-alerts-cron)';
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return skip(name, 'GITHUB_TOKEN / GITHUB_REPOSITORY not set');
  const r = await get(f, `https://api.github.com/repos/${repo}/actions/workflows/sweep-alerts-cron.yml/runs?per_page=10&event=schedule`,
    { redirect: 'follow', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  // An API hiccup (rate limit, outage) must not page anyone; healthchecks.io watches the timer independently.
  if (r.status !== 200) return skip(name, `GitHub API HTTP ${r.status} — couldn't check this run`);
  return judgeAlertsRuns((await r.json()).workflow_runs || [], now);
}

export function judgeAlertsRuns(runs, now) {
  const name = 'alerts timer (sweep-alerts-cron)';
  const done = runs.filter((x) => x.status === 'completed');
  if (!done.length) return fail(name, 'no completed scheduled runs found');
  const ageMin = Math.round((now - Date.parse(done[0].updated_at)) / 60000);
  if (ageMin > ALERTS_MAX_AGE_MIN) return fail(name, `last run finished ${ageMin} min ago (expected every 15 min) — alerts are not going out`);
  const recent = done.slice(0, 2); // two failures in a row = broken, not a one-off blip
  if (recent.length === 2 && recent.every((x) => x.conclusion !== 'success'))
    return fail(name, `last ${recent.length} runs failed (${recent.map((x) => x.conclusion).join(', ')}) — see ${recent[0].html_url}`);
  return ok(name, `last run ${ageMin} min ago, ${done[0].conclusion}`);
}

async function fetchErrors(f, since) {
  const r = await get(f, `${SITE}/api/client-error?since=${since}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const describe = (g) => `${g.count}× ${g.msg}${g.src ? ` (${g.src}:${g.line})` : ''} — ${Object.entries(g.clients).map(([c, n]) => `${c} ${n}`).join(', ')}`;

export async function checkErrorSpike(f, now = Date.now()) {
  const name = 'user error rate';
  if (!process.env.CRON_SECRET) return skip(name, 'CRON_SECRET not set');
  try {
    const d = await fetchErrors(f, now - 35 * 60000);
    return d.total >= ERROR_SPIKE
      ? fail(name, `${d.total} errors from real users in the last 35 min. Top: ${d.groups.slice(0, 3).map(describe).join(' · ')}`)
      : ok(name, `${d.total} errors in the last 35 min`);
  } catch (e) { return fail(name, `error log unreachable: ${e.message}`); }
}

/** Nightly digest: one "check" per error group seen >= DIGEST_MIN times in 24h (stable names → the
 *  alert issue only gets a new comment when a NEW kind of error shows up). */
export async function digest(f, now = Date.now()) {
  if (!process.env.CRON_SECRET) return [skip('error digest', 'CRON_SECRET not set')];
  try {
    const d = await fetchErrors(f, now - 24 * 3600e3);
    const big = d.groups.filter((g) => g.count >= DIGEST_MIN);
    if (!big.length) return [ok('error digest', `${d.total} errors in 24h, none repeated ${DIGEST_MIN}+ times`)];
    return big.map((g) => fail(`error: ${g.k} ${g.msg.slice(0, 80)}`, describe(g) + (g.sample?.stack ? `\n\n    ${g.sample.stack.split('\n').slice(0, 4).join('\n    ')}` : '')));
  } catch (e) { return [fail('error digest', `error log unreachable: ${e.message}`)]; }
}

export async function runSmoke(f = fetch, now = Date.now()) {
  const results = [];
  const safe = async (name, fn) => { try { const r = await fn(); results.push(...[].concat(r)); } catch (e) { results.push(fail(name, `check crashed: ${e.message}`)); } };
  let page = null;
  await safe('home page', async () => { const h = await checkHome(f); page = h.page; return h.result; });
  if (page) {
    await safe('DataSF', () => checkDataSF(f, page.data));
    await safe('basemap tiles', () => checkBasemap(f, page.basemap));
  }
  await safe('SEO pages', () => checkPages(f));
  await safe('alerts timer (sweep-alerts-cron)', () => checkAlertsTimer(f, now));
  await safe('user error rate', () => checkErrorSpike(f, now));
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const results = args.includes('--digest') ? await digest(fetch) : await runSmoke(fetch);
  for (const r of results) console.log(`${r.status === 'ok' ? '✅' : r.status === 'skip' ? '⏭️ ' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
}
