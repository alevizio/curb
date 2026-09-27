// Turns monitor results into ONE GitHub issue per check group, so the owner gets an email when
// something breaks, a follow-up only when WHAT is broken changes, and a "recovered" email when it
// heals — instead of a failure email every 30 minutes.
//
//   node scripts/monitor/alert.mjs <results.json> <label> "<issue title>"
// Env: GITHUB_TOKEN (issues: write), GITHUB_REPOSITORY, MONITOR_MENTION (default: repo owner),
//      GITHUB_SERVER_URL + GITHUB_RUN_ID (link to the run), MONITOR_DRY_RUN=1 (print, don't call API).
import { readFileSync, existsSync } from 'node:fs';

const SIG = /<!-- monitor-sig:([^<>]*?) -->/g;

/** The monitor writes its marker LAST in the body, so only the last one counts: an earlier one can only
 *  have come from quoted text (the error log is public input) and must never be read or rewritten. */
export const lastSig = (body) => [...String(body || '').matchAll(SIG)].at(-1) || null;
/** Swap in a new signature by position — no String.replace, which would expand $& / $` in the text. */
export function withSig(body, sig) {
  const b = String(body || ''), m = lastSig(b);
  const marker = `<!-- monitor-sig:${sig} -->`;
  return m ? b.slice(0, m.index) + marker + b.slice(m.index + m[0].length) : `${b}\n\n${marker}`;
}

/** Failing check names, sorted — the identity of "what is broken right now" (no < >: it lives inside
 *  an HTML comment). */
export const signature = (results) => results.filter((r) => r.status === 'fail').map((r) => String(r.name).replace(/[<>]/g, '')).sort().join('|');

const noComment = (s) => String(s).replace(/<!--|-->/g, '');
export function renderFailures(results) {
  return results.filter((r) => r.status === 'fail').map((r) => `- ❌ **${noComment(r.name)}** — ${noComment(r.detail)}`).join('\n');
}

/**
 * Pure decision: given this run's results and the currently open issue for the label (or null),
 * what should happen? → { type: 'none' | 'open' | 'comment' | 'close', ... }
 */
export function decide(results, openIssue, { title, mention, runUrl }) {
  const sig = signature(results);
  const skipped = results.filter((r) => r.status === 'skip').map((r) => r.name);
  const note = skipped.length ? `\n\n_Skipped this run: ${skipped.join(', ')}._` : '';
  const run = runUrl ? `\n\n[Monitor run](${runUrl})` : '';
  if (!sig) {
    return openIssue
      ? { type: 'close', body: `✅ Recovered — every check passes again.${run}` }
      : { type: 'none' };
  }
  const list = renderFailures(results);
  if (!openIssue) {
    const who = mention ? `@${mention} ` : '';
    return {
      type: 'open',
      title: `${title}: ${results.filter((r) => r.status === 'fail').map((r) => r.name).join(', ')}`.slice(0, 200),
      body: `${who}the curb.guide monitor found a problem.\n\n${list}${note}${run}\n\nThis issue closes by itself when the checks pass again.\n\n<!-- monitor-sig:${sig} -->`,
    };
  }
  const prev = lastSig(openIssue.body)?.[1] ?? '';
  if (prev === sig) return { type: 'none' };
  return { type: 'comment', sig, body: `Still broken, and what's failing changed:\n\n${list}${note}${run}` };
}

async function gh(method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'curb-monitor' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && !(method === 'POST' && path === '/labels' && r.status === 422)) throw new Error(`${method} ${path} → HTTP ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, label, title] = process.argv.slice(2);
  // A check script that crashed before writing results is itself an outage of the monitor.
  const results = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'))
    : [{ name: 'monitor run', status: 'fail', detail: `the check script crashed before writing ${file} — see the run log` }];
  const repo = process.env.GITHUB_REPOSITORY || '';
  const mention = process.env.MONITOR_MENTION ?? repo.split('/')[0];
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  const dry = process.env.MONITOR_DRY_RUN === '1';

  const open = dry ? null : (await gh('GET', `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=1`))[0] || null;
  const action = decide(results, open, { title, mention, runUrl });
  console.log(`${label}: ${action.type}`);
  if (dry) { console.log(JSON.stringify(action, null, 2)); process.exit(0); }

  if (action.type === 'open') {
    await gh('POST', '/labels', { name: label, color: 'd73a4a', description: 'Opened and closed automatically by the monitor workflow' });
    const issue = await gh('POST', '/issues', { title: action.title, body: action.body, labels: [label] });
    console.log(issue.html_url);
  } else if (action.type === 'comment') {
    await gh('POST', `/issues/${open.number}/comments`, { body: action.body });
    await gh('PATCH', `/issues/${open.number}`, { body: withSig(open.body, action.sig) });
  } else if (action.type === 'close') {
    await gh('POST', `/issues/${open.number}/comments`, { body: action.body });
    await gh('PATCH', `/issues/${open.number}`, { state: 'closed', state_reason: 'completed' });
  }
}
