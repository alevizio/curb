#!/usr/bin/env node
// San Diego for CURB (data build, 2026-10-18; docs/multi-city/city-build.md, research in docs/multi-city/san-diego.md).
// Builds data/san-diego/ from the City of San Diego's open data (data.sandiego.gov, all ODC PDDL):
//
//   1. Street Sweeping Schedule (Stormwater Department): 28,141 street segments with their sweeping schedule as text.
//      Only the 3,367 segments marked posted = 'P' have "no parking" signs and get tickets; the others are swept
//      without signs (residents are asked to move voluntarily) and are left out. Each segment carries its own line,
//      so there is no join: the schedule text is parsed (parseSchedule) and each sign's side ("NS", "SES", "NS/WS")
//      goes on the side of the line facing that way (sideOf).
//   2. Community Planning Areas: the neighborhood name for each segment's cpcode.
//   3. Parking Citations (date and typed address, no time): last year's street sweeping tickets. They settle what the
//      schedule text leaves open (a "north side" on a street that runs north to south; "Every Tues & Wed" without a
//      side), and they check every block side against the days the data gives it (report.json crossCheck).
//   4. Address Points (SANDAG, listed on data.sandiego.gov): which side of each line the odd house numbers are really on,
//      for the `o` field and for reading a ticket's side from its house number.
//
// Run: node scripts/cities/san-diego.mjs [--refresh]   (Node 18+; inputs cached in private/cache/san-diego/, ~290 MB)
// Tests: npx vitest run scripts/cities/san-diego.test.mjs

import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = ROOT + 'data/san-diego/';
const CACHE = process.env.CURB_CACHE_DIR || ROOT + 'private/cache/san-diego/';
const log = (...a) => console.error('[san-diego]', ...a);

const SWEEP_URL = 'https://seshat.datasd.org/gis_street_sweeping/street_sweeping_datasd.geojson';
const CPA_URL = 'https://seshat.datasd.org/gis_community_planning_districts/cmty_plan_datasd.geojson';
const CITATIONS = (part) => `https://seshat.datasd.org/parking_citations/parking_citations_${part}_datasd.csv`;
const CITATION_PARTS = ['2025_part2', '2026_part1', '2026_part2'];   // Jul 2025 to the latest (Jul 2026 on 2026-10-18)
const ADDRESS_URL = 'https://geo.sandag.org/server/rest/directories/downloads/Address_Points.csv';
const DATASET_PAGE = 'https://data.sandiego.gov/datasets/street-sweeping-schedule/';   // its "Last Updated" date

// ---------- the schedule text -----------------------------------------------------------------------
// "Posted (7am - 10am), NS 1st Thu, SS 1st Wed", "Posted (10am - 1pm), Even Month 3rd Thu (ES), Odd Month 3rd Thu (WS)",
// "Posted (3am - 6am), NS Mon,Wed & Fri; SS Tue & Thu", "Posted NS(10am - 1pm), SS(7am - 10am) 1st Mon", … 223 spellings
// in all (2026-05-05). A string is cut into parts at commas and semicolons; a part that names a side starts that side's
// rule, a part before any side holds what every side shares (the hours, "Even Month"), and a part after a side without
// one continues it ("NS Mon", "Wed & Fri"). "Not Posted" takes the side in its part, or the next side named.

const DAY = { SUN: 0, SUNDAY: 0, MON: 1, MONDAY: 1, TUE: 2, TUES: 2, TUESDAY: 2, WED: 3, WEDNESDAY: 3,
  THU: 4, THUR: 4, THURS: 4, THURSDAY: 4, FRI: 5, FRIDAY: 5, SAT: 6, SATURDAY: 6 };
const WEEK = { '1ST': 0, '2ND': 1, '3RD': 2, '4TH': 3, '5TH': 4 };
export const EVEN_MONTHS = 0b101010101010, ODD_MONTHS = 0b010101010101;   // bit m-1: Feb, Apr, … Dec / Jan, Mar, … Nov
const FILLER = new Set(['OF', 'EVERY', 'AND', 'THE', '-', '&']);
const WIN_RE = /\(?\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(?:-|TO)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*\)?/g;
// BOTH SIDES | NS/WS, SS & ES (one side named twice: northwest, southeast) | NES, SWS | NS, SS, ES, WS | a bare SE, SW, NE, NW
const SIDE_RE = /\b(?:(BOTH\s*SIDES?)|([NS])S\s*(?:\/|&|AND)\s*([EW])S|([EW])S\s*(?:\/|&|AND)\s*([NS])S|([NS])([EW])S|([NSEW])S|(SE|SW|NE|NW))\b/g;
const hour = (h, m, ap) => { const H = (+h % 12) + (ap === 'PM' ? 12 : 0); return m && m !== '00' ? `${H}:${m}` : H; };
export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };

function parseGroup(text) {
  const problems = [], wins = [];
  let s = String(text).toUpperCase().replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  s = s.replace(WIN_RE, (m, h1, m1, a1, h2, m2, a2) => { wins.push([hour(h1, m1, a1), hour(h2, m2, a2)]); return ` @W${wins.length - 1} `; });
  s = s.replace(SIDE_RE, (m, both, a1, a2, b1, b2, c1, c2, d1, e1) => ` @S:${both ? 'BOTH' : a1 ? a1 + a2 : b1 ? b2 + b1 : c1 ? c1 + c2 : d1 || e1} `);
  s = s.replace(/\bNOT\s+POST(?:ED)?\b/g, ' @NP ').replace(/\bPOSTED\b/g, ' ');
  s = s.replace(/\bEVEN\s+MONTHS?\b/g, ' @M:EVEN ').replace(/\bODD\s+MONTHS?\b/g, ' @M:ODD ').replace(/\bEVERY\s+MONTHS?\b/g, ' @M:ALL ');
  const parts = s.split(/[,;]/).map((x) => x.replace(/[()]/g, ' ').split(/[\s&]+/).filter(Boolean)).filter((t) => t.length);
  const shared = { days: [], weeks: 0, months: null, win: null };
  const clauses = [];
  let notPostedNext = false;
  for (const toks of parts) {
    const p = { sides: [], np: false, days: [], weeks: 0, months: null, wins: [] };
    for (const t of toks) {
      if (t.startsWith('@S:')) p.sides.push(t.slice(3));
      else if (t.startsWith('@W')) p.wins.push(wins[+t.slice(2)]);
      else if (t === '@NP') p.np = true;
      else if (t.startsWith('@M:')) p.months = t === '@M:EVEN' ? EVEN_MONTHS : t === '@M:ODD' ? ODD_MONTHS : 0;
      else if (t in DAY) p.days.push(DAY[t]);
      else if (t in WEEK) p.weeks |= 1 << WEEK[t];
      else if (!FILLER.has(t)) problems.push(`unknown word "${t}"`);
    }
    if (p.sides.length > 1) problems.push('two sides in one part');
    if (p.wins.length > 1) problems.push('two time windows in one part');
    const win = p.wins[0] || null;
    if (p.sides.length) {
      clauses.push({ side: p.sides[0], posted: !(p.np || notPostedNext), days: p.days, weeks: p.weeks, months: p.months, win });
      notPostedNext = false;
    } else if (p.np && !p.days.length && !win && p.months === null && !p.weeks) {
      notPostedNext = true;                                    // "…, Not Posted, WS"
    } else if (clauses.length) {                               // "NS Mon", "Wed & Fri"
      const c = clauses[clauses.length - 1];
      c.days.push(...p.days); c.weeks |= p.weeks;
      if (p.months !== null) c.months = p.months;
      if (win && !c.win) c.win = win;
      if (p.np) c.posted = false;
    } else {                                                   // before any side: shared by every side
      shared.days.push(...p.days); shared.weeks |= p.weeks;
      if (p.months !== null) shared.months = p.months;
      if (win) shared.win = win;
      if (p.np) problems.push('"Not Posted" without a side');
    }
  }
  return { clauses, shared, problems };
}

/* One segment's schedule (schedule + schedule2) → { rules: [{ side, days, weeks, months, from, to, unnamed? }], problems }.
   side: 'BOTH' or the compass direction the City names ('N', 'SE', …); days: JS weekdays; weeks: bit i = the (i+1)th
   weekday of the month (31 = every week); months: bit m-1 (0 = every month). Only posted sides are returned.
   unnamed: the text gives days but names no side ("Posted (2am - 5am), Every Tues & Wed"), read as both sides. */
export function parseSchedule(schedule, schedule2) {
  const rules = [], problems = [];
  for (const text of [schedule, schedule2]) {
    if (text == null || !String(text).trim()) continue;
    const g = parseGroup(text);
    problems.push(...g.problems);
    let cl = g.clauses;
    // Days with no posted side named: both sides, or the side across from the only one said to be not posted
    // ("Posted (8am - 10am), Tue & Fri, SS Not Posted" → the north side).
    if (g.shared.days.length && !cl.some((c) => c.posted)) {
      const np = cl.map((c) => c.side);
      const side = !np.length ? 'BOTH' : np.length === 1 && OPPOSITE[np[0]] ? OPPOSITE[np[0]] : null;
      if (side) cl = [...cl, { side, posted: true, days: [], weeks: 0, months: null, win: null, unnamed: side === 'BOTH' }];
      else problems.push('posted side unclear');
    }
    const posted = cl.filter((c) => c.posted);
    for (const c of posted) {
      let { days, weeks, months, win } = c;
      if (!days.length) {   // "Posted NS(10am - 1pm), SS(7am - 10am) 1st Mon": the days are said once for both sides
        const from = g.shared.days.length ? g.shared : posted.find((o) => o !== c && o.days.length);
        if (from) { days = from.days; if (!weeks) weeks = from.weeks; if (months === null) months = from.months; }
      }
      if (months === null) months = g.shared.months;
      if (!weeks) weeks = g.shared.weeks;
      win = win || g.shared.win || posted.map((o) => o.win).find(Boolean) || null;
      if (!days.length) { problems.push(`no day for ${c.side}`); continue; }
      if (!win) { problems.push(`no hours for ${c.side}`); continue; }
      rules.push({ side: c.side, days: [...new Set(days)].sort((a, b) => a - b), weeks: weeks || 31, months: months ?? 0,
        from: win[0], to: win[1], ...(c.unnamed ? { unnamed: true } : {}) });
    }
  }
  if (!rules.length && !problems.length) problems.push('no posted side');
  return { rules, problems };
}

// ---------- which side of the line a sign means -----------------------------------------------------

const LAT0 = 32.75, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 111132;
const xy = ([lon, lat]) => [lon * KX, lat * KY];
const ANGLE = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };
export const COMPASS_WORD = { N: 'North', S: 'South', E: 'East', W: 'West', NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest' };
// Below this, a compass side runs nearly along the street (a "north side" on a street within ~20° of north to south)
// and its meaning is a guess: the tickets decide (resolveSides). Above it the City's word is clear (2026-10 tickets:
// the compass side is the ticketed one 88% of the time from 0.4 up, 46% below 0.35).
export const AMBIGUOUS = 0.35;

/* The side of the line (L or R, looking from its first point to its last) that faces compass direction `dir`, and how
   sure: each piece of the line votes with its length times the cosine between its left normal and `dir`, so a curving
   block follows its curve. conf = |vote| / length: 1 when the street runs square to `dir`, 0 when it runs along it. */
export function sideOf(coords, dir) {
  const a = ANGLE[dir] * Math.PI / 180, tx = Math.cos(a), ty = Math.sin(a);
  let vote = 0, len = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = xy(coords[i - 1]), [x2, y2] = xy(coords[i]), dx = x2 - x1, dy = y2 - y1;
    vote += -dy * tx + dx * ty;                      // left normal (-dy, dx) · direction
    len += Math.hypot(dx, dy);
  }
  return { side: vote >= 0 ? 'L' : 'R', conf: len ? Math.abs(vote) / len : 0 };
}
// The compass word for a side, from the direction its normal points (first to last point): Boston's compass().
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];
export function compass(c, side) {
  const a = xy(c[0]), b = xy(c[c.length - 1]), dx = b[0] - a[0], dy = b[1] - a[1];
  const ang = Math.atan2(side === 'L' ? dx : -dx, side === 'L' ? -dy : dy) * 180 / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}
const flip = (s) => (s === 'L' ? 'R' : 'L');
const AXIS = { N: 'NS', S: 'NS', E: 'EW', W: 'EW', NE: 'NESW', SW: 'NESW', NW: 'NWSE', SE: 'NWSE' };

/* A segment's rules placed on the line: [{ rule, sides: ['L'] | ['R'] | ['L','R'], label, conf, ambiguous }]. */
export function placeRules(rules, coords) {
  return rules.map((rule) => {
    if (rule.side === 'BOTH') return { rule, sides: ['L', 'R'], conf: 1, ambiguous: !!(rule.unnamed && rule.days.length > 1) };
    const { side, conf } = sideOf(coords, rule.side);
    return { rule, sides: [side], label: COMPASS_WORD[rule.side], conf, ambiguous: conf < AMBIGUOUS };
  });
}

// ---------- tickets: what they say about a block's sides --------------------------------------------

// Does a rule sweep on the local date y-mo-da (weekday, week of the month, month)? rule = [dow, from, to, weeks, months]
export function sweepsOn(rule, y, mo, da) {
  const [dow, , , weeks, months] = rule;
  if (new Date(Date.UTC(y, mo - 1, da)).getUTCDay() !== dow) return false;
  if (months && !(months & (1 << (mo - 1)))) return false;
  return !!(weeks & (1 << (Math.ceil(da / 7) - 1)));
}
const ruleOn = (r, y, mo, da) => r.days.some((d) => sweepsOn([d, 0, 0, r.weeks, r.months], y, mo, da));

/* Votes, from one block's tickets ({ odd: bool, y, mo, da }), for what the text leaves open:
   - axis votes: for the ambiguous compass sides of one axis (a "NS"/"SS" pair on a north to south street), how many
     tickets say the axis' first direction (N, E, NE, NW) is the odd side vs the even side; a ticket counts for a rule
     only on a date no other rule of the block sweeps;
   - day votes: for an unnamed two day rule ("Every Tues & Wed"), per day, tickets on the odd vs the even side. */
export function ticketVotes(placed, tickets) {
  const axes = {}, days = {};
  for (const p of placed) {
    if (!p.ambiguous) continue;
    const others = placed.filter((o) => o !== p).map((o) => o.rule);
    for (const t of tickets) {
      if (!ruleOn(p.rule, t.y, t.mo, t.da) || others.some((o) => ruleOn(o, t.y, t.mo, t.da))) continue;
      if (p.rule.side === 'BOTH') {
        const dow = new Date(Date.UTC(t.y, t.mo - 1, t.da)).getUTCDay();
        const v = (days[dow] ||= { odd: 0, even: 0 }); t.odd ? v.odd++ : v.even++;
      } else {
        const ax = AXIS[p.rule.side], first = ax.startsWith(p.rule.side) && ax.length === 2 * p.rule.side.length;
        const v = (axes[ax] ||= { firstOdd: 0, firstEven: 0 });
        (t.odd === first) ? v.firstOdd++ : v.firstEven++;    // a ticket for N on the odd side = N is odd; for S on the odd side = N is even
      }
    }
  }
  return { axes, days };
}
// A vote is decided at 5 tickets and 80%: 'a', 'b' or null.
export const decide = (a, b, min = 5, share = 0.8) => (a + b >= min ? (a / (a + b) >= share ? 'a' : b / (a + b) >= share ? 'b' : null) : null);

/* Settle the ambiguous rules of one block: axis → { firstOdd: true|false } and the day split → { [dow]: 'odd'|'even' }.
   `blockVotes` first, then `streetVotes` (the same street and the same schedule text: house number parity is the same
   side all along a street, so the votes add up across its blocks), else nothing (the compass guess stays). */
export function settle(blockVotes, streetVotes) {
  const out = { axes: {}, days: null, from: {} };
  for (const ax of new Set([...Object.keys(blockVotes.axes), ...Object.keys(streetVotes?.axes || {})])) {
    for (const [src, v] of [['block', blockVotes.axes[ax]], ['street', streetVotes?.axes[ax]]]) {
      const d = v && decide(v.firstOdd, v.firstEven);
      if (d) { out.axes[ax] = d === 'a'; out.from[ax] = src; break; }
    }
  }
  for (const [src, v] of [['block', blockVotes.days], ['street', streetVotes?.days]]) {
    const ds = Object.keys(v || {}).map(Number);
    if (ds.length !== 2) continue;
    const [d1, d2] = ds, a = decide(v[d1].odd, v[d1].even), b = decide(v[d2].odd, v[d2].even);
    if (a && b && a !== b) { out.days = { [d1]: a === 'a' ? 'odd' : 'even', [d2]: b === 'a' ? 'odd' : 'even' }; out.from.days = src; break; }
  }
  return out;
}

/* A posted segment's sides: Map(L|R → { label, rules: Map(key → [dow, from, to, weeks, months, flags]) }), with the
   ambiguous rules settled by `settled` (from settle()) on a line whose odd numbers are on `oddSide`. flags 0: San
   Diego cancels every sweep on a City holiday (none runs anyway) and does not tow. */
export function buildSides(placed, coords, oddSide, settled) {
  const sides = new Map(), notes = [];
  const add = (side, label, rule, days) => {
    if (!sides.has(side)) sides.set(side, { label, rules: new Map() });
    for (const dow of days) { const r = [dow, rule.from, rule.to, rule.weeks, rule.months, 0]; sides.get(side).rules.set(r.join('|'), r); }
  };
  for (const p of placed) {
    const r = p.rule;
    if (r.side === 'BOTH') {
      const split = p.ambiguous && settled?.days && oddSide;
      if (split) {
        for (const dow of r.days) { const s = settled.days[dow] === 'odd' ? oddSide : flip(oddSide); add(s, compass(coords, s), r, [dow]); }
        notes.push({ kind: 'split by tickets', days: settled.days, from: settled.from.days });
      } else {
        if (p.ambiguous) notes.push({ kind: 'both sides, not settled', days: r.days });
        for (const s of p.sides) add(s, compass(coords, s), r, r.days);
      }
      continue;
    }
    let side = p.sides[0], label = p.label;
    if (p.ambiguous) {
      const ax = AXIS[r.side], firstOdd = settled?.axes?.[ax];
      if (firstOdd !== undefined && oddSide) {
        const first = ax.startsWith(r.side) && ax.length === 2 * r.side.length;
        const odd = first === firstOdd;                       // this rule's side holds the odd numbers
        const s = odd ? oddSide : flip(oddSide);
        notes.push({ kind: s === side ? 'confirmed by tickets' : 'moved by tickets', dir: r.side, conf: +p.conf.toFixed(2), from: settled.from[ax] });
        side = s;
      } else notes.push({ kind: 'compass guess', dir: r.side, conf: +p.conf.toFixed(2) });
      label = compass(coords, side);                          // the City's "north side" of a north to south street: say what it is
    }
    add(side, label, r, r.days);
  }
  return { sides, notes };
}

// ---------- names -----------------------------------------------------------------------------------

const SUFFIX = { AV: 'Ave', ST: 'St', DR: 'Dr', RD: 'Rd', WY: 'Way', CT: 'Ct', PL: 'Pl', BL: 'Blvd', LN: 'Ln', TR: 'Ter',
  CR: 'Cir', PY: 'Pkwy', PT: 'Pt', CV: 'Cv', HY: 'Hwy', ML: 'Mall', RW: 'Row', TL: 'Trl', WAY: 'Way' };
const WORD = { AVNDA: 'Avenida', CAM: 'Camino', CTE: 'Corte', MTN: 'Mountain' };
const LOWER = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS']);
/* "01ST AV" → "1st Ave", "W ASH ST" → "W Ash St", "CAM DEL ORO" → "Camino del Oro", "25TH (SB) ST" → "25th St" (SB =
   South Bay, the City's marker for street names used twice), "TORREY PINES (FTG) BL" → "Torrey Pines Blvd (frontage)". */
export function streetName(raw) {
  let s = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const ftg = /\((?:[NSEW]{1,2} )?FTG\)/.test(s);
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const w = s.split(' ').filter(Boolean);
  const out = w.map((x, i) => {
    const ord = /^0*(\d+)(ST|ND|RD|TH)$/.exec(x);
    if (ord) return ord[1] + ord[2].toLowerCase();
    if (i === w.length - 1 && i > 0 && SUFFIX[x]) return SUFFIX[x];
    if (WORD[x]) return WORD[x];
    if (x.length === 1) return x;
    if (i > 0 && LOWER.has(x)) return x.toLowerCase();
    if (/^MC[A-Z]{2,}/.test(x)) return 'Mc' + x[2] + x.slice(3).toLowerCase();
    return x[0] + x.slice(1).toLowerCase();
  });
  return out.join(' ') + (ftg ? ' (frontage)' : '');
}
const crossName = (x) => { const v = String(x || '').trim().toUpperCase(); return !v ? '' : v === 'END' || v === 'BEGIN' ? 'End' : v === 'BOUNDARY' ? 'City limit' : streetName(v); };
// "Mid-City:City Heights" → "City Heights" (people say the part after the colon); "Mid-City:Eastern Area" keeps Mid-City.
export const hoodName = (n) => { const m = /^Mid-City:\s*(.*)$/.exec(n || ''); return m ? (/^Eastern/.test(m[1]) ? 'Mid-City ' + m[1] : m[1]) : n || ''; };

// One key per street for matching typed addresses and address points: "28TH ST" = "28th street", "01ST AV" = "1ST AVE".
const ABBR = { AVE: 'AV', AVENUE: 'AV', STREET: 'ST', BLVD: 'BL', BOULEVARD: 'BL', DRIVE: 'DR', ROAD: 'RD', WAY: 'WY', COURT: 'CT',
  PLACE: 'PL', LANE: 'LN', TERRACE: 'TR', TER: 'TR', CIRCLE: 'CR', CIR: 'CR', PKWY: 'PY', PARKWAY: 'PY' };
export function streetKey(s) {
  const w = String(s || '').toUpperCase().replace(/\([^)]*\)/g, ' ').replace(/[.,#]/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map((x) => x.replace(/^0+(\d)/, '$1'));
  if (w.length > 1 && ABBR[w[w.length - 1]]) w[w.length - 1] = ABBR[w[w.length - 1]];
  if (w.length > 1) w[0] = { WEST: 'W', EAST: 'E', NORTH: 'N', SOUTH: 'S' }[w[0]] || w[0];
  return w.join(' ');
}
// "1100 28TH ST" → { num: 1100, key: '28TH ST' }; free text ("WEST C/L 4900 PARAMOUNT DR") → null
export function parseAddress(loc) {
  const m = /^\s*(\d{1,6})\s+(?:BLK\s+|BLOCK\s+)?([A-Z0-9][A-Z0-9 .'/()-]*)$/i.exec(String(loc || ''));
  return m ? { num: +m[1], key: streetKey(m[2]) } : null;
}

// ---------- city facts ------------------------------------------------------------------------------

// City of San Diego holidays. 2026: sandiego.gov/city-holidays (read 2026-10-18; "City Holiday" on March 31 is Cesar
// Chavez Day). 2027 is not posted yet: the same eleven holidays by the City's rule (a Saturday holiday is observed the
// Friday before, a Sunday one the Monday after: the Dec. 23, 2021 Christmas notice, and Friday, Dec. 31, 2021 for New
// Year's Day 2022), including Friday, Dec. 31, 2027 for New Year's Day 2028. Posted sweeping is not enforced on them.
export const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day",
  '2026-03-31': 'Cesar Chavez Day', '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day', '2026-11-11': 'Veterans Day',
  '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day",
  '2027-03-31': 'Cesar Chavez Day', '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day', '2027-11-11': 'Veterans Day',
  '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)', '2027-12-31': "New Year's Day (observed)",
};
// The 2025 holidays inside the ticket year (same list and rule), for the check's "tickets on a holiday".
const PAST_HOLIDAYS = ['2025-07-04', '2025-09-01', '2025-11-11', '2025-11-27', '2025-12-25'];

// ---------- address points: which side the odd numbers are on ----------------------------------------

// SANDAG's X_COORD/Y_COORD are NAD83 / California zone 6 in US feet (EPSG:2230): Lambert conformal conic, inverted here.
const A = 6378137, FL = 1 / 298.257222101, E = Math.sqrt(2 * FL - FL * FL), FT = 1200 / 3937, RAD = Math.PI / 180;
const lccM = (p) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const lccT = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const P1 = (33 + 53 / 60) * RAD, P2 = (32 + 47 / 60) * RAD, P0 = (32 + 10 / 60) * RAD, L0 = -116.25 * RAD;
const LN = (Math.log(lccM(P1)) - Math.log(lccM(P2))) / (Math.log(lccT(P1)) - Math.log(lccT(P2)));
const LF = lccM(P1) / (LN * lccT(P1) ** LN), R0 = A * LF * lccT(P0) ** LN;
export function stateplaneToLonLat(X, Y) {
  const x = X * FT - 2000000, y = Y * FT - 500000, r = Math.hypot(x, R0 - y), th = Math.atan2(x, R0 - y), t = (r / (A * LF)) ** (1 / LN);
  let p = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) p = Math.PI / 2 - 2 * Math.atan(t * ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2));
  return [(th / LN + L0) / RAD, p / RAD];
}
// the side (L|R) of a line a point is on, and how far from it (m)
function sideAt(pts, [px, py]) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const u = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)), d = Math.hypot(px - x1 - u * dx, py - y1 - u * dy);
    if (!best || d < best.d) best = { d, side: dx * (py - y1) - dy * (px - x1) > 0 ? 'L' : 'R' };
  }
  return best;
}
// Every City of San Diego address point on a posted block's street, inside its house number range and within 60 m of its
// line, counted by parity and side. Only counts are kept: no address goes into any file.
async function addressSides(file, blocks) {
  const byKey = new Map();
  for (const b of blocks) { if (!byKey.has(b.key)) byKey.set(b.key, []); byKey.get(b.key).push(b); b.ap = { oL: 0, oR: 0, eL: 0, eR: 0 }; b.pts = b.coords.map(xy); }
  let head = null, points = 0, used = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(file) })) {
    const f = line.split(',');
    if (!head) { head = f.map((h) => h.replace(/^﻿/, '')); continue; }
    if (f[8] !== 'SD') continue;
    points++;
    const num = Math.round(+f[1]), cand = num > 0 && byKey.get(streetKey([f[3], f[4], f[6], f[5]].filter(Boolean).join(' ')));
    if (!cand) continue;
    let P = null;
    for (const b of cand) {
      if (num < b.lo || num > b.hi) continue;
      P ||= xy(stateplaneToLonLat(+f[13], +f[14]));
      const s = sideAt(b.pts, P);
      if (s && s.d <= 60) { b.ap[(num % 2 ? 'o' : 'e') + s.side]++; used++; }
    }
  }
  if (head.join(',').indexOf('ADDRNMBR,ADDRFRAC,ADDRPDIR,ADDRNAME,ADDRPOSTD,ADDRSFX,ADDRUNIT,ADDRJUR') < 0 || head[13] !== 'X_COORD') throw new Error('address points changed shape');
  return { points, used };
}

// ---------- the build -------------------------------------------------------------------------------

async function download(url, file, refresh) {
  const f = CACHE + file;
  if (!refresh && fs.existsSync(f)) return f;
  log(`fetching ${url}…`);
  const r = await fetch(url, { headers: { 'User-Agent': 'curb-san-diego-build (+https://curb.guide)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}
function readCsv(file, keep) {
  const rows = [], lines = fs.readFileSync(file, 'utf8').split(/\r?\n/), head = lines[0].split(',').map((h) => h.replace(/"/g, ''));
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]; if (!line) continue;
    const f = []; let cur = '', q = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (q) { if (ch === '"') { if (line[j + 1] === '"') { cur += '"'; j++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { f.push(cur); cur = ''; } else cur += ch;
    }
    f.push(cur);
    const o = {}; head.forEach((h, k) => { o[h] = f[k]; });
    if (keep(o)) rows.push(o);
  }
  return rows;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const sweep = JSON.parse(fs.readFileSync(await download(SWEEP_URL, 'street_sweeping_datasd.geojson', refresh), 'utf8'));
  const cpa = JSON.parse(fs.readFileSync(await download(CPA_URL, 'cmty_plan_datasd.geojson', refresh), 'utf8'));
  const citeFiles = [];
  for (const p of CITATION_PARTS) citeFiles.push(await download(CITATIONS(p), `parking_citations_${p}_datasd.csv`, refresh));
  const addressFile = await download(ADDRESS_URL, 'Address_Points.csv', refresh);
  // The schedule's own "Last Updated" (the file is re-exported weekly, so its Last-Modified header is not that date)
  const page = fs.readFileSync(await download(DATASET_PAGE, 'street-sweeping-schedule.html', refresh), 'utf8');
  const updated = (/Last Updated<\/span>\s*<span class="detail-value">\s*([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(page) || /Updated\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(page) || [])[1] || null;
  if (!updated) log('the dataset page has no "Last Updated" date: left out of the words');

  // The data must look like it did on 2026-05-05, or the parse below means something else.
  const F = sweep.features || [];
  const need = ['sapid', 'rd20full', 'llowaddr', 'lhighaddr', 'rlowaddr', 'rhighaddr', 'xstrt1', 'xstrt2', 'cpcode', 'posted', 'schedule', 'schedule2'];
  const missing = need.filter((k) => !(k in (F[0]?.properties || {})));
  if (F.length < 20000 || missing.length) throw new Error(`street sweeping data changed shape: ${F.length} features, missing ${missing.join(', ') || 'none'}`);
  const postedValues = new Set(F.map((f) => f.properties.posted));
  if (!postedValues.has('P') || [...postedValues].some((v) => v !== 'P' && v !== 'NP')) throw new Error(`posted is now ${[...postedValues].join(', ')}`);
  const cpName = new Map(cpa.features.map((f) => [String(f.properties.cpcode), hoodName(f.properties.cpname)]));

  // ---- 1. parse every posted segment and place its rules ----
  const report = { unreadable: [], partly: [], noGeometry: 0 };
  const blocks = [], schedules = new Set(), notPostedByKind = {};
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  for (const f of F) {
    const p = f.properties;
    if (p.posted !== 'P') { const k = String(p.schedule || '').split(',')[0].trim(); notPostedByKind[k] = (notPostedByKind[k] || 0) + 1; continue; }
    const text = [p.schedule, p.schedule2].filter((x) => x && String(x).trim()).join(' || ').replace(/\s+/g, ' ').trim();
    schedules.add(text);
    const g = f.geometry, coords = g?.type === 'LineString' ? g.coordinates : g?.type === 'MultiLineString' ? g.coordinates.flat() : null;
    if (!coords || coords.length < 2) { report.noGeometry++; report.unreadable.push({ c: p.sapid, s: p.rd20full, why: 'no line', schedule: text }); continue; }
    const { rules, problems } = parseSchedule(p.schedule, p.schedule2);
    if (!rules.length) { report.unreadable.push({ c: p.sapid, s: p.rd20full, why: problems.join('; '), schedule: text }); continue; }
    if (problems.length) report.partly.push({ c: p.sapid, s: p.rd20full, why: problems.join('; '), schedule: text });
    const L = [num(p.llowaddr), num(p.lhighaddr)].filter(Boolean), R = [num(p.rlowaddr), num(p.rhighaddr)].filter(Boolean), nums = [...L, ...R];
    blocks.push({ p, coords, text, key: streetKey(p.rd20full), placed: placeRules(rules, coords), L, R,
      lo: nums.length ? Math.min(...nums) : null, hi: nums.length ? Math.max(...nums) : null,
      rangeOdd: L.length && L[0] % 2 === 1 ? 'L' : R.length && R[0] % 2 === 1 ? 'R' : null });
  }
  if (new Set(blocks.map((b) => b.p.sapid)).size !== blocks.length) throw new Error('a sapid repeats among posted segments');

  // ---- 2. the odd side of each block: the address points where they are clear, else the City's L/R ranges ----
  const ap = await addressSides(addressFile, blocks.filter((b) => b.lo));
  const odd = { agree: 0, fixed: [], rangesOnly: 0, unclear: 0 };
  for (const b of blocks) {
    const t = b.ap, tot = t ? t.oL + t.oR + t.eL + t.eR : 0, l = t ? t.oL + t.eR : 0, r = t ? t.oR + t.eL : 0;
    const phys = tot >= 4 && Math.max(l, r) / tot >= 0.8 ? (l > r ? 'L' : 'R') : null;
    delete b.pts;
    if (!phys) { tot >= 4 ? odd.unclear++ : odd.rangesOnly++; b.odd = b.rangeOdd; continue; }
    if (b.rangeOdd && phys !== b.rangeOdd) odd.fixed.push({ c: b.p.sapid, s: b.p.rd20full, l: [b.p.xstrt1, b.p.xstrt2].join(' - '), points: tot });
    else odd.agree++;
    b.odd = phys;
  }

  // ---- 3. last year's street sweeping tickets on each posted block ----
  const isSweepTicket = (o) => /STREET SWEEPING/.test(o.vio_desc || '') && /^86\.0112\(E\)/.test(o.vio_code || '');
  const tickets = citeFiles.flatMap((file) => readCsv(file, isSweepTicket));
  const lastDay = tickets.reduce((m, t) => (t.date_issue > m ? t.date_issue : m), '');
  const from = new Date(Date.UTC(+lastDay.slice(0, 4) - 1, +lastDay.slice(5, 7) - 1, +lastDay.slice(8, 10) + 1)).toISOString().slice(0, 10);
  const year = tickets.filter((t) => t.date_issue >= from && t.date_issue <= lastDay);
  const fines = year.reduce((m, t) => { const k = `${t.date_issue.slice(0, 7)} $${t.vio_fine}`; m[k] = (m[k] || 0) + 1; return m; }, {});
  const spans = new Map();   // street key → every segment's address span, posted or not
  for (const f of F) {
    const p = f.properties, nums = [p.llowaddr, p.lhighaddr, p.rlowaddr, p.rhighaddr].map(num).filter(Boolean);
    if (!nums.length) continue;
    const k = streetKey(p.rd20full);
    if (!spans.has(k)) spans.set(k, []);
    spans.get(k).push({ lo: Math.min(...nums), hi: Math.max(...nums), posted: p.posted === 'P', c: p.sapid });
  }
  const bySapid = new Map(blocks.map((b) => [b.p.sapid, b]));
  const hol = new Set([...Object.keys(HOLIDAYS), ...PAST_HOLIDAYS]);
  const where = { tickets: year.length, address: 0, onPostedBlock: 0, onUnpostedBlockOnly: 0, noBlock: 0, onHoliday: 0, twoBlocks: 0 };
  for (const b of blocks) b.tickets = [];
  for (const t of year) {
    const a = parseAddress(t.location);
    if (!a) continue;
    where.address++;
    if (hol.has(t.date_issue)) where.onHoliday++;
    const segs = (spans.get(a.key) || []).filter((s) => a.num >= s.lo && a.num <= s.hi);
    let mine = segs.filter((s) => s.posted && bySapid.has(s.c)).map((s) => bySapid.get(s.c));
    if (!mine.length) { segs.length ? where.onUnpostedBlockOnly++ : where.noBlock++; continue; }
    where.onPostedBlock++;
    const [y, mo, da] = t.date_issue.split('-').map(Number);
    // the same name twice ("25TH ST" in Golden Hill and in the South Bay): the block swept that day, else the first
    if (mine.length > 1) { where.twoBlocks++; const on = mine.filter((b) => b.placed.some((p) => ruleOn(p.rule, y, mo, da))); mine = [on[0] || mine[0]]; }
    mine[0].tickets.push({ odd: a.num % 2 === 1, y, mo, da });
  }

  // ---- 4. settle what the text leaves open, block by block, then street by street ----
  for (const b of blocks) b.votes = ticketVotes(b.placed, b.tickets);
  const streetVotes = new Map();
  for (const b of blocks) {
    if (!b.placed.some((p) => p.ambiguous)) continue;
    const k = b.key + '|' + b.text, sv = streetVotes.get(k) || { axes: {}, days: {} };
    for (const [ax, v] of Object.entries(b.votes.axes)) { const s = (sv.axes[ax] ||= { firstOdd: 0, firstEven: 0 }); s.firstOdd += v.firstOdd; s.firstEven += v.firstEven; }
    for (const [d, v] of Object.entries(b.votes.days)) { const s = (sv.days[d] ||= { odd: 0, even: 0 }); s.odd += v.odd; s.even += v.even; }
    streetVotes.set(k, sv);
  }
  const settledNotes = [];
  for (const b of blocks) {
    const settled = b.placed.some((p) => p.ambiguous) ? settle(b.votes, streetVotes.get(b.key + '|' + b.text)) : null;
    const { sides, notes } = buildSides(b.placed, b.coords, b.odd, settled);
    b.sides = sides;
    for (const n of notes) settledNotes.push({ c: b.p.sapid, s: b.p.rd20full, schedule: b.text, ...n });
  }

  // ---- 5. the check: is each ticket on a block side the data says is swept that day? ----
  const check = { sideSweptThatDay: 0, otherSideOnly: 0, blockNotSweptThatDay: 0, sideUnknown: 0 };
  const swapCandidates = [];
  for (const b of blocks) {
    const swept = (s, t) => b.sides.has(s) && [...b.sides.get(s).rules.values()].some((r) => sweepsOn(r, t.y, t.mo, t.da));
    for (const t of b.tickets) {
      if (!b.odd) { check.sideUnknown++; continue; }
      const side = t.odd ? b.odd : flip(b.odd);
      if (swept(side, t)) check.sideSweptThatDay++;
      else if (swept(flip(side), t)) check.otherSideOnly++;
      else check.blockNotSweptThatDay++;
    }
    // A clear City side (not settled above) whose tickets, on both sides of the block, are on the other side: listed for
    // the City, not changed (report.json sideSwapCandidates).
    if (!b.odd) continue;
    const ev = b.placed.filter((p) => !p.ambiguous && p.rule.side !== 'BOTH').map((p) => {
      const others = b.placed.filter((o) => o !== p).map((o) => o.rule);
      let on = 0, off = 0;
      for (const t of b.tickets) {
        if (!ruleOn(p.rule, t.y, t.mo, t.da) || others.some((o) => ruleOn(o, t.y, t.mo, t.da))) continue;
        ((t.odd ? b.odd : flip(b.odd)) === p.sides[0]) ? on++ : off++;
      }
      return { dir: p.rule.side, on, off };
    });
    const strong = ev.filter((e) => decide(e.off, e.on) === 'a');
    if (strong.length >= 2 && strong.length === ev.filter((e) => e.on + e.off >= 5).length)
      swapCandidates.push({ c: b.p.sapid, s: streetName(b.p.rd20full), l: [crossName(b.p.xstrt1), crossName(b.p.xstrt2)].join(' - '),
        schedule: b.text, tickets: ev.map((e) => `${e.dir}: ${e.off} on the other side, ${e.on} on its own`).join('; ') });
  }

  // The candidates' two sides trade rules, to where the tickets show the signs are (Oakland's build does the same with
  // its reversed blocks), unless --as-published; the check is counted again after.
  const swapped = new Set(process.argv.includes('--as-published') ? [] : swapCandidates.map((x) => x.c));
  const checkFinal = { sideSweptThatDay: 0, otherSideOnly: 0, blockNotSweptThatDay: 0 };
  for (const b of blocks) {
    if (swapped.has(b.p.sapid) && b.sides.has('L') && b.sides.has('R')) {
      const L = b.sides.get('L'), R = b.sides.get('R');
      [L.rules, R.rules] = [R.rules, L.rules];
    }
    if (!b.odd) continue;
    const swept = (s, t) => b.sides.has(s) && [...b.sides.get(s).rules.values()].some((r) => sweepsOn(r, t.y, t.mo, t.da));
    for (const t of b.tickets) {
      const side = t.odd ? b.odd : flip(b.odd);
      if (swept(side, t)) checkFinal.sideSweptThatDay++;
      else if (swept(flip(side), t)) checkFinal.otherSideOnly++;
      else checkFinal.blockNotSweptThatDay++;
    }
  }

  // ---- 6. write ----
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = blocks.map((b) => {
    const p = b.p, nums = [...b.L, ...b.R];
    const d = ['L', 'R'].filter((s) => b.sides.has(s)).map((s) => [s, b.sides.get(s).label,
      [...b.sides.get(s).rules.values()].sort((x, y) => x[0] - y[0] || x[3] - y[3] || x[4] - y[4])]);
    return { c: p.sapid, s: streetName(p.rd20full), l: [crossName(p.xstrt1), crossName(p.xstrt2)].filter(Boolean).join(' - '),
      ...(cpName.get(String(p.cpcode)) ? { h: cpName.get(String(p.cpcode)) } : {}),
      ...(nums.length ? { n: [Math.min(...nums), Math.max(...nums)] } : {}), ...(b.odd ? { o: b.odd } : {}),
      g: b.coords.map(([lo, la]) => [r6(lo), r6(la)]), d };
  }).sort((x, y) => x.c.localeCompare(y.c, 'en', { numeric: true }));
  const sidesOut = out.reduce((n, b) => n + b.d.length, 0), rulesOut = out.reduce((n, b) => n + b.d.reduce((m, x) => m + x[2].length, 0), 0);

  // map view and neighborhoods from the posted blocks
  const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
  const ends = F.flatMap((f) => (f.geometry?.type === 'LineString' ? [f.geometry.coordinates[0]] : []));
  const aLon = ends.map((p) => p[0]).sort((a, b) => a - b), aLat = ends.map((p) => p[1]).sort((a, b) => a - b);
  const bounds = [[+aLat[0].toFixed(4), +aLon[0].toFixed(4)], [+aLat[aLat.length - 1].toFixed(4), +aLon[aLon.length - 1].toFixed(4)]];
  const cells = new Map();   // the opening view: the ~1.5 km square holding the most posted block sides
  for (const b of out) { const [lo, la] = b.g[Math.floor(b.g.length / 2)]; const k = Math.floor(lo / 0.016) + ',' + Math.floor(la / 0.0135); cells.set(k, (cells.get(k) || 0) + b.d.length); }
  const [[best]] = [...cells.entries()].sort((x, y) => y[1] - x[1]);
  const [cx, cy] = best.split(',').map(Number);
  const center = [+((cy + 0.5) * 0.0135).toFixed(4), +((cx + 0.5) * 0.016).toFixed(4)];
  const hoodBlocks = out.reduce((m, b) => { if (b.h) (m[b.h] ||= []).push(b); return m; }, {});
  const hoods = Object.entries(hoodBlocks).filter(([, bs]) => bs.length >= 10).map(([name, bs]) => [name, bs.flatMap((b) => b.g)])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, g]) => {
      const lo = g.map((p) => p[0]).sort((a, b) => a - b), la = g.map((p) => p[1]).sort((a, b) => a - b);
      return { name, bbox: [q(lo, 0.02), q(la, 0.02), q(lo, 0.98), q(la, 0.98)].map((v) => v.toFixed(4)).join(',') };
    });

  const today = new Date().toISOString().slice(0, 10);
  const sources = [
    { name: 'Street Sweeping Schedule (Stormwater Department)', url: 'https://data.sandiego.gov/datasets/street-sweeping-schedule/', license: 'ODC PDDL', fetched: today },
    { name: 'Community Planning Areas', url: 'https://data.sandiego.gov/datasets/gis-community-planning-districts/', license: 'ODC PDDL', fetched: today },
    { name: 'Parking Citations', url: 'https://data.sandiego.gov/datasets/parking-citations/', license: 'ODC PDDL', fetched: today },
    { name: 'Address Points (SANDAG)', url: 'https://data.sandiego.gov/datasets/gis-address-points-apn/', license: 'ODC PDDL', fetched: today },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + 'segments.json', JSON.stringify({
    _meta: { city: 'san-diego', time_zone: 'America/Los_Angeles', generated: new Date().toISOString(), sources, blocks: out.length, sides: sidesOut,
      format: 'b[] = {c: City segment id (sapid), s: street, l: cross streets, h: community planning area, n: [lowest, highest house number], o: the side with odd numbers (L|R), g: centerline [[lng,lat]], d: [[side L|R, compass label, rules]]}; '
        + 'rule = [jsDow, fromH, toH, weeksMask (bit i = week i+1), monthsMask (bit m-1; 0 = all year; 2730 = even months, 1365 = odd months), flags (0: holidays cancel, no tow)]' },
    b: out }));

  const k = (n) => n.toLocaleString('en-US');
  const city = {
    id: 'san-diego', name: 'San Diego', region: 'California', tz: 'America/Los_Angeles',
    center, zoom: 15, bounds,
    holidays: HOLIDAYS, holidaysSource: 'https://www.sandiego.gov/city-holidays', holidayRule: 'all',
    fine: '$83.50', tow: 'no', fineSource: 'https://data.sandiego.gov/datasets/parking-citations/',
    agency: 'City of San Diego Stormwater Department', scheduleUrl: 'https://www.sandiego.gov/stormwater/services/streetsweeping',
    sources,
    words: {
      rule: 'Where street sweeping signs are posted, no parking during the hours on the sign, on the days it names: weekly on busier streets, once or twice a month on most residential blocks, every other month on some.',
      afterpass: 'All year · not on City holidays · $83.50 ticket, no tow',
      dataNotes: `The City's street sweeping schedule (Stormwater Department, data.sandiego.gov${updated ? ', updated ' + updated : ''}): the ${k(out.length)} blocks with signs, of ${k(F.length)} swept; blocks without signs are swept too but get no tickets, so they are left off. `
        + 'The schedule names each side by compass ("NS", "SES"), drawn on the side of the street line facing that way; where that is unclear, the City\'s own street sweeping tickets of the past year decide.'
        + (swapped.size ? ` On ${swapped.size} blocks whose tickets show the two sides' days reversed, the two are swapped.` : ''),
    },
    neighborhoods: hoods,
  };
  fs.writeFileSync(OUT + 'city.json', JSON.stringify(city, null, 1) + '\n');

  const count = (kind) => settledNotes.filter((n) => n.kind === kind).length;
  const rep = {
    generated: new Date().toISOString(),
    season: `All year. ${out.filter((b) => b.d.some(([, , rs]) => rs.some((r) => r[4]))).length} blocks have a side swept only in odd or even months (monthsMask 1365 or 2730). A City holiday skips the sweep ("swept on the next assigned sweeping day", sandiego.gov); no make-up day.`,
    scheduleUpdated: updated,
    input: { rows: F.length, segments: new Set(F.map((f) => f.properties.objectid)).size, posted: blocks.length + report.unreadable.length,
      notPosted: F.length - blocks.length - report.unreadable.length, distinctPostedSchedules: schedules.size, notPostedByKind },
    output: { blocks: out.length, sides: sidesOut, rules: rulesOut,
      oneSideOnly: out.filter((b) => b.d.length === 1).length,
      everyWeek: out.filter((b) => b.d.some(([, , rs]) => rs.some((r) => r[3] === 31))).length,
      oddOrEvenMonths: out.filter((b) => b.d.some(([, , rs]) => rs.some((r) => r[4]))).length,
      overnight: out.filter((b) => b.d.some(([, , rs]) => rs.some((r) => parseInt(r[1], 10) < 6))).length },
    skipped: { notPosted: F.length - blocks.length - report.unreadable.length, unreadable: report.unreadable, partlyRead: report.partly },
    oddSide: { method: 'SANDAG address points of the City (ADDRJUR SD) on each posted block\'s street, inside its number range and within 60 m of the line: the side holding the odd numbers when 4 or more points agree 80%; else the City\'s L/R address ranges.',
      addressPoints: ap.points, pointsOnPostedBlocks: ap.used, agreeWithRanges: odd.agree, rangesFixed: odd.fixed.length, fixedBlocks: odd.fixed,
      rangesOnly: odd.rangesOnly, unclear: odd.unclear },
    sidePlacement: {
      method: `Each named side (NS, SS, ES, WS, NS/WS, SES, …) goes on the side of the line whose outward normal is closest to that compass direction, length weighted. When the direction runs within ~20° of the street (conf < ${AMBIGUOUS}), the City's word is ambiguous: the side is the one the block's street sweeping tickets of the past year carry (house number parity, on dates only that rule sweeps; 5 tickets and 80% to decide), else the same street's with the same schedule text, else the compass guess stays. "Every Tues & Wed" names no side: split by the tickets the same way (each day on the side its tickets are on), else both sides both days.`,
      ambiguous: settledNotes.filter((n) => n.dir).length, confirmedByTickets: count('confirmed by tickets'), movedByTickets: count('moved by tickets'),
      compassGuess: count('compass guess'), splitByTickets: count('split by tickets'), bothSidesNotSettled: count('both sides, not settled'),
      notes: settledNotes },
    crossCheck: { tickets: where.tickets, from, to: lastDay, withAddress: where.address, onPostedBlock: where.onPostedBlock,
      onUnpostedBlockOnly: where.onUnpostedBlockOnly, noBlock: where.noBlock, onHoliday: where.onHoliday, matchedTwoBlocks: where.twoBlocks, ...check,
      note: 'Street sweeping tickets (86.0112(E)) of the last 12 months in the City\'s citation data, which has the date and the typed address but no time. Each ticket goes on the posted block of its street whose numbers hold it, on the side holding its parity; "sideSweptThatDay" = that side has a rule on that date (weekday, week of the month, month). Tickets are written only where a sign says no parking that day, so this is how we know the schedule is the one on the signs.',
      finesByMonth: fines, afterSwaps: checkFinal },
    sideSwapCandidates: { note: 'Blocks where the City names both sides clearly but the tickets on both sides are on the other side (5 tickets and 80% each, on dates only that rule sweeps): the sides look swapped in the schedule, or the signs differ from it. ' + (swapped.size ? 'Swapped to follow the tickets (--as-published keeps the City\'s text); a question for the City.' : 'Left as the City wrote them (--as-published); a question for the City.'),
      blocks: swapCandidates.length, swapped: swapped.size, list: swapCandidates },
  };
  fs.writeFileSync(OUT + 'report.json', JSON.stringify(rep, null, 1) + '\n');
  const sum = check.sideSweptThatDay + check.otherSideOnly + check.blockNotSweptThatDay;
  log(`${F.length} rows: ${rep.input.posted} posted; ${out.length} blocks, ${sidesOut} sides, ${rulesOut} rules; ${report.unreadable.length} unreadable, ${report.partly.length} partly read`);
  log(`odd side: ${ap.used} address points on posted blocks; ${odd.agree} agree with the ranges, ${odd.fixed.length} fixed, ${odd.rangesOnly} ranges only, ${odd.unclear} unclear`);
  log(`sides: ${rep.sidePlacement.ambiguous} ambiguous (${rep.sidePlacement.confirmedByTickets} confirmed, ${rep.sidePlacement.movedByTickets} moved by tickets, ${rep.sidePlacement.compassGuess} compass guess); "Every Tues & Wed": ${rep.sidePlacement.splitByTickets} split, ${rep.sidePlacement.bothSidesNotSettled} left both`);
  log(`tickets ${from}..${lastDay}: ${where.tickets}; ${where.onPostedBlock} on a posted block (${where.onUnpostedBlockOnly} only unposted, ${where.noBlock} no block, ${where.onHoliday} on a holiday); `
    + `side swept that day ${check.sideSweptThatDay} (${(100 * check.sideSweptThatDay / sum).toFixed(1)}%), other side only ${check.otherSideOnly}, block not swept that day ${check.blockNotSweptThatDay}; ${swapCandidates.length} blocks look swapped, ${swapped.size} swapped: `
    + `side swept that day after ${(100 * checkFinal.sideSweptThatDay / sum).toFixed(1)}%`);
  for (const f of ['segments.json', 'city.json', 'report.json']) log(`wrote data/san-diego/${f} (${Math.round(fs.statSync(OUT + f).size / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
