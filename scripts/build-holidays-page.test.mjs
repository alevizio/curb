// /holidays (holidays.html, built by scripts/build-holidays-page.mjs): the committed page must be exactly what
// the holiday tables in lib/sweep-core.js produce, so it can never list a day the map doesn't skip (or miss
// one it does). Plus the browser script that picks the next holiday, and the links that lead to the page.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../lib/sweep-core.js';
import { renderHolidaysPage, holidayRows, PAGE_JS, SFMTA_URL } from './build-holidays-page.mjs';

const { HOL_DAY, HOL_NIGHT, HOL_NAMES } = globalThis;
const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const page = read('holidays.html');
const un = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const ROW = /<tr data-date="([^"]+)" data-night="([01])" data-name="([^"]*)"><td class="hd"><time datetime="([^"]+)">([^<]+)<\/time><\/td><td class="hn">(.*?)<\/td><td class="hx (on|off)">([^<]+)<\/td><\/tr>/g;
const rows = [...page.matchAll(ROW)].map(([, date, night, dataName, datetime, shown, nameCell, cls, routes]) => ({
  date, night, dataName: un(dataName), datetime, shown, name: un(nameCell.replace(/ <span class="obs">observed<\/span>$/, '')),
  observed: nameCell.endsWith('<span class="obs">observed</span>'), cls, routes }));
const visible = un(page.split('<body>')[1].replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' '));

afterEach(() => { vi.useRealTimers(); });

describe('holidays.html', () => {
  it('is exactly what the build makes from the tables (after changing them, run npm run build:holidays)', () => {
    expect(page).toBe(renderHolidaysPage());
  });

  it('lists exactly the table\'s dates and names, in order, each once', () => {
    expect(rows.map((r) => r.date)).toEqual([...HOL_DAY].sort());
    for (const r of rows) {
      expect(r.datetime, r.date).toBe(r.date);
      expect(r.name, r.date).toBe(HOL_NAMES[r.date]);
      expect(r.dataName, r.date).toBe(HOL_NAMES[r.date]);
    }
  });

  it('says which days overnight and 7-day routes still sweep, straight from HOL_NIGHT', () => {
    for (const r of rows) {
      const night = HOL_NIGHT.has(r.date);
      expect([r.night, r.cls, r.routes], r.date).toEqual(night ? ['1', 'off', 'Not swept'] : ['0', 'on', 'Still swept']);
    }
    expect(rows.filter((r) => r.night === '1').map((r) => r.date)).toEqual([...HOL_NIGHT].sort());
    // the explainer names the holidays the night routes stop for, from the same table
    expect(visible).toContain("They stop only on New Year's Day, Thanksgiving and Christmas.");
  });

  it('prints the right weekday and date for every row', () => {
    for (const r of rows) {
      const want = new Date(r.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      expect(r.shown, r.date).toBe(want);
    }
  });

  it('tags the weekday a weekend holiday is observed on, and nothing else', () => {
    const obs = rows.filter((r) => r.observed).map((r) => r.date);
    expect(obs).toContain('2026-07-03');    // Independence Day on a Saturday → Friday
    expect(obs).toContain('2027-12-31');    // New Year's Day 2028 on a Saturday → Friday before
    expect(obs).toContain('2028-11-10');    // Veterans Day on a Saturday
    for (const d of ['2026-07-04', '2027-12-25', '2026-11-27', '2027-01-18']) expect(obs).not.toContain(d);
    expect(rows.filter((r) => r.observed).every((r) => ["New Year's Day", 'Juneteenth', 'Independence Day', 'Veterans Day', 'Christmas'].includes(r.name))).toBe(true);
  });

  it('groups the list by year and flags the years derived by SFMTA\'s rule', () => {
    const years = [...page.matchAll(/<div class="yr" id="y(\d{4})">\s*<h3>\d{4}( <span class="rule-chip">)?/g)].map((m) => [m[1], !!m[2]]);
    expect(years).toEqual([['2026', false], ['2027', true], ['2028', true], ['2029', true]]);
    expect(visible).toContain('The 2026 dates are SFMTA\'s posted schedule. Dates in 2027 and 2028 follow SFMTA\'s rule and will be re-checked when SFMTA posts them.');
    expect(page).toContain(`<a href="${SFMTA_URL}" rel="noopener">SFMTA's holiday enforcement schedule</a>`);
  });

  it('has a search title under 60 chars, a description under 160, its canonical URL and the site chrome', () => {
    const title = un(page.match(/<title>(.*?)<\/title>/)[1]);
    expect(title).toBe('SF Street Sweeping Holidays 2026 to 2028 | CURB');
    expect(title.length).toBeLessThan(60);
    expect(un(page.match(/name="description" content="(.*?)"/)[1]).length).toBeLessThanOrEqual(160);
    expect(page).toContain('<link rel="canonical" href="https://curb.guide/holidays">');
    expect(page).toContain('<meta property="og:url" content="https://curb.guide/holidays">');
    expect(page).toContain('<link rel="stylesheet" href="/site.css">');
    expect(page).toContain('<script src="/site.js" defer></script>');
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(ld['@type']).toBe('BreadcrumbList');
  });

  it('follows the copy rules: no dashes as punctuation, no italics, nothing about other parking rules', () => {
    expect(visible).not.toMatch(/[—–]| - /);
    expect(page).not.toMatch(/<(i|em)\b|italic/);
    expect(visible).not.toMatch(/\b(meters?|permits?|RPP)\b/i);
    expect(visible).toContain('The posted sign is always the source of truth.');
  });

  it('keeps the next holiday card hidden until the script fills it, so the page works without JavaScript', () => {
    expect(page).toMatch(/<section class="next" id="next" [^>]*hidden>/);
    expect(page).toContain(PAGE_JS);
  });

  it('refuses to build when the tables disagree', () => {
    HOL_NIGHT.add('2030-01-01');
    try { expect(() => holidayRows()).toThrow(/not in HOL_DAY/); } finally { HOL_NIGHT.delete('2030-01-01'); }
  });
});

// PAGE_JS against a minimal DOM: the rows as the page renders them, the card's elements by id.
function runPage(nowMs) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(nowMs));
  const trs = holidayRows().map((r) => {
    const tr = { attrs: { 'data-date': r.iso, 'data-night': r.night ? '1' : '0', 'data-name': r.name }, cls: new Set() };
    tr.getAttribute = (k) => tr.attrs[k] ?? null;
    tr.setAttribute = (k, v) => { tr.attrs[k] = v; };
    tr.classList = { add: (c) => tr.cls.add(c) };
    return tr;
  });
  const els = {};
  const document = { querySelectorAll: () => trs, getElementById: (id) => (els[id] ||= { textContent: '', hidden: true }) };
  vm.runInNewContext(PAGE_JS, { document, Date, Intl });
  const marked = (c) => trs.filter((t) => t.cls.has(c)).map((t) => t.attrs['data-date']);
  return { els, marked, trs };
}

describe('holidays page script', () => {
  it('mutes past dates and spells out the next holiday', () => {
    const { els, marked } = runPage(Date.UTC(2026, 9, 5, 19, 0)); // Mon Oct 5 2026, noon PDT
    expect(marked('is-past')).toEqual(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-07-04', '2026-09-07']);
    expect(marked('is-next')).toEqual(['2026-10-12']);
    expect(els.next.hidden).toBe(false);
    expect([els.nxK.textContent, els.nxName.textContent, els.nxMon.textContent, els.nxDay.textContent, els.nxDow.textContent])
      .toEqual(['Next sweeping holiday', 'Indigenous Peoples Day', 'Oct', '12', 'Mon']);
    expect(els.nxWhen.textContent).toBe('Monday, October 12, 2026 · in 7 days');
    expect(els.nxNight.textContent).toBe('No daytime sweeping. Overnight and 7-day routes still sweep.');
  });

  it('uses the San Francisco date, not the device\'s UTC date', () => {
    const { els, marked } = runPage(Date.UTC(2026, 10, 26, 6, 30)); // Nov 26 in UTC, still 10:30pm Nov 25 in SF
    expect(marked('is-next')).toEqual(['2026-11-26']);
    expect(marked('is-today')).toEqual([]);
    expect(els.nxWhen.textContent).toBe('Thursday, November 26, 2026 · tomorrow');
  });

  it('on the holiday itself says Today, and when night routes stop too', () => {
    const { els, marked, trs } = runPage(Date.UTC(2026, 10, 26, 20, 0)); // Thanksgiving, noon PST
    expect(marked('is-today')).toEqual(['2026-11-26']);
    expect(marked('is-past')).not.toContain('2026-11-26');
    expect(trs.find((t) => t.attrs['data-date'] === '2026-11-26').attrs['aria-current']).toBe('date');
    expect(els.nxK.textContent).toBe('Today');
    expect(els.nxWhen.textContent).toBe('Thursday, November 26, 2026 · today');
    expect(els.nxNight.textContent).toBe('No street sweeping at all, overnight and 7-day routes included.');
  });

  it('after the last listed date the card stays hidden and every row is muted', () => {
    const { els, marked } = runPage(Date.UTC(2029, 0, 2, 20, 0));
    expect(marked('is-past')).toHaveLength(HOL_DAY.size);
    expect(els.next).toBeUndefined();
  });
});

describe('links to /holidays', () => {
  it('is routed, in the sitemap and its generator, the site menu and footer, and the map\'s info menu', () => {
    expect(JSON.parse(read('vercel.json')).rewrites).toContainEqual({ source: '/holidays', destination: '/holidays.html' });
    expect(read('sitemap.xml')).toContain('<loc>https://curb.guide/holidays</loc>');
    expect(read('scripts/build-hood-pages.mjs')).toContain("['https://curb.guide/holidays', 'monthly', '0.6', 'holidays.html']");
    const site = read('site.js');
    expect(site).toContain("['/holidays', 'Sweeping holidays']");
    expect(site).toContain('<a href="/holidays">Sweeping holidays</a>');
    expect(read('index.html')).toMatch(/<div class="infomenu" id="infoMenu"[\s\S]*<a class="im-item" href="\/holidays" role="menuitem">[\s\S]*<\/div>/);
  });
});
