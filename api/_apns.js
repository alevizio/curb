// Minimal APNs (Apple Push Notification service) sender over node:http2 + node:crypto — no extra
// deps, mirroring the repo's hand-rolled web-push-minimal style. Token-based auth (a .p8 APNs key →
// ES256 provider JWT). Helper file ("_" prefix) — import-only.
//
// Env: APNS_KEY_P8_B64 (preferred, base64 of the whole .p8 PEM) or APNS_KEY_P8 (raw .p8 PEM),
//      APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, optional APNS_HOST.
import http2 from 'node:http2';
import crypto from 'node:crypto';

const BUNDLE = () => process.env.APNS_BUNDLE_ID || 'guide.curb.ios';
export const PROD_HOST = 'api.push.apple.com';
export const SANDBOX_HOST = 'api.development.push.apple.com';
// Primary host: production by default (TestFlight + App Store). Override with APNS_HOST for a
// sandbox-only setup. The cron also falls back to the OTHER host on a BadDeviceToken (a device's
// token environment depends on the build, so a single primary can mismatch during testing).
const HOST = () => process.env.APNS_HOST || PROD_HOST;
export const primaryHost = () => HOST();
export const altHost = () => (HOST() === SANDBOX_HOST ? PROD_HOST : SANDBOX_HOST);

/** True once the APNs key (APNS_KEY_P8_B64 or APNS_KEY_P8), APNS_KEY_ID and APNS_TEAM_ID are all
 *  present (APNS_BUNDLE_ID defaults to guide.curb.ios). The cron skips the iOS pass when false, so
 *  the live web-push path is never affected before the key is configured. */
export function apnsConfigured() {
  return Boolean((process.env.APNS_KEY_P8_B64 || process.env.APNS_KEY_P8) && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Load the APNs private key robustly. Reads APNS_KEY_P8_B64 first (preferred — base64 of the whole
// .p8 PEM), then falls back to APNS_KEY_P8 however it ended up stored. PEM is whitespace-
// sensitive, and pasting a multi-line .p8 into an env-var UI often collapses the newlines (to
// spaces, escaped "\n", or one line) — which makes a direct PEM parse fail with a DECODER error.
// So: try the value as-is (newlines intact / escaped), and if that fails, strip the BEGIN/END
// markers + ALL whitespace to recover the base64 body and load it as PKCS#8 DER.
function loadApnsKey() {
  // PREFERRED: APNS_KEY_P8_B64 = base64 of the whole .p8 PEM. Single-line, charset-safe — survives
  // any env-var field with no newline/charset mangling. Decode straight back to the original PEM.
  const b64Pem = process.env.APNS_KEY_P8_B64;
  if (b64Pem) {
    const pem = Buffer.from(String(b64Pem).replace(/\s+/g, ''), 'base64').toString('utf8');
    return crypto.createPrivateKey(pem);
  }
  // FALLBACK: APNS_KEY_P8 = raw PEM. Tolerate escaped/collapsed newlines; if a direct parse fails,
  // strip the BEGIN/END markers + all whitespace and load the base64 body as PKCS#8 DER.
  const raw = String(process.env.APNS_KEY_P8 || '').replace(/\\n/g, '\n').trim();
  try { return crypto.createPrivateKey(raw); } catch { /* fall back to DER reconstruction */ }
  const body = raw.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return crypto.createPrivateKey({ key: Buffer.from(body, 'base64'), format: 'der', type: 'pkcs8' });
}

// Cache the ES256 provider token at module scope and re-mint only every ~50 min. APNs 429s a
// re-mint sooner than ~20 min (TooManyProviderTokenUpdates) and 403s a token older than 1h
// (ExpiredProviderToken). A cold start re-mints — harmless at a 15-min cron cadence.
let _jwt = null; // { token, iat }
export function getProviderToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (_jwt && nowSec - _jwt.iat < 3000) return _jwt.token;
  const key = loadApnsKey();
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: nowSec }));
  const signingInput = `${header}.${claims}`;
  // ECDSA P-256 JWTs require the raw R||S (IEEE P1363) signature, not DER.
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  const token = `${signingInput}.${b64url(sig)}`;
  _jwt = { token, iat: nowSec };
  return token;
}

/** Drop the cached provider JWT so the next getProviderToken() re-mints. Called on a 403
 *  ExpiredProviderToken/InvalidProviderToken (clock skew / key change on a warm instance) — without
 *  it, every iOS push stays wedged behind the stale token until the instance cold-starts. */
export function resetProviderToken() { _jwt = null; }

/** Open ONE http2 session for the whole cron run. Caller MUST session.close() in a finally so the
 *  function event loop can exit (a lingering session hangs the invocation to timeout). */
export function openSession(host) {
  const session = http2.connect(`https://${host || HOST()}`);
  // A session-level 'error' (DNS/TLS/connect failure) fires asynchronously, so without a listener it
  // escapes the caller's try/catch and becomes an uncaughtException that 500s the whole cron — taking
  // down the already-completed web-push reporting too. Swallow it; sendOne's per-request handler still
  // resolves each in-flight push with { status: 0 }, so the run ends cleanly and retries next tick.
  session.on('error', () => {});
  return session;
}

/** POST one alert to /3/device/<token>. Resolves { status, reason } (never rejects). */
export function sendOne(session, jwt, token, payload, collapseId, expiration) {
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
    // apns-expiration (epoch seconds): the last moment the alert is worth delivering. APNs drops it if
    // the device only reconnects after this — so a "move your car" alert can't arrive hours stale.
    if (expiration != null) headers['apns-expiration'] = String(Math.floor(expiration));
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
