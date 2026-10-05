// Weekly report source: the iPhone app. Three independent parts, each failing on its own:
//  - live + rating: Apple's public iTunes lookup (no key). US storefront, so the rating is the US one.
//  - reviews: the App Store Connect API with the monitor's Customer Support key (scripts/monitor/
//    reviews.mjs). This week's reviews, and lowUnanswered = the monitor's own rule (judgeReviews): 1 to
//    3 star reviews from the last 30 days without a developer reply.
//  - downloads: Apple's daily Summary Sales reports (Sales and Trends, a Sales-role key), one gzipped
//    TSV per Pacific day for this week and the week before. Days are Pacific Time, like week.mjs.
//    Daily reports land the next day, "generally by 8 a.m. PT" (Apple), so at the Wednesday 8 AM send
//    Tuesday is often not out yet: such a day is null and listed in `pending`, partial is true, and
//    prev sums only the same weekdays of the week before (like for like); prevFull is all 7 of them.
// Impressions, sessions and crashes come from Analytics Reports in app-analytics.mjs, not here.
//
//   import { collect } from './sources/app.mjs'; const section = await collect({ week, env, fetch, now })
// Env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_P8                           reviews (unset → skipped)
//      ASC_SALES_KEY_ID, ASC_SALES_KEY_P8, ASC_VENDOR_NUMBER,
//      ASC_SALES_ISSUER_ID (default ASC_ISSUER_ID)                     downloads (unset → skipped)
// The .p8 values may be the PEM text or its base64 (loadKey). The email is private, so review titles
// and texts are included (escape them when rendering); the public monitor issues never carry them.
// Error messages never carry keys or the vendor number: report.mjs prints them to the public log.
import { gunzipSync } from 'node:zlib';
import { loadKey, apiToken, APP_ID, judgeReviews, WINDOW_DAYS } from '../../monitor/reviews.mjs';
import { ymd, addDays, midnight } from '../week.mjs';

const API = 'https://api.appstoreconnect.apple.com/v1';
export const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_ID}&country=us`;
// Apple's salesReports reference (checked Oct 2026) lists SALES / SUMMARY as version 1_0. In Jan 2024
// DAILY briefly demanded 1_1 ("The latest version for this report is 1_1"); a 400 shows Apple's text.
export const SALES_VERSION = '1_0';
export const CONCURRENCY = 3;
export const TOP_COUNTRIES = 5;
const TIMEOUT = 20000;
const REVIEW_PAGES = 5; // 100 reviews a page, newest first: plenty for 30 days of CURB reviews

// Apple's product type identifiers (App Store Connect Help → Reference → Product type identifiers,
// checked Oct 2026). Downloads are first-time installs, free or paid. Apple lists no 3T. In-app
// purchases (IA*, FI1) and bundles (1-B, F1-B: their own Apple Identifier) are not counted.
export const PRODUCT_TYPES = {
  downloads: ['1', '1F', '1T', 'F1', '1E', '1EP', '1EU'],
  redownloads: ['3', '3F'],
  updates: ['7', '7F', '7T', 'F7'],
};
const KIND = new Map(Object.entries(PRODUCT_TYPES).flatMap(([k, ids]) => ids.map((id) => [id, k])));
/** 'downloads' | 'redownloads' | 'updates' for a Product Type Identifier, else null. */
export const kindOf = (id) => KIND.get(String(id ?? '').trim()) ?? null;

const REVIEW_HINT = {
  401: ' (key id, issuer id or .p8 wrong, or the key was revoked)',
  403: ' (the key\'s role cannot read reviews: give it Customer Support or App Manager)',
};
const SALES_HINT = {
  401: ' (sales key id, issuer id or .p8 wrong, or the key was revoked)',
  403: ' (the sales key needs the Sales, Finance or Admin role, for this vendor number)',
};
const missing = (env, names) => names.filter((n) => !env[n]);

async function get(f, url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try { return await f(url, { headers, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

/** A Bearer header for an App Store Connect key; a bad .p8 fails with its env name, never its text. */
function bearer(issuer, keyId, p8, name) {
  try { loadKey(p8); } catch { throw new Error(`${name} is not a readable .p8 key`); }
  return `Bearer ${apiToken({ issuer, keyId, p8 })}`; // real clock: ctx.now may be a backdated --now
}

// ---- live version and rating ----

/** Pure: iTunes lookup JSON → { live, rating }. */
export function parseLookup(j) {
  const a = Array.isArray(j?.results) ? j.results[0] : null;
  if (!a) throw new Error('iTunes lookup found no app');
  return {
    live: { version: a.version ?? null, releasedAt: a.currentVersionReleaseDate ?? null, url: a.trackViewUrl ? String(a.trackViewUrl).split('?')[0] : null },
    rating: { average: a.averageUserRating ?? null, count: a.userRatingCount ?? 0 },
  };
}

async function lookup(ctx) {
  const r = await get(ctx.fetch, LOOKUP_URL);
  if (!r.ok) throw new Error(`iTunes lookup HTTP ${r.status}`);
  return parseLookup(await r.json());
}

// ---- reviews ----

/** Pure: review pages → this week's reviews (newest first, with title and text) and lowUnanswered. */
export function summarizeReviews(page, week, now) {
  const replied = new Set((Array.isArray(page?.included) ? page.included : [])
    .filter((x) => x.type === 'customerReviewResponses').map((x) => x.relationships?.review?.data?.id).filter(Boolean));
  const reviews = (Array.isArray(page?.data) ? page.data : [])
    .filter((r) => { const t = Date.parse(r.attributes?.createdDate); return t >= week.start && t < week.end; })
    .map((r) => {
      const a = r.attributes;
      return {
        stars: Number(a.rating), title: a.title ?? '', body: a.body ?? '', territory: a.territory ?? '',
        date: ymd(Date.parse(a.createdDate)), createdDate: a.createdDate,
        replied: Boolean(r.relationships?.response?.data) || replied.has(r.id),
      };
    });
  return { reviews, lowUnanswered: judgeReviews(page, now).filter((x) => x.status === 'fail').length };
}

async function fetchReviews(ctx, auth) {
  // the monitor's request plus title and body; reviewerNickname is never asked for
  let url = `${API}/apps/${APP_ID}/customerReviews?sort=-createdDate&limit=100&include=response` +
    '&fields[customerReviews]=rating,title,body,territory,createdDate,response';
  const since = Math.min(ctx.week.start, ctx.now - WINDOW_DAYS * 86400e3);
  const page = { data: [], included: [] };
  for (let i = 0; url && i < REVIEW_PAGES; i++) {
    const r = await get(ctx.fetch, url, { authorization: auth });
    if (!r.ok) throw new Error(`App Store Connect reviews HTTP ${r.status}${REVIEW_HINT[r.status] || ''}`);
    const j = await r.json();
    page.data.push(...(Array.isArray(j?.data) ? j.data : []));
    page.included.push(...(Array.isArray(j?.included) ? j.included : []));
    // the next page only while this one still reached into the window (and only on Apple's own host)
    const next = j?.links?.next;
    url = typeof next === 'string' && next.startsWith(`${API}/`) && Date.parse(page.data.at(-1)?.attributes?.createdDate) >= since ? next : null;
  }
  return page;
}

async function reviewsPart(ctx) {
  const { env } = ctx;
  const miss = missing(env, ['ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_KEY_P8']);
  if (miss.length) return { reviews: { skipped: `missing ${miss.join(', ')}` }, lowUnanswered: null };
  try {
    const auth = bearer(env.ASC_ISSUER_ID, env.ASC_KEY_ID, env.ASC_KEY_P8, 'ASC_KEY_P8');
    return summarizeReviews(await fetchReviews(ctx, auth), ctx.week, ctx.now);
  } catch (e) { return { reviews: { error: e.message }, lowUnanswered: null }; }
}

// ---- downloads ----

/** Pure: a report body → text. Apple sends a gzip file (application/a-gzip); an already inflated body
 *  passes through. Inflation is capped (a CURB day is a few KB). */
export function inflate(buf) {
  const b = Buffer.from(buf);
  return (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b, { maxOutputLength: 32 << 20 }) : b).toString('utf8');
}

/** Pure: Summary Sales TSV → one { column: value } object per row (BOM and CRLF tolerated). */
export function parseTsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((l) => { const c = l.split('\t'); return Object.fromEntries(head.map((h, i) => [h, (c[i] ?? '').trim()])); });
}

/** Pure: one day's report rows → CURB's units by kind, and first-time downloads per country. */
export function tallyDay(rows) {
  const day = { downloads: 0, redownloads: 0, updates: 0, countries: {} };
  for (const r of rows) {
    const kind = r['Apple Identifier'] === APP_ID ? kindOf(r['Product Type Identifier']) : null;
    if (!kind) continue;
    const units = Number(r.Units) || 0; // negative = refunds
    day[kind] += units;
    if (kind === 'downloads') { const c = r['Country Code'] || '?'; day.countries[c] = (day.countries[c] || 0) + units; }
  }
  return day;
}

/** Pure: what a 404 for a day means. Apple answers 404 both for "There were no sales for the date
 *  specified" and for "Report is not available yet ...". The text is not a contract, so a 404 before
 *  noon PT of the next day counts as not published yet (null) whatever it says; later it is a day
 *  without sales (0), unless Apple says the report is not available. */
export function judge404(day, detail, now) {
  if (/not (yet )?available/i.test(detail || '')) return 'pending';
  return now < midnight(addDays(day, 1)) + 12 * 3600e3 ? 'pending' : 'none';
}

const errorDetail = async (r) => { try { return String((await r.json())?.errors?.[0]?.detail ?? ''); } catch { return ''; } };
const NONE = { downloads: 0, redownloads: 0, updates: 0, countries: {} };

async function salesDay(ctx, auth, vendor, day) {
  if (ctx.now < midnight(addDays(day, 1))) return { day, status: 'pending' }; // the day is not over
  const url = `${API}/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY` +
    `&filter[vendorNumber]=${encodeURIComponent(vendor)}&filter[reportDate]=${day}&filter[version]=${SALES_VERSION}`;
  const headers = { authorization: auth, accept: 'application/a-gzip' };
  let r = await get(ctx.fetch, url, headers);
  if (r.status === 429 || r.status >= 500) r = await get(ctx.fetch, url, headers); // one retry for a blip
  if (r.status === 200) return { day, status: 'ok', ...tallyDay(parseTsv(inflate(await r.arrayBuffer()))) };
  if (r.status === 404) { const s = judge404(day, await errorDetail(r), ctx.now); return { day, status: s, ...(s === 'none' ? NONE : {}) }; }
  // a 400 is a request Apple rejects (version, vendor number): its own text says which
  const why = r.status === 400 ? `: ${(await errorDetail(r)).replace(/\s+/g, ' ').slice(0, 160)}` : SALES_HINT[r.status] || '';
  throw new Error(`App Store Connect sales HTTP ${r.status}${why}`);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (e) { next = items.length; throw e; } // one failure stops the queue
    }
  }));
  return out;
}

/** Pure: per-day results (both weeks) → the downloads part. Totals cover the days Apple has published
 *  (null when none) and prev the same weekdays of the week before, so a missing Tuesday is no fake drop;
 *  prevFull is the whole week before. asOf is the latest published day, pending lists the days not out yet. */
export function summarizeSales(week, results) {
  const by = new Map(results.map((d) => [d.day, d]));
  const known = (day) => { const d = by.get(day); return d && (d.status === 'ok' || d.status === 'none') ? d : null; };
  const sum = (days, kind) => { const ds = days.map(known).filter(Boolean); return ds.length ? ds.reduce((n, d) => n + d[kind], 0) : null; };
  const totals = (days) => ({ downloads: sum(days, 'downloads'), redownloads: sum(days, 'redownloads'), updates: sum(days, 'updates') });
  const countries = {};
  for (const day of week.days) for (const [c, n] of Object.entries(known(day)?.countries || {})) countries[c] = (countries[c] || 0) + n;
  const all = [...week.prevDays, ...week.days];
  const at = week.days.flatMap((day, i) => (known(day) ? [i] : [])); // weekday positions with a published report
  return {
    ...totals(week.days),
    prev: totals(at.map((i) => week.prevDays[i])),
    prevFull: totals(week.prevDays),
    partial: at.length < week.days.length,
    daysKnown: at.length,
    daily: week.days.map((date) => ({ date, downloads: known(date)?.downloads ?? null })),
    countries: Object.entries(countries).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_COUNTRIES).map(([country, downloads]) => ({ country, downloads })),
    asOf: all.filter(known).at(-1) ?? null,
    pending: all.filter((d) => !known(d)),
  };
}

async function downloadsPart(ctx) {
  const { env } = ctx;
  const issuer = env.ASC_SALES_ISSUER_ID || env.ASC_ISSUER_ID;
  const miss = [...missing(env, ['ASC_SALES_KEY_ID', 'ASC_SALES_KEY_P8', 'ASC_VENDOR_NUMBER']), ...(issuer ? [] : ['ASC_SALES_ISSUER_ID (or ASC_ISSUER_ID)'])];
  if (miss.length) return { skipped: `missing ${miss.join(', ')}` };
  const vendor = String(env.ASC_VENDOR_NUMBER).trim();
  try {
    const auth = bearer(issuer, env.ASC_SALES_KEY_ID, env.ASC_SALES_KEY_P8, 'ASC_SALES_KEY_P8');
    const days = [...ctx.week.prevDays, ...ctx.week.days];
    return summarizeSales(ctx.week, await pool(days, CONCURRENCY, (day) => salesDay(ctx, auth, vendor, day)));
  } catch (e) { return { error: String(e.message).replaceAll(vendor, '[vendor]') }; }
}

// ---- the section ----

export async function collect(ctx) {
  const [store, rev, downloads] = await Promise.all([
    lookup(ctx).catch((e) => ({ error: e.message })),
    reviewsPart(ctx),
    downloadsPart(ctx),
  ]);
  const has = (part) => part && !part.skipped && !part.error;
  // nothing at all came back: one section-level failure instead of three part-level ones
  if (store.error && !Array.isArray(rev.reviews) && !has(downloads)) throw new Error(store.error);
  return {
    live: store.error ? { error: store.error } : store.live,
    rating: store.error ? { error: store.error } : store.rating,
    reviews: rev.reviews,
    lowUnanswered: rev.lowUnanswered,
    downloads,
  };
}
