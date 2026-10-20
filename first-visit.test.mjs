// curb.guide's first visit (index.html: CITY_MAPS, mapAt, IS_BOT, firstVisitCity; owner 2026-10-20) run in a VM with a fake
// browser: which map a location opens, who is never asked or sent anywhere, and that a visit is asked once. The real-browser
// check is scripts/check-first-visit.mjs (Chrome, the real page).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const slice = (from, to) => {
  const a = HTML.indexOf(from), b = HTML.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`index.html no longer contains ${JSON.stringify(from)}`);
  return HTML.slice(a, b + to.length);
};
const MAPS = slice('const CITY_MAPS=[', 'const CITY_FIX_MAX=20000;');
const FIRST = slice('const FIRST_VISIT=', '\n})();\n');

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const AT = { sf: [37.7596, -122.4148], chicago: [41.8818, -87.6278], hoboken: [40.744, -74.0305], newark: [40.7357, -74.1724], santaMonica: [34.0195, -118.4912],
  eastLA: [34.0239, -118.172], hollywood: [34.0928, -118.3287], montreal: [45.5017, -73.5673], boston: [42.3601, -71.0589], miami: [25.7617, -80.1918],
  berkeley: [37.8716, -122.2727], oakland: [37.8044, -122.2712] };

function maps() { const g = {}; vm.createContext(g); vm.runInContext(MAPS + '\nthis.mapAt=mapAt; this.CITY_MAPS=CITY_MAPS;', g); return g; }

// One page load: storage, user agent and the answer to the prompt are the visitor's; what the page did is recorded.
function visit({ at = 'chicago', answer = 'allow', accuracy = 30, store = {}, ua = PHONE, webdriver = false, app = false, path = '/', search = '', city = 'sf',
  embed = false, moved = false, picked = false, storage = true } = {}) {
  const did = { asked: [], replaced: null, toast: null, placed: null, tracked: [] };
  const localStorage = storage ? { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }
    : { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let dragHandler = null;
  const g = {
    localStorage, EMBED: embed, CITY: city, QS: new URLSearchParams(search), whereGen: 0,
    navigator: { userAgent: ua, webdriver, geolocation: { getCurrentPosition(ok, no, opts) {
      did.asked.push(opts);
      if (moved && dragHandler) dragHandler();
      if (picked) g.whereGen++;
      if (answer === 'deny') no({ code: 1 }); else ok({ coords: { latitude: AT[at][0], longitude: AT[at][1], accuracy } });
    } } },
    window: app ? { __curbNativeGeoInstalled: true } : {},
    location: { pathname: path, replace(p) { did.replaced = p; } },
    map: { once(ev, f) { dragHandler = f; }, off() {} },
    track: (e) => did.tracked.push(e), toastLink: (m, href, label) => { did.toast = { m, href, label }; }, placeFix: (p, quiet) => { did.placed = { p, quiet }; },
  };
  vm.createContext(g);
  vm.runInContext(MAPS + '\n' + FIRST, g);
  return { did, store };
}

describe('the map at a point', () => {
  const { mapAt } = maps();
  it('each public city, by its bounds; the smaller box when two overlap', () => {
    expect(mapAt(...AT.chicago)?.id).toBe('chicago');
    expect(mapAt(...AT.hoboken)?.id).toBe('hoboken');            // inside New York City's box too
    expect(mapAt(...AT.newark)?.id).toBe('new-york');            // New York City's box reaches into New Jersey
    expect(mapAt(...AT.santaMonica)?.id).toBe('santa-monica');   // inside Los Angeles' box
    expect(mapAt(...AT.eastLA)?.id).toBe('la-county');           // unincorporated, inside both LA boxes
    expect(mapAt(...AT.hollywood)?.id).toBe('los-angeles');
    expect(mapAt(...AT.montreal)?.id).toBe('montreal');
    expect(mapAt(...AT.berkeley)?.id).toBe('berkeley');
    expect(mapAt(...AT.sf)?.id).toBe('sf');
  });
  it('Boston (hidden) and places CURB doesn\'t map are none; a map can be left out', () => {
    expect(mapAt(...AT.boston)).toBe(null);
    expect(mapAt(...AT.miami)).toBe(null);
    expect(mapAt(...AT.oakland, 'oakland')).toBe(null);
  });
});

describe('a first visit', () => {
  it('in a public city: asked once, then that city\'s map', () => {
    const { did, store } = visit({ at: 'chicago' });
    expect(did.asked).toHaveLength(1);
    expect(did.asked[0].curbSilent).toBeUndefined();   // the browser's own prompt
    expect(did.replaced).toBe('/chicago');
    expect(store.curbCityAsk).toBe('1');
  });
  it('in San Francisco: stays, centered quietly on the visitor', () => {
    const { did } = visit({ at: 'sf' });
    expect(did.replaced).toBe(null);
    expect(did.toast).toBe(null);
    expect(did.placed.quiet).toBe(true);
  });
  it('outside every map: stays and offers the cities page', () => {
    const { did } = visit({ at: 'miami' });
    expect(did.replaced).toBe(null);
    expect(did.toast).toEqual({ m: 'CURB isn\'t in your area yet.', href: '/cities', label: 'See the cities, or request yours' });
    expect(visit({ at: 'boston' }).did.toast.href).toBe('/cities');
  });
  it('a refusal, or a fix too coarse to pick a city: stays, quietly', () => {
    for (const v of [visit({ answer: 'deny' }), visit({ accuracy: 50000 })]) {
      expect(v.did.replaced).toBe(null); expect(v.did.toast).toBe(null); expect(v.did.placed).toBe(null);
    }
  });
  it('someone who started using the map meanwhile is offered their city instead of being moved', () => {
    for (const v of [visit({ moved: true }), visit({ picked: true })]) {
      expect(v.did.replaced).toBe(null);
      expect(v.did.toast).toEqual({ m: 'You\'re in Chicago.', href: '/chicago', label: 'Open the Chicago map' });
    }
  });
});

describe('never asked, never sent anywhere', () => {
  const quiet = (v, why) => { expect(v.did.asked, why).toHaveLength(0); expect(v.did.replaced, why).toBe(null); };
  it('a later visit (asked before, or a visitor from before this)', () => {
    quiet(visit({ store: { curbCityAsk: '1' } }), 'asked before');
    quiet(visit({ store: { curbOnboarded: '1' } }), 'visited before');
  });
  it('crawlers and automated browsers', () => {
    for (const ua of ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4695.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'])
      quiet(visit({ ua }), ua);
    quiet(visit({ webdriver: true }), 'webdriver');
  });
  it('people on phones that only look like a bot are still asked', () => {
    expect(visit({ ua: 'Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20 PRO) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' }).did.replaced).toBe('/chicago');
  });
  it('the iPhone app, a city\'s own page, a shared block, a neighborhood view, an embed', () => {
    quiet(visit({ app: true }), 'the iPhone app');
    quiet(visit({ city: 'oakland', path: '/oakland' }), 'a city page');
    quiet(visit({ city: 'boston', path: '/boston' }), 'Boston');
    quiet(visit({ search: '?b=13065000' }), 'a shared block');
    quiet(visit({ search: '?bbox=-122.43,37.75,-122.40,37.77' }), 'a neighborhood');
    quiet(visit({ embed: true }), 'an embed');
  });
  it('where storage can\'t remember the ask, it is never made', () => {
    quiet(visit({ storage: false }), 'blocked storage');
  });
});
