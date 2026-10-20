#!/usr/bin/env node
// Watches a city's news for the announcement that turns its winter rule on (Madison: a declared snow emergency or its
// first general plowing; Toronto: a Major Snowstorm Condition declared, and the release that ends it), and emails the owner
// so the switch (data/<id>/winter.json, scripts/cities/winter.mjs) flips the same day. Run by
// .github/workflows/winter-watch.yml in season (Madison every two hours, Toronto every 30 minutes); it never flips the switch.
//
//   node scripts/cities/winter-watch.mjs madison|toronto --seen .winter-watch/seen.json [--dry-run] [--test]
//
// --seen: the announcements already emailed (kept between runs in the Actions cache), so each is emailed once.
// --dry-run: print the email, send nothing, remember nothing. --test: email a sample notice now (to check delivery).
// --listing <file> --today YYYY-MM-DD: read a saved news page as of that day (with --dry-run: a past storm, offline but for
// the releases' leads).
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
  // toronto.ca/news lists releases as a table (absolute links, "Feb 10, 2026"); each one worth a look is read for its lead
  // (the page's description), which says whether it declares a Major Snowstorm Condition or ends one. Every winter from
  // 2022 to 2026 the City said both in releases like these (scripts/cities/winter-watch.test.mjs has them).
  toronto: { name: 'Toronto', site: 'https://www.toronto.ca', news: 'https://www.toronto.ca/news/',
    words: /snow ?storm|snow route|major snow|snow event|winter storm/i,
    reason: 'Toronto declared a Major Snowstorm Condition.',
    items: tableItems, classify: (item) => snowstormKind(item.title, item.lead), mail: torontoEmail },
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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const plain = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;| /g, ' ').replace(/&#8211;|&ndash;/g, '–').replace(/&hellip;/g, '…').replace(/\s+/g, ' ').trim();
/** A "Feb 10, 2026" or "February 10, 2026" date → "2026-02-10", or null. */
export function isoDate(s) {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s).trim());
  const mo = m && MONTHS.indexOf(m[1].toLowerCase());
  return m && mo >= 0 ? `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}
/** toronto.ca's news listing (a table: link and title, date, type) → { href, date, title, type }, newest first. */
export function tableItems(html) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/<td>\s*<a\s[^>]*href="(https:\/\/www\.toronto\.ca\/news\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g)) {
    const date = isoDate(plain(m[3])), title = plain(m[2]);
    if (!date || !title || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ href: m[1], date, title, type: plain(m[4]) });
  }
  return out;
}
const NEWS_HEAD = /^News Release\s+[A-Za-z]+ \d{1,2}, \d{4}\s*/;   // the line a release's lead starts with
/** A release page's lead: its description, the first lines of the release ("News Release January 15, 2026 The City ..."). */
export const releaseLead = (html) => { const m = /<meta name="description" content="([^"]*)"/.exec(String(html)); return m ? plain(m[1]).replace(NEWS_HEAD, '') : ''; };
/** What a Toronto release says of a Major Snowstorm Condition, by its title, then its lead: 'declared', 'ended', or
 *  'mentions' (snow routes or a storm, neither declared nor ended). */
export function snowstormKind(title, lead = '') {
  title = plain(title); lead = plain(lead).replace(NEWS_HEAD, '');
  const ended = (s) => /\b(declarations?|condition)\b[^.]{0,120}?\b(end|ends|ending|ended|lifted|cancell?ed|terminated)\b/i.test(s);
  const declared = (s) => /\b(declares?|declaring|declared|activates?|activating)\b[^.]{0,100}?\bmajor snow ?storm condition/i.test(s)
    || /\bmajor snow ?storm condition\b[^.]{0,80}?\bdeclared\s*$/i.test(s);
  const declaredLead = (s) => /\b(is declaring|has declared|declares|declaring a|declared a)\b[^.]{0,100}?\bmajor snow ?storm condition/i.test(s);
  if (ended(title)) return 'ended';
  if (declared(title)) return 'declared';
  if (ended(lead.split('.')[0] + '.')) return 'ended';
  if (declaredLead(lead.split('.')[0] + '.')) return 'declared';
  return 'mentions';
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

/** Toronto's email: what each release says (declared, ended, or a mention), and the command for the switch. */
export function torontoEmail(city, items, { state }) {
  const kinds = new Set(items.map((i) => i.kind));
  const on = `node scripts/cities/winter.mjs ${city.id} on --reason "${city.reason}"`, off = `node scripts/cities/winter.mjs ${city.id} waiting`;
  const head = kinds.has('declared') ? 'Toronto declared a Major Snowstorm Condition' : kinds.has('ended') ? 'Toronto ended its Major Snowstorm Condition'
    : 'Toronto mentions snow routes';
  const subject = items.length === 1 ? `${head}: ${items[0].title}` : `${head} (${items.length} releases)`;
  const said = { declared: 'Declares a Major Snowstorm Condition.', ended: 'Ends the Major Snowstorm Condition.', mentions: 'Mentions snow routes or a storm; declares and ends nothing, as CURB reads it.' };
  const lines = items.map((i) => `${i.title} (${i.date})\n${i.href}\n${said[i.kind] || said.mentions}${i.lead ? `\n"${i.lead}"` : ''}`);
  const what = kinds.has('declared')
    ? `To turn the snow route rule on, tell Claude "Toronto winter on", or run\n${on}\n(add --from YYYY-MM-DD when it starts on a later day)`
    : kinds.has('ended') ? `To turn the snow route rule off, tell Claude "Toronto winter off", or run\n${off}` : 'Nothing to switch unless a release declares or ends one.';
  const text = `The City of Toronto posted:\n\n${lines.join('\n\n')}\n\nCURB's switch says "${state}". ${what}\nthen commit and push data/${city.id}/winter.json: the page and the alerts follow the deploy.\n\nCURB winter watch, curb.guide/${city.id}`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p>The City of Toronto posted:</p><ul>${items.map((i) => `<li><a href="${esc(i.href)}">${esc(i.title)}</a> (${esc(i.date)})<br><b>${esc(said[i.kind] || said.mentions)}</b>${i.lead ? `<br>${esc(i.lead)}` : ''}</li>`).join('')}</ul>`
    + `<p>CURB's switch says <b>${esc(state)}</b>.</p><pre>${esc(what)}</pre><p>then commit and push <code>data/${esc(city.id)}/winter.json</code>: the page and the alerts follow the deploy.</p>`
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
  // --listing <file> reads a saved news page instead (with --today, the date it was saved: a dry run of a past storm)
  const listing = opt('--listing'), today = (listing && opt('--today')) || cityToday(cfg.tz || 'America/Chicago');
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
  if (test) items = [{ href: watch.items ? watch.news : '/news', date: today, title: 'Test: the CURB winter watch can reach you', kind: 'mentions' }];
  else {
    let found = [];
    const read = watch.items || newsItems;
    try {
      if (listing) found = read(fs.readFileSync(listing, 'utf8'));
      else {
        const r = await fetch(watch.news, { headers: { 'user-agent': 'CURB winter watch (curb.guide)' }, signal: AbortSignal.timeout(20000) });
        if (r.ok) found = read(await r.text());
      }
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
    // a city whose releases say more than their titles (Toronto): read each one's lead, and what it says of the rule
    if (watch.classify) for (const i of items) {
      try {
        const r = await fetch(i.href, { headers: { 'user-agent': 'CURB winter watch (curb.guide)' }, signal: AbortSignal.timeout(20000) });
        if (r.ok) i.lead = releaseLead(await r.text());
      } catch (e) { console.log(`${id}: release unreachable, read by its title (${(e && e.message) || e})`); }
      i.kind = watch.classify(i);
    }
    console.log(`${id}: ${found.length} news items, ${items.length} to email${watch.classify ? items.map((i) => ` [${i.kind}] ${i.title}`).join('') : ''}`);
  }
  if (items.length) {
    const msg = (watch.mail || email)(city, items, { site: watch.site, state });
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
