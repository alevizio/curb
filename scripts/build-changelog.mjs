#!/usr/bin/env node
// Generate the changelog history from the real git commit log, grouped by date, categorized
// by conventional-commit type. Injects between the <!-- changelog:start/end --> markers in
// changelog.html (leaving the design-timelapse + chrome untouched). Run: npm run build:changelog
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// %x09 = a tab between the date and the subject (commit subjects don't contain tabs).
const log = execSync('git log --no-merges --date=short --pretty=format:%ad%x09%s', { encoding: 'utf8' });

const TAGMAP = {
  feat: ['New', 'new'], data: ['Data', 'data'], fix: ['Fix', 'fix'], perf: ['Fix', 'fix'],
  redesign: ['Design', 'fix'], refactor: ['Design', 'fix'], content: ['New', 'new'], style: ['Design', 'fix'],
};
const SKIP = new Set(['chore', 'docs', 'test', 'ci', 'build']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const byDate = new Map();
for (const line of log.split('\n')) {
  const tab = line.indexOf('\t');
  if (tab < 0) continue;
  const date = line.slice(0, tab);
  const subject = line.slice(tab + 1);
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  const type = m ? m[1].toLowerCase() : 'feat';
  let text = m ? m[3] : subject;
  if (SKIP.has(type)) continue;
  let [tag, cls] = TAGMAP[type] || ['New', 'new'];
  if (/\b(ios|apns|wkwebview|xcode|app ?store|swift)\b/i.test(subject)) { tag = 'iOS'; cls = 'ios'; }
  text = cap(text.replace(/\s*\((?:WEB|ALE)-[\d-]+\)\s*$/i, '').trim());
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push({ tag, cls, text });
}

const fmt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
let html = '';
for (const date of [...byDate.keys()].sort().reverse()) {
  html += `    <div class="entry">\n      <h2 class="date">${fmt(date)}</h2>\n`;
  for (const { tag, cls, text } of byDate.get(date))
    html += `      <div class="cl"><span class="tag ${cls}">${esc(tag)}</span><p>${esc(text)}</p></div>\n`;
  html += '    </div>\n';
}

const file = new URL('../changelog.html', import.meta.url);
let doc = readFileSync(file, 'utf8');
if (!/<!-- changelog:start -->[\s\S]*<!-- changelog:end -->/.test(doc)) {
  console.error('changelog.html is missing the <!-- changelog:start/end --> markers'); process.exit(1);
}
doc = doc.replace(/<!-- changelog:start -->[\s\S]*?<!-- changelog:end -->/, `<!-- changelog:start -->\n${html}    <!-- changelog:end -->`);
writeFileSync(file, doc);
const n = [...byDate.values()].reduce((a, b) => a + b.length, 0);
console.log(`changelog: ${n} entries across ${byDate.size} days`);
