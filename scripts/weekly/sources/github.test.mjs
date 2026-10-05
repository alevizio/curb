// Tests for the weekly GitHub source (github.mjs) against mocked fetch: commits dated by when they landed
// on main (not when they were written), issue and run windows, the stargazer walk and its history fallback.
import { describe, it, expect } from 'vitest';
import { collect, commitType, landedCommits, summarizeShipped, summarizeIssues, countRuns, latestRun, starsFromHistory, LOOKBACK_DAYS } from './github.mjs';
import { reportWeek } from '../week.mjs';

const NOW = Date.parse('2026-10-07T15:07:00Z'); // Wed Oct 7, 8:07 AM PDT
const WEEK = reportWeek(NOW);                   // Sep 30 to Oct 6
const TOKEN = 'test-token-value';
const H = 3600e3;
const at = (h) => new Date(WEEK.start + h * H).toISOString();
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const full = (s) => s.padEnd(40, '0');
const commit = (sha, h, subject, parents = [], login = 'alevizio') => ({
  sha: full(sha), html_url: `https://github.com/alevizio/curb/commit/${full(sha)}`,
  parents: parents.map((p) => ({ sha: full(p) })),
  author: { login }, commit: { message: `${subject}\n\nbody text`, author: { name: login, date: at(h) }, committer: { name: login, date: at(h) } },
});

// main, newest first as the API lists it. Merges are --no-ff; b3 was written 3 days before the week but
// landed in it (M1); b6 was written in the week but landed after it (M3); claude/two was merged twice
// (b4 at M1, then b5 at M2 after merging main back in), so b4 must not count twice.
const GRAPH = [
  commit('e3', WEEK.end / H - WEEK.start / H + 2, 'Merge claude/late: after the week', ['e2', 'b6']),
  commit('b6', 100, 'fix(x): written in the week, merged after it', ['e2']),
  commit('e2', 50, 'Merge claude/two: second half', ['d1', 'b5']),
  commit('b5', 49, 'feat(ui): five', ['bm']),
  commit('bm', 48, "Merge branch 'main' into claude/two", ['b4', 'd1']),
  commit('d1', 30, 'chore(data): monthly refresh 2026-10-01', ['e1'], 'github-actions[bot]'),
  commit('e1', 10, 'Merge claude/two: first half', ['a0', 'b4']),
  commit('b4', 9, 'fix(map)+test: four', ['b3']),
  commit('b3', -72, 'docs: three', ['a0']),
  commit('a0', -120, 'feat: before the week', ['zz']),
];

function mockFetch(handler) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    const r = handler(new URL(url), opts.headers || {}) || { status: 404, body: { message: 'Not Found' } };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  f.calls = calls;
  return f;
}

describe('commit types', () => {
  it('reads the conventional type, scoped, combined or breaking', () => {
    expect(commitType('feat(ui): x')).toBe('feat');
    expect(commitType('fix: x')).toBe('fix');
    expect(commitType('docs+fix: correct README')).toBe('docs');
    expect(commitType('perf(map)+test: overview recolor')).toBe('perf');
    expect(commitType('refactor!: drop the old core')).toBe('refactor');
    expect(commitType('test(time-core): x')).toBe('test');
  });
  it('the data refresh and data: commits count as data', () => {
    expect(commitType('chore(data): monthly refresh 2026-10-01')).toBe('data');
    expect(commitType('data: rebuild schedules')).toBe('data');
    expect(commitType('chore: monthly refresh', 'github-actions[bot]')).toBe('data');
    expect(commitType('fix(data): neighborhood totals')).toBe('fix'); // a real fix that touches data
    expect(commitType('chore(deps): bump vitest', 'dependabot[bot]')).toBe('chore');
  });
  it('anything else is other', () => {
    expect(commitType('design(nav): keep the logo on phones')).toBe('other');
    expect(commitType('Fix curb side matching for address search')).toBe('other');
    expect(commitType('Merge claude/x: y')).toBe('other');
    expect(commitType('')).toBe('other');
  });
});

describe('shipped commits', () => {
  it('dates each commit by the merge or push that landed it on main, drops merges', () => {
    const got = landedCommits(GRAPH, WEEK).map((x) => [x.commit.sha.slice(0, 2), iso(x.at)]);
    expect(got).toEqual([
      ['b5', iso(WEEK.start + 50 * H)],
      ['d1', iso(WEEK.start + 30 * H)],
      ['b4', iso(WEEK.start + 10 * H)],
      ['b3', iso(WEEK.start + 10 * H)], // written before the week, shipped in it
    ]);
  });
  it('does not depend on the listing order', () => {
    const a = landedCommits(GRAPH, WEEK).map((x) => x.commit.sha);
    expect(landedCommits([...GRAPH].reverse(), WEEK).map((x) => x.commit.sha)).toEqual(a);
  });
  it('summarizes types, counts and links', () => {
    const s = summarizeShipped(GRAPH, WEEK);
    expect(s.shippedCount).toBe(4);
    expect(s.shippedByType).toEqual({ feat: 1, fix: 1, perf: 0, refactor: 0, docs: 1, chore: 0, test: 0, data: 1, other: 0 });
    expect(s.shipped[0]).toEqual({
      sha: 'b500000', subject: 'feat(ui): five', type: 'feat', date: at(49), landedAt: iso(WEEK.start + 50 * H),
      url: `https://github.com/alevizio/curb/commit/${full('b5')}`,
    });
    expect(s.shipped.map((c) => c.type)).toEqual(['feat', 'data', 'fix', 'docs']);
  });
  it('lists at most 15 but counts all of them', () => {
    const chain = Array.from({ length: 20 }, (_, i) => commit(`c${String(i).padStart(2, '0')}`, 20 - i, `fix: n${i}`, [`c${String(i + 1).padStart(2, '0')}`]));
    const s = summarizeShipped(chain, WEEK);
    expect(s.shippedCount).toBe(20);
    expect(s.shippedByType.fix).toBe(20);
    expect(s.shipped).toHaveLength(15);
    expect(s.shipped[0].subject).toBe('fix: n0'); // newest first
  });
  it('an empty week is empty', () => {
    expect(summarizeShipped([], WEEK)).toMatchObject({ shipped: [], shippedCount: 0 });
  });
});

const bot = { login: 'github-actions[bot]', type: 'Bot' };
const human = { login: 'someone', type: 'User' };
const issue = (number, extra) => ({ number, title: `issue ${number}`, html_url: `https://github.com/alevizio/curb/issues/${number}`, labels: [], user: human, state: 'open', closed_at: null, ...extra });
const RECENT = [
  issue(50, { pull_request: { url: 'x' }, created_at: at(5) }),                                                // a PR: skipped
  issue(42, { created_at: at(-200), labels: [{ name: 'monitor:errors' }], user: bot }),                         // alert, still open
  issue(41, { created_at: at(20), labels: [{ name: 'bug' }] }),                                                 // opened, still open
  issue(40, { created_at: at(3), labels: [{ name: 'monitor:site' }], user: bot, state: 'closed', closed_at: at(4) }),
  issue(39, { created_at: at(-100), state: 'closed', closed_at: at(60) }),                                      // closed in the week
  issue(38, { created_at: at(-150), state: 'closed', closed_at: at(-120) }),                                    // all last week
  issue(37, { created_at: at(-150), closed_at: at(10) }),                                                       // closed, then reopened
  issue(36, { created_at: at(170), user: { login: 'dependabot[bot]', type: 'Bot' } }),                          // after the week
];
const OPEN = [RECENT[1], RECENT[2], RECENT[6], RECENT[7], issue(24, { created_at: '2026-09-05T19:01:56Z' })];

describe('issues', () => {
  const s = summarizeIssues(RECENT, OPEN, WEEK);
  it('opened and closed in the week, pull requests skipped', () => {
    expect(s.opened.map((i) => i.number)).toEqual([41, 40]);
    expect(s.closed.map((i) => [i.number, i.closedAt])).toEqual([[40, at(4)], [39, at(60)]]);
  });
  it('flags monitor alerts and bot-opened issues as automated', () => {
    expect(s.opened.find((i) => i.number === 40)).toEqual({ number: 40, title: 'issue 40', url: 'https://github.com/alevizio/curb/issues/40', labels: ['monitor:site'], automated: true });
    expect(s.opened.find((i) => i.number === 41).automated).toBe(false);
    expect(s.open.find((i) => i.number === 36).automated).toBe(true); // dependabot, no label
  });
  it('lists every open issue and the open alerts', () => {
    expect(s.open.map((i) => i.number)).toEqual([42, 41, 37, 36, 24]);
    expect(s.open.at(-1)).toMatchObject({ number: 24, labels: [], createdAt: '2026-09-05T19:01:56Z' });
    expect(s.alertsOpen).toEqual([{ number: 42, title: 'issue 42', url: 'https://github.com/alevizio/curb/issues/42', label: 'monitor:errors', createdAt: at(-200) }]);
  });
});

const run = (h, conclusion, status = 'completed') => ({ created_at: at(h), conclusion, status, html_url: `https://github.com/alevizio/curb/actions/runs/${Math.round(h * 10)}` });

describe('workflow runs', () => {
  it('counts runs created in the week, failures and timeouts as failed', () => {
    const runs = [run(1, 'success'), run(2, 'failure'), run(3, 'timed_out'), run(4, 'cancelled'), run(5, 'startup_failure'), run(6, null, 'in_progress'), run(-1, 'failure'), run(170, 'failure')];
    expect(countRuns(runs, WEEK)).toEqual({ total: 6, failed: 3 });
  });
  it('latest run, or null when there is none', () => {
    expect(latestRun([run(-300, 'success'), run(-1000, 'failure')])).toEqual({ lastAt: at(-300), conclusion: 'success', url: 'https://github.com/alevizio/curb/actions/runs/-3000' });
    expect(latestRun([run(1, null, 'in_progress')]).conclusion).toBe('in_progress');
    expect(latestRun([])).toBeNull();
  });
});

describe('star history', () => {
  it('sums the report days out of GitHub\'s Sunday-based weeks', () => {
    const history = [
      { week: Date.parse('2026-10-04T00:00:00Z') / 1000, total: 13, days: [2, 1, 1, 9, 0, 0, 0] }, // Oct 7 (Wed) is after the week
      { week: Date.parse('2026-09-27T00:00:00Z') / 1000, total: 16, days: [5, 1, 2, 3, 0, 4, 1] }, // Sep 30 (Wed) starts it
      { week: Date.parse('2026-09-20T00:00:00Z') / 1000, total: 7, days: [1, 1, 1, 1, 1, 1, 1] },
    ];
    expect(starsFromHistory(history, WEEK.days)).toBe(3 + 0 + 4 + 1 + 2 + 1 + 1);
    expect(starsFromHistory([], WEEK.days)).toBe(0);
  });
});

// A whole repo behind one mock, routed by path and query.
const MONITOR = [...Array.from({ length: 150 }, (_, i) => run(i, i % 50 === 7 ? 'failure' : 'success')), ...Array.from({ length: 7 }, (_, i) => run(151 + i, i === 3 ? 'timed_out' : 'success'))];
const starAt = (i) => (i <= 194 ? at(-(200 - i)) : i <= 249 ? at(i - 194) : at(WEEK.end / H - WEEK.start / H + 1)); // 195..249 in the week
const STARS = Array.from({ length: 250 }, (_, k) => ({ starred_at: starAt(k + 1), user: { login: `u${k + 1}` } }));
const HISTORY = [{ week: Date.parse('2026-10-04T00:00:00Z') / 1000, total: 1, days: [1, 0, 0, 0, 0, 0, 0] }, { week: Date.parse('2026-09-27T00:00:00Z') / 1000, total: 6, days: [0, 0, 0, 2, 2, 2, 0] }];

function repoHandler({ fail = {}, refuseStars = false, repo = 'alevizio/curb' } = {}) {
  return (u, headers) => {
    const p = u.pathname.replace(`/repos/${repo}`, '');
    const q = u.searchParams;
    const page = Number(q.get('page') || 1);
    const slice = (list) => list.slice((page - 1) * 100, page * 100);
    const name = p === '' ? 'repo' : p.startsWith('/actions/workflows/') ? p.split('/')[3] : p.slice(1);
    if (fail[name]) return { status: fail[name], body: { message: 'nope' } };
    if (p === '/commits') return { body: slice(GRAPH) };
    if (p === '/issues') return { body: slice(q.get('state') === 'open' ? OPEN : RECENT) };
    if (p === '/actions/workflows/monitor.yml/runs') return { body: { total_count: MONITOR.length, workflow_runs: slice(MONITOR) } };
    if (p === '/actions/workflows/verify.yml/runs') return { body: { total_count: 2, workflow_runs: [run(1, 'success'), run(2, 'failure')] } };
    if (p === '/actions/workflows/data-refresh.yml/runs') return { body: { total_count: 9, workflow_runs: [run(25, 'success')] } };
    if (p === '') return { body: { stargazers_count: 250, forks_count: 3 } };
    if (p === '/stargazers') return refuseStars ? { status: 404, body: { message: 'Not Found' } } : headers.accept === 'application/vnd.github.star+json' ? { body: slice(STARS) } : { body: slice(STARS.map((s) => s.user)) };
    if (p === '/stargazers/history') return { body: HISTORY };
    return null;
  };
}

describe('collect', () => {
  it('skips without a token and never calls GitHub', async () => {
    const f = mockFetch(() => ({ body: [] }));
    expect(await collect({ week: WEEK, env: {}, fetch: f, now: NOW })).toEqual({ skipped: 'missing GITHUB_TOKEN' });
    expect(f.calls).toHaveLength(0);
  });

  it('builds the whole section', async () => {
    const f = mockFetch(repoHandler());
    const s = await collect({ week: WEEK, env: { GITHUB_TOKEN: TOKEN }, fetch: f, now: NOW });
    expect(s.shippedCount).toBe(4);
    expect(s.shipped.map((c) => c.sha)).toEqual(['b500000', 'd100000', 'b400000', 'b300000']);
    expect(s.shippedByType.data).toBe(1);
    expect(s.issues.opened.map((i) => i.number)).toEqual([41, 40]);
    expect(s.issues.alertsOpen.map((i) => i.number)).toEqual([42]);
    expect(s.runs).toEqual({
      monitor: { total: 157, failed: 4 },
      verify: { total: 2, failed: 1 },
      dataRefresh: { lastAt: at(25), conclusion: 'success', url: 'https://github.com/alevizio/curb/actions/runs/250' },
    });
    expect(s.repo).toEqual({ stars: 250, forks: 3, starsGained: 55, starsSource: 'stargazers' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s); // plain JSON
  });

  it('asks GitHub for the right windows, with the token and the right media types', async () => {
    const f = mockFetch(repoHandler());
    await collect({ week: WEEK, env: { GITHUB_TOKEN: TOKEN }, fetch: f, now: NOW });
    for (const c of f.calls) {
      expect(c.url.startsWith('https://api.github.com/repos/alevizio/curb')).toBe(true);
      expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
    }
    const find = (re) => f.calls.filter((c) => re.test(c.url)).map((c) => new URL(c.url));
    const [commits] = find(/\/commits\?/);
    expect(commits.searchParams.get('sha')).toBe('main');
    expect(commits.searchParams.get('since')).toBe(iso(WEEK.start - LOOKBACK_DAYS * 86400e3));
    const [recent] = find(/\/issues\?state=all/);
    expect(recent.searchParams.get('since')).toBe(iso(WEEK.prevStart));
    const monitor = find(/monitor\.yml\/runs/);
    expect(monitor.map((u) => u.searchParams.get('page'))).toEqual(['1', '2']); // 157 runs: two pages
    expect(monitor[0].searchParams.get('created')).toBe(`${iso(WEEK.start)}..${iso(WEEK.end - 1000)}`);
    const stars = f.calls.filter((c) => /\/stargazers\?/.test(c.url));
    expect(stars.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['3', '2']); // newest page first, stops once past the week
    expect(stars[0].headers.accept).toBe('application/vnd.github.star+json');
  });

  it('falls back to the star history when the stargazer list is refused', async () => {
    const f = mockFetch(repoHandler({ refuseStars: true }));
    const s = await collect({ week: WEEK, env: { GITHUB_TOKEN: TOKEN }, fetch: f, now: NOW });
    expect(s.repo).toEqual({ stars: 250, forks: 3, starsGained: 6 + 1, starsSource: 'history' });
    expect(f.calls.find((c) => c.url.includes('/stargazers/history')).headers['x-github-api-version']).toBe('2026-03-10');
  });

  it('a failing part carries its error, the rest still reports', async () => {
    const f = mockFetch(repoHandler({ fail: { 'verify.yml': 404, commits: 502, stargazers: 500 } }));
    const s = await collect({ week: WEEK, env: { GITHUB_TOKEN: TOKEN }, fetch: f, now: NOW });
    expect(s.runs.verify).toEqual({ error: 'GitHub HTTP 404 (verify runs)' });
    expect(s.runs.monitor.total).toBe(157);
    expect(s).toMatchObject({ shipped: { error: 'GitHub HTTP 502 (commits)' }, shippedCount: null, shippedByType: null });
    expect(s.repo).toEqual({ stars: 250, forks: 3, starsGained: { error: 'GitHub HTTP 500 (stargazers)' } });
    expect(s.issues.opened).toHaveLength(2);
  });

  it('throws when nothing works, without the token in the message', async () => {
    const f = mockFetch(() => ({ status: 401, body: { message: 'Bad credentials' } }));
    const err = await collect({ week: WEEK, env: { GITHUB_TOKEN: TOKEN }, fetch: f, now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('GitHub HTTP 401 (commits)');
    expect(err.message).not.toContain(TOKEN);
  });

  it('reads another repository from GITHUB_REPOSITORY', async () => {
    const f = mockFetch(repoHandler({ repo: 'someone/fork' }));
    const s = await collect({ week: WEEK, env: { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: 'someone/fork' }, fetch: f, now: NOW });
    expect(f.calls.every((c) => c.url.startsWith('https://api.github.com/repos/someone/fork'))).toBe(true);
    expect(s.shippedCount).toBe(4);
  });
});
