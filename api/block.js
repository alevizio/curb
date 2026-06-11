// /b/<cnn> — server-rendered share page for one block (vercel.json rewrites here).
// Social bots don't execute JS, so the OG meta and the card itself are rendered
// server-side; humans get a signage-styled summary + a deep link into the live map.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ENF = require('../data/enforcement.json');

const SWEEP = 'https://data.sfgov.org/resource/yhqp-riqs.json';
const DAYLBL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYIDX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtHour = h => { h = parseInt(h, 10); if (isNaN(h)) return ''; const ap = h >= 12 ? 'PM' : 'AM'; let hh = h % 12; if (hh === 0) hh = 12; return hh + ap; };
const fmtMin = m => { let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')}${ap}`; };

export default async function handler(req, res) {
  const cnn = String(req.query.cnn || '').replace(/[^0-9]/g, '');
  if (!cnn) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }

  let rows;
  try {
    const r = await fetch(SWEEP + `?$select=corridor,limits,blockside,weekday,fromhour,tohour,week1,week2,week3,week4,week5&$where=cnn='${cnn}'&$limit=20`);
    if (!r.ok) throw 0;
    rows = await r.json();
  } catch (_) { rows = null; }
  if (!rows || !rows.length) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }

  const corridor = rows[0].corridor || 'This block';
  const limits = (rows[0].limits || '').replace(/\s+-\s+/, ' – ');
  const enfDays = ENF[cnn] || null;

  // group rules per side
  const sides = {};
  rows.forEach(r => {
    const k = r.blockside || 'Curbside';
    (sides[k] = sides[k] || []).push(r);
  });
  const sideHtml = Object.entries(sides).map(([side, rs]) => rs.map(r => {
    const dow = DAYIDX[(r.weekday || '').trim().toLowerCase().slice(0, 3)];
    const weeks = [r.week1, r.week2, r.week3, r.week4, r.week5].map(x => String(x) === '1');
    const allW = weeks.every(Boolean);
    const wkTxt = allW ? 'every week' : 'weeks ' + weeks.map((on, i) => on ? i + 1 : null).filter(Boolean).join(', ');
    const e = enfDays && dow != null && enfDays[dow] ? enfDays[dow] : null;
    return `<div class="row">
      <div class="badge"><div class="d">${esc((DAYLBL[dow] || r.weekday || '').toUpperCase())}</div><div class="t">${fmtHour(r.fromhour)}–${fmtHour(r.tohour)}</div><div class="sc">STREET CLEANING</div></div>
      <div class="meta"><div class="nm">${esc(side)} side · ${esc(wkTxt)}</div>
      ${e ? `<div class="enf">Tickets usually ~${fmtMin(e[1])} · earliest ${fmtMin(e[2])} · ${e[0]} tickets/2yr</div>` : ''}</div>
    </div>`;
  }).join('')).join('');

  // OG description: first rule + best enforcement line
  const r0 = rows[0];
  const dow0 = DAYIDX[(r0.weekday || '').trim().toLowerCase().slice(0, 3)];
  const e0 = enfDays && dow0 != null && enfDays[dow0] ? enfDays[dow0] : null;
  const desc = `Street sweeping ${DAYLBL[dow0] || r0.weekday} ${fmtHour(r0.fromhour)}–${fmtHour(r0.tohour)}` +
    (e0 ? ` — tickets usually land ~${fmtMin(e0[1])}.` : '.') + ' Live schedule, permit rules & alerts on CURB.';
  const title = `${corridor} (${limits}) — when sweeping tickets actually land`;
  const pageUrl = `https://curb.guide/b/${cnn}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // rules change rarely; let the CDN hold it for a day and refresh in the background
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.end(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} | CURB</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CURB">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="https://curb.guide/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#E0322E">
<meta name="twitter:image" content="https://curb.guide/og.png">
<link rel="icon" href="/icons/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{--paper:#F2ECDF;--ink:#17150F;--ink-soft:#4A4536;--red:#E0322E;--red-text:#C22A26;
--sign-red:#C42127;--sign-white:#FFFDF6;--shadow:5px 5px 0 var(--ink)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:'Hanken Grotesk',sans-serif;
display:grid;place-items:center;min-height:100dvh;padding:22px}
.card{width:min(430px,100%);background:var(--sign-white);border:3px solid var(--ink);border-radius:18px;
box-shadow:var(--shadow);padding:22px}
.logo{display:inline-block;font-family:'Anton',sans-serif;font-size:20px;background:var(--ink);color:var(--paper);
padding:6px 11px;border-radius:10px;text-decoration:none}.logo span{color:var(--red)}
h1{font-family:'Anton',sans-serif;font-size:29px;line-height:1;text-transform:uppercase;margin:14px 0 2px}
.blk{font-size:14px;font-weight:700;color:var(--ink-soft);margin-bottom:14px}
.row{display:flex;gap:12px;align-items:center;border-top:2px solid var(--ink);padding:12px 0}
.badge{flex:none;width:70px;text-align:center;background:var(--sign-white);color:var(--sign-red);
border:2px solid var(--sign-red);border-radius:8px;padding:6px 2px 5px}
.badge .d{font-family:'Anton',sans-serif;font-size:17px;line-height:1}
.badge .t{font-size:9px;font-weight:800;margin-top:1px}
.badge .sc{font-size:6.5px;font-weight:800;letter-spacing:.06em;margin-top:2px;opacity:.9}
.meta .nm{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-soft)}
.meta .enf{font-size:13px;font-weight:700;color:var(--red-text);margin-top:3px}
.cta{display:block;text-align:center;margin-top:16px;font-weight:800;font-size:15px;text-decoration:none;
border:2.5px solid var(--ink);border-radius:12px;padding:14px;background:var(--ink);color:var(--paper);box-shadow:var(--shadow)}
.fine{font-size:11px;font-weight:600;color:var(--ink-soft);margin-top:14px;line-height:1.5;text-align:center}
</style></head><body>
<main class="card">
<a class="logo" href="/">CURB<span>.</span></a>
<h1>${esc(corridor)}</h1>
<div class="blk">${esc(limits)}</div>
${sideHtml}
<a class="cta" href="/?b=${cnn}">Open the live map →</a>
<p class="fine">"Tickets usually" = 2 yrs of SFMTA citations on this block. The posted sign is always the source of truth. Free · no accounts · curb.guide</p>
</main></body></html>`);
}
