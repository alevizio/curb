#!/usr/bin/env node
// Watches a city's news for the announcement that turns its winter rule on (Madison: a declared snow emergency or its
// first general plowing), and emails the owner so the switch (data/<id>/winter.json, scripts/cities/winter.mjs) flips
// the same day. Run by .github/workflows/winter-watch.yml a few times a day in season; it never flips the switch.
//
//   node scripts/cities/winter-watch.mjs madison --seen .winter-watch/seen.json [--dry-run] [--test]
//
// --seen: the announcements already emailed (kept between runs in the Actions cache), so each is emailed once.
// --dry-run: print the email, send nothing, remember nothing. --test: email a sample notice now (to check delivery).
// Sending needs GMAIL_USER, GMAIL_APP_PASSWORD and WATCH_TO (comma separated), like the weekly report.
import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildEml, sendEml } from '../weekly/send.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// Per city: its news listing and the words of an announcement worth a look. Over-matching costs an email; missing one
// costs a night of alerts, so the words are broad (a reminder about winter parking also matches).
export const WATCH = {
  madison: { name: 'Madison', site: 'https://www.cityofmadison.com', news: 'https://www.cityofmadison.com/news',
    words: /snow emergenc|general plow|plowing operation|alternate side|winter parking/i,
    reason: 'Madison declared a snow emergency.' },
};
const DAYS_BACK = 3;   // a notice older than this is not news any more (and a lost cache can't resend old ones)
const KEEP = 200;      // announcements remembered

/** The news listing's items: { href, date, title }, newest first as the page lists them. */
export function newsItems(html) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/<a\s[^>]*href="(\/news\/(\d{4}-\d{2}-\d{2})\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = m[3].replace(/<[^>]+>/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ href: m[1], date: m[2], title });
  }
  return out;
}

/** The items to email: worth a look, recent, and not emailed yet. */
export function toEmail(items, { words, today, seen = [] }) {
  const since = new Date(Date.parse(today + 'T12:00:00Z') - DAYS_BACK * 864e5).toISOString().slice(0, 10);
  return items.filter((i) => i.date >= since && !seen.includes(i.href) && words.test(i.title + ' ' + i.href));
}

/** The email: subject, plain text and HTML. */
export function email(city, items, { site, state }) {
  const flip = `node scripts/cities/winter.mjs ${city.id} on --reason "${city.reason}"`;
  const subject = items.length === 1 ? `${city.name}: ${items[0].title}` : `${city.name}: ${items.length} winter parking notices`;
  const lines = items.map((i) => `${i.title} (${i.date})\n${site}${i.href}`);
  const text = `The City of ${city.name} posted:\n\n${lines.join('\n\n')}\n\n`
    + `CURB's switch says "${state}". If this turns alternate side parking on, tell Claude "${city.name} winter on", or run\n`
    + `${flip}\nthen commit and push data/${city.id}/winter.json: the page and the alerts follow the deploy.\n\nCURB winter watch, curb.guide/${city.id}`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p>The City of ${esc(city.name)} posted:</p><ul>${items.map((i) => `<li><a href="${esc(site + i.href)}">${esc(i.title)}</a> (${esc(i.date)})</li>`).join('')}</ul>`
    + `<p>CURB's switch says <b>${esc(state)}</b>. If this turns alternate side parking on, tell Claude "${esc(city.name)} winter on", or run</p>`
    + `<pre>${esc(flip)}</pre><p>then commit and push <code>data/${esc(city.id)}/winter.json</code>: the page and the alerts follow the deploy.</p>`
    + `<p style="color:#4A4536">CURB winter watch, <a href="https://curb.guide/${esc(city.id)}">curb.guide/${esc(city.id)}</a></p>`;
  return { subject, text, html };
}

// The city's date today, "YYYY-MM-DD".
const cityToday = (tz, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [id, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const dryRun = rest.includes('--dry-run'), test = rest.includes('--test');
  const watch = WATCH[id];
  if (!watch) { console.error(`usage: node scripts/cities/winter-watch.mjs <${Object.keys(WATCH).join('|')}> --seen <file> [--dry-run] [--test]`); process.exit(2); }
  const city = { id, ...watch }, cfg = readJSON(`${ROOT}data/${id}/city.json`, {});
  const state = readJSON(`${ROOT}data/${id}/winter.json`, {}).state || 'waiting';
  const today = cityToday(cfg.tz || 'America/Chicago');
  const W = cfg.winter;
  // in season only: from a week before its first night to its last (a test or a dry run works any day)
  const opens = W && new Date(Date.parse(W.from + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10);
  if (!test && !dryRun && (!W || today < opens || today > W.to)) { console.log(`${id}: outside the season (${opens} to ${W && W.to}), nothing to watch`); process.exit(0); }

  const seenFile = opt('--seen');
  const memory = seenFile ? readJSON(seenFile, { seen: [], fails: 0 }) : { seen: [], fails: 0 };
  // a real check keeps what it emailed and how many reads failed in a row; a test or a dry run keeps nothing
  const remember = () => {
    if (!seenFile || dryRun || test) return;
    fs.mkdirSync(dirname(seenFile), { recursive: true });
    fs.writeFileSync(seenFile, JSON.stringify(memory));
  };
  let items;
  if (test) items = [{ href: '/news', date: today, title: 'Test: the CURB winter watch can reach you' }];
  else {
    let found = [];
    try {
      const r = await fetch(watch.news, { headers: { 'user-agent': 'CURB winter watch (curb.guide)' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) found = newsItems(await r.text());
    } catch (e) { console.log(`${id}: news page unreachable (${(e && e.message) || e})`); }
    if (!found.length) {
      // the page is down or its layout changed: say so after 6 hours (3 runs), then once a day, not on every run
      memory.fails = (memory.fails || 0) + 1;
      remember();
      console.log(`${id}: no news items read (${memory.fails} runs in a row)`);
      process.exit(memory.fails % 12 === 3 ? 1 : 0);
    }
    memory.fails = 0;
    items = toEmail(found, { words: watch.words, today, seen: memory.seen });
    console.log(`${id}: ${found.length} news items, ${items.length} to email`);
  }
  if (items.length) {
    const msg = email(city, items, { site: watch.site, state });
    const rcpts = String(process.env.WATCH_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
    const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
    if (dryRun) console.log(`dry run, not sent:\n${msg.subject}\n\n${msg.text}`);
    else {
      if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !rcpts.length) throw new Error('sending needs GMAIL_USER, GMAIL_APP_PASSWORD and WATCH_TO');
      await sendEml(buildEml({ from: `CURB winter watch <${GMAIL_USER}>`, to: rcpts, ...msg }), { user: GMAIL_USER, password: GMAIL_APP_PASSWORD, rcpts });
      console.log(`${id}: emailed ${items.length} notice(s)`);
    }
  }
  memory.seen = [...items.map((i) => i.href), ...memory.seen].slice(0, KEEP);
  remember();
}
