// Tests for the weekly report's iPhone app source (app.mjs): iTunes lookup, App Store Connect reviews
// and daily Summary Sales reports (real gzipped TSV fixtures), all against a mocked fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { collect, parseLookup, summarizeReviews, kindOf, parseTsv, tallyDay, inflate, judge404, summarizeSales, LOOKUP_URL, SALES_VERSION } from './app.mjs';
import { reportWeek } from '../week.mjs';

const APP = '6780998238';
const API = 'https://api.appstoreconnect.apple.com/v1';
const NOW = Date.parse('2026-10-07T15:07:00Z'); // Wed Oct 7, 8:07 AM PDT: the week is Sep 30 to Oct 6
const WEEK = reportWeek(NOW);
const VENDOR = '87654321';
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const ENV = {
  ASC_ISSUER_ID: 'iss-reviews', ASC_KEY_ID: 'REVKEY', ASC_KEY_P8: P8,
  ASC_SALES_KEY_ID: 'SALESKEY', ASC_SALES_KEY_P8: Buffer.from(P8).toString('base64'), ASC_VENDOR_NUMBER: VENDOR,
};

// ---- fixtures in Apple's formats ----

// The live lookup's shape (fields trimmed; values from the real answer on Oct 5 2026)
const LOOKUP = { resultCount: 1, results: [{
  trackId: 6780998238, trackName: 'CURB: SF Street Parking', version: '1.0.3', currentVersionReleaseDate: '2026-10-04T12:05:17Z',
  averageUserRating: 5, userRatingCount: 6, trackViewUrl: 'https://apps.apple.com/us/app/curb-sf-street-parking/id6780998238?uo=4',
}] };

const review = (id, rating, createdDate, replied = false) => ({
  type: 'customerReviews', id,
  attributes: { rating, title: `Title ${id}`, body: `Body ${id} <b>`, territory: 'USA', createdDate },
  relationships: { response: { data: replied ? { type: 'customerReviewResponses', id: `resp-${id}` } : null } },
});
const response = (id) => ({ type: 'customerReviewResponses', id: `resp-${id}`, attributes: { responseBody: 'Thanks', state: 'PUBLISHED' },
  relationships: { review: { data: { type: 'customerReviews', id } } } });
// newest first, like ?sort=-createdDate; Apple's createdDate carries a -07:00 offset
const PAGE = {
  data: [
    review('f', 4, '2026-10-07T07:30:00-07:00'),        // after the week (Wed morning)
    review('a', 5, '2026-10-05T10:00:00-07:00'),
    review('b', 2, '2026-10-02T21:30:00-07:00'),        // answered: the reply is only in `included`
    review('c', 1, '2026-09-30T00:10:00-07:00'),        // first minutes of the week, unanswered
    review('d', 3, '2026-09-29T23:50:00-07:00'),        // the evening before the week, unanswered
    review('g', 2, '2026-09-20T09:00:00-07:00', true),  // answered (response linkage)
    review('e', 1, '2026-09-01T12:00:00-07:00'),        // older than 30 days
  ],
  included: [response('b'), response('g')],
  links: { self: `${API}/apps/${APP}/customerReviews` },
};

const HEAD = ['Provider', 'Provider Country', 'SKU', 'Developer', 'Title', 'Version', 'Product Type Identifier', 'Units', 'Developer Proceeds',
  'Begin Date', 'End Date', 'Customer Currency', 'Country Code', 'Currency of Proceeds', 'Apple Identifier', 'Customer Price', 'Promo Code',
  'Parent Identifier', 'Subscription', 'Period', 'Category', 'CMB', 'Device', 'Supported Platforms', 'Proceeds Reason', 'Preserved Pricing', 'Client', 'Order Type'];
const us = (day) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
const row = (day, type, units, country, appId = APP) => ['APPLE', 'US', 'curb-ios', 'CURB', 'CURB: SF Street Parking', '1.0.3', type, String(units), '0',
  us(day), us(day), country === 'US' ? 'USD' : 'EUR', country, 'USD', appId, '0', '', '', '', '', 'Navigation', '', 'iPhone', 'iOS', '', '', '', ''];
const tsv = (rows) => [HEAD, ...rows].map((r) => r.join('\t')).join('\n') + '\n';
const gz = (rows) => gzipSync(Buffer.from(tsv(rows)));

const NO_SALES = { errors: [{ id: 'x1', status: '404', code: 'NOT_FOUND', title: 'The specified resource does not exist', detail: 'There were no sales for the date specified.' }] };
const NOT_YET = { errors: [{ id: 'x2', status: '404', code: 'NOT_FOUND', title: 'The specified resource does not exist',
  detail: 'Report is not available yet. Daily reports for the Americas are available by 5 am Pacific Time; Japan, Australia, and New Zealand by 5 am Japan Standard Time; and 5 am Central European Time for all other territories.' }] };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gzRes = (rows) => new Response(gz(rows), { status: 200, headers: { 'content-type': 'application/a-gzip' } });

// This week: Sep 30 to Oct 5 published (Oct 2 without sales), Oct 6 not out yet at 8:07 AM.
const SALES = {
  '2026-09-30': [row('2026-09-30', '1', 3, 'US'), row('2026-09-30', '1F', 1, 'US'), row('2026-09-30', '1', 1, 'CA'), row('2026-09-30', '3', 2, 'US'),
    row('2026-09-30', '7', 10, 'US'), row('2026-09-30', 'IA1', 5, 'US'), row('2026-09-30', '1', 100, 'US', '1111111111')],
  '2026-10-01': [row('2026-10-01', '1', 2, 'US'), row('2026-10-01', '1', 2, 'GB'), row('2026-10-01', '7', 4, 'US'), row('2026-10-01', 'F7', 1, 'US')],
  '2026-10-02': 404,
  '2026-10-03': [row('2026-10-03', '1', 1, 'DE'), row('2026-10-03', '1T', 1, 'FR'), row('2026-10-03', 'F1', 1, 'JP'), row('2026-10-03', '3F', 1, 'US'), row('2026-10-03', '7T', 2, 'US')],
  '2026-10-04': [row('2026-10-04', '1', 4, 'US'), row('2026-10-04', '1', -1, 'US'), row('2026-10-04', '1', 1, 'AU')],
  '2026-10-05': [row('2026-10-05', '1', 1, 'US')],
  '2026-10-06': 'not-yet',
};
for (const day of WEEK.prevDays) SALES[day] = [row(day, '1', 2, 'US'), row(day, '7', 1, 'US')];

const salesFrom = (table) => (day) => {
  const v = table[day];
  return v === 404 ? json(NO_SALES, 404) : v === 'not-yet' ? json(NOT_YET, 404) : typeof v === 'number' ? json({ errors: [{ status: String(v) }] }, v) : gzRes(v);
};

/** Routes the three hosts; records every call and the most sales requests in flight at once. */
function mockFetch({ lookup = () => json(LOOKUP), reviews = () => json(PAGE), sales = salesFrom(SALES) } = {}) {
  let inflight = 0;
  const f = async (url, opts = {}) => {
    f.calls.push({ url, headers: opts.headers || {} });
    if (url.startsWith('https://itunes.apple.com/lookup')) return lookup(url);
    if (url.startsWith(`${API}/apps/${APP}/customerReviews`)) return reviews(url);
    if (url.startsWith(`${API}/salesReports?`)) {
      inflight++; f.maxInflight = Math.max(f.maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 2));
      inflight--;
      return sales(new URL(url).searchParams.get('filter[reportDate]'), url);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  f.calls = []; f.maxInflight = 0;
  return f;
}
const ctx = (over = {}) => ({ week: WEEK, env: ENV, now: NOW, fetch: mockFetch(), ...over });
const claims = (auth) => JSON.parse(Buffer.from(auth.replace('Bearer ', '').split('.')[1], 'base64url'));
const kid = (auth) => JSON.parse(Buffer.from(auth.replace('Bearer ', '').split('.')[0], 'base64url')).kid;

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('the global fetch must not be used'); });
  vi.spyOn(console, 'log');
});
afterEach(() => {
  expect(console.log).not.toHaveBeenCalled(); // public Actions logs: no data printed, ever
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- pure parts ----

describe('iTunes lookup', () => {
  it('reads version, release date, rating and a clean store link', () => {
    expect(parseLookup(LOOKUP)).toEqual({
      live: { version: '1.0.3', releasedAt: '2026-10-04T12:05:17Z', url: 'https://apps.apple.com/us/app/curb-sf-street-parking/id6780998238' },
      rating: { average: 5, count: 6 },
    });
  });
  it('an empty answer is a failure, not a blank card', () => {
    expect(() => parseLookup({ resultCount: 0, results: [] })).toThrow('iTunes lookup found no app');
  });
});

describe('sales report parsing', () => {
  it('classifies Apple\'s product type identifiers', () => {
    for (const id of ['1', '1F', '1T', 'F1', '1E', '1EP', '1EU']) expect(kindOf(id)).toBe('downloads');
    for (const id of ['3', '3F']) expect(kindOf(id)).toBe('redownloads');
    for (const id of ['7', '7F', '7T', 'F7']) expect(kindOf(id)).toBe('updates');
    for (const id of ['IA1', 'IAY', 'FI1', 'IA3', '1-B', '', undefined, 'ZZ']) expect(kindOf(id)).toBeNull();
  });
  it('parses the TSV by header name, with a BOM and CRLF line ends', () => {
    const rows = parseTsv('﻿' + tsv([row('2026-10-01', '1', 2, 'GB')]).replace(/\n/g, '\r\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 'Product Type Identifier': '1', Units: '2', 'Country Code': 'GB', 'Apple Identifier': APP, 'Order Type': '' });
    expect(parseTsv('')).toEqual([]);
  });
  it('inflates Apple\'s gzip, and passes an already inflated body through', () => {
    expect(inflate(gz([row('2026-10-01', '1', 2, 'GB')]))).toBe(tsv([row('2026-10-01', '1', 2, 'GB')]));
    expect(inflate(Buffer.from('Provider\tUnits\n'))).toBe('Provider\tUnits\n');
  });
  it('counts only CURB\'s rows, nets refunds and tallies downloads per country', () => {
    expect(tallyDay(parseTsv(inflate(gz(SALES['2026-09-30']))))).toEqual({ downloads: 5, redownloads: 2, updates: 10, countries: { US: 4, CA: 1 } });
    expect(tallyDay(parseTsv(tsv(SALES['2026-10-04'])))).toEqual({ downloads: 4, redownloads: 0, updates: 0, countries: { US: 3, AU: 1 } });
  });
  it('a 404 is "not published yet" until noon PT the next day, or when Apple says so; later it is a day without sales', () => {
    const tue = '2026-10-06';
    expect(judge404(tue, NO_SALES.errors[0].detail, NOW)).toBe('pending');                               // Wed 8:07 AM
    expect(judge404(tue, NO_SALES.errors[0].detail, Date.parse('2026-10-07T19:30:00Z'))).toBe('none');   // Wed 12:30 PM
    expect(judge404('2026-10-02', '', NOW)).toBe('none');
    expect(judge404('2026-10-02', NOT_YET.errors[0].detail, NOW)).toBe('pending');
  });
  it('summarizes partial weeks: published days only, null when nothing is out', () => {
    const s = summarizeSales(WEEK, [{ day: WEEK.days[0], status: 'ok', downloads: 2, redownloads: 0, updates: 1, countries: { US: 2 } }]);
    expect(s).toMatchObject({ downloads: 2, updates: 1, prev: { downloads: null, redownloads: null, updates: null }, asOf: WEEK.days[0], partial: true, daysKnown: 1 });
    expect(s.daily.map((d) => d.downloads)).toEqual([2, null, null, null, null, null, null]);
    expect(s.pending).toHaveLength(13);
    const none = summarizeSales(WEEK, []);
    expect(none).toMatchObject({ downloads: null, prev: { downloads: null }, prevFull: { downloads: null }, partial: true, daysKnown: 0, asOf: null });
  });
  it('compares like for like: a missing Tuesday leaves the Tuesday before out of prev, prevFull keeps all 7', () => {
    const day = (d, downloads, status = 'ok') => ({ day: d, status, downloads, redownloads: 1, updates: 2, countries: {} });
    const prevWeek = WEEK.prevDays.map((d) => day(d, 10));
    const sixDays = [...prevWeek, ...WEEK.days.slice(0, 6).map((d) => day(d, 10)), { day: WEEK.days[6], status: 'pending' }];
    const s = summarizeSales(WEEK, sixDays);
    expect(s).toMatchObject({
      downloads: 60, redownloads: 6, updates: 12,
      prev: { downloads: 60, redownloads: 6, updates: 12 },       // Sep 23 to 28, the same six weekdays
      prevFull: { downloads: 70, redownloads: 7, updates: 14 },   // all of Sep 23 to 29
      partial: true, daysKnown: 6, pending: [WEEK.days[6]],
    });
    // a day without sales is a published day: it counts on both sides
    const withNone = sixDays.map((d) => (d.day === WEEK.days[2] ? { day: d.day, status: 'none', downloads: 0, redownloads: 0, updates: 0, countries: {} } : d));
    expect(summarizeSales(WEEK, withNone)).toMatchObject({ downloads: 50, prev: { downloads: 60 }, daysKnown: 6 });
    // the whole week published: not partial, prev is the full week
    const full = summarizeSales(WEEK, [...prevWeek, ...WEEK.days.map((d) => day(d, 10))]);
    expect(full).toMatchObject({ downloads: 70, prev: { downloads: 70 }, prevFull: { downloads: 70 }, partial: false, daysKnown: 7 });
  });
});

describe('reviews summary', () => {
  it('lists this week\'s reviews with title and text, and counts unanswered low ones from 30 days', () => {
    const { reviews, lowUnanswered } = summarizeReviews(PAGE, WEEK, NOW);
    expect(reviews).toEqual([
      { stars: 5, title: 'Title a', body: 'Body a <b>', territory: 'USA', date: '2026-10-05', createdDate: '2026-10-05T10:00:00-07:00', replied: false },
      { stars: 2, title: 'Title b', body: 'Body b <b>', territory: 'USA', date: '2026-10-02', createdDate: '2026-10-02T21:30:00-07:00', replied: true },
      { stars: 1, title: 'Title c', body: 'Body c <b>', territory: 'USA', date: '2026-09-30', createdDate: '2026-09-30T00:10:00-07:00', replied: false },
    ]);
    expect(lowUnanswered).toBe(2); // c and d; b and g have replies, e is older than 30 days
  });
});

// ---- collect ----

describe('collect', () => {
  it('returns the whole section from all three sources', async () => {
    const f = mockFetch();
    const s = await collect(ctx({ fetch: f }));
    expect(s.live).toEqual({ version: '1.0.3', releasedAt: '2026-10-04T12:05:17Z', url: 'https://apps.apple.com/us/app/curb-sf-street-parking/id6780998238' });
    expect(s.rating).toEqual({ average: 5, count: 6 });
    expect(s.reviews.map((r) => r.title)).toEqual(['Title a', 'Title b', 'Title c']);
    expect(s.lowUnanswered).toBe(2);
    expect(s.downloads).toEqual({
      downloads: 17, redownloads: 3, updates: 17,
      prev: { downloads: 12, redownloads: 0, updates: 6 },       // Sep 23 to 28: Tuesday Oct 6 is not out, so Sep 29 is left out too
      prevFull: { downloads: 14, redownloads: 0, updates: 7 },
      partial: true, daysKnown: 6,
      daily: [
        { date: '2026-09-30', downloads: 5 }, { date: '2026-10-01', downloads: 4 }, { date: '2026-10-02', downloads: 0 },
        { date: '2026-10-03', downloads: 3 }, { date: '2026-10-04', downloads: 4 }, { date: '2026-10-05', downloads: 1 },
        { date: '2026-10-06', downloads: null },
      ],
      countries: [{ country: 'US', downloads: 10 }, { country: 'GB', downloads: 2 }, { country: 'AU', downloads: 1 }, { country: 'CA', downloads: 1 }, { country: 'DE', downloads: 1 }],
      asOf: '2026-10-05',
      pending: ['2026-10-06'],
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(f.calls.some((c) => c.url === LOOKUP_URL)).toBe(true);
  });

  it('asks Apple for one gzipped daily SALES SUMMARY per day, 14 days, at most 3 at once', async () => {
    const f = mockFetch();
    await collect(ctx({ fetch: f }));
    const sales = f.calls.filter((c) => c.url.includes('/salesReports'));
    expect(sales).toHaveLength(14);
    expect(f.maxInflight).toBeLessThanOrEqual(3);
    expect(f.maxInflight).toBeGreaterThan(1);
    const q = new URL(sales[0].url).searchParams;
    expect(Object.fromEntries([...q])).toMatchObject({ 'filter[frequency]': 'DAILY', 'filter[reportType]': 'SALES', 'filter[reportSubType]': 'SUMMARY', 'filter[vendorNumber]': VENDOR, 'filter[version]': SALES_VERSION });
    expect(sales.map((c) => new URL(c.url).searchParams.get('filter[reportDate]')).sort()).toEqual([...WEEK.prevDays, ...WEEK.days]);
    expect(sales[0].headers.accept).toBe('application/a-gzip');
    expect(kid(sales[0].headers.authorization)).toBe('SALESKEY');
    expect(claims(sales[0].headers.authorization)).toMatchObject({ iss: 'iss-reviews', aud: 'appstoreconnect-v1' }); // issuer defaults to ASC_ISSUER_ID
  });

  it('uses ASC_SALES_ISSUER_ID when the sales key lives under another issuer', async () => {
    const f = mockFetch();
    await collect(ctx({ fetch: f, env: { ...ENV, ASC_SALES_ISSUER_ID: 'iss-sales' } }));
    const sale = f.calls.find((c) => c.url.includes('/salesReports'));
    const rev = f.calls.find((c) => c.url.includes('/customerReviews'));
    expect(claims(sale.headers.authorization).iss).toBe('iss-sales');
    expect(claims(rev.headers.authorization).iss).toBe('iss-reviews');
    expect(kid(rev.headers.authorization)).toBe('REVKEY');
  });

  it('asks for the reviews the monitor reads plus title and body, never the nickname', async () => {
    const f = mockFetch();
    await collect(ctx({ fetch: f }));
    const rev = f.calls.find((c) => c.url.includes('/customerReviews'));
    expect(rev.url).toContain(`/v1/apps/${APP}/customerReviews?sort=-createdDate&limit=100&include=response`);
    expect(rev.url).toContain('fields[customerReviews]=rating,title,body,territory,createdDate,response');
    expect(rev.url).not.toContain('reviewerNickname');
  });

  it('follows the next page while it still reaches into the 30 days, and only on Apple\'s host', async () => {
    const p1 = { data: [review('a', 5, '2026-10-05T10:00:00-07:00')], links: { next: `${API}/apps/${APP}/customerReviews?cursor=2` } };
    const p2 = { data: [review('c', 1, '2026-09-30T00:10:00-07:00'), review('e', 1, '2026-08-01T12:00:00-07:00')], links: { next: `${API}/apps/${APP}/customerReviews?cursor=3` } };
    const pages = { [`${API}/apps/${APP}/customerReviews?cursor=2`]: p2 };
    const f = mockFetch({ reviews: (url) => json(pages[url] || p1) });
    const s = await collect(ctx({ fetch: f }));
    expect(f.calls.filter((c) => c.url.includes('/customerReviews'))).toHaveLength(2); // stops: page 2 ends before the window
    expect(s.reviews.map((r) => r.title)).toEqual(['Title a', 'Title c']);
    expect(s.lowUnanswered).toBe(1);

    const evil = mockFetch({ reviews: () => json({ data: [review('a', 5, '2026-10-05T10:00:00-07:00')], links: { next: 'https://example.com/steal' } }) });
    await collect(ctx({ fetch: evil }));
    expect(evil.calls.filter((c) => !c.url.startsWith('https://itunes.apple.com') && !c.url.startsWith(API))).toHaveLength(0);
  });

  it('skips the keyed parts without keys (naming what is missing) and still shows the store card', async () => {
    const f = mockFetch();
    const s = await collect(ctx({ fetch: f, env: {} }));
    expect(s.live.version).toBe('1.0.3');
    expect(s.reviews).toEqual({ skipped: 'missing ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_P8' });
    expect(s.lowUnanswered).toBeNull();
    expect(s.downloads).toEqual({ skipped: 'missing ASC_SALES_KEY_ID, ASC_SALES_KEY_P8, ASC_VENDOR_NUMBER, ASC_SALES_ISSUER_ID (or ASC_ISSUER_ID)' });
    expect(f.calls.map((c) => c.url)).toEqual([LOOKUP_URL]);
  });

  it('downloads need only the sales vars; an empty string counts as unset (GitHub secrets)', async () => {
    const env = { ASC_ISSUER_ID: 'iss', ASC_SALES_KEY_ID: 'SALESKEY', ASC_SALES_KEY_P8: P8, ASC_VENDOR_NUMBER: '' };
    const s = await collect(ctx({ env }));
    expect(s.downloads).toEqual({ skipped: 'missing ASC_VENDOR_NUMBER' });
    expect(s.reviews).toEqual({ skipped: 'missing ASC_KEY_ID, ASC_KEY_P8' });
  });

  it('a sales auth error fails downloads only, readably, without the vendor number or key', async () => {
    const s = await collect(ctx({ fetch: mockFetch({ sales: () => json({ errors: [{ status: '401', code: 'NOT_AUTHORIZED' }] }, 401) }) }));
    expect(s.downloads).toEqual({ error: expect.stringMatching(/^App Store Connect sales HTTP 401 \(sales key id/) });
    expect(s.reviews).toHaveLength(3);
    const s403 = await collect(ctx({ fetch: mockFetch({ sales: () => json({}, 403) }) }));
    expect(s403.downloads.error).toContain('HTTP 403 (the sales key needs the Sales');
    for (const out of [s, s403]) {
      const text = JSON.stringify(out.downloads);
      for (const secret of [VENDOR, 'PRIVATE KEY', ENV.ASC_SALES_KEY_P8.slice(0, 40)]) expect(text).not.toContain(secret);
    }
  });

  it('a 400 shows Apple\'s reason with the vendor number blanked', async () => {
    const detail = `The version parameter you have specified is invalid. The latest version for this report is 1_1. Vendor ${VENDOR}.`;
    const s = await collect(ctx({ fetch: mockFetch({ sales: () => json({ errors: [{ status: '400', code: 'PARAMETER_ERROR.INVALID', detail }] }, 400) }) }));
    expect(s.downloads.error).toBe('App Store Connect sales HTTP 400: The version parameter you have specified is invalid. The latest version for this report is 1_1. Vendor [vendor].');
  });

  it('retries a server blip once, then gives up on that day', async () => {
    let n = 0;
    const blip = mockFetch({ sales: (day) => (day === '2026-10-01' && n++ === 0 ? json({}, 503) : salesFrom(SALES)(day)) });
    expect((await collect(ctx({ fetch: blip }))).downloads.downloads).toBe(17);
    const down = mockFetch({ sales: (day) => (day === '2026-10-01' ? json({}, 503) : salesFrom(SALES)(day)) });
    expect((await collect(ctx({ fetch: down }))).downloads).toEqual({ error: 'App Store Connect sales HTTP 503' });
  });

  it('a .p8 that is not a key fails with its env name, never its text', async () => {
    const s = await collect(ctx({ env: { ...ENV, ASC_SALES_KEY_P8: 'not-a-key-SECRETISH', ASC_KEY_P8: 'nope-SECRETISH' } }));
    expect(s.downloads).toEqual({ error: 'ASC_SALES_KEY_P8 is not a readable .p8 key' });
    expect(s.reviews).toEqual({ error: 'ASC_KEY_P8 is not a readable .p8 key' });
    expect(JSON.stringify(s)).not.toContain('SECRETISH');
  });

  it('a reviews error fails reviews only; lowUnanswered is unknown, not zero', async () => {
    const s = await collect(ctx({ fetch: mockFetch({ reviews: () => json({ errors: [] }, 403) }) }));
    expect(s.reviews).toEqual({ error: expect.stringContaining('App Store Connect reviews HTTP 403') });
    expect(s.lowUnanswered).toBeNull();
    expect(s.downloads.downloads).toBe(17);
    expect(s.live.version).toBe('1.0.3');
  });

  it('a lookup failure marks live and rating, or fails the section when nothing else came back', async () => {
    const down = () => new Response('busy', { status: 503 });
    const s = await collect(ctx({ fetch: mockFetch({ lookup: down }) }));
    expect(s.live).toEqual({ error: 'iTunes lookup HTTP 503' });
    expect(s.rating).toEqual({ error: 'iTunes lookup HTTP 503' });
    expect(s.downloads.downloads).toBe(17);
    await expect(collect(ctx({ env: {}, fetch: mockFetch({ lookup: down }) }))).rejects.toThrow('iTunes lookup HTTP 503');
  });

  it('days that have not ended are pending without a request', async () => {
    const midweek = Date.parse('2026-10-03T18:00:00Z'); // Sat 11 AM: a preview run of a week still in progress
    const f = mockFetch();
    const s = await collect(ctx({ fetch: f, now: midweek }));
    expect(f.calls.filter((c) => c.url.includes('/salesReports')).map((c) => new URL(c.url).searchParams.get('filter[reportDate]'))).not.toContain('2026-10-03');
    expect(s.downloads.pending).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']); // Oct 2: a 404 before noon the next day
    expect(s.downloads.asOf).toBe('2026-10-01');
    expect(s.downloads).toMatchObject({ daysKnown: 2, partial: true, prev: { downloads: 4 }, prevFull: { downloads: 14 } }); // Sep 23 and 24 only
  });
});
