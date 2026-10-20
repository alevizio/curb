// The city request filer (scripts/cities/city-requests.mjs) against fixtures and a fake GitHub: one issue per city, "+1"
// comments for repeats, nothing private in what it writes, nothing filed twice. Never calls the real GitHub API.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { regionCode, cityKey, keyOf, titleOf, placeName, fileable, findIssue, issueKey, issueBody, plusOneBody, fileRequests, LABEL } from './city-requests.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REQUESTS = JSON.parse(readFileSync(HERE + 'fixtures/city-requests.json', 'utf8')).requests;
const ISSUES = JSON.parse(readFileSync(HERE + 'fixtures/city-request-issues.json', 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// A fake GitHub: serves the fixture's open issues (and comments, per issue), records every call, numbers new issues.
function fakeGitHub({ issues = ISSUES, comments = {} } = {}) {
  const calls = [];
  let next = 100;
  const gh = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('/issues?')) return /page=1(&|$)/.test(path) ? clone(issues) : [];
    if (method === 'GET' && /^\/issues\/\d+\/comments/.test(path)) return (comments[path.match(/\d+/)[0]] || []).map((b) => ({ body: b }));
    if (method === 'POST' && path === '/labels') return null;
    if (method === 'POST' && path === '/issues') return { number: next++ };
    if (method === 'POST' && /^\/issues\/\d+\/comments$/.test(path)) return { id: 1 };
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { gh, calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}

describe('names and places', () => {
  it('a region becomes its state or province code; the US itself counts as none', () => {
    expect(regionCode('Oregon')).toBe('OR');
    expect(regionCode('or')).toBe('OR');
    expect(regionCode('Québec')).toBe('QC');
    expect(regionCode('Washington, DC')).toBe('DC');
    expect(regionCode('Washington')).toBe('WA');
    expect(regionCode('Oregon, USA')).toBe('OR');
    expect(regionCode('United States')).toBe('');
    expect(regionCode('')).toBe('');
    expect(regionCode('France')).toBe('france');
  });
  it('a city matches across accents, case, punctuation and Saint / St.', () => {
    expect(cityKey('St. Louis')).toBe(cityKey('Saint Louis'));
    expect(cityKey('MONTRÉAL')).toBe(cityKey('montreal'));
    expect(keyOf({ city: 'portland', region: 'OR' })).toBe(keyOf({ city: 'Portland', region: 'Oregon' }));
    expect(keyOf({ city: 'Portland', region: 'Maine' })).not.toBe(keyOf({ city: 'Portland', region: 'Oregon' }));
  });
  it('titles read "City request: Portland, OR"', () => {
    expect(titleOf({ city: 'Portland', region: 'Oregon' })).toBe('City request: Portland, OR');
    expect(titleOf({ city: 'new york', region: '' })).toBe('City request: New York');
    expect(titleOf({ city: 'Lyon', region: 'France' })).toBe('City request: Lyon, France');
    expect(placeName({ city: 'Kraków', region: 'Lesser Poland' })).toBe('Kraków, Lesser Poland');
  });
  it('an open issue\'s city comes from its marker, else from its title', () => {
    expect(issueKey(ISSUES[0])).toBe('austin|TX');
    expect(issueKey(ISSUES[1])).toBe('denver|');
    expect(issueKey({ title: 'Something else', body: '' })).toBe(null);
  });
  it('a request with no region joins the only open issue for its city; two of them, it doesn\'t guess', () => {
    const open = [{ number: 1, key: 'portland|OR' }];
    expect(findIssue(open, { city: 'Portland', region: '' })).toEqual(open[0]);
    expect(findIssue([...open, { number: 2, key: 'portland|ME' }], { city: 'Portland', region: '' })).toBe(null);
    expect(findIssue(open, { city: 'Portland', region: 'Maine' })).toBe(null);
  });
  it('only requests that pass the API\'s checks are filed', () => {
    expect(REQUESTS.filter(fileable).map((r) => r.id.slice(-2))).toEqual(['01', '02', '03', '05', '06', '07']);
    expect(fileable({ ...REQUESTS[0], city: '@everyone' })).toBe(false);
    expect(fileable({ ...REQUESTS[0], link: 'https://x.org/`whoami`' })).toBe(false);
    expect(fileable({ ...REQUESTS[0], link: 'http://x.org/' })).toBe(false);
    expect(fileable({ ...REQUESTS[0], id: '../../x' })).toBe(false);
  });
});

describe('what an issue says', () => {
  const req = { ...REQUESTS[0], email: 'secret@example.com', ip: '203.0.113.9', note: 'call me at 555 0100' };
  it('the city, region, answer and the link as plain text; never an email, IP or anything else sent along', () => {
    const body = issueBody(req), plus = plusOneBody(req);
    for (const b of [body, plus]) {
      expect(b).toContain('- City: Portland');
      expect(b).toContain('- State, province or country: Oregon');
      expect(b).toContain('- Does the city publish its street sweeping or parking schedule? Yes');
      expect(b).toContain('- Link to that data: `https://www.portland.gov/transportation/street-cleaning`');
      expect(b).toContain('<!-- city-request-id 0b2f6c3e-1d4a-4c8e-9a51-7f3e2d1c0a01 -->');
      expect(b).not.toMatch(/secret@|203\.0\.113|555 0100|@example/);
      expect(b).not.toMatch(/[—–]/);
    }
    expect(body).toContain('<!-- city-request key="portland|OR" -->');
    expect(plus.startsWith('+1: another request for **Portland, OR**.')).toBe(true);
  });
});

describe('filing', () => {
  it('opens one issue per city, +1s repeats (this run\'s and older open issues), skips what fails the checks', async () => {
    const { gh, writes } = fakeGitHub();
    const memory = { since: 1792497600000, seen: ['old-request-already-filed'] };
    const done = await fileRequests({ requests: clone(REQUESTS), gh, memory });
    expect(done.map((d) => `${d.type} ${d.title || '#' + d.issue}`)).toEqual([
      'create City request: Portland, OR', 'comment #100', 'comment #41', 'skip #undefined',
      'create City request: Lyon, France', 'create City request: Saint Louis, MO', 'comment #41']);
    const w = writes();
    expect(w.filter((c) => c.path === '/labels')).toHaveLength(1);
    expect(w.filter((c) => c.path === '/issues').map((c) => c.body.labels)).toEqual([[LABEL], [LABEL], [LABEL]]);
    expect(w.filter((c) => /comments$/.test(c.path)).map((c) => c.path)).toEqual(['/issues/100/comments', '/issues/41/comments', '/issues/41/comments']);
    expect(memory.since).toBe(1792500700000);
    expect(memory.seen).toEqual(expect.arrayContaining(REQUESTS.filter(fileable).map((r) => r.id)));
  });
  it('the next run with the same memory files nothing', async () => {
    const memory = {};
    await fileRequests({ requests: clone(REQUESTS), gh: fakeGitHub().gh, memory });
    const again = fakeGitHub();
    const done = await fileRequests({ requests: clone(REQUESTS), gh: again.gh, memory });
    expect(done.filter((d) => d.type !== 'skip')).toEqual([]);
    expect(again.writes()).toEqual([]);
  });
  it('with the memory lost, a request already on GitHub (its id in an issue or a comment) isn\'t filed again', async () => {
    const created = { number: 100, title: 'City request: Portland, OR', body: issueBody(REQUESTS[0]), labels: [{ name: LABEL }] };
    const { gh, writes } = fakeGitHub({ issues: [...ISSUES, created], comments: { 100: [plusOneBody(REQUESTS[1])], 41: [plusOneBody(REQUESTS[2])] } });
    const done = await fileRequests({ requests: clone(REQUESTS), gh, memory: {} });
    expect(done.filter((d) => d.type === 'create').map((d) => d.title)).toEqual(['City request: Lyon, France', 'City request: Saint Louis, MO']);
    expect(writes().filter((c) => /comments$/.test(c.path)).map((c) => c.path)).toEqual(['/issues/41/comments']);   // only request 07 is new there
  });
  it('a dry run reads and plans, and writes nothing to GitHub', async () => {
    const { gh, writes } = fakeGitHub();
    const memory = {};
    const done = await fileRequests({ requests: clone(REQUESTS), gh, memory, dryRun: true });
    expect(done.filter((d) => d.type === 'create')).toHaveLength(3);
    expect(writes()).toEqual([]);
  });
  it('nothing new: GitHub isn\'t even read', async () => {
    const { gh, calls } = fakeGitHub();
    await fileRequests({ requests: [], gh, memory: {} });
    expect(calls).toEqual([]);
  });
});

describe('the workflow (.github/workflows/city-requests.yml)', () => {
  const y = readFileSync(HERE + '../../.github/workflows/city-requests.yml', 'utf8');
  it('every 30 minutes, allowed only to read the code and write issues, its memory in the Actions cache', () => {
    expect(y).toMatch(/cron: '11,41 \* \* \* \*'/);
    expect(y).toMatch(/\npermissions:\n {2}contents: read\n {2}issues: write\n/);
    expect(y).toContain('CRON_SECRET: ${{ secrets.CRON_SECRET }}');
    expect(y).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(y).toContain('node scripts/cities/city-requests.mjs --memory .city-requests/memory.json $FLAGS');
    expect(y).toMatch(/actions\/cache\/restore@v\d+/);
    expect(y).toMatch(/actions\/cache\/save@v\d+/);
    expect(y).not.toMatch(/emails=1|EMAIL/);   // it never reads the requesters' emails
  });
});

describe('the command, on fixtures', () => {
  it('--dry-run with fixture files prints the issues it would file and sends nothing', () => {
    const out = execFileSync(process.execPath, [HERE + 'city-requests.mjs', '--dry-run', '--requests', HERE + 'fixtures/city-requests.json', '--issues', HERE + 'fixtures/city-request-issues.json'],
      { encoding: 'utf8', env: { PATH: process.env.PATH, CITY_REQUESTS_SITE: 'http://127.0.0.1:9' } });
    expect(out).toContain('would open "City request: Portland, OR"');
    expect(out).toContain('would comment +1 on #41 (City request: Austin, TX)');
    expect(out).toContain('3 opened, 3 +1 (dry run: nothing sent)');
    expect(out).not.toMatch(/@example|secret/);
  });
});
