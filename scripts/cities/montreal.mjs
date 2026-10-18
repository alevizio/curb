#!/usr/bin/env node
// Montreal for CURB (data build, 2026-10-18; docs/multi-city/city-build.md, research in docs/multi-city/montreal.md).
// Builds data/montreal/ from the Ville de Montréal's open data (donnees.montreal.ca, CC BY 4.0):
//
//   1. Signalisation (stationnement sur rue): every parking sign panel on its pole, with the sign's text
//      (DESCRIPTION_RPA, in French) and the pole's coordinates. The street cleaning panels ("\P 13h-14h MAR. 1 AVRIL
//      AU 1 DEC.") are decoded into weekly rules (decodeRpa). The sign code table on the same page is read too.
//   2. Géobase double: one line per street side (COTE_RUE_ID), drawn a few meters out from the centerline. Each pole
//      goes on the nearest side line within 15 m that is on the pole's side of the centerline.
//   3. Géobase (réseau routier): the centerlines (ID_TRC), digitized in the direction the house numbers grow. They
//      give the block lines, the cross streets, the boroughs and the house number ranges per side.
//   4. Remorquages de véhicules gênants (optional cross-check): tows with date, time and place, checked against the
//      cleaning windows of the block they land on (report.json crossCheck).
//
// Run: node scripts/cities/montreal.mjs [--refresh]   (Node 18+; inputs cached in private/cache/montreal/)
// Tests: npx vitest run scripts/cities/montreal.test.mjs (the sign decoder on real panel texts, the season, the sides)

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/montreal/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/montreal/';
const log = (...a) => console.error('[montreal]', ...a);

// ---------- the sign text ---------------------------------------------------------------------------
// A street cleaning panel reads "\P <hours> <days> <season>": \P = no parking (stationnement interdit), \A = no
// stopping (arrêt interdit; Outremont posts its cleaning that way on some commercial streets). Spellings seen in the
// data (2026-10-18): "\P 8h30-11h30 MERCREDI 1 AVRIL AU 1 DEC", "\P 13h-14h MAR. 1 AVRIL AU 1 DEC.", "\P 8h - 12h
// JEUDI 1ER AVRIL - 30 NOV" (Outremont), "\p 08h - 12h mercredi 1er mars - 1er déc" (Saint-Laurent), "\P 9H @ 12H
// MERCREDI 15 MARS AU 15 NOVEMBRE" (Lachine), "9H à 12H - LUNDI - 15 AVR au 15 NOV" (Saint-Laurent, no \P in the
// text), "\P 7h-8h LUN A VEN 1 AVRIL AU 1 DEC", "\P 5H-7H 1 AVRIL AU 1 DEC" (no day: every day), "\P 23H30-0h30
// MARDI JEUDI 1 AVRIL AU 1 DEC" (past midnight), and typos ("LUNDRI", "1 AVIL", "1 AVRILS", "1AVRIL AU 1DEC").

const MONTH = { JANVIER: 1, JANV: 1, FEVRIER: 2, FEVR: 2, FEV: 2, MARS: 3, AVRILS: 4, AVRIL: 4, AVR: 4, AVIL: 4, MAI: 5,
  JUIN: 6, JUILLET: 7, JUIL: 7, AOUT: 8, SEPTEMBRE: 9, SEPT: 9, OCTOBRE: 10, OCT: 10, NOVEMBRE: 11, NOV: 11,
  DECEMBRE: 12, DEC: 12 };
const MON = '(' + Object.keys(MONTH).sort((a, b) => b.length - a.length).join('|') + ')';
// "1 AVRIL AU 1 DEC", "1ER AVRIL - 30 NOV", "DU 15 AVRIL AU 15 NOV", "15NOV - 15AVRIL", "1 AVRIL ET 1 DEC" (a typo)
const SEASON_RE = new RegExp(`(?:\\bDU\\s*)?(?<![\\d:])(\\d{1,2})\\s*(?:ER)?\\s*${MON}\\.?\\s*(?:AU|A|-|ET)\\s*(\\d{1,2})\\s*(?:ER)?\\s*${MON}\\b\\.?`, 'g');
// "SEPT A JUIN" (school year): a season with months only. Never a cleaning one; read so the reason is right.
const MONTHS_ONLY_RE = new RegExp(`\\b${MON}\\.?\\s*(?:AU|A|-)\\s*${MON}\\b\\.?`, 'g');
// "8h30-11h30", "08h - 12h", "9H @ 12H", "9H A 12H" (à), "9-23h", "23H30-0h30", "07h-09": at least one H.
const WIN_RE = /(?<![\d:])(\d{1,2})\s*(H\s*(\d{2})?)?\s*(?:-|@|\bAU\b|\bA\b)\s*(\d{1,2})\s*(H\s*(\d{2})?)?(?![\d])/g;
export const DAY = { DIMANCHE: 0, DIM: 0, LUNDI: 1, LUNDRI: 1, LUN: 1, MARDI: 2, MAR: 2, MERCREDI: 3, MER: 3,
  JEUDI: 4, JEU: 4, VENDREDI: 5, VEN: 5, SAMEDI: 6, SAM: 6 };
// Words that carry no rule: joiners, "ENTRETIEN" (maintenance, on some Saint-Laurent panels), "DU" of "du lundi".
const FILLER = new Set(['ET', 'DU', 'AU', 'A', 'LE', 'LES', 'DE', '@', 'ENTRETIEN']);

export const normText = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

// One time of day as the rule format writes it: whole hours as numbers, otherwise "H:MM".
export const timeOf = (h, m) => (m ? `${h}:${String(m).padStart(2, '0')}` : h);
const hoursOf = (v) => (typeof v === 'number' ? v : +v.split(':')[0] + +v.split(':')[1] / 60);
const hhmm = (v) => (typeof v === 'number' ? `${v}:00` : v);

/* The sign text → what it says, without deciding yet whether it is street cleaning:
     ban      'P' (\P, no parking) | 'A' (\A, no stopping) | null (parking allowed, a sub-plate, …)
     implied  true when the text has no \P but starts with hours (a few Saint-Laurent panels)
     except   the text has an exception ("EXCEPTE …": reserved parking, or parking allowed only then)
     season   { start: [month, day], end: [month, day] } | { months: [m1, m2] } (months only) | null
     clauses  [{ from, to, days: [jsDow…] }]: each time window with its days (no day on the sign = every day)
     unknown  words the decoder does not know (the panel is then left out, never guessed) */
export function readRpa(text) {
  let s = normText(text);
  const out = { ban: null, implied: false, except: /\bEXCEPT/.test(s), season: null, clauses: [], unknown: [] };
  let m = /^[\\/]+\s*([PA])(?![A-Z])/.exec(s) || /^([PA])\s*\\/.exec(s);
  if (m) { out.ban = m[1]; s = s.slice(m[0].length); }
  else if (/^\d{1,2}\s*H/.test(s)) { out.ban = 'P'; out.implied = true; }
  const seasons = [];
  s = s.replace(SEASON_RE, (x, d1, m1, d2, m2) => { seasons.push({ start: [MONTH[m1], +d1], end: [MONTH[m2], +d2] }); return ' '; });
  s = s.replace(MONTHS_ONLY_RE, (x, m1, m2) => { seasons.push({ months: [MONTH[m1], MONTH[m2]] }); return ' '; });
  if (seasons.length > 1) out.unknown.push('two seasons');
  out.season = seasons[0] || null;
  // time windows, each in the text's order, then the words between them
  const parts = [];
  let last = 0;
  for (const w of s.matchAll(WIN_RE)) {
    const [x, h1, H1, m1, h2, H2, m2] = w;
    if (!H1 && !H2) continue;                        // "2 SECTEURS"-like numbers are not hours
    parts.push({ text: s.slice(last, w.index) });
    const from = [+h1, m1 ? +m1 : 0], to = [+h2, m2 ? +m2 : 0];
    if (from[0] > 24 || to[0] > 24 || from[1] > 59 || to[1] > 59) out.unknown.push(`hours "${x.trim()}"`);
    parts.push({ win: [timeOf(from[0], from[1]), timeOf(to[0], to[1])] });
    last = w.index + x.length;
  }
  parts.push({ text: s.slice(last) });
  // days: "LUNDI", "MARDI JEUDI", "MER ET VEN", "LUN A VEN", "DU LUNDI AU VENDREDI", "LUN.AU SAM."
  let clause = null;
  const lead = [];                                   // days written before the first window
  for (const p of parts) {
    if (p.win) { clause = { from: p.win[0], to: p.win[1], days: [] }; out.clauses.push(clause); continue; }
    const toks = p.text.replace(/[.,;:()/\\\-–]/g, ' ').split(/\s+/).filter(Boolean);
    const days = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t in DAY) {
        if ((toks[i + 1] === 'A' || toks[i + 1] === 'AU') && toks[i + 2] in DAY) {   // a range
          for (let d = DAY[t]; ; d = (d + 1) % 7) { days.push(d); if (d === DAY[toks[i + 2]]) break; }
          i += 2;
        } else days.push(DAY[t]);
      } else if (!FILLER.has(t)) out.unknown.push(t);
    }
    if (!days.length) continue;
    if (clause && !clause.days.length) clause.days.push(...days);
    else if (!clause) lead.push(...days);
    else out.unknown.push('days after days');
  }
  // one list of days for several windows ("7h-9h ET 14h-16h LUN A VEN"): every window; none at all: every day
  const given = out.clauses.filter((c) => c.days.length);
  const shared = lead.length ? lead : given.length === 1 && out.clauses.length > 1 ? given[0].days : null;
  for (const c of out.clauses) {
    if (!c.days.length) c.days = shared ? [...shared] : [0, 1, 2, 3, 4, 5, 6];
    c.days = [...new Set(c.days)].sort((a, b) => a - b);
  }
  if (lead.length && given.length) out.unknown.push('days before and after the hours');
  return out;
}

// The cleaning seasons on montreal.ca (2026): April 1 to December 1 in most boroughs, March 15 to November 15
// (Lachine), April 16 to November 15 (LaSalle), April 1 to November 30 (Outremont), April 1 to November 14 (Verdun),
// March 1 to December 1 or April 15 to November 15 (Saint-Laurent). A season that starts in March or April and ends in
// November or on December 1 is one of them; the signs' own dates are used, whatever the borough's page says.
export const isCleaningSeason = (z) => !!z && !!z.start && (z.start[0] === 3 || z.start[0] === 4)
  && (z.end[0] === 11 || (z.end[0] === 12 && z.end[1] === 1));

const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/* The season as the months bitmask (bit m-1). A month counts when the season covers MORE than half of its days:
   April 1 to December 1 → April to November (2040: December 1 alone is left out); March 15 to November 15 → March
   to October (March 15-31 is 17 of 31 days, November 1-15 is 15 of 30, not more than half); April 15 to November 15
   → April to October; March 1 to December 1 → March to November. */
export function seasonMonths(z) {
  const day = (m, d) => DIM.slice(0, m - 1).reduce((a, b) => a + b, 0) + d;     // day of the year, 1..365
  const a = day(...z.start), b = day(...z.end);
  let mask = 0;
  for (let m = 1; m <= 12; m++) {
    const lo = day(m, 1), hi = day(m, DIM[m - 1]);
    const covered = a <= b ? Math.max(0, Math.min(hi, b) - Math.max(lo, a) + 1)
      : Math.max(0, hi - Math.max(lo, a) + 1) + Math.max(0, Math.min(hi, b) - lo + 1);   // a season over New Year
    if (covered * 2 > DIM[m - 1]) mask |= 1 << (m - 1);
  }
  return mask;
}
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const seasonWords = (z) => `${MONTH_EN[z.start[0] - 1]} ${z.start[1]} to ${MONTH_EN[z.end[0] - 1]} ${z.end[1]}`;
export const monthsWords = (mask) => { const m = []; for (let i = 0; i < 12; i++) if (mask & (1 << i)) m.push(MONTH_EN[i]); return m.length ? `${m[0]} to ${m[m.length - 1]}` : 'none'; };

// Every rule runs on holidays: montreal.ca says the no parking periods "sont aussi valables les jours fériés".
export const FLAGS = 1;

/* The sign text → a street cleaning decision and its rules:
     { cleaning: true, rules: [[dow, from, to, 31, months, 1], …], season, months, ban, implied }
   or { cleaning: false, why } with why one of:
     'not a ban'       parking allowed, a time limit, a sub-plate ("P 2h …", "PANONCEAU …")
     'always'          no parking or no stopping at all times ("\P EN TOUT TEMPS"), or with only an exception
     'no season'       a weekly window all year ("\P 9h-17h MARDI")
     'other season'    a season that is not the cleaning one (winter, the school year, summer)
     'no hours'        the whole season, all day ("\P 1 AVRIL AU 1 DEC"): not a cleaning window
     'exception'       "EXCEPTE …": parking reserved for some vehicles, or allowed only during the hours
     'unread'          a cleaning season and hours, with words the decoder does not know (left out, never guessed) */
export function decodeRpa(text) {
  const r = readRpa(text);
  const out = { ban: r.ban, implied: r.implied, season: r.season, clauses: r.clauses };
  if (!r.ban) return { ...out, cleaning: false, why: 'not a ban' };
  if (!r.season) return { ...out, cleaning: false, why: r.clauses.length ? 'no season' : 'always' };
  if (!isCleaningSeason(r.season)) return { ...out, cleaning: false, why: 'other season' };
  if (r.except) return { ...out, cleaning: false, why: 'exception' };
  if (!r.clauses.length) return { ...out, cleaning: false, why: 'no hours' };
  if (r.unknown.length) return { ...out, cleaning: false, why: 'unread', unknown: r.unknown };
  const months = seasonMonths(r.season), rules = [];
  for (const c of r.clauses) for (const d of c.days) rules.push([d, c.from, c.to, 31, months, FLAGS]);
  return { ...out, cleaning: true, months, rules };
}
export const ruleKey = (r) => r.join('|');
export const windowHours = (c) => { const a = hoursOf(c.from), b = hoursOf(c.to); return b > a ? b - a : b + 24 - a; };

// ---------- geometry ----------------------------------------------------------------------------------
// Meters on a local plane around Montréal (x east, y north); good to a few centimeters at 15 m over the island.
const LAT0 = 45.53, LON0 = -73.62, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
export const xy = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const lonlat = ([x, y]) => [x / KX + LON0, y / KY + LAT0];

// Point p against segment ab: distance, projection parameter t (unclamped) and the cross product (> 0: p on the left).
function seg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0, tc = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(p[0] - a[0] - tc * dx, p[1] - a[1] - tc * dy), t, cross: dx * (p[1] - a[1]) - dy * (p[0] - a[0]) };
}
/* Where p is against a polyline (xy points): distance, which side looking from the first point to the last ('L' |
   'R'), and how far along it the nearest point is (meters from the first point; can be below 0 or past the length
   off the ends). At an inner vertex the side comes from the two segments' mean direction, so a point outside a
   bend is not read on the wrong side. */
export function along(line, p) {
  let best = null, run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], s = seg(p, a, b), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || s.d < best.d - 1e-9) best = { ...s, i, at: run + Math.max(i > 1 ? 0 : -Infinity, Math.min(i < line.length - 1 ? 1 : Infinity, s.t)) * len };
    run += len;
  }
  let cross = best.cross;
  const i = best.i;
  const atVertex = best.t >= 1 && i < line.length - 1 ? i : best.t <= 0 && i > 1 ? i - 1 : -1;
  if (atVertex > 0) {                                    // nearest point is the inner vertex `atVertex`
    const v = line[atVertex], u1 = unit(line[atVertex - 1], v), u2 = unit(v, line[atVertex + 1]);
    const dx = u1[0] + u2[0], dy = u1[1] + u2[1];
    cross = dx * (p[1] - v[1]) - dy * (p[0] - v[0]);
  }
  return { d: best.d, side: cross > 0 ? 'L' : 'R', at: best.at, length: run };
}
export function nearestPoint(line, p) {
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0, q = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { d, q };
  }
  return best.q;
}
const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };

/* Montréal's street grid is turned: its "north" (up boulevard Saint-Laurent, toward the north end of the island) points
   57° west of true north. Locals and addresses use those grid directions (the side of rue Sherbrooke Est toward the
   mountain is its north side), so the side labels do too. Measured 2026-10-18 on the block lines: the length-weighted
   peak of all segment bearings is 32.5° (mod 90), and boulevard Saint-Laurent's blocks have a median bearing of -57.3°. */
export const GRID_ANGLE = 57;
// The compass word for a side of a block line (lon/lat points), looking from its first point to its last, as in
// Boston, but in the street grid's directions: the true direction turned clockwise by GRID_ANGLE (rot = 0: true north).
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
const compassWord = (ang) => COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];   // ang: counterclockwise from east, degrees
export function compass(c, side, rot = GRID_ANGLE) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  return compassWord(Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI - rot);
}

// Douglas-Peucker on xy points, tolerance in meters (only used when the file would pass ~6 MB).
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = -1, at = -1;
    for (let k = i + 1; k < j; k++) { const d = seg(pts[k], pts[i], pts[j]).d; if (d > max) { max = d; at = k; } }
    if (max > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// ---------- names -----------------------------------------------------------------------------------------
/* The street as Montréal writes it in running text: "rue Saint-Denis", "avenue du Mont-Royal Est", "boulevard de
   l'Acadie", "6e Avenue". The Géobase's ODONYME capitalizes the generic ("Rue Saint-Denis"); the City's pages write it
   lower case unless it follows a number. */
export function streetName(p) {
  const o = String(p.ODONYME || '').replace(/\s+/g, ' ').trim();
  if (!o) return [p.TYP_VOIE, p.LIE_VOIE, p.NOM_VOIE, p.DIR_VOIE].filter(Boolean).join(' ').replace(/' /g, "'");
  const t = String(p.TYP_VOIE || '');
  return t && o.toLowerCase().startsWith(t.toLowerCase() + ' ') ? o[0].toLowerCase() + o.slice(1) : o;
}
// Borough names as montreal.ca writes them (the Géobase joins the parts with plain hyphens).
const BOROUGHS = ['Ahuntsic-Cartierville', 'Anjou', 'Côte-des-Neiges–Notre-Dame-de-Grâce', 'Lachine', 'LaSalle',
  'Le Plateau-Mont-Royal', 'Le Sud-Ouest', "L'Île-Bizard–Sainte-Geneviève", 'Mercier–Hochelaga-Maisonneuve',
  'Montréal-Nord', 'Outremont', 'Pierrefonds-Roxboro', 'Rivière-des-Prairies–Pointe-aux-Trembles',
  'Rosemont–La Petite-Patrie', 'Saint-Laurent', 'Saint-Léonard', 'Verdun', 'Ville-Marie', 'Villeray–Saint-Michel–Parc-Extension'];
const boroughKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const BOROUGH_BY_KEY = new Map(BOROUGHS.map((b) => [boroughKey(b), b]));
export const boroughName = (s) => BOROUGH_BY_KEY.get(boroughKey(s)) || '';

// RFC 4180 CSV (quoted fields with commas, "" for a quote) → array of objects keyed by the header row.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^\uFEFF/, '').trim());
  return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) };
}

// ---------- holidays ---------------------------------------------------------------------------------
// Québec's statutory holidays (Act respecting labour standards) plus Easter Monday, by rule. They change nothing on
// the map: montreal.ca says the no parking periods also apply on holidays, so every rule carries flag 1.
function easter(y) {                                       // Gregorian Easter Sunday (Anonymous algorithm)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, mo - 1, da);
}
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const nthMonday = (y, mo, n) => { const d = new Date(Date.UTC(y, mo - 1, 1)); const first = 1 + ((8 - d.getUTCDay()) % 7); return Date.UTC(y, mo - 1, first + 7 * (n - 1)); };
export function quebecHolidays(y) {
  const may25 = new Date(Date.UTC(y, 4, 25)), back = ((may25.getUTCDay() + 6) % 7) || 7;   // the Monday before May 25
  const e = easter(y);
  return {
    [`${y}-01-01`]: "New Year's Day",
    [isoDay(e - 2 * 864e5)]: 'Good Friday',
    [isoDay(e + 864e5)]: 'Easter Monday',
    [isoDay(Date.UTC(y, 4, 25) - back * 864e5)]: "National Patriots' Day",
    [`${y}-06-24`]: 'Fête nationale du Québec',
    [`${y}-07-01`]: 'Canada Day',
    [isoDay(nthMonday(y, 9, 1))]: 'Labour Day',
    [isoDay(nthMonday(y, 10, 2))]: 'Thanksgiving',
    [`${y}-12-25`]: 'Christmas Day',
  };
}

// ---------- the build ------------------------------------------------------------------------------------
const DATASET = 'https://donnees.montreal.ca/dataset/';
const SOURCES = {
  signs: { file: 'signalisation_stationnement.csv', page: DATASET + 'stationnement-sur-rue-signalisation-courant',
    url: DATASET + '8ac6dd33-b0d3-4eab-a334-5a6283eb7940/resource/7f1d4ae9-1a12-46d7-953e-6b9c18c78680/download/signalisation_stationnement.csv' },
  codes: { file: 'signalisation-codification-rpa.csv', page: DATASET + 'stationnement-sur-rue-signalisation-courant',
    url: DATASET + '8ac6dd33-b0d3-4eab-a334-5a6283eb7940/resource/1baac760-4311-4b4f-8996-db93d348cc24/download/signalisation-codification-rpa.csv' },
  geobase: { file: 'geobase.json', page: DATASET + 'geobase',
    url: DATASET + '984f7a68-ab34-4092-9204-4bdfcca767c5/resource/9d3d60d8-4e7f-493e-8d6a-dcd040319d8d/download/geobase.json' },
  double: { file: 'gbdouble.json', page: DATASET + 'geobase-double',
    url: DATASET + '88493b16-220f-4709-b57b-1ea57c5ba405/resource/16f7fa0a-9ce6-4b29-a7fc-00842c593927/download/gbdouble.json' },
};
const TOWS = { page: DATASET + 'remorquages-de-vehicules-genants', resource: '65dd096f-7296-40e8-8cfe-e26b928bcce5',
  sql: 'https://donnees.montreal.ca/api/3/action/datastore_search_sql' };
const UA = { 'User-Agent': 'curb-montreal-build (+https://curb.guide)' };
const MAX_D = 15;                     // meters: a pole farther than this from every street side is left unplaced

async function fetchRetry(url, opts = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 3000 * i));
    }
  }
}
async function cachedText(key, refresh) {
  const { file, url } = SOURCES[key], f = CACHE + file;
  if (refresh || !fs.existsSync(f)) {
    log(`downloading ${file}…`);
    const text = await (await fetchRetry(url)).text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, text);
  }
  return { text: fs.readFileSync(f, 'utf8'), fetched: fs.statSync(f).mtime.toISOString().slice(0, 10) };
}
// Tows in two cleaning seasons (April to November 2025, April 2026 to now), read with the datastore's SQL.
async function cachedTows(refresh) {
  const f = CACHE + 'remorquages-saisons.json';
  const read = () => ({ records: JSON.parse(fs.readFileSync(f, 'utf8')), fetched: fs.statSync(f).mtime.toISOString().slice(0, 10) });
  if (!refresh && fs.existsSync(f)) return read();
  log('reading tows (cleaning seasons 2025 and 2026)…');
  const out = [];
  for (const [from, to] of [['2025-04-01', '2025-12-01'], ['2026-04-01', '2026-12-01']]) {
    for (let off = 0; ; off += 20000) {
      const sql = `SELECT "_id","DATE_ORIGINE","LONGITUDE_ORIGINE","LATITUDE_ORIGINE","MOTIF_REMORQUAGE" FROM "${TOWS.resource}" `
        + `WHERE "DATE_ORIGINE" >= '${from}' AND "DATE_ORIGINE" < '${to}' ORDER BY "_id" LIMIT 20000 OFFSET ${off}`;
      const d = await (await fetchRetry(TOWS.sql, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) })).json();
      if (!d.success) throw new Error('tows: ' + JSON.stringify(d.error).slice(0, 300));
      out.push(...d.result.records);
      if (d.result.records.length < 20000) break;
    }
  }
  fs.writeFileSync(f, JSON.stringify(out));
  return read();
}
const need = (obj, keys, what) => { for (const k of keys) if (!(k in obj)) throw new Error(`${what}: no field ${k} (the City's data changed shape)`); };
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const r6 = (v) => Math.round(v * 1e6) / 1e6;

async function main() {
  const refresh = process.argv.includes('--refresh');
  const today = new Date().toISOString().slice(0, 10);

  // ---- 1. inputs --------------------------------------------------------------------------------------
  const signsIn = await cachedText('signs', refresh), codesIn = await cachedText('codes', refresh);
  const geoIn = await cachedText('geobase', refresh), dblIn = await cachedText('double', refresh);
  const { head, rows } = parseCSV(signsIn.text);
  need(Object.fromEntries(head.map((h) => [h, 1])), ['POTEAU_ID_POT', 'PANNEAU_ID_PAN', 'PANNEAU_ID_RPA', 'DESCRIPTION_RPA', 'CODE_RPA',
    'FLECHE_PAN', 'DESCRIPTION_REP', 'PAS_SUR_RUE', 'Longitude', 'Latitude', 'NOM_ARROND'], 'signalisation');
  if (rows.length < 100000) throw new Error(`signalisation: only ${rows.length} panels`);
  const codes = parseCSV(codesIn.text).rows;
  need(codes[0], ['PANNEAU_ID_RPA', 'DESCRIPTION_RPA', 'CODE_RPA'], 'codification RPA');
  const geobase = JSON.parse(geoIn.text).features, dbl = JSON.parse(dblIn.text).features;
  need(geobase[0].properties, ['ID_TRC', 'ODONYME', 'TYP_VOIE', 'DEB_GCH', 'FIN_GCH', 'DEB_DRT', 'FIN_DRT', 'ARR_GCH', 'ARR_DRT', 'LIM_GCH', 'LIM_DRT'], 'géobase');
  need(dbl[0].properties, ['COTE_RUE_ID', 'ID_TRC', 'COTE', 'NOM_VILLE'], 'géobase double');
  if (geobase.length < 40000 || dbl.length < 80000) throw new Error(`géobase: ${geobase.length} centerlines, ${dbl.length} sides`);
  log(`${rows.length} panels, ${codes.length} sign codes, ${geobase.length} centerlines, ${dbl.length} street sides`);

  // ---- 2. panels → rules ------------------------------------------------------------------------------
  const byState = new Map(), notCleaning = new Map(), skippedCleaning = new Map(), seenPanel = new Set();
  const codeById = new Map(codes.map((c) => [c.PANNEAU_ID_RPA, c]));
  const texts = new Map();        // in-place text → { n, decoded }
  const panels = [];              // in-place street cleaning panels
  let duplicates = 0, fromTable = 0;
  const codeCheck = { agree: 0, differ: 0, tableNotCleaning: 0, notInTable: 0, examples: [] };
  const familyDays = { SU: 1, SB: 2, ST: 3, SV: 5, SD: 7 }, familyCheck = { agree: 0, differ: 0, examples: [] };
  for (const r of rows) {
    bump(byState, r.DESCRIPTION_REP || '(blank)');
    if (r.DESCRIPTION_REP !== 'Réel') continue;
    if (seenPanel.has(r.PANNEAU_ID_PAN)) { duplicates++; continue; }
    seenPanel.add(r.PANNEAU_ID_PAN);
    let text = r.DESCRIPTION_RPA;
    if (!text.trim() && codeById.has(r.PANNEAU_ID_RPA)) { text = codeById.get(r.PANNEAU_ID_RPA).DESCRIPTION_RPA; fromTable++; }
    if (!texts.has(text)) texts.set(text, { n: 0, d: decodeRpa(text), code: r.CODE_RPA });
    const t = texts.get(text); t.n++;
    const d = t.d;
    if (!d.cleaning) {
      if (d.season && isCleaningSeason(d.season)) bump(skippedCleaning, d.why); else bump(notCleaning, d.why);
      continue;
    }
    // the same sign in the City's code table (2020 wording): does it decode to the same rules?
    const c = codeById.get(r.PANNEAU_ID_RPA);
    if (!c) codeCheck.notInTable++;
    else {
      const dc = decodeRpa(c.DESCRIPTION_RPA);
      if (!dc.cleaning) codeCheck.tableNotCleaning++;
      else if (dc.rules.map(ruleKey).sort().join() === d.rules.map(ruleKey).sort().join()) codeCheck.agree++;
      else { codeCheck.differ++; if (codeCheck.examples.length < 10) codeCheck.examples.push({ code: r.CODE_RPA, panel: text, table: c.DESCRIPTION_RPA }); }
    }
    const fam = r.CODE_RPA.split('-')[0], days = new Set(d.rules.map((x) => x[0])).size;
    if (fam in familyDays) {
      if (familyDays[fam] === days) familyCheck.agree++;
      else { familyCheck.differ++; if (familyCheck.examples.length < 10 && !familyCheck.examples.some((e) => e.text === text)) familyCheck.examples.push({ code: r.CODE_RPA, text, days }); }
    }
    const lon = +r.Longitude, lat = +r.Latitude;
    panels.push({ pole: r.POTEAU_ID_POT, panel: r.PANNEAU_ID_PAN, code: r.CODE_RPA, text, arrow: +r.FLECHE_PAN || 0,
      lon, lat, p: xy([lon, lat]), borough: r.NOM_ARROND, offStreet: r.PAS_SUR_RUE === '1', d });
  }
  const panelCount = [...byState.values()].reduce((a, b) => a + b, 0), inPlace = byState.get('Réel') || 0;
  // 43,495 street cleaning panels on 2026-10-18: far fewer means the sign texts changed and the decoder needs a look
  if (panels.length < 30000) throw new Error(`only ${panels.length} street cleaning panels decoded (43,495 on 2026-10-18): did the sign texts change?`);
  log(`${inPlace} panels in place: ${panels.length} street cleaning, ${[...skippedCleaning.values()].reduce((a, b) => a + b, 0)} with a cleaning season left out, ${duplicates} duplicate rows`);

  // ---- 3. street sides and centerlines ------------------------------------------------------------
  const centers = new Map();                 // ID_TRC → { p, c (lon/lat), x (meters), name, a, b (end nodes) }
  const nodeStreets = new Map();             // endpoint → Map(street name → count)
  const nodeSegs = new Map();                // endpoint → [ID_TRC…]
  const nodeKey = ([lo, la]) => lo.toFixed(7) + ',' + la.toFixed(7);
  for (const f of geobase) {
    const c = f.geometry && f.geometry.coordinates, p = f.properties;
    if (!c || c.length < 2) continue;
    const name = streetName(p);
    centers.set(p.ID_TRC, { p, c, x: c.map(xy), name, a: nodeKey(c[0]), b: nodeKey(c[c.length - 1]) });
    for (const k of [nodeKey(c[0]), nodeKey(c[c.length - 1])]) {
      if (!nodeStreets.has(k)) { nodeStreets.set(k, new Map()); nodeSegs.set(k, []); }
      bump(nodeStreets.get(k), name);
      nodeSegs.get(k).push(p.ID_TRC);
    }
  }
  const sides = [];                          // { id, trc, lr, city, parts: [[xy…]…] }
  const coteCheck = { agree: 0, differ: 0, noCenter: 0 };
  for (const f of dbl) {
    const p = f.properties, g = f.geometry;
    if (!g) continue;
    const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    const s = { id: p.COTE_RUE_ID, trc: p.ID_TRC, lr: p.COTE === 'Droite' ? 'R' : p.COTE === 'Gauche' ? 'L' : null,
      city: p.NOM_VILLE, parts: lines.filter((l) => l.length >= 2).map((l) => l.map(xy)) };
    if (!s.lr) throw new Error(`géobase double: COTE "${p.COTE}"`);
    if (!s.parts.length) continue;
    sides.push(s);
    // the double's COTE against the centerline it belongs to: its middle point must be on that side
    const cl = centers.get(s.trc);
    if (!cl) { coteCheck.noCenter++; continue; }
    const part = s.parts[0], mid = part[Math.floor(part.length / 2)];
    along(cl.x, mid).side === s.lr ? coteCheck.agree++ : coteCheck.differ++;
  }
  log(`sides: COTE agrees with the centerline on ${coteCheck.agree} of ${coteCheck.agree + coteCheck.differ}`);

  // a 50 m grid of side line segments
  const CELL = 50, cellOf = (v) => Math.floor(v / CELL), grid = new Map();
  for (let si = 0; si < sides.length; si++) for (const part of sides[si].parts) for (let i = 1; i < part.length; i++) {
    const a = part[i - 1], b = part[i];
    for (let cx = cellOf(Math.min(a[0], b[0])); cx <= cellOf(Math.max(a[0], b[0])); cx++)
      for (let cy = cellOf(Math.min(a[1], b[1])); cy <= cellOf(Math.max(a[1], b[1])); cy++) {
        const k = cx * 100000 + cy;
        let list = grid.get(k); if (!list) grid.set(k, (list = []));
        list.push(si, a, b);
      }
  }
  // every street side within `r` meters of p, nearest first: [{ s, d }]
  function near(p, r) {
    const best = new Map();
    for (let cx = cellOf(p[0] - r); cx <= cellOf(p[0] + r); cx++) for (let cy = cellOf(p[1] - r); cy <= cellOf(p[1] + r); cy++) {
      const list = grid.get(cx * 100000 + cy); if (!list) continue;
      for (let i = 0; i < list.length; i += 3) {
        const d = seg(p, list[i + 1], list[i + 2]).d;
        if (d <= r && d < (best.get(list[i]) ?? Infinity)) best.set(list[i], d);
      }
    }
    return [...best.entries()].map(([si, d]) => ({ s: sides[si], d })).sort((x, y) => x.d - y.d);
  }

  // ---- 4. poles → street sides ----------------------------------------------------------------------
  const poles = new Map();                   // pole id → { p, lon, lat, panels: [] }
  for (const pn of panels) {
    if (!poles.has(pn.pole)) poles.set(pn.pole, { id: pn.pole, p: pn.p, lon: pn.lon, lat: pn.lat, borough: pn.borough, panels: [] });
    poles.get(pn.pole).panels.push(pn);
  }
  const unplaced = new Map(), unplacedEx = new Map(), placedDist = [];
  const addUnplaced = (why, pole) => {
    bump(unplaced, why);
    const ex = unplacedEx.get(why) || []; unplacedEx.set(why, ex);
    if (ex.length < 6) ex.push({ pole: pole.id, lon: r6(pole.lon), lat: r6(pole.lat), borough: pole.borough, sign: pole.panels[0].text });
  };
  // Pass 1: the nearest side line within 15 m that is on the pole's side of its own centerline (the pole stands on
  // the curb). A pole with another side line less than 2 m farther (at a corner, or where one block meets the next)
  // waits for pass 2.
  const AMBIG = 2, support = new Map(), waiting = [];
  for (const pole of poles.values()) {
    pole.keys = [...new Set(pole.panels.flatMap((x) => x.d.rules.map(ruleKey)))];
    const cands = near(pole.p, MAX_D), mtl = cands.filter((c) => c.s.city === 'MTL');
    if (!cands.length) { addUnplaced('no street side within 15 m', pole); continue; }
    if (!mtl.length) { addUnplaced('only street sides of another city (not Montréal) within 15 m', pole); continue; }
    const ok = mtl.filter((c) => { const cl = centers.get(c.s.trc); return cl && along(cl.x, pole.p).side === c.s.lr; });
    if (!ok.length) { addUnplaced('every street side within 15 m is across its centerline from the pole', pole); continue; }
    pole.cands = ok.filter((c) => c.d - ok[0].d < AMBIG);
    if (pole.cands.length > 1) { waiting.push(pole); continue; }
    pole.side = ok[0].s; pole.d = ok[0].d;
    let m = support.get(pole.side.id); if (!m) support.set(pole.side.id, (m = new Set()));
    for (const k of pole.keys) m.add(k);
  }
  // Pass 2: a waiting pole goes to the candidate side where other poles already post the same rules, else the nearest.
  const ambiguity = { poles: waiting.length, nearest: 0, supported: 0, supportedNotNearest: 0 };
  for (const pole of waiting) {
    const sup = pole.cands.filter((c) => { const m = support.get(c.s.id); return m && pole.keys.every((k) => m.has(k)); });
    const pick = sup[0] || pole.cands[0];
    if (sup.length) { ambiguity.supported++; if (pick !== pole.cands[0]) ambiguity.supportedNotNearest++; } else ambiguity.nearest++;
    pole.side = pick.s; pole.d = pick.d;
  }
  let offStreetPlaced = 0;
  for (const pole of poles.values()) if (pole.side) {
    placedDist.push(pole.d);
    if (pole.panels.some((x) => x.offStreet)) offStreetPlaced++;
  }
  const ambiguous = waiting.length;
  const placedPoles = [...poles.values()].filter((p) => p.side);
  if (placedPoles.length < 0.95 * poles.size) throw new Error(`only ${placedPoles.length} of ${poles.size} poles placed: did the Géobase double change?`);
  placedDist.sort((a, b) => a - b);
  const pct = (q) => Math.round(placedDist[Math.floor(q * (placedDist.length - 1))] * 10) / 10;
  log(`poles: ${placedPoles.length} of ${poles.size} placed (distance to the side line: median ${pct(0.5)} m, 90% ${pct(0.9)} m, 99% ${pct(0.99)} m); ${ambiguous} with another side line within 2 m: ${ambiguity.supported} went where other poles post the same rules (${ambiguity.supportedNotNearest} of them not the nearest), ${ambiguity.nearest} to the nearest`);
  for (const [k, v] of unplaced) log(`  unplaced: ${v} ${k}`);
  // A pole with two cleaning panels that say different things can hold one panel for each of two streets (a corner) or
  // for each side of a divided road. Each such panel goes to the nearby side where other poles post its rules, when
  // its own side does not. A panel saying something nobody nearby says stays with its pole.
  for (const pole of placedPoles) for (const pn of pole.panels) pn.side = pole.side;
  const split = { poles: 0, panelsMoved: 0, examples: [] };
  for (const pole of placedPoles) {
    if (pole.panels.length < 2 || new Set(pole.panels.map((pn) => pn.d.rules.map(ruleKey).sort().join())).size < 2) continue;
    split.poles++;
    const cands = near(pole.p, MAX_D).filter((c) => c.s.city === 'MTL' && centers.has(c.s.trc) && along(centers.get(c.s.trc).x, pole.p).side === c.s.lr);
    for (const pn of pole.panels) {
      const ks = pn.d.rules.map(ruleKey), has = (s) => { const m = support.get(s.id); return m && ks.every((k) => m.has(k)); };
      if (has(pole.side)) continue;
      const to = cands.find((c) => c.s.id !== pole.side.id && has(c.s));
      if (!to) continue;
      pn.side = to.s; split.panelsMoved++;
      if (split.examples.length < 6) split.examples.push({ pole: pole.id, sign: pn.text, from: `${centers.get(pole.side.trc).name} (${pole.side.trc}) ${pole.side.lr}`, to: `${centers.get(to.s.trc).name} (${to.s.trc}) ${to.s.lr}`, meters: Math.round(to.d * 10) / 10 });
    }
  }
  log(`poles with two different cleaning panels: ${split.poles}; ${split.panelsMoved} panels moved to the nearby side whose other poles post their rules`);

  // ---- 4b. arrows: which way along the curb a panel points (FLECHE_PAN 2 or 3) -------------------------
  // Read with the panel facing the street: on the R side of a line the reader's left is toward the line's last
  // point, on the L side toward its first. Near a block's end, a sign that points into its block is the usual case.
  const arrows = { counted: 0, hypothesisLeft2: 0, hypothesisLeft3: 0, codes: {} };
  for (const pole of placedPoles) for (const pn of pole.panels) {
    arrows.codes[pn.arrow] = (arrows.codes[pn.arrow] || 0) + 1;
    if (pn.arrow !== 2 && pn.arrow !== 3) continue;
    const cl = centers.get(pole.side.trc), a = along(cl.x, pole.p), len = a.length;
    if (len < 40) continue;
    const nearStart = a.at < 0.25 * len, nearEnd = a.at > 0.75 * len;
    if (!nearStart && !nearEnd) continue;
    arrows.counted++;
    const intoBlock = nearStart ? +1 : -1;                         // +1 = toward the last point
    const leftPoints = pole.side.lr === 'R' ? +1 : -1;             // where the reader's left points along the line
    const dir2 = leftPoints, dir3 = -leftPoints;                   // if 2 means "left"
    if (dir2 === intoBlock && pn.arrow === 2 || dir3 === intoBlock && pn.arrow === 3) arrows.hypothesisLeft2++;
    else arrows.hypothesisLeft3++;
  }
  log(`arrows: of ${arrows.counted} arrowed panels near a block end, ${arrows.hypothesisLeft2} point into the block if 2 = left (${arrows.hypothesisLeft3} if 2 = right)`);

  // ---- 5. street sides → rules ------------------------------------------------------------------------
  const sideRules = new Map();               // COTE_RUE_ID → { side, rules: Map(key → {rule, poles:Set, panels}), poleSets: Map(sig → n), poles }
  for (const pole of placedPoles) {
    const bySide = new Map();                // a pole's panels by the side each went to (almost always one)
    for (const pn of pole.panels) { if (!bySide.has(pn.side.id)) bySide.set(pn.side.id, []); bySide.get(pn.side.id).push(pn); }
    for (const pns of bySide.values()) {
      const s = pns[0].side;
      if (!sideRules.has(s.id)) sideRules.set(s.id, { side: s, rules: new Map(), poleSets: new Map(), poles: [] });
      const sr = sideRules.get(s.id), keys = new Set();
      for (const pn of pns) for (const rule of pn.d.rules) {
        const k = ruleKey(rule); keys.add(k);
        if (!sr.rules.has(k)) sr.rules.set(k, { rule, poles: new Set(), panels: 0 });
        const e = sr.rules.get(k); e.poles.add(pole.id); e.panels++;
      }
      bump(sr.poleSets, [...keys].sort().join(' + '));
      sr.poles.push(pole);
    }
  }
  // when the poles of one side disagree: every distinct rule is kept (the side shows them all); counted here
  const agreement = { sides: sideRules.size, onePole: 0, allSame: 0, oneContainsOther: 0, different: 0, examples: [] };
  for (const sr of sideRules.values()) {
    const sets = [...sr.poleSets.keys()].map((k) => new Set(k.split(' + ')));
    if (sr.poles.length === 1) agreement.onePole++;
    else if (sets.length === 1) agreement.allSame++;
    else {
      const union = new Set(sets.flatMap((s) => [...s]));
      if (sets.some((s) => s.size === union.size)) agreement.oneContainsOther++;
      else agreement.different++;
    }
  }

  // ---- 6. blocks ---------------------------------------------------------------------------------------
  // The cross street at one end of a block: the other street at that node (the one with more segments there, then by
  // name). Where the Géobase splits a street without a crossing (a borough line, a change in house numbers, a loop, the
  // two halves of a divided road), search on along the same street, nearest node first, up to 8 segments away.
  // The Géobase's unnamed ways ("voie Non-nommée": service roads, driveways) are not named as cross streets: a block
  // ending at one shows its other end only, or the unnamed way when both ends are.
  const walkedCross = { walked: 0, unnamedEnds: 0 };
  const UNNAMED = /^voie Non-nommée/i;
  const otherAt = (node, own, named = true) => [...(nodeStreets.get(node) || new Map()).entries()]
    .filter(([n]) => n !== own && (!named || !UNNAMED.test(n)))
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr'))[0]?.[0] || '';
  const crossAt = (start, own, trc, named = true) => {
    const first = otherAt(start, own, named);
    if (first) return first;
    if (named && otherAt(start, own, false)) { walkedCross.unnamedEnds++; return ''; }   // the end is an unnamed way
    const seen = new Set([trc]), queue = [[start, 0]], visited = new Set([start]);
    while (queue.length) {
      const [node, hop] = queue.shift();
      const o = otherAt(node, own, false);
      if (o) { walkedCross.walked++; return named && UNNAMED.test(o) ? '' : o; }
      if (hop >= 8) continue;
      for (const t of nodeSegs.get(node) || []) {
        if (seen.has(t) || centers.get(t).name !== own) continue;
        seen.add(t);
        const cl = centers.get(t), far = cl.a === node ? cl.b : cl.a;
        if (!visited.has(far)) { visited.add(far); queue.push([far, hop + 1]); }
      }
    }
    return '';
  };
  const parity = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n % 2 : null; };
  const RULE_ORDER = (a, b) => a[0] - b[0] || hoursOf(a[1]) - hoursOf(b[1]) || hoursOf(a[2]) - hoursOf(b[2]) || a[4] - b[4];
  const byBlock = new Map();
  for (const sr of sideRules.values()) {
    const trc = sr.side.trc;
    if (!byBlock.has(trc)) byBlock.set(trc, []);
    byBlock.get(trc).push(sr);
  }
  const blocks = [];
  for (const [trc, srs] of byBlock) {
    const cl = centers.get(trc);              // always there: poles only go to sides that have a centerline
    const p = cl.p;
    let a = crossAt(cl.a, cl.name, trc), b = crossAt(cl.b, cl.name, trc);
    if (!a && !b) { a = crossAt(cl.a, cl.name, trc, false); b = crossAt(cl.b, cl.name, trc, false); }   // both ends unnamed
    const nums = ['DEB_GCH', 'FIN_GCH', 'DEB_DRT', 'FIN_DRT'].map((k) => parseInt(p[k], 10)).filter((v) => v > 0);
    const l = parity(p.DEB_GCH) ?? parity(p.FIN_GCH), r = parity(p.DEB_DRT) ?? parity(p.FIN_DRT);
    const odd = l === 1 && r !== 1 ? 'L' : r === 1 && l !== 1 ? 'R' : null;
    // the borough of the cleaned side (L: ARR_GCH, R: ARR_DRT), else the other one
    const hood = boroughName(srs.some((x) => x.side.lr === 'R') ? p.ARR_DRT : p.ARR_GCH) || boroughName(p.ARR_DRT) || boroughName(p.ARR_GCH);
    const d = srs.sort((x, y) => x.side.lr.localeCompare(y.side.lr)).map((sr) => [sr.side.lr, compass(cl.c, sr.side.lr),
      [...sr.rules.values()].map((e) => e.rule).sort(RULE_ORDER)]);
    blocks.push({ c: String(trc), s: cl.name, l: a && b ? `${a} - ${b}` : a || b, ...(hood ? { h: hood } : {}),
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(odd ? { o: odd } : {}),
      g: cl.c.map(([lo, la]) => [r6(lo), r6(la)]), d });
  }
  blocks.sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sideCount = blocks.reduce((n, b) => n + b.d.length, 0), ruleCount = blocks.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0);
  log(`${blocks.length} blocks, ${sideCount} sides, ${ruleCount} rules`);

  // ---- 7. checks: the format, and every pole on the side it was given, against the written line ------------
  const problems = [], seenC = new Set();
  const okTime = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 24)
    || (typeof v === 'string' && /^(\d{1,2}):([0-5]\d)$/.test(v) && +v.split(':')[0] < 24 && +v.split(':')[1] > 0);
  const okRule = (r) => r.length === 6 && Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= 6 && okTime(r[1]) && okTime(r[2])
    && r[3] === 31 && Number.isInteger(r[4]) && r[4] > 0 && r[4] < 4096 && r[5] === FLAGS;
  for (const b of blocks) {
    if (typeof b.c !== 'string' || !b.c || seenC.has(b.c)) problems.push([b.c, 'c']);
    seenC.add(b.c);
    if (!b.s) problems.push([b.c, 's']);
    if (typeof b.l !== 'string' || !b.l) problems.push([b.c, 'l']);
    if (!Array.isArray(b.g) || b.g.length < 2 || b.g.some((q) => q.length !== 2 || q.some((v) => !Number.isFinite(v) || r6(v) !== v))) problems.push([b.c, 'g']);
    if (!b.d.length || new Set(b.d.map((x) => x[0])).size !== b.d.length
      || b.d.some(([lr, label, rules]) => !['L', 'R'].includes(lr) || !label || !rules.length || !rules.every(okRule))) problems.push([b.c, 'd']);
  }
  if (problems.length) throw new Error(`segments.json would be wrong on ${problems.length} blocks: ${JSON.stringify(problems.slice(0, 5))}`);
  const blockByC = new Map(blocks.map((b) => [b.c, b]));
  const lr = { poles: 0, agree: 0, differ: 0, compassSame: 0, compassNext: 0, examples: [] };
  const word = (dx, dy) => compassWord(Math.atan2(dy, dx) * 180 / Math.PI - GRID_ANGLE);
  for (const pole of placedPoles) for (const side of new Set(pole.panels.map((pn) => pn.side))) {
    const b = blockByC.get(String(side.trc)), line = b.g.map(xy), a = along(line, pole.p);
    lr.poles++;
    if (a.side === side.lr) lr.agree++; else { lr.differ++; if (lr.examples.length < 5) lr.examples.push({ pole: pole.id, block: b.c, side: side.lr }); }
    // the label against the real direction from the street line to the pole (the nearest point of the line)
    const label = b.d.find((x) => x[0] === side.lr)[1], q = nearestPoint(line, pole.p);
    const w = word(pole.p[0] - q[0], pole.p[1] - q[1]), k = ((COMPASS.indexOf(w) - COMPASS.indexOf(label)) % 8 + 8) % 8;
    if (k === 0) lr.compassSame++; else if (k === 1 || k === 7) lr.compassNext++;
  }
  // five blocks by hand: a pole on each side, where it stands against the written line
  const spot = [];
  const spotPick = [...sideRules.values()].filter((sr) => sr.poles.length >= 2).map((sr) => blockByC.get(String(sr.side.trc)))
    .filter((b, i, arr) => b.d.length === 2 && arr.indexOf(b) === i)
    .sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const spotHoods = new Set();
  for (const b of spotPick) {
    if (spot.length >= 5 || spotHoods.has(b.h)) continue;
    spotHoods.add(b.h);
    const line = b.g.map(xy), entry = { c: b.c, street: b.s, between: b.l, borough: b.h, first: b.g[0], last: b.g[b.g.length - 1], sides: [] };
    for (const [side, label] of b.d) {
      const sr = [...sideRules.values()].find((x) => String(x.side.trc) === b.c && x.side.lr === side);
      const pole = sr.poles[0], a = along(line, pole.p);
      const off = a.side === 'L' ? 'left' : 'right';
      entry.sides.push({ side, label, pole: pole.id, at: [r6(pole.lon), r6(pole.lat)], metersFromCenterline: Math.round(a.d * 10) / 10,
        seenFromFirstPoint: off, ok: a.side === side, sign: pole.panels[0].text });
    }
    spot.push(entry);
  }
  log(`checks: every block well formed; ${lr.agree} of ${lr.poles} poles on their side of the written line; the compass label matches the direction from the line to the pole for ${lr.compassSame} (one step off for ${lr.compassNext}, more for ${lr.poles - lr.compassSame - lr.compassNext})`);

  // ---- 8. the tow log: do tows land on cleaned blocks during their cleaning windows? -------------------------
  let tows = null, towError = null;
  try { tows = await cachedTows(refresh); } catch (e) { towError = e.message; log('tows: ' + e.message); }
  const crossCheck = tows ? towCheck(tows.records, blocks) : { skipped: `tow log not read (${towError})` };
  if (tows) log(`tows: ${crossCheck.towsWithPlace} with a place, ${crossCheck.onCleanedBlock} within 20 m of a cleaned block, ${crossCheck.inWindow} of those during a cleaning window of that block (${crossCheck.inWindowShare}; ${crossCheck.chanceShare} if the tows were on another day of the week)`);

  const R = { refresh, today, rows, panelCount, inPlace, byState, notCleaning, skippedCleaning, duplicates, fromTable, texts, panels,
    codeCheck, familyCheck, centers, sides, coteCheck, poles, placedPoles, unplaced, unplacedEx, ambiguous, ambiguity, offStreetPlaced,
    pct, arrows, sideRules, agreement, blocks, sideCount, ruleCount, signsIn, codesIn, geoIn, dblIn, near, lr, spot, walkedCross,
    crossCheck, tows: tows && tows.records, towsFetched: tows && tows.fetched, split };
  write(R);
  return R;
}

// ---------- the three files -----------------------------------------------------------------------------------
const WORDS = {
  rule: 'Each side of the street has its own street cleaning time on the signs: no parking for a few hours, usually one day a week, from April 1 to December 1 in most boroughs.',
  afterpass: 'Signs give exact dates, April 1 to December 1 in most boroughs; the map moves each date to the nearest first of a month (December 1 is left out, March 15 starts March 1, November 15 ends October 31). Also on holidays. A ticket, sometimes a tow.',
  dataNotes: 'Read sign by sign from the City of Montréal\'s parking sign inventory (Signalisation, updated daily, CC BY 4.0): each street cleaning sign goes on the nearest street side of the City\'s Géobase within 15 m, and a side shows every rule its signs post. The inventory is thin in Lachine, Saint-Laurent, Montréal-Nord and Saint-Léonard and nearly empty in LaSalle and Verdun; Pierrefonds-Roxboro and L\'Île-Bizard–Sainte-Geneviève have no street cleaning. The sign on the street wins.',
};

function write(R) {
  const { blocks, today } = R;
  const sources = [
    { name: 'Signalisation (stationnement sur rue), Ville de Montréal', url: SOURCES.signs.page, license: 'CC BY 4.0', fetched: R.signsIn.fetched },
    { name: 'Géobase double: côtés de rue du réseau routier, Ville de Montréal', url: SOURCES.double.page, license: 'CC BY 4.0', fetched: R.dblIn.fetched },
    { name: 'Géobase: réseau routier, Ville de Montréal', url: SOURCES.geobase.page, license: 'CC BY 4.0', fetched: R.geoIn.fetched },
  ];
  const towSource = { name: 'Remorquages de véhicules gênants, Ville de Montréal (cross-check only)', url: TOWS.page, license: 'CC BY 4.0', fetched: R.towsFetched || today };

  // segments.json (rounded to 6 decimals; simplified only if it would pass ~6 MB, and then by at most 1 m)
  let simplified = 0;
  const meta = (b) => ({ city: 'montreal', time_zone: 'America/Toronto', generated: new Date().toISOString(), sources, blocks: b.length,
    sides: R.sideCount, format: 'b[] = {c: Géobase segment id (ID_TRC), s: street, l: cross streets, h: borough, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]] in the Géobase\'s direction (house numbers growing), d: [[side L|R, compass label, rules]]}; rule = [jsDow, from, to, weeksMask (31 = every week), monthsMask (bit m-1), flags (1 = runs on holidays)]; from/to are hours, "H:MM" with minutes, to < from = past midnight' });
  let text = JSON.stringify({ _meta: meta(blocks), b: blocks });
  if (text.length > 6 * 1024 * 1024) {
    for (const b of blocks) { const before = b.g.length; b.g = simplify(b.g.map(xy), 1).map((q) => lonlat(q).map(r6)); simplified += before - b.g.length; }
    text = JSON.stringify({ _meta: meta(blocks), b: blocks });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', text);

  // city.json
  const pts = blocks.flatMap((b) => b.g), lats = pts.map((q) => q[1]), lngs = pts.map((q) => q[0]);
  const lo4 = (v) => Math.floor(v * 1e4) / 1e4, hi4 = (v) => Math.ceil(v * 1e4) / 1e4;
  const bounds = [[lo4(Math.min(...lats)), lo4(Math.min(...lngs))], [hi4(Math.max(...lats)), hi4(Math.max(...lngs))]];
  const mids = blocks.map((b) => b.g[Math.floor(b.g.length / 2)]), cells = new Map();
  for (const [lo, la] of mids) { const k = Math.floor(la / 0.01) + ',' + Math.floor(lo / 0.014); cells.set(k, (cells.get(k) || []).concat([[lo, la]])); }
  const busiest = [...cells.values()].sort((a, b) => b.length - a.length)[0];
  const center = [Math.round(busiest.reduce((s, q) => s + q[1], 0) / busiest.length * 1e4) / 1e4, Math.round(busiest.reduce((s, q) => s + q[0], 0) / busiest.length * 1e4) / 1e4];
  const byHood = blocks.reduce((m, b) => { if (b.h) (m[b.h] ||= []).push(...b.g); return m; }, {});
  const neighborhoods = Object.entries(byHood).filter(([, q]) => q.length >= 20).sort(([a], [b]) => a.localeCompare(b, 'fr')).map(([name, q]) => {
    const sorted = (k) => q.map((x) => x[k]).sort((a, b) => a - b), at = (v, f) => v[Math.floor(f * (v.length - 1))];
    const xs = sorted(0), ys = sorted(1);
    return { name, bbox: [at(xs, 0.02), at(ys, 0.02), at(xs, 0.98), at(ys, 0.98)].map((v) => v.toFixed(4)).join(',') };
  });
  const city = {
    id: 'montreal', name: 'Montréal', region: 'Quebec', tz: 'America/Toronto', center, zoom: 15, bounds,
    holidays: { ...quebecHolidays(2026), ...quebecHolidays(2027) },
    holidaysSource: 'https://www.cnesst.gouv.qc.ca/fr/conditions-travail/conges/jours-feries-chomes-payes',
    holidayRule: 'all',
    fine: '', tow: 'sometimes', fineSource: '',
    agency: 'Ville de Montréal (boroughs)', scheduleUrl: 'https://montreal.ca/en/how-to/find-out-when-parking-prohibited-street-maintenance',
    sources: [...sources, towSource], words: WORDS, neighborhoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  // report.json
  const top = (pred, n) => [...R.texts.entries()].filter(([, v]) => pred(v.d)).sort((a, b) => b[1].n - a[1].n).slice(0, n);
  const seasons = new Map();
  for (const pn of R.panels) { const k = seasonWords(pn.d.season); const e = seasons.get(k) || { season: k, panels: 0, months: monthsWords(pn.d.months), monthsMask: pn.d.months }; e.panels++; seasons.set(k, e); }
  const boroughs = new Map();
  for (const pn of R.panels) { const k = boroughName(pn.borough) || '(blank)'; const e = boroughs.get(k) || { borough: k, cleaningPanels: 0, placed: 0, blocks: 0 }; e.cleaningPanels++; boroughs.set(k, e); }
  for (const pole of R.placedPoles) for (const pn of pole.panels) boroughs.get(boroughName(pn.borough) || '(blank)').placed++;
  for (const b of blocks) { const e = boroughs.get(b.h) || { borough: b.h, cleaningPanels: 0, placed: 0, blocks: 0 }; e.blocks++; boroughs.set(b.h, e); }
  const conflictExamples = [];
  for (const sr of R.sideRules.values()) {
    if (sr.poles.length < 2 || sr.poleSets.size < 2 || conflictExamples.length >= 10) continue;
    const cl = R.centers.get(sr.side.trc);
    conflictExamples.push({ c: String(sr.side.trc), street: cl.name, side: sr.side.lr, poleRuleSets: [...sr.poleSets].map(([k, n]) => ({ rules: k, poles: n })) });
  }
  const singleDissent = [...R.sideRules.values()].filter((sr) => sr.poles.length >= 2 && sr.poleSets.size >= 2)
    .filter((sr) => [...sr.poleSets.values()].sort((a, b) => b - a).slice(1).every((n) => n === 1)).length;
  const skippedExamples = new Map();
  for (const [t, v] of R.texts) if (!v.d.cleaning && v.d.season && isCleaningSeason(v.d.season)) {
    const l = skippedExamples.get(v.d.why) || []; if (l.length < 8) l.push({ text: t, panels: v.n }); skippedExamples.set(v.d.why, l);
  }
  // the side labels: street grid directions, measured against the block lines, and what true north would have said
  const hist = new Map(), slBearings = [];
  for (const b of blocks) {
    const q = b.g.map(xy);
    for (let i = 1; i < q.length; i++) {
      const len = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); if (len < 5) continue;
      const br = ((Math.atan2(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]) * 180 / Math.PI) % 90 + 90) % 90;
      const k = Math.round(br * 2) / 2; hist.set(k, (hist.get(k) || 0) + len);
    }
    if (b.s === 'boulevard Saint-Laurent') { const a = q[0], z = q[q.length - 1]; slBearings.push(Math.atan2(z[0] - a[0], z[1] - a[1]) * 180 / Math.PI); }
  }
  const smooth = (c) => [...hist].reduce((n, [k, v]) => n + (Math.abs((((k - c) % 90) + 135) % 90 - 45) <= 2 ? v : 0), 0);
  const peak = [...Array(180).keys()].map((i) => i / 2).reduce((best, c) => (smooth(c) > smooth(best) ? c : best), 0);
  slBearings.sort((a, b) => a - b);
  const labelCounts = {}, changed = { sides: 0, examples: [] };
  for (const b of blocks) for (const [side, label] of b.d) {
    labelCounts[label] = (labelCounts[label] || 0) + 1;
    const t = compass(b.g, side, 0);
    if (t !== label) { changed.sides++; if (changed.examples.length < 6 && !changed.examples.some((e) => e.street === b.s)) changed.examples.push({ c: b.c, street: b.s, side, grid: label, trueNorth: t }); }
  }
  const labels = {
    convention: 'Montréal\'s street grid directions, not true north: the side of rue Sherbrooke Est toward the mountain is "North", the sides of boulevard Saint-Laurent are "East" and "West", as locals and addresses use them. Each label is the side\'s direction (from the block line\'s first point to its last) turned clockwise by the grid angle, then named with the eight compass words.',
    gridAngle: GRID_ANGLE, gridAngleMeaning: 'grid north points this many degrees west of true north',
    measured: { lengthWeightedPeakOfBearingsMod90: peak, gridNorthFromThatPeak: peak - 90,
      boulevardSaintLaurentMedianBearing: slBearings.length ? Math.round(slBearings[Math.floor(slBearings.length / 2)] * 10) / 10 : null,
      note: 'Bearings in degrees clockwise from true north; parts of the east end run on a second grid about 10° off (rue Sherbrooke Est, rue Ontario Est), still within the same compass words.' },
    counts: labelCounts, differFromTrueNorth: { ...changed, of: R.sideCount, note: 'A 57° turn moves every label one or two compass steps from its true north name.' },
  };

  const report = {
    generated: new Date().toISOString(),
    sources: [...sources, { name: 'Signalisation: codification RPA des panneaux (the sign code table, 2020)', url: SOURCES.codes.page, license: 'CC BY 4.0', fetched: R.codesIn.fetched }, towSource],
    inputs: { panelRows: R.panelCount, byState: Object.fromEntries(R.byState), inPlace: R.inPlace, duplicateRows: R.duplicates,
      textFromCodeTable: R.fromTable, centerlines: R.centers.size, streetSides: R.sides.length,
      streetSidesMontreal: R.sides.filter((x) => x.city === 'MTL').length },
    decoding: {
      streetCleaningPanels: R.panels.length,
      decoded: R.panels.length,
      notStreetCleaning: Object.fromEntries([...R.notCleaning].sort((a, b) => b[1] - a[1])),
      notStreetCleaningMeaning: { 'not a ban': 'parking allowed or a time limit, a sub-plate', always: 'no parking or no stopping at all times, or at all times with an exception (permits, disabled, deliveries)', 'no season': 'a weekly no parking window all year (not the seasonal cleaning program), including the orange snow removal signs', 'other season': 'winter, the school year or summer' },
      cleaningSeasonLeftOut: Object.fromEntries(R.skippedCleaning), cleaningSeasonLeftOutExamples: Object.fromEntries(skippedExamples),
      cleaningSeasonLeftOutMeaning: { exception: '"\\P EXCEPTE …": parking allowed only during the hours (the other side is being cleaned), or reserved for some vehicles (municipal vehicles, motorcycles)', 'no hours': 'no parking all day for the whole season (no weekly window)', 'not a ban': 'a sign without \\P or \\A ("Stationnement réservé véhicule de promenade, VEN, 8h-12h, 1er AVRIL AU 1ER DÉC …", Anjou): not read as a cleaning window' },
      noStopping: R.panels.filter((x) => x.d.ban === 'A').length,
      noStoppingNote: 'Outremont posts its cleaning on some commercial streets as \\A (no stopping) during the same season; read as street cleaning (code family OUT-ADN, next to OUT-SDN for \\P). An assumption: no City page says so.',
      noBackslashP: R.panels.filter((x) => x.d.implied).length,
      noBackslashPNote: 'Saint-Laurent panels whose text starts with the hours and has no \\P ("9H à 12H - LUNDI - 15 AVR au 15 NOV"): read as no parking, since the season is the borough\'s cleaning season.',
      longWindows: top((d) => d.cleaning && d.clauses.some((c) => windowHours(c) > 4), 20).map(([t, v]) => ({ text: t, panels: v.n, rules: v.d.rules })),
      everyDay: top((d) => d.cleaning && d.clauses.some((c) => c.days.length === 7), 20).map(([t, v]) => ({ text: t, panels: v.n })),
      pastMidnight: top((d) => d.cleaning && d.clauses.some((c) => hoursOf(c.to) < hoursOf(c.from)), 20).map(([t, v]) => ({ text: t, panels: v.n, rules: v.d.rules })),
      codeTableCheck: { ...R.codeCheck, note: 'Each cleaning panel\'s sign (PANNEAU_ID_RPA) in the 2020 code table, decoded on its own: agree = the same rules from the two wordings.' },
      codeFamilyCheck: { ...R.familyCheck, note: 'The days on the sign against its code family: SU one day, SB two, ST three, SV Monday to Friday, SD every day.' },
      top20: top((d) => d.cleaning, 20).map(([t, v]) => ({ text: t, code: v.code, panels: v.n, rules: v.d.rules,
        reads: v.d.clauses.map((c) => `${c.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} ${hhmm(c.from)} to ${hhmm(c.to)}`).join('; ') + `, ${seasonWords(v.d.season)} (months: ${monthsWords(v.d.months)})` })),
      top20AllSigns: top(() => true, 20).map(([t, v]) => ({ text: t, panels: v.n, read: v.d.cleaning ? 'street cleaning' : v.d.why })),
    },
    season: {
      rule: 'A month counts when the sign\'s dates cover more than half of its days (bit m-1 of the months mask). The exact first and last days are in seasonsOnSigns and in words.afterpass.',
      seasonsOnSigns: [...seasons.values()].sort((a, b) => b.panels - a.panels),
      montrealCaSeasons: { 'most boroughs': 'April 1 to December 1', Lachine: 'March 15 to November 15', LaSalle: 'April 16 to November 15', Outremont: 'April 1 to November 30',
        Verdun: 'April 1 to November 14', 'Saint-Laurent': 'March 1 to December 1, or April 15 to November 15, depending on the sector', 'Pierrefonds-Roxboro, L\'Île-Bizard–Sainte-Geneviève': 'none' },
      montrealCaSource: 'https://montreal.ca/en/how-to/find-out-when-parking-prohibited-street-maintenance (updated November 27, 2025)',
      equivalently: 'Each date moves to the nearest first of a month: December 1 stays December 1 (the season ends with November), March 15 and April 15 move back to March 1 and April 1, November 15 moves back to November 1 (the season ends with October).',
      notShownThoughOnTheSign: ['December 1 on April 1 to December 1 and March 1 to December 1 signs (Tuesday, December 1, 2026; Wednesday, December 1, 2027)', 'November 1 to 15 on signs ending November 15 (Lachine, parts of Saint-Laurent, three signs in Mercier–Hochelaga-Maisonneuve and Anjou)'],
      shownThoughNotOnTheSign: ['March 1 to 14 on signs starting March 15 (Lachine, three signs in Mercier–Hochelaga-Maisonneuve and Anjou)', 'April 1 to 14 on signs starting April 15 (parts of Saint-Laurent)'],
      option: 'If those days matter, each rule could get a second rule listing those dates ([-1, from, to, 0, 0, flags, [dates]]); not done here, the months are what was asked.',
    },
    placement: {
      method: 'Each pole goes on the nearest Géobase double side line of Montréal within 15 m that is on the pole\'s side of that side\'s own centerline. When another side line is less than 2 m farther, the pole goes to the one where other poles already post the same rules, else the nearest.',
      poles: R.poles.size, placed: R.placedPoles.length, unplaced: Object.fromEntries(R.unplaced), unplacedExamples: Object.fromEntries(R.unplacedEx),
      distanceToSideLine: { median: R.pct(0.5), p90: R.pct(0.9), p99: R.pct(0.99), unit: 'm' },
      closeCall: R.ambiguity, twoPanelPoles: R.split, offStreetFlagPlaced: R.offStreetPlaced,
      offStreetNote: 'Poles flagged PAS_SUR_RUE (not on the street) were placed like the others when a street side was within 15 m.',
      coteCheck: { ...R.coteCheck, note: 'The double\'s COTE (Droite / Gauche) against the side of the centerline each side line lies on: Droite = R looking from the first point to the last.' },
      arrows: { ...R.arrows, note: 'FLECHE_PAN 2 or 3 on cleaning panels near a block end: read facing the sign from the street, 2 as a left arrow points into the block for ' + R.arrows.hypothesisLeft2 + ' and out for ' + R.arrows.hypothesisLeft3 + '. Most cleaning panels have no arrow (0: the whole side). Arrows were not used to place poles.' },
    },
    sides: {
      sides: R.agreement.sides, onePole: R.agreement.onePole, polesAgree: R.agreement.allSame,
      twoOrMoreRuleSets: R.agreement.oneContainsOther + R.agreement.different, onePoleSetContainsTheOthers: R.agreement.oneContainsOther,
      polesDisagree: R.agreement.different, minorityOnOnePole: singleDissent,
      meaning: 'twoOrMoreRuleSets: sides whose poles do not all post the same rules; onePoleSetContainsTheOthers: one pole posts everything the others post and more (often a short stretch near a corner with its own time); minorityOnOnePole: of those, the sides where every rule set but the commonest is on a single pole.',
      policy: 'When the poles of one side disagree, every distinct rule is kept, so the side shows all of them.', examples: conflictExamples,
    },
    output: { blocks: blocks.length, sides: R.sideCount, rules: R.ruleCount, sizeBytes: text.length, simplifiedPointsDropped: simplified,
      coordinates: '6 decimals', blocksWithoutHouseNumbers: blocks.filter((b) => !b.n).length, blocksWithoutOddSide: blocks.filter((b) => !b.o).length,
      blocksWithOneCrossStreet: blocks.filter((b) => !b.l.includes(' - ')).length, crossStreetsFoundFurtherAlong: R.walkedCross.walked,
      endsAtAnUnnamedWay: R.walkedCross.unnamedEnds, unnamedWayNote: 'A block end at one of the Géobase\'s unnamed ways ("voie Non-nommée") is not named; the other end shows alone.',
      byBorough: [...boroughs.values()].sort((a, b) => b.blocks - a.blocks) },
    labels,
    validation: { wellFormed: true, polesOnTheirSide: { poles: R.lr.poles, agree: R.lr.agree, differ: R.lr.differ },
      compassLabel: { sameAsDirectionToPole: R.lr.compassSame, oneStepOff: R.lr.compassNext, more: R.lr.poles - R.lr.compassSame - R.lr.compassNext,
        note: 'Both in street grid directions. The label comes from the block line\'s first to last point; the direction to a pole near a corner or on a bend can differ.' },
      spotChecks: R.spot },
    crossCheck: R.crossCheck,
    holidays: { policy: 'Not suspended: montreal.ca says the no parking periods "sont aussi valables les jours fériés" (also apply on holidays). Every rule carries flag 1, so the holidays listed in city.json change nothing.',
      source: 'https://montreal.ca/sujets/stationnement-dans-la-rue (updated December 16, 2025)', list: 'Québec statutory holidays plus Easter Monday, 2026 and 2027 (CNESST)' },
    fineAndTow: { fine: 'Not found on montreal.ca (its ticket pages give no amounts). Press reports of the City\'s 2025 budget put an illegal parking ticket at $65 plus court fees: unverified, so city.json leaves "fine" empty.',
      tow: 'sometimes: no City page says. The tow log has tows of ticketed cars all season (mostly for work and events) and slightly more inside cleaning windows than chance (crossCheck), so towing for street cleaning happens but is rare.' },
    assumptions: [
      'Only signs in place (DESCRIPTION_REP "Réel") count; removed, archived and planned signs are left out.',
      'A sign is street cleaning when it bans parking (\\P) or stopping (\\A) during hours, with a season starting in March or April and ending in November or on December 1, and no exception.',
      'A sign with no day applies every day; a window ending at 24h ends at midnight; "23h30-0h30" runs past midnight.',
      'Every distinct rule of a side is kept when its poles disagree (counts in sides).',
      'Weeks: every week (31); no Montréal cleaning sign names weeks of the month.',
      'Holidays do not suspend anything (flag 1 on every rule).',
      'Outremont\'s \\A (no stopping) windows in its cleaning season are street cleaning (decoding.noStoppingNote).',
      'Saint-Laurent panels with hours and its cleaning season but no \\P in the text are no parking (decoding.noBackslashPNote).',
      'A month is in the season when the sign\'s dates cover more than half of it (season).',
      'Only Montréal street sides take poles: signs of other cities in the dataset (Montréal-Est, blank borough) are left out.',
      'A pole goes on one street side; a second, different panel on it can go to the nearby side whose other poles post its rules (placement.twoPanelPoles).',
    ],
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1) + '\n');
  log(`wrote data/montreal/segments.json (${Math.round(text.length / 1024)} KB), city.json, report.json`);
}

/* Each tow (date, time and place, no side) against the block it lands on (the nearest cleaned block within 20 m): was
   one of that block's sides inside a cleaning window at that minute? The same tows moved to each other day of the
   week give the share to expect by chance. */
export function towCheck(tows, blocks) {
  const CELL = 60, cellOf = (v) => Math.floor(v / CELL), grid = new Map();
  blocks.forEach((b, bi) => {
    const line = b.g.map(xy);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], c = line[i];
      for (let cx = cellOf(Math.min(a[0], c[0]) - 20); cx <= cellOf(Math.max(a[0], c[0]) + 20); cx++)
        for (let cy = cellOf(Math.min(a[1], c[1]) - 20); cy <= cellOf(Math.max(a[1], c[1]) + 20); cy++) {
          const k = cx * 100000 + cy; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(bi, a, c);
        }
    }
  });
  const active = (b, dow, h, mo) => b.d.some(([, , rules]) => rules.some((r) => {
    if (!(r[4] & (1 << (mo - 1)))) return false;
    const f = hoursOf(r[1]), t = hoursOf(r[2]);
    return t > f ? r[0] === dow && h >= f && h < t : (r[0] === dow && h >= f) || (r[0] === (dow + 6) % 7 && h < t);
  }));
  const out = { source: TOWS.page, period: 'April 1 to November 30, 2025, and April 1, 2026 to the latest tow', tows: tows.length,
    towsWithPlace: 0, onCleanedBlock: 0, inWindow: 0, inWindowByReason: {}, minutesAfterStart: null, inWindowShare: '', chanceShare: '' };
  let chance = 0, chanceN = 0;
  const after = [];
  for (const t of tows) {
    const lon = +t.LONGITUDE_ORIGINE, lat = +t.LATITUDE_ORIGINE, m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(t.DATE_ORIGINE || '');
    if (!m || !Number.isFinite(lon) || !Number.isFinite(lat) || !lon || !lat) continue;
    const [y, mo, da, hh, mi] = m.slice(1).map(Number);
    if (mo < 4 || mo > 11) continue;
    out.towsWithPlace++;
    const p = xy([lon, lat]), list = grid.get(cellOf(p[0]) * 100000 + cellOf(p[1]));
    let best = null;
    if (list) for (let i = 0; i < list.length; i += 3) { const d = seg(p, list[i + 1], list[i + 2]).d; if (d <= 20 && (!best || d < best.d)) best = { d, b: blocks[list[i]] }; }
    if (!best) continue;
    out.onCleanedBlock++;
    const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay(), h = hh + mi / 60;
    if (active(best.b, dow, h, mo)) {
      out.inWindow++;
      const why = t.MOTIF_REMORQUAGE || '(none)'; out.inWindowByReason[why] = (out.inWindowByReason[why] || 0) + 1;
      const starts = best.b.d.flatMap(([, , rules]) => rules).filter((r) => r[0] === dow && h >= hoursOf(r[1])).map((r) => (h - hoursOf(r[1])) * 60);
      if (starts.length) after.push(Math.min(...starts));
    }
    for (let k = 1; k < 7; k++) { chanceN++; if (active(best.b, (dow + k) % 7, h, mo)) chance++; }
  }
  after.sort((a, b) => a - b);
  out.minutesAfterStart = after.length ? { median: Math.round(after[Math.floor(after.length / 2)]), quartiles: [Math.round(after[Math.floor(after.length / 4)]), Math.round(after[Math.floor(3 * after.length / 4)])] } : null;
  out.inWindowShare = out.onCleanedBlock ? `${(100 * out.inWindow / out.onCleanedBlock).toFixed(1)}%` : '';
  out.chanceShare = chanceN ? `${(100 * chance / chanceN).toFixed(1)}%` : '';
  out.note = 'The tow log gives no side of the street and no reason beyond "Constat d\'infraction" (ticketed); a tow during a window may be for something else (work, an event).';
  out.reading = `${out.inWindowShare} of the tows on cleaned blocks fall inside a cleaning window of that block, against ${out.chanceShare} for the same tows moved to the other days of the week: hardly more than chance. In the cleaning season the log is mostly tows for work and events, so it neither confirms nor contradicts the schedule; it does say that towing for street cleaning is rare (a few dozen more tows than chance per season, citywide).`;
  return out;
}

export { main as build };
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
