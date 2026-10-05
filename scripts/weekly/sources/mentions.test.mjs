// Tests for the weekly mentions section (mentions.mjs): the parsers against trimmed copies of real
// responses (HN's June 2026 Show HN, Reddit's search feed, Google News RSS, Product Hunt GraphQL), the
// "does this mean the app" rule, and collect() end to end on a mocked fetch (no network).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { reportWeek } from '../week.mjs';
import { collect, parseHN, parseRedditFeed, parseGoogleNews, parsePH, mergeItems, refersToCurb, excerpt, cleanUrl, plain } from './mentions.mjs';

const JUNE = reportWeek(Date.parse('2026-06-24T15:07:00Z'));   // Jun 17 to 23: the Show HN week
const LAUNCH = reportWeek(Date.parse('2026-10-14T15:07:00Z')); // Oct 7 to 13: the Product Hunt launch week
const NOW = Date.parse('2026-10-14T15:07:00Z');

// The real Show HN hit (Algolia, Oct 2026), minus _highlightResult.
const SHOW_HN = {
  _tags: ['story', 'author_alevizio', 'story_48572693', 'show_hn'], author: 'alevizio', children: [48572713],
  created_at: '2026-06-17T16:22:55Z', created_at_i: 1781713375, num_comments: 0, objectID: '48572693', points: 1,
  story_id: 48572693, title: 'Show HN: I matched 650k SF parking tickets to the block each was written on',
  updated_at: '2026-06-17T19:58:40Z', url: 'https://curb.guide/',
};
const at = (iso) => Math.floor(Date.parse(iso) / 1000);
const HN_COMMENT = {
  _tags: ['comment', 'author_someone'], author: 'someone', objectID: '49000001', story_id: 48999999,
  story_title: 'Ask HN: What are you working on? (October 2026)', story_url: null, points: null,
  created_at: '2026-10-09T18:00:00Z', created_at_i: at('2026-10-09T18:00:00Z'),
  comment_text: 'I use <a href="https:&#x2F;&#x2F;curb.guide&#x2F;">https:&#x2F;&#x2F;curb.guide&#x2F;</a> every week, it&#x27;s great &amp; free.',
};
const HN_JUNK = {
  _tags: ['comment'], author: 'x', objectID: '49000002', story_title: 'Parking in SF', created_at_i: at('2026-10-10T18:00:00Z'),
  comment_text: 'In San Francisco you must curb your wheels when parking on a hill.',
};

const redditEntry = ({ title, link, published, sub, user, content }) => `<entry><author><name>/u/${user}</name><uri>https://www.reddit.com/user/${user}</uri></author><category term="${sub}" label="r/${sub}"/><content type="html">${content}</content><id>t3_x</id><link href="${link}" /><updated>${published}</updated><published>${published}</published><title>${title}</title></entry>`;
const REDDIT_REAL = redditEntry({
  title: 'SF street-cleaning signs say a 2-hour window. I matched 650k tickets back to their blocks',
  link: 'https://www.reddit.com/r/sanfrancisco/comments/1u8er2e/sf_streetcleaning_signs_say_a_2hour_window_i/',
  published: '2026-10-08T16:17:54+00:00', sub: 'sanfrancisco', user: 'viziomas',
  content: '&lt;div class=&quot;md&quot;&gt;&lt;p&gt;I&amp;#39;ve paid enough street-cleaning tickets to get curious. Map: &lt;a href=&quot;https://curb.guide&quot;&gt;curb.guide&lt;/a&gt;&lt;/p&gt;&lt;/div&gt;',
});
const REDDIT_JUNK = redditEntry({
  title: 'AQWWHY 2 Pack Heavy Duty Rubber Parking Blocks Curb Guide Car Garage Wheel Stop',
  link: 'https://www.reddit.com/r/Gadgetchoice/comments/hihwxi/aqwwhy/', published: '2026-10-09T06:34:16+00:00',
  sub: 'Gadgetchoice', user: 'seller', content: '&lt;p&gt;Curb guide for your garage&lt;/p&gt;',
});
const feed = (...entries) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>reddit.com: search results</title>${entries.join('')}</feed>`;

const newsItem = (title, source, date, id) => `<item><title>${title} - ${source}</title><link>https://news.google.com/rss/articles/${id}?oc=5</link><guid isPermaLink="false">${id}</guid><pubDate>${date}</pubDate><description>&lt;a href="x"&gt;${title}&lt;/a&gt;</description><source url="https://example.com">${source}</source></item>`;
const NEWS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>${[
  newsItem('CURB, a free SF street sweeping map, launches on Product Hunt', 'SFist', 'Fri, 09 Oct 2026 14:00:00 GMT', 'A1'),
  newsItem('Massachusetts Moves to Curb Rising Wrong-Way Driving Deaths', 'newbedfordguide.com', 'Fri, 09 Oct 2026 14:00:00 GMT', 'A2'),
  newsItem('SF: MTA CUTS FINE FOR DRIVERS WHO FAIL TO CURB WHEELS ON A HILL WHEN PARKING', 'SFGATE', 'Sat, 10 Oct 2026 14:00:00 GMT', 'A3'),
  newsItem('New SF parking app reveals the secrets of street sweeping enforcers', 'SFGATE', 'Sat, 10 Oct 2026 15:00:00 GMT', 'A4'),
].join('')}</channel></rss>`;

const PH_POST = {
  name: 'CURB', tagline: 'Free SF parking map that shows when tickets actually land',
  url: 'https://www.producthunt.com/products/curb-6?launch=curb-7&utm_campaign=producthunt-api&utm_medium=api-v2&utm_source=Application%3A+Some+App',
  votesCount: 312, commentsCount: 41, dailyRank: 3, weeklyRank: 11, featuredAt: '2026-10-07T07:01:00Z', createdAt: '2026-10-07T07:01:00Z',
  comments: { edges: [
    { node: { body: 'Love   this,\nthe ticket times are wild', createdAt: '2026-10-07T15:00:00Z', user: { name: '[REDACTED]' } } },
    { node: { body: 'Congrats on the launch!', createdAt: '2026-10-07T09:00:00Z', user: { name: 'Jane Maker' } } },
    { node: { body: 'Late to the party', createdAt: '2026-10-15T09:00:00Z', user: { name: '[REDACTED]' } } },
  ] },
};

// Minimal fetch mock: handler(url, opts) → { status, body } | undefined (404).
function mockFetch(handler) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = (await handler(url, opts)) || { status: 404, body: '' };
    return {
      status: r.status, ok: r.status >= 200 && r.status < 300,
      json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  f.calls = calls;
  return f;
}
const hnBody = (hits, nbHits = hits.length) => ({ hits, nbHits });
function routes({ hn, hnAll = 7, reddit = { status: 200, body: feed(REDDIT_REAL, REDDIT_JUNK) }, news = { status: 200, body: NEWS }, ph = { status: 200, body: { data: { post: PH_POST } } } } = {}) {
  return (url) => {
    if (url.startsWith('https://hn.algolia.com/')) {
      const p = new URL(url).searchParams;
      if (p.get('hitsPerPage') === '0') return { status: 200, body: hnBody([], hnAll) };
      if (hn?.status) return hn;
      return { status: 200, body: hnBody(p.get('query') === 'curb.guide' ? (hn || [HN_COMMENT]) : [HN_JUNK, HN_COMMENT]) };
    }
    if (url.startsWith('https://www.reddit.com/search.rss')) return reddit;
    if (url.startsWith('https://news.google.com/rss/search')) return news;
    if (url.startsWith('https://api.producthunt.com/')) return ph;
  };
}

describe('refersToCurb: only text that means the app', () => {
  it('accepts the domain and the capitalized name next to a parking word', () => {
    expect(refersToCurb('see https://curb.guide/b/123')).toBe(true);
    expect(refersToCurb('<a href="https:&#x2F;&#x2F;curb.guide">x</a>')).toBe(true);
    expect(refersToCurb('CURB, a free SF street sweeping map')).toBe(true);
    expect(refersToCurb('I use the CURB app for parking')).toBe(true);
  });
  it('rejects the everyday word, all-caps headlines and an unrelated CURB', () => {
    expect(refersToCurb('Massachusetts Moves to Curb Rising Wrong-Way Driving Deaths')).toBe(false);
    expect(refersToCurb('curb your wheels when parking on a hill')).toBe(false);
    expect(refersToCurb('SF: MTA CUTS FINE FOR DRIVERS WHO FAIL TO CURB WHEELS WHEN PARKING')).toBe(false);
    expect(refersToCurb('Rubber Parking Blocks Curb Guide')).toBe(false);
    expect(refersToCurb('Senate passes the CURB Act on drug prices')).toBe(false);
    expect(refersToCurb('curb.guidebook')).toBe(false);
  });
});

describe('parsers', () => {
  it('parseHN reads the real June 2026 Show HN', () => {
    expect(parseHN(hnBody([SHOW_HN]))).toEqual([{
      source: 'Hacker News', title: SHOW_HN.title, url: 'https://news.ycombinator.com/item?id=48572693',
      date: '2026-06-17T16:22:55.000Z', points: 1, comments: 0, by: 'alevizio',
    }]);
  });
  it('parseHN turns comments into readable items and drops hits that do not mean the app', () => {
    const items = parseHN(hnBody([HN_JUNK, HN_COMMENT]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Comment on "Ask HN: What are you working on? (October 2026)"', url: 'https://news.ycombinator.com/item?id=49000001', by: 'someone' });
    expect(items[0].snippet).toBe("I use https://curb.guide/ every week, it's great & free.");
    expect(parseHN({})).toEqual([]);
  });
  it('parseRedditFeed keeps only posts that contain curb.guide, as plain text', () => {
    const items = parseRedditFeed(feed(REDDIT_REAL, REDDIT_JUNK));
    expect(items).toEqual([{
      source: 'Reddit', title: 'SF street-cleaning signs say a 2-hour window. I matched 650k tickets back to their blocks',
      url: 'https://www.reddit.com/r/sanfrancisco/comments/1u8er2e/sf_streetcleaning_signs_say_a_2hour_window_i/',
      date: '2026-10-08T16:17:54.000Z', snippet: "I've paid enough street-cleaning tickets to get curious. Map: curb.guide", by: 'viziomas', where: 'r/sanfrancisco',
    }]);
    expect(parseRedditFeed('<html>blocked</html>')).toEqual([]);
  });
  it('parseGoogleNews keeps headlines that name CURB and moves the outlet to where', () => {
    expect(parseGoogleNews(NEWS)).toEqual([{
      source: 'Google News', title: 'CURB, a free SF street sweeping map, launches on Product Hunt',
      url: 'https://news.google.com/rss/articles/A1?oc=5', date: '2026-10-09T14:00:00.000Z', where: 'SFist',
    }]);
  });
  it('parsePH: totals now, utm tags dropped, redacted names hidden, only the week\'s comments, newest first', () => {
    const { block, item } = parsePH(PH_POST, LAUNCH, NOW);
    expect(block).toEqual({
      name: 'CURB', tagline: PH_POST.tagline, url: 'https://www.producthunt.com/products/curb-6?launch=curb-7',
      votes: 312, comments: 41, dailyRank: 3, weeklyRank: 11, featuredAt: '2026-10-07T07:01:00Z',
      launchedAt: '2026-10-07T07:01:00Z', asOf: '2026-10-14T15:07:00.000Z',
      recentComments: [
        { author: null, body: 'Love this, the ticket times are wild', date: '2026-10-07T15:00:00Z' },
        { author: 'Jane Maker', body: 'Congrats on the launch!', date: '2026-10-07T09:00:00Z' },
      ],
    });
    expect(item).toEqual({ source: 'Product Hunt', title: `CURB: ${PH_POST.tagline}`, url: block.url, date: '2026-10-07T07:01:00Z', points: 312, comments: 41 });
  });
  it('parsePH: a launch outside the week is no item, a missing post is null', () => {
    expect(parsePH(PH_POST, JUNE, NOW).item).toBeNull();
    expect(parsePH(PH_POST, JUNE, NOW).block.recentComments).toEqual([]);
    expect(parsePH(null, LAUNCH, NOW)).toEqual({ block: null, item: null });
  });
  it('mergeItems trims to the week, dedupes by url and sorts newest first', () => {
    const a = { url: 'u1', date: '2026-10-08T00:00:00Z' };
    const b = { url: 'u2', date: '2026-10-12T00:00:00Z' };
    const out = mergeItems([[a, b], [{ ...a, title: 'dup' }, { url: 'old', date: '2026-10-01T00:00:00Z' }, { url: 'next', date: '2026-10-14T08:00:00Z' }]], LAUNCH);
    expect(out).toEqual([b, a]);
  });
  it('excerpt centers on the mention and helpers clean text and urls', () => {
    const long = `${'a'.repeat(300)} try curb.guide now ${'b'.repeat(300)}`;
    const e = excerpt(long, 40);
    expect(e).toContain('curb.guide');
    expect(e.startsWith('…') && e.endsWith('…')).toBe(true);
    expect(plain('<p>a&nbsp;&amp;<br>b</p>')).toBe('a & b');
    expect(plain('bad &#99999999; entity &#x1F697;')).toBe('bad &#99999999; entity 🚗');
    expect(cleanUrl('https://x.com/p?launch=1&utm_source=y')).toBe('https://x.com/p?launch=1');
  });
});

describe('collect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns every source in the section shape, using only ctx.fetch', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('global fetch used'); });
    const f = mockFetch(routes());
    const s = await collect({ week: LAUNCH, env: { PH_TOKEN: 'tok-secret' }, fetch: f, now: NOW });
    expect(s.items.map((i) => i.source)).toEqual(['Hacker News', 'Google News', 'Reddit', 'Product Hunt']);
    expect(new Set(s.items.map((i) => i.url)).size).toBe(4); // the HN comment came back from both queries
    expect(s.producthunt).toMatchObject({ name: 'CURB', votes: 312, recentComments: [{ author: null }, { author: 'Jane Maker' }] });
    expect(s.allTime).toEqual({ hackerNews: 7, reddit: 1 });
    expect(s).not.toHaveProperty('reddit');
    expect(s).not.toHaveProperty('hackerNews');
    expect(s).not.toHaveProperty('googleNews');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('asks each API the right question', async () => {
    const f = mockFetch(routes());
    await collect({ week: LAUNCH, env: { PH_TOKEN: 'tok-secret' }, fetch: f, now: NOW });
    const hn = f.calls.filter((c) => c.url.startsWith('https://hn.algolia.com/')).map((c) => new URL(c.url).searchParams);
    expect(hn.map((p) => p.get('query')).sort()).toEqual(['CURB parking San Francisco', 'curb.guide', 'curb.guide']);
    expect(hn.find((p) => p.get('numericFilters')).get('numericFilters'))
      .toBe(`created_at_i>=${LAUNCH.start / 1000},created_at_i<${LAUNCH.end / 1000}`);
    const reddit = f.calls.filter((c) => c.url.includes('reddit.com'));
    expect(reddit).toHaveLength(1); // anonymous limit is about one request a minute
    expect(new URL(reddit[0].url).searchParams.get('q')).toBe('url:curb.guide OR "curb.guide"');
    expect(reddit[0].opts.headers['user-agent']).toMatch(/curb-weekly-report/);
    const news = f.calls.filter((c) => c.url.includes('news.google.com')).map((c) => new URL(c.url).searchParams.get('q'));
    expect(news).toHaveLength(2);
    for (const q of news) expect(q).toMatch(/ after:2026-10-06 before:2026-10-14$/);
    const ph = f.calls.find((c) => c.url.startsWith('https://api.producthunt.com/'));
    expect(ph.opts.method).toBe('POST');
    expect(ph.opts.headers.authorization).toBe('Bearer tok-secret');
    expect(JSON.parse(ph.opts.body).variables).toEqual({ slug: 'curb-7' });
  });

  it('finds the June 2026 Show HN in its week', async () => {
    const f = mockFetch(routes({ hn: [SHOW_HN], reddit: { status: 200, body: feed() }, ph: { status: 200, body: { data: { post: null } } } }));
    const s = await collect({ week: JUNE, env: { PH_TOKEN: 't' }, fetch: f, now: NOW });
    expect(s.items).toEqual([expect.objectContaining({ source: 'Hacker News', title: SHOW_HN.title, points: 1 })]);
    expect(s.producthunt).toBeNull();
  });

  it('Reddit 403, 429 or an HTML block page is { blocked: true }, never a failure', async () => {
    for (const reddit of [{ status: 403, body: '' }, { status: 429, body: '' }, { status: 200, body: '<!doctype html><title>Blocked</title>' }]) {
      const s = await collect({ week: LAUNCH, env: {}, fetch: mockFetch(routes({ reddit })), now: NOW });
      expect(s.reddit).toEqual({ blocked: true });
      expect(s.items.some((i) => i.source === 'Hacker News')).toBe(true);
      expect(s.allTime).not.toHaveProperty('reddit');
    }
  });

  it('one source failing is an error on that source, the rest still reports', async () => {
    const f = mockFetch(routes({ hn: { status: 500, body: '' }, news: { status: 503, body: '' }, reddit: { status: 502, body: '' } }));
    const s = await collect({ week: LAUNCH, env: { PH_TOKEN: 't' }, fetch: f, now: NOW });
    expect(s.hackerNews).toEqual({ error: 'Algolia HTTP 500' });
    expect(s.googleNews).toEqual({ error: 'Google News HTTP 503' });
    expect(s.reddit).toEqual({ error: 'Reddit HTTP 502' });
    expect(s.items).toEqual([expect.objectContaining({ source: 'Product Hunt' })]);
  });

  it('Product Hunt: no token → skipped without a call; HTTP and GraphQL errors stay on producthunt, without the token', async () => {
    const f = mockFetch(routes());
    const s = await collect({ week: LAUNCH, env: {}, fetch: f, now: NOW });
    expect(s.producthunt).toEqual({ skipped: 'missing PH_TOKEN' });
    expect(f.calls.some((c) => c.url.includes('producthunt'))).toBe(false);

    const s401 = await collect({ week: LAUNCH, env: { PH_TOKEN: 'tok-secret' }, fetch: mockFetch(routes({ ph: { status: 401, body: { error: 'invalid_oauth_token' } } })), now: NOW });
    expect(s401.producthunt).toEqual({ error: 'Product Hunt HTTP 401' });
    const sGql = await collect({ week: LAUNCH, env: { PH_TOKEN: 'tok-secret' }, fetch: mockFetch(routes({ ph: { status: 200, body: { errors: [{ message: 'Field x does not exist' }] } } })), now: NOW });
    expect(sGql.producthunt).toEqual({ error: 'Product Hunt API: Field x does not exist' });
    expect(JSON.stringify([s401, sGql])).not.toContain('tok-secret');
  });

  it('throws when nothing worked at all', async () => {
    const f = mockFetch(routes({ hn: { status: 500, body: '' }, news: { status: 500, body: '' }, reddit: { status: 403, body: '' } }));
    await expect(collect({ week: LAUNCH, env: {}, fetch: f, now: NOW })).rejects.toThrow(/every mention source failed: Algolia HTTP 500; Google News HTTP 500/);
  });
});
