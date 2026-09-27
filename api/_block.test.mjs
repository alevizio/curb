// Tests for the /b/<cnn> block page (api/block.js). Named _block.test.mjs so Vercel never routes it
// as a function (the "_" prefix; Hobby caps us at 12).
import { describe, it, expect, afterEach, vi } from 'vitest';
import handler, { makeHandler, renderBlock, titleFor, loadData } from './block.js';

afterEach(() => { vi.useRealTimers(); });

const un = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const title = (html) => un(html.match(/<title>(.*?)<\/title>/)[1]);
const desc = (html) => un(html.match(/name="description" content="(.*?)"/)[1]);

// Two halves of a divided street + its neighbor, in the baked shape (scripts/build-schedules.mjs).
const DATA = {
  S: {
    hoods: [['Pacific Heights', 'pacific-heights', 1], ['Presidio', 'presidio', 0]],
    b: {
      '1000': ['Pierce St', 'Pine St', 'California St', 0,
        [['West', 4, 8, 10, 31, 0], ['', 1, 8, 10, 5, 0], ['East', 1, 8, 10, 10, 0], ['East', 1, 8, 10, 21, 0]], '999', '2000', '', '2026-09-27'],
      '999': ['Pierce St', 'Bush St', 'Pine St', 0, [['East', 2, 9, 11, 31, 0]], '', '1000', '', '2026-09-27'],
      '2000': ['Pierce St', 'California St', 'Sacramento St', 1, [['East', 3, 12, 14, 31, 0]], '1000', '', '', '2026-09-27'],
      '188101': ['3rd St', '18th St', '19th St', -1, [['East', 2, 2, 6, 31, 0]], '', '', 'east side', '2026-09-27'],
      '188201': ['3rd St', '18th St', '19th St', -1, [['West', 2, 2, 6, 31, 0]], '', '', 'west side', '2026-09-27'],
    },
  },
  ENF: { '1000': { 1: [40, 8 * 60 + 14, 8 * 60 + 2, 9 * 60], 4: [12, 8 * 60 + 20, 8 * 60 + 5, 9 * 60] } },
  R: { routeNames: { 2: 'Pacific Hts./ Jordan Park' }, blocks: { '1000': 2 } },
};

function call(h, cnn) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  return Promise.resolve(h({ query: { cnn } }, res)).then(() => res);
}

describe('block page — content', () => {
  it('renders a short, SF-specific title and a street-naming description', () => {
    const { status, body } = renderBlock('1000', DATA);
    expect(status).toBe(200);
    expect(title(body)).toBe('Pierce St Street Cleaning (Pine–California), SF | CURB');
    expect(title(body).length).toBeLessThan(60);
    expect(desc(body)).toBe('Street cleaning on Pierce St between Pine St and California St, Pacific Heights, SF: ' +
      'Mon, Thu 8–10am; Mon 8–10am (1st & 3rd wks). Tickets usually land ~8:14am.'); // the fine is shed first to fit 160
    expect(desc(renderBlock('999', DATA).body)).toBe('Street cleaning on Pierce St between Bush St and Pine St, Pacific Heights, SF: Tue 9–11am. $105 fine.');
  });

  it('H1 is "<street> between <A> and <B>" and the sentence names the neighborhood', () => {
    const { body } = renderBlock('1000', DATA);
    expect(body).toContain('<h1>Pierce St between Pine St and California St</h1>');
    expect(body).toMatch(/in the Pacific Heights neighborhood of San Francisco, is swept/);
  });

  it('merges split week rows, sorts rows Monday-first and never prints "Curbside side"', () => {
    const { body } = renderBlock('1000', DATA);
    const days = [...body.matchAll(/<div class="d">(\w+)<\/div>/g)].map((m) => m[1]);
    expect(days).toEqual(['MON', 'MON', 'THU']);                 // Mon (no side), Mon East, Thu West
    expect(body).toContain('East side · every week');            // weeks 2,4 + 1,3,5 = every week
    expect(body).not.toMatch(/Curbside/);
    expect(body).toContain('STREET CLEANING');                   // the production smoke check keys on this
  });

  it('prints one ticket line for the block, the $105 fine and the DPW route', () => {
    const { body } = renderBlock('1000', DATA);
    expect(body.split('<main')[1].match(/Tickets usually land/g)).toHaveLength(1); // visible page, not the meta tags
    expect(body).toContain('Tickets usually land between 8:14am and 8:20am · 52 tickets in 2 yrs');
    expect(body).toContain('Street-cleaning ticket: $105');
    expect(body).toContain('<b>Pacific Hts./ Jordan Park</b> sweeper route');
  });

  it('links breadcrumb, neighborhood, previous/next block and the site nav', () => {
    const { body } = renderBlock('1000', DATA);
    expect(body).toMatch(/<nav class="crumb"[^>]*><a href="\/">CURB<\/a> › <a href="\/n\/pacific-heights">Pacific Heights<\/a> › Pierce St<\/nav>/);
    expect(body).toContain('<a href="/b/999">← Pierce St between Bush St and Pine St</a>');
    expect(body).toContain('<a href="/b/2000">Pierce St between California St and Sacramento St →</a>');
    expect(body).toContain('<a href="/n/pacific-heights">Every swept block in Pacific Heights →</a>');
    for (const href of ['/', '/n/', '/tickets', '/about']) expect(body).toContain(`<a href="${href}">`);
    const ld = JSON.parse(body.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement.map((i) => i.name)).toEqual(['CURB', 'Pacific Heights', 'Pierce St']);
    expect(ld.itemListElement[1].item).toBe('https://curb.guide/n/pacific-heights');
  });

  it('never links a neighborhood page that does not exist', () => {
    const { body } = renderBlock('2000', DATA); // Presidio: no /n/ page
    expect(body).not.toContain('/n/presidio');
    expect(body).toContain('<a href="/n/">Neighborhoods</a>');
    expect(body).toContain('in the Presidio neighborhood of San Francisco');
  });

  it('gives the two halves of a divided road distinct titles and H1s', () => {
    const a = renderBlock('188101', DATA).body, b = renderBlock('188201', DATA).body;
    expect(title(a)).toBe('3rd St Street Cleaning (18th–19th, east side), SF | CURB');
    expect(title(b)).toBe('3rd St Street Cleaning (18th–19th, west side), SF | CURB');
    expect(a).toContain('<h1>3rd St between 18th St and 19th St, east side</h1>');
  });

  it('lists the next three sweep dates from the SF calendar, skipping holidays', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 19, 0))); // Mon 2026-10-05, noon PDT
    // Pierce/California–Sacramento: every Wednesday 12–2pm → Oct 7, 14, 21
    expect(renderBlock('2000', DATA).body).toContain('Next sweeps: <b>Wed, Oct 7</b>, <b>Wed, Oct 14</b> and <b>Wed, Oct 21</b>.');
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 11, 19, 0))); // Sun Oct 11; Mon Oct 12 is Indigenous Peoples Day
    const { body } = renderBlock('1000', DATA);
    expect(body).toContain('Next sweeps: <b>Thu, Oct 15</b>, <b>Mon, Oct 19</b> and <b>Thu, Oct 22</b>.');
  });

  it('keeps today in the next dates only until its window ends', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 7, 20, 0))); // Wed Oct 7, 1pm PDT (window 12–2pm)
    expect(renderBlock('2000', DATA).body).toContain('Next sweeps: <b>Wed, Oct 7</b>');
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 7, 21, 30))); // 2:30pm PDT — over
    expect(renderBlock('2000', DATA).body).toContain('Next sweeps: <b>Wed, Oct 14</b>');
  });

  it('shortens long titles below 60 characters without losing the side tag', () => {
    const t = titleFor(['Diamond Heights Blvd', 'Gold Mine Dr', 'Diamond Heights Blvd Frontage', 0, [], '', '', 'northeast side']);
    expect(t.length).toBeLessThan(60);
    expect(t).toContain('NE side');
    expect(t).toMatch(/, SF \| CURB$/);
  });
});

describe('block page — status codes', () => {
  it('unknown cnn is a real 404 (noindex), never a redirect home', async () => {
    const res = await call(makeHandler(() => DATA), '424242');
    expect(res.statusCode).toBe(404);
    expect(res.headers.Location).toBeUndefined();
    expect(res.body).toContain('<meta name="robots" content="noindex">');
  });

  it('junk cnn is a 404 too', async () => {
    expect((await call(makeHandler(() => DATA), 'abc')).statusCode).toBe(404);
    expect((await call(makeHandler(() => DATA), '')).statusCode).toBe(404);
  });

  it('a data file that fails to load is a 503 with Retry-After and no-store', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(makeHandler(() => { throw new Error('ENOENT schedules.json'); }), '1000');
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('300');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toContain('noindex');
    spy.mockRestore();
  });

  it('a render crash on a malformed entry is a 503', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = makeHandler(() => ({ S: { b: { 1000: ['x'] }, hoods: [] }, ENF: {}, R: {} }));
    expect((await call(bad, '1000')).statusCode).toBe(503);
    spy.mockRestore();
  });

  it('a failed load is retried on the next request instead of sticking', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let tries = 0;
    const h = makeHandler(() => { if (tries++ === 0) throw new Error('boom'); return DATA; });
    expect((await call(h, '1000')).statusCode).toBe(503);
    expect((await call(h, '1000')).statusCode).toBe(200);
    spy.mockRestore();
  });

  it('a 200 is cached at the CDN only until SF midnight (the next-sweep dates go stale)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 19, 0))); // noon PDT → 12h left
    const res = await call(makeHandler(() => DATA), '1000');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=43200, stale-while-revalidate=3600');
  });
});

describe('block page — every baked block (data/schedules.json)', () => {
  it('renders all of them with unique <60-char titles, clean text and ≤160-char descriptions', async () => {
    const d = loadData();
    const titles = new Set();
    const bad = [];
    for (const cnn of Object.keys(d.S.b)) {
      const { status, body } = renderBlock(cnn, d);
      const t = title(body), text = body.replace(/<[^>]+>/g, ' ');
      if (status !== 200 || t.length >= 60 || titles.has(t) || desc(body).length > 160 ||
        /Curbside|Start:|End:|\b0\d+(st|nd|rd|th)\b/.test(text) || / between (.+) and \1\b/.test(body.match(/<h1>(.*?)<\/h1>/)[1])) bad.push(cnn);
      titles.add(t);
    }
    expect(bad).toEqual([]);
    expect(titles.size).toBeGreaterThan(8000);
  });

  it('the default export serves a real block from the committed data', async () => {
    const res = await call(handler, '8753101');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Market St between Larkin St and Polk St');
  });
});
