// Weekly report source: CURB's own production health, from two private curb.guide endpoints that both
// take the CRON_SECRET bearer (the same two the 30 min monitor reads, scripts/monitor/smoke.mjs).
//  - /api/send-notifications?status=1: the sweep-alert sender's run record (loadRunStatus in
//    api/_store.js). Watch counts exist only in the last SUCCESSFUL run (lastOk.web/ios.checked: every
//    stored registration, alerts turned off included). There are no weekly push totals: only the last
//    run's counts and the delivery window (the last few devices tried per channel).
//  - /api/client-error?since=<ms>: the anonymous error log, grouped (group() in api/client-error.js). A
//    group keeps only its first/last time, so one call cannot be split by week; three `since` reads
//    (prevStart, start, end) subtract to exact totals for both weeks. Breakage vs informational (a denied
//    location prompt, Precise Location off) is the monitor's own split, realErrors in smoke.mjs.
//
//   import { collect } from './sources/service.mjs'; const section = await collect({ week, env, fetch, now })
// Env: CRON_SECRET (required), CURB_BASE (default https://curb.guide).
// errors.groups[].message is text a visitor's browser sent: fine for the private email (escape it), never
// for a public Actions log or issue. groupId (`id`) is the public-safe handle.
import { judgeAlertsStatus, realErrors, groupId } from '../../monitor/smoke.mjs';

export const EMAX = 2000; // api/_store.js keeps the newest 2000 error reports; older ones are dropped
export const TOP = 6;     // error groups listed per week
const BASE = 'https://curb.guide';

const num = (v) => (Number.isFinite(v) ? v : null);
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const tally = (w) => (Array.isArray(w) ? { devices: w.length, ok: w.filter((x) => x?.ok).length } : null);

/** Pure: the ?status=1 payload → the alerts part of the section. */
export function summarizeAlerts(s, now) {
  s = s || {};
  const done = s.lastOk || null; // a run that finished 'ok' always recorded its web/ios counts
  const verdict = judgeAlertsStatus(s, now);
  return {
    web: num(done?.web?.checked),           // as of lastOkAt
    ios: num(done?.ios?.checked),
    lastRunAt: s.last?.at ?? null,
    lastOutcome: s.last?.outcome ?? null,   // 'ok' | 'skipped' (another run held the lock) | 'error'
    lastTrigger: s.last?.trigger ?? null,   // 'qstash' | 'bearer' (Vercel Cron or the GitHub backup)
    ...(s.last?.error ? { lastError: String(s.last.error).slice(0, 200) } : {}),
    lastOkAt: done?.at ?? null,
    sentLastRun: { web: num(done?.web?.sent), ios: num(done?.ios?.sent) }, // one 15 min tick, usually 0
    iosConfigured: typeof done?.ios?.configured === 'boolean' ? done.ios.configured : null,
    delivery: { web: tally(s.delivery?.web), ios: tally(s.delivery?.ios) },
    failing: Array.isArray(s.delivery?.failing) ? s.delivery.failing.map(String) : [],
    sender: { status: verdict.status, detail: verdict.detail }, // the monitor's own verdict
  };
}

const grouped = (d) => {
  if (!d || !Number.isFinite(d.total) || !Array.isArray(d.groups)) throw new Error('error log: unexpected response');
  return d;
};

/** Pure: the grouped log read since prevStart, start and end → the errors part of the section.
 *  A group only in the start read's top 50 keeps its post-end reports (a slight overcount, only past
 *  50 distinct groups). lastAt is when the group was last seen, up to the report run. */
export function summarizeErrors(fromPrev, fromStart, fromEnd, top = TOP) {
  const [p, s, e] = [fromPrev, fromStart, fromEnd].map((d) => realErrors(grouped(d)));
  const after = new Map(e.groups.map((g) => [g.key, g.count]));
  const groups = s.groups.map((g) => ({ g, count: g.count - (after.get(g.key) || 0) }))
    .filter((x) => x.count > 0).sort((a, b) => b.count - a.count).slice(0, top)
    .map(({ g, count }) => ({
      message: String(g.msg ?? ''), count, kind: g.k, page: g.sample?.page || null,
      where: g.src ? `${g.src}:${g.line}` : null, lastAt: iso(g.last), id: groupId(g),
    }));
  return {
    total: s.total - e.total,
    // The log is newest first: a full log since `start` holds nothing of the week before (unknown, not 0).
    prevTotal: fromStart.total >= EMAX ? null : p.total - s.total,
    informational: s.infoTotal - e.infoTotal,
    groups,
    capped: fromPrev.total >= EMAX, // reports were dropped: prevTotal (and total, if it reached EMAX) is a floor
  };
}

async function getJson(f, url, secret, what) {
  // redirect 'manual': the bearer is never replayed to another URL, and a moved endpoint shows as 3xx
  const r = await f(url, { redirect: 'manual', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${what} HTTP ${r.status}${r.status === 401 ? ' (CRON_SECRET does not match the Vercel one)' : ''}`);
  const body = await r.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new Error(`${what}: not JSON`);
  return body;
}

export async function collect(ctx) {
  const { env, week } = ctx;
  if (!env.CRON_SECRET) return { skipped: 'missing CRON_SECRET' };
  const base = (env.CURB_BASE || BASE).replace(/\/+$/, '');
  const now = ctx.now ?? Date.now();
  const read = (path, what) => getJson(ctx.fetch, base + path, env.CRON_SECRET, what);
  const [alerts, errors] = await Promise.all([
    read('/api/send-notifications?status=1', 'alerts status').then((s) => summarizeAlerts(s, now))
      .catch((e) => ({ error: e.message })),
    Promise.all([week.prevStart, week.start, week.end].map((t) => read(`/api/client-error?since=${t}`, 'error log')))
      .then(([p, s, e]) => summarizeErrors(p, s, e))
      .catch((e) => ({ error: e.message })),
  ]);
  if (alerts.error && errors.error) throw new Error(`${alerts.error}; ${errors.error}`);
  return { alerts, errors };
}
