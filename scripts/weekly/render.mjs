// The weekly email: one report object (every source's section, see scripts/weekly/sources/) → the
// subject, an HTML body, a plain-text body and the inline PNGs the HTML points at (cid:). The look is
// CURB's own: paper background, ink borders, and section labels drawn as the red-on-white San
// Francisco street-sweeping plate. Email rules it keeps: tables for layout, inline styles everywhere,
// three tiny <style> blocks (fonts, phone + Apple Mail tweaks, dark mode; separate because Gmail drops
// a whole block it dislikes), no scripts, no remote images, every outside string escaped and only
// http(s) links kept. A section a source could not fill renders one quiet line, never a broken layout.
//
// Used by the weekly runner: const { subject, html, text, images } = await renderEmail(report).
// No env vars, no network.
import { visitorsChart, clicksChart, logoPng, CHART_HEIGHT, WIDTH as CHART_WIDTH } from './charts.mjs';
import { ymd, TZ, addDays } from './week.mjs';
import { REPLY_URL } from '../monitor/reviews.mjs';

export const MAX_HTML_BYTES = 90 * 1024; // Gmail clips a message body past ~102 KB
export const REPO = 'https://github.com/alevizio/curb';
export const DASHBOARDS = [
  ['Vercel Analytics', 'https://vercel.com/dashboard'],
  ['Search Console', 'https://search.google.com/search-console'],
  ['App Store Connect', REPLY_URL],
  ['GitHub', REPO],
];
const C = {
  paper: '#F2ECDF', sign: '#FFFDF6', ink: '#17150F', soft: '#4A4536', gray: '#8C8678', red: '#C1121F',
  green: '#0B6E4F', good: '#157A44', amber: '#8F5A06', line: '#E4DBC9', track: '#ECE4D4',
};
const SANS = "'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "Anton,Impact,'Arial Narrow Bold','Arial Narrow',sans-serif";
const FONTS_CSS = "@import url('https://fonts.googleapis.com/css2?family=Anton&family=Hanken+Grotesk:wght@400;600;700;800&display=swap');";
const CID = { logo: 'logo@curb.guide', visitors: 'visitors@curb.guide', clicks: 'clicks@curb.guide' };

// ---------- small pure helpers (exported for tests) ----------

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The URL if it is http(s), else null (drops javascript:, data:, mailto:, relative junk). */
export function safeUrl(u) {
  try {
    const x = new URL(String(u ?? ''));
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch { return null; }
}
/** A curb.guide path ('/b/123') as a full link; anything that escapes the host is dropped. */
const siteUrl = (path) => {
  try { const x = new URL(String(path), 'https://curb.guide'); return x.host === 'curb.guide' ? x.href : null; } catch { return null; }
};

const NF = new Intl.NumberFormat('en-US');
const fin = (v) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(+v);
/** 1234.4 → '1,234'; anything not a number → 'n/a'. */
export const num = (v) => (fin(v) ? NF.format(Math.round(+v)) : 'n/a');
const dec = (v, d = 1) => (fin(v) ? (+v).toFixed(d) : 'n/a');
/** A ratio (0.031) or an already-percent value (3.1) → '3.1%'. */
export const pct = (v) => (fin(v) ? `${(Math.abs(+v) <= 1 ? +v * 100 : +v).toFixed(1)}%` : 'n/a');

/** Week over week change → { text: '▲ 18%', words: 'up 18%', tone: good | bad | flat }. No dashes. */
export function change(cur, prev, { lowerIsBetter = false } = {}) {
  if (!fin(cur) || !fin(prev)) return { text: 'n/a', words: 'n/a', tone: 'flat' };
  const c = +cur, p = +prev;
  if (p === 0) return c === 0 ? { text: 'same', words: 'same as last week', tone: 'flat' } : { text: 'new', words: 'new', tone: 'flat' };
  const d = Math.round(((c - p) / Math.abs(p)) * 100);
  if (d === 0) return { text: 'same', words: 'same as last week', tone: 'flat' };
  const up = d > 0;
  return { text: `${up ? '▲' : '▼'} ${NF.format(Math.abs(d))}%`, words: `${up ? 'up' : 'down'} ${NF.format(Math.abs(d))}%`, tone: up !== lowerIsBetter ? 'good' : 'bad' };
}

const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
/** 'ok' | 'skipped' | 'error' | 'missing' for a section or sub-part. Arrays (reviews) are data. */
export function stateOf(s) {
  if (Array.isArray(s)) return 'ok';
  if (!isObj(s)) return 'missing';
  if (s.skipped) return 'skipped';
  if (s.error) return 'error';
  return 'ok';
}
const ok = (s) => stateOf(s) === 'ok';
const bad = (s) => stateOf(s) === 'error';
const list = (v) => (Array.isArray(v) ? v : []);
/** Dashes used as punctuation in text quoted from elsewhere ('run failed — alerts stopped') → commas. */
export const undash = (s) => String(s ?? '').replace(/,?\s*[—–]\s*|\s+-\s+/g, ', ');
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] || '');

const dayOf = (v) => {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? ymd(t) : null;
};
/** '2026-10-07' or an ISO time → 'Oct 7' (San Francisco calendar day). */
export const fmtDay = (v) => {
  const d = dayOf(v);
  return d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '';
};
const fmtTime = (v) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const plural = (n, one, many = one + 's') => `${num(n)} ${+n === 1 ? one : many}`;

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
const ALPHA3 = { USA: 'US', CAN: 'CA', GBR: 'GB', AUS: 'AU', DEU: 'DE', FRA: 'FR', MEX: 'MX', ESP: 'ES', ARG: 'AR', JPN: 'JP', IND: 'IN', BRA: 'BR', NLD: 'NL', IRL: 'IE', ITA: 'IT' };
const country = (c) => {
  const s = String(c ?? '').trim();
  const code = ALPHA3[s.toUpperCase()] || s.toUpperCase();
  try { return /^[A-Z]{2}$/.test(code) ? REGION.of(code) : s; } catch { return s; }
};
const hoodName = (path) => clip(String(path ?? '').replace(/^\/n\//, '').replace(/\/$/, '').split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), 40);
const pagePath = (u) => { try { const x = new URL(String(u), 'https://curb.guide'); return x.host === 'curb.guide' ? x.pathname + x.search : String(u); } catch { return String(u ?? ''); } };
// 'fix(og): ship hb.wasm' → { scope: 'og', text: 'ship hb.wasm' }
const commitText = (subject) => {
  const m = String(subject ?? '').match(/^[a-z]+(?:\(([^)]*)\))?!?:\s*(.+)$/i);
  return m ? { scope: m[1] || '', text: m[2] } : { scope: '', text: String(subject ?? '') };
};
const SOURCES = { hackernews: 'Hacker News', hn: 'Hacker News', reddit: 'Reddit', bluesky: 'Bluesky', x: 'X', twitter: 'X', mastodon: 'Mastodon', producthunt: 'Product Hunt', youtube: 'YouTube', news: 'News', web: 'Web', blog: 'Blog', github: 'GitHub', claude: 'Claude search' };
const sourceName = (s) => SOURCES[String(s ?? '').toLowerCase()] || clip(s || 'Web', 20);
const MENTION_SEARCHES = [['hackerNews', 'Hacker News'], ['googleNews', 'Google News'], ['reddit', 'Reddit']]; // { error } only when that search failed
// Claude's own 'source' text is a guess; the link's real host is not ('www.reddit.com/r/x' → 'reddit.com')
const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return ''; } };
const badge = (x) => (x.via === 'claude' ? clip(hostOf(x.url) || 'Web', 30) : sourceName(x.source));
/** Search Console marks its fresh, still changing days; inside the window they make totals look low. */
const googleIncomplete = (g) => { const fi = dayOf(g?.firstIncompleteDate), end = dayOf(g?.end); return Boolean(fi && end && fi <= end); };
const APP_METRICS = [['impressions', 'impressions'], ['pageViews', 'page views'], ['conversion', 'conversion'], ['sessions', 'sessions'], ['activeDevices', 'active devices'], ['crashes', 'crashes']];
/** App Store metrics that failed ({ error }), one entry per error: one report failing blanks all its metrics alike. */
const metricFailures = (aa) => {
  const by = new Map();
  for (const [k, name] of APP_METRICS) if (bad(aa[k])) { const e = String(aa[k].error); by.set(e, [...(by.get(e) || []), name]); }
  return [...by].map(([error, names]) => ({ what: andList(names), part: { error } }));
};
/** 'through Oct 9' for an App Store metric Apple is still counting (conversion follows page views). */
const through = (aa, k) => { const d = isObj(aa.lastDay) ? aa.lastDay[k === 'conversion' ? 'pageViews' : k] : null; return d ? `through ${fmtDay(d)}` : 'still being counted'; };
/** A part that failed says so in one line (HTML and text), never with empty or all clear wording. */
const cantText = (what, part, when = ' this week') => `Could not load ${what}${when}: ${clip(part?.error, 160)}`;

// ---------- what needs the owner ----------

/** Rule based list of things to act on this week: [{ text, url? }]. */
export function needsYou(report) {
  const s = report?.sections || {};
  const out = [];
  const gh = ok(s.github) ? s.github : null;
  for (const a of list(gh?.issues?.alertsOpen)) out.push({ text: `Monitor alert still open: #${a.number} ${clip(a.title, 90)}`, url: a.url });
  const al = ok(s.service) && ok(s.service.alerts) ? s.service.alerts : null;
  // the monitor's sender verdict already folds in failing deliveries, so it replaces that item
  const senderFail = al?.sender?.status === 'fail';
  if (senderFail) out.push({ text: `The sweep alert sender check failed: ${clip(undash(al.sender.detail), 160)}`, url: `${REPO}/actions/workflows/monitor.yml` });
  const failing = senderFail ? [] : list(al?.failing);
  if (failing.length) out.push({ text: `Push alerts are failing: ${clip(failing.join(', '), 140)}`, url: `${REPO}/actions` });
  const low = ok(s.app) ? +s.app.lowUnanswered || 0 : 0;
  if (low > 0) out.push({ text: `${low === 1 ? 'A low review has' : `${num(low)} low reviews have`} no reply yet`, url: REPLY_URL });
  const refresh = gh?.runs?.dataRefresh;
  if (refresh?.conclusion === 'failure') out.push({ text: `The data refresh failed${refresh.lastAt ? ` on ${fmtDay(refresh.lastAt)}` : ''}`, url: refresh.url || `${REPO}/actions` });
  const err = ok(s.service) && ok(s.service.errors) ? s.service.errors : null;
  // last week unknown (null) or a full log (capped: last week is a floor) cannot show a jump
  if (err && fin(err.total) && fin(err.prevTotal) && !err.capped && +err.total > 50 && +err.total > 2 * +err.prevTotal) {
    out.push({ text: `Browser errors jumped to ${num(err.total)} (last week ${num(err.prevTotal)})` });
  }
  // only issues still open: one already answered and closed during the week needs nothing more
  const closed = new Set(list(gh?.issues?.closed).map((i) => i.number));
  const open = Array.isArray(gh?.issues?.open) ? new Set(gh.issues.open.map((i) => i.number)) : null;
  for (const i of list(gh?.issues?.opened).filter((i) => !i.automated && !closed.has(i.number) && (!open || open.has(i.number)))) {
    out.push({ text: `New issue from a person: #${i.number} ${clip(i.title, 90)}`, url: i.url });
  }
  const mon = gh?.runs?.monitor;
  if (mon && +mon.total > 0 && +mon.failed / +mon.total > 0.05) {
    out.push({ text: `Monitor runs failed ${num(mon.failed)} of ${num(mon.total)} times (${pct(+mon.failed / +mon.total)})`, url: `${REPO}/actions/workflows/monitor.yml` });
  }
  return out;
}

/** Skipped sections and sub-parts for the footer: [{ name, reason }]. Errors are not listed here. */
export function notConnected(report) {
  const s = report?.sections || {};
  const out = [];
  const add = (name, part) => { if (stateOf(part) === 'skipped' || stateOf(part) === 'missing') out.push({ name, reason: part?.skipped ? String(part.skipped) : '' }); };
  add('Visits', s.visits);
  add('Alerts and errors', s.service);
  add('GitHub', s.github);
  if (ok(s.search)) { add('Google Search Console', s.search.google); add('Bing Webmaster Tools', s.search.bing); } else add('Search', s.search);
  if (ok(s.app)) { add('App Store reviews', s.app.reviews); add('App Store downloads', s.app.downloads); } else add('iPhone app', s.app);
  add('App Store analytics', s.appAnalytics);
  if (ok(s.mentions)) { if (stateOf(s.mentions.producthunt) === 'skipped') add('Product Hunt', s.mentions.producthunt); } else add('Mentions', s.mentions);
  add('Claude summary', s.claude);
  return out;
}

/** Every section or sub-part ({ error }, at any depth: github.runs.monitor, appAnalytics.sessions) that
 *  failed: [{ section, error }]. One error that blanks several parts of a section (visits' hourly rows
 *  feed daily and prevDaily) counts once. */
export function failures(report) {
  const out = [];
  const walk = (section, x, depth, seen) => {
    if (!isObj(x) || stateOf(x) === 'skipped' || depth > 3) return;
    if (bad(x)) { const e = String(x.error); if (!seen.has(e)) { seen.add(e); out.push({ section, error: e }); } return; }
    for (const v of Object.values(x)) walk(section, v, depth + 1, seen);
  };
  for (const [key, sec] of Object.entries(report?.sections || {})) walk(key, sec, 0, new Set());
  return out;
}

/** How many sections or sub-parts failed this week (shown in the status line, so "All good" never hides a gap). */
export const failedCount = (report) => failures(report).length;

// ---------- HTML building blocks (inline styles, classes only for the phone and dark mode) ----------

// Base text (font, 14/21, ink, tabular figures) is set once on the wrapper and on each card cell and
// inherited, so rows and paragraphs only carry what differs. That keeps the HTML well under Gmail's clip.
const BASE = `font-family:${SANS};font-size:14px;line-height:21px;color:${C.ink};font-variant-numeric:tabular-nums;`;
const T = {
  small: `font-size:12px;line-height:18px;color:${C.soft};`,
  num: 'white-space:nowrap;',
  display: `font-family:${DISPLAY};font-weight:400;`,
  link: `color:${C.ink};text-decoration:underline;text-decoration-color:${C.gray};`,
};
const TONE = { good: C.good, bad: C.red, flat: C.soft };
const P = (html, extra = '', cls = '') => `<p${cls ? ` class="${cls}"` : ''} style="margin:0;${extra}">${html}</p>`;
const warn = (html, extra = '') => P(html, `color:${C.amber};${extra}`, 'warn'); // a source failed: amber, not the red of "needs you"
const note = (html, extra = '') => `<p class="soft" style="margin:0;${T.small}${extra}">${html}</p>`;
const cantLoad = (what, part, extra = '', when) => warn(esc(cantText(what, part, when)), extra);
const link = (html, url) => { const u = safeUrl(url); return u ? `<a class="ink" href="${esc(u)}" style="${T.link}">${html}</a>` : html; };
/** A Search Console or Bing page ('/b/1', or a whole curb.guide URL) as its path, linked to curb.guide. */
const pageLink = (page, n) => { const p = pagePath(page); return link(esc(clip(p, n)), p.startsWith('/') ? siteUrl(p) : null); };
const toneSpan = (ch) => `<span class="${ch.tone === 'good' ? 'good' : ch.tone === 'bad' ? 'bad' : 'soft'}" style="color:${TONE[ch.tone]};font-weight:700;${T.num}">${esc(ch.text)}</span>`;
const sub = (title, first = false) => `<p class="soft" style="margin:${first ? '18px' : '22px'} 0 6px;font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${C.soft};">${esc(title)}</p>`;
const table = (inner, extra = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${extra}">${inner}</table>`;

/** The street-sweeping plate: white sign, red border, red caps. `alert` = the filled red plate. */
const plate = (title, alert = false) => `<span style="display:inline-block;background:${alert ? C.red : C.sign};color:${alert ? C.sign : C.red};border:2px solid ${C.red};border-radius:6px;padding:4px 9px 3px;font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;">${esc(title)}</span>`;

const card = (title, body, { alert = false } = {}) => `<tr><td style="padding:0 0 16px;">${table(
  `<tr><td class="pad ink" style="padding:20px;${BASE}">${plate(title, alert)}${body}</td></tr>`,
  `border-collapse:separate;background:${C.sign};border:2px solid ${alert ? C.red : C.ink};border-radius:14px;`,
).replace('<table ', `<table class="card${alert ? ' alert' : ''}" `)}</td></tr>`;

const quiet = (sec) => (stateOf(sec) === 'error'
  ? warn(`Could not load this week: ${esc(clip(sec.error, 160))}`, 'margin-top:14px;')
  : note('Not connected yet.', 'margin-top:14px;'));

/** Name / value rows. items: [{ label (html), value (text), sub? (html), share? 0..1 }] */
const rows = (items, empty) => {
  if (!items.length) return note(esc(empty), 'margin-top:2px;');
  const cell = `border-bottom:1px solid ${C.line};`;
  return table(items.map((it) => `<tr><td class="line" style="padding:7px 12px 7px 0;${cell}word-break:break-word;">${it.label}${it.sub ? `<br><span class="soft" style="${T.small}">${it.sub}</span>` : ''}${it.share != null ? `<div class="track" style="height:4px;background:${C.track};border-radius:2px;margin-top:5px;"><div class="fill" style="width:${Math.max(2, Math.round(it.share * 100))}%;height:4px;background:${C.ink};border-radius:2px;"></div></div>` : ''}</td><td class="line" align="right" valign="top" style="padding:7px 0;${cell}font-weight:700;white-space:nowrap;">${esc(it.value)}</td></tr>`).join(''));
};
const shares = (items, key) => { const max = Math.max(1, ...items.map((x) => +x[key] || 0)); return (x) => (+x[key] || 0) / max; };

// Two columns on a wide screen, stacked on a phone (inline-block halves; the phone CSS makes them full width).
const cols = (left, right) => `<div style="font-size:0;line-height:0;">${[left, right].map((h, i) => `<div class="col" style="display:inline-block;width:50%;min-width:240px;vertical-align:top;font-size:14px;line-height:21px;"><div class="colin" style="padding:0 ${i ? '0 0 12px' : '12px 0 0'};">${h}</div></div>`).join('')}</div>`;

/** A row of small stats inside a section: [{ value, label, ch?, sub? }] */
const kpis = (items) => `<div style="font-size:0;line-height:0;margin-top:14px;">${items.map((k) => `<div class="kpi" style="display:inline-block;width:25%;min-width:120px;vertical-align:top;font-size:14px;line-height:normal;"><div style="padding:0 8px 12px 0;"><div class="ink" style="${T.display}font-size:26px;line-height:30px;color:${C.ink};">${esc(k.value)}</div><div class="soft" style="${T.small}font-weight:700;">${esc(k.label)}${k.ch && k.ch.text !== 'n/a' && k.ch.text !== 'new' ? ` ${toneSpan(k.ch)}` : ''}</div>${k.sub ? `<div class="soft" style="${T.small}">${k.sub}</div>` : ''}</div></div>`).join('')}</div>`;

const chartImg = (cid, alt, w, h) => `<img src="cid:${cid}" width="556" height="${Math.round((556 * h) / w)}" alt="${esc(alt)}" style="display:block;width:100%;max-width:556px;height:auto;border:0;border-radius:8px;margin-top:16px;">`;
const chartAlt = (title, days, values) => `${title}: ${days.map((d, i) => `${fmtDay(d)} ${values[i] == null ? 'no data' : num(values[i])}`).join(', ')}`;
const byDate = (rows, key) => new Map(list(rows).map((r) => [r?.date, r?.[key]]));

// ---------- sections ----------

// How many rows each list shows, scaled down (never below 1) when a busy week would push the HTML past
// Gmail's clip. Set by renderEmail around one synchronous build, so it never leaks between renders.
let CAP = 1;
const cap = (n) => Math.max(1, Math.floor(n * CAP));

function visitsSection(v, days, has) {
  if (!ok(v)) return card('Visits', quiet(v));
  const daily = byDate(v.daily, 'visitors');
  const top = list(v.topPages).slice(0, cap(6));
  const refs = list(v.referrers).slice(0, cap(6));
  const hoods = list(v.topHoods).slice(0, cap(5));
  const ctry = list(v.countries).slice(0, cap(4));
  const dev = list(v.devices);
  const devTotal = dev.reduce((n, d) => n + (+d.visitors || 0), 0);
  // a group row ('/b/*', every block page added up) is no single page: no link, no path under it
  const page = (p) => { const group = String(p.path ?? '').endsWith('*'); const name = esc(clip(p.label || p.path, 48));
    return { label: group ? name : link(name, siteUrl(p.path)), sub: p.label && !group ? esc(clip(p.path, 48)) : '', value: num(p.visitors) }; };
  const left = sub('Top pages', true) + (bad(v.topPages) ? cantLoad('the top pages', v.topPages) : rows(top.map(page), 'No page data this week.'))
    + sub('Neighborhood pages') + (bad(v.topHoods) ? cantLoad('the neighborhood pages', v.topHoods) : rows(hoods.map((h) => ({ label: link(esc(hoodName(h.path)), siteUrl(h.path)), value: num(h.visitors) })), 'No neighborhood visits this week.'));
  const rs = shares(refs, 'visitors');
  const right = sub('Where visitors came from', true) + (bad(v.referrers) ? cantLoad('the referrers', v.referrers) : rows(refs.map((r) => ({ label: esc(clip(r.host, 40)), value: num(r.visitors), share: rs(r) })), 'No referrers this week.'))
    + sub('Countries') + (bad(v.countries) ? cantLoad('the countries', v.countries) : rows(ctry.map((c) => ({ label: esc(country(c.country)), value: num(c.visitors) })), 'No country data.'))
    + (bad(v.devices) ? cantLoad('the devices', v.devices, 'margin-top:10px;')
      : devTotal ? note(dev.slice(0, cap(3)).map((d) => `${esc(clip(d.device, 20))} ${Math.round(((+d.visitors || 0) / devTotal) * 100)}%`).join(', '), 'margin-top:10px;') : '');
  const gaps = [
    bad(v.prev) && cantLoad("last week's visits to compare", v.prev, '', ''),
    bad(v.daily) ? cantLoad('the visits per day', v.daily) : bad(v.prevDaily) && cantLoad("last week's visits per day", v.prevDaily, '', ''),
  ].filter(Boolean).join('');
  return card('Visits', kpis([
    { value: num(v.visitors), label: 'visitors', ch: change(v.visitors, v.prev?.visitors) },
    { value: num(v.pageviews), label: 'pageviews', ch: change(v.pageviews, v.prev?.pageviews) },
  ]) + gaps + (has.visitors ? chartImg(CID.visitors, chartAlt('Visits per day', days, days.map((d) => daily.get(d))), CHART_WIDTH, CHART_HEIGHT.visitors) : '') + cols(left, right));
}

function googleBlock(g, days, has) {
  if (!ok(g)) return sub('Google', true) + (stateOf(g) === 'error' ? quiet(g).replace('margin-top:14px', 'margin-top:0') : note('Not connected yet.'));
  const fresh = googleIncomplete(g); // fresh days in the window: totals still growing, so no change arrows
  const behind = g.end && dayOf(g.end) !== days[6] ? `Search Console runs 2 to 3 days behind, so this covers ${esc(fmtDay(g.start || days[0]))} to ${esc(fmtDay(g.end))}` : '';
  const lag = behind || fresh ? `${behind ? `${behind}${fresh ? ', and the last days are still coming in' : ''}` : 'The last days are still coming in'}.` : '';
  const q = list(g.topQueries).slice(0, cap(6));
  const pages = list(g.topPages).slice(0, cap(6));
  const posCh = fin(g.position) && fin(g.prev?.position) && Math.abs(g.position - g.prev.position) >= 0.05
    ? { text: g.position < g.prev.position ? 'better' : 'worse', tone: g.position < g.prev.position ? 'good' : 'bad' } : null;
  const bp = g.blockPages;
  const idx = g.indexSample;
  // Google's coverage states, minus the indexed one, in plain words ('Crawled - currently not indexed' → 'crawled, not indexed')
  const states = isObj(idx?.states) ? Object.entries(idx.states).filter(([k, n]) => +n > 0 && !/^(submitted and )?indexed/i.test(k))
    .map(([k, n]) => `${num(n)} ${esc(clip(COVERAGE[k.toLowerCase()] || k.replace(/\s+-\s+(currently\s+)?/i, ', ').toLowerCase(), 50))}`).join('; ') : '';
  const daily = byDate(g.daily, 'clicks');
  return sub('Google', true) + (lag ? note(lag) : '') + kpis([
    { value: num(g.clicks), label: 'clicks', ch: fresh ? null : change(g.clicks, g.prev?.clicks) },
    { value: num(g.impressions), label: 'impressions', ch: fresh ? null : change(g.impressions, g.prev?.impressions) },
    { value: pct(g.ctr), label: 'click rate', sub: fin(g.prev?.ctr) ? `from ${pct(g.prev.ctr)}` : '' },
    { value: dec(g.position), label: 'avg position', ch: posCh, sub: fin(g.prev?.position) ? `from ${dec(g.prev.position)}` : '' },
  ]) + (has.clicks ? chartImg(CID.clicks, chartAlt('Google clicks per day', googleDays(g, days), googleDays(g, days).map((d) => daily.get(d))), CHART_WIDTH, CHART_HEIGHT.clicks) : '')
    + cols(
      sub('Top searches', true) + rows(q.map((r) => ({ label: esc(clip(r.query, 60)), sub: `${num(r.impressions)} impressions, position ${dec(r.position)}`, value: num(r.clicks) })), 'No searches with clicks yet.'),
      sub('Top pages from Google', true) + rows(pages.map((p) => ({ label: pageLink(p.page, 44), sub: `${num(p.impressions)} impressions`, value: num(p.clicks) })), 'No pages with clicks yet.'),
    )
    + (bp && fin(bp.total) ? P(`<b>${num(bp.withImpressions)}</b> of ${num(bp.total)} block pages showed up in Google this week.`, 'margin-top:12px;') : '')
    + (bad(idx) ? cantLoad('the index check', idx, 'margin-top:4px;')
      : idx && fin(idx.checked) ? note(`Index check: ${num(idx.indexed)} of ${num(idx.checked)} sampled pages are indexed${states ? ` (${states})` : ''}.`, 'margin-top:4px;') : '');
}

// Bing's window ends on its own last day with data (search.mjs); its top pages cover the weeks Bing buckets them in.
function bingBlock(b) {
  if (!ok(b)) return sub('Bing') + (stateOf(b) === 'error' ? quiet(b).replace('margin-top:14px', 'margin-top:0') : note('Not connected yet.'));
  const pages = list(b.topPages).slice(0, cap(4));
  return sub('Bing') + (b.start && b.end ? note(`Bing data ${esc(fmtDay(b.start))} to ${esc(fmtDay(b.end))}.`) : '') + kpis([
    { value: num(b.clicks), label: 'clicks', ch: change(b.clicks, b.prev?.clicks) },
    { value: num(b.impressions), label: 'impressions', ch: change(b.impressions, b.prev?.impressions) },
  ]) + (bad(b.topPages) ? cantLoad('the Bing top pages', b.topPages)
    : (b.pagesFrom && b.pagesTo ? note(`Top pages for ${esc(fmtDay(b.pagesFrom))} to ${esc(fmtDay(b.pagesTo))}:`, 'margin-bottom:2px;') : '')
      + rows(pages.map((p) => ({ label: pageLink(p.page, 50), sub: fin(p.impressions) ? `${num(p.impressions)} impressions` : '', value: num(p.clicks) })), 'No Bing pages with clicks yet.'));
}

function searchSection(s, days, has) {
  if (!ok(s)) return card('Search', quiet(s));
  return card('Search', googleBlock(s.google, days, has) + bingBlock(s.bing));
}

const stars = (n) => { const k = Math.max(0, Math.min(5, Math.round(+n || 0))); return `<span style="color:${C.red};letter-spacing:1px;">${'★'.repeat(k)}</span><span class="star0" style="color:${C.line};letter-spacing:1px;">${'★'.repeat(5 - k)}</span>`; };

function appSection(app, aa) {
  const blocks = [];
  if (ok(app)) {
    const live = ok(app.live) ? app.live : {};
    const r = ok(app.rating) ? app.rating : {};
    const dl = app.downloads;
    blocks.push(kpis([
      { value: fin(r.average) ? `${dec(r.average)}★` : 'n/a', label: 'rating', sub: fin(r.count) ? plural(r.count, 'rating') : '' },
      { value: live.version ? clip(live.version, 12) : 'n/a', label: 'live version', sub: live.releasedAt ? `since ${esc(fmtDay(live.releasedAt))}` : '' },
      ...(ok(dl) ? [
        // a partial week compares the same weekdays of last week (app.mjs), so the arrow stays
        { value: num(dl.downloads), label: 'downloads', ch: change(dl.downloads, dl.prev?.downloads), sub: dl.partial ? `${num(dl.daysKnown)} of 7 days` : '' },
        { value: num(dl.updates), label: 'updates', sub: fin(dl.redownloads) ? `${num(dl.redownloads)} redownloads` : '' },
      ] : []),
    ]));
    if (bad(app.live) || bad(app.rating)) blocks.push(cantLoad('the App Store listing', bad(app.live) ? app.live : app.rating, 'margin-bottom:4px;'));
    if (!ok(dl)) blocks.push(bad(dl) ? cantLoad('downloads', dl) : note('Downloads: not connected yet.'));
    else {
      const cs = list(dl.countries).slice(0, cap(4));
      blocks.push(note(`${dl.asOf ? `Downloads as of ${esc(fmtDay(dl.asOf))}. ` : ''}${cs.length ? `Top countries: ${cs.map((c) => `${esc(country(c.country))} ${num(c.downloads)}`).join(', ')}.` : ''}`));
    }
    if (live.url) blocks.push(note(link('App Store page', live.url), 'margin-top:4px;'));
  } else blocks.push(quiet(app));

  blocks.push(sub('App Store analytics'));
  if (ok(aa)) {
    // a metric Apple is still counting shows how far it got instead of a change that is only the lag
    const late = new Set(list(aa.incomplete));
    const m = (k, label, value, vs) => (late.has(k) && !bad(aa[k]) ? { value, label, sub: through(aa, k) } : { value, label, ...vs });
    blocks.push(kpis([
      m('impressions', 'impressions', num(aa.impressions), { ch: change(aa.impressions, aa.prev?.impressions) }),
      m('pageViews', 'page views', num(aa.pageViews), { ch: change(aa.pageViews, aa.prev?.pageViews) }),
      m('conversion', 'conversion', pct(aa.conversion), { sub: fin(aa.prev?.conversion) ? `from ${pct(aa.prev.conversion)}` : '' }),
      m('sessions', 'sessions', num(aa.sessions), { ch: change(aa.sessions, aa.prev?.sessions) }),
      m('activeDevices', 'active devices', num(aa.activeDevices), { ch: change(aa.activeDevices, aa.prev?.activeDevices) }),
      m('crashes', 'crashes', num(aa.crashes), { sub: fin(aa.prev?.crashes) ? `from ${num(aa.prev.crashes)}` : '' }),
    ]));
    const failed = metricFailures(aa);
    for (const f of failed) blocks.push(cantLoad(f.what, f.part, 'margin-bottom:4px;'));
    if (aa.asOf) blocks.push(note(`Apple's numbers as of ${esc(fmtDay(aa.asOf))}.`, failed.length ? '' : 'margin-top:-4px;'));
  } else blocks.push(stateOf(aa) === 'error' ? warn(`Could not load this week: ${esc(clip(aa.error, 160))}`) : note('Not connected yet.'));

  if (ok(app)) {
    blocks.push(sub('Reviews'));
    const rv = app.reviews;
    if (!ok(rv)) blocks.push(bad(rv) ? cantLoad('reviews', rv) : note('Not connected yet.'));
    else if (!rv.length) blocks.push(note('No new reviews this week.'));
    else {
      blocks.push(rv.slice(0, cap(6)).map((r) => `<div class="line" style="padding:10px 0;border-bottom:1px solid ${C.line};">${P(`${stars(r.stars)} <b>${esc(clip(r.title, 80))}</b>`)}${r.body ? P(esc(clip(r.body, 300)), 'margin-top:2px;') : ''}${note(`${esc(country(r.territory))}, ${esc(fmtDay(r.date))}. ${r.replied ? '<span class="good" style="color:' + C.good + ';font-weight:700;">Replied</span>' : `<span class="bad" style="color:${C.red};font-weight:700;">No reply yet</span>`}`, 'margin-top:4px;')}</div>`).join(''));
      if (rv.length > cap(6)) blocks.push(note(`And ${num(rv.length - cap(6))} more in App Store Connect.`, 'margin-top:8px;'));
    }
  }
  return card('iPhone app', blocks.join(''));
}

/** Last week's browser errors in words: null is unknown (the log was full), capped makes it a floor. */
const prevErrors = (e) => (!fin(e.prevTotal) ? 'last week unknown' : e.capped ? `last week at least ${num(e.prevTotal)}` : `last week ${num(e.prevTotal)}`);

function serviceSection(sv) {
  if (!ok(sv)) return card('Alerts and errors', quiet(sv));
  const a = ok(sv.alerts) ? sv.alerts : null;
  const e = ok(sv.errors) ? sv.errors : null;
  const total = a ? (+a.web || 0) + (+a.ios || 0) : 0;
  const firm = e && fin(e.prevTotal) && !e.capped; // only then is last week a real number to compare with
  const out = [kpis([
    // every device that signed up, including ones that later turned alerts off (service.mjs)
    ...(a ? [{ value: fin(a.web) || fin(a.ios) ? num(total) : 'n/a', label: 'alert sign-ups', sub: `${num(a.web)} web, ${num(a.ios)} iPhone` }] : []),
    ...(e && fin(e.total) ? [{ value: num(e.total), label: 'browser errors', ch: firm ? change(e.total, e.prevTotal, { lowerIsBetter: true }) : null, sub: firm ? '' : prevErrors(e) }] : []),
  ])];
  if (!a) out.push(bad(sv.alerts) ? cantLoad('the alert sign-ups and push status', sv.alerts) : note('No alert status this week.'));
  else {
    out.push(note('Devices that turned alerts off still count as sign-ups until they unsubscribe.', 'margin:-6px 0 8px;'));
    const sender = isObj(a.sender) ? a.sender : {};
    const failing = list(a.failing);
    const last = a.lastRunAt ? ` Last run ${esc(fmtTime(a.lastRunAt))}${a.lastOutcome ? `: ${esc(clip(a.lastOutcome, 80))}` : ''}.` : '';
    out.push(sender.status === 'fail' ? P(`<b>Push alerts need a look:</b> ${esc(clip(undash(sender.detail), 300))}`, `color:${C.red};`, 'bad')
      : failing.length ? P(`<b>Push sends failing:</b> ${esc(clip(failing.join(', '), 200))}`, `color:${C.red};`, 'bad')
        : sender.status === 'ok' ? P(`Push sends look healthy.${last}`)
          : P(`${sender.detail ? `Sender check: ${esc(clip(undash(sender.detail), 200))}.` : 'No sender check this week.'}${last}`));
  }
  if (bad(sv.errors)) out.push(sub('Top error groups') + cantLoad('the browser errors', sv.errors));
  else if (e) {
    const groups = list(e.groups).slice(0, cap(6));
    out.push(sub('Top error groups') + rows(groups.map((g) => ({
      label: `<span style="font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(clip(g.message, 90))}</span>`,
      sub: [g.kind && esc(clip(g.kind, 40)), g.page && esc(clip(g.page, 40))].filter(Boolean).join(', '),
      value: num(g.count),
    })), 'No browser errors this week.'));
    if (e.capped) out.push(note(`The error log filled up, so last week's count is ${fin(e.prevTotal) ? 'a minimum' : 'unknown'}.`, 'margin-top:6px;'));
  }
  return card('Alerts and errors', out.join(''));
}

const COVERAGE = {
  'discovered - currently not indexed': 'found but not crawled yet',
  'crawled - currently not indexed': 'crawled, not indexed',
  'url is unknown to google': 'not found by Google yet',
};
// Google's window runs 2 days behind the report week (search.mjs), so its chart gets its own days.
const googleDays = (g, days) => (/^\d{4}-\d{2}-\d{2}$/.test(String(g?.start)) ? Array.from({ length: 7 }, (_, i) => addDays(g.start, i)) : days);
const TYPE_GROUP = (t) => (t === 'feat' ? 'New' : t === 'fix' ? 'Fixes' : 'Other');
function shippedSection(gh) {
  if (!ok(gh)) return card('Shipped this week', quiet(gh));
  if (bad(gh.shipped)) return card('Shipped this week', cantLoad('the commits', gh.shipped, 'margin-top:14px;'));
  const commits = list(gh.shipped);
  const count = fin(gh.shippedCount) ? +gh.shippedCount : commits.length;
  if (!count) return card('Shipped this week', P('Nothing shipped this week.', 'margin-top:14px;'));
  const groups = { New: [], Fixes: [], Other: [] };
  for (const c of commits) groups[TYPE_GROUP(c.type)].push(c);
  const totals = { New: 0, Fixes: 0, Other: 0 };
  if (isObj(gh.shippedByType)) for (const [t, n] of Object.entries(gh.shippedByType)) totals[TYPE_GROUP(t)] += fin(n) ? +n : 0;
  else for (const c of commits) totals[TYPE_GROUP(c.type)]++;
  const summary = Object.entries(totals).filter(([, n]) => n).map(([g, n]) => `${num(n)} ${g === 'New' ? 'new' : g === 'Fixes' ? (n === 1 ? 'fix' : 'fixes') : 'other'}`).join(', ');
  const body = Object.entries(groups).filter(([, cs]) => cs.length).map(([g, cs]) => sub(g) + table(cs.slice(0, cap(10)).map((c) => {
    const { scope, text } = commitText(c.subject);
    return `<tr><td class="line" style="padding:6px 0;border-bottom:1px solid ${C.line};">${scope ? `<span class="soft" style="${T.small}font-weight:700;">${esc(clip(scope, 20))}</span> ` : ''}${link(esc(clip(text, 110)), c.url)}</td><td class="soft line" align="right" valign="top" style="padding:6px 0 6px 12px;border-bottom:1px solid ${C.line};${T.small}${T.num}">${esc(fmtDay(c.landedAt || c.date))}</td></tr>`;
  }).join('')) + (cs.length > cap(10) ? note(`And ${num(cs.length - cap(10))} more.`, 'margin-top:6px;') : '')).join('');
  return card('Shipped this week', P(`<b>${plural(count, 'change')}</b> reached curb.guide${summary ? `: ${summary}` : ''}.`, 'margin-top:14px;') + body
    + note(`${count > commits.length ? `The newest ${num(commits.length)} are listed. ` : ''}${link('All commits on GitHub', `${REPO}/commits/main`)}`, 'margin-top:12px;'));
}

function issuesSection(gh) {
  if (!ok(gh)) return card('Issues and monitors', quiet(gh));
  const is = gh.issues || {};
  const runs = gh.runs || {};
  const repo = gh.repo || {};
  const out = [];
  if (bad(is)) out.push(sub('Monitor alerts', true) + cantLoad('the issues and monitor alerts', is));
  else {
    const alerts = list(is.alertsOpen);
    out.push(sub('Monitor alerts', true) + (alerts.length
      ? rows(alerts.slice(0, cap(5)).map((a) => ({ label: link(esc(`#${a.number} ${clip(a.title, 80)}`), a.url), sub: `${esc(clip(a.label, 30))}, open since ${esc(fmtDay(a.createdAt))}`, value: 'open' })), '')
      : note('No monitor alerts open. Every check passes.')));
    const opened = list(is.opened), closed = list(is.closed), open = list(is.open);
    out.push(sub('Issues') + P(`${plural(opened.length, 'issue')} opened, ${num(closed.length)} closed, ${num(open.length)} open now.`));
    if (opened.length) out.push(rows(opened.slice(0, cap(6)).map((i) => ({ label: link(esc(`#${i.number} ${clip(i.title, 80)}`), i.url), value: i.automated ? 'automated' : 'person' })), ''));
    if (closed.length) out.push(note(`Closed: ${closed.slice(0, cap(6)).map((i) => link(esc(`#${i.number} ${clip(i.title, 50)}`), i.url)).join(', ')}${closed.length > cap(6) ? ` and ${num(closed.length - cap(6))} more` : ''}.`, 'margin-top:8px;'));
  }
  const run = (name, what, r) => (bad(r) ? cantLoad(what, r)
    : r && fin(r.total) ? P(`${name} ran ${plural(r.total, 'time')}${+r.failed ? `, <b class="bad" style="color:${C.red};">${num(r.failed)} failed</b> (${pct(+r.failed / Math.max(1, +r.total))})` : ', no failures'}.`) : '');
  const runLines = [run('The monitor', 'the monitor runs', runs.monitor), run('Deploy verify', 'the deploy verify runs', runs.verify)].filter(Boolean);
  if (runLines.length) out.push(sub('Workflow runs') + runLines.join(''));
  if (bad(repo)) out.push(cantLoad('the GitHub stars', repo, 'margin-top:12px;'));
  else if (fin(repo.stars)) out.push(note(`${plural(repo.stars, 'star')}${fin(repo.starsGained) && +repo.starsGained ? ` (${num(repo.starsGained)} new this week)` : bad(repo.starsGained) ? ' (new stars did not load)' : ''}, ${plural(repo.forks || 0, 'fork')} on GitHub.`, 'margin-top:12px;'));
  return card('Issues and monitors', out.join(''));
}

function mentionsSection(m, claude) {
  if (!ok(m) && !(ok(claude) && list(claude.mentions).length)) return card('Mentions', quiet(m));
  const out = [];
  const ph = ok(m) ? m.producthunt : null;
  if (ok(ph) && ph.name) {
    out.push(sub('Product Hunt', true) + P(`${link(`<b>${esc(clip(ph.name, 60))}</b>`, ph.url)}${ph.featuredAt ? ` launched ${esc(fmtDay(ph.featuredAt))}` : ''}`) + kpis([
      { value: num(ph.votes), label: 'upvotes' },
      { value: num(ph.comments), label: 'comments' },
      { value: fin(ph.dailyRank) ? `#${num(ph.dailyRank)}` : 'n/a', label: 'of the day' },
      { value: fin(ph.weeklyRank) ? `#${num(ph.weeklyRank)}` : 'n/a', label: 'of the week' },
    ]) + list(ph.recentComments).slice(0, cap(3)).map((c) => `<div class="line" style="padding:8px 0;border-top:1px solid ${C.line};">${P(`<b>${esc(clip(c.author, 40))}</b> <span class="soft" style="${T.small}">${esc(fmtDay(c.date))}</span>`)}${P(esc(clip(c.body, 240)))}</div>`).join(''));
  } else if (ok(m) && bad(ph)) out.push(sub('Product Hunt', true) + cantLoad('Product Hunt', ph));
  const items = ok(m) ? list(m.items) : [];
  const fromClaude = ok(claude) ? list(claude.mentions).map((x) => ({ ...x, snippet: x.note, via: 'claude' })) : [];
  const seen = new Set();
  const all = [...items, ...fromClaude].filter((x) => { const k = safeUrl(x.url) || x.title; if (seen.has(k)) return false; seen.add(k); return true; });
  out.push(sub('Around the web', !out.length));
  if (!ok(m)) out.push(bad(m) ? cantLoad('the mention search', m) : note('Mention search is not connected yet. These come from Claude only.'));
  else for (const [k, name] of MENTION_SEARCHES) if (bad(m[k])) out.push(cantLoad(`the ${name} search`, m[k], 'margin-bottom:4px;'));
  if (!all.length) out.push(note('No mentions found this week.'));
  else {
    out.push(all.slice(0, cap(10)).map((x) => {
      const meta = [fmtDay(x.date), fin(x.points) ? plural(x.points, 'point') : '', fin(x.comments) ? plural(x.comments, 'comment') : '', x.via === 'claude' ? 'found by Claude' : ''].filter(Boolean).map(esc).join(', ');
      return `<div class="line" style="padding:9px 0;border-bottom:1px solid ${C.line};"><span style="display:inline-block;border:1.5px solid ${C.soft};color:${C.soft};border-radius:4px;padding:1px 6px;font-size:10px;line-height:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase;" class="soft">${esc(badge(x))}</span>${P(link(`<b>${esc(clip(x.title || x.url, 120))}</b>`, x.url), 'margin-top:4px;')}${x.snippet ? note(esc(clip(x.snippet, 200)), 'font-size:13px;line-height:19px;') : ''}${meta ? note(meta) : ''}</div>`;
    }).join(''));
  }
  if (ok(m) && m.reddit?.blocked) out.push(note(`Reddit blocks GitHub's servers, so it was not searched. ${link('Search Reddit by hand', 'https://www.reddit.com/search/?q=curb.guide')}.`, 'margin-top:10px;'));
  return card('Mentions', out.join(''));
}

function dataSection(gh) {
  if (!ok(gh)) return card('Data', quiet(gh));
  const r = gh.runs?.dataRefresh;
  if (bad(r)) return card('Data', cantLoad('the data refresh runs', r, 'margin-top:14px;'));
  if (!r) return card('Data', note('No data refresh run found yet.', 'margin-top:14px;'));
  const failed = r.conclusion === 'failure';
  const word = failed ? `<b class="bad" style="color:${C.red};">failed</b>` : r.conclusion === 'success' ? `<b class="good" style="color:${C.good};">worked</b>` : esc(clip(r.conclusion || 'is still running', 30));
  return card('Data', P(`The last DataSF refresh ran ${esc(fmtTime(r.lastAt) || 'at an unknown time')} and ${word}. ${link('See the run', r.url)}`, 'margin-top:14px;'));
}

function claudeCard(cl) {
  if (bad(cl)) return card('The week in short', cantLoad('the Claude summary', cl, 'margin-top:14px;'));
  if (!ok(cl) || !list(cl.summary).length) return '';
  return card('The week in short', list(cl.summary).slice(0, cap(3)).map((line, i) => P(esc(clip(line, 300)), `margin-top:${i ? 10 : 14}px;padding-left:12px;border-left:3px solid ${C.red};`)).join('')
    + note('Written by Claude from this week\'s numbers. Mentions it found on the web are under Mentions.', 'margin-top:12px;'));
}

function needsCard(items) {
  if (!items.length) return '';
  return card('Needs you', table(items.map((it, i) => `<tr><td valign="top" width="26" style="padding:${i ? 10 : 14}px 0 0;${T.display}font-size:18px;line-height:21px;color:${C.red};">${i + 1}</td><td style="padding:${i ? 10 : 14}px 0 0;">${link(esc(it.text), it.url)}</td></tr>`).join('')), { alert: true });
}

function tile(t, i) {
  return `<div class="tile" style="display:inline-block;width:25%;min-width:136px;vertical-align:top;font-size:14px;line-height:normal;"><div class="t${i}" style="padding:0 ${[6, 4, 2, 0][i]}px 0 ${[0, 2, 4, 6][i]}px;">${table(
    `<tr><td style="padding:12px 12px 11px;"><div class="soft" style="font-size:10.5px;line-height:13px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${C.soft};white-space:nowrap;">${esc(t.label)}</div>`
    + `<div class="ink" style="${T.display}font-size:34px;line-height:40px;margin-top:4px;color:${t.value === 'n/a' ? C.gray : C.ink};">${esc(t.value)}</div>`
    + `<div style="${T.small}font-weight:700;">${t.ch ? toneSpan(t.ch) : t.flag ? `<span class="soft" style="color:${C.soft};">${esc(t.flag)}</span>` : '&nbsp;'}</div><div class="soft" style="${T.small}white-space:nowrap;">${t.sub ? esc(t.sub) : '&nbsp;'}</div></td></tr>`,
    `border-collapse:separate;background:${C.sign};border:2px solid ${C.ink};border-radius:12px;`,
  ).replace('<table ', '<table class="card" ')}</div></div>`;
}

/** The four headline numbers (also used by the text version). flag: a word in place of the change. */
export function headline(report) {
  const s = report?.sections || {};
  const part = (sec, key) => (ok(sec) ? sec[key] : sec); // the sub-part, or the section that failed or was skipped
  const v = ok(s.visits) ? s.visits : null;
  const gs = part(s.search, 'google'), ds = part(s.app, 'downloads'), as = part(s.service, 'alerts');
  const g = ok(gs) ? gs : null, d = ok(ds) ? ds : null, a = ok(as) ? as : null;
  const from = (p) => (fin(p) ? `from ${num(p)}` : 'no data last week');
  const why = (x) => (bad(x) ? 'did not load' : 'not connected');
  const fresh = g && googleIncomplete(g);
  return [
    { label: 'Visitors', value: v ? num(v.visitors) : 'n/a', ch: v ? change(v.visitors, v.prev?.visitors) : null, sub: v ? (bad(v.prev) ? 'last week did not load' : from(v.prev?.visitors)) : why(s.visits) },
    { label: 'Google clicks', value: g ? num(g.clicks) : 'n/a', ch: g && !fresh ? change(g.clicks, g.prev?.clicks) : null, flag: fresh ? 'still coming in' : '', sub: g ? from(g.prev?.clicks) : why(gs) },
    { label: 'App downloads', value: d ? num(d.downloads) : 'n/a', ch: d ? change(d.downloads, d.prev?.downloads) : null, sub: d ? `${d.partial ? `${num(d.daysKnown)} of 7 days, ` : ''}${from(d.prev?.downloads)}` : why(ds) },
    { label: 'Alert sign-ups', value: a && (fin(a.web) || fin(a.ios)) ? num((+a.web || 0) + (+a.ios || 0)) : 'n/a', ch: null, sub: a ? `${num(a.web)} web, ${num(a.ios)} iPhone` : why(as) },
  ];
}

const statusLine = (n, failed = 0) => (n ? `${n === 1 ? '1 thing needs' : `${num(n)} things need`} you`
  : failed ? `Nothing needs you, but ${failed === 1 ? '1 part' : `${num(failed)} parts`} did not load` : 'All good this week');

// ---------- the plain-text version ----------

function renderText(report, needs, missing) {
  const s = report.sections || {};
  const L = [];
  const head = headline(report);
  const fails = (pairs) => { for (const [what, part, when] of pairs) if (bad(part)) L.push(cantText(what, part, when)); };
  L.push(`CURB weekly: ${report.week?.label || ''}`, statusLine(needs.length, failedCount(report)), '');
  for (const h of head) L.push(`${(h.label + ':').padEnd(15)}${h.value.padStart(7)}  ${h.ch && h.ch.text !== 'n/a' ? `${h.ch.words}, ` : h.flag ? `${h.flag}, ` : ''}${h.sub}`);
  if (needs.length) { L.push('', 'NEEDS YOU'); needs.forEach((x, i) => L.push(`${i + 1}. ${x.text}${safeUrl(x.url) ? `\n   ${safeUrl(x.url)}` : ''}`)); }
  if (ok(s.claude) && list(s.claude.summary).length) { L.push('', 'THE WEEK IN SHORT'); for (const line of list(s.claude.summary).slice(0, 3)) L.push(`* ${clip(line, 300)}`); }
  else if (bad(s.claude)) L.push('', 'THE WEEK IN SHORT', cantText('the Claude summary', s.claude));
  const sec = (title, x, fn) => { L.push('', title.toUpperCase()); if (!ok(x)) L.push(stateOf(x) === 'error' ? `Could not load this week: ${clip(x.error, 160)}` : 'Not connected yet.'); else fn(x); };
  sec('Visits', s.visits, (v) => {
    L.push(`${num(v.visitors)} visitors (${change(v.visitors, v.prev?.visitors).words}), ${num(v.pageviews)} pageviews`);
    const top = list(v.topPages).slice(0, 5);
    if (top.length) L.push(`Top pages: ${top.map((p) => `${clip(p.label || p.path, 40)} ${num(p.visitors)}`).join(', ')}`);
    const refs = list(v.referrers).slice(0, 5);
    if (refs.length) L.push(`From: ${refs.map((r) => `${clip(r.host, 40)} ${num(r.visitors)}`).join(', ')}`);
    fails([["last week's visits to compare", v.prev, ''], ['the visits per day', v.daily], ['the top pages', v.topPages], ['the neighborhood pages', v.topHoods],
      ['the referrers', v.referrers], ['the countries', v.countries], ['the devices', v.devices]]);
  });
  sec('Search', s.search, (x) => {
    const g = x.google, b = x.bing;
    if (ok(g)) {
      const fresh = googleIncomplete(g);
      L.push(`Google: ${num(g.clicks)} clicks${fresh ? '' : ` (${change(g.clicks, g.prev?.clicks).words})`}, ${num(g.impressions)} impressions, click rate ${pct(g.ctr)}, position ${dec(g.position)}${g.end ? ` (data to ${fmtDay(g.end)}${fresh ? ', the last days are still coming in' : ''})` : ''}`);
      const q = list(g.topQueries).slice(0, 5);
      if (q.length) L.push(`Top searches: ${q.map((r) => `"${clip(r.query, 50)}" ${num(r.clicks)}`).join(', ')}`);
      if (g.blockPages && fin(g.blockPages.total)) L.push(`${num(g.blockPages.withImpressions)} of ${num(g.blockPages.total)} block pages showed up in Google.`);
      fails([['the index check', g.indexSample]]);
    } else L.push(`Google: ${stateOf(g) === 'error' ? `could not load (${clip(g.error, 100)})` : 'not connected yet'}`);
    if (ok(b)) {
      L.push(`Bing${b.start && b.end ? ` (${fmtDay(b.start)} to ${fmtDay(b.end)})` : ''}: ${num(b.clicks)} clicks (${change(b.clicks, b.prev?.clicks).words}), ${num(b.impressions)} impressions`);
      fails([['the Bing top pages', b.topPages]]);
    } else L.push(`Bing: ${stateOf(b) === 'error' ? `could not load (${clip(b.error, 100)})` : 'not connected yet'}`);
  });
  sec('iPhone app', s.app, (a) => {
    const live = ok(a.live) ? a.live : {}, rating = ok(a.rating) ? a.rating : {}, dl = a.downloads;
    L.push(`Version ${live.version || 'n/a'}${live.releasedAt ? ` since ${fmtDay(live.releasedAt)}` : ''}, rating ${dec(rating.average)} from ${plural(rating.count, 'rating')}`);
    fails([['the App Store listing', bad(a.live) ? a.live : a.rating]]);
    if (ok(dl)) L.push(`${num(dl.downloads)} downloads (${change(dl.downloads, dl.prev?.downloads).words}${dl.partial ? `, ${num(dl.daysKnown)} of 7 days` : ''}), ${num(dl.updates)} updates, ${num(dl.redownloads)} redownloads`);
    fails([['downloads', dl], ['reviews', a.reviews]]);
    if (ok(a.reviews)) {
      if (!a.reviews.length) L.push('No new reviews this week.');
      for (const r of a.reviews.slice(0, 6)) L.push(`${'*'.repeat(Math.max(0, Math.min(5, +r.stars || 0)))} ${clip(r.title, 80)} (${country(r.territory)}, ${fmtDay(r.date)}, ${r.replied ? 'replied' : 'no reply yet'})${r.body ? `\n   ${clip(r.body, 200)}` : ''}`);
    }
  });
  if (ok(s.appAnalytics)) {
    const x = s.appAnalytics, late = new Set(list(x.incomplete));
    const th = (k) => (late.has(k) && !bad(x[k]) ? ` ${through(x, k)}` : '');
    L.push(`App Store: ${num(x.impressions)} impressions${th('impressions')}, ${num(x.pageViews)} page views${th('pageViews')}, ${pct(x.conversion)} conversion${th('conversion')}, ${num(x.sessions)} sessions${th('sessions')}, ${plural(x.crashes, 'crash', 'crashes')}${th('crashes')}`);
    fails(metricFailures(x).map((f) => [f.what, f.part]));
  } else if (bad(s.appAnalytics)) L.push(cantText('App Store analytics', s.appAnalytics));
  sec('Alerts and errors', s.service, (x) => {
    const a = x.alerts, e = x.errors;
    if (ok(a)) {
      const sender = isObj(a.sender) ? a.sender : {};
      L.push(`${num((+a.web || 0) + (+a.ios || 0))} alert sign-ups (${num(a.web)} web, ${num(a.ios)} iPhone). Devices that turned alerts off still count until they unsubscribe.`);
      L.push(sender.status === 'fail' ? `Push alerts need a look: ${clip(undash(sender.detail), 300)}`
        : list(a.failing).length ? `Failing: ${list(a.failing).join(', ')}`
          : sender.status === 'ok' ? 'Push sends look healthy.' : sender.detail ? `Sender check: ${clip(undash(sender.detail), 200)}.` : 'No sender check this week.');
    } else fails([['the alert sign-ups and push status', a]]);
    if (ok(e) && fin(e.total)) {
      L.push(`${num(e.total)} browser errors (${prevErrors(e)})${e.capped ? `. The error log filled up, so last week's count is ${fin(e.prevTotal) ? 'a minimum' : 'unknown'}.` : ''}`);
      for (const g of list(e.groups).slice(0, 5)) L.push(`  ${num(g.count).padStart(5)}  ${clip(g.message, 90)}`);
    } else fails([['the browser errors', e]]);
  });
  sec('Shipped this week', s.github, (gh) => {
    if (bad(gh.shipped)) return fails([['the commits', gh.shipped]]);
    const cs = list(gh.shipped);
    L.push(`${plural(fin(gh.shippedCount) ? gh.shippedCount : cs.length, 'change')} shipped`);
    for (const g of ['New', 'Fixes', 'Other']) {
      const these = cs.filter((c) => TYPE_GROUP(c.type) === g);
      if (these.length) { L.push(`${g}:`); for (const c of these.slice(0, 10)) L.push(`  ${clip(c.subject, 110)}`); }
    }
  });
  sec('Issues and monitors', s.github, (gh) => {
    if (bad(gh.issues)) fails([['the issues and monitor alerts', gh.issues]]);
    else {
      const alerts = list(gh.issues?.alertsOpen);
      L.push(alerts.length ? `Open monitor alerts: ${alerts.map((a) => `#${a.number} ${clip(a.title, 70)}`).join(', ')}` : 'No monitor alerts open.');
      L.push(`${num(list(gh.issues?.opened).length)} issues opened, ${num(list(gh.issues?.closed).length)} closed, ${num(list(gh.issues?.open).length)} open now.`);
    }
    const m = gh.runs?.monitor;
    if (m && fin(m.total)) L.push(`Monitor ran ${num(m.total)} times, ${num(m.failed || 0)} failed.`);
    if (gh.repo && fin(gh.repo.stars)) L.push(`${num(gh.repo.stars)} stars (${bad(gh.repo.starsGained) ? 'new stars did not load' : `${num(gh.repo.starsGained || 0)} new`}).`);
    fails([['the monitor runs', m], ['the deploy verify runs', gh.runs?.verify], ['the GitHub stars', gh.repo]]);
  });
  sec('Mentions', s.mentions, (m) => {
    const ph = m.producthunt;
    if (ok(ph) && ph.name) L.push(`Product Hunt: ${num(ph.votes)} upvotes, ${num(ph.comments)} comments, #${num(ph.dailyRank)} of the day, #${num(ph.weeklyRank)} of the week`);
    fails([['Product Hunt', ph], ...MENTION_SEARCHES.map(([k, name]) => [`the ${name} search`, m[k]])]);
    const items = [...list(m.items), ...(ok(s.claude) ? list(s.claude.mentions).map((x) => ({ ...x, via: 'claude' })) : [])];
    if (!items.length) L.push('No mentions found this week.');
    for (const x of items.slice(0, 10)) L.push(`[${badge(x)}] ${clip(x.title, 100)}${safeUrl(x.url) ? `\n   ${safeUrl(x.url)}` : ''}`);
  });
  if (ok(s.github)) {
    const r = s.github.runs?.dataRefresh;
    L.push('', 'DATA', bad(r) ? cantText('the data refresh runs', r) : r ? `Last DataSF refresh: ${fmtTime(r.lastAt)}, ${r.conclusion || 'unknown'}` : 'No data refresh run found yet.');
  }
  L.push('');
  if (missing.length) L.push(`Not connected yet: ${missing.map((x) => x.name).join(', ')}`);
  for (const [name, url] of DASHBOARDS) L.push(`${name}: ${url}`);
  L.push('Sent every Wednesday at 8 AM by GitHub Actions (scripts/weekly).');
  return L.join('\n');
}

// ---------- the whole email ----------

const RESPONSIVE_CSS = `a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
@media (max-width:520px){.pad{padding:16px!important}.tile{width:50%!important;min-width:0!important}.t0,.t2{padding:0 4px 8px 0!important}.t1,.t3{padding:0 0 8px 4px!important}.col{width:100%!important;min-width:0!important}.colin{padding:0!important}.kpi{width:50%!important;min-width:0!important}.wm{font-size:26px!important;line-height:28px!important}}`;
const DARK_CSS = `@media (prefers-color-scheme:dark){.bg{background:#100E0A!important}.card{background:#1C1913!important;border-color:#5A5442!important}.card.alert{border-color:#E5484D!important}.ink{color:#F2ECDF!important}.soft{color:#C9C0AC!important}.line{border-color:#37322A!important}.good{color:#5FD394!important}.bad{color:#FF8A80!important}.warn{color:#F0B45A!important}.star0{color:#5A5442!important}.track{background:#37322A!important}.fill{background:#F2ECDF!important}}`;

/** report → { subject, html, text, images: [{ cid, type, data }] }. Charts that fail to render are left out. */
export async function renderEmail(report) {
  const s = report?.sections || {};
  const week = report?.week || {};
  const days = list(week.days).length === 7 ? week.days : list(s.visits?.daily).map((d) => d.date);
  const subject = `${report?.preview ? 'Preview: ' : ''}CURB this week: ${week.label || ''}`.trim();
  const needs = needsYou(report);
  const missing = notConnected(report);

  const images = [];
  const has = {};
  const add = async (key, make) => { try { images.push({ cid: CID[key], type: 'image/png', data: await make() }); has[key] = true; } catch { has[key] = false; } };
  await add('logo', () => logoPng());
  if (ok(s.visits) && list(s.visits.daily).length && days.length) await add('visitors', () => visitorsChart(s.visits, days));
  if (ok(s.search) && ok(s.search.google) && list(s.search.google.daily).length && days.length) await add('clicks', () => clicksChart(s.search.google, googleDays(s.search.google, days)));

  const head = headline(report);
  const failed = failedCount(report);
  const status = statusLine(needs.length, failed);
  const preheader = `${head[0].value} visitors, ${head[1].value} Google clicks, ${head[2].value} app downloads. ${status}.`;
  const masthead = `<tr><td style="padding:0 0 12px;">${table(`<tr>
<td width="62" valign="middle" style="padding:16px 0 16px 18px;">${has.logo ? `<img src="cid:${CID.logo}" width="44" height="48" alt="CURB" style="display:block;width:44px;height:48px;border:0;">` : ''}</td>
<td valign="middle" style="padding:14px 18px 14px 12px;"><div class="wm" style="${T.display}font-size:30px;line-height:32px;color:${C.red};text-transform:uppercase;letter-spacing:0.5px;">CURB weekly</div><div style="${T.display}font-size:19px;line-height:23px;color:${C.ink};text-transform:uppercase;letter-spacing:0.5px;">${esc(week.label || '')}</div><div style="font-size:9.5px;line-height:13px;font-weight:800;letter-spacing:2px;color:${C.soft};text-transform:uppercase;margin-top:3px;">Weekly report for curb.guide</div></td>
</tr>`, `border-collapse:separate;background:${C.sign};border:3px solid ${C.red};border-radius:14px;`)}</td></tr>`;
  const statusRow = `<tr><td style="padding:0 0 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${needs.length ? C.red : failed ? C.amber : C.green};border-radius:999px;padding:6px 14px 6px 12px;font-size:14px;line-height:18px;font-weight:700;color:${C.sign};">${needs.length || failed ? '!' : '✓'}&nbsp;&nbsp;${esc(status)}</td></tr></table></td></tr>`;
  const previewRow = report?.preview ? `<tr><td style="padding:0 0 10px;">${warn('Preview sent by hand. The real one goes out Wednesday at 8 AM.', 'font-size:12px;line-height:18px;font-weight:700;')}</td></tr>` : '';
  const tiles = `<tr><td style="padding:0 0 16px;font-size:0;line-height:0;">${head.map(tile).join('')}</td></tr>`;
  const footer = `<tr><td style="padding:8px 4px 0;">${missing.length ? note(`<b>Not connected yet:</b> ${missing.map((x) => `${esc(x.name)}${x.reason ? ` (${esc(clip(x.reason, 80))})` : ''}`).join(', ')}.`, 'margin-bottom:10px;') : ''}${note(DASHBOARDS.map(([n, u]) => link(esc(n).replace(/ /g, '&nbsp;'), u)).join('&nbsp;&nbsp;·&nbsp; '))}${note(`Sent every Wednesday at 8 AM by GitHub Actions (scripts/weekly).${report?.generatedAt ? ` Made ${esc(fmtTime(report.generatedAt))}.` : ''}`, 'margin-top:10px;')}</td></tr>`;

  const page = () => wrap(subject, preheader, [
    previewRow, masthead, statusRow, tiles, needsCard(needs), claudeCard(s.claude),
    visitsSection(s.visits, days, has), searchSection(s.search, days, has), appSection(s.app, s.appAnalytics),
    serviceSection(s.service), shippedSection(s.github), issuesSection(s.github), mentionsSection(s.mentions, s.claude),
    dataSection(s.github), footer,
  ].join('\n'));
  // a busy week: show fewer rows per list rather than let Gmail clip the end of the email
  let html;
  for (const f of [1, 0.6, 0.35, 0.15]) {
    CAP = f;
    try { html = page(); } finally { CAP = 1; }
    if (Buffer.byteLength(html) < MAX_HTML_BYTES) break;
  }
  return { subject, html, text: renderText(report, needs, missing), images };
}

const wrap = (subject, preheader, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><title>${esc(subject)}</title>
<style>${FONTS_CSS}</style>
<style>${RESPONSIVE_CSS}</style>
<style>${DARK_CSS}</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper};"><tr><td align="center" class="ink" style="padding:24px 16px 32px;${BASE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
${body}
</table>
</td></tr></table>
</body></html>`;
