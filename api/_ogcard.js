// Renders a per-block 1200×630 Open Graph card in the CURB transit-signage style.
// satori (object tree → SVG) + resvg (SVG → PNG); no JSX/build step. Helper, not a route.
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFileSync } from 'node:fs';

// resvg runs as WASM (no native binary to bundle on Vercel). Init once per cold start.
let _wasm;
function ensureWasm() {
  if (!_wasm) _wasm = initWasm(readFileSync(new URL('../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)));
  return _wasm;
}

const font = (file) => readFileSync(new URL('../og/fonts/' + file, import.meta.url));
const FONTS = [
  { name: 'Anton', data: font('Anton-Regular.ttf'), weight: 400, style: 'normal' },
  { name: 'Hanken', data: font('HankenGrotesk-700.ttf'), weight: 700, style: 'normal' },
];
const C = { paper: '#F2ECDF', ink: '#17150F', inkSoft: '#4A4536', red: '#C1121F', sign: '#FFFDF6' };
// minimal element helper matching satori's accepted {type, props:{style, children}} shape
const el = (type, style, children) => ({ type, props: children == null ? { style } : { style, children } });

/** data: { corridor, limits, day, window, enf } → PNG Buffer */
export async function renderCard(data) {
  const { corridor, limits, day, window, enf } = data;
  const tree = el('div', {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: C.paper, padding: 64, fontFamily: 'Hanken', fontWeight: 700, color: C.ink,
    border: `16px solid ${C.ink}`,
  }, [
    el('div', { display: 'flex', fontSize: 26, letterSpacing: 2, textTransform: 'uppercase', color: C.inkSoft }, 'San Francisco · street cleaning'),
    el('div', { display: 'flex', fontFamily: 'Anton', fontWeight: 400, fontSize: corridor.length > 16 ? 78 : 100, lineHeight: 1, marginTop: 16, textTransform: 'uppercase' }, corridor),
    limits ? el('div', { display: 'flex', fontSize: 34, color: C.inkSoft, marginTop: 8 }, limits) : null,
    el('div', { display: 'flex', marginTop: 'auto', alignItems: 'flex-end', justifyContent: 'space-between' }, [
      el('div', { display: 'flex', flexDirection: 'column', background: C.sign, border: `6px solid ${C.ink}`, borderRadius: 18, padding: '18px 28px' }, [
        el('div', { display: 'flex', fontFamily: 'Anton', fontWeight: 400, fontSize: 66, color: C.red, lineHeight: 1 }, day),
        el('div', { display: 'flex', fontFamily: 'Anton', fontWeight: 400, fontSize: 42, lineHeight: 1.15, marginTop: 2 }, window),
        el('div', { display: 'flex', fontSize: 18, letterSpacing: 3, color: C.inkSoft, marginTop: 6 }, 'STREET CLEANING'),
      ]),
      el('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }, [
        enf ? el('div', { display: 'flex', fontSize: 30, color: C.red }, `Tickets usually ~${enf}`) : null,
        el('div', { display: 'flex', fontFamily: 'Anton', fontWeight: 400, fontSize: 44, marginTop: 12 }, 'CURB'),
        el('div', { display: 'flex', fontSize: 22, color: C.inkSoft }, 'curb.guide'),
      ].filter(Boolean)),
    ]),
  ].filter(Boolean));

  await ensureWasm();
  const svg = await satori(tree, { width: 1200, height: 630, fonts: FONTS });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng());
}
