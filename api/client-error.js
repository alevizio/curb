// /api/client-error — CURB's own anonymous error log (no third-party tracker; see /privacy).
//
//   POST  from the page via navigator.sendBeacon: { k, msg, src, line, col, stack, page, app }.
//         Normalized, clipped and stored in a capped Upstash list with a timestamp and a coarse
//         client label ("iOS Safari"). No IP, no location, no push subscription or token is stored.
//   GET   monitor only (Authorization: Bearer CRON_SECRET): ?since=<ms epoch, default 24h ago> →
//         errors grouped by kind + message + source, busiest first. The GitHub monitor
//         (.github/workflows/monitor.yml) alerts on spikes and posts a nightly digest.
import { pushClientError, readClientErrors, underErrorRate, claimSlot } from './_store.js';

const MAX_BODY = 4096;
const KINDS = /^(error|rejection|event:[a-z0-9-]{1,32})$/;
const APPS = ['web', 'pwa', 'ios-app'];

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);

/** Keep same-site script paths; reduce anything else (extensions, injected scripts) to its origin. */
export function cleanSrc(src) {
  const s = clip(src, 300);
  if (!s) return '';
  if (s.startsWith('/')) return s.split('?')[0].slice(0, 120);
  try {
    const u = new URL(s);
    if (u.hostname === 'curb.guide' || u.hostname.endsWith('.curb.guide')) return u.pathname.slice(0, 120);
    return u.protocol + '//' + u.hostname;
  } catch { return ''; }
}

/** "iOS Safari", "Android Chrome", "Mac Chrome"… — never the full user-agent string. */
export function coarseClient(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'Mac'
    : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'Other';
  const br = /Edg\//.test(s) ? 'Edge' : /Firefox\/|FxiOS/.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari' : /AppleWebKit/.test(s) ? 'WebView' : 'Other';
  return os + ' ' + br;
}

/** Validate + normalize a raw report. Returns null for junk / noise we never want to store. */
export function normalize(body, ua, now = Date.now()) {
  if (!body || typeof body !== 'object') return null;
  const k = clip(body.k, 40);
  if (!KINDS.test(k)) return null;
  const msg = clip(body.msg, 300);
  if (!msg || msg === 'Script error.' || /ResizeObserver loop/.test(msg)) return null;
  const src = cleanSrc(body.src);
  if (src && !src.startsWith('/')) return null; // third-party / extension script — not ours to fix
  const toInt = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(1e7, Math.trunc(+v))) : 0);
  return {
    ts: now,
    k,
    msg,
    src,
    line: toInt(body.line),
    col: toInt(body.col),
    stack: clip(body.stack, 1200),
    page: clip(body.page, 100).split('?')[0],
    app: APPS.includes(body.app) ? body.app : 'web',
    client: coarseClient(ua),
  };
}

/** Group entries newer than `since` by kind + message + source line, busiest first. */
export function group(entries, since) {
  const map = new Map();
  for (const e of entries) {
    if (!e || !(e.ts >= since)) continue;
    const key = [e.k, e.msg, e.src && `${e.src}:${e.line}`].filter(Boolean).join(' | ');
    let g = map.get(key);
    if (!g) {
      g = { key, k: e.k, msg: e.msg, src: e.src, line: e.line, count: 0, first: e.ts, last: e.ts, apps: {}, clients: {}, sample: { stack: e.stack, page: e.page } };
      map.set(key, g);
    }
    g.count++;
    g.first = Math.min(g.first, e.ts);
    g.last = Math.max(g.last, e.ts);
    g.apps[e.app] = (g.apps[e.app] || 0) + 1;
    g.clients[e.client] = (g.clients[e.client] || 0) + 1;
  }
  const groups = [...map.values()].sort((a, b) => b.count - a.count);
  return { since, total: groups.reduce((n, g) => n + g.count, 0), groups: groups.slice(0, 50) };
}

// One sender must not be able to fill the global per-minute cap (which would lock out every real report)
// or spend the Upstash commands this log shares with the sweep-alert store. So each client IP gets one
// report per IP_GAP_MS, checked BEFORE the global counter: first in this instance's memory (a flood that
// hits a warm instance costs no Redis command at all), then in one shared slot across instances. The
// page sends at most 5 reports per load; when several land within 5 s, the first (usually the cause) wins.
const IP_GAP_MS = 5000;
const recentIps = new Map(); // ip → when this instance last let it through; in memory only, never stored
function localSlot(ip, now = Date.now()) {
  const t = recentIps.get(ip);
  if (t !== undefined && now - t < IP_GAP_MS) return false;
  if (recentIps.size >= 5000) recentIps.clear(); // bounded: worst case one extra shared-slot check per ip
  recentIps.set(ip, now);
  return true;
}

function parseBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return JSON.stringify(b).length > MAX_BODY ? null : b;
  const s = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '';
  if (!s || s.length > MAX_BODY) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!process.env.CRON_SECRET || (req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'unauthorized' }); return;
    }
    const since = Number(req.query?.since) || Date.now() - 24 * 3600e3;
    res.status(200).json(group(await readClientErrors(), since));
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'GET or POST' }); return; }

  // Always answer 204: a beacon never reads the response, and errors here must not cascade.
  try {
    const entry = normalize(parseBody(req), req.headers['user-agent']);
    // The IP is only hashed into short-lived rate-limit keys inside claimSlot, never stored with the entry.
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (entry && localSlot(ip) && await claimSlot(`errip|${ip}`, IP_GAP_MS) && await underErrorRate()) {
      // One copy of the same error per client per minute.
      if (await claimSlot(`err|${ip}|${entry.k}|${entry.msg}`, 60000)) await pushClientError(entry);
    }
  } catch { /* best effort */ }
  res.status(204).end();
}
