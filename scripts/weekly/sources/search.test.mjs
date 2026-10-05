// Tests for the weekly report's search source (search.mjs): Google's lagged window, the rotating
// index sample, Bing's date stamps and weekly page buckets, and collect() end to end on a mocked
// fetch, including each failure staying inside its own sub-part and secrets never reaching messages.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportWeek } from '../week.mjs';
import {
  collect, googleWindow, bingDay, sampleUrls, rotation, tallyInspections, summarizeBing, topQueries,
  pagesByPath, blockPages, parseSitemap, googleDaily, googleTotals, pathOf, SAMPLE_SIZE, SAMPLE_BUDGET_MS,
  bingWindow, pickPageBucket,
} from './search.mjs';

const WEEK = reportWeek(Date.parse('2026-10-07T15:07:00Z')); // Sep 30 to Oct 6
const ENV = { GSC_CLIENT_ID: 'cid-123', GSC_CLIENT_SECRET: 'csecret-456', GSC_REFRESH_TOKEN: 'rtoken-789', BING_API_KEY: 'bingkey-abc' };
const SECRETS = Object.values(ENV);
const utcDay = (day) => `/Date(${Date.parse(`${day}T00:00:00Z`)})/`;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const SITEMAP = `<?xml version="1.0"?><urlset>${Array.from({ length: 1000 }, (_, i) =>
  `<url><loc>https://curb.guide/b/${i}</loc><lastmod>2026-09-30</lastmod></url>`).join('\n')}</urlset>`;

// A fake Search Analytics backend: answers by dimension and window.
function analytics(body) {
  const { startDate, dimensions } = JSON.parse(body);
  const prev = startDate === '2026-09-21';
  if (!dimensions.length) return json({ rows: [{ clicks: prev ? 300 : 269, impressions: prev ? 4800 : 8841, ctr: prev ? 0.0625 : 0.030426, position: prev ? 6.04 : 7.0521 }] });
  if (dimensions[0] === 'date') return json({ rows: [
    { keys: ['2026-09-28'], clicks: 52, impressions: 1257 }, { keys: ['2026-10-01'], clicks: 56, impressions: 1596 },
  ], metadata: { firstIncompleteDate: '2026-10-03' } });
  if (dimensions[0] === 'query') return json({ rows: [
    { keys: ['curb sf'], clicks: 3, impressions: 5, position: 1.44 },
    { keys: ['sf street cleaning map'], clicks: 6, impressions: 297, position: 5.81 },
    { keys: ['street cleaning san francisco'], clicks: 6, impressions: 73, position: 5.1 },
    ...Array.from({ length: 10 }, (_, i) => ({ keys: [`q${i}`], clicks: 0, impressions: i, position: 9 })),
  ] });
  return json({ rows: [
    { keys: ['https://curb.guide/'], clicks: 125, impressions: 2559 },
    { keys: ['https://curb.guide/n/'], clicks: 12, impressions: 549 },
    { keys: ['https://curb.guide/b/1'], clicks: 1, impressions: 10 },
    { keys: ['https://www.curb.guide/b/1'], clicks: 0, impressions: 2 },
    { keys: ['https://curb.guide/b/2'], clicks: 0, impressions: 1 },
  ] });
}

const bingTraffic = { d: [
  { Clicks: 9, Impressions: 99, Date: utcDay('2026-09-29') },  // prev week's last day
  { Clicks: 1, Impressions: 8, Date: utcDay('2026-09-30') },
  { Clicks: 0, Impressions: 5, Date: utcDay('2026-10-02') },
  { Clicks: 2, Impressions: 1, Date: utcDay('2026-10-06') },
  { Clicks: 7, Impressions: 70, Date: utcDay('2026-10-07') },  // after the week
  { Clicks: 4, Impressions: 40, Date: utcDay('2026-09-22') },  // before prev
] };
const bingPages = { d: [
  { Clicks: 0, Impressions: 4, Date: utcDay('2026-10-02'), Query: 'https://curb.guide/' },
  { Clicks: 1, Impressions: 2, Date: utcDay('2026-10-02'), Query: 'https://curb.guide/about' },
  { Clicks: 0, Impressions: 4, Date: utcDay('2026-10-02'), Query: 'https://curb.guide/n/' },
  { Clicks: 5, Impressions: 50, Date: utcDay('2026-09-25'), Query: 'https://curb.guide/' }, // last week's bucket
] };

/** Mock fetch: handlers by URL fragment; every call is recorded. */
function mockFetch(over = {}) {
  const routes = {
    'oauth2.googleapis.com/token': () => json({ access_token: 'ya29.access', expires_in: 3599 }),
    'searchAnalytics/query': (url, init) => analytics(init.body),
    'sitemap-blocks.xml': () => new Response(SITEMAP),
    'urlInspection/index:inspect': (url, init) => {
      const n = Number(JSON.parse(init.body).inspectionUrl.split('/').pop());
      return json({ inspectionResult: { indexStatusResult: n >= 500
        ? { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' }
        : { verdict: 'PASS', coverageState: 'Submitted and indexed' } } });
    },
    GetRankAndTrafficStats: () => json(bingTraffic),
    GetPageStats: () => json(bingPages),
    ...over,
  };
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return routes[key](url, init);
  };
  f.calls = calls;
  f.count = (frag) => calls.filter((c) => c.url.includes(frag)).length;
  return f;
}
const ctx = (f, env = ENV) => ({ week: WEEK, env, fetch: f, now: Date.parse('2026-10-07T15:07:00Z') });

afterEach(() => vi.unstubAllGlobals());

describe('pure helpers', () => {
  it('google window ends 2 days before the report week ends, prev is the 7 days before', () => {
    expect(googleWindow(WEEK)).toEqual({ start: '2026-09-28', end: '2026-10-04', prevStart: '2026-09-21', prevEnd: '2026-09-27' });
  });
  it('bing date stamps read as the calendar day they carry', () => {
    expect(bingDay('/Date(1790899200000)/')).toBe('2026-10-02');            // UTC midnight, as seen live
    expect(bingDay('/Date(1696000000000-0700)/')).toBe('2023-09-29');       // local offset form
    expect(bingDay('/Date(1790924400000-0700)/')).toBe('2026-10-02');       // 00:00 PDT Oct 2
    expect(bingDay('2026-10-02')).toBeNull();
    expect(bingDay(undefined)).toBeNull();
  });
  it('the sample is 50 distinct, evenly spaced URLs that move every week and repeat for the same week', () => {
    const urls = Array.from({ length: 12253 }, (_, i) => `u${i}`);
    const a = sampleUrls(urls, 50, '2026-09-30');
    expect(a).toHaveLength(50);
    expect(new Set(a).size).toBe(50);
    const idx = a.map((u) => Number(u.slice(1)));
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThanOrEqual(244);
    expect(sampleUrls(urls, 50, '2026-09-30')).toEqual(a);
    const next = sampleUrls(urls, 50, '2026-10-07');
    expect(next.filter((u) => a.includes(u))).toHaveLength(0);
    expect(sampleUrls(['x', 'y'], 50, '2026-09-30')).toEqual(['x', 'y']);
  });
  it('rotation is a fraction and differs week to week', () => {
    const r = ['2026-09-23', '2026-09-30', '2026-10-07'].map(rotation);
    for (const x of r) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(new Set(r).size).toBe(3);
  });
  it('tallies coverage states, counts PASS as indexed, keeps errors apart', () => {
    expect(tallyInspections([
      { verdict: 'PASS', coverageState: 'Submitted and indexed' },
      { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' },
      { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' },
      { error: 'URL Inspection HTTP 500' },
    ])).toEqual({ checked: 3, indexed: 1, states: { 'Submitted and indexed': 1, 'Crawled - currently not indexed': 2 }, errors: 1 });
  });
  it('top queries sort by clicks then impressions, rounded positions', () => {
    const t = topQueries({ rows: [
      { keys: ['a'], clicks: 1, impressions: 5, position: 3.33 }, { keys: ['b'], clicks: 1, impressions: 50, position: 2 },
      { keys: ['c'], clicks: 4, impressions: 1, position: 1 },
    ] });
    expect(t.map((q) => q.query)).toEqual(['c', 'b', 'a']);
    expect(t[2].position).toBe(3.3);
    expect(topQueries({})).toEqual([]);
  });
  it('pages fold by path and /b/ pages with impressions are counted once', () => {
    const pages = pagesByPath({ rows: [
      { keys: ['https://curb.guide/b/1'], clicks: 1, impressions: 3 }, { keys: ['http://www.curb.guide/b/1?x=1'], clicks: 1, impressions: 1 },
      { keys: ['https://curb.guide/n/mission'], clicks: 0, impressions: 2 },
    ] });
    expect(pages).toContainEqual({ page: '/b/1', clicks: 2, impressions: 4 });
    expect(blockPages(pages, 12253)).toEqual({ withImpressions: 1, total: 12253 });
    expect(pathOf('not a url')).toBe('not a url');
  });
  it('daily has all 7 window days, zero where Google has no row; totals with no rows are zero', () => {
    const d = googleDaily({ rows: [{ keys: ['2026-09-30'], clicks: 3, impressions: 9 }] }, '2026-09-28');
    expect(d.map((x) => x.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(d[2]).toEqual({ date: '2026-09-30', clicks: 3, impressions: 9 });
    expect(d[0]).toEqual({ date: '2026-09-28', clicks: 0, impressions: 0 });
    expect(googleTotals({})).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: null });
  });
  it('parses sitemap locs', () => {
    expect(parseSitemap('<url><loc> https://curb.guide/b/1 </loc></url><url><loc>https://curb.guide/b/2</loc></url>'))
      .toEqual(['https://curb.guide/b/1', 'https://curb.guide/b/2']);
  });
  it('bing sums its window and the 7 days before by day; data after the week never moves the window past it', () => {
    const b = summarizeBing(bingTraffic.d, bingPages.d, WEEK);
    expect(b).toMatchObject({
      start: '2026-09-30', end: '2026-10-06', prevStart: '2026-09-23', prevEnd: '2026-09-29',
      clicks: 3, impressions: 14, prev: { clicks: 9, impressions: 99 }, daysWithData: { week: 3, prev: 1 }, lastDataDay: '2026-10-07',
      pagesFrom: '2026-09-25', pagesTo: '2026-10-01', // the bucket dated Fri Oct 2 holds Sep 25 to Oct 1
    });
    expect(b).not.toHaveProperty('pageWeeks');
    expect(b.topPages).toEqual([
      { page: '/about', clicks: 1, impressions: 2 }, { page: '/', clicks: 0, impressions: 4 }, { page: '/n/', clicks: 0, impressions: 4 },
    ]);
    expect(summarizeBing([], { error: 'Bing GetPageStats HTTP 500' }, WEEK).topPages).toEqual({ error: 'Bing GetPageStats HTTP 500' });
  });
  it('bing\'s window ends on its last day with data, with a prev window of the same 7 days right before', () => {
    expect(bingWindow('2026-10-04', WEEK)).toEqual({ start: '2026-09-28', end: '2026-10-04', prevStart: '2026-09-21', prevEnd: '2026-09-27' });
    expect(bingWindow('2026-10-09', WEEK)).toEqual({ start: '2026-09-30', end: '2026-10-06', prevStart: '2026-09-23', prevEnd: '2026-09-29' });
    expect(bingWindow(null, WEEK)).toEqual({ start: '2026-09-30', end: '2026-10-06', prevStart: '2026-09-23', prevEnd: '2026-09-29' });
    // Bing has data through Sat Oct 4: Sun and Mon are not zeros, the window just ends on Saturday
    const lagging = [
      { Clicks: 4, Impressions: 40, Date: utcDay('2026-09-21') }, { Clicks: 9, Impressions: 99, Date: utcDay('2026-09-27') }, // prev window
      { Clicks: 2, Impressions: 20, Date: utcDay('2026-09-28') }, { Clicks: 1, Impressions: 8, Date: utcDay('2026-09-30') },
      { Clicks: 3, Impressions: 30, Date: utcDay('2026-10-04') },
      { Clicks: 7, Impressions: 70, Date: utcDay('2026-09-20') }, // before both
    ];
    const b = summarizeBing(lagging, [], WEEK);
    expect(b).toMatchObject({
      start: '2026-09-28', end: '2026-10-04', prevStart: '2026-09-21', prevEnd: '2026-09-27',
      clicks: 6, impressions: 58, prev: { clicks: 13, impressions: 139 }, daysWithData: { week: 3, prev: 2 }, lastDataDay: '2026-10-04',
      topPages: [], pagesFrom: null, pagesTo: null,
    });
  });
  it('bing top pages come from the weekly bucket overlapping the window most, with its real range', () => {
    // a bucket dated D holds the 7 days before D
    expect(pickPageBucket(['2026-09-25', '2026-10-02', '2026-10-09'], '2026-09-30', '2026-10-06')).toBe('2026-10-09'); // 5 days vs 2
    expect(pickPageBucket(['2026-09-25', '2026-10-02', '2026-10-09'], '2026-09-28', '2026-10-04')).toBe('2026-10-02'); // 4 days vs 3
    expect(pickPageBucket(['2026-09-25'], '2026-10-02', '2026-10-08')).toBeNull();                                      // no overlap
    expect(pickPageBucket(['2026-10-02', '2026-10-09'], '2026-09-29', '2026-10-05')).toBe('2026-10-09');               // a tie: the later
    const pages = [
      ...bingPages.d,
      { Clicks: 3, Impressions: 30, Date: utcDay('2026-10-09'), Query: 'https://curb.guide/tickets' },
      { Clicks: 1, Impressions: 9, Date: utcDay('2026-10-09'), Query: 'https://www.curb.guide/tickets' },
    ];
    const b = summarizeBing(bingTraffic.d, pages, WEEK);
    expect(b).toMatchObject({ pagesFrom: '2026-10-02', pagesTo: '2026-10-08', topPages: [{ page: '/tickets', clicks: 4, impressions: 39 }] });
    // nothing overlaps: no pages rather than another week's
    const old = summarizeBing(bingTraffic.d, [{ Clicks: 5, Impressions: 50, Date: utcDay('2026-09-25'), Query: 'https://curb.guide/' }], WEEK);
    expect(old).toMatchObject({ topPages: [], pagesFrom: null, pagesTo: null });
  });
});

describe('collect', () => {
  it('returns both sections with the requested shape, through ctx.fetch only', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('global fetch used'); });
    const f = mockFetch();
    const out = await collect(ctx(f));
    expect(out.google).toMatchObject({
      start: '2026-09-28', end: '2026-10-04', prevStart: '2026-09-21', prevEnd: '2026-09-27',
      clicks: 269, impressions: 8841, ctr: 0.0304, position: 7.1,
      prev: { clicks: 300, impressions: 4800, ctr: 0.0625, position: 6 },
      blockPages: { withImpressions: 2, total: 1000 },
      indexSample: { checked: 50, indexed: 25, states: { 'Submitted and indexed': 25, 'Discovered - currently not indexed': 25 } },
      firstIncompleteDate: '2026-10-03',
    });
    expect(out.google.daily).toHaveLength(7);
    expect(out.google.daily[3]).toEqual({ date: '2026-10-01', clicks: 56, impressions: 1596 });
    expect(out.google.topQueries).toHaveLength(8);
    expect(out.google.topQueries.slice(0, 3).map((q) => q.query)).toEqual(['sf street cleaning map', 'street cleaning san francisco', 'curb sf']);
    expect(out.google.topPages[0]).toEqual({ page: '/', clicks: 125, impressions: 2559 });
    expect(out.google.topPages).toContainEqual({ page: '/b/1', clicks: 1, impressions: 12 });
    expect(out.bing).toMatchObject({ start: '2026-09-30', end: '2026-10-06', clicks: 3, impressions: 14, prev: { clicks: 9, impressions: 99 }, pagesFrom: '2026-09-25', pagesTo: '2026-10-01' });
    expect(f.count('urlInspection')).toBe(SAMPLE_SIZE);
    expect(JSON.stringify(out)).not.toMatch(new RegExp(SECRETS.join('|')));
  });

  it('sends the refresh-token form, the bearer and the documented bodies', async () => {
    const f = mockFetch();
    await collect(ctx(f));
    const tok = f.calls.find((c) => c.url.includes('oauth2'));
    expect(tok.init.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(tok.init.body))).toEqual({
      grant_type: 'refresh_token', client_id: 'cid-123', client_secret: 'csecret-456', refresh_token: 'rtoken-789',
    });
    const q = f.calls.filter((c) => c.url.includes('searchAnalytics'));
    expect(q).toHaveLength(5);
    expect(q[0].url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Acurb.guide/searchAnalytics/query');
    expect(q[0].init.headers.authorization).toBe('Bearer ya29.access');
    const bodies = q.map((c) => JSON.parse(c.init.body));
    expect(bodies.every((b) => b.dataState === 'all')).toBe(true);
    expect(bodies.map((b) => b.dimensions[0] || 'total').sort()).toEqual(['date', 'page', 'query', 'total', 'total']);
    const ins = JSON.parse(f.calls.find((c) => c.url.includes('urlInspection')).init.body);
    expect(ins.siteUrl).toBe('sc-domain:curb.guide');
    expect(ins.inspectionUrl).toMatch(/^https:\/\/curb\.guide\/b\/\d+$/);
    const bing = f.calls.find((c) => c.url.includes('GetRankAndTrafficStats'));
    expect(bing.url).toBe('https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?siteUrl=https%3A%2F%2Fcurb.guide%2F&apikey=bingkey-abc');
  });

  it('GSC_SITE overrides the property', async () => {
    const f = mockFetch();
    await collect(ctx(f, { ...ENV, GSC_SITE: 'https://curb.guide/' }));
    expect(f.calls.find((c) => c.url.includes('searchAnalytics')).url).toContain('/sites/https%3A%2F%2Fcurb.guide%2F/');
  });

  it('missing config skips each engine; both missing skips the section', async () => {
    const f = mockFetch();
    expect(await collect(ctx(f, {}))).toMatchObject({ skipped: 'missing GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN, BING_API_KEY' });
    expect(f.calls).toHaveLength(0);
    const out = await collect(ctx(f, { BING_API_KEY: 'bingkey-abc', GSC_CLIENT_ID: 'x' }));
    expect(out.google).toEqual({ skipped: 'missing GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN' });
    expect(out.bing.impressions).toBe(14);
    expect(out.skipped).toBeUndefined();
  });

  it('an expired refresh token fails google only, with a hint and no secrets', async () => {
    const f = mockFetch({ 'oauth2.googleapis.com/token': () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400) });
    const out = await collect(ctx(f));
    expect(out.google).toEqual({ error: 'Google OAuth HTTP 400 invalid_grant (refresh token expired or revoked: re-authorize)' });
    expect(out.bing.impressions).toBe(14);
    expect(f.count('searchAnalytics')).toBe(0);
  });

  it('both engines failing throws one message naming both, with no key in it', async () => {
    const f = mockFetch({
      'searchAnalytics/query': () => json({ error: { code: 403, message: 'User does not have sufficient permission' } }, 403),
      GetRankAndTrafficStats: () => json({ ErrorCode: 3, Message: 'ERROR!!! InvalidApiKey' }, 400),
    });
    const err = await collect(ctx(f)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Google: Search Analytics HTTP 403; Bing: Bing GetRankAndTrafficStats HTTP 400 InvalidApiKey');
    expect(err.message).not.toMatch(new RegExp(SECRETS.join('|')));
  });

  it('a network failure on Bing never leaks the key-bearing URL', async () => {
    const f = mockFetch({ GetRankAndTrafficStats: (url) => { throw new TypeError(`fetch failed ${url}`); } });
    const out = await collect(ctx(f));
    expect(out.bing).toEqual({ error: 'Bing GetRankAndTrafficStats unreachable' });
  });

  it('a sitemap failure blanks only the /b/ total and the index sample', async () => {
    const f = mockFetch({ 'sitemap-blocks.xml': () => new Response('nope', { status: 503 }) });
    const out = await collect(ctx(f));
    expect(out.google.blockPages).toEqual({ withImpressions: 2, total: null });
    expect(out.google.indexSample).toEqual({ error: 'sitemap HTTP 503' });
    expect(out.google.clicks).toBe(269);
    expect(f.count('urlInspection')).toBe(0);
  });

  it('a quota error stops the inspection sample early instead of burning 50 calls', async () => {
    const f = mockFetch({ 'urlInspection/index:inspect': () => json({ error: { code: 429 } }, 429) });
    const out = await collect(ctx(f));
    expect(out.google.indexSample).toEqual({ error: 'URL Inspection HTTP 429' });
    expect(f.count('urlInspection')).toBeLessThanOrEqual(5);
    expect(out.google.topPages.length).toBeGreaterThan(0);
  });

  it('the index sample stops at its time budget and reports what it checked, keeping every other number', async () => {
    vi.useFakeTimers();
    try {
      const slow = () => new Promise((resolve) => setTimeout(() => resolve(json({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed' } } })), 25000));
      const f = mockFetch({ 'urlInspection/index:inspect': slow });
      const p = collect(ctx(f));
      await vi.advanceTimersByTimeAsync(SAMPLE_BUDGET_MS + 10000);
      const out = await p;
      // 25 s each, 5 at a time: 4 rounds done by 100 s, the 5th in flight at 120 s, nothing started after
      expect(out.google.indexSample).toEqual({ checked: 20, indexed: 20, states: { 'Submitted and indexed': 20 } });
      expect(f.count('urlInspection')).toBe(25);
      expect(out.google.clicks).toBe(269);
      expect(out.google.topPages.length).toBeGreaterThan(0);
      expect(out.bing.impressions).toBe(14);
    } finally { vi.useRealTimers(); }
  });

  it('the budget with nothing checked is an error; 3 timed out inspections stop the rest', async () => {
    vi.useFakeTimers();
    try {
      const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      const f = mockFetch({ 'urlInspection/index:inspect': hang });
      const p = collect(ctx(f));
      // each call gives up at 30 s; the two started after the first two timeouts end at 60 s, long before 120 s
      await vi.advanceTimersByTimeAsync(61000);
      const out = await p;
      expect(out.google.indexSample).toEqual({ error: 'URL Inspection timed out' });
      expect(f.count('urlInspection')).toBeLessThanOrEqual(7); // the first 5, plus at most 2 before the third timed out
      expect(out.google.clicks).toBe(269);

      // answers that never finish and never time out: the 120 s budget ends the sample
      const stuck = mockFetch({ 'urlInspection/index:inspect': () => new Promise(() => {}) });
      const q = collect(ctx(stuck));
      await vi.advanceTimersByTimeAsync(SAMPLE_BUDGET_MS);
      expect((await q).google.indexSample).toEqual({ error: 'index check timed out' });
    } finally { vi.useRealTimers(); }
  });

  it('a few failed inspections are counted, the rest still tallied', async () => {
    let n = 0;
    const f = mockFetch({ 'urlInspection/index:inspect': () => (++n % 10 === 0 ? new Response('', { status: 500 })
      : json({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' } } })) });
    const out = await collect(ctx(f));
    expect(out.google.indexSample).toEqual({ checked: 45, indexed: 0, states: { 'URL is unknown to Google': 45 }, errors: 5 });
  });

  it('a GetPageStats failure keeps the bing totals', async () => {
    const f = mockFetch({ GetPageStats: () => new Response('<html>', { status: 200 }) });
    const out = await collect(ctx(f));
    expect(out.bing).toMatchObject({ clicks: 3, impressions: 14, topPages: { error: 'Bing GetPageStats bad response' } });
  });
});
