// Charts and the logo for the weekly email, as PNG buffers the email embeds inline (cid:). Each chart
// is drawn as SVG in 480 design units and rendered 1200 px wide with resvg (2x for the ~556 px it shows
// at on a desktop). A phone shrinks it to ~322 px, 0.67 px a unit, so labels are 17 to 18 units (about
// 12 px there; 11.5 read as 8 px) and a 67 unit day slot fits 'Oct 10' (50 units at 17) but not
// 'not in yet' on one line (71), which is why that one wraps. Each chart sits on
// an opaque sign-white card, so clients that invert colors in dark mode leave it readable. Fonts are
// CURB's own (og/fonts), never system fonts, so the PNG looks the same on every runner.
//
// Used by render.mjs; not run on its own. No env vars, no network.
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
export const WIDTH = 480;   // design units
export const PNG_WIDTH = 1200;
export const CHART_HEIGHT = { visitors: 240, clicks: 190 }; // design units, so the email can size each <img>
const C = { sign: '#FFFDF6', ink: '#17150F', soft: '#4A4536', gray: '#8C8678', ghost: '#E4DBC9' };
const SANS = 'Hanken Grotesk';
const DISPLAY = 'Anton';

// resvg runs as WASM: init once per process (same pattern as api/_ogcard.js). Another module in the same
// process may have initialised it already, which resvg reports as an error we can ignore.
let _wasm;
function ensureWasm() {
  if (!_wasm) {
    _wasm = initWasm(readFileSync(new URL('node_modules/@resvg/resvg-wasm/index_bg.wasm', ROOT)))
      .catch((e) => { if (!/already initialized/i.test(e?.message)) throw e; });
  }
  return _wasm;
}
let _fonts;
const fonts = () => (_fonts ||= ['Anton-Regular.ttf', 'HankenGrotesk-700.ttf'].map((f) => readFileSync(new URL('og/fonts/' + f, ROOT))));

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fmt = new Intl.NumberFormat('en-US');
const num = (v) => (v == null || !Number.isFinite(+v) ? null : +v);

/** 'YYYY-MM-DD' → { day: 'WED', date: 'Oct 7' } (the date is a calendar day, so plain UTC math is exact). */
export function dayLabel(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return {
    day: d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }).toUpperCase(),
    date: d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }),
  };
}

/**
 * Pure: a daily bar chart as SVG. cur and prev are arrays aligned with days (null = no data yet).
 * Last week, when given, is a wider, lighter ghost bar behind each day's bar, so a day that did better
 * last week shows the ghost poking out above it. The value sits on top of each bar.
 */
export function barChartSvg({ days, cur, prev = null, height = 240, legend = { cur: 'This week', prev: 'Last week' } }) {
  const top = 42, bottom = height - 50, left = 4, right = WIDTH - 4;
  const slot = (right - left) / days.length;
  const values = [...cur, ...(prev || [])].map(num).filter((v) => v != null);
  const max = Math.max(1, ...values);
  const room = 28; // space above the tallest bar for its value
  const h = (v) => Math.max(v > 0 ? 3 : 0, Math.round((v / max) * (bottom - top - room)));
  const out = [];
  out.push(`<rect width="${WIDTH}" height="${height}" fill="${C.sign}"/>`);
  // legend, top left
  out.push(`<rect x="${left}" y="5" width="16" height="16" rx="3" fill="${C.ink}"/>`,
    `<text x="${left + 23}" y="19" font-family="${SANS}" font-size="18" fill="${C.soft}">${xml(legend.cur)}</text>`);
  if (prev) {
    const x = left + 41 + legend.cur.length * 8.2; // Hanken 18 runs ~7.9 units a character (measured)
    out.push(`<rect x="${x.toFixed(1)}" y="5" width="16" height="16" rx="3" fill="${C.ghost}"/>`,
      `<text x="${(x + 23).toFixed(1)}" y="19" font-family="${SANS}" font-size="18" fill="${C.soft}">${xml(legend.prev)}</text>`);
  }
  days.forEach((day, i) => {
    const cx = left + slot * i + slot / 2;
    const c = num(cur[i]);
    const p = prev ? num(prev[i]) : null;
    if (p != null && p > 0) out.push(`<rect x="${(cx - 22).toFixed(1)}" y="${bottom - h(p)}" width="44" height="${h(p)}" rx="4" fill="${C.ghost}"/>`);
    if (c != null) {
      if (c > 0) out.push(`<rect x="${(cx - 14).toFixed(1)}" y="${bottom - h(c)}" width="28" height="${h(c)}" rx="4" fill="${C.ink}"/>`);
      out.push(`<text x="${cx.toFixed(1)}" y="${bottom - h(c) - 7}" text-anchor="middle" font-family="${DISPLAY}" font-size="19" fill="${C.ink}">${fmt.format(Math.round(c))}</text>`);
    } else {
      out.push(`<text x="${cx.toFixed(1)}" y="${bottom - 27}" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.gray}">not in</text>`,
        `<text x="${cx.toFixed(1)}" y="${bottom - 8}" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.gray}">yet</text>`);
    }
    const { day: dn, date } = dayLabel(day);
    out.push(`<text x="${cx.toFixed(1)}" y="${bottom + 23}" text-anchor="middle" font-family="${SANS}" font-size="18" letter-spacing="1" fill="${C.ink}">${dn}</text>`,
      `<text x="${cx.toFixed(1)}" y="${bottom + 44}" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.soft}">${xml(date)}</text>`);
  });
  out.push(`<rect x="${left}" y="${bottom}" width="${right - left}" height="2" fill="${C.ink}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">${out.join('')}</svg>`;
}

/** SVG string → PNG Buffer, 1200 px wide, with CURB's fonts only. */
export async function svgToPng(svg, width = PNG_WIDTH) {
  await ensureWasm();
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontBuffers: fonts(), loadSystemFonts: false, defaultFontFamily: SANS } });
  const png = Buffer.from(r.render().asPng());
  r.free();
  return png;
}

/** Pure: align a source's daily rows to the report days (missing day → null). */
export function align(days, rows, key) {
  const by = new Map((Array.isArray(rows) ? rows : []).map((r) => [r?.date, num(r?.[key])]));
  return days.map((d) => (by.has(d) ? by.get(d) : null));
}

const VISITS_LEGEND = { cur: 'Visits per day, this week', prev: 'Last week' };
/** Visits per day this week, last week as ghost bars. Last week's rows line up by position (same weekday).
 *  A day's number is per-hour unique visitors added up (visits.mjs), so it is visits, not unique people. */
export async function visitorsChart(visits, days) {
  const cur = align(days, visits.daily, 'visitors');
  const prev = (Array.isArray(visits.prevDaily) ? visits.prevDaily : []).slice(0, days.length).map((r) => num(r?.visitors));
  return svgToPng(barChartSvg({ days, cur, prev: prev.length ? prev : null, height: CHART_HEIGHT.visitors, legend: VISITS_LEGEND }));
}

/** Google clicks per day (Search Console lags 2 to 3 days, so the last days can be empty). */
export async function clicksChart(google, days) {
  const cur = align(days, google.daily, 'clicks');
  return svgToPng(barChartSvg({ days, cur, height: CHART_HEIGHT.clicks, legend: { cur: 'Google clicks per day' } }));
}

/** icons/logo.svg as a PNG, unmodified (no crop, recolor or transform), at 3x for a 44 px tall display. */
export async function logoPng(heightPx = 132) {
  await ensureWasm();
  const r = new Resvg(readFileSync(new URL('icons/logo.svg', ROOT), 'utf8'), { fitTo: { mode: 'height', value: heightPx }, font: { loadSystemFonts: false } });
  const png = Buffer.from(r.render().asPng());
  r.free();
  return png;
}
