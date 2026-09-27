// Tests for the anonymous client error log (api/client-error.js) with an in-memory Upstash mock.
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.KV_REST_API_URL = 'https://fake.upstash.io';
process.env.KV_REST_API_TOKEN = 'fake-token';
process.env.CRON_SECRET = 'test-secret';

const lists = {};
const kv = {};
const ttl = {};
const cmds = { n: 0 }; // Redis commands issued (the error log shares its Upstash quota with the alerts store)
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async lpush(k, v) { cmds.n++; (lists[k] || (lists[k] = [])).unshift(v); return lists[k].length; }
    async ltrim(k, a, b) { cmds.n++; if (lists[k]) lists[k] = lists[k].slice(a, b + 1); }
    async lrange(k, a, b) { cmds.n++; return (lists[k] || []).slice(a, b + 1); }
    async incr(k) { cmds.n++; kv[k] = (kv[k] || 0) + 1; return kv[k]; }
    async expire() { cmds.n++; return 1; }
    async set(k, v, opts) {
      cmds.n++;
      if (opts && opts.nx && (k in kv) && !(ttl[k] <= Date.now())) return null;
      kv[k] = v; if (opts && opts.px) ttl[k] = Date.now() + opts.px;
      return 'OK';
    }
  },
}));

const { default: handler, normalize, cleanSrc, coarseClient, group } = await import('./client-error.js');

// A controllable clock: the per-client limit lives in module memory, so every test starts a minute later.
vi.useFakeTimers({ toFake: ['Date'] });
let clock = Date.parse('2026-09-27T12:00:00Z');
const later = (ms) => vi.setSystemTime(clock += ms);
const storedMsgs = () => (lists['curb:errors'] || []).map((e) => (typeof e === 'string' ? JSON.parse(e) : e).msg);

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}
const post = (body, ip = '1.2.3.4') => ({ method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'user-agent': IPHONE, 'x-forwarded-for': ip }, query: {} });
const REPORT = { k: 'error', msg: "TypeError: Cannot read properties of undefined (reading 'lat')", src: 'https://curb.guide/', line: 1234, col: 9, stack: 'at placeYou (https://curb.guide/:1234:9)', page: '/?b=123', app: 'ios-app' };

beforeEach(() => {
  for (const k of Object.keys(lists)) delete lists[k];
  for (const k of Object.keys(kv)) delete kv[k];
  for (const k of Object.keys(ttl)) delete ttl[k];
  cmds.n = 0;
  later(60000);
});

describe('normalize', () => {
  it('keeps a same-site error and never stores the raw user agent or IP', () => {
    const e = normalize(REPORT, IPHONE, 1000);
    expect(e).toMatchObject({ ts: 1000, k: 'error', src: '/', line: 1234, app: 'ios-app', client: 'iOS Safari', page: '/' });
    expect(JSON.stringify(e)).not.toContain('Mozilla');
  });
  it('drops noise: cross-origin "Script error.", ResizeObserver, extension scripts, bad kinds, empty messages', () => {
    expect(normalize({ ...REPORT, msg: 'Script error.' }, IPHONE)).toBeNull();
    expect(normalize({ ...REPORT, msg: 'ResizeObserver loop limit exceeded' }, IPHONE)).toBeNull();
    expect(normalize({ ...REPORT, src: 'chrome-extension://abc/content.js' }, IPHONE)).toBeNull();
    expect(normalize({ ...REPORT, k: 'drop table' }, IPHONE)).toBeNull();
    expect(normalize({ ...REPORT, msg: '   ' }, IPHONE)).toBeNull();
    expect(normalize(null, IPHONE)).toBeNull();
  });
  it('accepts app events like event:locate-failed and clips oversized fields', () => {
    const e = normalize({ k: 'event:locate-failed', msg: 'x'.repeat(5000), stack: 'y'.repeat(5000), app: 'bogus' }, IPHONE);
    expect(e.k).toBe('event:locate-failed');
    expect(e.msg).toHaveLength(300);
    expect(e.stack).toHaveLength(1200);
    expect(e.app).toBe('web');
  });
});

describe('helpers', () => {
  it('cleanSrc keeps our paths and strips queries', () => {
    expect(cleanSrc('https://curb.guide/lib/sweep-core.js?v=2')).toBe('/lib/sweep-core.js');
    expect(cleanSrc('/lib/sweep-core.js?v=2')).toBe('/lib/sweep-core.js');
    expect(cleanSrc('https://evil.example/x.js')).toBe('https://evil.example');
  });
  it('coarseClient reduces the UA to OS + browser family', () => {
    expect(coarseClient(IPHONE)).toBe('iOS Safari');
    expect(coarseClient('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('Android Chrome');
    expect(coarseClient('')).toBe('Other Other');
  });
  it('group counts per error and ignores entries older than since', () => {
    const a = normalize(REPORT, IPHONE, 5000);
    const b = normalize(REPORT, IPHONE, 6000);
    const old = normalize(REPORT, IPHONE, 10);
    const out = group([b, a, old], 1000);
    expect(out.total).toBe(2);
    expect(out.groups[0]).toMatchObject({ count: 2, first: 5000, last: 6000, apps: { 'ios-app': 2 } });
  });
});

describe('handler', () => {
  it('POST stores a report (beacon text/plain body) and answers 204', async () => {
    const res = mockRes();
    await handler(post(REPORT), res);
    expect(res.statusCode).toBe(204);
    expect(lists['curb:errors']).toHaveLength(1);
  });
  it('POST de-dupes the same error from the same client within a minute, but not across clients', async () => {
    await handler(post(REPORT, '1.1.1.1'), mockRes());
    later(6000); // past the per-client gap: only the per-error de-dupe can drop this one
    await handler(post(REPORT, '1.1.1.1'), mockRes());
    await handler(post(REPORT, '2.2.2.2'), mockRes());
    expect(lists['curb:errors']).toHaveLength(2);
  });
  it('POST: one client flooding distinct reports gets one stored, spends no Redis on the rest, and cannot lock out others', async () => {
    await handler(post({ ...REPORT, msg: 'junk 0' }, '6.6.6.6'), mockRes());
    const afterFirst = cmds.n;
    for (let i = 1; i < 400; i++) await handler(post({ ...REPORT, msg: 'junk ' + i }, '6.6.6.6'), mockRes());
    expect(cmds.n).toBe(afterFirst); // the flood never reached Upstash on this instance
    await handler(post({ ...REPORT, msg: 'TypeError: real bug' }, '7.7.7.7'), mockRes());
    expect(storedMsgs()).toEqual(['TypeError: real bug', 'junk 0']);
    expect(kv[`curb:errs:rate:${Math.floor(Date.now() / 60000)}`]).toBe(2); // the global cap only counted 2
  });
  it('POST: the per-client gap is shared across instances and reopens after 5 s', async () => {
    await handler(post({ ...REPORT, msg: 'first' }, '8.8.8.8'), mockRes());
    vi.resetModules(); // a second serverless instance: fresh memory, same Upstash
    const { default: other } = await import('./client-error.js');
    await other(post({ ...REPORT, msg: 'second' }, '8.8.8.8'), mockRes());
    expect(lists['curb:errors']).toHaveLength(1);
    later(5000);
    await other(post({ ...REPORT, msg: 'third' }, '8.8.8.8'), mockRes());
    expect(storedMsgs()).toEqual(['third', 'first']);
  });
  it('POST ignores oversized or malformed bodies without failing', async () => {
    const r1 = mockRes(); await handler(post('x'.repeat(5000)), r1);
    const r2 = mockRes(); await handler(post('{not json'), r2);
    expect([r1.statusCode, r2.statusCode]).toEqual([204, 204]);
    expect(lists['curb:errors']).toBeUndefined();
  });
  it('POST stops storing once the global per-minute cap is hit', async () => {
    for (let i = 0; i < 125; i++) await handler(post({ ...REPORT, msg: 'err ' + i }, '9.9.9.' + i), mockRes());
    expect(lists['curb:errors']).toHaveLength(120);
  });
  it('GET requires the cron secret and returns grouped errors', async () => {
    await handler(post(REPORT), mockRes());
    const denied = mockRes();
    await handler({ method: 'GET', headers: {}, query: {} }, denied);
    expect(denied.statusCode).toBe(401);
    const ok = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: { since: '0' } }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.total).toBe(1);
    expect(ok.body.groups[0].msg).toContain('TypeError');
  });
});
