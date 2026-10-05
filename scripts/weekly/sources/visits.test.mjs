// Tests for the weekly report's Vercel Web Analytics source (visits.mjs). Mocked fetch, no network;
// responses follow the shapes in Vercel's OpenAPI spec (countPageviews, aggregatePageviews).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportWeek } from '../week.mjs';
import {
  collect, teamParam, vercelUrl, parseStamp, hourChunks, bucketDaily, topBy, topPagesFrom, topHoodsFrom,
} from './visits.mjs';

const WEEK = reportWeek(Date.parse('2026-10-07T15:07:00Z')); // Sep 30 to Oct 6; prev Sep 23 to 29
const H = 3600000;
const TOKEN = 'test-token-not-real';

describe('helpers', () => {
  it('sends a team id as teamId and anything else as the slug', () => {
    expect(teamParam('team_abc123')).toEqual({ teamId: 'team_abc123' });
    expect(teamParam('alevizio')).toEqual({ slug: 'alevizio' });
    expect(teamParam('')).toEqual({});
    expect(teamParam(undefined)).toEqual({});
  });

  it('repeats array params (by=hour&by=country), encodes filters and leaves out empty values', () => {
    const u = new URL(vercelUrl('/v1/query/web-analytics/visits/aggregate',
      { projectId: 'curb', by: ['hour', 'country'], filter: "requestPath eq '/a b'", teamId: undefined, slug: '' }));
    expect(u.origin + u.pathname).toBe('https://api.vercel.com/v1/query/web-analytics/visits/aggregate');
    expect(u.searchParams.getAll('by')).toEqual(['hour', 'country']);
    expect(u.searchParams.get('filter')).toBe("requestPath eq '/a b'");
    expect(u.searchParams.has('teamId')).toBe(false);
    expect(u.searchParams.has('slug')).toBe(false);
  });

  it('reads row timestamps as UTC, with or without a zone', () => {
    expect(parseStamp('2026-10-01T03:00:00.000Z')).toBe(Date.parse('2026-10-01T03:00:00Z'));
    expect(parseStamp('2026-10-01T03:00:00')).toBe(Date.parse('2026-10-01T03:00:00Z'));
    expect(parseStamp('2026-10-01T03:00:00+00:00')).toBe(Date.parse('2026-10-01T03:00:00Z'));
    expect(parseStamp(1790000000000)).toBe(1790000000000);
    expect(parseStamp(undefined)).toBeNaN();
  });

  it('splits the 14 days into contiguous hourly windows of at most 97 hours', () => {
    for (const week of [WEEK, reportWeek(Date.parse('2026-11-04T16:00:00Z')), reportWeek(Date.parse('2027-03-17T16:00:00Z'))]) {
      const chunks = hourChunks(week);
      expect(chunks[0].since).toBe(week.prevStart);
      expect(chunks.at(-1).end).toBe(week.end);
      chunks.forEach((c, i) => {
        if (i) expect(c.since).toBe(chunks[i - 1].end);
        expect(c.end - c.since).toBeLessThanOrEqual(97 * H);
      });
    }
    // the week DST ends holds the 25 hour Sunday: that chunk is exactly 97 hours
    expect(Math.max(...hourChunks(reportWeek(Date.parse('2026-11-04T16:00:00Z'))).map((c) => c.end - c.since))).toBe(97 * H);
  });
});

describe('bucketDaily', () => {
  it('puts each UTC hour on its San Francisco day, not its UTC day', () => {
    const { daily, prevDaily } = bucketDaily([
      // Sep 30 05:00 UTC is still Tue Sep 29, 10 PM in SF: the last day of the PREVIOUS week
      { timestamp: '2026-09-30T05:00:00.000Z', pageviews: 5, visitors: 4 },
      // Oct 1 03:00 UTC (no zone, still UTC) is Wed Sep 30, 8 PM in SF: the week's first day
      { timestamp: '2026-10-01T03:00:00', pageviews: 7, visitors: 6 },
      { timestamp: '2026-09-30T07:00:00.000Z', pageviews: 3, visitors: 3 }, // Sep 30 00:00 SF
      { timestamp: '2026-10-07T06:00:00.000Z', pageviews: 1, visitors: 1 }, // Oct 6 23:00 SF
    ], WEEK);
    expect(daily).toHaveLength(7);
    expect(prevDaily).toHaveLength(7);
    expect(daily[0]).toEqual({ date: '2026-09-30', pageviews: 10, visitors: 9 });
    expect(daily[6]).toEqual({ date: '2026-10-06', pageviews: 1, visitors: 1 });
    expect(daily[3]).toEqual({ date: '2026-10-03', pageviews: 0, visitors: 0 });
    expect(prevDaily[6]).toEqual({ date: '2026-09-29', pageviews: 5, visitors: 4 });
  });

  it('skips hours outside [prevStart, end) and an hour returned twice', () => {
    const { daily, prevDaily } = bucketDaily([
      { timestamp: '2026-09-23T06:00:00Z', pageviews: 50, visitors: 50 }, // Sep 22 23:00 SF, before prevStart
      { timestamp: '2026-10-07T07:00:00Z', pageviews: 50, visitors: 50 }, // = end (Oct 7 00:00 SF)
      { timestamp: '2026-09-27T07:00:00Z', pageviews: 4, visitors: 2 },
      { timestamp: '2026-09-27T07:00:00.000Z', pageviews: 4, visitors: 2 }, // same hour from the next chunk
      { timestamp: 'garbage', pageviews: 9, visitors: 9 },
    ], WEEK);
    expect(prevDaily.map((d) => d.pageviews)).toEqual([0, 0, 0, 0, 4, 0, 0]);
    expect(daily.every((d) => d.pageviews === 0)).toBe(true);
  });
});

describe('top lists', () => {
  it('drops blanks, Others and dropped values, case-insensitively, and ranks by visitors', () => {
    const rows = [
      { referrerHostname: '', visitors: 50 }, { referrerHostname: null, visitors: 40 },
      { referrerHostname: 'www.google.com', visitors: 20 }, { referrerHostname: 'curb.guide', visitors: 15 },
      { referrerHostname: 'WWW.curb.guide', visitors: 3 }, { referrerHostname: 't.co', visitors: 5 },
      { referrerHostname: 'Others', visitors: 8 }, { referrerHostname: 'reddit.com', visitors: 6 },
    ];
    expect(topBy(rows, 'referrerHostname', 2, { as: 'host', drop: new Set(['curb.guide', 'www.curb.guide']) }))
      .toEqual([{ host: 'www.google.com', visitors: 20 }, { host: 'reddit.com', visitors: 6 }]);
  });

  it('folds /b/ and /n/ pages into one row each and keeps the top neighborhoods apart', () => {
    const rows = [
      { requestPath: '/', pageviews: 50, visitors: 40 },
      { requestPath: '/b/8753101', pageviews: 10, visitors: 9 },
      { requestPath: '/n/mission', pageviews: 6, visitors: 5 },
      { requestPath: 'Others', pageviews: 30, visitors: 25 },
      { requestPath: '/about', pageviews: 5, visitors: 4 },
    ];
    const groups = [
      { path: '/b/*', label: 'Block pages', pageviews: 40, visitors: 30 },
      { path: '/n/*', label: 'Neighborhood pages', pageviews: 0, visitors: 0 }, // nothing: no row
    ];
    expect(topPagesFrom(rows, groups)).toEqual([
      { path: '/', pageviews: 50, visitors: 40 },
      { path: '/b/*', label: 'Block pages', pageviews: 40, visitors: 30 },
      { path: '/about', pageviews: 5, visitors: 4 },
    ]);
    expect(topHoodsFrom(rows)).toEqual([{ path: '/n/mission', visitors: 5 }]);
  });
});

// A fake Vercel API: answers like the real one, records every request.
const PATHS = [
  ['/', 50, 40], ['/b/8753101', 10, 9], ['/n/mission', 6, 5], ['/n/castro-upper-market', 4, 3], ['/n/presidio', 2, 2],
  ['/about', 5, 4], ['/tickets', 3, 3], ['Others', 30, 25], ['/privacy', 1, 1], ['/press', 1, 1], ['/changelog', 2, 1],
  ['/support', 1, 1], ['/n/soma', 1, 1], ['/n/bernal-heights', 1, 1], ['/n/excelsior', 1, 1],
].map(([requestPath, pageviews, visitors]) => ({ requestPath, pageviews, visitors }));
// The /n/ only query: Marina is busier than most, yet missing from PATHS (block pages crowd the top 100)
const HOODS = [
  ['/n/', 9, 8], ['/n/marina', 14, 12], ['/n/mission', 6, 5], ['/n/castro-upper-market', 4, 3], ['Others', 5, 4],
  ['/n/presidio', 2, 2], ['/n/soma', 1, 1], ['/n/noe-valley', 3, 3],
].map(([requestPath, pageviews, visitors]) => ({ requestPath, pageviews, visitors }));
const HOODS_FILTER = "environment eq 'production' and startswith(requestPath,'/n/')";
const HOURS = [
  ['2026-09-23T07:00:00.000Z', 2, 1],  // Sep 23 00:00 SF: prev week's first hour
  ['2026-09-27T07:00:00.000Z', 4, 2],  // Sep 27 00:00 SF, a chunk boundary (the fake returns it twice)
  ['2026-09-30T05:00:00.000Z', 5, 4],  // UTC Sep 30 but SF Sep 29 → prev week
  ['2026-09-30T07:00:00.000Z', 3, 3],  // Sep 30 00:00 SF
  ['2026-10-01T03:00:00', 7, 6],       // UTC Oct 1 but SF Sep 30 (and no zone on the stamp)
  ['2026-10-07T06:00:00.000Z', 1, 1],  // Oct 6 23:00 SF: the week's last hour
  ['2026-10-07T07:00:00.000Z', 99, 99], // = end: the fake's last chunk returns it, collect must drop it
].map(([timestamp, pageviews, visitors]) => ({ timestamp, pageviews, visitors }));

function fakeVercel({ fail = {} } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, opts) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const by = u.searchParams.getAll('by');
    calls.push({ url, path: u.pathname, q, by, auth: opts?.headers?.authorization });
    const key = u.pathname.endsWith('/count') ? `count:${q.since}:${q.filter}` : `aggregate:${by.join(',')}:${q.filter}`;
    for (const [k, status] of Object.entries(fail)) {
      if (key.startsWith(k)) return { ok: false, status, json: async () => ({ error: { message: 'nope' } }) };
    }
    const reply = (data) => ({ ok: true, status: 200, json: async () => ({ version: 1, query: { since: q.since, until: q.until }, data }) });
    if (u.pathname.endsWith('/count')) {
      if (q.filter.includes("'/b/'")) return reply({ pageviews: 40, visitors: 30 });
      if (q.filter.includes("'/n/'")) return reply({ pageviews: 12, visitors: 9 });
      return reply(q.since === new Date(WEEK.start).toISOString() ? { pageviews: 120, visitors: 80 } : { pageviews: 100, visitors: 70 });
    }
    if (by[0] === 'hour') {
      // inclusive window, plus the next boundary hour (a sloppy API): collect must neither double count nor overflow
      const since = Date.parse(q.since);
      const until = Date.parse(q.until);
      return reply(HOURS.filter((r) => { const t = Date.parse(r.timestamp.endsWith('Z') ? r.timestamp : `${r.timestamp}Z`); return t >= since && t <= until + 1; }));
    }
    if (by[0] === 'requestPath') return reply(q.filter === HOODS_FILTER ? HOODS : PATHS);
    if (by[0] === 'referrerHostname') {
      return reply([['', 50], [null, 40], ['www.google.com', 20], ['curb.guide', 15], ['www.curb.guide', 3], ['t.co', 5], ['Others', 8], ['reddit.com', 6]]
        .map(([referrerHostname, visitors]) => ({ referrerHostname, pageviews: visitors * 2, visitors })));
    }
    if (by[0] === 'country') {
      return reply([['US', 70], ['CA', 3], ['Others', 2], ['GB', 2], ['', 1], ['DE', 1], ['FR', 1], ['MX', 1]]
        .map(([country, visitors]) => ({ country, pageviews: visitors, visitors })));
    }
    if (by[0] === 'deviceType') {
      return reply([['desktop', 18], ['mobile', 60], ['tablet', 2]].map(([deviceType, visitors]) => ({ deviceType, pageviews: visitors, visitors })));
    }
    return { ok: false, status: 400, json: async () => ({}) };
  });
  return { fetch, calls };
}

const ctx = (f, env = {}) => ({ week: WEEK, env: { VERCEL_TOKEN: TOKEN, ...env }, fetch: f, now: Date.parse('2026-10-07T15:07:00Z') });

describe('collect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is skipped without a token, with no request made', async () => {
    const { fetch } = fakeVercel();
    expect(await collect({ ...ctx(fetch), env: {} })).toEqual({ skipped: 'missing VERCEL_TOKEN' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the whole section from the API, using only ctx.fetch', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('global fetch used'); });
    const { fetch, calls } = fakeVercel();
    const s = await collect(ctx(fetch, { VERCEL_TEAM: 'alevizio' }));
    expect(s).toEqual({
      // page views add up from the hourly rows (exact SF days); visitors come from the count endpoint
      pageviews: 11, visitors: 80,
      prev: { pageviews: 11, visitors: 70 },
      daily: [
        { date: '2026-09-30', pageviews: 10, visitors: 9 },
        { date: '2026-10-01', pageviews: 0, visitors: 0 },
        { date: '2026-10-02', pageviews: 0, visitors: 0 },
        { date: '2026-10-03', pageviews: 0, visitors: 0 },
        { date: '2026-10-04', pageviews: 0, visitors: 0 },
        { date: '2026-10-05', pageviews: 0, visitors: 0 },
        { date: '2026-10-06', pageviews: 1, visitors: 1 },
      ],
      prevDaily: [
        { date: '2026-09-23', pageviews: 2, visitors: 1 },
        { date: '2026-09-24', pageviews: 0, visitors: 0 },
        { date: '2026-09-25', pageviews: 0, visitors: 0 },
        { date: '2026-09-26', pageviews: 0, visitors: 0 },
        { date: '2026-09-27', pageviews: 4, visitors: 2 },
        { date: '2026-09-28', pageviews: 0, visitors: 0 },
        { date: '2026-09-29', pageviews: 5, visitors: 4 },
      ],
      topPages: [
        { path: '/', pageviews: 50, visitors: 40 },
        { path: '/b/*', label: 'Block pages', pageviews: 40, visitors: 30 },
        { path: '/n/*', label: 'Neighborhood pages', pageviews: 12, visitors: 9 },
        { path: '/about', pageviews: 5, visitors: 4 },
        { path: '/tickets', pageviews: 3, visitors: 3 },
        { path: '/changelog', pageviews: 2, visitors: 1 },
        { path: '/privacy', pageviews: 1, visitors: 1 },
        { path: '/press', pageviews: 1, visitors: 1 },
      ],
      // from the /n/ only query, not the top 100 paths: Marina leads although PATHS has no row for it
      topHoods: [
        { path: '/n/marina', visitors: 12 }, { path: '/n/mission', visitors: 5 }, { path: '/n/castro-upper-market', visitors: 3 },
        { path: '/n/noe-valley', visitors: 3 }, { path: '/n/presidio', visitors: 2 },
      ],
      referrers: [{ host: 'www.google.com', visitors: 20 }, { host: 'reddit.com', visitors: 6 }, { host: 't.co', visitors: 5 }],
      countries: [
        { country: 'US', visitors: 70 }, { country: 'CA', visitors: 3 }, { country: 'GB', visitors: 2 },
        { country: 'DE', visitors: 1 }, { country: 'FR', visitors: 1 },
      ],
      devices: [{ device: 'mobile', visitors: 60 }, { device: 'desktop', visitors: 18 }, { device: 'tablet', visitors: 2 }],
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);

    // every request: production only, the project + team, the token in the header and never in the URL
    for (const c of calls) {
      expect(c.q.projectId).toBe('curb');
      expect(c.q.slug).toBe('alevizio');
      expect(c.q.filter.startsWith("environment eq 'production'")).toBe(true);
      expect(c.auth).toBe(`Bearer ${TOKEN}`);
      expect(c.url).not.toContain(TOKEN);
    }
    // the week is [start, end): `until` is inclusive, so it is sent 1 ms before Wednesday 00:00 SF
    const week = calls.find((c) => c.path.endsWith('/count') && c.q.filter === "environment eq 'production'" && c.q.since === '2026-09-30T07:00:00.000Z');
    expect(week.q.until).toBe('2026-10-07T06:59:59.999Z');
    const prev = calls.find((c) => c.path.endsWith('/count') && c.q.since === '2026-09-23T07:00:00.000Z' && !c.q.filter.includes('startswith'));
    expect(prev.q.until).toBe('2026-09-30T06:59:59.999Z');
    // hourly rows come in 4 windows covering prevStart..end, each under the 100 row limit
    const hourly = calls.filter((c) => c.by[0] === 'hour');
    expect(hourly).toHaveLength(4);
    expect(hourly.every((c) => c.by.length === 1 && c.q.limit === '100')).toBe(true);
    expect(hourly.map((c) => c.q.since).sort()[0]).toBe('2026-09-23T07:00:00.000Z');
    expect(hourly.map((c) => c.q.until).sort().at(-1)).toBe('2026-10-07T06:59:59.999Z');
    // the two page groups are exact filtered counts over the week
    const groups = calls.filter((c) => c.path.endsWith('/count') && c.q.filter.includes('startswith'));
    expect(groups.map((c) => c.q.filter).sort()).toEqual([
      "environment eq 'production' and startswith(requestPath,'/b/')",
      "environment eq 'production' and startswith(requestPath,'/n/')",
    ]);
    expect(groups.every((c) => c.q.since === '2026-09-30T07:00:00.000Z' && c.q.until === '2026-10-07T06:59:59.999Z')).toBe(true);
    // the neighborhoods have their own production, /n/ only aggregate over the week
    const hoods = calls.filter((c) => c.by[0] === 'requestPath' && c.q.filter === HOODS_FILTER);
    expect(hoods).toHaveLength(1);
    expect(hoods[0].q).toMatchObject({ limit: '20', since: '2026-09-30T07:00:00.000Z', until: '2026-10-07T06:59:59.999Z' });
    expect(calls.filter((c) => c.by[0] === 'requestPath' && c.q.filter === "environment eq 'production'").map((c) => c.q.limit)).toEqual(['100']);
  });

  it('passes a prj_ id and a team_ id through', async () => {
    const { fetch, calls } = fakeVercel();
    await collect(ctx(fetch, { VERCEL_PROJECT: 'prj_abc', VERCEL_TEAM: 'team_xyz' }));
    expect(calls.every((c) => c.q.projectId === 'prj_abc' && c.q.teamId === 'team_xyz' && !('slug' in c.q))).toBe(true);
  });

  it('calls without a team param when VERCEL_TEAM is unset', async () => {
    const { fetch, calls } = fakeVercel();
    await collect(ctx(fetch));
    expect(calls.every((c) => !('teamId' in c.q) && !('slug' in c.q))).toBe(true);
  });

  it('a failing sub-part carries its own error and the rest still loads', async () => {
    const { fetch } = fakeVercel({ fail: { 'aggregate:hour': 500, [`count:${new Date(WEEK.prevStart).toISOString()}:environment eq 'production'`]: 503, 'aggregate:country': 429 } });
    const s = await collect(ctx(fetch));
    expect(s.pageviews).toBe(120);
    expect(s.prev).toEqual({ error: 'Vercel HTTP 503' });
    expect(s.daily).toEqual({ error: 'Vercel HTTP 500' });
    expect(s.prevDaily).toEqual({ error: 'Vercel HTTP 500' });
    expect(s.countries).toEqual({ error: 'Vercel HTTP 429' });
    expect(s.topPages).toHaveLength(8);
    expect(s.devices).toHaveLength(3);
  });

  it('a failing page-group count fails topPages only; topHoods still loads', async () => {
    const { fetch } = fakeVercel({ fail: { [`count:${new Date(WEEK.start).toISOString()}:environment eq 'production' and startswith`]: 400 } });
    const s = await collect(ctx(fetch));
    expect(s.topPages).toEqual({ error: 'Vercel HTTP 400' });
    expect(s.topHoods).toHaveLength(5);
  });

  it('a failing neighborhood query fails topHoods only', async () => {
    const { fetch } = fakeVercel({ fail: { [`aggregate:requestPath:${HOODS_FILTER}`]: 500 } });
    const s = await collect(ctx(fetch));
    expect(s.topHoods).toEqual({ error: 'Vercel HTTP 500' });
    expect(s.topPages).toHaveLength(8);
    expect(s.pageviews).toBe(11);
  });

  it('throws a short reason when the week total fails, never the token', async () => {
    const { fetch } = fakeVercel({ fail: { 'count:': 403 } });
    const err = await collect(ctx(fetch)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Vercel HTTP 403 (token cannot read this project: check VERCEL_TEAM)');
    expect(err.message).not.toContain(TOKEN);
  });

  it('throws on a 200 without data', async () => {
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: 'weird' }) });
    await expect(collect(ctx(fetch))).rejects.toThrow('Vercel bad response (no data)');
  });
});
