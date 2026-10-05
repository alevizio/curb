// Weekly report section: CURB's App Store analytics for the week and the week before. Impressions,
// product page views, first-time downloads from the store page (conversion), sessions, active devices
// and crashes, read from Apple's Analytics Reports API (the numbers App Store Connect shows under App
// Analytics). Apple only produces these reports after a one-time ONGOING report request made with an
// Admin key (scripts/weekly/asc-analytics-setup.mjs); after that a Sales and Reports key reads them:
//   app's ONGOING request → its reports → DAILY instances → segments → gzipped text files (S3, presigned)
// Called by the weekly report as collect(ctx); see scripts/weekly/week.mjs for the window.
// Env: ASC_SALES_KEY_ID, ASC_SALES_KEY_P8 (the .p8 PEM text, or its base64) and ASC_SALES_ISSUER_ID
//      (defaults to ASC_ISSUER_ID) of a Sales and Reports key. Optional ASC_ANALYTICS_REQUEST_ID (printed
//      by the setup script) skips looking the request up.
// How the numbers are counted (Apple's report docs, developer.apple.com/documentation/analytics-reports):
// - Apple's days are UTC days. The section sums the Apple days whose dates match the San Francisco week.
// - Each daily instance can restate earlier days; per day only the newest instance counts, never a merge.
// - impressions = "Impression" + product page views, like App Store Connect (the report's Impression
//   event leaves page views out). pageViews = "Page view" on the product page or a store sheet (StoreKit's
//   in-app product page), not version history, privacy or event pages. Both use Unique Counts (unique
//   users per row and day), falling back to Counts if a file has no Unique Counts column.
// - downloads = first-time downloads; storeDownloads = those made on the product page or a store sheet;
//   conversion = storeDownloads / pageViews, a fraction (0.0123 = 1.23%).
// - activeDevices = average daily active devices (Unique Devices per day, averaged over the days counted):
//   daily files can't count a device once per week.
// - Sessions and crashes only include users who share analytics with developers, and Apple leaves a row
//   out when it has fewer than five users, so a quiet day can read as zero.
// - Each report counts only the days Apple has processed for it (processedDays), and prev the same
//   weekdays of the week before, so a Tuesday Apple hasn't processed yet is no fake drop.
// Extra fields: downloads, storeDownloads (also in prev); lastDay = each metric's last day counted this
// week; incomplete = this week's metrics with days still missing or that Apple may still revise (its
// completeness lag: engagement 3 days, downloads 2, sessions and crashes 5).
import { gunzipSync } from 'node:zlib';
import { APP_ID, apiToken } from '../../monitor/reviews.mjs';
import { addDays } from '../week.mjs';

const API = 'https://api.appstoreconnect.apple.com/v1';
const TIMEOUT_MS = 30000;
const LATE_DAYS = 7; // an instance holds days up to ~5 before its processingDate; read 7 past the week
export const SETUP_HINT = 'Apple analytics not set up yet: run scripts/weekly/asc-analytics-setup.mjs once with an Admin key';
export const STOPPED_HINT = 'Apple stopped the analytics reports after inactivity: run scripts/weekly/asc-analytics-setup.mjs again with an Admin key';

/** Normalized for matching: lowercase letters and digits only ("Page Type" → "pagetype"). */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const STORE_PAGES = new Set(['productpage', 'storesheet']);

// The four reports, by Apple's names (matched with norm). completeDays = Apple's completeness lag.
export const REPORTS = {
  engagement: { names: ['App Store Discovery and Engagement Standard'], completeDays: 3, keys: ['impressions', 'pageViews'] },
  downloads: { names: ['App Downloads Standard', 'App Store Downloads Standard'], completeDays: 2, keys: ['downloads', 'storeDownloads'] },
  sessions: { names: ['App Sessions Standard'], completeDays: 5, keys: ['sessions', 'activeDevices'] },
  crashes: { names: ['App Crashes'], completeDays: 5, keys: ['crashes'] },
};

/** Pure: one day's rows of a report → that day's figures. Rows are keyed by normalized header. */
export const METRICS = {
  engagement(rows) {
    let impressions = 0, pageViews = 0;
    for (const r of rows) {
      const n = num('uniquecounts' in r ? r.uniquecounts : r.counts);
      const event = norm(r.event);
      if (event === 'impression') impressions += n;
      else if (event === 'pageview' && STORE_PAGES.has(norm(r.pagetype))) { pageViews += n; impressions += n; }
    }
    return { impressions, pageViews };
  },
  downloads(rows) {
    let downloads = 0, storeDownloads = 0;
    for (const r of rows) {
      if (norm(r.downloadtype) !== 'firsttimedownload') continue;
      downloads += num(r.counts);
      if (STORE_PAGES.has(norm(r.pagetype))) storeDownloads += num(r.counts);
    }
    return { downloads, storeDownloads };
  },
  sessions: (rows) => ({ sessions: rows.reduce((n, r) => n + num(r.sessions), 0), activeDevices: rows.reduce((n, r) => n + num(r.uniquedevices), 0) }),
  crashes: (rows) => ({ crashes: rows.reduce((n, r) => n + num(r.crashes), 0) }),
};

/** A CSV line → fields, honoring "quoted, fields" and "" escapes. */
function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Pure: a report file (gzipped or plain, tab or comma separated) → rows keyed by normalized header. */
export function parseReport(buf) {
  const bytes = Buffer.from(buf);
  const text = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = lines[0].includes('\t') ? (l) => l.split('\t').map((v) => v.replace(/^"(.*)"$/, '$1')) : splitCsv;
  const head = split(lines[0]).map(norm);
  return lines.slice(1).map((l) => { const v = split(l); return Object.fromEntries(head.map((h, i) => [h, (v[i] ?? '').trim()])); });
}

/** 'YYYY-MM-DD' from Apple's Date column (ISO per the docs; MM/DD/YYYY and YYYYMMDD tolerated). */
export function dayOf(v) {
  const s = String(v ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * Pure: instances [{ processingDate, rows }] → Map day → rows. Apple: a newer processingDate replaces an
 * older one's rows for the same Date, so per day only the newest instance holding it counts. A file
 * without a Date column is filed under its processingDate.
 */
export function latestRowsByDay(instances) {
  const byDay = new Map();
  for (const inst of [...instances].sort((a, b) => b.processingDate.localeCompare(a.processingDate))) {
    const mine = new Map();
    for (const r of inst.rows) {
      const day = 'date' in r ? dayOf(r.date) : inst.processingDate;
      if (!day || byDay.has(day)) continue;
      if (!mine.has(day)) mine.set(day, []);
      mine.get(day).push(r);
    }
    for (const [day, rows] of mine) byDay.set(day, rows);
  }
  return byDay;
}

/** Pure: a report's daily rows → its metrics summed over `days` (activeDevices averaged per day); null
 *  without days. `days` are only days the report has processed: an unprocessed day is not a zero. */
export function totals(kind, byDay, days) {
  if (!days.length) return null;
  const sum = Object.fromEntries(REPORTS[kind].keys.map((k) => [k, 0]));
  for (const d of days) for (const [k, v] of Object.entries(METRICS[kind](byDay.get(d) || []))) sum[k] += v;
  if (kind === 'sessions') sum.activeDevices = Math.round(sum.activeDevices / days.length);
  return sum;
}

const between = (p, lo, hi) => p >= lo && p <= hi;
const isNum = (v) => typeof v === 'number';

/**
 * Pure: a test for the days Apple has processed for a report. A day counts when the report has rows on
 * it or on days both before and after it (Apple fills days in order, so a day in between without rows
 * had nothing to count, like a day without crashes), or when an instance Apple processed completeDays to
 * LATE_DAYS after it was read (by then the day is final, so no rows means nothing to count).
 */
export function processedDays(kind, byDay, readDates) {
  const days = [...byDay.keys()].sort();
  const first = days[0], last = days.at(-1), lag = REPORTS[kind].completeDays;
  return (d) => (days.length > 0 && between(d, first, last))
    || readDates.some((p) => between(p, addDays(d, lag), addDays(d, LATE_DAYS)));
}

/**
 * Pure: per-report results → the section. results[kind] is { missing: true } | { error } |
 * { list: [processingDate…] (every DAILY instance), byDay }.
 */
export function buildSection(results, week) {
  const lo = week.prevDays[0], hi = addDays(week.days[6], LATE_DAYS); // the instances collect reads
  const cur = {}, prev = {}, lastDay = {}, short = new Set();
  for (const [kind, spec] of Object.entries(REPORTS)) {
    const r = results[kind];
    let t = null, pt = null, last = null;
    if (r.byDay) {
      const has = processedDays(kind, r.byDay, (r.list || []).filter((p) => between(p, lo, hi)));
      const at = week.days.flatMap((d, i) => (has(d) ? [i] : [])); // weekday positions counted this week
      t = totals(kind, r.byDay, at.map((i) => week.days[i]));
      pt = totals(kind, r.byDay, at.map((i) => week.prevDays[i]).filter(has));
      last = at.length ? week.days[at.at(-1)] : null;
      if (at.length < week.days.length) short.add(kind);
    }
    for (const k of spec.keys) {
      cur[k] = r.error ? { error: r.error } : t ? t[k] : null;
      prev[k] = r.error ? { error: r.error } : pt ? pt[k] : null;
      lastDay[k] = last;
    }
  }
  const shape = (o) => {
    const failed = [o.storeDownloads, o.pageViews].find((v) => v?.error);
    const conversion = failed ? { error: failed.error }
      : isNum(o.storeDownloads) && isNum(o.pageViews) && o.pageViews > 0 ? Math.round((o.storeDownloads / o.pageViews) * 1e4) / 1e4 : null;
    const { impressions, pageViews, sessions, activeDevices, crashes, downloads, storeDownloads } = o;
    return { impressions, pageViews, conversion, sessions, activeDevices, crashes, downloads, storeDownloads };
  };
  const out = shape(cur);
  const newest = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.list?.length ? r.list.reduce((a, b) => (b > a ? b : a)) : null]));
  // a report is still filling in the week while it misses days, or until its newest instance is
  // completeDays past the week's last day
  const late = Object.fromEntries(Object.keys(REPORTS).map((k) => [k, short.has(k) || (newest[k] != null && newest[k] < addDays(week.days[6], REPORTS[k].completeDays))]));
  const lateKeys = new Set(Object.entries(REPORTS).flatMap(([k, spec]) => (late[k] ? spec.keys : [])));
  if (late.engagement || late.downloads) lateKeys.add('conversion');
  const asOf = Object.values(newest).filter(Boolean).sort().pop() || null;
  const { impressions, pageViews, sessions, activeDevices, crashes } = lastDay;
  return {
    ...out, prev: shape(prev), asOf,
    lastDay: { impressions, pageViews, sessions, activeDevices, crashes },
    incomplete: Object.keys(out).filter((k) => lateKeys.has(k) && isNum(out[k])),
  };
}

export async function collect(ctx) {
  const { env, fetch: f, week } = ctx;
  const keyId = env.ASC_SALES_KEY_ID, p8 = env.ASC_SALES_KEY_P8, issuer = env.ASC_SALES_ISSUER_ID || env.ASC_ISSUER_ID;
  const missing = [!keyId && 'ASC_SALES_KEY_ID', !p8 && 'ASC_SALES_KEY_P8', !issuer && 'ASC_SALES_ISSUER_ID'].filter(Boolean);
  if (missing.length) return { skipped: `missing ${missing.join(', ')}` };

  let token, tokenAt = 0;
  const bearer = () => {
    if (Date.now() - tokenAt > 600e3) { // tokens live 15 min; renew after 10
      try { token = apiToken({ issuer, keyId, p8 }); } catch { throw new Error('ASC_SALES_KEY_P8 is not a usable .p8 key'); }
      tokenAt = Date.now();
    }
    return token;
  };
  // Every read gets a timeout that also covers the body. The S3 segment URLs are presigned: no auth header.
  const fetchBody = async (url, auth, what) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await f(url, { headers: auth ? { authorization: `Bearer ${bearer()}` } : {}, signal: ctrl.signal });
      if (!r.ok) {
        const hint = !auth ? '' : r.status === 401 ? ' (key id, issuer id or .p8 wrong, or the key was revoked)'
          : r.status === 403 ? ' (the key needs the Sales and Reports role)' : '';
        throw new Error(`${what} HTTP ${r.status}${hint}`);
      }
      return auth ? await r.json() : Buffer.from(await r.arrayBuffer());
    } finally { clearTimeout(t); }
  };
  const api = (path) => fetchBody(path.startsWith('http') ? path : API + path, true, 'App Store Connect');
  const all = async (path) => { // every page of a JSON:API list
    const out = [];
    for (let next = path; next; ) { const page = await api(next); out.push(...(page.data || [])); next = page.links?.next; }
    return out;
  };

  let requestId = env.ASC_ANALYTICS_REQUEST_ID;
  if (!requestId) {
    const reqs = (await all(`/apps/${APP_ID}/analyticsReportRequests?filter%5BaccessType%5D=ONGOING&limit=200`))
      .filter((x) => x.attributes?.accessType === 'ONGOING');
    const live = reqs.find((x) => !x.attributes.stoppedDueToInactivity);
    if (!live) return reqs.length ? { error: STOPPED_HINT } : { skipped: SETUP_HINT }; // stopped = broken, shown as a problem
    requestId = live.id;
  }
  const reports = await all(`/analyticsReportRequests/${encodeURIComponent(requestId)}/reports?limit=200`);

  const lo = week.prevDays[0], hi = addDays(week.days[6], LATE_DAYS);
  const readReport = async (spec) => {
    const want = spec.names.map(norm);
    const report = want.map((n) => reports.find((r) => norm(r.attributes?.name) === n)).find(Boolean);
    if (!report) return { missing: true };
    const instances = await all(`/analyticsReports/${encodeURIComponent(report.id)}/instances?filter%5Bgranularity%5D=DAILY&limit=200`);
    const read = [];
    for (const inst of instances) {
      const p = inst.attributes?.processingDate;
      if (!p || !between(p, lo, hi)) continue;
      const rows = [];
      // segment URLs expire 5 minutes after listing: download right away
      for (const seg of await all(`/analyticsReportInstances/${encodeURIComponent(inst.id)}/segments?limit=200`)) {
        if (!seg.attributes?.url) continue;
        for (const row of parseReport(await fetchBody(seg.attributes.url, false, 'Apple report download'))) rows.push(row);
      }
      read.push({ processingDate: p, rows });
    }
    return { list: instances.map((i) => i.attributes?.processingDate).filter(Boolean), byDay: latestRowsByDay(read) };
  };
  const kinds = Object.keys(REPORTS);
  const settled = await Promise.allSettled(kinds.map((k) => readReport(REPORTS[k])));
  const failed = settled.filter((s) => s.status === 'rejected');
  if (failed.length && settled.every((s) => s.status === 'rejected' || s.value.missing)) throw new Error(String(failed[0].reason?.message || failed[0].reason));
  const results = Object.fromEntries(kinds.map((k, i) => [k, settled[i].status === 'fulfilled' ? settled[i].value
    : { error: String(settled[i].reason?.message || settled[i].reason).slice(0, 200) }]));
  return buildSection(results, week);
}
