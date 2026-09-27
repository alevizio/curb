// Handler tests for the two save endpoints: the alerts OFF switch (web DELETE proven by endpoint +
// keys.auth; iOS DELETE / POST {spot:{off:true}} by token) and the iOS throttle that used to 429 any
// second save within 60 s (dropping a block switch or an Intensity/Voice change).
import { describe, it, expect, beforeEach, vi } from 'vitest';

Object.assign(process.env, { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'fake' });
const mem = {}, kv = {};
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async hget(k, f) { return mem[k] && mem[k][f]; }
    async hset(k, obj) { (mem[k] || (mem[k] = {})); Object.assign(mem[k], obj); }
    async hdel(k, f) { if (mem[k]) delete mem[k][f]; }
    async hgetall(k) { return mem[k] ? { ...mem[k] } : null; }
    async hexists(k, f) { return mem[k] && f in mem[k] ? 1 : 0; }
    async set(k, v, opts) { if (opts && opts.nx && (k in kv)) return null; kv[k] = v; return 'OK'; }
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
const webRec = () => JSON.parse(mem['curb:subs'][SUB.endpoint]);
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
