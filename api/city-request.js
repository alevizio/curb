// /api/city-request — "Request a city" on curb.guide/cities (scripts/cities/city-pages.mjs).
//
//   POST  { city, region?, publishes: 'yes' | 'no' | 'unsure', link?, email?, website } as JSON from the page, or the same
//         fields form-encoded (a page without JavaScript: answered with a 303 back to /cities). Checked strictly: names are
//         letters and basic punctuation, the link is https only, every field has a length cap. `website` is a honeypot: a
//         filled one is answered like a success and dropped. One request a minute per client IP (claimSlot; the IP is only
//         hashed into that short-lived key, never stored) and a global hourly cap. Stored in a capped Upstash list with a
//         random id and the time, nothing else about the sender.
//   GET   Authorization: Bearer CRON_SECRET. ?since=<ms epoch, default 24 h ago> → the requests newer than that, oldest
//         first, without emails (?emails=1 adds them, for the owner, to say when a city is live).
//         .github/workflows/city-requests.yml reads it and files each request as a public GitHub issue
//         (scripts/cities/city-requests.mjs): the city, region, answer and link, never the email.
import { randomUUID } from 'node:crypto';
import { pushCityRequest, readCityRequests, underCityRequestRate, claimSlot, storeReady } from './_store.js';

const MAX_BODY = 2048;
const LIMITS = { city: 60, region: 60, link: 300, email: 254 };
// A place name: letters (any script, accents), spaces and . , ' ’ ( ) - ; it starts with a letter. No digits, no @, # or
// markup: what passes can't mention anyone, link anything or format anything in a GitHub issue.
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .,'’()-]*$/u;
const ANSWERS = ['yes', 'no', 'unsure'];
const EMAIL = /^[^\s@<>()[\]\\,;:"`]+@[^\s@<>()[\]\\,;:"`]+\.[a-z]{2,}$/i;
const clean = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** An https link to a public host, normalized, or null. No credentials, no IP address or localhost, and no character that
 *  could close the code span the issue shows it in. */
export function cleanLink(raw) {
  const s = clean(raw);
  if (!s || s.length > LIMITS.link || /\s/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.localhost')) return null;
  const href = u.href;
  if (href.length > LIMITS.link || /[`<>"'\\{}|^\s]/.test(href)) return null;
  return href;
}

/** A request body → { entry } (the fields to store), { error, message } (a field to fix) or { spam: true }. */
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body', message: 'Send the form again.' };
  if (clean(body.website)) return { spam: true };
  const city = clean(body.city), region = clean(body.region), email = clean(body.email);
  if (!city) return { error: 'city', message: 'Which city?' };
  if (city.length < 2 || city.length > LIMITS.city || !NAME.test(city)) return { error: 'city', message: 'Letters and spaces only, up to 60.' };
  if (region && (region.length > LIMITS.region || !NAME.test(region))) return { error: 'region', message: 'Letters and spaces only, up to 60.' };
  const publishes = body.publishes == null || body.publishes === '' ? 'unsure' : String(body.publishes);
  if (!ANSWERS.includes(publishes)) return { error: 'publishes', message: 'Pick yes, no or not sure.' };
  const link = body.link == null || clean(body.link) === '' ? '' : cleanLink(body.link);
  if (link === null) return { error: 'link', message: 'A link that starts with https://' };
  if (email && (email.length > LIMITS.email || !EMAIL.test(email))) return { error: 'email', message: 'That email doesn\'t look right.' };
  return { entry: { city, region, publishes, link, ...(email ? { email } : {}) } };
}

// One request a minute per client IP: first in this instance's memory (a flood on a warm instance costs no Redis command),
// then in one shared slot across instances (claimSlot hashes the IP into a key that expires).
const IP_GAP_MS = 60000;
const recentIps = new Map();   // ip → when this instance last let it through; in memory only, never stored
function localSlot(ip, now = Date.now()) {
  const t = recentIps.get(ip);
  if (t !== undefined && now - t < IP_GAP_MS) return false;
  if (recentIps.size >= 5000) recentIps.clear();
  recentIps.set(ip, now);
  return true;
}

const isForm = (req) => /application\/x-www-form-urlencoded/i.test(String(req.headers['content-type'] || ''));
function parseBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return JSON.stringify(b).length > MAX_BODY ? null : b;
  const s = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '';
  if (!s || s.length > MAX_BODY) return null;
  if (isForm(req)) return Object.fromEntries(new URLSearchParams(s));
  try { return JSON.parse(s); } catch { return null; }
}
// JSON for the page; a form post without JavaScript goes back to the form, saying how it went
function answer(req, res, status, body) {
  if (isForm(req)) {
    res.statusCode = 303;
    res.setHeader('Location', `/cities?request=${status === 200 ? 'sent' : 'check'}#request`);
    res.end();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!process.env.CRON_SECRET || (req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'unauthorized' }); return;
    }
    const since = Number(req.query?.since) || Date.now() - 24 * 3600e3;
    const emails = req.query?.emails === '1';
    const list = (await readCityRequests()).filter((e) => e && e.ts > since).reverse()
      .map(({ email, ...rest }) => (emails && email ? { ...rest, email } : rest));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ since, total: list.length, requests: list });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method', message: 'GET or POST' }); return; }

  const v = validate(parseBody(req));
  if (v.spam) { answer(req, res, 200, { ok: true }); return; }   // looks accepted; nothing is stored
  if (v.error) { answer(req, res, 400, { error: v.error, ...(v.error !== 'body' ? { field: v.error } : {}), message: v.message }); return; }
  if (!storeReady()) { answer(req, res, 503, { error: 'store', message: 'Requests are closed for a moment. Try again later.' }); return; }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  try {
    if (!localSlot(ip) || !(await claimSlot(`cityreq|${ip}`, IP_GAP_MS))) { answer(req, res, 429, { error: 'rate', message: 'One request a minute, please. Try again soon.' }); return; }
    if (!(await underCityRequestRate())) { answer(req, res, 429, { error: 'busy', message: 'Lots of requests right now. Try again in an hour.' }); return; }
    await pushCityRequest({ id: randomUUID(), ts: Date.now(), ...v.entry });
  } catch {
    answer(req, res, 503, { error: 'store', message: 'Couldn\'t save it. Try again.' }); return;
  }
  answer(req, res, 200, { ok: true });
}
