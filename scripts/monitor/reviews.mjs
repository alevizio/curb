// App Store review watch — run with the 30 min smoke checks by .github/workflows/monitor.yml.
// Reads CURB's customer reviews from the App Store Connect API and fails one check per low review
// (<= LOW_STARS) from the last WINDOW_DAYS that has no developer reply yet. alert.mjs turns that into
// ONE issue (label monitor:reviews): an email when a low review lands, a follow-up when another one
// does, and it closes by itself once every low review has a reply. Apple's public reviews RSS feed
// returns no entries for CURB (checked Sep 2026), so the signed API is the only reliable source.
//
//   node scripts/monitor/reviews.mjs [--out results.json]
// Env: ASC_ISSUER_ID, ASC_KEY_ID and ASC_KEY_P8 (the .p8 PEM text, or its base64) of an App Store
//      Connect API key (Customer Support role is enough). Unset → the check is skipped, never failing.
// The repo is public, so results carry only rating, territory, date and a short review id: never the
// reviewer's nickname, title or text (read and answer those in App Store Connect).
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';

export const APP_ID = '6780998238';
export const LOW_STARS = 3;    // 1 to 3 stars need a reply
export const WINDOW_DAYS = 30; // older unanswered reviews stop alerting (a new review re-alerts anyway)
export const REPLY_URL = `https://appstoreconnect.apple.com/apps/${APP_ID}`;
const API = 'https://api.appstoreconnect.apple.com/v1';
const NAME = 'App Store reviews';

const ok = (name, detail = '') => ({ name, status: 'ok', detail });
const fail = (name, detail) => ({ name, status: 'fail', detail });
const skip = (name, detail) => ({ name, status: 'skip', detail });
const b64url = (b) => Buffer.from(b).toString('base64url');

/** The .p8 key from env: raw PEM (escaped newlines tolerated) or the whole PEM base64 encoded. */
export function loadKey(p8) {
  const raw = String(p8 || '').replace(/\\n/g, '\n').trim();
  const pem = raw.includes('BEGIN') ? raw : Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
  return crypto.createPrivateKey(pem);
}

/** App Store Connect API token: ES256, 15 min life (Apple's limit is 20). */
export function apiToken({ issuer, keyId, p8 }, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: issuer, iat: nowSec, exp: nowSec + 900, aud: 'appstoreconnect-v1' }));
  // ECDSA P-256 JWTs need the raw R||S (IEEE P1363) signature, not DER
  const sig = crypto.sign('SHA256', Buffer.from(`${head}.${claims}`), { key: loadKey(p8), dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(sig)}`;
}

/** Short, stable, non-reversible id for a review, safe for a public issue. */
export const reviewTag = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8);

/** Pure: API page → results. A review counts as answered once any reply exists (published or pending). */
export function judgeReviews(page, now = Date.now()) {
  const reviews = Array.isArray(page?.data) ? page.data : [];
  // a reply shows as the review's response linkage, or as an included response pointing back at it
  const replied = new Set((Array.isArray(page?.included) ? page.included : [])
    .filter((x) => x.type === 'customerReviewResponses').map((x) => x.relationships?.review?.data?.id).filter(Boolean));
  const since = now - WINDOW_DAYS * 86400e3;
  const open = reviews.filter((r) => {
    const a = r.attributes || {};
    const when = Date.parse(a.createdDate);
    return Number(a.rating) <= LOW_STARS && when >= since && !r.relationships?.response?.data && !replied.has(r.id);
  });
  if (!open.length) return [ok(NAME, `${reviews.length} recent reviews checked, every low review from the last ${WINDOW_DAYS} days has a reply`)];
  return open.map((r) => {
    const a = r.attributes;
    const day = new Date(a.createdDate).toISOString().slice(0, 10);
    return fail(`App Store review ${reviewTag(r.id)}`,
      `${a.rating}★ review (${String(a.territory || '?').replace(/[^A-Z]/g, '')}, ${day}) has no reply yet. Read and reply: ${REPLY_URL} → Ratings and Reviews`);
  });
}

export async function checkReviews(f = fetch, env = process.env, now = Date.now()) {
  const { ASC_ISSUER_ID: issuer, ASC_KEY_ID: keyId, ASC_KEY_P8: p8 } = env;
  if (!issuer || !keyId || !p8) return [skip(NAME, 'no App Store Connect API key (ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_P8)')];
  const url = `${API}/apps/${APP_ID}/customerReviews?sort=-createdDate&limit=100&include=response` +
    '&fields[customerReviews]=rating,createdDate,territory,response';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await f(url, { headers: { authorization: `Bearer ${apiToken({ issuer, keyId, p8 })}` }, signal: ctrl.signal });
    if (!r.ok) {
      const hint = r.status === 401 ? ' (key id, issuer id or .p8 wrong, or the key was revoked)'
        : r.status === 403 ? ' (the key\'s role cannot read reviews: give it Customer Support or App Manager)' : '';
      return [fail(NAME, `App Store Connect API HTTP ${r.status}${hint}`)];
    }
    return judgeReviews(await r.json(), now);
  } finally { clearTimeout(t); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  let results;
  try { results = await checkReviews(fetch); } catch (e) { results = [fail(NAME, `check crashed: ${e.message}`)]; }
  for (const r of results) console.log(`${r.status === 'ok' ? '✅' : r.status === 'skip' ? '⏭️ ' : '❌'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
}
