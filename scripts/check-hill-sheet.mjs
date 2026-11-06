// The hill reminder in a real browser (owner, 2026-11-06, after his own ticket at 838 Buena Vista Ave West). The two sides of
// that block get opposite moves, a flat block gets no card, a sheet opened before data/grades.json lands fills the card in, and
// another city's page never asks for SF's file. Run by .github/workflows/verify.yml. Optional second argument: a folder for screenshots.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const SITE = process.argv[2] || 'http://localhost:3077', SHOTS = process.argv[3];
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const BUENA_VISTA = '3370000', VALENCIA = '13059000';
const VIEW = { [BUENA_VISTA]: [37.7697, -122.4427], [VALENCIA]: [37.7648, -122.4218] };
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ': ' + JSON.stringify(got)}`); };

async function opened(path = '/', hold) {
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  if (hold) {
    await p.setBypassServiceWorker(true);   // the first page's worker would answer before the hold could see the request
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      if (!r.url().includes('data/grades.json')) return r.continue();
      hold.then(() => r.continue());
    });
  }
  await p.goto(SITE + path, { waitUntil: 'load' });
  await p.waitForFunction(() => { const x = document.getElementById('welcomeGo'); return x && x.offsetParent; }, { timeout: 8000 }).then(() => p.click('#welcomeGo'), () => {});
  await p.waitForFunction(() => typeof map !== 'undefined');
  return p;
}

async function openSide(p, cnn, side) {
  const [la, lo] = VIEW[cnn];
  await p.evaluate((la, lo) => map.setView([la, lo], 17, { animate: false }), la, lo);
  await p.waitForFunction((c) => typeof segCacheAll !== 'undefined' && segCacheAll.some((x) => String(x.group.cnn) === c), { timeout: 30000 }, cnn);
  return p.evaluate(async (cnn, side) => {
    const hit = segCacheAll.find((x) => String(x.group.cnn) === cnn && (!side || new RegExp(side, 'i').test(x.side.blockside || '')));
    openSheet(hit.group, hit.side.key);
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('.hillcard');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
  }, cnn, side);
}

const p = await opened();
await p.waitForFunction(() => typeof GRADES !== 'undefined' && GRADES, { timeout: 15000 });
const even = await openSide(p, BUENA_VISTA, 'northwest');
check('838 Buena Vista, the even side, faces uphill', /STEEP BLOCK, 8\.8%/i.test(even) && /Facing uphill on this side: wheels away from the curb/.test(even) && /Facing downhill\? Wheels toward the curb/.test(even) && /over 3%\. Ticket: \$48/.test(even), even);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/hill-uphill.png` });
const odd = await openSide(p, BUENA_VISTA, 'southeast');
check('the odd side of that block faces downhill', /Facing downhill on this side: wheels toward the curb/.test(odd) && /Facing uphill\? Wheels away/.test(odd), odd);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/hill-downhill.png` });
const flat = await openSide(p, VALENCIA);
check('a flat block has no card', flat === '', flat);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/hill-flat.png` });
check('no page errors', !p.errors.length, p.errors);
await p.close();

// the sheet opens first, the file lands after
let release;
const late = await opened('/', new Promise((r) => { release = r; }));
const before = await openSide(late, BUENA_VISTA, 'northwest');
release();
await late.waitForFunction(() => document.querySelector('.hillcard'), { timeout: 15000 }).catch(() => {});
const after = await late.evaluate(() => (document.querySelector('.hillcard') || {}).innerText || '');
check('a sheet opened before the file lands fills the card in', before === '' && /Facing uphill on this side/.test(after), { before, after });
await late.close();

// not SF: no script, no file
const asked = [];
const ny = await b.newPage();
ny.on('request', (r) => { if (/grades\.json|lib\/hill\.js/.test(r.url())) asked.push(r.url()); });
await ny.goto(SITE + '/new-york.html', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
check("another city's page never asks for SF's hill files", !asked.length, asked);
await ny.close();

await b.close();
if (results.includes(false)) process.exitCode = 1;
