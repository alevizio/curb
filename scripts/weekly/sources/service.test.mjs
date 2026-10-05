// Tests for the weekly service-health source (service.mjs) against mocked fetch. The mocks are built by
// the real producers: group() from api/client-error.js for the error log, judgeDelivery from
// api/send-notifications.js for the delivery window, so a change to either shape shows up here.
import { describe, it, expect } from 'vitest';
import { collect, summarizeAlerts, summarizeErrors, EMAX } from './service.mjs';
import { reportWeek } from '../week.mjs';
import { group } from '../../../api/client-error.js';
import { judgeDelivery } from '../../../api/send-notifications.js';

const NOW = Date.parse('2026-10-07T15:07:00Z'); // Wed Oct 7, 8:07 AM PDT
const WEEK = reportWeek(NOW);                   // Sep 30 to Oct 6
const SECRET = 'test-secret-value';
const H = 3600e3;
const ago = (min) => new Date(NOW - min * 60000).toISOString();

const entry = (ts, k, msg, extra = {}) => ({ ts, k, msg, src: '/', line: 0, col: 0, stack: '', page: '/', app: 'web', client: 'iOS Safari', ...extra });
const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// The error log as api/_store.js holds it: newest first.
function sampleLog() {
  const inWeek = WEEK.start + 2 * 24 * H;
  return [
    ...times(2, (i) => entry(WEEK.end + H + i, 'error', 'TypeError: a is undefined', { src: '/app.js', line: 10, page: '/b/8753101' })), // after the week
    entry(WEEK.end + 2 * H, 'rejection', 'only after the week'),
    ...times(5, (i) => entry(inWeek + i, 'error', 'TypeError: a is undefined', { src: '/app.js', line: 10, page: '/b/8753101' })),
    ...times(3, (i) => entry(inWeek + 100 + i, 'event:data-load', 'HTTP 500 sweep')),
    ...times(2, (i) => entry(inWeek + 200 + i, 'event:locate-coarse', 'accuracy 3000 m')),            // informational
    ...times(1, (i) => entry(inWeek + 300 + i, 'event:locate-failed', 'code 1 User denied Geolocation')), // informational
    ...times(7, (i) => entry(inWeek + 400 + i, 'error', `one-off ${i}`)),
    ...times(4, (i) => entry(WEEK.prevStart + 24 * H + i, 'event:data-load', 'HTTP 500 sweep')),       // the week before
    entry(WEEK.prevStart + 25 * H, 'event:locate-coarse', 'accuracy 3000 m'),
    ...times(3, (i) => entry(WEEK.prevStart - H - i, 'error', 'too old')),
  ].sort((a, b) => b.ts - a.ts);
}

// /api/send-notifications?status=1 the way the handler builds it: { ok, now, ...loadRunStatus() }.
const fullRun = (min, trigger = 'qstash') => ({
  at: ago(min), trigger, outcome: 'ok', ms: 2100,
  web: { checked: 70, attempted: 2, sent: 2, failed: 0, pruned: 0, rearmed: 1 },
  ios: { configured: true, checked: 66, attempted: 1, sent: 1, failed: 0, pruned: 0, rearmed: 0 },
});
const healthyStatus = () => {
  const { delivery } = judgeDelivery(null, { web: [{ id: 'a1', ok: true }, { id: 'a2', ok: true }], ios: [{ id: 'b1', ok: true }] });
  return {
    ok: true, now: new Date(NOW).toISOString(),
    last: { at: ago(3), trigger: 'qstash', outcome: 'skipped', ms: 40 }, // a lock-skipped tick: no counts
    lastOk: fullRun(9),
    lastQstash: { at: ago(3), ok: true, skipped: true },
    lastQstashOk: { at: ago(9) },
    delivery,
  };
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Mock fetch serving both endpoints; records every call. */
function mockFetch({ status = healthyStatus(), log = sampleLog(), statusCode = 200, errorCode = 200 } = {}) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    if (u.pathname === '/api/send-notifications') return statusCode === 200 ? json(status) : json({ error: 'x' }, statusCode);
    if (u.pathname === '/api/client-error') return errorCode === 200 ? json(group(log, Number(u.searchParams.get('since')))) : json({ error: 'x' }, errorCode);
    return json({ error: 'not found' }, 404);
  };
  return { f, calls };
}
const ctx = (f, env = { CRON_SECRET: SECRET }) => ({ week: WEEK, env, fetch: f, now: NOW });

describe('collect', () => {
  it('skips without CRON_SECRET and never fetches', async () => {
    const { f, calls } = mockFetch();
    expect(await collect(ctx(f, {}))).toEqual({ skipped: 'missing CRON_SECRET' });
    expect(calls).toHaveLength(0);
  });

  it('reads the status once and the error log since prevStart, start and end, with the bearer', async () => {
    const { f, calls } = mockFetch();
    const out = await collect(ctx(f));
    expect(calls.map((c) => c.url).sort()).toEqual([
      `https://curb.guide/api/client-error?since=${WEEK.end}`,
      `https://curb.guide/api/client-error?since=${WEEK.prevStart}`,
      `https://curb.guide/api/client-error?since=${WEEK.start}`,
      'https://curb.guide/api/send-notifications?status=1',
    ].sort());
    for (const c of calls) {
      expect(c.opts.headers.authorization).toBe(`Bearer ${SECRET}`);
      expect(c.opts.redirect).toBe('manual');
    }
    expect(out.alerts).toMatchObject({ web: 70, ios: 66, failing: [] });
    expect(out.errors).toMatchObject({ total: 15, prevTotal: 4, capped: false });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out); // plain JSON
  });

  it('honours CURB_BASE (trailing slash tolerated)', async () => {
    const { f, calls } = mockFetch();
    await collect(ctx(f, { CRON_SECRET: SECRET, CURB_BASE: 'https://preview.example.dev/' }));
    expect(calls.every((c) => c.url.startsWith('https://preview.example.dev/api/'))).toBe(true);
  });

  it('a failing error log fails only its part', async () => {
    const { f } = mockFetch({ errorCode: 500 });
    const out = await collect(ctx(f));
    expect(out.errors).toEqual({ error: 'error log HTTP 500' });
    expect(out.alerts.web).toBe(70);
  });

  it('a wrong secret fails the alerts part with a hint, never the secret', async () => {
    const { f } = mockFetch({ statusCode: 401 });
    const out = await collect(ctx(f));
    expect(out.alerts.error).toBe('alerts status HTTP 401 (CRON_SECRET does not match the Vercel one)');
    expect(out.errors.total).toBe(15);
  });

  it('throws when both parts fail, without the secret in the message', async () => {
    const { f } = mockFetch({ statusCode: 503, errorCode: 401 });
    const err = await collect(ctx(f)).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('alerts status HTTP 503; error log HTTP 401 (CRON_SECRET does not match the Vercel one)');
    expect(err.message).not.toContain(SECRET);
  });

  it('a non-JSON or wrongly shaped answer is an error on that part', async () => {
    const { f } = mockFetch();
    const html = async (url, opts) => (url.includes('send-notifications') ? new Response('<html>', { status: 200 }) : f(url, opts));
    const a = await collect(ctx(html));
    expect(a.alerts).toEqual({ error: 'alerts status: not JSON' });
    expect(a.errors.total).toBe(15);
    const shaped = async (url, opts) => (url.includes('client-error') ? json({ nope: true }) : f(url, opts));
    const b = await collect(ctx(shaped));
    expect(b.errors).toEqual({ error: 'error log: unexpected response' });
    expect(b.alerts.web).toBe(70);
  });

  it('a redirect is a failure, not followed', async () => {
    const moved = async () => new Response(null, { status: 308, headers: { location: 'https://elsewhere.example/' } });
    await expect(collect(ctx(moved))).rejects.toThrow('alerts status HTTP 308; error log HTTP 308');
  });
});

describe('summarizeAlerts', () => {
  it('takes the watch counts from the last good run while the latest tick was lock-skipped', () => {
    expect(summarizeAlerts(healthyStatus(), NOW)).toEqual({
      web: 70, ios: 66,
      lastRunAt: ago(3), lastOutcome: 'skipped', lastTrigger: 'qstash',
      lastOkAt: ago(9),
      sentLastRun: { web: 2, ios: 1 },
      iosConfigured: true,
      delivery: { web: { devices: 2, ok: 2 }, ios: { devices: 1, ok: 1 } },
      failing: [],
      sender: { status: 'ok', detail: 'last good QStash run 3 min ago' },
    });
  });

  it('passes the delivery verdict through when pushes stop arriving', () => {
    const fails = ['a', 'b', 'c'].map((id) => ({ id, ok: false, why: '403' }));
    const { delivery } = judgeDelivery(null, { web: fails, ios: [] });
    const a = summarizeAlerts({ ...healthyStatus(), delivery }, NOW);
    expect(a.failing).toEqual(['web: 3 of the last 3 devices failed (403 ×3)']);
    expect(a.delivery).toEqual({ web: { devices: 3, ok: 0 }, ios: { devices: 0, ok: 0 } });
    expect(a.sender.status).toBe('fail');
  });

  it('reports an erroring latest run', () => {
    const s = { ...healthyStatus(), last: { at: ago(2), trigger: 'bearer', outcome: 'error', ms: 50, error: 'VAPID keys not set (see .env.example)' } };
    const a = summarizeAlerts(s, NOW);
    expect(a).toMatchObject({ lastOutcome: 'error', lastTrigger: 'bearer', lastError: 'VAPID keys not set (see .env.example)', web: 70 });
    expect(a.sender.status).toBe('fail');
  });

  it('a fresh deploy (no run recorded) is all nulls, not zeros', () => {
    const a = summarizeAlerts({ ok: true, now: ago(0), last: null, lastOk: null, lastQstash: null, lastQstashOk: null, delivery: null }, NOW);
    expect(a).toMatchObject({ web: null, ios: null, lastOkAt: null, lastRunAt: null, lastOutcome: null, failing: [],
      sentLastRun: { web: null, ios: null }, iosConfigured: null, delivery: { web: null, ios: null } });
    expect(a.sender.status).toBe('skip');
  });
});

describe('summarizeErrors', () => {
  const read = (log) => [WEEK.prevStart, WEEK.start, WEEK.end].map((t) => group(log, t));

  it('counts exactly the report week and the week before, breakage only', () => {
    const e = summarizeErrors(...read(sampleLog()));
    expect(e.total).toBe(15);        // 5 TypeError + 3 data-load + 7 one-offs (post-week reports excluded)
    expect(e.prevTotal).toBe(4);     // 4 data-load (the informational coarse fix is not counted)
    expect(e.informational).toBe(3); // 2 coarse fixes + 1 user-denied location
    expect(e.capped).toBe(false);
    expect(e.groups).toHaveLength(6);
    expect(e.groups[0]).toMatchObject({ message: 'TypeError: a is undefined', count: 5, kind: 'error', page: '/b/8753101', where: '/app.js:10' });
    expect(e.groups[0].id).toMatch(/^[0-9a-f]{8}$/);
    expect(e.groups[0].lastAt).toBe(new Date(WEEK.end + H + 1).toISOString()); // last seen, up to the report run
    expect(e.groups[1]).toMatchObject({ kind: 'event:data-load', count: 3 });
    expect(e.groups.some((g) => g.message === 'only after the week')).toBe(false);
    expect(e.groups.some((g) => g.kind === 'event:locate-coarse')).toBe(false);
  });

  it('an empty log is zeros', () => {
    expect(summarizeErrors(...read([]))).toEqual({ total: 0, prevTotal: 0, informational: 0, groups: [], capped: false });
  });

  it('a full log reaching into the week before: capped, prevTotal is a floor', () => {
    const log = [
      ...times(1500, (i) => entry(WEEK.end - 1 - i, 'error', 'busy week')),
      ...times(EMAX - 1500, (i) => entry(WEEK.start - 1 - i, 'error', 'busy week')),
    ];
    const e = summarizeErrors(...read(log));
    expect(e).toMatchObject({ total: 1500, prevTotal: EMAX - 1500, capped: true });
  });

  it('a log full inside the week alone: capped, and the week before is unknown (null), not 0', () => {
    const log = times(EMAX, (i) => entry(WEEK.end - 1 - i, 'error', 'flood'));
    const e = summarizeErrors(...read(log));
    expect(e).toMatchObject({ total: EMAX, prevTotal: null, capped: true });
  });
});
