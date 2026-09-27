// Tests for the production monitor: the alert-issue state machine (alert.mjs) and the smoke checks
// (smoke.mjs) against mocked fetch — including a replay of the Sep 2026 DataSF host move.
import { describe, it, expect } from 'vitest';
import { decide, signature } from './alert.mjs';
import { parsePage, checkDataSF, checkBasemap, checkPages, judgeAlertsRuns, ALERTS_MAX_AGE_MIN } from './smoke.mjs';

const OPTS = { title: 'curb.guide is broken', mention: 'alevizio', runUrl: 'https://github.com/x/y/actions/runs/1' };
const pass = (name) => ({ name, status: 'ok', detail: '' });
const bad = (name, detail = 'boom') => ({ name, status: 'fail', detail });

describe('alert state machine', () => {
  it('stays quiet while everything passes and nothing is open', () => {
    expect(decide([pass('a'), pass('b')], null, OPTS)).toEqual({ type: 'none' });
  });
  it('opens one issue (with an @mention) on the first failure', () => {
    const a = decide([pass('a'), bad('DataSF SWEEP', 'HTTP 301')], null, OPTS);
    expect(a.type).toBe('open');
    expect(a.title).toBe('curb.guide is broken: DataSF SWEEP');
    expect(a.body).toContain('@alevizio');
    expect(a.body).toContain('<!-- monitor-sig:DataSF SWEEP -->');
  });
  it('does not re-notify while the same thing stays broken', () => {
    const open = { number: 1, body: 'x <!-- monitor-sig:DataSF SWEEP -->' };
    expect(decide([bad('DataSF SWEEP')], open, OPTS)).toEqual({ type: 'none' });
  });
  it('comments once when what is broken changes', () => {
    const open = { number: 1, body: 'x <!-- monitor-sig:DataSF SWEEP -->' };
    const a = decide([bad('DataSF SWEEP'), bad('basemap tiles')], open, OPTS);
    expect(a.type).toBe('comment');
    expect(a.sig).toBe('DataSF SWEEP|basemap tiles');
  });
  it('closes the issue on recovery', () => {
    const open = { number: 1, body: 'x <!-- monitor-sig:DataSF SWEEP -->' };
    expect(decide([pass('DataSF SWEEP')], open, OPTS).type).toBe('close');
  });
  it('skipped checks never count as failures', () => {
    expect(signature([{ name: 'x', status: 'skip' }, pass('y')])).toBe('');
  });
});

// Minimal fetch mock: route → { status, headers, body }.
function mockFetch(routes) {
  return async (url) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const r = key ? routes[key] : { status: 404 };
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: r.status,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      arrayBuffer: async () => new ArrayBuffer(r.size || 0),
    };
  };
}

describe('smoke checks', () => {
  it('parsePage finds the dataset URLs and the basemap template in index.html', () => {
    const html = '<main id="map"></main><script>const SWEEP="https://data.sf.gov/resource/a.json";const METER="https://data.sf.gov/resource/b.json";const SELF_BASEMAP=\'/basemap/parchment/{z}/{x}/{y}.png\';</script>';
    const p = parsePage(html);
    expect(p.data).toEqual({ SWEEP: 'https://data.sf.gov/resource/a.json', METER: 'https://data.sf.gov/resource/b.json' });
    expect(p.basemap).toBe('/basemap/parchment/{z}/{x}/{y}.png');
    expect(p.hasMap).toBe(true);
  });

  it('REPLAY Sep 2026: the old DataSF host (301, no CORS for curb.guide) fails the check', async () => {
    const f = mockFetch({
      'https://data.sfgov.org/resource/yhqp-riqs.json': { status: 301, headers: { location: 'https://data.sf.gov/resource/yhqp-riqs.json', 'access-control-allow-origin': 'https://data.sfgov.org' } },
    });
    const out = await checkDataSF(f, { SWEEP: 'https://data.sfgov.org/resource/yhqp-riqs.json' });
    expect(out.every((r) => r.status === 'fail')).toBe(true);
    expect(out[0].detail).toContain('301');
  });

  it('a dataset that answers 200 but without CORS for curb.guide fails (browsers would block it)', async () => {
    const f = mockFetch({ 'https://data.sf.gov/resource/a.json': { status: 200, headers: {}, body: [{ x: 1 }] } });
    const [r] = await checkDataSF(f, { METER: 'https://data.sf.gov/resource/a.json' });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('CORS');
  });

  it('a healthy dataset + spatial count passes', async () => {
    const f = mockFetch({
      'https://data.sf.gov/resource/a.json?%24select': { status: 200, headers: { 'access-control-allow-origin': '*' }, body: [{ count: '811' }] },
      'https://data.sf.gov/resource/a.json': { status: 200, headers: { 'access-control-allow-origin': '*' }, body: [{ cnn: '1' }] },
    });
    const out = await checkDataSF(f, { SWEEP: 'https://data.sf.gov/resource/a.json' });
    expect(out.map((r) => r.status)).toEqual(['ok', 'ok']);
  });

  it('basemap: an empty SELF_BASEMAP or a non-image tile fails', async () => {
    expect((await checkBasemap(mockFetch({}), '')).status).toBe('fail');
    const f = mockFetch({ 'https://curb.guide/basemap/': { status: 200, headers: { 'content-type': 'text/html' }, size: 500 } });
    expect((await checkBasemap(f, '/basemap/parchment/{z}/{x}/{y}.png')).status).toBe('fail');
  });

  it('a /b/ block page that 302s home is reported as a DataSF failure affecting all block pages', async () => {
    const f = mockFetch({ 'https://curb.guide/b/': { status: 302, headers: { location: '/' } } });
    const [block] = await checkPages(f);
    expect(block.status).toBe('fail');
    expect(block.detail).toContain('redirects home');
  });

  it('alerts timer: fresh success passes, stale or repeatedly failing runs fail', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const run = (minAgo, conclusion) => ({ status: 'completed', conclusion, updated_at: new Date(now - minAgo * 60000).toISOString(), html_url: 'u' });
    expect(judgeAlertsRuns([run(10, 'success')], now).status).toBe('ok');
    expect(judgeAlertsRuns([run(ALERTS_MAX_AGE_MIN + 5, 'success')], now).status).toBe('fail');
    expect(judgeAlertsRuns([run(10, 'failure'), run(25, 'failure'), run(40, 'success')], now).status).toBe('fail');
    expect(judgeAlertsRuns([run(10, 'failure'), run(25, 'success')], now).status).toBe('ok');
    expect(judgeAlertsRuns([], now).status).toBe('fail');
  });
});
