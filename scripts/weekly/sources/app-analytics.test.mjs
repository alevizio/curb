// Tests for the App Store analytics section (app-analytics.mjs) and its one-time setup script, against a
// mocked App Store Connect API and gzipped report files. No network.
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { reportWeek, addDays } from '../week.mjs';
import { collect, parseReport, dayOf, latestRowsByDay, METRICS, SETUP_HINT, STOPPED_HINT, buildSection, processedDays } from './app-analytics.mjs';
import { ensureOngoingRequest } from '../asc-analytics-setup.mjs';

const week = reportWeek(Date.parse('2026-10-07T15:07:00Z')); // Sep 30 to Oct 6, prev Sep 23 to 29
const P8 = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ENV = { ASC_SALES_KEY_ID: 'KEY123', ASC_SALES_KEY_P8: P8, ASC_ISSUER_ID: 'issuer-1' };
const API = 'https://api.appstoreconnect.apple.com/v1';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n') + '\n';

const ENG_HEAD = ['Date', 'App Name', 'App Apple Identifier', 'Event', 'Page Type', 'Source Type', 'Engagement Type', 'Device', 'Platform Version', 'Territory', 'Counts', 'Unique Counts'];
const eng = (date, event, page, counts, unique) => [date, 'CURB', '6780998238', event, page, 'App Store search', '', 'iPhone', 'iOS 26.0', 'US', counts, unique];
const SES_HEAD = ['Date', 'App Name', 'App Apple Identifier', 'App Version', 'Device', 'Platform Version', 'Source Type', 'Page Type', 'App Download Date', 'Territory', 'Sessions', 'Total Session Duration', 'Unique Devices'];
const ses = (date, device, sessions, devices) => [date, 'CURB', '6780998238', '1.0.2', device, 'iOS 26.0', 'App Store search', 'Product page', '', 'US', sessions, 600, devices];

// Report files by instance id: engagement as Apple documents it (tab separated), downloads as quoted CSV
// with lowercase headers and mixed-case values, to prove the parser doesn't depend on either.
const FILES = {
  e0: tsv([ENG_HEAD, eng('2026-09-19', 'Impression', 'No page', 999, 999)]), // processed before the window
  e1: tsv([ENG_HEAD,
    eng('2026-09-23', 'Impression', 'No page', 100, 80),
    eng('2026-09-23', 'Page view', 'Product page', 20, 15),
    eng('2026-09-23', 'Page view', 'App version history', 5, 5), // not a product page view
    eng('2026-09-24', 'Impression', 'No page', 50, 40)]),
  e2: tsv([ENG_HEAD,
    eng('2026-09-30', 'Impression', 'No page', 200, 150),
    eng('2026-09-30', 'Page view', 'Product page', 30, 25),
    eng('2026-10-01', 'Impression', 'No page', 10, 10)]), // restated by e3
  e3: tsv([ENG_HEAD,
    eng('2026-10-01', 'Impression', 'No page', 60, 50),
    eng('2026-10-01', 'Page view', 'Store sheet', 8, 6)]),
  d1: [
    '"date","app name","download type","page type","source type","counts"',
    '"2026-09-23","CURB","First-time download","Product page","App Store search","3"',
    '"2026-09-23","CURB","First-time download","No page","App Store browse","2"',
    '"2026-09-23","CURB","Redownload","Product page","App Store search","4"',
    '"2026-09-27","CURB, the app","FIRST-TIME DOWNLOAD","store sheet","App referrer","1"',
  ].join('\r\n'),
  d2: [
    'Date,Download Type,Page Type,Counts',
    '2026-09-30,First-time download,Product page,5',
    '2026-10-05,First-time download,No page,1',
    '2026-10-05,Manual update,Product page,9',
  ].join('\n'),
  s1: tsv([SES_HEAD, ses('2026-09-30', 'iPhone', 7, 4), ses('2026-09-30', 'iPad', 3, 2), ses('2026-10-06', 'iPhone', 4, 1)]),
};
const INSTANCES = {
  'r-eng': [['e0', '2026-09-20'], ['e1', '2026-09-25'], ['e2', '2026-10-02'], ['e3', '2026-10-03']],
  'r-dl': [['d1', '2026-09-28'], ['d2', '2026-10-07']],
  'r-ses': [['s1', '2026-10-12']], // nothing processed in the prev week's range → prev is null
};
const report = (id, name) => ({ type: 'analyticsReports', id, attributes: { name, category: 'X' } });
const REQUESTS = [
  { type: 'analyticsReportRequests', id: 'snap-1', attributes: { accessType: 'ONE_TIME_SNAPSHOT', stoppedDueToInactivity: false } },
  { type: 'analyticsReportRequests', id: 'req-1', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } },
];

/** A fake App Store Connect + S3. `over` replaces any route's response by URL substring. */
function apple({ requests = REQUESTS, over = {} } = {}) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, auth: opts.headers?.authorization });
    for (const [k, v] of Object.entries(over)) if (url.includes(k)) return typeof v === 'function' ? v(url) : v;
    let m;
    if (url.startsWith(`${API}/apps/6780998238/analyticsReportRequests`)) return json({ data: requests, links: {} });
    if (url === `${API}/analyticsReportRequests/req-1/reports?limit=200`) {
      return json({ data: [report('r-engd', 'App Store Discovery and Engagement Detailed'), report('r-eng', 'App Store Discovery and Engagement Standard'), report('r-cx', 'App Crashes Expanded')],
        links: { next: `${API}/analyticsReportRequests/req-1/reports?cursor=AB&limit=200` } });
    }
    if (url === `${API}/analyticsReportRequests/req-1/reports?cursor=AB&limit=200`) {
      return json({ data: [report('r-dl', 'App Downloads Standard'), report('r-ses', 'App Sessions Standard')], links: {} });
    }
    if ((m = url.match(/analyticsReports\/([^/]+)\/instances\?(.*)$/))) {
      expect(m[2]).toContain('filter%5Bgranularity%5D=DAILY');
      return json({ data: (INSTANCES[m[1]] || []).map(([id, processingDate]) => ({ type: 'analyticsReportInstances', id, attributes: { granularity: 'DAILY', processingDate } })), links: {} });
    }
    if ((m = url.match(/analyticsReportInstances\/([^/]+)\/segments/))) {
      return json({ data: [{ type: 'analyticsReportSegments', id: `${m[1]}-0`, attributes: { url: `https://s3.example.com/${m[1]}/0.txt.gz?X-Amz-Signature=x`, sizeInBytes: 1, checksum: 'x' } }], links: {} });
    }
    if ((m = url.match(/^https:\/\/s3\.example\.com\/([^/]+)\//))) return new Response(gzipSync(FILES[m[1]]));
    return json({ errors: [{ status: '404' }] }, 404);
  };
  return { f, calls };
}

describe('parsing Apple report files', () => {
  it('reads gzipped tab files, quoted CSV, BOMs and CRLF, keyed by normalized header', () => {
    const rows = parseReport(gzipSync('﻿Date\tUnique Counts\tPage Type\r\n2026-09-30\t"12"\tProduct page\r\n'));
    expect(rows).toEqual([{ date: '2026-09-30', uniquecounts: '12', pagetype: 'Product page' }]);
    expect(parseReport(Buffer.from('"Date","App Name","Counts"\n"2026-09-30","CURB, ""the"" app","1,204"\n')))
      .toEqual([{ date: '2026-09-30', appname: 'CURB, "the" app', counts: '1,204' }]);
    expect(parseReport(Buffer.from(''))).toEqual([]);
  });
  it('reads Apple dates in any of the usual shapes', () => {
    expect(dayOf('2026-09-30')).toBe('2026-09-30');
    expect(dayOf('9/30/2026')).toBe('2026-09-30');
    expect(dayOf('20260930')).toBe('2026-09-30');
    expect(dayOf('soon')).toBeNull();
  });
  it('per day, the newest instance wins and is never merged with an older one', () => {
    const byDay = latestRowsByDay([
      { processingDate: '2026-10-02', rows: [{ date: '2026-10-01', n: 'old' }, { date: '2026-09-30', n: 'a' }] },
      { processingDate: '2026-10-03', rows: [{ date: '2026-10-01', n: 'new1' }, { date: '2026-10-01', n: 'new2' }] },
      { processingDate: '2026-10-04', rows: [{ crashes: '2' }] }, // no Date column: filed under processingDate
    ]);
    expect(byDay.get('2026-10-01').map((r) => r.n)).toEqual(['new1', 'new2']);
    expect(byDay.get('2026-09-30').map((r) => r.n)).toEqual(['a']);
    expect(byDay.get('2026-10-04')).toEqual([{ crashes: '2' }]);
  });
  it('engagement falls back to Counts when a file has no Unique Counts column', () => {
    expect(METRICS.engagement([{ event: 'Impression', counts: '7' }, { event: 'PAGE VIEW', pagetype: 'product page', counts: '2' }]))
      .toEqual({ impressions: 9, pageViews: 2 });
  });
});

describe('days Apple has not processed', () => {
  const span = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
  const byDay = (days, row) => new Map(days.map((d) => [d, [row]]));

  it('a day counts with rows on it or around it, or once an instance holding its final numbers was read', () => {
    const crashes = byDay(['2026-09-24', '2026-10-02'], { crashes: '1' });
    const has = processedDays('crashes', crashes, span('2026-09-23', '2026-10-06'));
    expect(has('2026-09-27')).toBe(true);   // between two days with rows: a day without crashes
    expect(has('2026-09-23')).toBe(true);   // no rows around it, but the instance of Sep 28 to 30 holds it
    expect(has('2026-10-01')).toBe(true);   // the Oct 6 instance is 5 days after it
    expect(has('2026-10-03')).toBe(false);  // after the last row, and no instance 5 to 7 days later yet
    // instances processed long after a day don't hold it
    expect(processedDays('sessions', new Map(), ['2026-10-12'])('2026-09-29')).toBe(false);
  });

  it('sums only processed days, averages devices over them, and compares the same weekdays', () => {
    const s = buildSection({
      // engagement through Sat Oct 4 (no Mon or Tue yet), sessions through Fri Oct 3
      engagement: { list: span('2026-09-24', '2026-10-05'), byDay: byDay(span('2026-09-23', '2026-10-04'), { event: 'Impression', uniquecounts: '100' }) },
      sessions: { list: span('2026-09-24', '2026-10-04'), byDay: byDay(span('2026-09-23', '2026-10-03'), { sessions: '20', uniquedevices: '10' }) },
      // no crashes at all: the days Apple has finished are zeros, not missing
      crashes: { list: span('2026-09-23', '2026-10-06'), byDay: new Map() },
      downloads: { missing: true },
    }, week);
    expect(s).toEqual({
      impressions: 500, pageViews: 0, conversion: null, sessions: 80, activeDevices: 10, crashes: 0, downloads: null, storeDownloads: null,
      // Sep 23 to 27 for engagement, Sep 23 to 26 for sessions, Sep 23 and 24 for crashes: no fake drop
      prev: { impressions: 500, pageViews: 0, conversion: null, sessions: 80, activeDevices: 10, crashes: 0, downloads: null, storeDownloads: null },
      asOf: '2026-10-06',
      lastDay: { impressions: '2026-10-04', pageViews: '2026-10-04', sessions: '2026-10-03', activeDevices: '2026-10-03', crashes: '2026-10-01' },
      incomplete: ['impressions', 'pageViews', 'sessions', 'activeDevices', 'crashes'],
    });
  });

  it('a whole processed week is complete once Apple is past its lag', () => {
    const s = buildSection({
      engagement: { list: span('2026-09-24', '2026-10-09'), byDay: byDay(span('2026-09-23', '2026-10-06'), { event: 'Impression', uniquecounts: '10' }) },
      sessions: { missing: true }, crashes: { missing: true }, downloads: { missing: true },
    }, week);
    expect(s).toMatchObject({ impressions: 70, prev: { impressions: 70 }, incomplete: [] });
    expect(s.lastDay.impressions).toBe('2026-10-06');
  });
});

describe('collect', () => {
  it('skips with the missing variable names, and takes the issuer from ASC_ISSUER_ID', async () => {
    const { f, calls } = apple();
    expect(await collect({ week, env: {}, fetch: f })).toEqual({ skipped: 'missing ASC_SALES_KEY_ID, ASC_SALES_KEY_P8, ASC_SALES_ISSUER_ID' });
    expect(await collect({ week, env: { ASC_SALES_KEY_ID: 'K', ASC_ISSUER_ID: 'i' }, fetch: f })).toEqual({ skipped: 'missing ASC_SALES_KEY_P8' });
    expect(calls).toEqual([]);
  });

  it('says how to set up when the app has no ONGOING request; a stopped one is an error with the fix in it', async () => {
    expect(await collect({ week, env: ENV, fetch: apple({ requests: [REQUESTS[0]] }).f })).toEqual({ skipped: SETUP_HINT });
    const stopped = [{ ...REQUESTS[1], attributes: { accessType: 'ONGOING', stoppedDueToInactivity: true } }];
    expect(await collect({ week, env: ENV, fetch: apple({ requests: stopped }).f })).toEqual({ error: STOPPED_HINT });
    expect(STOPPED_HINT).toContain('run scripts/weekly/asc-analytics-setup.mjs again with an Admin key');
  });

  it('sums the week and the week before from the newest instance per day', async () => {
    const { f, calls } = apple();
    const s = await collect({ week, env: ENV, fetch: f, now: Date.parse('2026-10-07T15:07:00Z') });
    expect(s).toEqual({
      // impressions = unique impressions + unique product page / store sheet views: (150 + 25) + (50 + 6)
      impressions: 231, pageViews: 31, conversion: 0.1613, sessions: 14, activeDevices: 1, crashes: null, downloads: 6, storeDownloads: 5,
      prev: { impressions: 135, pageViews: 15, conversion: 0.2667, sessions: null, activeDevices: null, crashes: null, downloads: 6, storeDownloads: 4 },
      asOf: '2026-10-12',
      // each report's own last day: engagement has Sep 30 and Oct 1, sessions the whole week, no crash report
      lastDay: { impressions: '2026-10-01', pageViews: '2026-10-01', sessions: '2026-10-06', activeDevices: '2026-10-06', crashes: null },
      incomplete: ['impressions', 'pageViews', 'conversion', 'downloads', 'storeDownloads'],
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    // API calls carry the bearer; the presigned S3 downloads must not
    const api = calls.filter((c) => c.url.startsWith(API));
    const s3 = calls.filter((c) => c.url.includes('s3.example.com'));
    expect(api.every((c) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(c.auth))).toBe(true);
    expect(s3.length).toBe(6);
    expect(s3.every((c) => c.auth === undefined)).toBe(true);
    // the instance processed before the window is never opened, and the crash report isn't App Crashes Expanded
    expect(calls.some((c) => c.url.includes('analyticsReportInstances/e0/'))).toBe(false);
    expect(calls.some((c) => c.url.includes('analyticsReports/r-cx/'))).toBe(false);
  });

  it('uses ASC_ANALYTICS_REQUEST_ID without looking the request up', async () => {
    const { f, calls } = apple();
    const s = await collect({ week, env: { ...ENV, ASC_ANALYTICS_REQUEST_ID: 'req-1' }, fetch: f });
    expect(s.impressions).toBe(231);
    expect(calls.some((c) => c.url.includes('/apps/'))).toBe(false);
  });

  it('a failing report marks only its own metrics', async () => {
    const { f } = apple({ over: { 's3.example.com/d2/': new Response('nope', { status: 500 }) } });
    const s = await collect({ week, env: ENV, fetch: f });
    const err = { error: 'Apple report download HTTP 500' };
    expect(s.downloads).toEqual(err);
    expect(s.storeDownloads).toEqual(err);
    expect(s.conversion).toEqual(err);
    expect(s.prev.downloads).toEqual(err);
    expect(s.impressions).toBe(231);
    expect(s.sessions).toBe(14);
  });

  it('reports nulls, not zeros, before Apple has produced any report', async () => {
    const { f } = apple({ over: { '/reports?': json({ data: [], links: {} }) } });
    const s = await collect({ week, env: ENV, fetch: f });
    expect(s).toMatchObject({ impressions: null, pageViews: null, conversion: null, sessions: null, activeDevices: null, crashes: null, asOf: null, incomplete: [] });
    expect(s.lastDay).toEqual({ impressions: null, pageViews: null, sessions: null, activeDevices: null, crashes: null });
    expect(s.prev.impressions).toBeNull();
  });

  it('throws a short reason without the token on an API error, and when every report fails', async () => {
    const { f, calls } = apple({ over: { '/apps/': json({ errors: [] }, 401) } });
    const e = await collect({ week, env: ENV, fetch: f }).catch((x) => x);
    expect(e.message).toMatch(/^App Store Connect HTTP 401 \(key id/);
    expect(e.message).not.toContain(calls[0].auth.slice(7));
    const down = apple({ over: { '/instances?': json({ errors: [] }, 500) } });
    await expect(collect({ week, env: ENV, fetch: down.f })).rejects.toThrow('App Store Connect HTTP 500');
  });
});

describe('asc-analytics-setup', () => {
  const setupApple = (requests, postStatus = 201) => {
    const calls = [];
    const f = async (url, opts = {}) => {
      calls.push({ url, method: opts.method, body: opts.body && JSON.parse(opts.body) });
      if (opts.method === 'GET') return json({ data: requests, links: {} });
      return postStatus === 201 ? json({ data: { type: 'analyticsReportRequests', id: 'new-1', attributes: { accessType: 'ONGOING' } } }, 201) : json({ errors: [] }, postStatus);
    };
    return { f, calls };
  };
  it('leaves a live ONGOING request alone', async () => {
    const { f, calls } = setupApple(REQUESTS);
    expect(await ensureOngoingRequest(f, 't')).toEqual({ id: 'req-1', status: 'active' });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(calls[0].url).toBe(`${API}/apps/6780998238/analyticsReportRequests?limit=200`);
  });
  it('creates one when there is none, or only a stopped one', async () => {
    const stopped = [{ id: 'old', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: true } }];
    const { f, calls } = setupApple(stopped);
    expect(await ensureOngoingRequest(f, 't')).toEqual({ id: 'new-1', status: 'created' });
    expect(calls[1]).toEqual({
      url: `${API}/analyticsReportRequests`, method: 'POST',
      body: { data: { type: 'analyticsReportRequests', attributes: { accessType: 'ONGOING' }, relationships: { app: { data: { type: 'apps', id: '6780998238' } } } } },
    });
  });
  it('explains a refusal', async () => {
    await expect(ensureOngoingRequest(setupApple([], 409).f, 't')).rejects.toThrow(/HTTP 409 on POST \/analyticsReportRequests \(Apple refused/);
    await expect(ensureOngoingRequest(setupApple([], 403).f, 't')).rejects.toThrow(/needs an Admin key/);
  });
});
