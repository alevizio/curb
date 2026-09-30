// The map's viewport loader retries a dropped connection once before telling the visitor (index.html fetchRetry).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PAGE = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const a = PAGE.indexOf('async function fetchRetry(');
const SRC = PAGE.slice(a, PAGE.indexOf('\n}\n', a) + 3);

function load(responses) {
  const calls = [];
  const g = { setTimeout: (f) => f(), fetch: async (url) => { calls.push(url); const r = responses.shift(); if (r instanceof Error) throw r; return r; } };
  vm.createContext(g);
  vm.runInContext(SRC, g);
  return { fetchRetry: g.fetchRetry, calls };
}

describe('fetchRetry (map data loads)', () => {
  it('is what loadViewport uses for the block data', () => {
    expect(PAGE).toMatch(/const r=await fetchRetry\(url, \(\)=>my===fetchTok\);/);
  });
  it('recovers from one dropped connection', async () => {
    const { fetchRetry, calls } = load([new TypeError('Load failed'), { ok: true, status: 200 }]);
    expect((await fetchRetry('u')).status).toBe(200);
    expect(calls).toEqual(['u', 'u']);
  });
  it('gives up after the second failure, so the visitor still gets told', async () => {
    const { fetchRetry, calls } = load([new TypeError('Load failed'), new TypeError('Load failed')]);
    await expect(fetchRetry('u')).rejects.toThrow('Load failed');
    expect(calls).toHaveLength(2);
  });
  it('does not retry an HTTP error (it is not a dropped connection)', async () => {
    const { fetchRetry, calls } = load([{ ok: false, status: 400 }]);
    expect((await fetchRetry('u')).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
  it('does not retry once the visitor has moved on to another area', async () => {
    const { fetchRetry, calls } = load([new TypeError('Load failed'), { ok: true, status: 200 }]);
    await expect(fetchRetry('u', () => false)).rejects.toThrow('Load failed');
    expect(calls).toHaveLength(1);
  });
});
