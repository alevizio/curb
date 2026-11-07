// The hill reminder in a real browser (owner, 2026-11-06, after the owner's own ticket at 838 Buena Vista Ave West). The two sides of
// that block get opposite moves and pictures, the left side of a one way street gets its curb on the left, a flat block gets no card,
// a sheet opened before data/grades.json lands fills the card in, no motion still shows the move, and another city's page never asks for SF's file. Run by .github/workflows/verify.yml. Optional second argument: a folder for screenshots.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const SITE = process.argv[2] || 'http://localhost:3077', SHOTS = process.argv[3];
const CHROME = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const BUENA_VISTA = '3370000', VALENCIA = '13059000', PINE = '10493000';   // Pine St runs west: from Lyon to Masonic, its south side is the driver's left
const VIEW = { [BUENA_VISTA]: [37.7697, -122.4427], [VALENCIA]: [37.7648, -122.4218], [PINE]: [37.7863, -122.4461] };
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
// the picture: which move, the hand the curb is on, whether it moves, and the angle its wheels rest at when nothing animates them
const picture = () => p.evaluate(() => [...document.querySelectorAll('.hsc')].map((el) => ({
  move: el.classList.contains('uphill') ? 'uphill' : 'downhill',
  leftCurb: !!el.querySelector('g[transform^="matrix(-1"]'),
  moving: el.getAnimations({ subtree: true }).length > 0,
  rest: el.querySelector('.hw').getAnimations().length ? null : getComputedStyle(el.querySelector('.hw')).transform,
})));
const upPic = await picture();
check('its picture turns the wheels away from a curb on the right, and moves', upPic.length === 1 && upPic[0].move === 'uphill' && !upPic[0].leftCurb && upPic[0].moving, upPic);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/hill-uphill.png` });
const odd = await openSide(p, BUENA_VISTA, 'southeast');
check('the odd side of that block faces downhill', /Facing downhill on this side: wheels toward the curb/.test(odd) && /Facing uphill\? Wheels away/.test(odd), odd);
const downPic = await picture();
check('its picture turns the wheels toward the curb', downPic.length === 1 && downPic[0].move === 'downhill' && !downPic[0].leftCurb, downPic);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/hill-downhill.png` });
await openSide(p, PINE, 'south');
const pineSouth = await picture();
await openSide(p, PINE, 'north');
const pineNorth = await picture();
check("Pine St's south side has the curb on the driver's left, its north side on the right", pineSouth.length === 1 && pineSouth[0].leftCurb && pineSouth[0].move === 'uphill' && pineNorth.length === 1 && !pineNorth[0].leftCurb && pineNorth[0].move === 'uphill', { pineSouth, pineNorth });
if (SHOTS) await p.screenshot({ path: `${SHOTS}/hill-one-way.png` });
const both = await p.evaluate(() => { const box = document.createElement('div'); box.innerHTML = hillCard(Object.keys(GRADES.b).find((k) => GRADES.b[k][1] === 0), 'L'); return ['.hic.two', '.hsc.downhill', '.hsc.uphill'].map((q) => box.querySelectorAll(q).length); });
check('a block that climbs and drops draws both moves', both.join() === '1,1,1', both);
await openSide(p, BUENA_VISTA, 'northwest');
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await openSide(p, BUENA_VISTA, 'northwest');
const still = await picture();
const turned = still[0] && /^matrix\(0\.88/.test(still[0].rest) && parseFloat(still[0].rest.split(',')[1]) < 0;
check('with reduced motion nothing moves, and the wheels already show the move', still.length === 1 && !still[0].moving && turned, still);
await p.emulateMediaFeatures([]);
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
