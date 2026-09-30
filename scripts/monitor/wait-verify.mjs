// Waits for the `verify` workflow (.github/workflows/verify.yml) on one commit and exits 0 only if it
// succeeded: the on-call routine's ship gate (docs/on-call.md). Reads the public GitHub API, no token needed.
//
//   node scripts/monitor/wait-verify.mjs <commit sha> [--timeout-min 15]
// Prints one line per poll and the run's URL; exit 0 success, 1 failed or cancelled, 2 timed out.
export const REPO = 'alevizio/curb';

/** Pure: check-runs API body → 'pending' | 'success' | 'failure' for the run named verify. */
export function verdict(body) {
  const run = (body?.check_runs || []).find((c) => c.name === 'verify');
  if (!run || run.status !== 'completed') return { state: 'pending', url: run?.html_url || '' };
  return { state: run.conclusion === 'success' ? 'success' : 'failure', url: run.html_url, conclusion: run.conclusion };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const sha = args[0];
  if (!/^[0-9a-f]{7,40}$/.test(sha || '')) { console.error('usage: wait-verify.mjs <commit sha>'); process.exit(64); }
  const mins = args.includes('--timeout-min') ? Number(args[args.indexOf('--timeout-min') + 1]) : 15;
  const until = Date.now() + mins * 60000;
  for (;;) {
    let v = { state: 'pending', url: '' };
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}/check-runs`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'curb-oncall' } });
      if (r.ok) v = verdict(await r.json()); else console.log(`GitHub API HTTP ${r.status}, retrying`);
    } catch (e) { console.log(`GitHub API unreachable (${e.message}), retrying`); }
    console.log(`verify on ${sha.slice(0, 7)}: ${v.state}${v.url ? ` ${v.url}` : ''}`);
    if (v.state === 'success') process.exit(0);
    if (v.state === 'failure') { console.log(`conclusion: ${v.conclusion}`); process.exit(1); }
    if (Date.now() > until) { console.log(`timed out after ${mins} min`); process.exit(2); }
    await new Promise((res) => setTimeout(res, 30000));
  }
}
