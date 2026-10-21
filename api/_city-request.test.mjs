// Tests for "Request a city" (api/city-request.js) with an in-memory Upstash mock: the checks, the honeypot, the per-IP and
// hourly limits, the capped list, and the bearer GET the issue filer reads (no emails unless asked).
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.KV_REST_API_URL = 'https://fake.upstash.io';
process.env.KV_REST_API_TOKEN = 'fake-token';
process.env.CRON_SECRET = 'test-secret';

const lists = {};
const kv = {};
const ttl = {};
const cmds = { n: 0 };
vi.mock('@upstash/redis', () => ({
  Redis: class {
    async lpush(k, v) { cmds.n++; (lists[k] || (lists[k] = [])).unshift(v); return lists[k].length; }
    async ltrim(k, a, b) { cmds.n++; if (lists[k]) lists[k] = lists[k].slice(a, b + 1); }
    async lrange(k, a, b) { cmds.n++; return (lists[k] || []).slice(a, b + 1); }
    async incr(k) { cmds.n++; kv[k] = (kv[k] || 0) + 1; return kv[k]; }
    async expire() { cmds.n++; return 1; }
    async set(k, v, opts) {
      cmds.n++;
      if (opts && opts.nx && (k in kv) && !(ttl[k] <= Date.now())) return null;
      kv[k] = v; if (opts && opts.px) ttl[k] = Date.now() + opts.px;
      return 'OK';
    }
  },
}));

const { default: handler, validate, cleanLink } = await import('./city-request.js');

vi.useFakeTimers({ toFake: ['Date'] });
let clock = Date.parse('2026-10-20T12:00:00Z');
const later = (ms) => vi.setSystemTime(clock += ms);
const stored = () => (lists['curb:cityreq'] || []).map((e) => (typeof e === 'string' ? JSON.parse(e) : e));

function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = () => res;
  return res;
}
const post = (body, ip = '1.2.3.4', type = 'application/json') => ({ method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': type, 'x-forwarded-for': ip }, query: {} });
const GOOD = { city: 'Portland', region: 'Oregon', publishes: 'yes', link: 'https://www.portland.gov/transportation/street-cleaning', email: 'me@example.com', website: '' };
const run = async (req) => { const res = mockRes(); await handler(req, res); return res; };

beforeEach(() => {
  for (const o of [lists, kv, ttl]) for (const k of Object.keys(o)) delete o[k];
  cmds.n = 0;
  later(3600e3);   // a new hour and past every per-IP minute
});

describe('validate', () => {
  it('keeps a good request, tidied: whitespace collapsed, the link normalized', () => {
    expect(validate({ ...GOOD, city: '  Portland ', region: 'Oregon  ' })).toEqual({ entry: { city: 'Portland', region: 'Oregon', publishes: 'yes',
      link: 'https://www.portland.gov/transportation/street-cleaning', email: 'me@example.com' } });
    expect(validate({ city: 'Saint   Louis' }).entry).toEqual({ city: 'Saint Louis', region: '', publishes: 'unsure', link: '' });
  });
  it('takes place names in any script, with accents and basic punctuation', () => {
    for (const city of ['Montréal', 'São Paulo', "Coeur d'Alene", 'Winston-Salem', 'St. Louis', 'Zürich', 'Québec', 'O’Fallon', 'Washington, DC', 'Kraków', '東京'])
      expect(validate({ city }).entry?.city, city).toBe(city);
  });
  it('turns away names with digits, mentions, links, markup or nothing but punctuation', () => {
    for (const city of ['', ' ', 'X', '29 Palms', '@alevizio', '#12', '[x](https://spam.example)', '<b>Paris</b>', '`rm`', '-Paris', "'", 'a'.repeat(61), 'Paris!', 'Paris/Lyon'])
      expect(validate({ city }).error, city).toBe('city');
    expect(validate({ city: 'Paris', region: 'Île-de-France' }).entry.region).toBe('Île-de-France');
    expect(validate({ city: 'Paris', region: 'zone 1' }).error).toBe('region');
    expect(validate({ city: 'Paris', region: 'r'.repeat(61) }).error).toBe('region');
  });
  it('the answer is yes, no or not sure (not sure when missing)', () => {
    expect(validate({ city: 'Paris', publishes: 'no' }).entry.publishes).toBe('no');
    expect(validate({ city: 'Paris' }).entry.publishes).toBe('unsure');
    expect(validate({ city: 'Paris', publishes: 'maybe' }).error).toBe('publishes');
  });
  it('a link is https only, to a public host, with nothing that could break out of the issue\'s code span', () => {
    expect(cleanLink('https://data.city.gov/sweeping?x=1#map')).toBe('https://data.city.gov/sweeping?x=1#map');
    expect(cleanLink('https://Data.City.GOV')).toBe('https://data.city.gov/');
    for (const bad of ['http://data.city.gov', 'javascript:alert(1)', 'ftp://x.org/a', 'https://user:pw@x.org', 'https://1.2.3.4/x', 'https://localhost/x',
      'https://intranet/x', 'https://x.org/a b', 'https://x.org/?q=`x`', 'https://x.org/' + 'a'.repeat(300), 'https://x.org:8443/', 'data.city.gov'])
      expect(cleanLink(bad), bad).toBe(null);
    expect(validate({ city: 'Paris', link: 'http://x.org' }).error).toBe('link');
    expect(validate({ city: 'Paris', link: '   ' }).entry.link).toBe('');
  });
  it('an email is optional, checked and length-capped', () => {
    expect(validate({ city: 'Paris' }).entry).not.toHaveProperty('email');
    expect(validate({ city: 'Paris', email: 'not-an-email' }).error).toBe('email');
    expect(validate({ city: 'Paris', email: 'a@b' }).error).toBe('email');
    expect(validate({ city: 'Paris', email: 'x'.repeat(250) + '@b.co' }).error).toBe('email');
  });
  it('a filled honeypot is spam; anything but an object is no request', () => {
    expect(validate({ ...GOOD, website: 'https://seo.example' })).toEqual({ spam: true });
    for (const b of [null, 'city=Paris', [], 7]) expect(validate(b).error).toBe('body');
  });
});

describe('POST', () => {
  it('stores the request with an id and the time, never the IP, and answers 200', async () => {
    const res = await run(post(GOOD, '9.9.9.9'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [e] = stored();
    expect(e).toMatchObject({ city: 'Portland', region: 'Oregon', publishes: 'yes', email: 'me@example.com', ts: clock });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(lists) + JSON.stringify(kv)).not.toContain('9.9.9.9');
  });
  it('names the field to fix, and a mistake doesn\'t use up the minute', async () => {
    const bad = await run(post({ ...GOOD, link: 'http://insecure.example' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatchObject({ error: 'link', field: 'link' });
    expect((await run(post(GOOD))).statusCode).toBe(200);
  });
  it('a filled honeypot looks accepted, stores nothing and spends no Redis command', async () => {
    const res = await run(post({ ...GOOD, website: 'buy now' }));
    expect(res.statusCode).toBe(200);
    expect(stored()).toEqual([]);
    expect(cmds.n).toBe(0);
  });
  it('on a preview deployment a good request looks accepted and nothing is stored; mistakes still say so', async () => {
    process.env.VERCEL_ENV = 'preview';
    try {
      expect((await run(post(GOOD))).body).toEqual({ ok: true });
      expect(stored()).toEqual([]);
      expect(cmds.n).toBe(0);
      expect((await run(post({ ...GOOD, city: '' }))).body.field).toBe('city');
    } finally { delete process.env.VERCEL_ENV; }
  });
  it('one request a minute per IP, across instances; others are not held up', async () => {
    expect((await run(post(GOOD, '5.5.5.5'))).statusCode).toBe(200);
    const again = await run(post({ ...GOOD, city: 'Eugene' }, '5.5.5.5'));
    expect(again.statusCode).toBe(429);
    expect(again.body.error).toBe('rate');
    expect((await run(post({ ...GOOD, city: 'Salem' }, '6.6.6.6'))).statusCode).toBe(200);
    vi.resetModules();   // a second serverless instance: fresh memory, same Upstash
    const { default: other } = await import('./city-request.js');
    const res = mockRes(); await other(post({ ...GOOD, city: 'Bend' }, '5.5.5.5'), res);
    expect(res.statusCode).toBe(429);
    later(60000);
    const res2 = mockRes(); await other(post({ ...GOOD, city: 'Bend' }, '5.5.5.5'), res2);
    expect(res2.statusCode).toBe(200);
    expect(stored().map((e) => e.city)).toEqual(['Bend', 'Salem', 'Portland']);
  });
  it('a global cap of 60 an hour', async () => {
    for (let i = 0; i < 60; i++) expect((await run(post(GOOD, '10.0.0.' + i))).statusCode).toBe(200);
    const over = await run(post(GOOD, '10.0.1.1'));
    expect(over.statusCode).toBe(429);
    expect(over.body.error).toBe('busy');
    later(3600e3);
    expect((await run(post(GOOD, '10.0.1.2'))).statusCode).toBe(200);
  });
  it('keeps the newest 1,000', async () => {
    lists['curb:cityreq'] = Array.from({ length: 1000 }, (_, i) => JSON.stringify({ id: 'old' + i, ts: 1, city: 'Old' }));
    await run(post(GOOD));
    expect(lists['curb:cityreq']).toHaveLength(1000);
    expect(stored()[0].city).toBe('Portland');
  });
  it('turns away oversized or broken bodies and other methods', async () => {
    expect((await run(post('x'.repeat(5000)))).statusCode).toBe(400);
    expect((await run(post('{nope'))).statusCode).toBe(400);
    expect((await run({ method: 'PUT', headers: {}, query: {} })).statusCode).toBe(405);
  });
  it('a form posted without JavaScript goes back to the form', async () => {
    const ok = await run(post('city=Portland&region=Oregon&publishes=no&link=&email=&website=', '7.7.7.7', 'application/x-www-form-urlencoded'));
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('/cities?request=sent#request');
    expect(stored()[0]).toMatchObject({ city: 'Portland', publishes: 'no' });
    const bad = await run(post('city=%40spam&publishes=no', '7.7.7.8', 'application/x-www-form-urlencoded'));
    expect(bad.headers.location).toBe('/cities?request=check#request');
  });
});

describe('GET (the issue filer)', () => {
  it('needs the cron secret', async () => {
    expect((await run({ method: 'GET', headers: {}, query: {} })).statusCode).toBe(401);
    expect((await run({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: {} })).statusCode).toBe(401);
  });
  it('returns the requests since a time, oldest first, without emails unless asked', async () => {
    await run(post({ ...GOOD, city: 'Portland' }, '1.1.1.1'));
    const t1 = clock; later(1000);
    await run(post({ ...GOOD, city: 'Tacoma', email: '' }, '1.1.1.2'));
    later(1000);
    await run(post({ ...GOOD, city: 'Boise' }, '1.1.1.3'));
    const res = await run({ method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: { since: String(t1) } });
    expect(res.statusCode).toBe(200);
    expect(res.body.requests.map((r) => r.city)).toEqual(['Tacoma', 'Boise']);
    expect(JSON.stringify(res.body)).not.toContain('@');
    const all = await run({ method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: { since: '0', emails: '1' } });
    expect(all.body.requests.map((r) => r.email || '')).toEqual(['me@example.com', '', 'me@example.com']);
  });
});

describe('without a store', () => {
  it('says requests are closed instead of pretending', async () => {
    vi.resetModules();
    const saved = process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_URL;
    try {
      const { default: bare } = await import('./city-request.js');
      const res = mockRes(); await bare(post(GOOD, '8.8.8.8'), res);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('store');
    } finally { process.env.KV_REST_API_URL = saved; vi.resetModules(); }
  });
});
