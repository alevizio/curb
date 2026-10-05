// Weekly report source: what happened on GitHub (alevizio/curb) during the report week, from the REST API.
//  - shipped: the non-merge commits that LANDED on main in the window. main takes --no-ff merges
//    ("Merge claude/x: ..."), and a branch commit can be written days before its merge (dependabot's Sep 27
//    bumps landed Oct 4), so filtering by commit date would report it in the wrong week, or never. Instead
//    the commits of the last LOOKBACK_DAYS are listed from main and each one is dated by the first-parent
//    commit (merge or direct push) that brought it in. Merges themselves are dropped.
//  - issues: opened / closed in the window (pull requests skipped), every open issue, and the open
//    monitor alerts (label monitor:*, opened by scripts/monitor/alert.mjs).
//  - runs: monitor.yml and verify.yml runs created in the window, and the latest data-refresh.yml run.
//  - repo: stars, forks and stars gained in the window. Since Jul 2026 GitHub lists stargazers (with
//    starred_at) only to admins and collaborators; when that list is refused the count comes from
//    /stargazers/history, GitHub's per-day star counts (its day buckets matched SF days for all 10 of
//    CURB's stars, checked Oct 2026).
//
//   import { collect } from './sources/github.mjs'; const section = await collect({ week, env, fetch, now })
// Env: GITHUB_TOKEN (required; Actions provides it), GITHUB_REPOSITORY (default alevizio/curb).
// Issue titles come from the public repo, so they are safe to show; nothing here is logged.

export const LOOKBACK_DAYS = 30;  // branch commits written up to this long before their merge are still found
export const MAX_SHIPPED = 15;    // commits listed (shippedCount and shippedByType cover all of them)
export const MAX_PAGES = 10;      // per listing: the runs API returns at most 1000 results per query anyway
export const MAX_COMMIT_PAGES = 20; // ~37 days of main at ~120 commits a week is about 6 pages
export const COMMIT_TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'chore', 'test', 'data', 'other'];
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const API = 'https://api.github.com';
const UA = 'curb-weekly-report (+https://github.com/alevizio/curb)';
const DAY = 86400000;

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const inWeek = (t, week) => { const ms = Date.parse(t); return ms >= week.start && ms < week.end; };
const firstLine = (msg) => String(msg || '').split('\n')[0].trim();
const labelNames = (issue) => (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const isBot = (user) => user?.type === 'Bot' || /\[bot\]$/.test(user?.login || '');

/** Pure: conventional-commit type of a subject. "feat(ui): x" → feat, "docs+fix: x" → docs, unknown → other.
 *  The monthly data refresh (chore(data), or any refresh commit by github-actions[bot]) counts as data. */
export function commitType(subject, author = '') {
  const s = String(subject || '');
  if (/^chore\(data\b/i.test(s) || (author === 'github-actions[bot]' && /refresh|data/i.test(s))) return 'data';
  const t = /^([a-z]+)[^\s:]*:/i.exec(s)?.[1].toLowerCase();
  return COMMIT_TYPES.includes(t) ? t : 'other';
}

/** Pure: commits listed from main (API objects) → the non-merge ones that landed in the week, each with
 *  `at` = epoch ms of the first-parent commit that brought it onto main, newest landing first. */
export function landedCommits(commits, week) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const isParent = new Set(commits.flatMap((c) => (c.parents || []).map((p) => p.sha)));
  const tip = commits.find((c) => !isParent.has(c.sha)) || commits[0]; // main's head: nobody's parent
  const chain = [];
  for (let c = tip; c && chain.length <= commits.length; c = bySha.get(c.parents?.[0]?.sha)) chain.push(c);
  // Oldest first, so each commit is claimed by the merge that first brought it in. A side branch's walk
  // stops at claimed commits: older main commits and anything an earlier merge already landed.
  const claimed = new Set();
  const out = [];
  for (const m of chain.reverse()) {
    const at = Date.parse(m.commit?.committer?.date);
    const stack = [m];
    while (stack.length) {
      const c = stack.pop();
      if (!c || claimed.has(c.sha)) continue;
      claimed.add(c.sha);
      if ((c.parents || []).length < 2 && at >= week.start && at < week.end) out.push({ commit: c, at });
      for (const p of (c === m ? (m.parents || []).slice(1) : c.parents || [])) stack.push(bySha.get(p.sha));
    }
  }
  const date = (x) => Date.parse(x.commit.commit?.committer?.date) || 0;
  return out.sort((a, b) => b.at - a.at || date(b) - date(a));
}

/** Pure: commits listed from main → the shipped part of the section. */
export function summarizeShipped(commits, week, max = MAX_SHIPPED) {
  const all = landedCommits(commits, week).map(({ commit: c, at }) => {
    const subject = firstLine(c.commit?.message);
    return {
      sha: c.sha.slice(0, 7), subject, type: commitType(subject, c.author?.login || c.commit?.author?.name),
      date: c.commit?.committer?.date ?? null, landedAt: iso(at), url: c.html_url,
    };
  });
  const shippedByType = Object.fromEntries(COMMIT_TYPES.map((t) => [t, 0]));
  for (const c of all) shippedByType[c.type]++;
  return { shipped: all.slice(0, max), shippedCount: all.length, shippedByType };
}

/** Pure: issues updated since prevStart + every open issue → the issues part (pull requests skipped). */
export function summarizeIssues(recent, open, week) {
  const real = (list) => list.filter((i) => !i.pull_request);
  const card = (i) => {
    const labels = labelNames(i);
    return { number: i.number, title: i.title, url: i.html_url, labels, automated: labels.some((l) => l.startsWith('monitor:')) || isBot(i.user) };
  };
  const stillOpen = real(open);
  return {
    opened: real(recent).filter((i) => inWeek(i.created_at, week)).map(card),
    closed: real(recent).filter((i) => i.state === 'closed' && i.closed_at && inWeek(i.closed_at, week))
      .map((i) => ({ ...card(i), closedAt: i.closed_at })),
    open: stillOpen.map((i) => ({ ...card(i), createdAt: i.created_at })),
    alertsOpen: stillOpen.filter((i) => labelNames(i).some((l) => l.startsWith('monitor:')))
      .map((i) => ({ number: i.number, title: i.title, url: i.html_url, label: labelNames(i).find((l) => l.startsWith('monitor:')), createdAt: i.created_at })),
  };
}

/** Pure: workflow runs → { total, failed } for runs created in the week. */
export function countRuns(runs, week) {
  const mine = runs.filter((r) => inWeek(r.created_at, week));
  return { total: mine.length, failed: mine.filter((r) => FAILED.has(r.conclusion)).length };
}

/** Pure: newest-first runs → the latest one, or null. conclusion falls back to the status while it runs. */
export function latestRun(runs) {
  const r = runs[0];
  return r ? { lastAt: r.created_at, conclusion: r.conclusion ?? r.status ?? null, url: r.html_url } : null;
}

/** Pure: /stargazers/history weeks ({ week: unix s of a Sunday, days: [7 counts from Sunday] }) → stars
 *  added on the report's days. */
export function starsFromHistory(history, days) {
  const want = new Set(days);
  let n = 0;
  for (const w of history) {
    const sunday = Date.parse(new Date(w.week * 1000).toISOString().slice(0, 10) + 'T12:00:00Z');
    (w.days || []).forEach((count, i) => { if (want.has(new Date(sunday + i * DAY).toISOString().slice(0, 10))) n += Number(count) || 0; });
  }
  return n;
}

function client(ctx, token, repo) {
  async function get(path, what, headers = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await ctx.fetch(`${API}/repos/${repo}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': UA, ...headers },
        signal: ctrl.signal,
      });
      if (!r.ok) throw Object.assign(new Error(`GitHub HTTP ${r.status} (${what})`), { status: r.status });
      return await r.json();
    } finally { clearTimeout(t); }
  }
  /** Every page of a listing (100 per page) until a short page or MAX_PAGES. */
  async function all(path, what, key = null, max = MAX_PAGES) {
    const out = [];
    for (let page = 1; page <= max; page++) {
      const body = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, what);
      const items = key ? body?.[key] : body;
      if (!Array.isArray(items)) throw new Error(`GitHub ${what}: unexpected response`);
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }
  return { get, all };
}

/** Stars gained in the week: exact from the stargazer list (newest page first, it is sorted oldest
 *  first), or GitHub's daily counts when the list is refused (it is for non-collaborator tokens). */
async function starsGained(gh, stars, week) {
  const last = Math.max(1, Math.ceil(stars / 100));
  let n = 0;
  try {
    for (let page = last; page >= 1; page--) {
      if (last - page >= MAX_PAGES) return { gained: null, source: 'stargazers' }; // 1000+ new stars in a week: not counted
      const list = await gh.get(`/stargazers?per_page=100&page=${page}`, 'stargazers', { accept: 'application/vnd.github.star+json' });
      if (!Array.isArray(list)) throw new Error('GitHub stargazers: unexpected response');
      n += list.filter((s) => inWeek(s.starred_at, week)).length;
      if (list.length && Date.parse(list[0].starred_at) < week.start) break; // this page reaches back before the week
    }
    return { gained: n, source: 'stargazers' };
  } catch (e) {
    if (e.status !== 403 && e.status !== 404) throw e;
  }
  const history = await gh.get('/stargazers/history?per_page=30', 'star history', { 'x-github-api-version': '2026-03-10' });
  if (!Array.isArray(history)) throw new Error('GitHub star history: unexpected response');
  return { gained: starsFromHistory(history, week.days), source: 'history' };
}

// A sub-part that fails becomes { error } so the rest of the section still reports.
const part = (p) => p.catch((e) => ({ error: e.message || 'failed' }));
const failed = (x) => x && typeof x === 'object' && !Array.isArray(x) && 'error' in x && Object.keys(x).length === 1;

export async function collect(ctx) {
  const { week, env } = ctx;
  const token = env.GITHUB_TOKEN;
  if (!token) return { skipped: 'missing GITHUB_TOKEN' };
  const gh = client(ctx, token, env.GITHUB_REPOSITORY || 'alevizio/curb');
  const runs = (file) => `/actions/workflows/${file}/runs?exclude_pull_requests=true`;
  const created = `&created=${iso(week.start)}..${iso(week.end - 1000)}`; // the range is inclusive

  const [commits, issues, monitor, verify, dataRefresh, repo] = await Promise.all([
    part(gh.all(`/commits?sha=main&since=${iso(week.start - LOOKBACK_DAYS * DAY)}`, 'commits', null, MAX_COMMIT_PAGES)
      .then((list) => summarizeShipped(list, week))),
    part(Promise.all([gh.all(`/issues?state=all&since=${iso(week.prevStart)}`, 'issues'), gh.all('/issues?state=open', 'open issues')])
      .then(([recent, open]) => summarizeIssues(recent, open, week))),
    part(gh.all(runs('monitor.yml') + created, 'monitor runs', 'workflow_runs').then((r) => countRuns(r, week))),
    part(gh.all(runs('verify.yml') + created, 'verify runs', 'workflow_runs').then((r) => countRuns(r, week))),
    part(gh.get(`${runs('data-refresh.yml')}&per_page=1`, 'data-refresh runs').then((b) => latestRun(b?.workflow_runs || []))),
    part(gh.get('', 'repo').then(async (r) => {
      const stars = r.stargazers_count;
      const g = await part(starsGained(gh, stars, week));
      return { stars, forks: r.forks_count, starsGained: failed(g) ? g : g.gained, ...(g.source ? { starsSource: g.source } : {}) };
    })),
  ]);

  const parts = [commits, issues, monitor, verify, dataRefresh, repo];
  if (parts.every(failed)) throw new Error(commits.error); // nothing worked (a bad token, GitHub down)
  return {
    ...(failed(commits) ? { shipped: commits, shippedCount: null, shippedByType: null } : commits),
    issues,
    runs: { monitor, verify, dataRefresh },
    repo,
  };
}
