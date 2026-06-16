// Minimal APNs (Apple Push Notification service) sender over node:http2 + node:crypto — no extra
// deps, mirroring the repo's hand-rolled web-push-minimal style. Token-based auth (a .p8 APNs key →
// ES256 provider JWT). Helper file ("_" prefix) — import-only.
//
// Env: APNS_KEY_P8 (the full .p8 PEM), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, optional APNS_HOST.
import http2 from 'node:http2';
import crypto from 'node:crypto';

const BUNDLE = () => process.env.APNS_BUNDLE_ID || 'guide.curb.ios';
const HOST = () => process.env.APNS_HOST || 'api.push.apple.com'; // sandbox: api.development.push.apple.com

/** True once all four APNs env vars are present. The cron skips the iOS pass when false, so the
 *  live web-push path is never affected before the key is configured. */
export function apnsConfigured() {
  return Boolean(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Cache the ES256 provider token at module scope and re-mint only every ~50 min. APNs 429s a
// re-mint sooner than ~20 min (TooManyProviderTokenUpdates) and 403s a token older than 1h
// (ExpiredProviderToken). A cold start re-mints — harmless at a 15-min cron cadence.
let _jwt = null; // { token, iat }
export function getProviderToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (_jwt && nowSec - _jwt.iat < 3000) return _jwt.token;
  // .p8 newlines must survive: if stored with escaped "\n", restore real newlines before signing.
  const pem = String(process.env.APNS_KEY_P8 || '').replace(/\\n/g, '\n');
  const key = crypto.createPrivateKey(pem);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: nowSec }));
  const signingInput = `${header}.${claims}`;
  // ECDSA P-256 JWTs require the raw R||S (IEEE P1363) signature, not DER.
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  const token = `${signingInput}.${b64url(sig)}`;
  _jwt = { token, iat: nowSec };
  return token;
}

/** Open ONE http2 session for the whole cron run. Caller MUST session.close() in a finally so the
 *  function event loop can exit (a lingering session hangs the invocation to timeout). */
export function openSession() {
  return http2.connect(`https://${HOST()}`);
}

/** POST one alert to /3/device/<token>. Resolves { status, reason } (never rejects). */
export function sendOne(session, jwt, token, payload, collapseId) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': BUNDLE(),
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': body.length,
    };
    if (collapseId) headers['apns-collapse-id'] = String(collapseId).slice(0, 64);
    let req;
    try { req = session.request(headers); } catch (e) { resolve({ status: 0, reason: e.message }); return; }
    let status = 0, data = '';
    req.on('response', (h) => { status = h[':status']; });
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      let reason = '';
      try { reason = data ? (JSON.parse(data).reason || '') : ''; } catch { /* empty body on 200 */ }
      resolve({ status, reason });
    });
    req.on('error', (e) => resolve({ status: 0, reason: e.message }));
    req.end(body);
  });
}
