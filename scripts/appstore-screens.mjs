#!/usr/bin/env node
// App Store screenshot framer — raw iPhone captures + captions -> branded 1290x2796 marketing PNGs.
// satori (SVG) -> @resvg/resvg-wasm (PNG). Same pipeline as the trailer; brand from og/fonts.
//   node scripts/appstore-screens.mjs scripts/appstore-screens.config.json out/
// 1290x2796 = the iPhone 6.7" App Store size (mandatory). Raw 6.7" iPhone screenshots are already
// 1290x2796, so they're scaled to ~85% width to leave room for the headline.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as presolve, isAbsolute } from 'node:path';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = presolve(HERE, '..');
const cfgPath = process.argv[2], outDir = process.argv[3] || './appstore-out';
if (!cfgPath || !existsSync(cfgPath)) { console.error('Usage: node appstore-screens.mjs <config.json> <outDir>'); process.exit(1); }

const reqCwd = createRequire(pathToFileURL(process.cwd() + '/').href);
const pickFn = (m) => typeof m === 'function' ? m : typeof m?.default === 'function' ? m.default : m?.default?.default;
const pickKey = (m, k) => m?.[k] ?? m?.default?.[k] ?? m?.default?.default?.[k];
let satori, initWasm, Resvg;
try {
  satori = pickFn(await import(pathToFileURL(reqCwd.resolve('satori')).href));
  const rv = await import(pathToFileURL(reqCwd.resolve('@resvg/resvg-wasm')).href);
  initWasm = pickKey(rv, 'initWasm'); Resvg = pickKey(rv, 'Resvg');
  await initWasm(readFileSync(reqCwd.resolve('@resvg/resvg-wasm/index_bg.wasm')));
} catch { console.error('Run from a dir with deps:  npm i satori @resvg/resvg-wasm  (ffmpeg also required)'); process.exit(1); }
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.error('ffmpeg not on PATH'); process.exit(1); }

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const cfgDir = dirname(presolve(cfgPath));
const asset = (p) => (isAbsolute(p) ? p : presolve(cfgDir, p));
const FONTS = [
  { name: 'Display', data: readFileSync(presolve(ROOT, 'og/fonts/Anton-Regular.ttf')), weight: 400, style: 'normal' },
  { name: 'Body', data: readFileSync(presolve(ROOT, 'og/fonts/HankenGrotesk-700.ttf')), weight: 700, style: 'normal' },
];
const [W, H] = cfg.size || [1290, 2796];
const C = { light: cfg.brand?.colors?.[1] || '#F2ECDF', ink: cfg.brand?.colors?.[2] || '#17150F', accent: cfg.brand?.colors?.[0] || '#C1121F', sign: '#FFFDF6' };
const sane = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️]/gu, '').trim();

const TMP = presolve(os.tmpdir(), 'as-' + process.pid); mkdirSync(TMP, { recursive: true });
let _n = 0;
function loadImg(p) {
  const src = asset(p);
  if (!existsSync(src)) { console.error(`! screenshot not found: ${p}`); process.exit(1); }
  const norm = presolve(TMP, `n${_n++}.png`);
  try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, norm]); } catch {}
  const fp = existsSync(norm) ? norm : src;
  let w = 9, h = 19;
  try { [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', fp]).toString().trim().split('x').map(Number); } catch {}
  return { uri: `data:image/png;base64,${readFileSync(fp).toString('base64')}`, w: w || 9, h: h || 19 };
}
const el = (t, s, c) => ({ type: t, props: c === undefined ? { style: s } : { style: s, children: c } });

mkdirSync(outDir, { recursive: true });
let i = 0;
for (const sc of (cfg.screens || [])) {
  i++;
  const shot = loadImg(sc.image);
  const padW = Math.round(W * 0.07);
  const maxImgW = W - padW * 2, maxImgH = Math.round(H * 0.68);
  let iw = maxImgW, ih = Math.round(iw * shot.h / shot.w);
  if (ih > maxImgH) { ih = maxImgH; iw = Math.round(ih * shot.w / shot.h); }
  const tree = el('div', { display: 'flex', flexDirection: 'column', width: W, height: H, background: sc.dark ? C.ink : C.light, alignItems: 'center', justifyContent: 'space-between', padding: padW, fontFamily: 'Body' }, [
    el('div', { display: 'flex', fontFamily: 'Display', fontSize: Math.round(W * 0.072), color: sc.dark ? C.light : C.ink, lineHeight: 1.04, textAlign: 'center', marginTop: Math.round(H * 0.035), maxWidth: W - padW * 2 }, sane(sc.caption || '')),
    el('div', { display: 'flex', padding: 12, background: C.sign, border: `6px solid ${C.ink}`, borderRadius: 38, boxShadow: `20px 20px 0 ${C.accent}` },
      [{ type: 'img', props: { src: shot.uri, width: iw, height: ih, style: { width: iw, height: ih, borderRadius: 26 } } }]),
  ]);
  const svg = await satori(tree, { width: W, height: H, fonts: FONTS });
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
  const rendered = r.render(); writeFileSync(`${outDir}/screen-${i}.png`, Buffer.from(rendered.asPng())); rendered.free?.(); r.free?.();
  console.log(`✓ ${outDir}/screen-${i}.png  ${W}x${H}`);
}
