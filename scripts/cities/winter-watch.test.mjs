// scripts/cities/winter-watch.mjs: reading a city's news for the notice that turns its winter rule on.
import { describe, it, expect } from 'vitest';
import { newsItems, toEmail, email, WATCH, tableItems, isoDate, releaseLead, snowstormKind, torontoEmail } from './winter-watch.mjs';

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

// ---- Toronto: toronto.ca/news lists releases as a table; a release's lead says whether it declares or ends a Major
// Snowstorm Condition ----

// The listing as toronto.ca wrote it (news page 10, fetched 2026-10-20: the week of January 25, 2026), trimmed to five rows
const TABLE = `<table class="cot-table">
<caption class="sr-only">List of Media Room Items</caption>
<thead><tr class="hidden-xs hidden-print"><th class="listTitle">Title</th><th class="listDate">Date&nbsp;Released</th><th class="listCategory">Type</th></tr></thead>

<tr>
	<td><a href="https://www.toronto.ca/news/toronto-on-the-menu-winterlicious-begins-today/">Toronto on the menu: Winterlicious begins today</a></td>
	<td>Jan 30, 2026</td>
	<td>News&nbsp;Release</td>
</tr>
<tr>
	<td><a href="https://www.toronto.ca/news/city-of-toronto-activates-second-major-snow-event-response-plan-of-the-year-declaring-major-snowstorm-condition-and-significant-weather-event/">City of Toronto activates second Major Snow Event Response Plan of the year, declaring Major Snowstorm Condition and Significant Weather Event</a></td>
	<td>Jan 25, 2026</td>
	<td>News&nbsp;Release</td>
</tr>
<tr>
	<td><a href="https://www.toronto.ca/news/major-snowstorm-condition-and-significant-weather-event-declarations-ending/">Major Snowstorm Condition and Significant Weather Event declarations ending</a></td>
	<td>Jan 19, 2026</td>
	<td>News&nbsp;Release</td>
</tr>
<tr>
	<td><a href="https://www.toronto.ca/news/city-of-toronto-activates-new-snow-event-response-plan-as-major-snowstorm-condition-and-significant-weather-event-declared/">City of Toronto activates new snow event response plan as Major Snowstorm Condition and Significant Weather Event declared</a></td>
	<td>Jan 15, 2026</td>
	<td>News&nbsp;Release</td>
</tr>
<tr>
	<td><a href="https://www.toronto.ca/news/winter-fun-returns-as-the-earl-bales-ski-and-snowboard-centre-opens-for-2026/">Winter fun returns as the Earl Bales Ski and Snowboard Centre opens for 2026</a></td>
	<td>Jan 6, 2026</td>
	<td>News&nbsp;Release</td>
</tr>
</table>`;
// The head of the February 10, 2026 release, as served
const RELEASE = '<meta name="description" content="News Release February 10, 2026 The Major Snowstorm Condition and Significant Weather Event declarations, which came into effect on Sunday, January 25, will end today at 5 p.m. The declarations helped to expedite plowing and snow removal after Toronto received approximately 90 cm of snow in two snowstorms in January, which opened up access for emergency and transit vehicles and improved accessibility of residential streets, sidewalks, bike lanes and school bus loading zones. From January 16 to [&hellip;]">';
// Every snow release on toronto.ca/news, 2022 to 2026 (2024 had none), its lead (the start of the page's description, fetched
// 2026-10-20) and what it says
const RELEASES = [
  ['declared', 'City of Toronto declares major snow storm condition ahead of snow removal operations', 'News Release January 17, 2022 The City of Toronto has declared a major snow storm condition in Toronto in response to the heavy and disruptive snowfall that occurred today, receiving five centimetres an hour at its peak.'],
  ['mentions', 'City to begin towing vehicles abandoned or illegally parked as major snow clean-up continues, snow removal operations begin Wednesday', 'News Release January 18, 2022 Starting Wednesday, January 19, the City of Toronto will be tagging and towing abandoned vehicles that are parked illegally as well as those parked on designated snow routes that are impeding the work of snow plows and other snow clearing efforts and/or TTC vehicles.'],
  ['mentions', 'City of Toronto provides Major Snow Event Post-Operational Report', 'News Release March 22, 2022 A City of Toronto staff report going before the Infrastructure and Environment Committee on March 29 details the City’s response to the January 17 snow storm.'],
  ['declared', 'City of Toronto prepares for snow removal operations by declaring a major snowstorm condition', 'News Release March 4, 2023 The City of Toronto has declared a major snowstorm condition in Toronto in preparation for snow removal operations, which are anticipated to begin on Monday.'],
  ['declared', 'City of Toronto declares Major Snowstorm Condition and Significant Weather Event ahead of snow operations', 'News Release February 12, 2025 The City of Toronto is declaring a Major Snowstorm Condition and Significant Weather Event in Toronto in advance of the heavy snowfall that is expected to begin Wednesday evening.'],
  ['mentions', 'Crews continue clearing snow across Toronto, City of Toronto now accepting service requests after snowstorm', 'News Release February 14, 2025 City of Toronto crews and contractors are continuing to work 24/7 to clear snow from roads, sidewalks and bikeways across the city ahead of further anticipated snowfall this weekend.'],
  ['mentions', 'Snow clearing continues around the clock, residents reminded not to park on snow routes', 'News Release February 17, 2025 City of Toronto crews and contractors are continuing to work 24/7 to clear snow from roads and sidewalks after 16 to 23 centimetres of snow fell across the city over the weekend.'],
  ['ended', 'Major Snowstorm Condition and Significant Weather Event Declarations End', 'News Release March 5, 2025 The Major Snowstorm Condition and Significant Weather Event declarations, which came into effect on Wednesday, February 12, ended at 4 p.m. today.'],
  ['declared', 'City of Toronto activates new snow event response plan as Major Snowstorm Condition and Significant Weather Event declared', 'News Release January 15, 2026 The City of Toronto is activating its new Major Snow Event Response Plan (MSERP) and declaring a Major Snowstorm Condition and Significant Weather Event starting at 5 p.m. today in response to severe winter weather.'],
  ['ended', 'Major Snowstorm Condition and Significant Weather Event declarations ending', 'News Release January 19, 2026 The Major Snowstorm Condition and Significant Weather Event declarations, which came into effect on Thursday, January 15, will end at 5 p.m. today.'],
  ['declared', 'City of Toronto activates second Major Snow Event Response Plan of the year, declaring Major Snowstorm Condition and Significant Weather Event', 'News Release January 25, 2026 The City of Toronto is activating its Major Snow Event Response Plan (MSERP) and declaring a Major Snowstorm Condition and Significant Weather Event, effective immediately.'],
  ['ended', 'Snowstorm declarations ending, drivers still reminded not to park where temporary orange “Snow Removal” signs are posted', 'News Release February 10, 2026 The Major Snowstorm Condition and Significant Weather Event declarations, which came into effect on Sunday, January 25, will end today at 5 p.m.'],
];

describe('the winter watch: Toronto', () => {
  it('reads the listing table: link, date, title and type, each once', () => {
    const items = tableItems(TABLE);
    expect(items).toHaveLength(5);
    expect(items[1]).toEqual({ href: 'https://www.toronto.ca/news/city-of-toronto-activates-second-major-snow-event-response-plan-of-the-year-declaring-major-snowstorm-condition-and-significant-weather-event/',
      date: '2026-01-25', title: 'City of Toronto activates second Major Snow Event Response Plan of the year, declaring Major Snowstorm Condition and Significant Weather Event', type: 'News Release' });
    expect(isoDate('Feb 10, 2026')).toBe('2026-02-10');
    expect(isoDate('September 7, 2026')).toBe('2026-09-07');
    expect(isoDate('soon')).toBe(null);
  });
  it('emails a recent snowstorm release, not Winterlicious, once', () => {
    const items = tableItems(TABLE), words = WATCH.toronto.words;
    expect(toEmail(items, { words, today: '2026-01-25' }).map((i) => i.date)).toEqual(['2026-01-25']);
    // the page as it stood on January 18: the declaration of the 15th is still news (three days back)
    expect(toEmail(items.filter((i) => i.date <= '2026-01-18'), { words, today: '2026-01-18' }).map((i) => i.date)).toEqual(['2026-01-15']);
    expect(toEmail(items, { words, today: '2026-01-25', seen: [items[1].href] })).toEqual([]);
    expect(toEmail(items, { words, today: '2026-01-30' })).toEqual([]);   // Winterlicious is not winter parking
  });
  it('reads a release\'s lead from its page', () => {
    expect(releaseLead(RELEASE)).toMatch(/^The Major Snowstorm Condition and Significant Weather Event declarations, which came into effect on Sunday, January 25, will end today at 5 p\.m\./);
  });
  it('tells a declaration from its end and from a mention, for every snow release from 2022 to 2026', () => {
    for (const [kind, title, lead] of RELEASES) expect(snowstormKind(title, lead), title).toBe(kind);
    for (const [, title] of RELEASES) expect(WATCH.toronto.words.test(title), title).toBe(true);
    // the lead decides when the title doesn't say
    expect(snowstormKind('City of Toronto Winter Storm Update', 'The City of Toronto has declared a Major Snowstorm Condition starting at 7 p.m.')).toBe('declared');
    expect(snowstormKind('City of Toronto Winter Storm Update', 'The Major Snowstorm Condition declaration ended at noon today.')).toBe('ended');
  });
  it('says what was posted and which command flips the switch', () => {
    const city = { id: 'toronto', ...WATCH.toronto };
    const on = torontoEmail(city, [{ href: 'https://www.toronto.ca/news/x/', date: '2026-01-25', title: 'City of Toronto activates second Major Snow Event Response Plan of the year, declaring Major Snowstorm Condition and Significant Weather Event', kind: 'declared',
      lead: 'The City of Toronto is activating its Major Snow Event Response Plan (MSERP) and declaring a Major Snowstorm Condition and Significant Weather Event, effective immediately.' }], { state: 'waiting' });
    expect(on.subject).toBe('Toronto declared a Major Snowstorm Condition: City of Toronto activates second Major Snow Event Response Plan of the year, declaring Major Snowstorm Condition and Significant Weather Event');
    expect(on.text).toContain('node scripts/cities/winter.mjs toronto on --reason "Toronto declared a Major Snowstorm Condition."');
    expect(on.text).toContain('effective immediately');
    expect(on.text).toContain('CURB\'s switch says "waiting"');
    const off = torontoEmail(city, [{ href: 'https://www.toronto.ca/news/y/', date: '2026-02-10', title: 'Snowstorm declarations ending', kind: 'ended', lead: '' }], { state: 'on' });
    expect(off.subject).toBe('Toronto ended its Major Snowstorm Condition: Snowstorm declarations ending');
    expect(off.text).toContain('node scripts/cities/winter.mjs toronto waiting');
    expect(off.text).not.toContain('toronto on');
    const both = torontoEmail(city, [{ href: 'a', date: '2026-01-19', title: 'A', kind: 'ended' }, { href: 'b', date: '2026-01-19', title: 'B', kind: 'mentions' }], { state: 'on' });
    expect(both.subject).toBe('Toronto ended its Major Snowstorm Condition (2 releases)');
    for (const m of [on, off, both]) {
      expect(m.html).not.toMatch(/<script/);
      // the watch's own words: no dashes as punctuation, no "~" before numbers
      expect(m.text.replace(/https?:\S+/g, '').replace(/ --\w+/g, '')).not.toMatch(/[—–~]| - /);
    }
  });
});
