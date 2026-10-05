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
    async hmget(k, ...fs) { return fs.map((f) => (mem[k] && f in mem[k] ? mem[k][f] : null)); }
    async hset(k, obj) { (mem[k] || (mem[k] = {})); Object.assign(mem[k], obj); }
    async hsetnx(k, f, v) { if (mem[k] && f in mem[k]) return 0; (mem[k] || (mem[k] = {}))[f] = v; return 1; }
    async hdel(k, ...fs) { if (mem[k]) for (const f of fs) delete mem[k][f]; }
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
// APNs stays real (a malformed key really throws) unless a test sets apnsReply(token, collapseId) →
// { status, reason }: then no key and no network, every send answers with that.
let apnsReply = null;
vi.mock('./_apns.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real,
    getProviderToken: () => (apnsReply ? 'jwt' : real.getProviderToken()),
    openSession: (h) => (apnsReply ? { close() {} } : real.openSession(h)),
    sendOne: (...a) => (apnsReply ? Promise.resolve(apnsReply(a[2], a[4])) : real.sendOne(...a)) };
});
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
  failSubsLoad = false; afterSnapshot = null; apnsReply = null; send.mockReset(); send.mockImplementation(async () => ({ statusCode: 201 })); fetchMock.mockClear();
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
    delete mem['curb:subs'];   // this device's only watch is the one armed below
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

describe('delivery health (a run that works can still deliver nothing)', () => {
  const statusNow = async () => (await run(bearer({ query: { status: '1' } }))).body;
  const webErr = (code) => Object.assign(new Error('push service said no'), { statusCode: code });
  const armMany = (n, spot = SPOT) => {
    mem['curb:subs'] = {};
    for (let i = 0; i < n; i++) {
      const sub = { endpoint: EP + i, keys: { p256dh: 'p', auth: 'a' } };
      mem['curb:subs'][sub.endpoint] = JSON.stringify({ subscription: sub, spot, notified: {}, savedAt: NOW });
    }
  };
  const armIos = (n, spot = SPOT) => {
    mem['curb:apns'] = {};
    for (let i = 0; i < n; i++) { const t = String(i).repeat(64); mem['curb:apns'][t] = JSON.stringify({ token: t, spot, notified: {}, savedAt: NOW }); }
  };
  const pinged = () => fetchMock.mock.calls.map(([u]) => u);
  let quiet;
  beforeEach(() => { quiet = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { quiet.mockRestore(); for (const k of ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k]; });

  it('records per run what was attempted, delivered, failed (by status) and pruned', async () => {
    armMany(4);
    send.mockImplementation(async (sub) => {
      if (sub.endpoint === EP + 1) throw webErr(403);
      if (sub.endpoint === EP + 2) throw webErr(410);
      if (sub.endpoint === EP + 3) throw new Error('Socket timeout');   // web-push's own timeout: no status
      return { statusCode: 201 };
    });
    const web = { checked: 4, attempted: 4, sent: 1, failed: 2, pruned: 1, failures: { 403: 1, '0 timeout': 1 } };
    expect((await run(bearer())).body.web).toMatchObject(web);
    expect(status().last.web).toMatchObject(web);
  });

  it('every web push failing (rotated VAPID keys): ?status=1 says so and healthchecks gets /fail', async () => {
    armMany(3);
    send.mockImplementation(async () => { throw webErr(403); });
    const out = await run(await qstash());
    expect(out.code).toBe(200);                                     // the run itself worked
    expect(pinged()).toEqual(['https://hc-ping.com/uuid/fail']);
    const s = await statusNow();
    expect(s.delivery.failing).toEqual(['web: 3 of the last 3 devices failed (403 ×3)']);
    expect(s.lastQstash.ok).toBe(true);
  });

  it('every iOS push failing (revoked APNs key): counted by status and reason, after the one re-mint', async () => {
    armMany(0); armIos(3);
    Object.assign(process.env, { APNS_KEY_P8: 'k', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    const tokens = [];
    apnsReply = (t) => { tokens.push(t); return { status: 403, reason: 'InvalidProviderToken' }; };
    const out = await run(await qstash());
    expect(out.body.ios).toMatchObject({ attempted: 3, sent: 0, failed: 3, pruned: 0, failures: { '403 InvalidProviderToken': 3 } });
    expect(tokens).toHaveLength(4);                                 // the first token was retried once with a fresh JWT
    expect((await statusNow()).delivery.failing).toEqual(['iOS: 3 of the last 3 devices failed (403 InvalidProviderToken ×3)']);
    expect(pinged()).toEqual(['https://hc-ping.com/uuid/fail']);
  });

  it('an iOS token that is dead on both hosts is pruned, not counted as a failure', async () => {
    armMany(0); armIos(3);
    Object.assign(process.env, { APNS_KEY_P8: 'k', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    apnsReply = () => ({ status: 410, reason: 'Unregistered' });
    expect((await run(await qstash())).body.ios).toMatchObject({ attempted: 3, failed: 0, pruned: 3 });
    expect((await statusNow()).delivery.failing).toBeUndefined();
    expect(pinged()).toEqual(['https://hc-ping.com/uuid']);
  });

  it('no false alarm from one dead subscription retried on every tick of its window, or from prunes', async () => {
    armMany(5);                                                      // all five get the 8 PM night-before push
    send.mockImplementation(async (sub) => { if (sub.endpoint === EP + 0) throw webErr(500); if (sub.endpoint === EP + 4) throw webErr(404); return { statusCode: 201 }; });
    for (let t = Date.parse('2026-06-19T03:00:05Z'); t <= Date.parse('2026-06-19T05:45:05Z'); t += 15 * 60000) {
      vi.setSystemTime(t);
      await run(await qstash());
    }
    expect(send.mock.calls.filter(([s]) => s.endpoint === EP + 0)).toHaveLength(12); // retried all evening
    expect((await statusNow()).delivery.failing).toBeUndefined();
    expect(new Set(pinged())).toEqual(new Set(['https://hc-ping.com/uuid']));
  });

  it('stays failing through runs with nothing due, and recovers once deliveries land again', async () => {
    armMany(4);
    send.mockImplementation(async () => { throw webErr(403); });
    await run(await qstash());
    vi.setSystemTime(Date.parse('2026-06-19T17:00:00Z'));           // after the sweep: nothing due
    fetchMock.mockClear();
    await run(await qstash());
    expect((await statusNow()).delivery.failing).toHaveLength(1);   // nothing delivered since: still failing
    expect(pinged()).toEqual(['https://hc-ping.com/uuid/fail']);
    send.mockImplementation(async () => ({ statusCode: 201 }));    // keys fixed
    vi.setSystemTime(NOW);
    armMany(3);                                                      // three devices get their push
    fetchMock.mockClear();
    await run(await qstash());
    expect((await statusNow()).delivery.failing).toBeUndefined();
    expect(pinged()).toEqual(['https://hc-ping.com/uuid']);
  });

  it('an APNs pass that errors two runs in a row (a mangled key) fails, a single blip does not', async () => {
    armMany(0); armIos(1);
    Object.assign(process.env, { APNS_KEY_P8: 'not a key', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    await run(await qstash());
    expect((await statusNow()).delivery.failing).toBeUndefined();
    for (const k of Object.keys(kv)) delete kv[k];                   // the kept run lock expires
    vi.setSystemTime(NOW + 15 * 60000);
    fetchMock.mockClear();
    await run(await qstash());
    const [line] = (await statusNow()).delivery.failing;
    expect(line).toMatch(/^iOS: the APNs pass failed 2 runs in a row \(.+\)$/);
    expect(pinged()).toEqual(['https://hc-ping.com/uuid/fail']);
  });

  it('armed iOS watches with APNs not configured at all fail at once', async () => {
    armIos(2);
    await run(await qstash());
    expect((await statusNow()).delivery.failing).toEqual(['iOS: APNs is not configured (APNS_* env vars), so 2 armed iOS watches get no push']);
  });
});

// ---- multi-watch: one device, several curb sides (GitHub #11) ----
describe('two watches on one device', () => {
  // Both sides of Steiner St, swept the same Thursday morning (9 and 10 AM PDT): both night-before pushes
  // fall in Wednesday's 8 PM tick. (Not the 19th: Juneteenth is a city holiday, the watch would re-arm.)
  const R = (h) => ({ weekday: 'Thu', fromhour: String(h), tohour: String(h + 2), week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' });
  const base = { corridor: 'Steiner St', eveningISO: '2026-06-25T03:00:00.000Z', leadMinutes: 30, level: 'normal', cnn: '42' };
  const north = { ...base, blockside: 'North', nextSweepISO: '2026-06-25T16:00:00.000Z', rule: R(9), rules: [R(9)], sideKey: 'North' };
  const south = { ...base, blockside: 'South', nextSweepISO: '2026-06-25T17:00:00.000Z', rule: R(10), rules: [R(10)], sideKey: 'South' };
  const rec = (field, spot, notified = {}) => JSON.stringify({ subscription: SUB, spot, notified, savedAt: NOW });
  const arm2 = (a = north, b = south) => { mem['curb:subs'] = { [EP]: rec(EP, a), [EP + '#1']: rec(EP + '#1', b) }; };
  const stored = (f) => JSON.parse(mem['curb:subs'][f]);
  const EVE = Date.parse('2026-06-25T03:05:00Z');   // Wed 8:05 PM PDT
  const sentTags = () => send.mock.calls.map(([, p]) => JSON.parse(p).tag);
  const statusNow = async () => (await run(bearer({ query: { status: '1' } }))).body;
  let quiet;
  beforeEach(() => { quiet = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { quiet.mockRestore(); for (const k of ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID']) delete process.env[k]; });

  it('both sides get their own push, with their own tag, and their own de-dupe: no repeats on the next tick', async () => {
    arm2();
    vi.setSystemTime(EVE);
    const out = await run(bearer());
    expect(out.body.web).toMatchObject({ checked: 1, watches: 2, attempted: 2, sent: 2 });
    expect(sentTags()).toEqual(['curb-sweep-eve', 'curb-sweep-eve-1']);   // one tag each: no collapse into one notification
    expect(send.mock.calls.map(([, p]) => JSON.parse(p).body)).toEqual([expect.stringContaining('(North)'), expect.stringContaining('(South)')]);
    expect(stored(EP).notified).toEqual({ eve: north.nextSweepISO });
    expect(stored(EP + '#1').notified).toEqual({ eve: south.nextSweepISO });
    vi.setSystemTime(EVE + 15 * 60000);
    expect((await run(bearer())).body.web.sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a turned-off watch sends nothing and is never re-armed, while the other one keeps working', async () => {
    arm2();
    await disarmSub(EP, SUB.keys.auth, { cnn: '42', sideKey: 'South', corridor: 'Steiner St', limits: '', blockside: 'South' });
    vi.setSystemTime(EVE);
    expect((await run(bearer())).body.web).toMatchObject({ checked: 1, watches: 1, sent: 1 });
    expect(sentTags()).toEqual(['curb-sweep-eve']);
    vi.setSystemTime(Date.parse('2026-06-25T19:30:00Z'));             // both sweeps over: the re-arm pass
    expect((await run(bearer())).body.web.rearmed).toBe(1);
    expect(stored(EP).spot.nextSweepISO).toBe('2026-07-02T16:00:00.000Z');
    expect(stored(EP + '#1').spot).toBe(null);
  });

  it('each watch re-arms through its own record, even when a Turn off of the other lands mid-run', async () => {
    arm2();
    vi.setSystemTime(Date.parse('2026-06-25T19:30:00Z'));
    afterSnapshot = () => disarmSub(EP, SUB.keys.auth, { cnn: '42', sideKey: 'North' });
    expect((await run(bearer())).body.web.rearmed).toBe(1);
    expect(stored(EP).spot).toBe(null);                                 // the Turn off held
    expect(stored(EP + '#1').spot.nextSweepISO).toBe('2026-07-02T17:00:00.000Z');
  });

  it('a dead push service counts the DEVICE once: one send, one failure, one window entry', async () => {
    mem['curb:subs'] = {};
    for (let i = 0; i < 3; i++) {
      const sub = { endpoint: EP + i, keys: { p256dh: 'p', auth: 'a' } };
      mem['curb:subs'][sub.endpoint] = JSON.stringify({ subscription: sub, spot: north, notified: {}, savedAt: NOW });
      mem['curb:subs'][sub.endpoint + '#1'] = JSON.stringify({ subscription: sub, spot: south, notified: {}, savedAt: NOW });
    }
    send.mockImplementation(async () => { throw Object.assign(new Error('nope'), { statusCode: 403 }); });
    vi.setSystemTime(EVE);
    const out = await run(await qstash());
    expect(out.body.web).toMatchObject({ checked: 3, watches: 6, attempted: 3, sent: 0, failed: 3, failures: { 403: 3 } });
    expect(send).toHaveBeenCalledTimes(3);                              // a failed device's second watch waits for the next tick
    const s = await statusNow();
    expect(s.delivery.web).toHaveLength(3);
    expect(s.delivery.failing).toEqual(['web: 3 of the last 3 devices failed (403 ×3)']);
  });

  it('one dead device with two watches is no false alarm, and a 410 prunes both of its watches once', async () => {
    arm2();
    send.mockImplementation(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    vi.setSystemTime(EVE);
    expect((await run(bearer())).body.web).toMatchObject({ checked: 1, watches: 2, attempted: 1, pruned: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(mem['curb:subs']).toEqual({});
    expect((await statusNow()).delivery.failing).toBeUndefined();
  });

  it('iOS: both watches push to the REAL token with their own collapse id; a bad token prunes both', async () => {
    const tok = 'ab'.repeat(32);
    mem['curb:subs'] = {};
    mem['curb:apns'] = {
      [tok]: JSON.stringify({ token: tok, spot: north, notified: {}, savedAt: NOW, platform: 'ios' }),
      [tok + '#1']: JSON.stringify({ spot: south, notified: {}, savedAt: NOW, platform: 'ios' }),
    };
    Object.assign(process.env, { APNS_KEY_P8: 'k', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    const tokens = [];
    apnsReply = (t) => { tokens.push(t); return { status: 200 }; };
    vi.setSystemTime(EVE);
    const out = await run(bearer());
    expect(out.body.ios).toMatchObject({ checked: 1, watches: 2, sent: 2 });
    expect(tokens).toEqual([tok, tok]);
    expect(JSON.parse(mem['curb:apns'][tok]).notified).toEqual({ eve: north.nextSweepISO });
    expect(JSON.parse(mem['curb:apns'][tok + '#1']).notified).toEqual({ eve: south.nextSweepISO });
    expect('token' in JSON.parse(mem['curb:apns'][tok + '#1'])).toBe(false);

    for (const k of Object.keys(kv)) delete kv[k];
    mem['curb:apns'][tok] = JSON.stringify({ token: tok, spot: north, notified: {}, savedAt: NOW, platform: 'ios' });
    mem['curb:apns'][tok + '#1'] = JSON.stringify({ spot: south, notified: {}, savedAt: NOW, platform: 'ios' });
    const ids = [];
    apnsReply = (t, collapse) => { ids.push(collapse); return { status: 400, reason: 'BadDeviceToken' }; };
    const pruned = await run(bearer());
    expect(pruned.body.ios).toMatchObject({ attempted: 1, pruned: 1, failed: 0 });
    expect(ids).toEqual(['curb-sweep-eve', 'curb-sweep-eve']);         // primary host, then the cross-host retry
    expect(mem['curb:apns']).toEqual({});
  });

  it('iOS: the second watch\'s push carries its own collapse id', async () => {
    const tok = 'ab'.repeat(32);
    mem['curb:subs'] = {};
    mem['curb:apns'] = {
      [tok]: JSON.stringify({ token: tok, spot: north, notified: { eve: north.nextSweepISO }, savedAt: NOW, platform: 'ios' }),
      [tok + '#1']: JSON.stringify({ spot: south, notified: {}, savedAt: NOW, platform: 'ios' }),
    };
    Object.assign(process.env, { APNS_KEY_P8: 'k', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    const ids = [];
    apnsReply = (t, collapse) => { ids.push([t, collapse]); return { status: 200 }; };
    vi.setSystemTime(EVE);
    await run(bearer());
    expect(ids).toEqual([[tok, 'curb-sweep-eve-1']]);
  });

  it('?test=ios sends one test per device, however many watches it has', async () => {
    const tok = 'ab'.repeat(32), off = 'cd'.repeat(32);
    mem['curb:apns'] = {
      [tok]: JSON.stringify({ token: tok, spot: north, notified: {}, savedAt: NOW }),
      [tok + '#1']: JSON.stringify({ spot: south, notified: {}, savedAt: NOW }),
      [off]: JSON.stringify({ token: off, spot: null, notified: {}, savedAt: NOW }),
      [off + '#1']: JSON.stringify({ spot: null, notified: {}, savedAt: NOW }),
    };
    Object.assign(process.env, { APNS_KEY_P8: 'k', APNS_KEY_ID: 'KEYID', APNS_TEAM_ID: 'TEAMID' });
    const tokens = [];
    apnsReply = (t) => { tokens.push(t); return { status: 200 }; };
    expect((await run(bearer({ query: { test: 'ios' } }))).body).toMatchObject({ ok: true, tokens: 1 });
    expect(tokens).toEqual([tok]);
  });
});
