// Handler tests for the two save endpoints: the alerts OFF switch (web DELETE proven by endpoint +
// keys.auth; iOS DELETE / POST {spot:{off:true}} by token) and the iOS throttle that used to 429 any
// second save within 60 s (dropping a block switch or an Intensity/Voice change).
import { describe, it, expect, beforeEach, vi } from 'vitest';

Object.assign(process.env, { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'fake' });
const mem = {}, kv = {};
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async hget(k, f) { return mem[k] && mem[k][f]; }
    async hmget(k, ...fs) { return fs.map((f) => (mem[k] && f in mem[k] ? mem[k][f] : null)); }
    async hset(k, obj) { (mem[k] || (mem[k] = {})); Object.assign(mem[k], obj); }
    async hsetnx(k, f, v) { if (mem[k] && f in mem[k]) return 0; (mem[k] || (mem[k] = {}))[f] = v; return 1; }
    async hdel(k, ...fs) { if (mem[k]) for (const f of fs) delete mem[k][f]; }
    async hgetall(k) { return mem[k] ? { ...mem[k] } : null; }
    async hexists(k, f) { return mem[k] && f in mem[k] ? 1 : 0; }
    async set(k, v, opts) { if (opts && opts.nx && (k in kv)) return null; kv[k] = v; return 'OK'; }
    async eval(script, [k], [f, expected, next]) { // the store's compare-and-set of one hash field
      if (!(mem[k] && mem[k][f] === expected)) return 0;
      mem[k][f] = next; return 1;
    }
  },
}));
const { default: web } = await import('./save-subscription.js');
const { default: ios } = await import('./save-ios-subscription.js');

const res = () => ({ code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (h, method, body, ip = '1.2.3.4') => { const r = res(); await h({ method, body, headers: { 'x-forwarded-for': ip } }, r); return r; };
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: 'p'.repeat(20), auth: 'auth-secret' } };
const SPOT = { corridor: 'Haight St', nextSweepISO: '2026-10-06T16:00:00.000Z', leadMinutes: 30,
  rule: { weekday: 'Tue', fromhour: '9', tohour: '11', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' }, cnn: '123', sideKey: 'North' };
const TOKEN = 'ab'.repeat(32);
const webRec = (n = 0) => JSON.parse(mem['curb:subs'][SUB.endpoint + (n ? '#' + n : '')]);
const iosRec = (t = TOKEN) => mem['curb:apns'] && mem['curb:apns'][t] && JSON.parse(mem['curb:apns'][t]);

beforeEach(() => { for (const o of [mem, kv]) for (const k of Object.keys(o)) delete o[k]; });

describe('web: DELETE turns alerts off', () => {
  it('disarms with the matching keys.auth, keeping the subscription (auto-park still resolves it)', async () => {
    expect((await call(web, 'POST', { subscription: SUB, spot: SPOT })).code).toBe(200);
    const out = await call(web, 'DELETE', { subscription: SUB });
    expect(out.code).toBe(200);
    expect(out.body.off).toBe(true);
    expect(webRec().spot).toBe(null);
    expect(webRec().subscription.endpoint).toBe(SUB.endpoint);
  });

  it('refuses without proof of ownership (wrong keys.auth) and leaves the watch armed', async () => {
    await call(web, 'POST', { subscription: SUB, spot: SPOT });
    const out = await call(web, 'DELETE', { subscription: { ...SUB, keys: { ...SUB.keys, auth: 'guess' } } });
    expect(out.code).toBe(403);
    expect(webRec().spot.corridor).toBe('Haight St');
  });

  it('404 for an unknown subscription, 400 for junk, 405 for other methods', async () => {
    expect((await call(web, 'DELETE', { subscription: SUB })).code).toBe(404);
    expect((await call(web, 'DELETE', { subscription: { endpoint: 'https://evil.example/x', keys: SUB.keys } })).code).toBe(400);
    expect((await call(web, 'PUT', {})).code).toBe(405);
  });
});

describe('web: throttle on brand-new subscriptions only (a flood of fake ones would stall the sender)', () => {
  const sub = (n) => ({ ...SUB, endpoint: SUB.endpoint + n });
  it('re-saves of a known endpoint seconds apart always land (another block, then Intensity, then Voice)', async () => {
    expect((await call(web, 'POST', { subscription: SUB, spot: SPOT })).code).toBe(200);
    expect((await call(web, 'POST', { subscription: SUB, spot: { ...SPOT, cnn: '456' } })).code).toBe(200);
    expect((await call(web, 'POST', { subscription: SUB, spot: { ...SPOT, cnn: '456', level: 'light', voice: 'drill' } })).code).toBe(200);
    expect(webRec(1).spot).toMatchObject({ cnn: '456', level: 'light', voice: 'drill' });   // the second watch
    expect(webRec().spot).toMatchObject({ cnn: '123' });
  });

  it('a second NEW endpoint from the same IP within the window gets 429 and stores nothing; other IPs and Turn off are unaffected', async () => {
    expect((await call(web, 'POST', { subscription: SUB, spot: SPOT })).code).toBe(200);
    const flood = await call(web, 'POST', { subscription: sub(2), spot: SPOT });
    expect(flood.code).toBe(429);
    expect(mem['curb:subs'][sub(2).endpoint]).toBeFalsy();
    expect((await call(web, 'POST', { subscription: sub(3), spot: SPOT }, '5.6.7.8')).code).toBe(200);
    expect((await call(web, 'DELETE', { subscription: SUB })).code).toBe(200);
  });
});

describe('iOS: throttle + off switch', () => {
  it('re-saving a known token seconds apart always lands (block switch, then Intensity, then Voice)', async () => {
    expect((await call(ios, 'POST', { token: TOKEN, spot: SPOT })).code).toBe(200);
    expect((await call(ios, 'POST', { token: TOKEN, spot: { ...SPOT, level: 'light' } })).code).toBe(200);
    expect((await call(ios, 'POST', { token: TOKEN, spot: { ...SPOT, level: 'light', voice: 'drill' } })).code).toBe(200);
    expect(iosRec().spot).toMatchObject({ level: 'light', voice: 'drill' });
  });

  it('still throttles brand-new tokens per client IP (forged-token store bloat)', async () => {
    const t2 = 'cd'.repeat(32), t3 = 'ef'.repeat(32);
    expect((await call(ios, 'POST', { token: TOKEN, spot: SPOT })).code).toBe(200);
    expect((await call(ios, 'POST', { token: t2, spot: SPOT })).code).toBe(429);
    expect(iosRec(t2)).toBeFalsy();
    expect((await call(ios, 'POST', { token: t3, spot: SPOT }, '5.6.7.8')).code).toBe(200);
  });

  it('POST {spot:{off:true}} (what the shipped app can send) disarms the watch, even right after arming', async () => {
    await call(ios, 'POST', { token: TOKEN, spot: SPOT });
    const out = await call(ios, 'POST', { token: TOKEN, spot: { off: true } });
    expect(out.code).toBe(200);
    expect(out.body.off).toBe(true);
    expect(iosRec().spot).toBe(null);
  });

  it('DELETE {token} disarms too; an unknown token stores nothing; a bad token is still rejected', async () => {
    await call(ios, 'POST', { token: TOKEN, spot: SPOT });
    expect((await call(ios, 'DELETE', { token: TOKEN.toUpperCase() })).code).toBe(200);
    expect(iosRec().spot).toBe(null);
    expect((await call(ios, 'DELETE', { token: 'cd'.repeat(32) })).code).toBe(200);
    expect(iosRec('cd'.repeat(32))).toBeFalsy();
    expect((await call(ios, 'DELETE', { token: 'nope' })).code).toBe(400);
  });
});

describe('off → on for the same sweep keeps the de-dupe (no repeat of a push already sent)', () => {
  const sent = { lead: SPOT.nextSweepISO };
  it('web: DELETE then POST', async () => {
    await call(web, 'POST', { subscription: SUB, spot: SPOT });
    mem['curb:subs'][SUB.endpoint] = JSON.stringify({ ...webRec(), notified: sent });
    await call(web, 'DELETE', { subscription: SUB });
    expect(webRec().notified).toEqual(sent);
    expect((await call(web, 'POST', { subscription: SUB, spot: SPOT })).code).toBe(200);
    expect(webRec()).toMatchObject({ notified: sent, spot: { nextSweepISO: SPOT.nextSweepISO } });
  });

  it('iOS: {spot:{off:true}} then POST, never throttled as a new token', async () => {
    await call(ios, 'POST', { token: TOKEN, spot: SPOT });
    mem['curb:apns'][TOKEN] = JSON.stringify({ ...iosRec(), notified: sent });
    await call(ios, 'POST', { token: TOKEN, spot: { off: true } });
    expect(iosRec().notified).toEqual(sent);
    expect((await call(ios, 'POST', { token: TOKEN, spot: SPOT })).code).toBe(200);
    expect(iosRec()).toMatchObject({ notified: sent, spot: { nextSweepISO: SPOT.nextSweepISO } });
  });
});

describe('multi-watch: one device, up to 5 curb sides (GitHub #11)', () => {
  const OTHER = { ...SPOT, cnn: '123', sideKey: 'South', blockside: 'South' };   // the other side of the block
  const side = (s) => ({ cnn: s.cnn, sideKey: s.sideKey, corridor: s.corridor, limits: s.limits || '', blockside: s.blockside || '' });
  const iosW = (n) => mem['curb:apns'] && mem['curb:apns'][TOKEN + (n ? '#' + n : '')] && JSON.parse(mem['curb:apns'][TOKEN + (n ? '#' + n : '')]);
  // What the shipped app POSTs (builds 6 and 7 alike): it builds the body, but the spot is the page's object, untouched.
  const app = (spot, method = 'POST') => call(ios, method, { token: TOKEN, platform: 'ios', bundleId: 'guide.curb.ios', spot });

  it('web: a second side adds a watch, the same side updates in place, and Turn off names one side', async () => {
    expect((await call(web, 'POST', { subscription: SUB, spot: SPOT })).code).toBe(200);
    expect((await call(web, 'POST', { subscription: SUB, spot: OTHER })).code).toBe(200);
    expect((await call(web, 'POST', { subscription: SUB, spot: { ...OTHER, level: 'light' } })).code).toBe(200);
    expect(Object.keys(mem['curb:subs'])).toEqual([SUB.endpoint, SUB.endpoint + '#1']);
    expect(webRec(1).spot).toMatchObject({ sideKey: 'South', level: 'light' });
    expect((await call(web, 'DELETE', { subscription: SUB, spot: side(OTHER) })).code).toBe(200);
    expect(webRec(1).spot).toBe(null);
    expect(webRec().spot).toMatchObject({ sideKey: 'North' });              // the other watch stays on
    expect((await call(web, 'DELETE', { subscription: { ...SUB, keys: { ...SUB.keys, auth: 'guess' } }, spot: side(SPOT) })).code).toBe(403);
    expect(webRec().spot).toMatchObject({ sideKey: 'North' });
    expect((await call(web, 'DELETE', { subscription: SUB })).code).toBe(200); // no side (an old page): every watch off
    expect(webRec().spot).toBe(null);
  });

  it('web: a 6th side gets 409 with a clear error and stores nothing', async () => {
    for (let i = 0; i < 5; i++) expect((await call(web, 'POST', { subscription: SUB, spot: { ...SPOT, cnn: String(200 + i) } })).code).toBe(200);
    const before = JSON.stringify(mem['curb:subs']);
    const out = await call(web, 'POST', { subscription: SUB, spot: { ...SPOT, cnn: '999' } });
    expect(out.code).toBe(409);
    expect(out.body).toEqual({ error: 'alert limit reached', max: 5 });
    expect(JSON.stringify(mem['curb:subs'])).toBe(before);
  });

  it('web: the owner proof is revealed for the device once, not again for its second watch', async () => {
    const first = await call(web, 'POST', { subscription: SUB, spot: SPOT });
    expect(typeof first.body.ownerProof).toBe('string');
    const second = await call(web, 'POST', { subscription: SUB, spot: OTHER });
    expect(second.body.ownerProof).toBe(undefined);
  });

  it('web: an endpoint with a "#" (the store\'s watch separator) is refused', async () => {
    const sub = { ...SUB, endpoint: SUB.endpoint + '#1' };
    expect((await call(web, 'POST', { subscription: sub, spot: SPOT })).code).toBe(400);
    expect((await call(web, 'DELETE', { subscription: sub })).code).toBe(400);
    expect(mem['curb:subs']).toBe(undefined);
  });

  it('iOS, through the shipped app\'s body: two sides, Turn off of one side, {off:true} for all, and the cap', async () => {
    expect((await app(SPOT)).code).toBe(200);
    expect((await app(OTHER)).code).toBe(200);
    expect((await app({ ...OTHER, voice: 'drill' })).code).toBe(200);
    expect([iosW(0).spot.sideKey, iosW(1).spot.sideKey, iosW(1).spot.voice]).toEqual(['North', 'South', 'drill']);
    expect(iosW(2)).toBeFalsy();
    expect((await app({ off: true, ...side(OTHER) })).body).toEqual({ ok: true, off: true });
    expect(iosW(1).spot).toBe(null);
    expect(iosW(0).spot).toMatchObject({ sideKey: 'North' });
    expect((await app({ off: true })).code).toBe(200);                     // a page from before multi-watch
    expect(iosW(0).spot).toBe(null);
    for (let i = 0; i < 5; i++) expect((await app({ ...SPOT, cnn: String(300 + i) })).code).toBe(200);
    const full = await app({ ...SPOT, cnn: '999' });
    expect(full.code).toBe(409);
    expect(full.body.error).toBe('alert limit reached');                   // the app hands `error` to the page
    expect((await call(ios, 'DELETE', { token: TOKEN, spot: side({ ...SPOT, cnn: '300' }) })).code).toBe(200);
    expect(Object.values(mem['curb:apns']).map((v) => JSON.parse(v).spot && JSON.parse(v).spot.cnn).filter(Boolean).sort()).toEqual(['301', '302', '303', '304']);
  });
});
