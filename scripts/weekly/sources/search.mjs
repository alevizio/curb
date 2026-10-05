// Weekly report source: how curb.guide did in search. Google Search Console (clicks, impressions,
// CTR, position, top queries and pages, how many /b/ block pages got impressions, and a 50-URL
// index-status sample from the block sitemap) plus Bing Webmaster (clicks, impressions, top pages).
// Google and Bing fail independently; collect throws only when both fail for a real reason.
//
//   import { collect } from './sources/search.mjs'; await collect({ week, env, fetch, now })
// Env: GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN (Google OAuth refresh-token flow, scope
//      webmasters; any unset → google is skipped), GSC_SITE (default sc-domain:curb.guide),
//      BING_API_KEY (unset → bing is skipped).
//
// Google's search data lags ~2 days, so its window is the 7 days ending 2 days before the report
// week's last day (week Sep 30 to Oct 6 → Sep 28 to Oct 4). GSC dates are Pacific Time, so they line
// up with SF days. Bing stamps each row with a date-only value (UTC midnight, checked Oct 2026), read
// as a calendar date. Bing lags too, so its window is the 7 days ending on its last day with data
// (never after the report week), with start/end/prevStart/prevEnd like Google's. Bing's GetPageStats
// rows are weekly buckets dated on Fridays; in the Oct 2026 live data a bucket matched the 7 days
// before its date. The bucket overlapping Bing's window most is used, its range as pagesFrom/pagesTo.
// The index sample has SAMPLE_BUDGET_MS of the source's 300 s: past that it reports what it checked.
// Never logs anything: the repo and its Actions logs are public, and queries are visitors' words.
import { addDays } from '../week.mjs';

export const SITE_URL = 'https://curb.guide/';
export const GSC_DEFAULT_SITE = 'sc-domain:curb.guide';
export const BLOCK_SITEMAP = 'https://curb.guide/sitemap-blocks.xml';
export const GOOGLE_LAG_DAYS = 2;
export const SAMPLE_SIZE = 50;
export const INSPECT_CONCURRENCY = 5; // URL Inspection quota: 2,000/day, 600/min per site
export const SAMPLE_BUDGET_MS = 120000; // the index sample's share of the source's 300 s
const MAX_TIMEOUTS = 3;               // inspections timing out: stop asking after this many
const SAMPLE_TIMED_OUT = 'index check timed out';
const TOP_GOOGLE = 8;
const TOP_BING = 5;
const ROW_LIMIT = 25000;              // the Search Analytics max, so top lists and /b/ counts are exhaustive
const TIMEOUT_MS = 30000;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_API = 'https://www.googleapis.com/webmasters/v3';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const BING_API = 'https://ssl.bing.com/webmaster/api.svc/json';
const UA = 'Mozilla/5.0 (curb-weekly; +https://github.com/alevizio/curb)';

/** Google's dates (YYYY-MM-DD, end inclusive) for a report week: shifted back by the data lag. */
export function googleWindow(week) {
  const end = addDays(week.days[6], -GOOGLE_LAG_DAYS);
  const start = addDays(end, -6);
  return { start, end, prevStart: addDays(start, -7), prevEnd: addDays(start, -1) };
}

/** Path of a URL ('https://curb.guide/b/1?x' → '/b/1'); unparseable input comes back as is. */
export function pathOf(url) {
  try { return new URL(url).pathname; } catch { return String(url); }
}

/** Most clicks first, then most impressions. */
const byClicks = (a, b) => b.clicks - a.clicks || b.impressions - a.impressions;
const round = (n, d) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

/** Search Analytics response with no dimensions → the property's totals for the range. */
export function googleTotals(resp) {
  const row = resp?.rows?.[0];
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: null };
  return { clicks: row.clicks, impressions: row.impressions, ctr: round(row.ctr, 4), position: round(row.position, 1) };
}

/** One entry per window day (missing days are 0), from a dimensions:['date'] response. */
export function googleDaily(resp, start) {
  const got = new Map((resp?.rows || []).map((r) => [r.keys[0], r]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const r = got.get(date);
    return { date, clicks: r?.clicks || 0, impressions: r?.impressions || 0 };
  });
}

export function topQueries(resp, n = TOP_GOOGLE) {
  return (resp?.rows || [])
    .map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: round(r.position, 1) }))
    .sort(byClicks).slice(0, n);
}

/** Rows of a dimensions:['page'] response folded by path (http/www variants of a page add up). */
export function pagesByPath(resp) {
  const sum = new Map();
  for (const r of resp?.rows || []) {
    const page = pathOf(r.keys[0]);
    const s = sum.get(page) || { page, clicks: 0, impressions: 0 };
    s.clicks += r.clicks; s.impressions += r.impressions;
    sum.set(page, s);
  }
  return [...sum.values()];
}

export const topPages = (pages, n) => [...pages].sort(byClicks).slice(0, n);

/** How many block pages (/b/<cnn>) had at least one impression, out of the sitemap's total. */
export const blockPages = (pages, total) => ({
  withImpressions: pages.filter((p) => p.page.startsWith('/b/') && p.impressions > 0).length,
  total,
});

export const parseSitemap = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

/** Where this week's sample starts, as a fraction of the gap between picks: golden-ratio steps per
 *  week, so consecutive weeks land far apart and, over the weeks, every block gets its turn. */
export function rotation(day) {
  const weekNo = Math.floor(Date.parse(`${day}T12:00:00Z`) / (7 * 86400000));
  return (weekNo * 0.6180339887498949) % 1;
}

/** n URLs evenly spaced through the list, offset by the week (deterministic for a given day). */
export function sampleUrls(urls, n, seedDay) {
  if (urls.length <= n) return [...urls];
  const step = urls.length / n;
  const offset = rotation(seedDay) * step;
  return Array.from({ length: n }, (_, i) => urls[Math.floor(offset + i * step)]);
}

/** Inspection results → { checked, indexed, states }. Indexed = verdict PASS ("Valid" in Search Console). */
export function tallyInspections(results) {
  const states = {};
  let checked = 0, indexed = 0, errors = 0;
  for (const r of results) {
    if (!r || r.error) { errors++; continue; }
    checked++;
    const s = r.coverageState || 'unknown';
    states[s] = (states[s] || 0) + 1;
    if (r.verdict === 'PASS') indexed++;
  }
  return { checked, indexed, states, ...(errors ? { errors } : {}) };
}

/** Bing's "/Date(1790899200000)/" or "/Date(1696000000000-0700)/" → the calendar day it stamps. */
export function bingDay(s) {
  const m = /\/Date\((-?\d+)(?:([+-])(\d{2})(\d{2}))?\)\//.exec(String(s));
  if (!m) return null;
  const offMin = m[2] ? (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4])) : 0;
  return new Date(Number(m[1]) + offMin * 60000).toISOString().slice(0, 10);
}

const between = (d, lo, hi) => d >= lo && d <= hi;
const daysFrom = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** Bing's dates (YYYY-MM-DD, end inclusive): the 7 days ending on its last day with data, never after the
 *  report week (the whole week when there is no data), and the 7 days before them. */
export function bingWindow(lastDataDay, week) {
  const end = lastDataDay && lastDataDay < week.days[6] ? lastDataDay : week.days[6];
  const start = addDays(end, -6);
  return { start, end, prevStart: addDays(start, -7), prevEnd: addDays(start, -1) };
}

/** Of GetPageStats' bucket dates, the one whose 7 days (the 7 before its date) overlap [start, end] most,
 *  the later one on a tie; null when none overlaps. */
export function pickPageBucket(dates, start, end) {
  let best = null, most = 0;
  for (const d of [...new Set(dates)].sort()) {
    const lo = addDays(d, -7) > start ? addDays(d, -7) : start;
    const hi = addDays(d, -1) < end ? addDays(d, -1) : end;
    const overlap = lo <= hi ? daysFrom(lo, hi) + 1 : 0;
    if (overlap && overlap >= most) { best = d; most = overlap; }
  }
  return best;
}

/** Bing rows → the bing section. pageRows may be { error } (GetPageStats failed on its own). */
export function summarizeBing(trafficRows, pageRows, week) {
  const rows = trafficRows.map((r) => ({ r, day: bingDay(r.Date) })).filter((x) => x.day);
  const lastDataDay = rows.reduce((m, x) => (!m || x.day > m ? x.day : m), null);
  const win = bingWindow(lastDataDay, week);
  const cur = { clicks: 0, impressions: 0 }, prev = { clicks: 0, impressions: 0 };
  const seen = { week: 0, prev: 0 };
  for (const { r, day } of rows) {
    const into = between(day, win.start, win.end) ? cur : between(day, win.prevStart, win.prevEnd) ? prev : null;
    if (!into) continue;
    into.clicks += Number(r.Clicks) || 0;
    into.impressions += Number(r.Impressions) || 0;
    seen[into === cur ? 'week' : 'prev']++;
  }
  let pages, pagesFrom = null, pagesTo = null;
  if (Array.isArray(pageRows)) {
    const bucket = pickPageBucket(pageRows.map((r) => bingDay(r.Date)).filter(Boolean), win.start, win.end);
    const sum = new Map();
    for (const r of pageRows) {
      if (!bucket || bingDay(r.Date) !== bucket) continue;
      const page = pathOf(r.Query);
      const s = sum.get(page) || { page, clicks: 0, impressions: 0 };
      s.clicks += Number(r.Clicks) || 0; s.impressions += Number(r.Impressions) || 0;
      sum.set(page, s);
    }
    pages = topPages([...sum.values()], TOP_BING);
    if (bucket) { pagesFrom = addDays(bucket, -7); pagesTo = addDays(bucket, -1); }
  } else pages = { error: pageRows?.error || 'GetPageStats failed' };
  return { ...win, ...cur, prev, topPages: pages, pagesFrom, pagesTo, daysWithData: seen, lastDataDay };
}

// One request with a timeout. Failures become short messages that never carry the URL or a body
// (Bing's key rides in the query string): `${label} HTTP 403 <hint>`, `${label} timed out`, …
async function call(f, url, { text, ...init }, label, hint = () => '') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await f(url, { ...init, signal: ctrl.signal, headers: { 'user-agent': UA, ...(init.headers || {}) } });
    if (!r.ok) {
      const h = await r.text().then(hint, () => '');
      throw Object.assign(new Error(`${label} HTTP ${r.status}${h ? ' ' + h : ''}`), { status: r.status, ours: true });
    }
    return text ? await r.text() : await r.json();
  } catch (e) {
    if (e.ours) throw e;
    const timedOut = e.name === 'AbortError';
    throw Object.assign(new Error(timedOut ? `${label} timed out` : r ? `${label} bad response` : `${label} unreachable`), { timedOut });
  } finally { clearTimeout(t); }
}

// Google's OAuth error code (invalid_grant, invalid_client) is safe to show and says what to fix.
const oauthHint = (body) => {
  const code = /"error"\s*:\s*"([a-z_]+)"/.exec(body)?.[1] || '';
  return code === 'invalid_grant' ? 'invalid_grant (refresh token expired or revoked: re-authorize)' : code;
};
// Bing answers errors as {"ErrorCode":3,"Message":"ERROR!!! InvalidApiKey"}
const bingHint = (body) => /ERROR!!!\s*([A-Za-z]+)/.exec(body)?.[1] || '';

async function googleToken(f, env) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token', client_id: env.GSC_CLIENT_ID, client_secret: env.GSC_CLIENT_SECRET, refresh_token: env.GSC_REFRESH_TOKEN,
  });
  const j = await call(f, TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'Google OAuth', oauthHint);
  if (!j.access_token) throw new Error('Google OAuth bad response');
  return j.access_token;
}

/** Run fn over items, `limit` at a time, filling `out` as calls finish. Once a call fails with 401/403/429
 *  (auth or quota, so every later call would fail too), or MAX_TIMEOUTS calls have timed out, or run.stop
 *  is set from outside, the rest are skipped and come back as that error. */
async function pool(items, limit, fn, out = new Array(items.length), run = {}) {
  let next = 0, timeouts = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (run.stop) { out[i] = { error: run.stop }; continue; }
      try { out[i] = await fn(items[i]); } catch (e) {
        out[i] = { error: e.message };
        if ([401, 403, 429].includes(e.status) || (e.timedOut && ++timeouts >= MAX_TIMEOUTS)) run.stop = e.message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function indexSample(f, headers, site, urls, seedDay) {
  const picks = sampleUrls(urls, SAMPLE_SIZE, seedDay);
  const results = new Array(picks.length);
  const run = { stop: null };
  let timer;
  // past the budget, stop starting inspections and report the ones done (calls in flight are left out)
  const budget = new Promise((resolve) => { timer = setTimeout(() => { run.stop = SAMPLE_TIMED_OUT; resolve(SAMPLE_TIMED_OUT); }, SAMPLE_BUDGET_MS); });
  const ended = await Promise.race([budget, pool(picks, INSPECT_CONCURRENCY, async (inspectionUrl) => {
    const j = await call(f, INSPECT_URL, { method: 'POST', headers, body: JSON.stringify({ inspectionUrl, siteUrl: site }) }, 'URL Inspection');
    const s = j.inspectionResult?.indexStatusResult;
    if (!s) throw new Error('URL Inspection bad response');
    return { verdict: s.verdict, coverageState: s.coverageState };
  }, results, run)]);
  clearTimeout(timer);
  const tally = tallyInspections(results.filter(Boolean));
  if (tally.checked) return tally;
  return { error: ended === SAMPLE_TIMED_OUT ? SAMPLE_TIMED_OUT : results.find((r) => r?.error)?.error || 'no URLs to inspect' };
}

async function collectGoogle({ env, fetch: f, week }) {
  const missing = ['GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'GSC_REFRESH_TOKEN'].filter((k) => !env[k]);
  if (missing.length) return { skipped: `missing ${missing.join(', ')}` };
  const site = env.GSC_SITE || GSC_DEFAULT_SITE;
  const win = googleWindow(week);
  const headers = { authorization: `Bearer ${await googleToken(f, env)}`, 'content-type': 'application/json' };
  const query = (startDate, endDate, dimensions, rowLimit) => call(f, `${GSC_API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: 'POST', headers, body: JSON.stringify({ startDate, endDate, dimensions, rowLimit, dataState: 'all' }) }, 'Search Analytics');

  // the block sitemap feeds the /b/ total and the inspection sample; its failure only blanks those
  const blocks = call(f, BLOCK_SITEMAP, { text: true }, 'sitemap').then(parseSitemap, (e) => ({ error: e.message }));
  const sample = blocks.then((urls) => (urls.error ? urls : indexSample(f, headers, site, urls, week.days[0])))
    .catch((e) => ({ error: e.message }));
  const [totals, prevTotals, daily, queries, pageRows] = await Promise.all([
    query(win.start, win.end, [], 1),
    query(win.prevStart, win.prevEnd, [], 1),
    query(win.start, win.end, ['date'], 10),
    query(win.start, win.end, ['query'], ROW_LIMIT),
    query(win.start, win.end, ['page'], ROW_LIMIT),
  ]);
  const urls = await blocks;
  const pages = pagesByPath(pageRows);
  return {
    ...win,
    ...googleTotals(totals),
    prev: googleTotals(prevTotals),
    daily: googleDaily(daily, win.start),
    topQueries: topQueries(queries),
    topPages: topPages(pages, TOP_GOOGLE),
    blockPages: blockPages(pages, Array.isArray(urls) ? urls.length : null),
    indexSample: await sample,
    firstIncompleteDate: daily?.metadata?.firstIncompleteDate || null, // fresh, still-changing days start here
  };
}

async function collectBing({ env, fetch: f, week }) {
  if (!env.BING_API_KEY) return { skipped: 'missing BING_API_KEY' };
  const get = async (method) => {
    const url = `${BING_API}/${method}?siteUrl=${encodeURIComponent(SITE_URL)}&apikey=${encodeURIComponent(env.BING_API_KEY)}`;
    const j = await call(f, url, {}, `Bing ${method}`, bingHint);
    if (!Array.isArray(j?.d)) throw new Error(`Bing ${method} bad response`);
    return j.d;
  };
  const [traffic, pages] = await Promise.all([
    get('GetRankAndTrafficStats'),
    get('GetPageStats').catch((e) => ({ error: e.message })),
  ]);
  return summarizeBing(traffic, pages, week);
}

export async function collect(ctx) {
  const settle = (p) => p.catch((e) => ({ error: e.message || 'failed' }));
  const [google, bing] = await Promise.all([settle(collectGoogle(ctx)), settle(collectBing(ctx))]);
  if (google.error && bing.error) throw new Error(`Google: ${google.error}; Bing: ${bing.error}`);
  if (google.skipped && bing.skipped) return { skipped: `${google.skipped}, ${bing.skipped.replace('missing ', '')}`, google, bing };
  return { google, bing };
}
