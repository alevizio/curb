// The "send me a test" endpoint must be unmistakably a test and never make a false day claim, and the
// service worker must keep only act-now pushes on screen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const send = vi.fn(async () => ({ statusCode: 201 }));
vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, sendNotification: (...a) => send(...a) } }));
const { default: handler } = await import('./test-notification.js');

const res = () => ({ code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (body, query = { dryRun: '1' }) => { const r = res(); await handler({ method: 'POST', body, query }, r); return r.body; };
const SAT = Date.parse('2026-10-03T17:00:00Z'); // Sat Oct 3, 10 AM PDT
const TUE9 = '2026-10-06T16:00:00.000Z';        // the user's real next sweep: Tue 9 AM PDT

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(SAT); send.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

describe('test push', () => {
  it('is labelled "Test", names each alert and when it really fires, and makes no false day claim', async () => {
    const { plan } = await call({ which: 'all', level: 'normal', spot: { corridor: 'Haight St', blockside: 'North', nextSweepISO: TUE9 } });
    expect(plan.map((p) => p.title)).toEqual(['Test · Night before (Mon 8 PM)', 'Test · 30 min before (Tue 8:30 AM)']);
    for (const p of plan) expect(p.title).not.toMatch(/today|tomorrow|min — /i);
    expect(plan[0].body).toMatch(/^🧹 Sweep day tomorrow — Haight St \(North\) gets cleaned at 9 AM/);
    expect(plan.every((p) => p.tag.startsWith('curb-test-'))).toBe(true);
  });

  it('replays a night sweep as its single tonight push, at every level', async () => {
    const { plan } = await call({ which: 'all', level: 'intense', spot: { corridor: 'Mission St', nextSweepISO: '2026-10-06T07:00:00.000Z' } });
    expect(plan.map((p) => [p.key, p.title])).toEqual([['tonight', 'Test · Night before (Mon 9 PM)']]);
  });

  it('Intense on a 7 AM sweep previews no 5 AM morning-of (the real sender never sends it)', async () => {
    const { plan } = await call({ which: 'all', level: 'intense', spot: { corridor: 'Kansas St', nextSweepISO: '2026-10-06T14:00:00.000Z' } });
    expect(plan.map((p) => p.title)).toEqual(['Test · Night before (Mon 8 PM)', 'Test · 30 min before (Tue 6:30 AM)']);
  });

  it('with no future sweep, previews a demo sweep tomorrow at 9 AM (round, real-looking times)', async () => {
    const { plan } = await call({ which: 'lead', spot: { nextSweepISO: '2020-01-01T00:00:00Z' } });
    expect(plan[0].title).toBe('Test · 30 min before (Sun 8:30 AM)');
  });

  it('web delivery expires after 5 min instead of the 4-week default', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv';
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };
    await call({ which: 'lead', subscription: sub, spot: { nextSweepISO: TUE9 } }, {});
    expect(send.mock.calls[0][2]).toEqual({ TTL: 300 });
  });
});

describe('sw.js push handler', () => {
  function pushOnce(payload) {
    const listeners = {}, shown = [];
    const self = {
      addEventListener: (t, fn) => { listeners[t] = fn; },
      registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    };
    vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches: {}, clients: {}, location: {}, URL });
    listeners.push({ data: { json: () => payload }, waitUntil: () => {} });
    return shown[0].opts;
  }
  it('keeps lead / tonight on screen, lets night-before, morning-of and tests go', () => {
    expect(pushOnce({ title: 'x', tag: 'curb-sweep', requireInteraction: true }).requireInteraction).toBe(true);
    expect(pushOnce({ title: 'x', tag: 'curb-sweep-eve', requireInteraction: false }).requireInteraction).toBe(false);
    expect(pushOnce({ title: 'x', tag: 'curb-test-lead' }).requireInteraction).toBe(false);
  });
});
