// CURB launch trailer generator — "22 Minutes".
// satori (element tree → SVG) → @resvg/resvg-wasm (SVG → PNG) → ffmpeg (PNG frames → MP4).
// Mirrors the OG-card pipeline (api/_ogcard.js); fonts from og/fonts. Lives in the repo so the
// source is never lost again (the prior generator died in /tmp).
//
// Usage (from repo root):
//   node scripts/social/build-trailer.mjs keys     # 1 frame per beat → /tmp/kf_*.png (fast preview)
//   node scripts/social/build-trailer.mjs 16x9      # full render → ~/Downloads/curb-social/curb-trailer-16x9.mp4
//   node scripts/social/build-trailer.mjs 9x16
//   node scripts/social/build-trailer.mjs all
import satori from 'satori';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ROOT = new URL('../../', import.meta.url);
const rd = (p) => readFileSync(new URL(p, ROOT));
await initWasm(rd('node_modules/@resvg/resvg-wasm/index_bg.wasm'));

const FONTS = [
  { name: 'Anton', data: rd('og/fonts/Anton-Regular.ttf'), weight: 400, style: 'normal' },
  { name: 'Hanken', data: rd('og/fonts/HankenGrotesk-700.ttf'), weight: 700, style: 'normal' },
];

// ---- brand ----
const C = {
  paper: '#F2ECDF', ink: '#17150F', inkSoft: '#5A5446', sign: '#FFFDF6',
  red: '#C1121F', green: '#2E9E5A', amber: '#E8A33D', cream: '#FDF0D5',
};
const FPS = 30;

// embedded raster assets as data URIs
const dataURI = (p, mime = 'image/png') => `data:${mime};base64,${rd(p).toString('base64')}`;
const APP = dataURI('scripts/social/assets/app.png');
const APP_W = 1400, APP_H = 813;
// cube logo for the outro (pre-normalized PNG asset — satori's PNG parser is picky about resvg output)
const LOGO = dataURI('scripts/social/assets/logo.png');
// a small white check (normalized PNG asset; satori dislikes raw resvg-wasm PNG output)
const CHECK = dataURI('scripts/social/assets/check.png');

// ---- easing / timing ----
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
// reveal: progress p mapped onto [a,b], eased
const rev = (p, a, b, ease = easeOut) => ease(clamp((p - a) / (b - a)));
// in/out opacity envelope for an element
const env = (p, inA, inB, outA = 2, outB = 3) => Math.min(rev(p, inA, inB), 1 - rev(p, outA, outB, (t) => t));

// satori element helpers
const el = (type, style, children) => ({ type, props: children === undefined ? { style } : { style, children } });
const img = (src, w, h, style = {}) => ({ type: 'img', props: { src, width: w, height: h, style: { width: w, height: h, ...style } } });
// a vertically-rising, fading line
const rise = (p, inA, inB, dy, style, children) => el('div', {
  display: 'flex', opacity: clamp(env(p, inA, inB)), transform: `translateY(${(1 - rev(p, inA, inB)) * dy}px)`, ...style,
}, children);

// ---- the trailer: ordered beats, each (p, W, H) → content array (centered column) ----
const beats = [
  // 1 · THE SIGN — "you've got two hours"
  { dur: 3.0, bg: C.paper, render: (p, W, H) => [
    rise(p, 0, 0.3, 40, { flexDirection: 'column', alignItems: 'center', background: C.sign, border: `10px solid ${C.ink}`, borderRadius: 22, padding: '44px 72px', boxShadow: `14px 14px 0 ${C.ink}` }, [
      el('div', { display: 'flex', fontFamily: 'Hanken', fontWeight: 700, fontSize: 40, letterSpacing: 6, color: C.red }, 'STREET CLEANING'),
      el('div', { display: 'flex', fontFamily: 'Anton', fontSize: 150, color: C.ink, lineHeight: 1, marginTop: 8 }, '8 - 10 AM'),
      el('div', { display: 'flex', fontFamily: 'Hanken', fontWeight: 700, fontSize: 38, letterSpacing: 4, color: C.inkSoft, marginTop: 8 }, 'EVERY FRIDAY'),
    ]),
    rise(p, 0.4, 0.6, 26, { marginTop: 56, fontFamily: 'Hanken', fontWeight: 700, fontSize: 54, color: C.inkSoft }, "So you've got two hours. Right?"),
  ] },

  // 2 · THE TRUTH — 2 hours is really 22 minutes
  { dur: 4.0, bg: C.paper, render: (p, W, H) => {
    const shrink = rev(p, 0.18, 0.42, easeBack);        // 1→0 collapse of the window bar
    const trackW = Math.min(1180, W - 120), fillW = lerp(trackW, Math.min(210, trackW * 0.18), shrink);
    const fillCol = shrink > 0.5 ? C.red : C.amber;
    return [
      el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
        // the window bar (track + shrinking fill)
        el('div', { display: 'flex', width: trackW, height: 70, background: '#E4DCC9', border: `5px solid ${C.ink}`, borderRadius: 12, alignItems: 'center' }, [
          el('div', { display: 'flex', width: fillW, height: '100%', background: fillCol, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
            el('div', { display: 'flex', fontFamily: 'Hanken', fontWeight: 700, fontSize: 30, color: shrink > 0.5 ? C.sign : C.ink, opacity: clamp(Math.abs(shrink - 0.5) * 2) }, shrink > 0.5 ? '22 MIN' : '2 HOURS')),
        ]),
        rise(p, 0.42, 0.6, 30, { marginTop: 44, fontFamily: 'Anton', fontSize: W < 1400 ? 150 : 200, color: C.ink, lineHeight: 0.95 }, '22 MINUTES'),
        rise(p, 0.58, 0.74, 22, { marginTop: 10, fontFamily: 'Hanken', fontWeight: 700, fontSize: 46, color: C.inkSoft, maxWidth: Math.min(1180, W - 100), textAlign: 'center' }, 'On the median SF block, every ticket lands in the same 22 minutes.'),
      ]),
    ];
  } },

  // 3 · THE SCALE — the proof numbers
  { dur: 3.0, bg: C.ink, render: (p, W, H) => {
    const stat = (i, big, small, col) => rise(p, 0.05 + i * 0.16, 0.25 + i * 0.16, 34, { flexDirection: 'column', alignItems: 'center', marginTop: i ? 30 : 0 }, [
      el('div', { display: 'flex', fontFamily: 'Anton', fontSize: 132, color: col, lineHeight: 0.95 }, big),
      el('div', { display: 'flex', fontFamily: 'Hanken', fontWeight: 700, fontSize: 38, letterSpacing: 3, color: C.paper, marginTop: 2 }, small),
    ]);
    return [el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      stat(0, '656,000', 'STREET-CLEANING TICKETS', C.cream),
      stat(1, '$105', "EACH. SF'S #1 TICKET", C.red),
    ])];
  } },

  // 4 · THE MAP — the product
  { dur: 4.0, bg: C.paper, render: (p, W, H) => {
    const cardW = Math.min(1180, W - 160), cardH = Math.round(cardW * APP_H / APP_W);
    const dot = (col, label) => el('div', { display: 'flex', alignItems: 'center', marginRight: 30 }, [
      el('div', { display: 'flex', width: 26, height: 26, borderRadius: 13, background: col, border: `3px solid ${C.ink}` }),
      el('div', { display: 'flex', fontFamily: 'Hanken', fontWeight: 700, fontSize: 32, color: C.ink, marginLeft: 10 }, label),
    ]);
    return [el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      rise(p, 0, 0.25, 28, { fontFamily: 'Anton', fontSize: 92, color: C.ink, lineHeight: 1, textAlign: 'center', maxWidth: Math.min(1300, W - 80) }, 'EVERY CURB, COLORED BY ITS NEXT SWEEP'),
      rise(p, 0.2, 0.45, 36, { marginTop: 28, padding: 10, background: C.sign, border: `8px solid ${C.ink}`, borderRadius: 22, boxShadow: `12px 12px 0 ${C.ink}` },
        img(APP, cardW, cardH, { borderRadius: 12 })),
      rise(p, 0.5, 0.65, 18, { marginTop: 24 }, [dot(C.green, 'CLEAR'), dot(C.amber, 'SOON'), dot(C.red, 'NOW')]),
    ])];
  } },

  // 5 · THE SAVE — alerts
  { dur: 4.0, bg: C.paper, render: (p, W, H) => {
    // zoom card into the detail-sheet region of the screenshot (left card)
    const portrait = H > W;
    const cardW = 760, cardH = 560, scale = 1.95;
    const dispW = Math.round(APP_W * scale), dispH = Math.round(APP_H * scale);
    return [el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      rise(p, 0, 0.25, 28, { fontFamily: 'Anton', fontSize: 96, color: C.ink, lineHeight: 1, textAlign: 'center', maxWidth: Math.min(1300, W - 80) }, 'MOVE YOUR CAR FIRST'),
      el('div', { display: 'flex', marginTop: 30, alignItems: 'center', flexDirection: portrait ? 'column' : 'row' }, [
        rise(p, 0.2, 0.45, 30, { width: cardW, height: cardH, overflow: 'hidden', background: C.sign, border: `8px solid ${C.ink}`, borderRadius: 22, boxShadow: `12px 12px 0 ${C.ink}`, position: 'relative' },
          img(APP, dispW, dispH, { position: 'absolute', left: -95, top: -560 })),
        el('div', { display: 'flex', flexDirection: 'column', alignItems: portrait ? 'center' : 'flex-start', marginLeft: portrait ? 0 : 44, marginTop: portrait ? 40 : 0, maxWidth: portrait ? Math.min(820, W - 120) : 460 }, [
          rise(p, 0.5, 0.64, 0, { alignItems: 'center', background: C.green, border: `5px solid ${C.ink}`, borderRadius: 60, padding: '16px 34px', fontFamily: 'Hanken', fontWeight: 700, fontSize: 44, color: C.sign, opacity: clamp(rev(p, 0.5, 0.64, easeBack)) }, [img(CHECK, 40, 40, { marginRight: 14 }), el('div', { display: 'flex' }, 'Alerts on')]),
          rise(p, 0.6, 0.76, 22, { marginTop: 26, fontFamily: 'Hanken', fontWeight: 700, fontSize: 42, color: C.inkSoft, textAlign: portrait ? 'center' : 'left' }, 'A heads-up the night before, and ~30 min before the truck.'),
        ]),
      ]),
    ])];
  } },

  // 6 · OUTRO
  { dur: 2.6, bg: C.ink, render: (p, W, H) => [
    el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center' }, [
      rise(p, 0, 0.3, 20, {}, img(LOGO, 224, 243)),
      rise(p, 0.12, 0.4, 24, { marginTop: 18, fontFamily: 'Anton', fontSize: 150, color: C.paper, lineHeight: 1 }, 'CURB'),
      rise(p, 0.28, 0.52, 20, { marginTop: 8, fontFamily: 'Hanken', fontWeight: 700, fontSize: 42, letterSpacing: 2, color: C.inkSoft }, 'FREE. OPEN SOURCE.'),
      rise(p, 0.42, 0.64, 16, { marginTop: 14, fontFamily: 'Anton', fontSize: 72, color: C.red }, 'curb.guide'),
    ]),
  ] },
];

// cumulative starts + total
let T = 0; const starts = beats.map((b) => { const s = T; T += b.dur; return s; }); const TOTAL = T;

// build the full-frame tree at absolute time `t`
function frame(t, W, H) {
  let i = beats.length - 1; while (i > 0 && t < starts[i]) i--;
  const b = beats[i]; const p = clamp((t - starts[i]) / b.dur);
  const content = b.render(p, W, H);
  const kids = [el('div', { display: 'flex', width: W, height: H, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }, content)];
  // sweeper wipe across each interior beat boundary (red panel slides L→R, fully covering at the cut)
  for (let k = 1; k < beats.length; k++) {
    const bd = starts[k]; const half = 0.18;
    if (t > bd - half && t < bd + half) {
      const tp = (t - (bd - half)) / (2 * half); // 0..1
      kids.push(el('div', { position: 'absolute', top: 0, left: lerp(-W, W, tp), width: W, height: H, background: C.red }));
    }
  }
  // opening wipe-off
  if (t < 0.18) kids.push(el('div', { position: 'absolute', top: 0, left: lerp(0, W, t / 0.18), width: W, height: H, background: C.red }));
  return el('div', { display: 'flex', position: 'relative', width: W, height: H, background: b.bg, fontFamily: 'Hanken' }, kids);
}

async function renderPNG(tree, W, H) {
  const svg = await satori(tree, { width: W, height: H, fonts: FONTS });
  // free the wasm-side objects every frame — otherwise resvg's linear memory grows until it
  // panics ("unreachable") mid-render (~480 frames in). _ogcard renders once/request so never hit it.
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: W } });
  const rendered = r.render();
  const png = Buffer.from(rendered.asPng());
  rendered.free(); r.free();
  return png;
}

const OUT = `${os.homedir()}/Downloads/curb-social`;
const FORMATS = { '16x9': [1920, 1080], '9x16': [1080, 1920] };

async function renderKeys() {
  const [W, H] = FORMATS['16x9'];
  for (let k = 0; k < beats.length; k++) {
    const t = starts[k] + beats[k].dur * 0.7;
    try { writeFileSync(`/tmp/kf_${k + 1}.png`, await renderPNG(frame(t, W, H), W, H)); process.stdout.write(`kf${k + 1}:ok  `); }
    catch (e) { process.stdout.write(`kf${k + 1}:FAIL(${e.message})  `); }
  }
  console.log('\n→ /tmp/kf_1..6.png');
}

async function renderVideo(fmt) {
  const [W, H] = FORMATS[fmt];
  const dir = `/tmp/curbtrailer_${fmt}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const N = Math.round(TOTAL * FPS);
  for (let f = 0; f < N; f++) {
    writeFileSync(`${dir}/${String(f).padStart(4, '0')}.png`, await renderPNG(frame(f / FPS, W, H), W, H));
    if (f % 30 === 0) process.stdout.write(`${fmt} ${f}/${N}\r`);
  }
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const out = `${OUT}/curb-trailer-${fmt}.mp4`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.png`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n✓ ${out}`);
}

const mode = process.argv[2] || 'keys';
if (mode === 'keys') await renderKeys();
else if (mode === 'scan') {
  const [W, H] = FORMATS['16x9']; const N = Math.round(TOTAL * FPS); let fails = 0;
  for (let f = 0; f < N; f++) {
    try { await renderPNG(frame(f / FPS, W, H), W, H); }
    catch (e) { fails++; if (fails <= 14) console.log(`FAIL f=${f} t=${(f / FPS).toFixed(3)}: ${e.message}`); }
  }
  console.log(`scan done — ${fails}/${N} frames failed`);
}
else if (mode === 'all') { for (const f of Object.keys(FORMATS)) await renderVideo(f); }
else await renderVideo(mode);
