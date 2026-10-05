#!/usr/bin/env node
// CURB weekly report: the owner's Wednesday email (visits, search, the iPhone app, alerts and errors,
// what shipped, issues, mentions). Run by .github/workflows/weekly-report.yml in two steps, with the
// optional Claude web-search step (claude.mjs) in between:
//
//   node scripts/weekly/report.mjs collect --dir <dir> [--now <iso>]
//       runs every source in sources/ for the week (week.mjs) → <dir>/report.json
//   node scripts/weekly/report.mjs send --dir <dir> [--preview] [--dry-run]
//       report.json + claude.json (if the Claude step ran) → render.mjs → email to WEEKLY_TO.
//       --dry-run writes <dir>/email.html (images inlined for a browser) and <dir>/email.eml instead.
//
// Each source reads its own env vars (see the top of each file); a source without them comes back
// { skipped } and the email says "not connected yet". Sending needs GMAIL_USER, GMAIL_APP_PASSWORD
// and WEEKLY_TO (comma separated). The repo is public and so are Actions logs: this prints only
// which sections loaded, were skipped or failed, never the numbers.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reportWeek } from './week.mjs';
import { readClaude } from './claude.mjs';

// [section key, module, time limit in seconds]: search runs 50 URL inspections, so it gets longest
export const SOURCES = [
  ['visits', './sources/visits.mjs', 120],
  ['service', './sources/service.mjs', 60],
  ['github', './sources/github.mjs', 180],
  ['search', './sources/search.mjs', 300],
  ['app', './sources/app.mjs', 180],
  ['appAnalytics', './sources/app-analytics.mjs', 240],
  ['mentions', './sources/mentions.mjs', 120],
];

const short = (e) => String(e?.message || e).replace(/\s+/g, ' ').slice(0, 160);

function withTimeout(promise, secs) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${secs} s`)), secs * 1000); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** Every source in parallel; one failing, hanging or missing module never stops the others. */
export async function collectAll(ctx, sources = SOURCES, load = (path) => import(new URL(path, import.meta.url))) {
  const sections = {};
  await Promise.all(sources.map(async ([key, path, secs]) => {
    try { sections[key] = await withTimeout(Promise.resolve().then(async () => (await load(path)).collect(ctx)), secs); }
    catch (e) { sections[key] = { error: short(e) }; }
  }));
  return sections;
}

/** One log word per section, plus its sub-parts that were skipped or failed (no data). */
export function status(section) {
  if (!section || typeof section !== 'object') return 'missing';
  if (section.skipped) return `skipped (${section.skipped})`;
  if (section.error) return `error (${section.error})`;
  const parts = Object.entries(section)
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && (v.skipped || v.error))
    .map(([k, v]) => `${k} ${v.skipped ? 'skipped' : 'error'}`);
  return parts.length ? `ok (${parts.join(', ')})` : 'ok';
}

// Every request gets a time limit unless the caller set its own signal.
const timedFetch = (url, opts = {}) => fetch(url, { signal: AbortSignal.timeout(45000), ...opts });

async function collect(dir, now) {
  const week = reportWeek(now);
  const sections = await collectAll({ week, env: process.env, fetch: timedFetch, now });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ generatedAt: new Date(now).toISOString(), week, sections }));
  for (const [key] of SOURCES) console.log(`${key}: ${status(sections[key])}`);
}

async function send(dir, { preview, dryRun }) {
  const { renderEmail } = await import('./render.mjs');
  const { buildEml, sendEml } = await import('./send.mjs');
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  report.preview = preview;
  report.sections.claude = readClaude(dir);
  console.log(`claude: ${status(report.sections.claude)}`);

  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  const rcpts = String(process.env.WEEKLY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!dryRun && (!GMAIL_USER || !GMAIL_APP_PASSWORD || !rcpts.length)) throw new Error('sending needs GMAIL_USER, GMAIL_APP_PASSWORD and WEEKLY_TO');

  const email = await renderEmail(report);
  const eml = buildEml({ from: `CURB weekly <${GMAIL_USER || 'curb@example.com'}>`, to: rcpts.length ? rcpts : ['owner@example.com'], ...email });
  if (dryRun) {
    let html = email.html;
    for (const img of email.images) html = html.replaceAll(`cid:${img.cid}`, `data:${img.type};base64,${img.data.toString('base64')}`);
    writeFileSync(join(dir, 'email.html'), html);
    writeFileSync(join(dir, 'email.eml'), eml);
    console.log(`dry run: ${join(dir, 'email.html')} (${Math.round(Buffer.byteLength(email.html) / 1024)} KB html, ${email.images.length} images)`);
    return;
  }
  await sendEml(eml, { user: GMAIL_USER, password: GMAIL_APP_PASSWORD, rcpts });
  console.log(`sent (${Math.round(Buffer.byteLength(email.html) / 1024)} KB html, ${email.images.length} images)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = opt('--dir');
  if (!dir || !['collect', 'send'].includes(args[0])) {
    console.error('usage: report.mjs collect|send --dir <dir> [--now <iso>] [--preview] [--dry-run]');
    process.exit(2);
  }
  const now = opt('--now') ? Date.parse(opt('--now')) : Date.now();
  try {
    if (args[0] === 'collect') await collect(dir, now);
    else await send(dir, { preview: args.includes('--preview'), dryRun: args.includes('--dry-run') });
  } catch (e) {
    console.error(`weekly report: ${short(e)}`);
    process.exit(1);
  }
  process.exit(0); // a source that timed out may still hold a socket open: don't wait for it
}
