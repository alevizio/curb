// Sends the weekly email through Gmail SMTP with curl (no npm mail library). buildEml makes the raw
// message: multipart/alternative with the plain text first, then multipart/related holding the HTML
// and its inline PNGs (cid:), so no client has to fetch an image. sendEml hands it to curl over SMTPS
// with the login on curl's stdin (-K -), never in argv where any process listing would show it.
// Ported from the PH digest sender that has run weekly since Sep 2026 (djooni/ph-digest/send-email.ts).
//
// Used by the weekly runner: await sendEml(buildEml({ from, to, subject, html, text, images }), { user, password, rcpts }).
// The caller reads GMAIL_USER and GMAIL_APP_PASSWORD (a Google app password) from env and passes them in.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SMTP_URL = 'smtps://smtp.gmail.com:465';
export const ATTEMPTS = 3;
export const RETRY_MS = 60_000; // Gmail sometimes answers cloud IPs with a temporary 421/454

const CRLF = '\r\n';
/** base64 wrapped at 76 characters per line (RFC 2045). */
export const b64 = (data) => (Buffer.from(data).toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);
const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim(); // no header injection

/**
 * RFC 2047 encoded-words for a header value, split so each word stays within 75 characters and
 * never cuts a UTF-8 character in half. Words are folded onto continuation lines.
 */
export function encodeHeader(value) {
  const words = [];
  let chunk = '';
  for (const ch of oneLine(value)) {
    if (Buffer.byteLength(chunk + ch) > 45) { words.push(chunk); chunk = ''; } // 45 bytes → 60 base64 chars + 12 = 72
    chunk += ch;
  }
  if (chunk || !words.length) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join(`${CRLF} `);
}

/** Pure: the raw .eml (CRLF line endings). Boundaries come from a hash of the content, so the same input gives the same bytes. */
export function buildEml({ from, to = [], subject, html, text, images = [], date = new Date() }) {
  const id = createHash('sha256').update(String(html)).update(String(text)).update(String(subject)).digest('hex').slice(0, 24);
  const alt = `alt-${id}`; // '-' is not in the base64 alphabet, so a boundary can never appear inside a body
  const rel = `rel-${id}`;
  const cidOk = (cid) => /^[\w.@-]+$/.test(cid);
  return [
    `From: ${oneLine(from)}`,
    `To: ${to.map(oneLine).join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text ?? ''),
    `--${alt}`,
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html ?? ''),
    ...images.filter((im) => cidOk(im.cid)).flatMap(({ cid, type, data }) => [
      `--${rel}`,
      `Content-Type: ${oneLine(type) || 'image/png'}`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${cid}>`,
      `Content-Disposition: inline; filename="${cid.split('@')[0]}.png"`,
      '',
      b64(data),
    ]),
    `--${rel}--`,
    `--${alt}--`,
    '',
  ].join(CRLF);
}

/** curl config line for the login: double quotes with backslash escapes (curl's -K syntax). */
export const curlConfig = (user, password) => `user = "${`${user}:${password}`.replace(/[\r\n]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;

/** Run curl, feeding `input` on stdin. Resolves { status, stderr }; never rejects. */
function runCurl(args, input) {
  return new Promise((resolve) => {
    const p = spawn('curl', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => resolve({ status: -1, stderr: e.message }));
    p.on('close', (status) => resolve({ status, stderr }));
    p.stdin.end(input);
  });
}

/**
 * Send a built .eml through Gmail. Up to ATTEMPTS tries, RETRY_MS apart. Throws with curl's own short
 * error (never the message or the login) when every try fails. `run` and `wait` are for tests.
 */
export async function sendEml(eml, { user, password, rcpts = [], run = runCurl, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!user || !password) throw new Error('missing SMTP user or password');
  if (!rcpts.length) throw new Error('no recipients');
  const dir = mkdtempSync(join(tmpdir(), 'curb-weekly-'));
  const file = join(dir, 'weekly.eml');
  writeFileSync(file, eml, { mode: 0o600 });
  // time limits so a stalled SMTP session fails and gets retried instead of eating the job's 30 minutes
  const args = ['--silent', '--show-error', '--ssl-reqd', '--connect-timeout', '30', '--max-time', '180', '--url', SMTP_URL, '--mail-from', user,
    ...rcpts.flatMap((r) => ['--mail-rcpt', r]), '--upload-file', file, '-K', '-'];
  try {
    let last = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const r = await run(args, curlConfig(user, password));
      if (r.status === 0) return { attempts: attempt };
      last = String(r.stderr || `curl exit ${r.status}`).trim().split('\n').pop().slice(0, 200);
      if (attempt < ATTEMPTS) await wait(RETRY_MS);
    }
    throw new Error(`SMTP send failed after ${ATTEMPTS} attempts: ${last}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
