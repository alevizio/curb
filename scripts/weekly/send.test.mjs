// Tests for the weekly email sender (send.mjs): the raw .eml is well formed (CRLF, 76 char base64
// lines, RFC 2047 subject, text then related HTML + inline images), and sendEml keeps the login out of
// argv, retries 3 times a minute apart and never puts the password in an error. curl is mocked.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { buildEml, encodeHeader, curlConfig, sendEml, b64, ATTEMPTS, RETRY_MS, SMTP_URL } from './send.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000004b0', 'hex');
const msg = (over = {}) => ({
  from: 'CURB weekly <curb.reports@gmail.com>',
  to: ['owner@example.com', 'second@example.com'],
  subject: 'CURB this week: Oct 7 to 13',
  html: `<p>${'Hello weekly report. '.repeat(40)}</p><img src="cid:logo@curb.guide">`,
  text: 'Visitors: 1,940\nGoogle clicks: 312\n',
  images: [{ cid: 'logo@curb.guide', type: 'image/png', data: PNG }],
  date: new Date('2026-10-14T15:05:00Z'),
  ...over,
});
const decodeWords = (h) => [...h.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map((m) => Buffer.from(m[1], 'base64').toString('utf8')).join('');
const part = (eml, type) => {
  const i = eml.indexOf(`Content-Type: ${type}`);
  const start = eml.indexOf('\r\n\r\n', i) + 4;
  return Buffer.from(eml.slice(start, eml.indexOf('\r\n--', start)).replace(/\r\n/g, ''), 'base64');
};

describe('buildEml', () => {
  const eml = buildEml(msg());

  it('uses CRLF everywhere and wraps base64 at 76 characters', () => {
    expect(eml).not.toMatch(/[^\r]\n/);
    for (const line of eml.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    const bodyLines = eml.split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l));
    expect(bodyLines.length).toBeGreaterThan(3);
    for (const l of bodyLines) expect(l.length).toBeLessThanOrEqual(76);
    expect(b64(Buffer.alloc(200)).split('\r\n')[0].length).toBe(76);
  });

  it('headers: from, to, encoded subject, date, MIME', () => {
    expect(eml).toMatch(/^From: CURB weekly <curb\.reports@gmail\.com>\r\nTo: owner@example\.com, second@example\.com\r\nSubject: =\?UTF-8\?B\?/);
    expect(decodeWords(eml.match(/Subject: (.*(?:\r\n .*)*)/)[1])).toBe('CURB this week: Oct 7 to 13');
    expect(eml).toContain('Date: Wed, 14 Oct 2026 15:05:00 GMT');
    expect(eml).toContain('MIME-Version: 1.0');
  });

  it('multipart/alternative: plain text first, then related HTML with the inline image', () => {
    const alt = eml.match(/multipart\/alternative; boundary="([^"]+)"/)[1];
    const rel = eml.match(/multipart\/related; boundary="([^"]+)"/)[1];
    const at = (s) => eml.indexOf(s);
    expect(at('Content-Type: text/plain')).toBeLessThan(at('Content-Type: multipart/related'));
    expect(at('Content-Type: text/html')).toBeLessThan(at('Content-ID: <logo@curb.guide>'));
    expect(eml).toContain('Content-Disposition: inline');
    expect(eml.trimEnd().endsWith(`--${rel}--\r\n--${alt}--`)).toBe(true);
    expect(part(eml, 'text/plain').toString('utf8')).toBe(msg().text);
    expect(part(eml, 'text/html').toString('utf8')).toBe(msg().html);
    expect(part(eml, 'image/png').equals(PNG)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    expect(buildEml(msg())).toBe(eml);
  });

  it('strips CR/LF from headers so nothing can inject a header', () => {
    const e = buildEml(msg({ from: 'a@b.c\r\nBcc: evil@x.y', to: ['o@x.y\nBcc: evil@x.y'], subject: 'Hi\r\nBcc: evil@x.y' }));
    expect(e).not.toMatch(/\r\nBcc:/);
  });

  it('drops an image whose cid could break the Content-ID header', () => {
    const e = buildEml(msg({ images: [{ cid: 'bad>\r\nX: y', type: 'image/png', data: PNG }] }));
    expect(e).not.toContain('Content-ID');
  });
});

describe('encodeHeader', () => {
  it('splits a long UTF-8 subject into encoded words of 75 characters or less, never mid character', () => {
    const subject = 'Preview: CURB this week: Oct 7 to 13 ★ 4.8 rating, ñandú, 東京 '.repeat(3);
    const h = encodeHeader(subject);
    const words = h.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).not.toContain('�');
    }
    expect(decodeWords(h)).toBe(subject.trim());
  });
});

describe('sendEml', () => {
  const opts = (run, waits = []) => ({ user: 'curb.reports@gmail.com', password: 'abcd efgh ijkl mnop', rcpts: ['owner@example.com', 'second@example.com'], run, wait: async (ms) => { waits.push(ms); } });

  it('passes the login on stdin only, one --mail-rcpt per recipient', async () => {
    const calls = [];
    const r = await sendEml('eml', opts(async (args, input) => { calls.push({ args, input }); return { status: 0, stderr: '' }; }));
    expect(r).toEqual({ attempts: 1 });
    const { args, input } = calls[0];
    expect(args.join(' ')).not.toContain('abcd efgh');
    expect(args).toEqual(expect.arrayContaining(['--ssl-reqd', '--url', SMTP_URL, '--mail-from', 'curb.reports@gmail.com', '-K', '-']));
    expect(args.filter((a) => a === '--mail-rcpt').length).toBe(2);
    expect(input).toBe('user = "curb.reports@gmail.com:abcd efgh ijkl mnop"\n');
    const file = args[args.indexOf('--upload-file') + 1];
    expect(existsSync(file)).toBe(false); // the temp .eml is removed after sending
  });

  it('retries a minute apart and succeeds on a later try', async () => {
    const waits = [];
    let n = 0;
    const r = await sendEml('eml', opts(async () => (++n < 2 ? { status: 67, stderr: 'curl: (67) Login denied' } : { status: 0 }), waits));
    expect(r).toEqual({ attempts: 2 });
    expect(waits).toEqual([RETRY_MS]);
    expect(RETRY_MS).toBe(60000);
  });

  it('gives up after 3 tries with curl\'s error and never the password', async () => {
    const waits = [];
    let n = 0;
    const err = await sendEml('eml', opts(async () => { n++; return { status: 7, stderr: 'curl: (7) Failed to connect to smtp.gmail.com port 465' }; }, waits)).catch((e) => e);
    expect(n).toBe(ATTEMPTS);
    expect(waits).toEqual([RETRY_MS, RETRY_MS]);
    expect(err.message).toBe('SMTP send failed after 3 attempts: curl: (7) Failed to connect to smtp.gmail.com port 465');
    expect(err.message).not.toContain('abcd');
  });

  it('refuses to run without a login or recipients', async () => {
    await expect(sendEml('eml', { user: 'a@b.c', rcpts: ['x@y.z'] })).rejects.toThrow('missing SMTP user or password');
    await expect(sendEml('eml', { user: 'a@b.c', password: 'p', rcpts: [] })).rejects.toThrow('no recipients');
  });

  it('escapes quotes and backslashes in the curl config', () => {
    expect(curlConfig('u@x.y', 'pa"ss\\word\n')).toBe('user = "u@x.y:pa\\"ss\\\\word"\n');
  });
});
