// GET /api/og?cnn=<cnn> — the per-block dynamic Open Graph card (ALE-169).
// Fetches the block's sweep schedule + enforcement avg, renders a 1200×630 signage card.
// ANY failure (bad cnn, DataSF down, render error) → 302 to the static /og.png, so a share
// card is never broken.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ENF = require('../data/enforcement.json');
import { renderCard } from './_ogcard.js';

const SWEEP = 'https://data.sfgov.org/resource/yhqp-riqs.json';
const DAYLBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYIDX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const h12 = (x) => { let v = x % 12; if (v === 0) v = 12; return v; };
function windowStr(from, to) {
  const f = parseInt(from, 10), t = parseInt(to, 10);
  if (isNaN(f)) return '';
  const fa = f >= 12 ? 'PM' : 'AM', ta = (isNaN(t) ? f : t) >= 12 ? 'PM' : 'AM';
  return fa === ta ? `${h12(f)}–${h12(t)}${ta}` : `${h12(f)}${fa}–${h12(t)}${ta}`;
}
const fmtMin = (m) => { let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')}${ap}`; };

export default async function handler(req, res) {
  const cnn = String(req.query.cnn || '').replace(/[^0-9]/g, '');
  const fallback = () => { res.statusCode = 302; res.setHeader('Location', '/og.png'); res.setHeader('Cache-Control', 'public, max-age=600'); res.end(); };
  if (!cnn) return fallback();
  try {
    const r = await fetch(SWEEP + `?$select=corridor,limits,weekday,fromhour,tohour&$where=cnn='${cnn}'&$limit=20`);
    if (!r.ok) return fallback();
    const rows = await r.json();
    if (!rows || !rows.length) return fallback();
    const r0 = rows[0];
    const dow = DAYIDX[(r0.weekday || '').trim().toLowerCase().slice(0, 3)];
    const e = ENF[cnn] && dow != null ? ENF[cnn][dow] : null;
    const png = await renderCard({
      corridor: (r0.corridor || 'This block').slice(0, 40),
      limits: (r0.limits || '').replace(/\s+-\s+/, ' – ').slice(0, 60),
      day: (DAYLBL[dow] || r0.weekday || '').toUpperCase().slice(0, 9),
      window: windowStr(r0.fromhour, r0.tohour),
      enf: e ? fmtMin(e[1]) : null,
    });
    res.setHeader('Content-Type', 'image/png');
    // Unfurl scrapers cache for days (WhatsApp has no refresh) — cache hard at the CDN.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.end(png);
  } catch (e) { console.error('og failed:', e); return fallback(); }
}
