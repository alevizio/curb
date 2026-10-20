#!/usr/bin/env node
// Files the requests from "Request a city" on curb.guide/cities (api/city-request.js) as public GitHub issues on this repo.
// Run by .github/workflows/city-requests.yml every 30 minutes:
//   one issue per city, titled "City request: Portland, OR" and labeled "city request", its body the city, the region, the
//   answer to "does your city publish its schedule?" and the data link as plain text: never the email (the GET this reads
//   leaves emails out), the IP (never stored) or any free text. A request for a city with an open issue adds a "+1" comment
//   to it instead of a second issue.
// What was filed is remembered between runs (--memory, kept in the Actions cache like winter-watch.yml), and every issue and
// comment carries its request's id (<!-- city-request-id … -->), so a request is never filed twice, even if the cache is lost.
//
//   node scripts/cities/city-requests.mjs --memory .city-requests/memory.json [--dry-run]
//   node scripts/cities/city-requests.mjs --dry-run --requests <file.json> --issues <file.json>   (fixtures: no network at all)
// Env: CRON_SECRET (reads GET /api/city-request), GITHUB_TOKEN + GITHUB_REPOSITORY (files the issues), CITY_REQUESTS_SITE
// (default https://curb.guide). --dry-run prints what it would file and files, comments and remembers nothing.
import fs from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LABEL = 'city request';
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .,'’()-]*$/u;   // api/city-request.js lets only these through; checked again here
const ANSWER = { yes: 'Yes', no: 'No', unsure: 'Not sure' };
const KEEP = 500;               // request ids remembered
const COLD_START_MS = 2 * 3600e3;   // with no memory (first run, lost cache): the last two hours
const OVERLAP_MS = 3600e3;      // each read starts an hour before the newest request seen (late writes); ids skip repeats

// US states, DC and the Canadian provinces and territories, by name and by postal code → the code
const PLACES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia', PR: 'Puerto Rico',
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
  ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', NT: 'Northwest Territories', NU: 'Nunavut', YT: 'Yukon',
};
const plain = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\p{L}]+/gu, ' ').trim();
const BY_NAME = Object.fromEntries(Object.entries(PLACES).map(([code, n]) => [plain(n), code]));
Object.assign(BY_NAME, { 'washington dc': 'DC', 'washington d c': 'DC', 'd c': 'DC', 'quebec province': 'QC', 'newfoundland': 'NL', 'labrador': 'NL' });
const COUNTRY_US = new Set(['us', 'usa', 'u s', 'u s a', 'united states', 'united states of america', 'america']);

/** A region as a state or province code (US, Canada), '' for the US itself or nothing, else its words, tidied. */
export function regionCode(region) {
  const p = plain(region);
  if (!p || COUNTRY_US.has(p)) return '';
  const up = String(region).trim().toUpperCase().replace(/\./g, '');
  if (PLACES[up]) return up;
  if (BY_NAME[p]) return BY_NAME[p];
  // "Portland, Oregon, USA" style: a known state or province among the words
  const parts = String(region).split(',').map((x) => plain(x)).filter((x) => x && !COUNTRY_US.has(x));
  for (const x of parts) { const u = x.toUpperCase(); if (PLACES[u]) return u; if (BY_NAME[x]) return BY_NAME[x]; }
  return parts.join(', ');
}
/** A city's name for matching: no accents, case or punctuation, and Saint / St. / Ste. the same. */
export function cityKey(city) {
  return plain(city).split(' ').map((w) => ({ st: 'saint', ste: 'sainte', ft: 'fort', mt: 'mount' }[w] || w)).join(' ');
}
export const keyOf = (req) => `${cityKey(req.city)}|${regionCode(req.region)}`;
// a name typed all in small letters gets capitals ("new york" → "New York"); anything else stays as typed
const tidy = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t === t.toLowerCase() ? t.replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : t; };
/** "Portland, OR" (a US state or Canadian province as its code), "Lyon, France", or just the city. */
export function placeName(req) {
  const code = regionCode(req.region), city = tidy(req.city);
  if (code && PLACES[code]) return `${city}, ${code}`;
  return code ? `${city}, ${tidy(req.region)}` : city;
}
export const titleOf = (req) => `City request: ${placeName(req)}`;

/** Whether a request is one this script may file: an id, a city and region of letters, a known answer, an https link. */
export function fileable(req) {
  return !!req && typeof req.id === 'string' && /^[0-9a-f-]{8,64}$/i.test(req.id) && typeof req.city === 'string' && req.city.length <= 60
    && NAME.test(req.city) && (!req.region || (String(req.region).length <= 60 && NAME.test(req.region))) && !!ANSWER[req.publishes || 'unsure']
    && (!req.link || (/^https:\/\/[^\s`<>"'\\]+$/.test(req.link) && req.link.length <= 300));
}
const facts = (req) => [
  `- City: ${tidy(req.city)}`,
  `- State, province or country: ${req.region ? tidy(req.region) : 'not given'}`,
  `- Does the city publish its street sweeping or parking schedule? ${ANSWER[req.publishes || 'unsure']}`,
  `- Link to that data: ${req.link ? '`' + req.link + '`' : 'none given'}`,
].join('\n');
const idMark = (req) => `<!-- city-request-id ${req.id} -->`;

/** The new issue for a city: its facts, how +1s work, and the markers (the city's key, the request's id). */
export function issueBody(req) {
  return `Someone asked for CURB in **${placeName(req)}** with the form on [curb.guide/cities](https://curb.guide/cities).

${facts(req)}

Each later request for this city adds a "+1" comment here. An email a requester leaves stays private: CURB uses it only to say when the city is live.

<!-- city-request key="${keyOf(req)}" -->
${idMark(req)}`;
}
/** A "+1" comment on a city's open issue. */
export const plusOneBody = (req) => `+1: another request for **${placeName(req)}**.

${facts(req)}

${idMark(req)}`;

/** An open issue's city key: from its marker, else from a title like "City request: Portland, OR". */
export function issueKey(issue) {
  const m = /<!-- city-request key="([^"]*)" -->/.exec(issue.body || '');
  if (m) return m[1];
  const t = /^City request: (.+?)(?:, (.+))?$/.exec(issue.title || '');
  return t ? keyOf({ city: t[1], region: t[2] || '' }) : null;
}
/** The open issue a request belongs to: the same city and region, or the same city when one of them names no region and
 *  only one issue has that city. */
export function findIssue(issues, req) {
  const k = keyOf(req), [city, region] = k.split('|');
  const hit = issues.find((i) => i.key === k);
  if (hit) return hit;
  const same = issues.filter((i) => i.key && i.key.split('|')[0] === city);
  return same.length === 1 && (!region || !same[0].key.split('|')[1]) ? same[0] : null;
}

/**
 * File the requests: each one not yet filed opens its city's issue or adds a +1 to it. `gh(method, path, body)` is the
 * GitHub REST API (a fake in tests); `memory` = { since, seen } from the last run, updated in place.
 * Returns what it did: [{ type: 'create' | 'comment' | 'skip', id, issue?, title? }].
 */
export async function fileRequests({ requests, gh, memory, dryRun = false, log = () => {} }) {
  const seen = new Set(memory.seen || []), cold = !seen.size;   // cold: no memory (a first run, or the cache was lost)
  const done = [], made = new Set();   // made: the issues this run opened (no comments to read yet)
  let issues = null;   // the open "city request" issues, read once, when there is something to file
  const comments = new Map();   // issue number → its comments' bodies, read when a request might be filed already
  const filed = (issue, req) => `${issue.body || ''}\n${(comments.get(issue.number) || []).join('\n')}`.includes(idMark(req));
  for (const req of [...requests].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    if (!fileable(req)) { log(`skip a request that doesn't pass the checks (${String(req && req.id).slice(0, 8)})`); done.push({ type: 'skip', id: req && req.id }); continue; }
    if (seen.has(req.id)) continue;
    if (!issues) {
      issues = [];
      for (let page = 1; page < 50; page++) {
        const batch = await gh('GET', `/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`);
        issues.push(...batch.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, body: i.body || '', key: issueKey(i) })));
        if (batch.length < 100) break;
      }
    }
    const issue = findIssue(issues, req);
    if (issue && cold && !made.has(issue) && !comments.has(issue.number)) {
      // without memory, read the issue's comments, so a request filed before the memory was lost isn't filed again
      const list = await gh('GET', `/issues/${issue.number}/comments?per_page=100`);
      comments.set(issue.number, list.map((c) => c.body || ''));
    }
    if (issue && filed(issue, req)) { seen.add(req.id); continue; }
    if (issue) {
      log(`${dryRun ? 'would comment' : 'comment'} +1 on #${issue.number} (${issue.title})`);
      if (!dryRun) await gh('POST', `/issues/${issue.number}/comments`, { body: plusOneBody(req) });
      done.push({ type: 'comment', id: req.id, issue: issue.number, body: plusOneBody(req) });
    } else {
      const title = titleOf(req), body = issueBody(req);
      log(`${dryRun ? 'would open' : 'open'} "${title}"`);
      let number = 0;
      if (!dryRun) {
        if (!done.some((d) => d.type === 'create')) await gh('POST', '/labels', { name: LABEL, color: '0E8A16', description: 'A city someone asked CURB to map (curb.guide/cities)' }).catch(() => {});
        number = (await gh('POST', '/issues', { title, body, labels: [LABEL] })).number;
      }
      const opened = { number, title, body, key: keyOf(req) };
      issues.push(opened); made.add(opened);   // a second request for the same city this run: a +1 on it
      done.push({ type: 'create', id: req.id, title, body, issue: number });
    }
    seen.add(req.id);
    memory.since = Math.max(memory.since || 0, req.ts || 0);
  }
  memory.seen = [...seen].slice(-KEEP);
  return done;
}

/** The GitHub REST API for this repo, with the workflow's token. */
export function github(token, repo) {
  return async (method, path, body) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'curb-city-requests', 'content-type': 'application/json' },
    });
    if (method === 'POST' && path === '/labels' && r.status === 422) return null;   // the label is there already
    if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
}

const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const dryRun = args.includes('--dry-run'), memFile = opt('--memory'), reqFile = opt('--requests'), issuesFile = opt('--issues');
  const memory = memFile ? readJSON(memFile, {}) : {};
  // a dry run or a fixture run remembers nothing (the next real run must still file what it only printed)
  const remember = () => { if (memFile && !dryRun && !reqFile && !issuesFile) { fs.mkdirSync(dirname(memFile), { recursive: true }); fs.writeFileSync(memFile, JSON.stringify(memory)); } };
  let requests;
  if (reqFile) requests = readJSON(reqFile, { requests: [] }).requests || [];
  else {
    const SECRET = process.env.CRON_SECRET, SITE = (process.env.CITY_REQUESTS_SITE || 'https://curb.guide').replace(/\/+$/, '');
    if (!SECRET) { console.log('CRON_SECRET is not set: nothing read, nothing filed'); process.exit(0); }
    const since = memory.since ? memory.since - OVERLAP_MS : Date.now() - COLD_START_MS;
    try {
      const r = await fetch(`${SITE}/api/city-request?since=${since}`, { headers: { authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      requests = (await r.json()).requests || [];
      memory.fails = 0;
    } catch (e) {
      // the site is down or refused: say so after an hour (3 runs in a row), then about every 6 hours, not on every run
      memory.fails = (memory.fails || 0) + 1;
      remember();
      console.log(`couldn't read the requests (${(e && e.message) || e}), ${memory.fails} runs in a row`);
      process.exit(memory.fails % 12 === 3 ? 1 : 0);
    }
  }
  console.log(`${requests.length} request(s) to look at`);
  let gh;
  if (issuesFile) {   // fixtures: the open issues from a file, and nothing ever sent
    const fixture = readJSON(issuesFile, []);
    gh = async (method, path) => {
      if (method === 'GET' && path.startsWith('/issues?')) return /page=1(&|$)/.test(path) ? fixture : [];
      if (method === 'GET') return [];
      throw new Error('a fixture run never writes');
    };
  } else {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
    if ((!GITHUB_TOKEN || !GITHUB_REPOSITORY) && requests.length) throw new Error('reading and filing issues needs GITHUB_TOKEN and GITHUB_REPOSITORY');
    gh = github(GITHUB_TOKEN, GITHUB_REPOSITORY);
  }
  const done = await fileRequests({ requests, gh, memory, dryRun: dryRun || !!issuesFile, log: (m) => console.log(m) });
  if (dryRun || issuesFile) for (const d of done.filter((x) => x.type !== 'skip')) console.log(`\n--- ${d.type === 'create' ? d.title : `+1 on #${d.issue}`}\n${d.body}`);
  console.log(`${done.filter((d) => d.type === 'create').length} opened, ${done.filter((d) => d.type === 'comment').length} +1${dryRun ? ' (dry run: nothing sent)' : ''}`);
  remember();
}
