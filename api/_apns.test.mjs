// Tests for the APNs provider-JWT + key loader (api/_apns.js) — the key path that repeatedly broke
// when the .p8 got mangled pasting it into the Vercel env UI. Locks in: raw-PEM load, the preferred
// base64 (_B64) load, recovery from a newline-collapsed PEM, the ES256 signature, and JWT caching.
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { getProviderToken, resetProviderToken, apnsConfigured } from './_apns.js';

// A throwaway P-256 keypair stands in for the real APNs .p8 (same curve + PKCS#8 PEM shape APNs uses).
function makeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), publicKey };
}
const KEY_A = makeKey();
const KEY_B = makeKey();

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const decodeSeg = (s) => JSON.parse(b64urlToBuf(s).toString('utf8'));

// Verify a minted token's ES256 signature against a public key (IEEE-P1363 R||S, as APNs requires).
function sigVerifies(token, publicKey) {
  const [h, c, sig] = token.split('.');
  return crypto.verify('SHA256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64urlToBuf(sig));
}

beforeEach(() => {
  resetProviderToken(); // clear the module-scope cache between cases
  process.env.APNS_KEY_ID = 'KEYID12345';
  process.env.APNS_TEAM_ID = 'TEAM123456';
  delete process.env.APNS_KEY_P8;
  delete process.env.APNS_KEY_P8_B64;
});

describe('apnsConfigured', () => {
  it('false without a key, true once a key + id + team are present', () => {
    expect(apnsConfigured()).toBe(false);
    process.env.APNS_KEY_P8 = KEY_A.pem;
    expect(apnsConfigured()).toBe(true);
  });

  it('accepts APNS_KEY_P8_B64 as the key', () => {
    process.env.APNS_KEY_P8_B64 = Buffer.from(KEY_A.pem).toString('base64');
    expect(apnsConfigured()).toBe(true);
  });
});

describe('getProviderToken — ES256 provider JWT', () => {
  it('mints a 3-part JWT with the right header + claims, signed by the key (raw PEM)', () => {
    process.env.APNS_KEY_P8 = KEY_A.pem;
    const token = getProviderToken();
    const [h, c] = token.split('.');
    expect(token.split('.')).toHaveLength(3);
    expect(decodeSeg(h)).toEqual({ alg: 'ES256', kid: 'KEYID12345' });
    const claims = decodeSeg(c);
    expect(claims.iss).toBe('TEAM123456');
    expect(typeof claims.iat).toBe('number');
    expect(sigVerifies(token, KEY_A.publicKey)).toBe(true);
  });

  it('prefers APNS_KEY_P8_B64 over APNS_KEY_P8', () => {
    process.env.APNS_KEY_P8_B64 = Buffer.from(KEY_A.pem).toString('base64');
    process.env.APNS_KEY_P8 = KEY_B.pem; // must be ignored when _B64 is present
    const token = getProviderToken();
    expect(sigVerifies(token, KEY_A.publicKey)).toBe(true);
    expect(sigVerifies(token, KEY_B.publicKey)).toBe(false);
  });

  it('recovers a PEM whose newlines were collapsed to spaces in the env UI', () => {
    process.env.APNS_KEY_P8 = KEY_B.pem.replace(/\n/g, ' '); // simulate the mangled multiline paste
    const token = getProviderToken();
    expect(sigVerifies(token, KEY_B.publicKey)).toBe(true);
  });

  it('caches the token, and resetProviderToken() forces a fresh mint', () => {
    process.env.APNS_KEY_P8 = KEY_A.pem;
    const t1 = getProviderToken();
    expect(getProviderToken()).toBe(t1); // cached — identical string returned
    resetProviderToken();
    const t3 = getProviderToken();
    expect(t3).not.toBe(t1); // re-minted (ECDSA signatures are randomized, so the token differs)
    expect(sigVerifies(t3, KEY_A.publicKey)).toBe(true);
  });
});
