// Weekly report source: website visits on curb.guide from Vercel Web Analytics (production only).
// Called by scripts/weekly/report.mjs as collect(ctx); never run on its own.
//
// Env: VERCEL_TOKEN (required; a Vercel access token that can read the project),
//      VERCEL_PROJECT (default 'curb'; the project name or its prj_ id),
//      VERCEL_TEAM (optional; team_… id or team slug; leave unset for a personal-account project).
//
// API (Vercel OpenAPI, operations countPageviews and aggregatePageviews):
//   /v1/query/web-analytics/visits/count      → data: { pageviews, visitors }
//   /v1/query/web-analytics/visits/aggregate  → data: [{ <by dimension>, timestamp?, pageviews, visitors }]
// `since` and `until` are both INCLUSIVE and snap to the query's time granularity, so every window
// here is sent as [start, end - 1 ms]: the hour holding end - 1 ms is the last hour of Tuesday in SF.
// `by` is an array sent as a repeated param (by=hour&by=country), like the official @vercel/sdk does.
// Vercel buckets time in UTC; San Francisco is always a whole number of hours off UTC, so every UTC
// hour belongs to exactly one SF day: daily numbers are hourly rows bucketed with week.mjs ymd().
// Daily visitors are the sum of hourly visitors (a visitor back in a later hour counts again), so the
// week totals come from the count endpoint, which counts each visitor once.
import { ymd, addDays, midnight } from '../week.mjs';

const API = 'https://api.vercel.com';
const PROD = "environment eq 'production'"; // the API's default, stated anyway so added filters keep it
const SELF = new Set(['curb.guide', 'www.curb.guide']);
const OTHERS = 'Others';  // the API's bucket for values past `limit`, never a real page, host or country
const CHUNK_DAYS = 4;     // ≤ 97 hourly rows per request, under the 100 row `limit` even on a 25 h DST day
const TIMEOUT_MS = 20000;

const iso = (ms) => new Date(ms).toISOString();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const byVisitors = (a, b) => b.visitors - a.visitors || (b.pageviews || 0) - (a.pageviews || 0);
const short = (e) => String(e?.message || e).slice(0, 120);

/** The team query param for VERCEL_TEAM: an id goes as teamId, anything else as the team slug. */
export function teamParam(team) {
  const t = String(team || '').trim();
  if (!t) return {};
  return t.startsWith('team_') ? { teamId: t } : { slug: t };
}

/** API URL; array values become repeated params (by=hour&by=country), empty values are left out. */
export function vercelUrl(path, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const x of [].concat(v)) if (x !== undefined && x !== null && x !== '') q.append(k, String(x));
  }
  return `${API}${path}?${q}`;
}

/** Row timestamp → epoch ms. ISO strings without a zone are UTC (Vercel's buckets), never local time. */
export function parseStamp(ts) {
  if (typeof ts === 'number') return ts;
  const s = String(ts ?? '');
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) || !s.includes('T') ? s : `${s}Z`);
}

/** The 14 report days (prev week + week) as hourly request windows of up to CHUNK_DAYS SF days, end exclusive. */
export function hourChunks(week) {
  const all = [...week.prevDays, ...week.days];
  const out = [];
  for (let i = 0; i < all.length; i += CHUNK_DAYS) {
    const first = all[i];
    const last = all[Math.min(i + CHUNK_DAYS, all.length) - 1];
    out.push({ since: midnight(first), end: midnight(addDays(last, 1)) });
  }
  return out;
}

/**
 * Pure: hourly rows → SF-day totals for the week and the week before (missing days are zeros).
 * Rows outside [prevStart, end) and repeats of an hour (two chunks both returning their shared
 * boundary hour) are skipped.
 */
export function bucketDaily(rows, week) {
  const sums = new Map();
  const seen = new Set();
  for (const r of rows) {
    const t = parseStamp(r.timestamp);
    if (!(t >= week.prevStart && t < week.end) || seen.has(t)) continue;
    seen.add(t);
    const day = ymd(t);
    const s = sums.get(day) || { pageviews: 0, visitors: 0 };
    s.pageviews += num(r.pageviews);
    s.visitors += num(r.visitors);
    sums.set(day, s);
  }
  const series = (days) => days.map((date) => ({ date, pageviews: 0, visitors: 0, ...sums.get(date) }));
  return { daily: series(week.days), prevDaily: series(week.prevDays) };
}

/** Pure: aggregate rows → [{ [as]: value, visitors }] top n, without blanks, Others and `drop` values. */
export function topBy(rows, key, n, { as = key, drop = new Set() } = {}) {
  return rows
    .map((r) => ({ v: String(r[key] ?? '').trim(), visitors: num(r.visitors) }))
    .filter(({ v }) => v && v !== OTHERS && !drop.has(v.toLowerCase()))
    .sort(byVisitors)
    .slice(0, n)
    .map(({ v, visitors }) => ({ [as]: v, visitors }));
}

const isBlock = (p) => p.startsWith('/b/');
const isHood = (p) => p.startsWith('/n/') && p.length > 3;

/**
 * Pure: requestPath rows + the two group counts → top 8 pages. Every /b/<cnn> page is one row
 * '/b/*' and every /n/<slug> page one row '/n/*'; their numbers come from a filtered count (exact,
 * visitors counted once) rather than the rows, which stop at `limit` and fold the tail into Others.
 */
export function topPagesFrom(rows, groups, n = 8) {
  const pages = rows
    .map((r) => ({ path: String(r.requestPath ?? '').trim(), pageviews: num(r.pageviews), visitors: num(r.visitors) }))
    .filter(({ path }) => path.startsWith('/') && !isBlock(path) && !path.startsWith('/n/'));
  for (const g of groups) if (g.pageviews || g.visitors) pages.push(g);
  return pages.sort(byVisitors).slice(0, n);
}

/** Pure: requestPath rows (collect asks for /n/ pages only) → the 5 most visited neighborhood pages. */
export const topHoodsFrom = (rows, n = 5) => topBy(rows.filter((r) => isHood(String(r.requestPath ?? ''))), 'requestPath', n, { as: 'path' });

async function api(ctx, path, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await ctx.fetch(vercelUrl(path, params), {
      headers: { authorization: `Bearer ${ctx.env.VERCEL_TOKEN}`, accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const hint = r.status === 401 ? ' (token wrong or expired)'
        : r.status === 403 ? ' (token cannot read this project: check VERCEL_TEAM)'
          : r.status === 404 ? ' (project not found: check VERCEL_PROJECT and VERCEL_TEAM)'
            : r.status === 402 ? ' (Web Analytics not available on this plan)' : '';
      throw new Error(`Vercel HTTP ${r.status}${hint}`);
    }
    const body = await r.json().catch(() => null);
    if (!body || body.data == null) throw new Error('Vercel bad response (no data)');
    return body.data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Vercel timed out');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Sub-part that may fail alone: its value, or { error } for the section to carry. */
const part = (p) => p.catch((e) => ({ error: short(e) }));

export async function collect(ctx) {
  const { week, env } = ctx;
  if (!env.VERCEL_TOKEN) return { skipped: 'missing VERCEL_TOKEN' };
  const base = { projectId: env.VERCEL_PROJECT || 'curb', ...teamParam(env.VERCEL_TEAM) };
  const win = (since, end) => ({ since: iso(since), until: iso(end - 1) });
  const and = (f) => (f ? `${PROD} and ${f}` : PROD);

  const count = (since, end, f) => api(ctx, '/v1/query/web-analytics/visits/count', { ...base, ...win(since, end), filter: and(f) })
    .then((d) => ({ pageviews: num(d.pageviews), visitors: num(d.visitors) }));
  const aggregate = (by, limit, since = week.start, end = week.end, f) => api(ctx, '/v1/query/web-analytics/visits/aggregate',
    { ...base, by, ...win(since, end), limit, filter: and(f) }).then((d) => (Array.isArray(d) ? d : []));
  const group = (prefix, label) => count(week.start, week.end, `startswith(requestPath,'${prefix}')`)
    .then((c) => ({ path: `${prefix}*`, label, ...c }));

  const [totals, prev, hourly, topPages, topHoods, referrers, countries, devices] = await Promise.all([
    count(week.start, week.end),
    part(count(week.prevStart, week.prevEnd)),
    part(Promise.all(hourChunks(week).map((c) => aggregate('hour', 100, c.since, c.end))).then((chunks) => bucketDaily(chunks.flat(), week))),
    part(Promise.all([aggregate('requestPath', 100), group('/b/', 'Block pages'), group('/n/', 'Neighborhood pages')]).then(([rows, ...g]) => topPagesFrom(rows, g))),
    // its own query: in the top 100 paths, block pages crowd the neighborhood pages out
    part(aggregate('requestPath', 20, week.start, week.end, "startswith(requestPath,'/n/')").then((rows) => topHoodsFrom(rows))),
    part(aggregate('referrerHostname', 20).then((rows) => topBy(rows, 'referrerHostname', 8, { as: 'host', drop: SELF }))),
    part(aggregate('country', 10).then((rows) => topBy(rows, 'country', 5))),
    part(aggregate('deviceType', 10).then((rows) => topBy(rows, 'deviceType', 10, { as: 'device' }))),
  ]);

  // The count endpoint snaps its window to whole UTC days (checked live 5-Oct-2026: since 07:00Z came
  // back as 00:00Z), 7 hours off San Francisco's. Page views add up exactly from the hourly rows, so
  // those win; unique visitors can't be summed, so they stay the count's (close, not exact).
  const pv = (rows) => rows.reduce((t, r) => t + r.pageviews, 0);
  return {
    ...totals,
    ...(hourly.error ? {} : { pageviews: pv(hourly.daily) }),
    prev: prev.error || hourly.error ? prev : { ...prev, pageviews: pv(hourly.prevDaily) },
    daily: hourly.error ? hourly : hourly.daily,
    prevDaily: hourly.error ? hourly : hourly.prevDaily,
    topPages, topHoods, referrers, countries, devices,
  };
}
