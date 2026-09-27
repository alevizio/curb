// Tests for the production monitor: the alert-issue state machine (alert.mjs) and the smoke checks
// (smoke.mjs) against mocked fetch — including a replay of the Sep 2026 DataSF host move.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decide, signature, lastSig, withSig } from './alert.mjs';
import { parsePage, checkDataSF, checkBasemap, checkPages, checkAlertsSender, judgeAlertsStatus, ALERTS_MAX_AGE_MIN, lit, digest, checkErrorSpike, REPORT_KINDS, isBreakage } from './smoke.mjs';
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

// The digest and the spike check count only breakage; a visitor's own choices (blocked location, a coarse
// fix, a notification denial) and device conditions stay in the log as informational counts.
describe('error log: breakage vs. the visitor\'s own choices', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const rep = (k, msg, n) => Array.from({ length: n }, () => ({ k, msg }));
  const log = (reports) => group(reports.map((r, i) => normalize(r, UA, now - (i + 1) * 1000)), 0);
  const run = async (fn, reports) => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'x';
    try { return await fn(mockFetch({ 'https://curb.guide/api/client-error': { status: 200, body: log(reports) } }), now); }
    finally { if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev; }
  };
  // Message formats exactly as index.html's curbReport calls build them.
  const ROUTINE = [
    ...rep('event:locate-failed', 'code 1 User denied Geolocation', 30),                   // Chrome / Safari
    ...rep('event:locate-failed', 'code 1 User denied geolocation prompt', 5),             // Firefox
    ...rep('event:locate-failed', 'code 1 Location permission is off for CURB.', 5),       // the iOS app
    ...rep('event:locate-failed', 'code 3 after retry Timeout expired', 4),
    ...rep('event:locate-failed', 'code 2 after retry Location is unavailable.', 3),
    ...rep('event:locate-failed', 'unsupported', 3),
    ...rep('event:locate-coarse', 'reduced ±3km', 5),
    ...rep('event:locate-coarse', '±150m', 5),
    ...rep('event:push-save-failed', 'ios denied-settings', 3),
    ...rep('event:push-save-failed', 'refresh fail:denied', 3),
  ];

  it('every kind index.html reports is classified', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const kinds = new Set([...html.matchAll(/curbReport\('([a-z0-9-]+)'/g)].map((m) => 'event:' + m[1]));
    for (const m of html.matchAll(/send\('(error|rejection)'/g)) kinds.add(m[1]);
    expect(kinds.size).toBeGreaterThanOrEqual(8); // error, rejection + 6 curbReport kinds (Sep 2026)
    for (const k of kinds) expect(Object.keys(REPORT_KINDS), `add ${k} to REPORT_KINDS in smoke.mjs`).toContain(k);
  });

  it('classifies breakage vs. choices, and counts an unknown kind as breakage', () => {
    const b = (k, msg) => isBreakage({ k, msg });
    expect(b('error', "TypeError: x is undefined")).toBe(true);
    expect(b('rejection', 'Load failed')).toBe(true);
    expect(b('event:data-load', 'HTTP 503')).toBe(true);
    expect(b('event:block-open-timeout', 'link')).toBe(true);
    expect(b('event:push-save-failed', 'ios save-failed:429 slow down')).toBe(true);
    expect(b('event:push-save-failed', 'ios unknown')).toBe(true);
    expect(b('event:push-off-failed', 'web HTTP 500')).toBe(true);
    expect(b('event:push-off-failed', 'ios denied')).toBe(false);
    expect(b('event:push-save-failed', 'web permission-denied')).toBe(false);
    expect(b('event:locate-failed', 'code 1 Geolocation has been disabled in this document by permissions policy.')).toBe(true);
    expect(b('event:locate-failed', 'code 1 Origin does not have permission to use Geolocation service')).toBe(true);
    expect(b('event:locate-failed', 'code 1 User denied Geolocation')).toBe(false);
    expect(b('event:locate-failed', 'code 3 Timeout expired')).toBe(false);
    expect(b('event:locate-coarse', '±2km')).toBe(false);
    expect(b('event:something-new', 'x')).toBe(true);
  });

  it('REPLAY INT-2/PD-2: a day of denied, failed and coarse locates keeps the digest green, with the counts shown', async () => {
    const out = await run(digest, ROUTINE);
    expect(out.map((r) => r.status)).toEqual(['ok']);
    expect(out[0].detail).toContain('0 errors in 24h');
    expect(out[0].detail).toContain('+66 informational');
    expect(out[0].detail).toContain('event:locate-failed');
  });

  it('a code 1 from a permissions policy (our header broke) still fails the digest, informational counts ride along', async () => {
    const out = await run(digest, [...ROUTINE, ...rep('event:locate-failed', 'code 1 Geolocation has been disabled in this document by permissions policy.', 4)]);
    expect(out.map((r) => r.status)).toEqual(['fail', 'ok']);
    expect(out[0].name).toContain('permissions policy');
    expect(out[1].detail).toContain('+66 informational');
  });

  it('real breakage kinds each fail the digest', async () => {
    const out = await run(digest, [
      ...ROUTINE,
      ...rep('error', "TypeError: Cannot read properties of undefined (reading 'lat')", 3),
      ...rep('rejection', 'Load failed', 3),
      ...rep('event:data-load', 'HTTP 503', 3),
      ...rep('event:block-open-timeout', 'locate', 3),
      ...rep('event:push-save-failed', 'ios save-failed:429 slow down', 3),
      ...rep('event:push-off-failed', 'web HTTP 500', 3),
    ]);
    expect(out.filter((r) => r.status === 'fail').map((r) => r.name.split(' `')[0]).sort()).toEqual([
      'error: error', 'error: event:block-open-timeout', 'error: event:data-load', 'error: event:push-off-failed',
      'error: event:push-save-failed', 'error: rejection',
    ]);
  });

  it('REPLAY PD-3: a burst of routine locates never trips the spike check; 25 real errors do', async () => {
    const quiet = await run(checkErrorSpike, ROUTINE);
    expect(quiet.status).toBe('ok');
    expect(quiet.detail).toMatch(/^0 errors in the last 35 min \(\+66 informational/);
    const loud = await run(checkErrorSpike, [...ROUTINE, ...rep('event:data-load', 'Load failed', 25)]);
    expect(loud.status).toBe('fail');
    expect(loud.detail).toMatch(/^25 errors from real users/);
    expect(loud.detail).not.toContain('locate');
  });
});
