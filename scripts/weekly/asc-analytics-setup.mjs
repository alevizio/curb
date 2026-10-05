// One-time setup for the weekly report's App Store analytics (scripts/weekly/sources/app-analytics.mjs):
// asks Apple to start producing CURB's Analytics Reports every day (an ONGOING report request). Only an
// Admin key may create one; the weekly job then reads the reports with a Sales and Reports key. It lists
// the app's requests first and creates an ONGOING one only when no live one exists, so a second run is
// harmless. Prints only the request id and its status, never key material. First reports arrive 24 to 48
// hours later. If Apple ever stops the reports after inactivity, run it again.
//
//   node scripts/weekly/asc-analytics-setup.mjs [--p8 path/to/AuthKey_XXXX.p8]
// Env: ASC_ADMIN_ISSUER_ID, ASC_ADMIN_KEY_ID and ASC_ADMIN_KEY_P8 (the .p8 PEM text, or its base64; or
//      pass the file with --p8) of an App Store Connect API key with the Admin role.
import { readFileSync } from 'node:fs';
import { APP_ID, apiToken } from '../monitor/reviews.mjs';

const API = 'https://api.appstoreconnect.apple.com/v1';

async function call(f, token, method, path, body) {
  const r = await f(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const hint = r.status === 401 ? ' (key id, issuer id or .p8 wrong, or the key was revoked)'
      : r.status === 403 ? ' (creating report requests needs an Admin key)'
      : r.status === 409 ? ' (Apple refused a second ONGOING request: a stopped one may need deleting in the API first)' : '';
    throw new Error(`App Store Connect HTTP ${r.status} on ${method} ${path.split('?')[0]}${hint}`);
  }
  return r.json();
}

/** Find the app's live ONGOING report request, or create one. → { id, status: 'active' | 'created' } */
export async function ensureOngoingRequest(f, token) {
  const list = await call(f, token, 'GET', `/apps/${APP_ID}/analyticsReportRequests?limit=200`);
  const ongoing = (list.data || []).filter((x) => x.attributes?.accessType === 'ONGOING');
  const live = ongoing.find((x) => !x.attributes.stoppedDueToInactivity);
  if (live) return { id: live.id, status: 'active' };
  const made = await call(f, token, 'POST', '/analyticsReportRequests', {
    data: {
      type: 'analyticsReportRequests',
      attributes: { accessType: 'ONGOING' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  });
  return { id: made.data?.id, status: 'created' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const p8Path = args.includes('--p8') ? args[args.indexOf('--p8') + 1] : null;
  const { ASC_ADMIN_ISSUER_ID: issuer, ASC_ADMIN_KEY_ID: keyId } = process.env;
  const p8 = p8Path ? readFileSync(p8Path, 'utf8') : process.env.ASC_ADMIN_KEY_P8;
  const missing = [!issuer && 'ASC_ADMIN_ISSUER_ID', !keyId && 'ASC_ADMIN_KEY_ID', !p8 && 'ASC_ADMIN_KEY_P8 (or --p8 <file>)'].filter(Boolean);
  if (missing.length) { console.error(`missing ${missing.join(', ')}`); process.exit(1); }
  try {
    const { id, status } = await ensureOngoingRequest(fetch, apiToken({ issuer, keyId, p8 }));
    console.log(`ONGOING analytics report request ${id}: ${status === 'created' ? 'created, first reports in 24 to 48 hours' : 'already active'}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
