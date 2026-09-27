// CURB production smoke checks — run every 30 min by .github/workflows/monitor.yml (free Actions;
// triggered by a QStash schedule through the GitHub API, with GitHub's own schedule as fallback).
// Each check hits curb.guide the way a visitor's browser would and returns { name, status, detail }
// with status 'ok' | 'fail' | 'skip'. The DataSF URLs are read straight out of the live index.html, so
// a host move like data.sfgov.org → data.sf.gov (Sep 2026) is caught within one run, not by users.
//
//   node scripts/monitor/smoke.mjs [--digest] [--out results.json]
//     default   uptime + data + basemap + SEO pages + sweep-alert sender freshness + error spike
//     --digest  nightly: breakage groups seen >= 3 times in the last 24h (from /api/client-error)
// Env: MONITOR_SITE (default https://curb.guide), CRON_SECRET (error log + sender status; those two
//      checks are skipped if unset).
import { writeFileSync } from 'node:fs';

export const SITE = process.env.MONITOR_SITE || 'https://curb.guide';
const UA = 'Mozilla/5.0 (curb-monitor; +https://github.com/alevizio/curb)';
const ORIGIN = 'https://curb.guide';
// A known-good block (Market St, Larkin–Polk) and a small Mission polygon with plenty of curbs.
const BLOCK_CNN = '8753101';
const POLY = "POLYGON((-122.42 37.76,-122.41 37.76,-122.41 37.77,-122.42 37.77,-122.42 37.76))";
const TILE = { z: 16, x: 10483, y: 25333 }; // Mission, inside the baked SF set
export const ALERTS_MAX_AGE_MIN = 40;       // the sender runs every 15 min (QStash); 40 = two missed ticks + slack
export const ALERTS_BACKUP_MAX_AGE_MIN = 480; // before QStash ever runs: the GitHub backup alone (worst gap seen 414 min)
export const ERROR_SPIKE = 25;               // errors per 30 min that mean "something broke for many"
export const DIGEST_MIN = 3;                 // nightly: only groups seen at least this often

// Which reports mean something broke, per kind, from index.html's reporters (the error / rejection
// listeners and every curbReport call). The rest is the visitor's own choice or device: blocked location,
// no fix (code 2) or a timeout (code 3), no geolocation API, a coarse fix (Precise Location off), a
// notification denial. Those stay in the log and in the digest as informational counts, never failing.
// A code 1 that is NOT a user denial (a permissions policy, an insecure origin) is ours to fix. Browser
// denial texts: Chrome/WebKit "User denied Geolocation", Firefox "User denied geolocation prompt"; the
// iOS app's own is in ContentView.swift. A denial can also follow a timed-out first try ("code 1 after
// retry …": Chrome counts a pending prompt inside the timeout). monitor.test.mjs fails if index.html
// reports an unlisted kind; an unlisted kind (or a group past the log's top 50) still counts as breakage.
const DENIED_LOCATE = /^code 1 (after retry )?(User denied|Location permission is off for CURB)/i;
const DENIED_PUSH = /^(ios|web|restyle|refresh) (fail:)?(denied|permission-)/; // the page filters these; belt and braces
export const REPORT_KINDS = {
  error: () => true,                                      // uncaught script error
  rejection: () => true,                                  // unhandled promise rejection
  'event:data-load': () => true,                          // a DataSF viewport load failed
  'event:block-open-timeout': () => true,                 // a tapped / located / linked block never opened
  'event:push-save-failed': (msg) => !DENIED_PUSH.test(msg),
  'event:push-off-failed': (msg) => !DENIED_PUSH.test(msg),
  'event:locate-failed': (msg) => /^code 1\b/.test(msg) && !DENIED_LOCATE.test(msg), // only a code 1 we caused
  'event:locate-coarse': () => false,                     // an approximate fix: a device setting
};
export const isBreakage = (g) => (Object.hasOwn(REPORT_KINDS, g.k) ? REPORT_KINDS[g.k](String(g.msg)) : true);
/** Split the error log into breakage and informational groups (total = everything minus informational). */
export function realErrors(d) {
  const info = d.groups.filter((g) => !isBreakage(g));
  const infoTotal = info.reduce((n, g) => n + g.count, 0);
  return { total: d.total - infoTotal, groups: d.groups.filter(isBreakage), info, infoTotal };
}
const fyi = (d) => d.infoTotal ? ` (+${d.infoTotal} informational, not failing: ${d.info.slice(0, 5).map((g) => `${g.count}× ${g.k} ${lit(g.msg, 60)}`).join(', ')})` : '';

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

/** Server-rendered SEO pages. /b/ reads baked data (never DataSF, never a redirect): a 503 means
 *  api/block.js itself is failing, a 404 means the known-good block is gone from the bake. */
export async function checkPages(f) {
  const out = [];
  const b = await get(f, `${SITE}/b/${BLOCK_CNN}`);
  const bhtml = b.status === 200 ? await b.text() : '';
  out.push(b.status === 200 && bhtml.includes('STREET CLEANING')
    ? ok('block page /b/')
    : fail('block page /b/', b.status === 503 ? 'block pages failing (503) — api/block.js could not load its baked data (check vercel.json includeFiles / data/schedules.json); all ~10k block pages are down'
      : b.status === 404 ? `block page missing — HTTP 404 for known block ${BLOCK_CNN}: dropped from data/schedules.json, or the /b/ rewrite broke`
      : `HTTP ${b.status}${moved(b)}, schedule missing`));
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

/** Push alerts only go out when the sender actually runs: each run records itself, and
 *  /api/send-notifications?status=1 (CRON_SECRET, read-only, no sends) reads that record back — so
 *  this watches the real sender whichever scheduler (QStash or the GitHub backup) is driving it.
 *  Once QStash has run at all it is the primary, and ITS last good run must be under 40 min old: that
 *  catches a dead schedule even while backup runs keep `lastOk` fresh. Until then only the sparse
 *  backup drives the sender, so a 40 min limit would open and close the issue around every backup run
 *  (~7 a day); the limit is 480 min instead. No record at all (a fresh deploy) is a skip, not a fail. */
const ALERTS = 'sweep alerts sender';
export async function checkAlertsSender(f, now = Date.now()) {
  if (!process.env.CRON_SECRET) return skip(ALERTS, 'CRON_SECRET not set');
  const r = await get(f, `${SITE}/api/send-notifications?status=1`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (r.status !== 200) return fail(ALERTS, `status endpoint HTTP ${r.status}${moved(r)}`);
  return judgeAlertsStatus(await r.json(), now);
}

export function judgeAlertsStatus(s, now) {
  s = s || {};
  if (!s.last && !s.lastOk && !s.lastQstash && !s.lastQstashOk) return skip(ALERTS, 'no sender run recorded yet (fresh deploy?) — the first QStash or GitHub backup run creates it');
  const last = s.last && s.last.outcome !== 'ok' ? ` Last run: ${s.last.outcome}${s.last.error ? ` (${s.last.error})` : ''} via ${s.last.trigger}.` : '';
  // A broken sender (VAPID / store missing, Upstash down) alerts on the next check, whatever the limit.
  if (s.last?.outcome === 'error') return fail(ALERTS, `the latest sender run failed — alerts are not going out.${last}`);
  const age = (r) => { const t = Date.parse(r?.at); return Number.isFinite(t) ? Math.round((now - t) / 60000) : null; };
  // QStash is live once it has run. Its freshest good sign: the latest tick if it went fine (a lock-skipped
  // tick is fine: another run did the work), else its last success. Status from before lastQstash* existed
  // only knows QStash ran if the latest success says so.
  const newShape = 'lastQstash' in s || 'lastQstashOk' in s;
  const qRan = newShape ? Boolean(s.lastQstash || s.lastQstashOk) : s.lastOk?.trigger === 'qstash';
  if (qRan) {
    const q = age(newShape ? (s.lastQstash?.ok ? s.lastQstash : s.lastQstashOk) : s.lastOk);
    if (q === null) return fail(ALERTS, `QStash runs the sender but no QStash run has succeeded — alerts are not going out on time.${last}`);
    if (q > ALERTS_MAX_AGE_MIN) return fail(ALERTS, `last good QStash run ${q} min ago (expected every 15 min) — the primary scheduler stopped (the GitHub backup, if it runs at all, sends hours apart).${last}`);
    return ok(ALERTS, `last good QStash run ${q} min ago`);
  }
  const a = age(s.lastOk);
  if (a === null) return fail(ALERTS, `no successful run recorded — alerts are not going out.${last}`);
  if (a > ALERTS_BACKUP_MAX_AGE_MIN) return fail(ALERTS, `last successful run ${a} min ago via ${s.lastOk.trigger}, and QStash has never run (backup-only limit ${ALERTS_BACKUP_MAX_AGE_MIN} min) — alerts are not going out.${last}`);
  return ok(ALERTS, `last successful run ${a} min ago via ${s.lastOk.trigger}; QStash has not run yet, so only the GitHub backup drives alerts`);
}

async function fetchErrors(f, since) {
  const r = await get(f, `${SITE}/api/client-error?since=${since}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** Anyone can POST to /api/client-error, and the alert issues are public: client-supplied text (message,
 *  script path, stack) only ever appears as ONE inline-code span, so it can't render as Markdown (links,
 *  images, HTML). No backticks or line breaks (they would end the span), a zero-width space after every
 *  @ (no @mention, also in the plain-text issue title), and < > swapped for look-alikes so the text can
 *  never open or close the <!-- monitor-sig --> marker alert.mjs keys on. The same text is printed to the
 *  public Actions log, where the runner obeys a legacy "##[command]" ANYWHERE in a line (a disabled one
 *  like ##[set-env] fails the step, ##[error] posts an annotation), so "##[" is split by a zero-width
 *  space too. ("::command::" only counts at the start of a line, and this span never starts one.) */
export const lit = (s, n = 200) => '`' + String(s ?? '').slice(0, n).replace(/`/g, "'").replace(/[\r\n]+/g, ' ')
  .replace(/</g, '‹').replace(/>/g, '›').replace(/@/g, '@\u200b').replace(/##\[/g, '#\u200b#[') + '`';
const describe = (g) => `${g.count}× ${lit(g.msg)}${g.src ? ` (${lit(`${g.src}:${g.line}`)})` : ''} — ${Object.entries(g.clients).map(([c, n]) => `${c} ${n}`).join(', ')}`;

export async function checkErrorSpike(f, now = Date.now()) {
  const name = 'user error rate';
  if (!process.env.CRON_SECRET) return skip(name, 'CRON_SECRET not set');
  try {
    const d = realErrors(await fetchErrors(f, now - 35 * 60000));
    return d.total >= ERROR_SPIKE
      ? fail(name, `${d.total} errors from real users in the last 35 min. Top: ${d.groups.slice(0, 3).map(describe).join(' · ')}`)
      : ok(name, `${d.total} errors in the last 35 min${fyi(d)}`);
  } catch (e) { return fail(name, `error log unreachable: ${e.message}`); }
}

/** Nightly digest: one "check" per breakage group seen >= DIGEST_MIN times in 24h (stable names → the
 *  alert issue only gets a new comment when a NEW kind of error shows up). */
export async function digest(f, now = Date.now()) {
  if (!process.env.CRON_SECRET) return [skip('error digest', 'CRON_SECRET not set')];
  try {
    const d = realErrors(await fetchErrors(f, now - 24 * 3600e3));
    const big = d.groups.filter((g) => g.count >= DIGEST_MIN);
    if (!big.length) return [ok('error digest', `${d.total} errors in 24h, none repeated ${DIGEST_MIN}+ times${fyi(d)}`)];
    return [
      ...big.map((g) => fail(`error: ${g.k} ${lit(g.msg, 80)}`, describe(g) + (g.sample?.stack ? `\n  ${lit(g.sample.stack, 300)}` : ''))),
      ...(d.infoTotal ? [ok('error digest', `informational${fyi(d)}`)] : []),
    ];
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
  await safe(ALERTS, () => checkAlertsSender(f, now));
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
