// Handler tests for api/send-notifications.js: who may trigger it (QStash signature vs CRON_SECRET),
// the read-only ?status=1 mode, the run record + healthchecks ping, the run lock, and the web-push
// options (bounded TTL, urgency, no Topic). In-memory Upstash, mocked web-push, REAL QStash Receiver
// verifying JWTs signed here with jose (its own dependency).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';

const CUR = 'sig_current_test_key', NEXT = 'sig_next_test_key';
Object.assign(process.env, {
  KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'fake',
  VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', CRON_SECRET: 'cron-s3cret',
  QSTASH_CURRENT_SIGNING_KEY: CUR, QSTASH_NEXT_SIGNING_KEY: NEXT, HC_PING_URL: 'https://hc-ping.com/uuid',
});

const mem = {}, kv = {};
let failSubsLoad = false;
let afterSnapshot = null; // runs right after the sender's start-of-run read of curb:subs
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async hget(k, f) { return mem[k] && mem[k][f]; }
    async hset(k, obj) { (mem[k] || (mem[k] = {})); Object.assign(mem[k], obj); }
    async hdel(k, f) { if (mem[k]) delete mem[k][f]; }
    async hgetall(k) {
      if (k === 'curb:subs' && failSubsLoad) throw new Error('upstash down');
      const out = mem[k] ? { ...mem[k] } : null;
      if (k === 'curb:subs' && afterSnapshot) { const f = afterSnapshot; afterSnapshot = null; await f(); }
      return out;
    }
    async hexists(k, f) { return mem[k] && f in mem[k] ? 1 : 0; }
    async set(k, v, opts) { if (opts && opts.nx && (k in kv)) return null; kv[k] = v; return 'OK'; }
    async del(k) { delete kv[k]; }
    async eval(script, [k], [f, expected, next]) { // the store's compare-and-set of one hash field
      if (!(mem[k] && mem[k][f] === expected)) return 0;
      mem[k][f] = next; return 1;
    }
  },
}));
const send = vi.fn(async () => ({ statusCode: 201 }));
vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, sendNotification: (...a) => send(...a) } }));
const fetchMock = vi.fn(async () => ({ ok: true }));
vi.stubGlobal('fetch', fetchMock);

const { default: handler } = await import('./send-notifications.js');
const { saveSub, disarmSub } = await import('./_store.js');

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
  failSubsLoad = false; afterSnapshot = null; send.mockClear(); fetchMock.mockClear();
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
    // A bare stream, not Vercel's request helpers: in production only an EMPTY body verifies (see the
    // note above rawBody in send-notifications.js), so the QStash schedule must not send one.
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

  it('no workflow can be dispatched into ?test=ios (a push to every iOS device) with CRON_SECRET', () => {
    const dir = new URL('../.github/workflows/', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      const y = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      if (!y.includes('send-notifications')) continue;
      expect(y, f).not.toMatch(/[?&]test=|inputs\.test/);
    }
  });

  it('?test=ios skips iOS watches the user turned off (kept only for their de-dupe)', async () => {
    const on = 'ab'.repeat(32), off = 'cd'.repeat(32);
    mem['curb:apns'] = {
      [on]: JSON.stringify({ token: on, spot: SPOT, notified: {}, savedAt: NOW }),
      [off]: JSON.stringify({ token: off, spot: null, notified: { lead: SPOT.nextSweepISO }, savedAt: NOW }),
    };
    // A malformed key stops the pass before any APNs connection; `tokens` is how many it would push.
    Object.assign(process.env, { APNS_KEY_P8: 'not a key', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    try {
      expect((await run(bearer({ query: { test: 'ios' } }))).body).toMatchObject({ ok: false, tokens: 1 });
      delete mem['curb:apns'][on];
      expect((await run(bearer({ query: { test: 'ios' } }))).body).toMatchObject({ ok: true, tokens: 0, results: [] });
    } finally {
      for (const k of ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k];
    }
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

  it('also reports the last QStash run (any outcome) and the last successful one, apart from backup runs', async () => {
    const iso = (t) => new Date(t).toISOString();
    const statusNow = async () => (await run(bearer({ query: { status: '1' } }))).body;
    expect(await statusNow()).toMatchObject({ last: null, lastOk: null, lastQstash: null, lastQstashOk: null });
    await run(await qstash());                                         // QStash, ok
    vi.setSystemTime(NOW + 60000);
    await run(bearer());                                               // a GitHub backup run after it
    let s = await statusNow();
    expect(s.lastQstash).toEqual({ at: iso(NOW), ok: true });
    expect(s.lastQstashOk).toEqual({ at: iso(NOW) });
    expect(s.last).toMatchObject({ at: iso(NOW + 60000), trigger: 'bearer', outcome: 'ok' }); // unchanged fields
    expect(s.lastOk).toMatchObject({ trigger: 'bearer', outcome: 'ok' });
    // an erroring QStash run: lastQstash says so, lastQstashOk keeps the last good one
    vi.setSystemTime(NOW + 15 * 60000);
    failSubsLoad = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(await qstash());
    err.mockRestore();
    failSubsLoad = false;
    s = await statusNow();
    expect(s.lastQstash).toEqual({ at: iso(NOW + 15 * 60000), ok: false, error: 'upstash down' });
    expect(s.lastQstashOk).toEqual({ at: iso(NOW) });
    // a tick skipped by the lock (the failed run still holds it) is not a failure
    vi.setSystemTime(NOW + 16 * 60000);
    expect((await run(await qstash())).body.skipped).toBeTruthy();
    s = await statusNow();
    expect(s.lastQstash).toEqual({ at: iso(NOW + 16 * 60000), ok: true, skipped: true });
    expect(s.lastQstashOk).toEqual({ at: iso(NOW) });
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

  it('two schedulers: a GitHub run just before a QStash tick no longer swallows it, and nothing is sent twice', async () => {
    vi.setSystemTime(Date.parse('2026-06-19T15:29:00Z'));         // 8:29 PDT, the 9 AM sweep is 31 min out
    const gh = await run(bearer());
    expect(gh.body.web.sent).toBe(0);
    vi.setSystemTime(Date.parse('2026-06-19T15:30:05Z'));         // the QStash tick 65 s later
    const q = await run(await qstash());
    expect(q.body.skipped).toBeUndefined();
    expect(q.body.web.sent).toBe(1);                              // the 30-min push, on time (not at 8:45)
    vi.setSystemTime(Date.parse('2026-06-19T15:30:40Z'));         // a lagging GitHub run right after it
    const gh2 = await run(bearer());
    expect(gh2.body.skipped).toBeUndefined();
    expect(gh2.body.web.sent).toBe(0);                            // de-duped, not re-sent
    vi.setSystemTime(Date.parse('2026-06-19T15:45:05Z'));
    expect((await run(await qstash())).body.web.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(Object.keys(kv)).toEqual([]);                          // each good run freed the lock
  });

  it('runs that really overlap still skip: the lock holds while a run is in flight', async () => {
    let release;
    send.mockImplementationOnce(() => new Promise((r) => { release = () => r({ statusCode: 201 }); }));
    const first = run(await qstash());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await run(bearer())).body.skipped).toBeTruthy();
    release();
    expect((await first).body.web.sent).toBe(1);
    expect((await run(bearer())).body.web.sent).toBe(0);         // lock freed once it finished; de-duped
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('an APNs pass failure keeps the lock (markIosNotified errors are swallowed into ios.error)', async () => {
    const tok = 'ab'.repeat(32);
    mem['curb:apns'] = { [tok]: JSON.stringify({ token: tok, spot: SPOT, notified: {}, savedAt: NOW }) };
    Object.assign(process.env, { APNS_KEY_P8: 'not a key', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await run(bearer());
      expect(out.code).toBe(200);
      expect(out.body.ios.error).toBeTruthy();
      expect((await run(await qstash())).body.skipped).toBeTruthy();
    } finally {
      err.mockRestore();
      for (const k of ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k];
    }
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

describe('de-dupe across a user\'s off → on', () => {
  it('turning alerts off and back on for the same sweep does not re-send the push already delivered', async () => {
    expect((await run(bearer())).body.web.sent).toBe(1);          // the 30-min push
    vi.setSystemTime(NOW + 2 * 60000);
    expect(await disarmSub(EP, SUB.keys.auth)).toBe('ok');         // ✓ Alerts on → Turn off
    vi.setSystemTime(NOW + 4 * 60000);
    await saveSub(SUB, { ...SPOT });                               // Sweep alerts again, same sweep
    vi.setSystemTime(NOW + 5 * 60000);
    expect((await run(await qstash())).body.web.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('forever-watch re-arm vs a Turn off during the run', () => {
  const TUE = { weekday: 'Tue', fromhour: '9', tohour: '11', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
  const lastTue = { corridor: 'Steiner St', nextSweepISO: '2026-09-22T16:00:00.000Z', leadMinutes: 30, rule: TUE, rules: [TUE], cnn: '1', sideKey: 'L' };
  beforeEach(() => { armSub(lastTue); vi.setSystemTime(Date.parse('2026-09-23T17:00:00Z')); }); // Wed: Tue's sweep is over

  it('without one, the run re-arms to next Tuesday', async () => {
    expect((await run(bearer())).body.web.rearmed).toBe(1);
    expect(JSON.parse(mem['curb:subs'][EP]).spot.nextSweepISO).toBe('2026-09-29T16:00:00.000Z');
  });

  it('a Turn off that lands after the run read the watch is not undone by the re-arm', async () => {
    afterSnapshot = () => disarmSub(EP, SUB.keys.auth);
    expect((await run(bearer())).body.web.rearmed).toBe(0);
    expect(JSON.parse(mem['curb:subs'][EP]).spot).toBe(null);
    vi.setSystemTime(Date.parse('2026-09-29T15:40:00Z'));          // next Tuesday, 20 min before
    expect((await run(bearer())).body.web).toMatchObject({ sent: 0, rearmed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a style change from a sheet left open since before the re-arm', () => {
  it('keeps the re-armed sweep and sends the night-before push once', async () => {
    const R = (weekday) => ({ weekday, fromhour: '8', tohour: '10', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' });
    const rules = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(R);
    const at = (iso) => vi.setSystemTime(Date.parse(iso));
    const stored = () => JSON.parse(mem['curb:subs'][EP]).spot;
    // Mon 9:30 PDT, Monday's 8-10 sweep in progress: the sheet opens and arms with that sweep
    const sheet = { corridor: 'Daily St', limits: 'A - B', blockside: 'North', nextSweepISO: '2026-10-26T15:00:00.000Z',
      leadMinutes: 30, level: 'normal', voice: 'cheeky', rule: rules[0], rules, cnn: '555', sideKey: 'L' };
    at('2026-10-26T16:30:00Z'); await saveSub(SUB, { ...sheet });
    at('2026-10-26T17:00:05Z'); expect((await run(await qstash())).body.web.rearmed).toBe(1);   // 10:00 → Tue 8:00
    at('2026-10-27T03:00:05Z'); expect((await run(await qstash())).body.web.sent).toBe(1);      // 20:00 eve push
    at('2026-10-27T03:30:00Z'); await saveSub(SUB, { ...sheet, voice: 'drill' });               // 20:30 Voice tap
    expect(stored()).toMatchObject({ nextSweepISO: '2026-10-27T15:00:00.000Z', eveningISO: '2026-10-27T03:00:00.000Z', voice: 'drill' });
    for (const t of ['2026-10-27T03:45:05Z', '2026-10-27T04:00:05Z', '2026-10-27T04:15:05Z']) {
      at(t); expect((await run(await qstash())).body.web).toMatchObject({ sent: 0, rearmed: 0 });
    }
    at('2026-10-27T14:30:05Z'); await run(await qstash());                                       // Tue 7:30 lead
    expect(send.mock.calls.map(([, p]) => JSON.parse(p).title)).toEqual(['🧹 Sweep day tomorrow', '🚨 30 min: move the car']);
  });
});

describe('web-push options', () => {
  it('lead: TTL until the sweep, high urgency, stays on screen, no Topic', async () => {
    await run(bearer());
    const [sub, payload, opts] = send.mock.calls[0];
    expect(sub.endpoint).toBe(EP);
    expect(opts).toEqual({ TTL: 20 * 60, urgency: 'high', timeout: 10000 });  // timeout: one stuck push service must not stall the run
    expect('topic' in opts).toBe(false);
    expect(JSON.parse(payload)).toMatchObject({ tag: 'curb-sweep', requireInteraction: true });
  });

  it('eve: normal urgency, expires at SF midnight (never "tomorrow" on the sweep day)', async () => {
    vi.setSystemTime(Date.parse('2026-06-19T03:05:00Z')); // 8:05 PM PDT
    await run(bearer());
    const [, payload, opts] = send.mock.calls[0];
    expect(opts).toEqual({ TTL: (4 * 60 - 5) * 60, urgency: 'normal', timeout: 10000 });
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
