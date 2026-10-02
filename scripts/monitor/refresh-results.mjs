// Turns the monthly data-refresh run (.github/workflows/data-refresh.yml) into the results shape the monitor
// uses, so a failed refresh opens an alert issue (alert.mjs, label monitor:data) and wakes the on-call
// routine (notify-claude.mjs) like any other check, and the next good refresh closes it.
//
//   STEPS='${{ toJSON(steps) }}' node scripts/monitor/refresh-results.mjs refresh.json
// Names only the step that failed: the issue is public, and the run log (linked from it) has the details.
import { writeFileSync } from 'node:fs';

export const STEP_NAMES = {
  install: 'Install deps',
  build: 'Rebuild data assets',
  validate: 'Validate shapes',
  pages: 'Rebuild neighborhood maps + pages',
  commit: 'Commit if changed',
};

/** Pure: the workflow's steps context (JSON) → one monitor result. A step that never got an id (or did not
 *  run) cannot be named, so a failure there still fails, as "a step before the refresh". */
export function refreshResults(stepsJson, jobStatus = 'success') {
  let steps = {};
  try { steps = JSON.parse(stepsJson || '{}') || {}; } catch { /* treat as unknown below */ }
  const failed = Object.keys(STEP_NAMES).filter((id) => steps[id]?.outcome === 'failure').map((id) => STEP_NAMES[id]);
  const ok = !failed.length && jobStatus === 'success';
  return [{
    name: 'monthly data refresh',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'rebuilt and validated'
      : failed.length ? `the step "${failed.join('", "')}" failed. The run log has the error`
      : 'the run failed before the refresh started. The run log has the error',
  }];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || 'refresh.json';
  const results = refreshResults(process.env.STEPS, process.env.JOB_STATUS || 'success');
  writeFileSync(out, JSON.stringify(results, null, 1));
  console.log(`${results[0].status}: ${results[0].detail}`);
}
