// Handler tests for api/send-notifications.js: who may trigger it (QStash signature vs CRON_SECRET),
// the read-only ?status=1 mode, the run record + healthchecks ping, the run lock, and the web-push
// options (bounded TTL, urgency, no Topic). In-memory Upstash, mocked web-push, REAL QStash Receiver
// verifying JWTs signed here with jose (its own dependency).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';

const CUR = 'sig_current_test_key', NEXT = 'sig_next_test_key';
Object.assign(process.env, {
  KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'fake',
  VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', CRON_SECRET: 'cron-s3cret',
  QSTASH_CURRENT_SIGNING_KEY: CUR, QSTASH_NEXT_SIGNING_KEY: NEXT, HC_PING_URL: 'https://hc-ping.com/uuid',
});

const mem = {}, kv = {};
let failSubsLoad = false;
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async hget(k, f) { return mem[k] && mem[k][f]; }
    async hset(k, obj) { (mem[k] || (mem[k] = {})); Object.assign(mem[k], obj); }
    async hdel(k, f) { if (mem[k]) delete mem[k][f]; }
    async hgetall(k) { if (k === 'curb:subs' && failSubsLoad) throw new Error('upstash down'); return mem[k] ? { ...mem[k] } : null; }
    async hexists(k, f) { return mem[k] && f in mem[k] ? 1 : 0; }
    async set(k, v, opts) { if (opts && opts.nx && (k in kv)) return null; kv[k] = v; return 'OK'; }
  },
}));
const send = vi.fn(async () => ({ statusCode: 201 }));
vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, sendNotification: (...a) => send(...a) } }));
const fetchMock = vi.fn(async () => ({ ok: true }));
vi.stubGlobal('fetch', fetchMock);

const { default: handler } = await import('./send-notifications.js');

const SELF = 'https://curb.guide/api/send-notifications';
const EP = 'https://fcm.googleapis.com/fcm/send/abc';
const SUB = { endpoint: EP, keys: { p256dh: 'p', auth: 'a' } };
const NOW = Date.parse('2026-06-19T15:40:00Z'); // 20 min before a 9 AM PDT sweep

function req({ method = 'GET', headers = {}, query = {}, body = '' } = {}) {
  return Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, headers, query });
}
function res() {
  return { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}
const bearer = (extra = {}) => req({ headers: { authorization: 'Bearer cron-s3cret' }, ...extra });
async function qsig({ url = SELF, body = '', key = CUR, exp = '5m' } = {}) {
  const hash = createHash('sha256').update(body).digest('base64url');
  return new SignJWT({ body: hash }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('Upstash').setSubject(url).setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 1)
    .setExpirationTime(exp).sign(new TextEncoder().encode(key));
}
const qstash = async (opts = {}, reqOver = {}) => req({ method: 'POST', headers: { 'upstash-signature': await qsig(opts) }, body: opts.sentBody ?? opts.body ?? '', ...reqOver });
const run = async (r) => { const out = res(); await handler(r, out); return out; };
const armSub = (spot) => { mem['curb:subs'] = { [EP]: JSON.stringify({ subscription: SUB, spot, notified: {}, savedAt: NOW }) }; };
const SPOT = { corridor: 'Steiner St', blockside: 'North', nextSweepISO: '2026-06-19T16:00:00.000Z', eveningISO: '2026-06-19T03:00:00.000Z', leadMinutes: 30, level: 'normal' };
const status = () => ({ last: JSON.parse(mem['curb:cron']?.last || 'null'), ok: JSON.parse(mem['curb:cron']?.ok || 'null') });

beforeEach(() => {
  for (const o of [mem, kv]) for (const k of Object.keys(o)) delete o[k];
  failSubsLoad = false; send.mockClear(); fetchMock.mockClear();
  process.env.CRON_SECRET = 'cron-s3cret';
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  armSub(SPOT);
});
afterEach(() => { vi.useRealTimers(); });

describe('auth', () => {
  it('rejects unauthenticated and wrong-secret calls', async () => {
    expect((await run(req())).code).toBe(401);
    expect((await run(req({ headers: { authorization: 'Bearer nope' } }))).code).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('the GitHub backup (Bearer CRON_SECRET) runs and is recorded as trigger "bearer", without the healthchecks success ping', async () => {
    const out = await run(bearer());
    expect(out.code).toBe(200);
    expect(out.body.web.sent).toBe(1);
    expect(status().ok).toMatchObject({ trigger: 'bearer', outcome: 'ok' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a signed QStash POST runs WITHOUT CRON_SECRET, is recorded as "qstash" and pings healthchecks', async () => {
    delete process.env.CRON_SECRET;
    const out = await run(await qstash());
    expect(out.code).toBe(200);
    expect(out.body.web.sent).toBe(1);
    expect(status().last).toMatchObject({ trigger: 'qstash', outcome: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('https://hc-ping.com/uuid', expect.anything());
  });

  it('verifies against the raw body, the exact URL, expiry and both signing keys', async () => {
    expect((await run(await qstash({ body: '{"a":1}' }))).code).toBe(200);                     // body hash matches
    expect((await run(await qstash({ body: '', sentBody: 'tampered' }))).code).toBe(401);      // body swapped
    expect((await run(await qstash({ url: SELF + '?test=ios' }))).code).toBe(401);              // other destination
    expect((await run(await qstash({ key: 'wrong' }))).code).toBe(401);
    expect((await run(await qstash({ exp: Math.floor(NOW / 1000) - 60 }))).code).toBe(401);    // expired
    expect((await run(await qstash({ key: NEXT }))).code).toBe(200);                           // key rotation
  });

  it('a QStash signature can never unlock ?test=ios or ?status (CRON_SECRET-only powers)', async () => {
    expect((await run(await qstash({}, { query: { test: 'ios' } }))).code).toBe(403);
    expect((await run(await qstash({}, { query: { status: '1' } }))).code).toBe(403);
  });
});

describe('?status=1 (monitor)', () => {
  it('returns the last run and last success, and sends nothing', async () => {
    await run(bearer());
    send.mockClear();
    const out = await run(bearer({ query: { status: '1' } }));
    expect(out.code).toBe(200);
    expect(out.body.lastOk).toMatchObject({ trigger: 'bearer', outcome: 'ok', web: { sent: 1 } });
    expect(out.body.last.at).toBe(new Date(NOW).toISOString());
    expect(send).not.toHaveBeenCalled();
    expect((await run(bearer({ method: 'POST', query: { status: '1' } }))).code).toBe(405);
  });
});

describe('failures + the run lock', () => {
  it('an erroring run is recorded, pings /fail, and keeps the lock (a retry cannot re-send)', async () => {
    failSubsLoad = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await run(await qstash());
    err.mockRestore();
    expect(out.code).toBe(500);
    expect(status().last).toMatchObject({ outcome: 'error', error: 'upstash down', trigger: 'qstash' });
    expect(status().ok).toBe(null);
    expect(fetchMock).toHaveBeenCalledWith('https://hc-ping.com/uuid/fail', expect.anything());
    failSubsLoad = false;
    const retry = await run(await qstash());
    expect(retry.body.skipped).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('logs web-push failures other than 404/410 instead of swallowing them, without pruning', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValueOnce(Object.assign(new Error('bad'), { statusCode: 400, body: 'BadWebPushTopic' }));
    const out = await run(bearer());
    expect(out.body.web).toMatchObject({ sent: 0, pruned: 0 });
    expect(err).toHaveBeenCalledWith('web push failed:', 400, 'BadWebPushTopic');
    expect(mem['curb:subs'][EP]).toBeTruthy();
    err.mockRestore();
  });
});

describe('web-push options', () => {
  it('lead: TTL until the sweep, high urgency, stays on screen, no Topic', async () => {
    await run(bearer());
    const [sub, payload, opts] = send.mock.calls[0];
    expect(sub.endpoint).toBe(EP);
    expect(opts).toEqual({ TTL: 20 * 60, urgency: 'high' });
    expect('topic' in opts).toBe(false);
    expect(JSON.parse(payload)).toMatchObject({ tag: 'curb-sweep', requireInteraction: true });
  });

  it('eve: normal urgency, expires at SF midnight (never "tomorrow" on the sweep day)', async () => {
    vi.setSystemTime(Date.parse('2026-06-19T03:05:00Z')); // 8:05 PM PDT
    await run(bearer());
    const [, payload, opts] = send.mock.calls[0];
    expect(opts).toEqual({ TTL: (4 * 60 - 5) * 60, urgency: 'normal' });
    expect(JSON.parse(payload).requireInteraction).toBe(false);
  });

  it('a night sweep sends the "tonight" push at high urgency', async () => {
    armSub({ ...SPOT, nextSweepISO: '2026-06-19T07:00:00.000Z' }); // midnight PDT
    vi.setSystemTime(Date.parse('2026-06-19T04:05:00Z'));          // 9:05 PM
    await run(bearer());
    const [, payload, opts] = send.mock.calls[0];
    expect(JSON.parse(payload).title).toBe('🌙 Move it tonight');
    expect(opts.urgency).toBe('high');
    expect(opts.TTL).toBe(2 * 3600 + 55 * 60);
  });
});
