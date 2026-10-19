// scripts/cities/winter-watch.mjs: reading a city's news for the notice that turns its winter rule on.
import { describe, it, expect } from 'vitest';
import { newsItems, toEmail, email, WATCH } from './winter-watch.mjs';

// Madison's news listing, trimmed to two summaries as the page writes them (fetched 2026-10-18), plus the notice that
// turned the rule on last winter
const PAGE = `<div class="article-summary">
  <h2 class="article-title u-d--inline"><a href="/news/2025-11-29/madison-declares-a-snow-emergency-winter-parking-rules-are-in-effect-citywide" hreflang="en">Madison Declares a Snow Emergency; Winter Parking Rules Are In Effect Citywide  </a></h2>
  <small class="u-italic u-muted"><span class="article-date">posted <time datetime="2025-11-29T15:02:00-06:00" class="datetime">November 29, 2025</time></span></small></div>
<div class="article-summary">
  <h2 class="article-title u-d--inline"><a href="/news/2025-11-28/mayors-office-update-events" hreflang="en">Mayor&#039;s Office Update &amp; Events</a></h2></div>
<a href="/news/2025-11-29/madison-declares-a-snow-emergency-winter-parking-rules-are-in-effect-citywide">Read more</a>`;

describe('the winter watch', () => {
  it('reads each news item once, with its date and plain title', () => {
    expect(newsItems(PAGE)).toEqual([
      { href: '/news/2025-11-29/madison-declares-a-snow-emergency-winter-parking-rules-are-in-effect-citywide', date: '2025-11-29',
        title: 'Madison Declares a Snow Emergency; Winter Parking Rules Are In Effect Citywide' },
      { href: '/news/2025-11-28/mayors-office-update-events', date: '2025-11-28', title: "Mayor's Office Update & Events" },
    ]);
  });
  it('emails a recent notice about winter parking, once', () => {
    const items = newsItems(PAGE), words = WATCH.madison.words;
    expect(toEmail(items, { words, today: '2025-11-29' }).map((i) => i.date)).toEqual(['2025-11-29']);
    expect(toEmail(items, { words, today: '2025-11-29', seen: [items[0].href] })).toEqual([]);
    expect(toEmail(items, { words, today: '2025-12-05' })).toEqual([]);   // a week later it is old news
  });
  it('says what was posted, where, and how to flip the switch', () => {
    const items = newsItems(PAGE).slice(0, 1);
    const m = email({ id: 'madison', ...WATCH.madison }, items, { site: WATCH.madison.site, state: 'waiting' });
    expect(m.subject).toBe('Madison: Madison Declares a Snow Emergency; Winter Parking Rules Are In Effect Citywide');
    expect(m.text).toContain('https://www.cityofmadison.com/news/2025-11-29/madison-declares-a-snow-emergency');
    expect(m.text).toContain('node scripts/cities/winter.mjs madison on --reason "Madison declared a snow emergency."');
    expect(m.text).toContain('CURB\'s switch says "waiting"');
    expect(m.html).not.toMatch(/<script/);
  });
});
