// The script retry + "CURB didn't load" message in index.html, run in a VM with a fake DOM. The real-browser
// check is scripts/check-load-guard.mjs (Chrome); this pins what Chrome cannot show: the retry must ask for
// a DIFFERENT URL than the tag that failed, because Safari reuses a failed load for the same URL.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const srcOf = (re) => HTML.match(new RegExp(`<script src="([^"]*${re}[^"]*)"></script>`))[1];
const LEAFLET = srcOf('/leaflet\\.min\\.js'), CORE = srcOf('/lib/sweep-core\\.js');
// The two inline scripts right after the time core's tag: the retry, then the message.
const after = HTML.slice(HTML.indexOf(`<script src="${CORE}"></script>`));
const [retry, message] = [...after.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].slice(0, 2).map((m) => m[1]);

function page({ L, core }) {
  const written = [], el = (id) => (els[id] ||= { id, style: {}, inert: false, tagName: 'DIV', classList: { set: new Set(), add(c) { this.set.add(c); } }, focus() { focused = id; } });
  const els = {}; let focused = null;
  const tags = { 'script[src*="/leaflet.min.js"]': LEAFLET, 'script[src^="/lib/sweep-core.js"]': CORE };
  const document = {
    write: (h) => written.push(h),
    querySelector: (sel) => ({ getAttribute: () => tags[sel] }),
    getElementById: el,
    body: { children: [el('top'), el('map'), el('loadFail'), { tagName: 'SCRIPT', inert: false }] },
  };
  const window = { L, nextSweep: core };
  const g = { window, document, location: { reload() {} } };
  vm.createContext(g);
  return { run: (code) => vm.runInContext(code, g), written, els, get focused() { return focused; } };
}
const writtenSrc = (h) => h.match(/src="([^"]+)"/)[1];

describe('load guard', () => {
  it('both scripts loaded: no retry, no message', () => {
    const p = page({ L: {}, core: () => {} });
    p.run(retry); p.run(message);
    expect(p.written).toEqual([]);
    expect(p.els.loadFail?.classList.set.has('open') ?? false).toBe(false);
  });

  it('a missing script is asked for again at a different URL for the same file, before the main script', () => {
    for (const [L, core, want] of [[undefined, () => {}, [LEAFLET]], [{}, undefined, [CORE]], [undefined, undefined, [LEAFLET, CORE]]]) {
      const p = page({ L, core });
      p.run(retry);
      const urls = p.written.map(writtenSrc);
      expect(urls).toHaveLength(want.length);
      urls.forEach((u, i) => {
        expect(u).not.toBe(want[i]);
        expect(u.split('?')[0]).toBe(want[i].split('?')[0]);
        expect(u).toMatch(/[?&]retry=1$/);
      });
      expect(p.written.every((h) => h.endsWith('<\/script>'))).toBe(true);
    }
  });

  it('still missing after the retry: the message opens, focused, with the page behind it inert and the hint hidden', () => {
    const p = page({ L: undefined, core: () => {} });
    p.run(message);
    expect(p.els.loadFail.classList.set.has('open')).toBe(true);
    expect(p.focused).toBe('loadFailGo');
    expect(p.els.top.inert && p.els.map.inert).toBe(true);
    expect(p.els.loadFail.inert).toBe(false);
    expect(p.els.hint.style.display).toBe('none');
  });
});
