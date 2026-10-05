// Handler tests for api/parked.js (auto-park from an iOS Shortcut): the car keeps ONE watch of its own
// (car: true) that follows it from park to park, never a side the user armed on the page, and a device with
// 5 sides armed and no car watch yet is told so instead of getting an "Alerts armed" push that isn't true.
import { describe, it, expect, beforeEach, vi } from 'vitest';

Object.assign(process.env, { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'fake', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' });
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
    async eval(script, [k], [f, expected, next]) { if (!(mem[k] && mem[k][f] === expected)) return 0; mem[k][f] = next; return 1; }
  },
}));
const push = vi.fn(async () => ({ statusCode: 201 }));
vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, sendNotification: (...a) => push(...a) } }));
// DataSF answers with one swept block through the parked point (Haight St, north side, Wednesdays 8-10).
const LAT = 37.77, LNG = -122.45;
const ROW = { cnn: '111', corridor: 'Haight St', limits: 'Cole St - Clayton St', blockside: 'North', cnnrightleft: 'R', weekday: 'Wed',
  fromhour: '8', tohour: '10', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0',
  line: { type: 'LineString', coordinates: [[LNG - 0.001, LAT], [LNG + 0.001, LAT]] } };
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [ROW] })));

const { default: parked } = await import('./parked.js');
const { saveSub, saveToken } = await import('./_store.js');

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/car', keys: { p256dh: 'p', auth: 'a' } };
const TOKEN = 'shortcut-token';
const RULE = { weekday: 'Tue', fromhour: '9', tohour: '11', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
const side = (cnn) => ({ corridor: 'Page St', limits: 'A - B', blockside: 'South', nextSweepISO: new Date(Date.now() + 3 * 864e5).toISOString(), leadMinutes: 30, rule: RULE, rules: [RULE], cnn, sideKey: 'South' });
const park = async () => {
  for (const k of Object.keys(kv)) delete kv[k];      // the 1/min rate slot
  const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await parked({ method: 'POST', body: { token: TOKEN, lat: LAT, lng: LNG } }, r);
  return r;
};
const w = (n = 0) => JSON.parse(mem['curb:subs'][SUB.endpoint + (n ? '#' + n : '')]);

beforeEach(async () => {
  for (const o of [mem, kv]) for (const k of Object.keys(o)) delete o[k];
  push.mockClear();
  await saveToken(TOKEN, SUB.endpoint);
});

describe('auto-park', () => {
  it('arms a watch of the car\'s own and leaves the sides the user armed alone', async () => {
    await saveSub(SUB, side('1')); await saveSub(SUB, side('2'));
    const out = await park();
    expect(out.code).toBe(200);
    expect(w(2)).toMatchObject({ car: true, spot: { cnn: '111', blockside: 'North' } });
    expect([w(0).spot.cnn, w(1).spot.cnn]).toEqual(['1', '2']);   // watch 0 is the user's, not the car's
    expect(push).toHaveBeenCalledTimes(1);
    await park();                                                   // parked again: the same watch, no pile-up
    expect(Object.keys(mem['curb:subs'])).toHaveLength(3);
  });

  it('5 sides armed and no car watch: 409, nothing overwritten, no "Alerts armed" push', async () => {
    for (const c of ['1', '2', '3', '4', '5']) await saveSub(SUB, side(c));
    const before = JSON.stringify(mem['curb:subs']);
    const out = await park();
    expect(out.code).toBe(409);
    expect(out.body).toEqual({ ok: false, error: 'alert limit reached', max: 5 });
    expect(JSON.stringify(mem['curb:subs'])).toBe(before);
    expect(push).not.toHaveBeenCalled();
  });
});
