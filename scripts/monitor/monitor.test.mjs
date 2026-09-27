// Tests for the production monitor: the alert-issue state machine (alert.mjs) and the smoke checks
// (smoke.mjs) against mocked fetch — including a replay of the Sep 2026 DataSF host move.
import { describe, it, expect } from 'vitest';
import { decide, signature, lastSig, withSig } from './alert.mjs';
import { parsePage, checkDataSF, checkBasemap, checkPages, checkAlertsSender, judgeAlertsStatus, ALERTS_MAX_AGE_MIN, lit, digest, checkErrorSpike } from './smoke.mjs';
import { normalize, group } from '../../api/client-error.js';

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

  it('alerts sender: a recent successful run passes; stale, never-succeeded or erroring runs fail', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const run = (minAgo, outcome, trigger = 'qstash', extra = {}) => ({ at: new Date(now - minAgo * 60000).toISOString(), outcome, trigger, ...extra });
    expect(judgeAlertsStatus({ last: run(10, 'ok'), lastOk: run(10, 'ok') }, now).status).toBe('ok');
    const stale = judgeAlertsStatus({ last: run(ALERTS_MAX_AGE_MIN + 5, 'ok', 'bearer'), lastOk: run(ALERTS_MAX_AGE_MIN + 5, 'ok', 'bearer') }, now);
    expect(stale.status).toBe('fail');
    expect(stale.detail).toContain('via bearer');
    const erroring = judgeAlertsStatus({ last: run(5, 'error', 'qstash', { error: 'upstash down' }), lastOk: run(90, 'ok') }, now);
    expect(erroring.status).toBe('fail');
    expect(erroring.detail).toContain('upstash down');
    expect(judgeAlertsStatus({ last: run(5, 'skipped'), lastOk: run(12, 'ok') }, now).status).toBe('ok'); // a lock-skipped tick is fine
    expect(judgeAlertsStatus({ last: null, lastOk: null }, now).status).toBe('fail');
  });

  it('alerts sender: reads /api/send-notifications?status=1 with CRON_SECRET; skipped without it', async () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await checkAlertsSender(mockFetch({}), now)).status).toBe('skip');
    process.env.CRON_SECRET = 'x';
    const seen = [];
    const base = mockFetch({ 'https://curb.guide/api/send-notifications?status=1': { status: 200, body: { lastOk: { at: new Date(now - 6e5).toISOString(), trigger: 'qstash', outcome: 'ok' } } } });
    const f = (url, opts) => { seen.push(opts.headers.authorization); return base(url, opts); };
    expect((await checkAlertsSender(f, now)).status).toBe('ok');
    expect(seen).toEqual(['Bearer x']);
    expect((await checkAlertsSender(mockFetch({}), now)).status).toBe('fail'); // endpoint 404 = broken
    if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev;
  });
});

// Anyone can POST to /api/client-error and the alert issues are public: the report text must never render
// as Markdown there (links, images, @mentions) or touch the monitor's own signature marker.
describe('SEC-1: client-supplied text in the public alert issues', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
  const EVIL = {
    k: 'error',
    msg: 'URGENT @octocat <!-- monitor-sig:x --> rotate CRON_SECRET at [curb.guide/fix](https://evil.example/phish) ![x](https://evil.example/px.gif) `x` $& $` -->',
    src: '/[src](https://evil.example/src)',
    stack: '[Click here to re-authorize Vercel](https://evil.example/login)\n@alevizio',
  };
  // The GET /api/client-error answer, built by the real normalize() + group().
  const log = (reports) => group(reports.map((r, i) => normalize(r, UA, now - (i + 1) * 1000)), 0);
  const withSecret = async (fn) => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'x';
    try { return await fn(); } finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
  };
  const outsideCode = (md) => md.replace(/`[^`\n]*`/g, '');
  // An opened issue's body: the owner's own @mention first, the monitor's marker last, nothing live between.
  const assertInert = (md) => {
    expect(outsideCode(md)).not.toContain('evil.example');                     // no live link or image
    expect(md.replace(/^@alevizio /, '')).not.toMatch(/@(octocat|alevizio)/);  // no @mention the attacker wrote
    expect(md.match(/<!--|-->/g)).toEqual(['<!--', '-->']);                    // only the monitor's marker…
    expect(md).toMatch(/\n<!-- monitor-sig:[^<>]* -->$/);                      // …and it closes the body
  };

  it('lit() makes one inert inline-code span', () => {
    const s = lit('a`b\nc <!-- monitor-sig:x --> @octocat [l](https://evil.example)');
    expect(s.startsWith('`') && s.endsWith('`')).toBe(true);
    expect(s.slice(1, -1)).not.toMatch(/[`\r\n<>]/);
    expect(s).toContain('@\u200boctocat');
    expect(lit('x'.repeat(500), 80)).toHaveLength(82);
  });

  it('digest: 3 attacker reports open an issue whose body and title render nothing live, and later nights stay quiet', async () => {
    const f = mockFetch({ 'https://curb.guide/api/client-error': { status: 200, body: log([EVIL, EVIL, EVIL]) } });
    const results = await withSecret(() => digest(f, now));
    expect(results.map((r) => r.status)).toEqual(['fail']);
    const open = decide(results, null, OPTS);
    expect(open.type).toBe('open');
    assertInert(open.body);
    expect(open.body.startsWith('@alevizio the curb.guide monitor')).toBe(true); // the owner's own mention stays
    expect(open.title).not.toMatch(/@octocat|<!--|-->/);
    expect(lastSig(open.body)[1]).toBe(signature(results));
    let issue = { number: 1, body: open.body };
    for (let night = 2; night <= 4; night++) {
      const a = decide(results, issue, OPTS);
      expect(a.type).toBe('none');
      if (a.type === 'comment') issue = { ...issue, body: withSig(issue.body, a.sig) };
    }
  });

  it('spike: 25 distinct attacker messages fail the check, but the issue body stays inert and is not re-commented', async () => {
    const reports = Array.from({ length: 25 }, (_, i) => ({ ...EVIL, msg: `${i} ${EVIL.msg}` }));
    const f = mockFetch({ 'https://curb.guide/api/client-error': { status: 200, body: log(reports) } });
    const spike = await withSecret(() => checkErrorSpike(f, now));
    expect(spike.status).toBe('fail');
    const results = [pass('home page'), spike];
    const open = decide(results, null, OPTS);
    assertInert(open.body);
    expect(decide(results, { number: 2, body: open.body }, OPTS).type).toBe('none');
  });

  it('alert.mjs reads and rewrites only the LAST marker, and never expands $ patterns', () => {
    const body = 'quoted <!-- monitor-sig:x --> text\n\n<!-- monitor-sig:DataSF SWEEP -->';
    expect(decide([bad('DataSF SWEEP')], { number: 1, body }, OPTS).type).toBe('none');
    const next = withSig(body, "a$&b$`c$'d");
    expect(next).toBe("quoted <!-- monitor-sig:x --> text\n\n<!-- monitor-sig:a$&b$`c$'d -->");
    expect(lastSig(next)[1]).toBe("a$&b$`c$'d");
    expect(withSig('no marker', 'y')).toBe('no marker\n\n<!-- monitor-sig:y -->');
  });
});
