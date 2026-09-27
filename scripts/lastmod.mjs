// Real <lastmod> dates for the sitemaps: the day a page's content last changed, not the build day.
// A committed file's date is its last git commit; a file with uncommitted edits changed today.
// Needs git history (data-refresh checks out with fetch-depth: 0); without it → null, and the
// sitemap omits <lastmod> rather than inventing one.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const today = () => new Date().toISOString().slice(0, 10);

export function gitDate(rel) {
  try {
    const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (git('status', '--porcelain', '--', rel)) return today();
    return git('log', '-1', '--format=%cs', '--', rel) || null;
  } catch { return null; }
}
