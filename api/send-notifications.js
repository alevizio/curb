// Sweep-alert sender: fires a push for any saved spot with a touchpoint due now (web push + APNs).
// Generate keys: npx web-push generate-vapid-keys
//
// Triggers (any one alone covers every window; overlaps are safe):
//  - Vercel Cron (vercel.json, :07/:22/:37/:52; team on Pro) GETs with `Authorization: Bearer CRON_SECRET`.
//  - PRIMARY: an Upstash QStash schedule POSTs here every 15 min, signed with an Upstash-Signature JWT
//    that is verified below against the raw body and SELF_URL. QStash never holds CRON_SECRET. The
//    schedule MUST have an EMPTY body (see rawBody below).
//  - BACKUP: .github/workflows/sweep-alerts-cron.yml GETs with `Authorization: Bearer CRON_SECRET`.
//    GitHub schedules are best-effort (Sep 2026: ~7 runs/day, not 96), so it only fills gaps.
// Overlapping runs are safe: the run lock + per-sweep de-dupe below.
//  - GET ?status=1 (Bearer only) returns the last run's time/outcome/trigger for the monitor, plus the
//    last QStash-triggered run (lastQstash {at, ok, error?}) and last successful one (lastQstashOk {at}),
//    and `delivery` (judgeDelivery: recent send outcomes, `failing` while pushes don't arrive); no sends.
//  - HC_PING_URL (optional healthchecks.io check): pinged on successful QStash runs, /fail on errors
//    and while pushes are not being delivered (judgeDelivery), so a dead primary scheduler or a dead
//    push channel emails the owner even while the GitHub backup limps along.
import webpush from 'web-push';
import { Receiver } from '@upstash/qstash';
import { createHash } from 'node:crypto';
import {
  loadAllSubs, deleteSub, markNotified, advanceSpot, storeReady,
  loadAllIosSubs, deleteIosSub, markIosNotified, advanceIosSpot, claimSlot, releaseSlot,
  saveRunStatus, loadRunStatus, loadDelivery,
} from './_store.js';
import { recomputeSpot, MAX_WATCH_AGE } from './_schedule.js';
import { apnsConfigured, getProviderToken, resetProviderToken, openSession, sendOne, primaryHost, altHost } from './_apns.js';
import { dueAlert } from '../lib/notify-core.js';

const SEND_TIMEOUT_MS = 10000; // per push request (web push and APNs), well inside the 60 s function limit

// A forever-watch stops auto-advancing once it hasn't been refreshed (by reopening the app with
// live data) for MAX_WATCH_AGE (~120 days, api/_schedule.js, shared with the store) — bounds wrong-time
// pushes if the city changes a block's schedule.
// The run lock's lifetime: longer than the 60 s maxDuration (vercel.json), so it outlives any run.
const RUN_LOCK_MS = 120000;

// Delivery health. A run can finish 200 and deliver nothing: a revoked or mangled APNs key, a bundle id
// change or rotated VAPID keys fail every send with a 4xx, one by one. So each run counts per channel
// what it attempted, delivered, failed (by status) and pruned, and the store keeps the last
// DELIVERY_WINDOW different devices tried per channel with their latest outcome. A channel is failing
// when at least 3 of them failed and failures are at least twice the deliveries (all failed, or a clear
// majority). Devices, not sends: one dead subscription is retried on every tick of its window (12 for
// the eve push) and must not read as a run of failures. 410/404 prunes are expected and not counted; a
// run with nothing due leaves the window as it was (nothing delivered since means still failing). The
// APNs pass erroring as a whole (a key that won't parse) fails after 2 runs in a row, as do armed iOS
// watches with APNs not configured at all. The verdict feeds healthchecks and ?status=1 (the monitor).
const DELIVERY_WINDOW = 6;
const deviceId = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

/** Fold one run's device outcomes ({ web, ios: [{ id, ok, why? }], iosError?, iosUnconfigured? }) into
 *  the stored window → { delivery (to store), failing: readable lines, empty while healthy }. */
export function judgeDelivery(prev, run) {
  const fold = (win, outs) => {
    let w = Array.isArray(win) ? win : [];
    for (const o of outs) w = [o, ...w.filter((x) => x.id !== o.id)];
    return w.slice(0, DELIVERY_WINDOW);
  };
  const web = fold(prev?.web, run.web), ios = fold(prev?.ios, run.ios);
  const iosErrorRuns = run.iosError ? (prev?.iosErrorRuns || 0) + 1 : 0;
  const failing = [];
  for (const [name, w] of [['web', web], ['iOS', ios]]) {
    const bad = w.filter((x) => !x.ok);
    if (bad.length < 3 || bad.length < 2 * (w.length - bad.length)) continue;
    const why = {};
    for (const x of bad) why[x.why] = (why[x.why] || 0) + 1;
    failing.push(`${name}: ${bad.length} of the last ${w.length} devices failed (${Object.entries(why).map(([k, n]) => `${k} ×${n}`).join(', ')})`);
  }
  if (iosErrorRuns >= 2) failing.push(`iOS: the APNs pass failed ${iosErrorRuns} runs in a row (${run.iosError})`);
  if (run.iosUnconfigured) failing.push(`iOS: APNs is not configured (APNS_* env vars), so ${run.iosUnconfigured} armed iOS watches get no push`);
  return { delivery: { web, ios, ...(iosErrorRuns ? { iosErrorRuns } : {}), ...(failing.length ? { failing } : {}) }, failing };
}

// The cadence brain — which push is due for a spot right now, with what copy, at the user's chosen
// intensity + voice — lives in lib/notify-core.js. It's a pure, unit-tested module shared by BOTH
// transports here AND the /api/test-notification preview endpoint, so they can never diverge.
// dueAlert(spot, notifiedMap, now) -> { key, tag, title, body } | null.

// A notification tap opens the specific block when we know its cnn, else the map. It names the curb side
// (?side=North; /b/ passes it on to the live map link, like a shared link): with both sides of a block
// watched, a tap on one side's push must not open the other side's sheet. Letters only, as /b/ accepts.
const deepLink = (spot) => (spot && spot.cnn
  ? '/b/' + spot.cnn + (/^[A-Za-z]{1,12}$/.test(spot.blockside || '') ? '?side=' + spot.blockside : '')
  : '/');

// A device keeps up to 5 watches (one per curb side, api/_store.js MAX_WATCHES), each its own record, so
// both loops below run per WATCH exactly as they ran per device. What is per DEVICE: `checked` (devices
// with any record, alerts off included, as before) next to `watches` (armed watches); the delivery window
// (judgeDelivery folds by device id); a prune (410/404, BadDeviceToken) removes every watch of the device
// once; and a device whose send failed this run skips its other watches until the next tick, so a dead or
// stalled push service costs one failure and one timeout per device, never one per watch.
// Watch n's pushes carry `<tag>-<n>` (web tag and APNs collapse id): with one shared tag, both sides' eve
// pushes at 8 PM would collapse into one notification. Watch 0 keeps the tag it always had.
const tagFor = (tag, slot) => (slot ? `${tag}-${slot}` : tag);

// The QStash JWT's `sub` claim is the schedule's destination URL; the schedule must target exactly this
// (no query string), so a signed request can never reach ?test / ?status.
const SELF_URL = 'https://curb.guide/api/send-notifications';

// The QStash signature covers a hash of the exact request bytes. DEPLOY REQUIREMENT: the QStash schedule
// must send an EMPTY body. On Vercel the Node runtime's request helpers read the whole stream before this
// handler runs whenever a Content-Type is sent (the config below does not switch them off), and replay it
// only to 'data'/'end' listeners, so rawBody() gets '' for e.g. a `{}` JSON body; a body sent without a
// Content-Type is dropped the same way. The hash then never matches and every primary run is refused
// (401), leaving alerts to the sparse GitHub backup. An empty body verifies on every path.
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;           // body parser ran anyway (text)
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

/** 'qstash' (valid Upstash-Signature) | 'bearer' (CRON_SECRET) | null. */
async function authenticate(req) {
  const sig = req.headers['upstash-signature'];
  if (sig) {
    const { QSTASH_CURRENT_SIGNING_KEY: cur, QSTASH_NEXT_SIGNING_KEY: next } = process.env;
    if (!cur || !next) return null;
    try {
      // devMode:false — a stray QSTASH_DEV env must never swap in Upstash's public dev keys.
      await new Receiver({ currentSigningKey: cur, nextSigningKey: next, devMode: false })
        .verify({ signature: String(sig), body: await rawBody(req), url: SELF_URL });
      return 'qstash';
    } catch { return null; }
  }
  const secret = process.env.CRON_SECRET;
  return secret && (req.headers.authorization || '') === `Bearer ${secret}` ? 'bearer' : null;
}

/** healthchecks.io: success only for QStash runs (the sparse GitHub backup must not mask a dead
 *  primary), /fail for an erroring or undelivering run from either trigger. Best effort, never throws. */
async function pingHealth(trigger, outcome, undelivered = false) {
  const url = process.env.HC_PING_URL;
  const good = outcome === 'ok' && !undelivered;
  if (!url || outcome === 'skipped' || (good && trigger !== 'qstash')) return;
  try { await fetch(good ? url : url + '/fail', { signal: AbortSignal.timeout(5000) }); } catch { /* ignored */ }
}

export default async function handler(req, res) {
  // Required: this endpoint dispatches pushes + spends store/web-push quota, so it must not run
  // unauthenticated — a QStash signature or the CRON_SECRET bearer, nothing else.
  if (!process.env.CRON_SECRET && !(process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)) {
    res.status(503).json({ error: 'neither CRON_SECRET nor QSTASH_*_SIGNING_KEY set — refusing to run unauthenticated' }); return;
  }
  const trigger = await authenticate(req);
  if (!trigger) { res.status(401).json({ error: 'unauthorized' }); return; }
  const test = req.query?.test || '';
  const statusMode = req.query?.status || '';
  // ?test pushes to every iOS device and ?status reads the run log: CRON_SECRET holders only.
  if ((test || statusMode) && trigger !== 'bearer') { res.status(403).json({ error: 'forbidden' }); return; }

  // Read-only status for the monitor: when the sender last ran, how it went, who triggered it.
  if (statusMode) {
    if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
    if (!storeReady()) { res.status(500).json({ error: 'store not configured' }); return; }
    res.status(200).json({ ok: true, now: new Date().toISOString(), ...(await loadRunStatus()) });
    return;
  }

  // Authed delivery test: ?test=ios sends a one-off push to every iOS token with alerts ON, bypassing
  // the due-window logic (and never touching spot/dedupe state) — to confirm end-to-end APNs
  // delivery on demand. Uses the same cross-host retry as the real loop. A turned-off watch (spot =
  // null, kept only for its de-dupe) is skipped: someone who opted out must not get a test push.
  if (test === 'ios') {
    if (!storeReady()) { res.status(500).json({ error: 'store not configured' }); return; }
    if (!apnsConfigured()) { res.status(400).json({ error: 'APNs not configured' }); return; }
    const tokens = [...new Set((await loadAllIosSubs()).filter((t) => t.spot).map((t) => t.token))].map((token) => ({ token })); // one per device, however many watches
    const results = [];
    if (tokens.length) {
      let session, alt = null;
      try {
        const jwt = getProviderToken();
        session = openSession();
        const aps = { aps: { alert: { title: 'CURB test ✅', body: 'Native push is working. You can move your car with confidence.' }, sound: 'default' }, url: '/', tag: 'curb-test' };
        const testExp = Math.floor(Date.now() / 1000) + 300; // a test alert has no real deadline — let APNs drop it after 5 min if undeliverable
        for (const { token } of tokens) {
          let { status, reason } = await sendOne(session, jwt, token, aps, 'curb-test', testExp);
          if (status === 410 || (status === 400 && /BadDeviceToken|Unregistered/i.test(reason))) {
            if (!alt) alt = openSession(altHost());
            ({ status, reason } = await sendOne(alt, jwt, token, aps, 'curb-test', testExp));
          }
          results.push({ status, reason });
        }
      } catch (e) {
        res.status(200).json({ ok: false, test: 'ios', tokens: tokens.length, error: e.message || String(e) }); return;
      } finally {
        try { session && session.close(); } catch {}
        try { alt && alt.close(); } catch {}
      }
    }
    res.status(200).json({ ok: true, test: 'ios', tokens: tokens.length, results });
    return;
  }

  // Every real run is recorded (for ?status=1) and reported to healthchecks before responding. A full
  // run also folds its device outcomes (`sends`) into the delivery window: one extra read, same write.
  const started = Date.now();
  const finish = async (code, body, detail, sends) => {
    const outcome = code !== 200 ? 'error' : body.skipped ? 'skipped' : 'ok';
    let delivery, failing = [];
    if (sends) try { ({ delivery, failing } = judgeDelivery(await loadDelivery(), sends)); } catch { /* keep the stored window */ }
    try {
      await saveRunStatus({ at: new Date(started).toISOString(), trigger, outcome, ms: Date.now() - started,
        ...(body.web ? { web: body.web, ios: body.ios } : {}), ...(body.error ? { error: detail || body.error } : {}) }, delivery);
    } catch { /* a status write must never fail the run */ }
    await pingHealth(trigger, outcome, failing.length > 0);
    res.status(code).json(body);
  };

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    await finish(500, { error: 'VAPID keys not set (see .env.example)' }); return;
  }
  if (!storeReady()) {
    await finish(500, { error: 'store not configured (set KV_REST_API_URL / KV_REST_API_TOKEN)' }); return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:you@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Run-level lock: two schedulers drive this endpoint (QStash AND the GitHub backup), so two
  // invocations can overlap. The per-sweep markNotified dedupe is a non-atomic read-modify-write, so
  // overlapping runs could both pass it and double-fire. A short atomic claim (longer than the 60s
  // maxDuration) lets at most one run process a given ~2-min window; a skipped run is a harmless no-op.
  // Released as soon as a run has fully succeeded (every markNotified landed), so a GitHub run a minute
  // before a QStash tick no longer swallows that tick and delays its pushes by 15 min.
  // Deliberately NOT released on error: a retry would then re-send any push whose markNotified failed.
  // No-op in dev (no store).
  if (!(await claimSlot('cron-run', RUN_LOCK_MS))) {
    await finish(200, { ok: true, skipped: 'another run holds the lock' }); return;
  }

  try {
    const now = Date.now();
    let sent = 0, pruned = 0, rearmed = 0;
    let iosSent = 0, iosPruned = 0, iosRearmed = 0;
    // Delivery health: failures by status per channel, and each device's outcome (see judgeDelivery).
    const webFailures = {}, iosFailures = {}, webOut = [], iosOut = [];
    const failedOn = (map, out, id, why) => { map[why] = (map[why] || 0) + 1; out.push({ id: deviceId(id), ok: false, why }); };

    // ---- Web Push ---- (one entry per watch; `field` is the watch's record, `endpoint` its device)
    const subs = await loadAllSubs();
    const webGone = new Set(), webDown = new Set();
    for (const { field, slot, endpoint, subscription, spot, notified, savedAt } of subs) {
      if (!spot || !spot.nextSweepISO || webGone.has(endpoint)) continue;
      // Forever-watch re-arm: advance to the next occurrence once the window ends (its OWN pass —
      // never coupled to the lead push, which still returns the same instant at lead time). Stops
      // while stale (MAX_WATCH_AGE) so a frozen rule can't track a city schedule change. The
      // advanced occurrence is in the future, so nothing pushes this tick → continue. Skipped when the
      // user turned the watch off or re-saved it since the snapshot (advanceSpot re-reads it).
      if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
        const advanced = recomputeSpot(spot);
        if (advanced) { if (await advanceSpot(field, advanced, spot)) rearmed++; continue; }
      }
      const due = dueAlert(spot, notified, now);
      if (!due || webDown.has(endpoint)) continue;
      const payload = JSON.stringify({ title: due.title, body: due.body, url: deepLink(spot), tag: tagFor(due.tag, slot), requireInteraction: due.urgent });
      // Bounded TTL (web-push's default is 4 weeks: an offline phone would get "move your car" days
      // late) + high urgency for act-now pushes (Android Doze holds normal ones). No Topic header:
      // Apple's web push service rejects it, which would silently drop every Safari/iOS PWA alert.
      // timeout: web-push has none, and one push service that never answers stalled the whole run (every
      // later sub, the APNs pass) until the 60 s function limit killed it before finish() recorded anything.
      const opts = { TTL: Math.max(60, Math.floor((due.expiresAt - Date.now()) / 1000)), urgency: due.urgent ? 'high' : 'normal', timeout: SEND_TIMEOUT_MS };
      let delivered = false;
      try {
        await webpush.sendNotification(subscription, payload, opts);
        delivered = true; sent++; webOut.push({ id: deviceId(endpoint), ok: true });
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) { await deleteSub(endpoint); webGone.add(endpoint); pruned++; }
        else {
          webDown.add(endpoint);
          console.error('web push failed:', err.statusCode || 0, String(err.body || err.message || '').slice(0, 200));
          // Keyed by status only (the monitor's issues are public: no push-service text in them). No
          // status: no answer (a timeout, a network error code) or a send that never left (bad keys).
          failedOn(webFailures, webOut, endpoint, err.statusCode ? String(err.statusCode)
            : '0 ' + (/timeout/i.test(String(err.message)) ? 'timeout' : String(err.code || 'error').slice(0, 24)));
        }
      }
      // De-dupe write lives OUTSIDE the send try/catch: a transient store error here must not be
      // mistaken for a send failure (which would let the next 15-min tick re-push the same sweep).
      if (delivered) await markNotified(field, spot.nextSweepISO, due.key);
    }

    // ---- Native APNs (iOS) ---- identical windows / dedupe / re-arm, different transport. Skipped
    // entirely until the APNS_* env vars are set, so the web-push path is unaffected before then.
    // Always load so `checked` reflects how many iOS watches actually exist (independent of whether
    // the APNs key is present) — this disambiguates "no device registered" from "key not loaded".
    const iosConfigured = apnsConfigured();
    const iosSubs = await loadAllIosSubs();
    const iosGone = new Set(), iosDown = new Set();
    let iosError = null; // isolate APNs failures so they can't 500 the cron or block web push
    if (iosConfigured && iosSubs.length) try {
      let jwt = getProviderToken(); // throws on a malformed .p8 — caught below, not fatal
      let jwtReset = false; // re-mint the provider JWT at most once per run on a 403 ExpiredProviderToken
      const session = openSession(); // ONE http2 session on the primary host; closed in finally
      let altSession = null; // opened lazily only if a token mismatches the primary environment
      const isBadToken = (s, r) => s === 410 || (s === 400 && /BadDeviceToken|Unregistered/i.test(r));
      try {
        for (const { field, slot, token, spot, notified, savedAt } of iosSubs) {
          if (!spot || !spot.nextSweepISO || iosGone.has(token)) continue;
          if (!savedAt || now - savedAt < MAX_WATCH_AGE) {
            const advanced = recomputeSpot(spot);
            if (advanced) { if (await advanceIosSpot(field, advanced, spot)) iosRearmed++; continue; }
          }
          const due = dueAlert(spot, notified, now);
          if (!due || iosDown.has(token)) continue;
          const tag = tagFor(due.tag, slot);
          const aps = { aps: { alert: { title: due.title, body: due.body }, sound: 'default', 'thread-id': tag }, url: deepLink(spot), tag };
          // apns-expiration = when this push stops being worth delivering (notify-core expiresAt: the
          // sweep for lead/tonight, SF midnight for the "tomorrow" eve push): a device that reconnects
          // later never shows a stale or wrong-day alert.
          const exp = Math.floor(due.expiresAt / 1000);
          let { status, reason } = await sendOne(session, jwt, token, aps, tag, exp);
          // Cross-host retry: a device's token environment (sandbox vs production) follows the build,
          // so the primary host can reject a valid token as BadDeviceToken. Try the OTHER host once
          // before pruning — only then is the token genuinely dead.
          if (isBadToken(status, reason)) {
            try {
              if (!altSession) altSession = openSession(altHost());
              ({ status, reason } = await sendOne(altSession, jwt, token, aps, tag, exp));
            } catch { /* alt host unreachable — fall through to prune below */ }
          }
          // 403 ExpiredProviderToken => the cached ES256 JWT went stale on this warm instance (clock
          // skew / key change). Re-mint ONCE per run and resend — never per-token, or APNs 429s the
          // mint. The guard makes the rest of the batch reuse the fresh token.
          if (status === 403 && /ExpiredProviderToken|InvalidProviderToken/i.test(reason) && !jwtReset) {
            jwtReset = true;
            resetProviderToken();
            jwt = getProviderToken();
            ({ status, reason } = await sendOne(session, jwt, token, aps, tag, exp));
          }
          let delivered = false;
          if (status === 200) { delivered = true; iosSent++; iosOut.push({ id: deviceId(token), ok: true }); }
          else if (isBadToken(status, reason)) { await deleteIosSub(token); iosGone.add(token); iosPruned++; }
          else { iosDown.add(token); failedOn(iosFailures, iosOut, token, `${status}${reason ? ' ' + String(reason).slice(0, 40) : ''}`); } // e.g. 403 InvalidProviderToken
          if (delivered) await markIosNotified(field, spot.nextSweepISO, due.key);
        }
      } finally {
        try { session.close(); } catch { /* already closed */ }
        try { if (altSession) altSession.close(); } catch { /* already closed */ }
      }
    } catch (e) {
      iosError = e.message || String(e); // e.g. a PEM parse error — non-secret, helps diagnose
      console.error('APNs pass failed:', e);
    }

    // Fully successful = the web loop finished (any store error throws past here) and the APNs pass
    // did too (its errors, markIosNotified's included, land in iosError). Only then free the lock —
    // and only while it is surely still ours (maxDuration 60 s < RUN_LOCK_MS). If the release fails,
    // the lock simply expires.
    if (!iosError && Date.now() - started < RUN_LOCK_MS) {
      try { await releaseSlot('cron-run'); } catch { /* expires on its own */ }
    }
    const tally = (ok, gone, failures) => {
      const failed = Object.values(failures).reduce((n, c) => n + c, 0);
      return { attempted: ok + failed + gone, sent: ok, failed, pruned: gone, ...(failed ? { failures } : {}) };
    };
    // checked = devices (alerts off included, as before); watches = armed watches across them
    const count = (list, dev) => ({ checked: new Set(list.map((x) => x[dev])).size, watches: list.filter((x) => x.spot).length });
    await finish(200, { ok: true, web: { ...count(subs, 'endpoint'), ...tally(sent, pruned, webFailures), rearmed }, ios: { configured: iosConfigured, ...count(iosSubs, 'token'), ...tally(iosSent, iosPruned, iosFailures), rearmed: iosRearmed, ...(iosError ? { error: iosError } : {}) } },
      undefined, { web: webOut, ios: iosOut, iosError, iosUnconfigured: iosConfigured ? 0 : iosSubs.filter((t) => t.spot).length });
  } catch (e) {
    console.error('send-notifications failed:', e);
    await finish(500, { error: 'internal error' }, String((e && e.message) || e).slice(0, 200));
  }
}
