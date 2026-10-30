// Handler tests for api/parked-ios.js (the iPhone app's Save Parking Spot and Clear Parking Spot): the car keeps ONE watch
// of its own on the device's APNs token that follows it from park to park, a side the user armed on its sheet is never
// changed (it covers the car instead), Clear turns off only the car's watch, and the coordinates are never stored.
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
    async eval(script, [k], [f, expected, next]) { if (!(mem[k] && mem[k][f] === expected)) return 0; mem[k][f] = next; return 1; }
  },
}));
// DataSF answers with one swept block through the parked point (Haight St, north side, Wednesdays 8-10).
const LAT = 37.7701234, LNG = -122.4501234;
const ROW = { cnn: '111', corridor: 'Haight St', limits: 'Cole St - Clayton St', blockside: 'North', cnnrightleft: 'R', weekday: 'Wed',
  fromhour: '8', tohour: '10', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0',
  line: { type: 'LineString', coordinates: [[LNG - 0.001, LAT], [LNG + 0.001, LAT]] } };
const datasf = vi.fn(async () => ({ ok: true, json: async () => [ROW] }));
vi.stubGlobal('fetch', datasf);

const { default: parkedIos } = await import('./parked-ios.js');
const { saveIosSub } = await import('./_store.js');
const { normLevel, normVoice } = await import('../lib/notify-core.js');

const TOK = 'ab'.repeat(32);
const RULE = { weekday: 'Tue', fromhour: '9', tohour: '11', week1: '1', week2: '1', week3: '1', week4: '1', week5: '1', holidays: '0' };
const side = (cnn, blockside = 'South') => ({ corridor: 'Page St', limits: 'A - B', blockside, nextSweepISO: new Date(Date.now() + 3 * 864e5).toISOString(), leadMinutes: 30, rule: RULE, rules: [RULE], cnn, sideKey: blockside });
const call = async (body, { keepRate = false } = {}) => {
  if (!keepRate) for (const k of Object.keys(kv)) delete kv[k];   // the rate slots
  const r = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await parkedIos({ method: 'POST', headers: {}, body }, r);
  return r;
};
const park = (opts) => call({ token: TOK, lat: LAT, lng: LNG }, opts);
const w = (n = 0) => JSON.parse(mem['curb:apns'][TOK + (n ? '#' + n : '')]);
const fields = () => Object.keys(mem['curb:apns'] || {});

beforeEach(() => {
  for (const o of [mem, kv]) for (const k of Object.keys(o)) delete o[k];
  datasf.mockClear();
});

describe('Save Parking Spot (iPhone app)', () => {
  it('arms a watch of the car\'s own, leaves the sides the user armed alone, and answers with what the app shows', async () => {
    await saveIosSub(TOK, side('1')); await saveIosSub(TOK, side('2'));
    const out = await park();
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ ok: true, covered: false, title: '🚗 Parked', url: '/b/111?side=North',
      spot: { corridor: 'Haight St', limits: 'Cole St - Clayton St', blockside: 'North', cnn: '111', sideKey: 'R' } });
    expect(out.body.body).toMatch(/^Haight St: next sweep Wed 8 ?a?m?\b.*Alerts armed\.$/i);
    expect(w(2)).toMatchObject({ car: true, platform: 'ios', spot: { cnn: '111', blockside: 'North' } });
    expect([w(0).spot.cnn, w(1).spot.cnn]).toEqual(['1', '2']);
    await park();                                                    // parked again: the same watch, no pile-up
    expect(fields()).toHaveLength(3);
  });

  it('a side the user armed covers the car: it stays as it is, and the car\'s watch on the curb it left goes off', async () => {
    await saveIosSub(TOK, side('9'), { atBase: true });              // the car's watch, on the last curb
    await saveIosSub(TOK, side('111', 'North'));                     // the user's own watch on Haight St, north side
    const mine = mem['curb:apns'][TOK + '#1'];
    const out = await park();
    expect(out.code).toBe(200);
    expect(out.body).toMatchObject({ ok: true, covered: true });
    expect(out.body.body).toMatch(/Your alerts are already on here\.$/);
    expect(mem['curb:apns'][TOK + '#1']).toBe(mine);                 // byte for byte
    expect(w(0)).toMatchObject({ car: true, spot: null });           // off, still the car's slot
    expect(fields()).toHaveLength(2);
  });

  it('Clear Parking Spot turns off only the car\'s watch, and the next park writes the same slot', async () => {
    await saveIosSub(TOK, side('1'));
    await park();
    const cleared = await call({ token: TOK, clear: true });
    expect(cleared.code).toBe(200);
    expect(cleared.body).toEqual({ ok: true, cleared: true });
    expect(w(1)).toMatchObject({ car: true, spot: null });
    expect(w(0).spot.cnn).toBe('1');                                 // the user's watch: untouched
    expect((await call({ token: TOK, clear: true })).body).toEqual({ ok: true, cleared: false });
    await park();
    expect(w(1)).toMatchObject({ car: true, spot: { cnn: '111' } });
    expect(fields()).toHaveLength(2);
  });

  it('5 sides armed and no car watch: 409, nothing overwritten', async () => {
    for (const c of ['1', '2', '3', '4', '5']) await saveIosSub(TOK, side(c));
    const before = JSON.stringify(mem['curb:apns']);
    const out = await park();
    expect(out.code).toBe(409);
    expect(out.body).toEqual({ ok: false, error: 'alert limit reached', max: 5 });
    expect(JSON.stringify(mem['curb:apns'])).toBe(before);
  });

  it('refuses a bad token, a spot outside SF, and a second park within the minute', async () => {
    expect((await call({ token: 'nope', lat: LAT, lng: LNG })).code).toBe(400);
    const away = await call({ token: TOK, lat: 40.7, lng: -74 });
    expect(away.code).toBe(400);
    expect(datasf).not.toHaveBeenCalled();
    expect((await park()).code).toBe(200);
    expect((await park({ keepRate: true })).code).toBe(429);
  });

  it('no swept block near the point: says so and stores nothing', async () => {
    datasf.mockImplementationOnce(async () => ({ ok: true, json: async () => [] }));
    const out = await park();
    expect(out.code).toBe(200);
    expect(out.body).toEqual({ ok: false, error: 'no swept block found' });
    expect(fields()).toHaveLength(0);
  });

  it('saves the watch a sheet would: the page\'s Intensity and Voice, known values only', async () => {
    expect((await call({ token: TOK, lat: LAT, lng: LNG, level: 'intense', voice: 'drill' })).code).toBe(200);
    expect(w(0).spot).toMatchObject({ level: 'intense', voice: 'drill', leadMinutes: 30, cnn: '111', sideKey: 'R' });
    await call({ token: TOK, lat: LAT, lng: LNG, level: 'loud', voice: '<b>' });
    expect(w(0).spot).toMatchObject({ level: normLevel(), voice: normVoice() });
  });

  it('never stores the coordinates, only the block', async () => {
    await park();
    const stored = JSON.stringify(mem);
    expect(stored).not.toContain('37.770');
    expect(stored).not.toContain('122.450');
  });
});
