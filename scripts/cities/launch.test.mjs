// The multi-city launch (owner, 2026-10-20), checked on the committed files: every public city (scripts/cities/public.mjs) is
// indexable, routed, in the sitemap, on /cities and in index.html's CITY_MAPS; Boston and every other preview stay hidden;
// the generated readable pages and the hub are what their generator writes now.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PUBLIC, IN_PROGRESS, seoWords, ruleTerm } from './public.mjs';
import { cityFacts, aboutPage, hubPage } from './city-pages.mjs';
import { project, W, H } from './hub-map.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
const json = (f) => JSON.parse(read(f));
const BUILT = readdirSync(ROOT + 'data', { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${ROOT}data/${d.name}/city.json`) && existsSync(`${ROOT}data/${d.name}/segments.json`)).map((d) => d.name);
const PREVIEWS = [...new Set(['boston', ...BUILT.filter((id) => !PUBLIC.includes(id))])];   // Boston (built by hand), and any city built but not public
const sitemap = read('sitemap.xml'), vercel = json('vercel.json'), hub = read('cities.html'), home = read('index.html');
const routed = (src) => vercel.rewrites.find((r) => r.source === src);
const dataDate = (id) => String(json(`data/${id}/segments.json`)._meta.generated).slice(0, 10);

describe('the list', () => {
  it('names only built cities, once each, and holds Boston back', () => {
    expect(new Set(PUBLIC).size).toBe(PUBLIC.length);
    for (const id of PUBLIC) expect(BUILT, id).toContain(id);
    expect(PUBLIC).not.toContain('boston');
    expect(PREVIEWS).toContain('boston');
  });
});

describe('a public city', () => {
  for (const id of PUBLIC) {
    it(`${id}: an indexable map with its own title, description, canonical, card and JSON-LD`, () => {
      const page = read(`${id}.html`), c = json(`data/${id}/city.json`), seo = seoWords(c);
      expect(page).not.toMatch(/<meta name="robots" content="noindex">/);
      expect(page).not.toMatch(/\(preview\)|a CURB preview|This preview/i);
      expect(page).toContain(`<title>${seo.title.replace(/&/g, '&amp;')}</title>`);
      expect(seo.title.length).toBeLessThanOrEqual(60);
      expect(page).toContain(`<link rel="canonical" href="https://curb.guide/${id}">`);
      expect(page).toContain(`<meta property="og:image" content="https://curb.guide/og-${id}.png?v=1">`);
      expect(existsSync(`${ROOT}og-${id}.png`)).toBe(true);
      const ld = JSON.parse(page.match(/<script type="application\/ld\+json">\n([^\n]+)\n<\/script>/)[1]);
      expect(ld).toMatchObject({ '@type': 'WebApplication', url: `https://curb.guide/${id}`, name: `CURB ${c.name}` });
      expect(page).not.toContain('apple-itunes-app');   // the San Francisco app's banner
      expect(page).toContain(`<a class="wabout" href="/${id}/about">`);
      expect(json(`manifest-${id}.json`).name).toBe(`CURB ${c.name}`);
    });
    it(`${id}: routed, with a readable page, in the sitemap dated by its data`, () => {
      expect(routed(`/${id}`)).toEqual({ source: `/${id}`, destination: `/${id}.html` });
      expect(routed(`/${id}/about`)).toEqual({ source: `/${id}/about`, destination: `/${id}/about.html` });
      const about = read(`${id}/about.html`);
      expect(about).not.toContain('noindex');
      expect(about).toContain(`<link rel="canonical" href="https://curb.guide/${id}/about">`);
      expect(about).toContain(`<a class="btn" href="/${id}">Open the map →</a>`);
      for (const loc of [`https://curb.guide/${id}`, `https://curb.guide/${id}/about`])
        expect(sitemap, loc).toMatch(new RegExp(`<loc>${loc}</loc>\\s*<lastmod>${dataDate(id)}</lastmod>`));
    });
  }
});

describe('a preview (Boston, and any city not public yet)', () => {
  for (const id of PREVIEWS) {
    it(`${id}: noindex, unlisted, not in the sitemap, /cities or CITY_MAPS`, () => {
      expect(read(`${id}.html`)).toMatch(/<meta name="robots" content="noindex">/);
      expect(sitemap).not.toContain(`<loc>https://curb.guide/${id}</loc>`);
      expect(sitemap).not.toContain(`https://curb.guide/${id}/`);
      expect(hub).not.toContain(`href="/${id}"`);
      expect(home).not.toContain(`"id":"${id}"`);
    });
  }
  it('Boston\'s own pages stay noindex', () => {
    for (const f of ['boston/about.html', 'boston/fixes.html', 'boston/notes.html']) expect(read(f), f).toContain('<meta name="robots" content="noindex">');
  });
});

describe('/cities', () => {
  it('is routed, in the sitemap, and lists San Francisco and every public city with its map and page', () => {
    expect(routed('/cities')).toEqual({ source: '/cities', destination: '/cities.html' });
    expect(sitemap).toContain('<loc>https://curb.guide/cities</loc>');
    expect(hub).toContain(`Know where to park in ${PUBLIC.length + 1} cities`);
    for (const id of PUBLIC) {
      expect(hub, id).toContain(`<article class="ccard" id="${id}">`);
      expect(hub, id).toContain(`href="/${id}/about">How it works</a>`);
      expect(hub, id).toMatch(new RegExp(`<a class="pin[^"]*" href="/${id}"`));
    }
    expect(hub).toMatch(/<a class="pin home" href="\/"/);
  });
  it('shows the cities in progress until they are public, and never a person\'s name', () => {
    for (const x of IN_PROGRESS) {
      if (PUBLIC.includes(x.id)) expect(hub).not.toContain(`<b>${x.name}, ${x.region}</b>`);
      else expect(hub).toContain(`<b>${x.name}, ${x.region}</b>`);
    }
  });
  it('a pin sits where its city is on the map', () => {
    const [x, y] = project(-122.4194, 37.7749);   // San Francisco, on the west coast
    expect(x / W).toBeLessThan(0.15); expect(y / H).toBeGreaterThan(0.3); expect(y / H).toBeLessThan(0.75);
    const [mx, my] = project(-73.5901, 45.5249);   // Montréal, top right, inside the frame
    expect(mx / W).toBeGreaterThan(0.7); expect(mx).toBeLessThan(W); expect(my).toBeGreaterThan(0);
  });
  it('has the request form, its honeypot, and says what becomes public', () => {
    expect(hub).toContain('<form class="reqform" id="reqform" action="/api/city-request" method="post" novalidate>');
    expect(hub).toMatch(/name="website" tabindex="-1"/);
    expect(hub).toContain('Only to tell you when it\'s live. Never published.');
    expect(hub).toMatch(/<input type="radio" name="publishes" value="unsure" checked> Not sure/);
  });
});

describe('the generated pages are current', () => {
  const facts = PUBLIC.map(cityFacts);
  it('every <id>/about.html is what scripts/cities/city-pages.mjs writes now', () => {
    for (const f of facts) expect(read(`${f.id}/about.html`) === aboutPage(f), `${f.id}/about.html: run node scripts/cities/city-pages.mjs`).toBe(true);
  });
  it('cities.html is what it writes now', () => {
    expect(hub === hubPage(facts), 'cities.html: run node scripts/cities/city-pages.mjs').toBe(true);
  });
  it('index.html\'s CITY_MAPS is San Francisco then every public city, biggest map first (scripts/cities/configs.mjs)', () => {
    const block = home.match(/\/\* cities:start \*\/\n([\s\S]*?)\/\* cities:end \*\//)[1];
    const ids = [...block.matchAll(/"id":"([a-z-]+)"/g)].map((m) => m[1]);
    const blocks = Object.fromEntries(PUBLIC.map((id) => [id, json(`data/${id}/segments.json`).b.length]));
    expect(ids).toEqual([...PUBLIC].sort((a, b) => blocks[b] - blocks[a] || a.localeCompare(b)));
    for (const id of PUBLIC) {
      const c = json(`data/${id}/city.json`);
      expect(block).toContain(JSON.stringify({ id, name: c.name, region: c.region, path: '/' + id, center: c.center, bounds: c.bounds }));
    }
    expect(home).toContain('const CITY_MAPS=[{"id":"sf","name":"San Francisco"');
  });
  it('the words people search for each city\'s rule', () => {
    expect(ruleTerm(json('data/new-york/city.json'))).toBe('alternate side parking');
    expect(ruleTerm(json('data/philadelphia/city.json'))).toBe('street cleaning');
    expect(ruleTerm(json('data/milwaukee/city.json'))).toBe('night parking');
    expect(ruleTerm(json('data/oakland/city.json'))).toBe('street sweeping');
  });
});

describe('the Android beta (owner, 2026-10-20)', () => {
  const page = read('android.html'), site = read('site.js'), press = read('press.html');
  it('/android: the three steps to join on Google Play, routed and in the sitemap', () => {
    expect(routed('/android')).toEqual({ source: '/android', destination: '/android.html' });
    expect(sitemap).toContain('<loc>https://curb.guide/android</loc>');
    expect(page).toContain('<link rel="canonical" href="https://curb.guide/android">');
    expect(page).not.toContain('noindex');
    expect(page).toContain('anyone can join');
    const steps = [...page.matchAll(/<li>\s*<h2>([^<]+)<\/h2>[\s\S]*?<a href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(steps).toEqual([
      ['Join the CURB Android beta group', 'https://groups.google.com/g/curb-android-beta'],
      ['Become a tester on Google Play', 'https://play.google.com/apps/testing/guide.curb.android'],
      ['Install CURB from Google Play', 'https://play.google.com/store/apps/details?id=guide.curb.android'],
    ]);
    expect(page).toContain('It needs a Google account.');
    expect(page).toContain('It\'s the same map with the same alerts. Send feedback to <a href="mailto:hello@curb.guide">hello@curb.guide</a>.');
    const text = page.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\s[—–]\s|\s-\s|\w—\w/);
    expect(page).not.toMatch(/<em\b|<i>[^<]+<\/i>/);
  });
  it('every App Store link has "Android beta: join on Google Play" to /android under it', () => {
    expect(home).toMatch(/id="imGet"[\s\S]*?<\/a>\n\s*<a class="im-item" id="imPlay" style="display:none" href="\/android" role="menuitem">[\s\S]*?<b>Android beta<\/b><small>Join on Google Play<\/small>/);
    expect(home).toMatch(/id="iosGet"[^\n]*\n\s*<a class="ios-play" id="iosPlay" href="\/android">Android beta: join on Google Play<\/a>/);
    expect(home).toContain('Get the free iPhone app</a><a class="ios-play" href="/android">Android beta: join on Google Play</a></div>');
    expect(site).toContain("var ANDROID = '/android', BETA = 'Android beta: join on Google Play';");
    expect(site).toContain('+ links([[ANDROID, BETA]], 1)');   // the More and phone menus
    expect(site.match(/'<a class="sn-(?:soon|fplay)" href="' \+ ANDROID \+ '"/g)).toHaveLength(2);   // the nav, the footer
    expect(press.match(/App Store<\/a>\.(?:<\/li>)?\s*(?:<li>)?<a href="\/android">Android beta: join on Google Play<\/a>/g)).toHaveLength(2);
    for (const [f, t] of [['index.html', home], ['site.js', site], ['press.html', press]]) expect(t, f).not.toMatch(/coming soon/i);
  });
});

describe('words a person reads', () => {
  it('no dash used as punctuation and no italics in what the launch wrote (the cities\' own words and source names aside)', () => {
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const theirs = PUBLIC.flatMap((id) => { const c = json(`data/${id}/city.json`);
      return [...Object.values(c.words || {}), ...(c.sources || []).flatMap((x) => [x.name, x.license]), c.agency, c.fineNote, ...Object.values(c.holidays || {})]; })
      .filter(Boolean).map(esc).sort((a, b) => b.length - a.length);
    const texts = [hub, ...PUBLIC.map((id) => read(`${id}/about.html`))].map((h) => {
      let t = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
      expect(t).not.toMatch(/<em\b|<i>[^<]+<\/i>/);   // italics (a pin's dot is an empty <i>)
      for (const x of theirs) t = t.split(x).join(' ');
      return t.replace(/<[^>]+>/g, ' ');
    });
    for (const t of texts) expect(t).not.toMatch(/\s[—–]\s|\s-\s|\w—\w/);
  });
});
