// Tests for the weekly email (render.mjs + charts.mjs): the fixture renders whole and small enough for
// Gmail, every cid has its image, outside strings are escaped, only http(s) links survive, the "needs
// you" rules fire one by one, and skipped or failed sections degrade to one quiet line.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderEmail, needsYou, notConnected, failedCount, failures, headline, change, safeUrl, esc, num, pct, undash, MAX_HTML_BYTES } from './render.mjs';
import { barChartSvg, dayLabel, align, CHART_HEIGHT } from './charts.mjs';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/sample-report.json', import.meta.url), 'utf8'));
const png = (b) => ({ sig: b.subarray(1, 4).toString('latin1'), w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
// visible copy only: drop tags, style blocks and attribute values so CSS and URLs do not count
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe('renderEmail with the sample report', () => {
  let out;
  beforeAll(async () => { out = await renderEmail(fixture()); });

  it('subject, a 1200 px chart per series and the logo, all inline', () => {
    expect(out.subject).toBe('CURB this week: Oct 7 to 13');
    expect(out.images.map((i) => i.cid).sort()).toEqual(['clicks@curb.guide', 'logo@curb.guide', 'visitors@curb.guide']);
    for (const im of out.images) {
      expect(im.type).toBe('image/png');
      expect(png(im.data).sig).toBe('PNG');
    }
    expect(png(out.images.find((i) => i.cid === 'visitors@curb.guide').data).w).toBe(1200);
    expect(png(out.images.find((i) => i.cid === 'clicks@curb.guide').data).w).toBe(1200);
    // every cid the HTML points at has an image, and every image is used
    const used = [...out.html.matchAll(/src="cid:([^"]+)"/g)].map((m) => m[1]).sort();
    expect(used).toEqual(out.images.map((i) => i.cid).sort());
  });

  it('stays under the Gmail clip limit with no scripts and no remote images', () => {
    expect(Buffer.byteLength(out.html)).toBeLessThan(MAX_HTML_BYTES);
    expect(out.html).not.toMatch(/<script/i);
    expect(out.html).not.toMatch(/<img[^>]+src="(?!cid:)/i);
    expect(out.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(out.html).toContain('@media (prefers-color-scheme:dark)');
    expect(out.html).toContain('max-width:600px');
  });

  it('copy has no em or en dashes and nothing is italic', () => {
    for (const s of [visible(out.html), out.text, out.subject]) expect(s).not.toMatch(/[–—]/);
    expect(out.html).not.toMatch(/<(i|em)\b|font-style:\s*italic/i);
  });

  it('headline numbers, status and sections are there, with thousands separators', () => {
    expect(out.html).toContain('3 things need you');
    for (const n of ['1,940', '312', '184', '137', '9,840', '12,253']) expect(out.html).toContain(n);
    for (const s of ['Visits', 'Search', 'iPhone app', 'Alerts and errors', 'Shipped this week', 'Issues and monitors', 'Mentions', 'Data', 'Needs you', 'The week in short']) {
      expect(out.html).toContain(`>${s}</span>`);
    }
    expect(out.html).toContain('ship harfbuzzjs hb.wasm with the og function');
    expect(out.html).toContain('No reply yet');
    expect(out.html).toContain('Sent every Wednesday at 8 AM by GitHub Actions (scripts/weekly)');
  });

  it('the text version carries the same key numbers', () => {
    expect(out.text).toMatch(/Visitors:\s+1,940\s+up 64%, from 1,180/);
    expect(out.text).toMatch(/Google clicks:\s+312\s+up 16%/);
    expect(out.text).toMatch(/App downloads:\s+184/);
    expect(out.text).toMatch(/Alert sign-ups:\s+137\s+71 web, 66 iPhone/);
    expect(out.text).toContain('NEEDS YOU');
    expect(out.text).toContain('https://github.com/alevizio/curb/issues/47');
    expect(out.text).not.toMatch(/<[a-z]/i);
  });
});

describe('preview and degraded weeks', () => {
  it('a preview says so in the subject', async () => {
    const r = fixture(); r.preview = true;
    const out = await renderEmail(r);
    expect(out.subject).toBe('Preview: CURB this week: Oct 7 to 13');
    expect(out.html).toContain('Preview sent by hand');
  });

  it('skipped sections say "Not connected yet", a failed one gives its reason, and the footer lists what to connect', async () => {
    const r = fixture();
    for (const k of ['search', 'app', 'appAnalytics', 'mentions', 'claude']) r.sections[k] = { skipped: `missing ${k.toUpperCase()}_KEY` };
    r.sections.service = { error: 'Upstash HTTP 503' };
    const out = await renderEmail(r);
    expect(out.html).toContain('Not connected yet.');
    expect(out.html).toContain('Could not load this week: Upstash HTTP 503');
    expect(out.html).toMatch(/Not connected yet:<\/b> Search \(missing SEARCH_KEY\), iPhone app/);
    expect(out.images.map((i) => i.cid)).not.toContain('clicks@curb.guide');
    expect(out.html).not.toContain('cid:clicks@curb.guide');
    expect(out.text).toContain('Could not load this week: Upstash HTTP 503');
  });

  it('renders an empty report without throwing', async () => {
    const out = await renderEmail({ week: { label: 'Oct 7 to 13', days: [] }, sections: {} });
    expect(out.subject).toBe('CURB this week: Oct 7 to 13');
    expect(out.html).toContain('All good this week');
    expect(out.html).toContain('n/a');
    expect(out.images.map((i) => i.cid)).toEqual(['logo@curb.guide']);
  });

  it('empty lists say so plainly', async () => {
    const r = fixture();
    r.sections.app.reviews = [];
    r.sections.mentions.items = [];
    r.sections.claude.mentions = [];
    r.sections.github.shipped = []; r.sections.github.shippedCount = 0;
    const out = await renderEmail(r);
    expect(out.html).toContain('No new reviews this week.');
    expect(out.html).toContain('No mentions found this week.');
    expect(out.html).toContain('Nothing shipped this week.');
  });

  it('a failed part with nothing to act on never reads "All good"', async () => {
    const r = fixture();
    r.sections.github.issues.alertsOpen = [];
    r.sections.github.issues.opened = [];
    r.sections.app.lowUnanswered = 0;
    r.sections.search.bing = { error: 'Bing HTTP 500' };
    expect(failedCount(r)).toBe(1);
    const out = await renderEmail(r);
    expect(out.html).toContain('Nothing needs you, but 1 part did not load');
    expect(out.html).not.toContain('All good this week');
  });

  it('a busy week (every list long, long strings) still stays under the clip limit', async () => {
    const r = fixture();
    const long = 'x'.repeat(400);
    const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
    Object.assign(r.sections.visits, {
      topPages: many(30, (i) => ({ path: `/b/${i}${long}`, label: long, pageviews: 9999, visitors: 9999 })),
      topHoods: many(30, (i) => ({ path: `/n/${long}${i}`, visitors: 1000 })),
      referrers: many(30, (i) => ({ host: `${long}${i}.com`, visitors: 1000 })),
      countries: many(30, () => ({ country: 'US', visitors: 1000 })),
    });
    r.sections.service.errors.groups = many(50, (i) => ({ message: long + i, count: 99, kind: long, page: long }));
    r.sections.github.shipped = many(80, (i) => ({ sha: String(i), subject: `fix(${long}): ${long}`, type: ['feat', 'fix', 'chore'][i % 3], date: '2026-10-08', url: `https://github.com/alevizio/curb/commit/${i}` }));
    r.sections.github.issues.opened = many(30, (i) => ({ number: i, title: long, url: 'https://github.com/x', automated: i % 2 === 0 }));
    r.sections.github.issues.closed = many(30, (i) => ({ number: i, title: long, url: 'https://github.com/x' }));
    r.sections.github.issues.alertsOpen = many(10, (i) => ({ number: i, title: long, url: 'https://github.com/x', label: long, createdAt: '2026-10-08' }));
    r.sections.search.google.topQueries = many(30, () => ({ query: long, clicks: 9, impressions: 99, position: 3 }));
    r.sections.search.google.topPages = many(30, () => ({ page: `https://curb.guide/${long}`, clicks: 9, impressions: 99 }));
    r.sections.app.reviews = many(30, () => ({ stars: 1, title: long, body: long, territory: 'USA', date: '2026-10-08', replied: false }));
    r.sections.mentions.items = many(40, (i) => ({ source: 'web', title: long, url: `https://example.com/${i}`, date: '2026-10-08', snippet: long }));
    r.sections.mentions.producthunt.recentComments = many(20, () => ({ author: long, body: long, date: '2026-10-08' }));
    r.sections.claude.summary = many(10, () => long);
    const out = await renderEmail(r);
    expect(Buffer.byteLength(out.html)).toBeLessThan(MAX_HTML_BYTES);
  });
});

describe('escaping and links', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  it('escapes every outside string and keeps only http(s) links', async () => {
    const r = fixture();
    r.sections.app.reviews[0].title = evil;
    r.sections.app.reviews[0].body = evil;
    r.sections.github.issues.alertsOpen[0].title = evil;
    r.sections.github.issues.alertsOpen[0].url = 'javascript:alert(3)';
    r.sections.github.shipped[0].subject = `feat(x): ${evil}`;
    r.sections.github.shipped[0].url = 'data:text/html,<b>hi</b>';
    r.sections.mentions.items[0].title = evil;
    r.sections.mentions.items[0].url = 'JaVaScRiPt:alert(4)';
    r.sections.service.errors.groups[0].message = evil;
    r.sections.search.google.topQueries[0].query = evil;
    r.sections.visits.topPages[0].path = '//evil.example/steal';
    r.sections.claude.summary[0] = evil;
    r.sections.mentions.producthunt.recentComments[0].body = evil;
    const { html, text } = await renderEmail(r);
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<[^>]*onerror/i); // as escaped text it is harmless; as a tag attribute it is not
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/href="(?!https?:)/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain('data:text/html');
    expect(html).not.toMatch(/href="[^"]*evil\.example/); // shown as text at most, never linked
    expect(text).not.toMatch(/javascript:/i);
  });

  it('safeUrl and esc', () => {
    expect(safeUrl('https://curb.guide/b/1')).toBe('https://curb.guide/b/1');
    expect(safeUrl('http://example.com')).toBe('http://example.com/');
    for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c', '/relative', '', null, 'vbscript:x']) expect(safeUrl(bad)).toBeNull();
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});

describe('needsYou rules', () => {
  const base = () => ({ sections: {
    github: { issues: { opened: [], alertsOpen: [] }, runs: { monitor: { total: 336, failed: 0 }, dataRefresh: { conclusion: 'success' } } },
    service: { alerts: { web: 1, ios: 1, failing: [] }, errors: { total: 10, prevTotal: 10, groups: [] } },
    app: { lowUnanswered: 0 },
  } });
  it('a quiet week needs nothing', () => expect(needsYou(base())).toEqual([]));
  it('an open monitor alert', () => {
    const r = base(); r.sections.github.issues.alertsOpen = [{ number: 47, title: 'Monitor: basemap tiles', url: 'https://github.com/alevizio/curb/issues/47' }];
    expect(needsYou(r)).toEqual([{ text: 'Monitor alert still open: #47 Monitor: basemap tiles', url: 'https://github.com/alevizio/curb/issues/47' }]);
  });
  it('failing pushes', () => {
    const r = base(); r.sections.service.alerts.failing = ['APNs 403 BadCertificate'];
    expect(needsYou(r)[0].text).toBe('Push alerts are failing: APNs 403 BadCertificate');
  });
  it('a low review without a reply', () => {
    const r = base(); r.sections.app.lowUnanswered = 2;
    expect(needsYou(r)[0]).toMatchObject({ text: '2 low reviews have no reply yet' });
  });
  it('a failed data refresh', () => {
    const r = base(); r.sections.github.runs.dataRefresh = { conclusion: 'failure', lastAt: '2026-10-01T10:12:00Z', url: 'https://github.com/alevizio/curb/actions/runs/1' };
    expect(needsYou(r)).toEqual([{ text: 'The data refresh failed on Oct 1', url: 'https://github.com/alevizio/curb/actions/runs/1' }]);
  });
  it('browser errors more than double and over 50', () => {
    const r = base(); r.sections.service.errors = { total: 51, prevTotal: 25 };
    expect(needsYou(r)[0].text).toBe('Browser errors jumped to 51 (last week 25)');
    r.sections.service.errors = { total: 50, prevTotal: 10 }; // not over 50
    expect(needsYou(r)).toEqual([]);
    r.sections.service.errors = { total: 120, prevTotal: 60 }; // exactly double is not more than double
    expect(needsYou(r)).toEqual([]);
  });
  it('a new issue from a person, never an automated one', () => {
    const r = base();
    r.sections.github.issues.opened = [{ number: 47, title: 'Monitor: x', automated: true }, { number: 48, title: 'Oakland?', url: 'https://github.com/alevizio/curb/issues/48', automated: false }];
    expect(needsYou(r)).toEqual([{ text: 'New issue from a person: #48 Oakland?', url: 'https://github.com/alevizio/curb/issues/48' }]);
  });
  it('monitor failure rate over 5%', () => {
    const r = base(); r.sections.github.runs.monitor = { total: 100, failed: 6 };
    expect(needsYou(r)[0].text).toBe('Monitor runs failed 6 of 100 times (6.0%)');
    r.sections.github.runs.monitor = { total: 100, failed: 5 };
    expect(needsYou(r)).toEqual([]);
  });
  it('skipped or failed sections never raise items, they go to the footer', () => {
    const r = { sections: { github: { skipped: 'missing GITHUB_TOKEN' }, service: { error: 'HTTP 500' }, app: { skipped: 'missing ASC_KEY_ID' } } };
    expect(needsYou(r)).toEqual([]);
    expect(notConnected(r).map((x) => x.name)).toEqual(['Visits', 'GitHub', 'Search', 'iPhone app', 'App Store analytics', 'Mentions', 'Claude summary']);
  });
});

describe('number helpers', () => {
  it('change: up, down, lower is better, new and n/a, never a dash', () => {
    expect(change(118, 100)).toEqual({ text: '▲ 18%', words: 'up 18%', tone: 'good' });
    expect(change(94, 100)).toMatchObject({ text: '▼ 6%', tone: 'bad' });
    expect(change(94, 100, { lowerIsBetter: true }).tone).toBe('good');
    expect(change(5, 0).text).toBe('new');
    expect(change(5, null).text).toBe('n/a');
    expect(change(100, 100).text).toBe('same');
    expect(change(1500, 100).text).toBe('▲ 1,400%');
  });
  it('num and pct', () => {
    expect(num(12253)).toBe('12,253');
    expect(num(undefined)).toBe('n/a');
    expect(pct(0.0317)).toBe('3.2%');
    expect(pct(8.1)).toBe('8.1%');
  });
});

describe('charts', () => {
  const days = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
  it('day labels run Wed to Tue for the report week', () => {
    expect(days.map((d) => dayLabel(d).day)).toEqual(['WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE']);
    expect(dayLabel('2026-10-07').date).toBe('Oct 7');
  });
  it('the bar chart has an opaque card, a value on each bar and a ghost bar for last week', () => {
    const svg = barChartSvg({ days, cur: [612, 420, 288, 190, 176, 1240, 232], prev: [160, 172, 180, 150, 138, 190, 210] });
    expect(svg).toMatch(/^<svg[^>]*><rect width="480" height="\d+" fill="#FFFDF6"\/>/);
    expect(svg).toContain('>1,240</text>');
    expect(svg.match(/fill="#E4DBC9"/g).length).toBe(8); // 7 ghost bars + the legend swatch
  });
  it('a day with no data yet says so instead of drawing zero', () => {
    const svg = barChartSvg({ days, cur: [1, 2, 3, 4, 5, null, null], legend: { cur: 'Clicks <&>' } });
    expect(svg.match(/>not in<\/text><text[^>]*>yet</g).length).toBe(2); // two lines: one is wider than a day's slot
    expect(svg).toContain('Clicks &lt;&amp;&gt;');
  });
  it('align puts rows on the report days', () => {
    expect(align(['2026-10-07', '2026-10-08'], [{ date: '2026-10-08', clicks: 4 }], 'clicks')).toEqual([null, 4]);
  });
});

describe('fixes from the first real render (Oct 2026)', () => {
  it('the Google chart uses Google\'s own lagged days, not the report week', async () => {
    const r = fixture();
    r.sections.search.google = { ...r.sections.search.google, start: '2026-10-05', end: '2026-10-11',
      daily: ['05', '06', '07', '08', '09', '10', '11'].map((d, i) => ({ date: `2026-10-${d}`, clicks: 10 + i, impressions: 100 })) };
    const { html } = await renderEmail(r);
    expect(html).toMatch(/Google clicks per day: Oct 5 10, Oct 6 11/);
  });
  it('the shipped summary counts the whole week by type, and says only the newest are listed', async () => {
    const r = fixture();
    r.sections.github = { ...r.sections.github, shippedCount: 47, shippedByType: { feat: 9, fix: 30, docs: 8 } };
    const text = visible((await renderEmail(r)).html).replace(/\s+/g, ' ');
    expect(text).toContain('47 changes reached curb.guide: 9 new, 30 fixes, 8 other.');
    expect(text).toMatch(/The newest \d+ are listed\./);
  });
  it('Google coverage states read as plain words', async () => {
    const r = fixture();
    r.sections.search.google.indexSample = { checked: 50, indexed: 38, states: { 'Submitted and indexed': 38, 'URL is unknown to Google': 4, 'Discovered - currently not indexed': 8 } };
    const text = visible((await renderEmail(r)).html).replace(/\s+/g, ' ');
    expect(text).toContain('38 of 50 sampled pages are indexed (4 not found by Google yet; 8 found but not crawled yet)');
  });
});

// Second review pass (Oct 2026): failed parts, the sender verdict, what the alert count means, last
// week's errors, partial weeks, shipped dates, mention badges, dark mode stars, links and chart labels.
const flat = (html) => visible(html).replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('a failed sub-part never reads as an all clear', () => {
  // [part that fails, the line it must show in HTML and text, all clear wording it must not show]
  const cases = [
    ['service.alerts', 'Could not load the alert sign-ups and push status this week: E', 'Push sends look healthy'],
    ['service.errors', 'Could not load the browser errors this week: E', 'No browser errors this week'],
    ['github.shipped', 'Could not load the commits this week: E', 'Nothing shipped this week'],
    ['github.issues', 'Could not load the issues and monitor alerts this week: E', 'Every check passes'],
    ['github.runs.monitor', 'Could not load the monitor runs this week: E', 'The monitor ran'],
    ['github.runs.dataRefresh', 'Could not load the data refresh runs this week: E', 'is still running'],
    ['github.repo', 'Could not load the GitHub stars this week: E', 'forks on GitHub'],
    ['visits.prev', "Could not load last week's visits to compare: E", null],
    ['visits.daily', 'Could not load the visits per day this week: E', null],
    ['visits.topPages', 'Could not load the top pages this week: E', 'No page data this week'],
    ['visits.referrers', 'Could not load the referrers this week: E', 'No referrers this week'],
    ['search.google.indexSample', 'Could not load the index check this week: E', 'Index check:'],
    ['search.bing.topPages', 'Could not load the Bing top pages this week: E', 'No Bing pages with clicks yet'],
    ['app.live', 'Could not load the App Store listing this week: E', null],
    ['app.downloads', 'Could not load downloads this week: E', 'Downloads as of'],
    ['app.reviews', 'Could not load reviews this week: E', 'No new reviews'],
    ['appAnalytics.sessions', 'Could not load sessions this week: E', null],
    ['mentions.producthunt', 'Could not load Product Hunt this week: E', 'upvotes'],
    ['mentions.hackerNews', 'Could not load the Hacker News search this week: E', null],
    ['claude', 'Could not load the Claude summary this week: E', null],
  ];
  const set = (r, path, v) => { const keys = path.split('.'); const last = keys.pop(); keys.reduce((o, k) => o[k], r.sections)[last] = v; };
  for (const [path, line, clear] of cases) {
    it(path, async () => {
      const r = fixture();
      set(r, path, { error: 'E' });
      if (path === 'github.shipped') r.sections.github.shippedCount = null; // github.mjs nulls the counts with it
      expect(failedCount(r)).toBe(1);
      const { html, text } = await renderEmail(r);
      expect(flat(html)).toContain(line);
      expect(text).toContain(line);
      if (clear) expect(flat(html)).not.toContain(clear);
    });
  }

  it('sub-part failures count in the status line, one per distinct error', async () => {
    const r = fixture();
    r.sections.github.issues.alertsOpen = []; r.sections.github.issues.opened = []; r.sections.app.lowUnanswered = 0;
    r.sections.service.alerts = { error: 'Upstash 503' };
    r.sections.github.runs.verify = { error: 'GitHub HTTP 502' };
    r.sections.visits.daily = r.sections.visits.prevDaily = { error: 'Vercel HTTP 500' }; // one failure behind two parts
    expect(failures(r).map((f) => f.section).sort()).toEqual(['github', 'service', 'visits']);
    const { html, text } = await renderEmail(r);
    expect(html).toContain('Nothing needs you, but 3 parts did not load');
    expect(html).not.toContain('All good this week');
    expect(text).toContain('Nothing needs you, but 3 parts did not load');
    expect(html).not.toContain('cid:visitors@curb.guide');
  });

  it('a tile whose section or part failed says "did not load", not "not connected"', () => {
    const r = fixture();
    r.sections.visits = { error: 'x' }; r.sections.app.downloads = { error: 'y' }; r.sections.service.alerts = { error: 'z' };
    expect(headline(r).map((h) => h.sub)).toEqual(['did not load', 'from 268', 'did not load', 'did not load']);
    r.sections.visits = fixture().sections.visits; r.sections.visits.prev = { error: 'x' };
    expect(headline(r)[0].sub).toBe('last week did not load');
  });
});

describe('the sweep alert sender verdict', () => {
  const words = 'the latest sender run failed, alerts are not going out. Last run: error (VAPID missing) via qstash.';
  it('a failing verdict is a red line and a needs you item, never "healthy"', async () => {
    const r = fixture();
    r.sections.service.alerts.sender = { status: 'fail', detail: 'the latest sender run failed — alerts are not going out. Last run: error (VAPID missing) via qstash.' };
    expect(needsYou(r).map((x) => x.text)).toContain(`The sweep alert sender check failed: ${words}`);
    const { html, text } = await renderEmail(r);
    expect(flat(html)).toContain(`Push alerts need a look: ${words}`);
    expect(html).toMatch(/class="bad" style="margin:0;color:#C1121F;"><b>Push alerts need a look/);
    expect(`${html}${text}`).not.toContain('Push sends look healthy');
    expect(visible(html)).not.toMatch(/[–—]/);
  });
  it('only an ok verdict reads healthy', async () => {
    const r = fixture();
    r.sections.service.alerts.sender = { status: 'skip', detail: 'no sender run recorded yet (fresh deploy?) — the first QStash or GitHub backup run creates it' };
    const { html } = await renderEmail(r);
    expect(html).not.toContain('Push sends look healthy');
    expect(flat(html)).toContain('Sender check: no sender run recorded yet (fresh deploy?), the first QStash or GitHub backup run creates it.');
    expect(needsYou(r).some((x) => /sender/.test(x.text))).toBe(false);
  });
  it('a failing verdict replaces the failing deliveries item instead of repeating it', () => {
    const r = fixture();
    r.sections.service.alerts.failing = ['web: 5 of 6 devices failed'];
    r.sections.service.alerts.sender = { status: 'fail', detail: 'pushes are not being delivered: web: 5 of 6 devices failed.' };
    expect(needsYou(r).filter((x) => /push|sender/i.test(x.text))).toHaveLength(1);
  });
  it('undash turns dashes used as punctuation into commas and leaves words alone', () => {
    expect(undash('a — b – c - d, e—f')).toBe('a, b, c, d, e, f');
    expect(undash('sign-ups stay')).toBe('sign-ups stay');
  });
});

describe('alert sign-ups', () => {
  it('count every signed up device, say so, and never say "alerts set"', async () => {
    const { html, text } = await renderEmail(fixture());
    const t = flat(html);
    expect(t).toContain('Alert sign-ups 137 71 web, 66 iPhone');
    expect(t).toContain('137 alert sign-ups 71 web, 66 iPhone');
    expect(t).toContain('Devices that turned alerts off still count as sign-ups until they unsubscribe.');
    expect(text).toContain('137 alert sign-ups (71 web, 66 iPhone). Devices that turned alerts off still count until they unsubscribe.');
    expect(`${html}${text}`).not.toMatch(/alerts set/i);
  });
});

describe('browser errors against an unknown or partial last week', () => {
  it('a null prevTotal is unknown, not zero: no jump, no arrow', async () => {
    const r = fixture();
    r.sections.service.errors = { ...r.sections.service.errors, total: 300, prevTotal: null, capped: true };
    expect(needsYou(r).some((x) => /Browser errors/.test(x.text))).toBe(false);
    const { html, text } = await renderEmail(r);
    expect(flat(html)).toContain('300 browser errors last week unknown');
    expect(flat(html)).toContain("The error log filled up, so last week's count is unknown.");
    expect(text).toContain('300 browser errors (last week unknown)');
  });
  it('a capped log drops the arrow and the jump, and calls last week a minimum', async () => {
    const r = fixture();
    r.sections.service.errors = { ...r.sections.service.errors, total: 900, prevTotal: 100, capped: true };
    expect(needsYou(r).some((x) => /Browser errors/.test(x.text))).toBe(false);
    const { html } = await renderEmail(r);
    expect(flat(html)).toContain('900 browser errors last week at least 100');
    expect(flat(html)).toContain("The error log filled up, so last week's count is a minimum.");
    expect(html).not.toMatch(/browser errors <span/); // no change arrow beside the label
  });
});

describe('partial weeks show no fake drops', () => {
  it('a partial downloads week says how many days it covers', async () => {
    const { html, text } = await renderEmail(fixture());
    expect(flat(html)).toContain('App downloads 184 ▲ 217% 6 of 7 days, from 58');
    expect(flat(html)).toContain('184 downloads ▲ 217% 6 of 7 days');
    expect(text).toMatch(/App downloads:\s+184\s+up 217%, 6 of 7 days, from 58/);
  });
  it('App Store metrics Apple is still counting show how far they got, with no arrow', async () => {
    const { html, text } = await renderEmail(fixture());
    expect(html).toMatch(/>sessions<\/div><div[^>]*>through Oct 9<\/div>/);
    expect(html).toMatch(/>crashes<\/div><div[^>]*>through Oct 9<\/div>/);
    expect(html).toMatch(/>active devices <span/); // a complete metric keeps its arrow
    expect(text).toContain('1,640 sessions through Oct 9');
  });
  it('Bing says which days its numbers and its top pages cover', async () => {
    const r = fixture();
    const t = flat((await renderEmail(r)).html);
    expect(t).toContain('Bing data Oct 5 to Oct 11.');
    expect(t).toContain('Top pages for Sep 29 to Oct 5:');
    expect((await renderEmail(r)).text).toContain('Bing (Oct 5 to Oct 11): 21 clicks');
  });
  it('fresh Search Console days drop the Google arrows, the headline one too', async () => {
    const r = fixture();
    r.sections.search.google.firstIncompleteDate = '2026-10-10';
    const { html, text } = await renderEmail(r);
    expect(html).toMatch(/>clicks<\/div>/); // Google's; Bing's clicks keep their arrow
    expect(html).toMatch(/>impressions<\/div>/);
    expect(headline(r)[1]).toMatchObject({ ch: null, flag: 'still coming in', sub: 'from 268' });
    expect(flat(html)).toContain('so this covers Oct 7 to Oct 11, and the last days are still coming in.');
    expect(text).toMatch(/Google clicks:\s+312\s+still coming in, from 268/);
    r.sections.search.google.firstIncompleteDate = '2026-10-12'; // after the window: complete
    expect(headline(r)[1].ch.text).toBe('▲ 16%');
  });
});

describe('rows, badges, links and dark mode', () => {
  it('a shipped row shows the day the commit reached main, not the day it was written', async () => {
    const { html } = await renderEmail(fixture());
    expect(html).toMatch(/bump every GitHub Action to its current major in one pass<\/a><\/td><td[^>]*>Oct 9<\/td>/);
  });
  it("a Claude mention is badged by its link's host, not by what Claude called it", async () => {
    const r = fixture();
    r.sections.claude.mentions[1].source = 'Bluesky'; // a reddit.com link
    const { html, text } = await renderEmail(r);
    expect(html).toContain('class="soft">reddit.com</span>');
    expect(html).toContain('class="soft">bayareaparkingblog.example.com</span>');
    expect(html).not.toContain('class="soft">Blog</span>');
    expect(text).toContain('[reddit.com] CURB on the r/sanfrancisco weekly thread');
  });
  it('empty review stars are muted in dark mode', async () => {
    const { html } = await renderEmail(fixture());
    expect(html).toMatch(/<span class="star0"[^>]*>★★<\/span>/); // the 3 star review
    expect(html.match(/<style>(@media \(prefers-color-scheme:dark\)[^<]*)<\/style>/)[1]).toContain('.star0{color:#5A5442!important}');
  });
  it('Google and Bing pages link to curb.guide, a group row of visits links nowhere', async () => {
    const { html } = await renderEmail(fixture());
    expect(html.match(/href="https:\/\/curb\.guide\/n\/mission"/g)).toHaveLength(3); // neighborhood list, Google, Bing
    expect(html).toContain('href="https://curb.guide/b/8753101"');
    expect(html).not.toMatch(/href="[^"]*\*"/);
    expect(visible(html)).not.toContain('/b/*');
  });
  it('the daily bars are visits (per hour uniques added up), the headline stays unique visitors', async () => {
    const { html } = await renderEmail(fixture());
    expect(html).toContain('alt="Visits per day: Oct 7 612, Oct 8 420');
    expect(html).not.toContain('Visitors per day');
    expect(flat(html)).toContain('1,940 visitors');
  });
});

describe('chart labels a phone can read', () => {
  const days = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
  it('every label is at least 17 units (about 11 px on a 390 px phone) and stays inside the canvas', () => {
    for (const [height, legend] of [[CHART_HEIGHT.visitors, { cur: 'Visits per day, this week', prev: 'Last week' }], [CHART_HEIGHT.clicks, { cur: 'Google clicks per day' }]]) {
      const svg = barChartSvg({ days, cur: [612, 420, null, 190, 12240, 1240, null], prev: legend.prev ? [160, 172, 180, 150, 138, 190, 210] : null, height, legend });
      expect(Math.min(...[...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => +m[1]))).toBeGreaterThanOrEqual(17);
      for (const m of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)) {
        expect(+m[2]).toBeLessThanOrEqual(height - 3); // the date's baseline leaves room for its descenders
        expect(+m[2]).toBeGreaterThan(15);
      }
      if (legend.prev) expect(+svg.match(/<text x="([\d.]+)" y="19"[^>]*>Last week</)[1] + 'Last week'.length * 8.2).toBeLessThan(480);
    }
  });
  it('the PNG keeps the design aspect (the email sizes the img from CHART_HEIGHT)', async () => {
    const { images } = await renderEmail(fixture());
    expect(png(images.find((i) => i.cid === 'visitors@curb.guide').data).h).toBe(1200 * CHART_HEIGHT.visitors / 480);
  });
});
