// Render the parchment basemap to PNG raster tiles with headless Chrome + MapLibre GL JS.
// Step 4 of scripts/build-basemap.sh (run that; it extracts the .pmtiles + builds the style first).
// No Docker: the MapLibre native renderer has no prebuilt binary for current Node, Chrome does.
// Output: basemap/parchment/{z}/{x}/{y}.png, 512px (@2x) tiles on the standard 256px XYZ grid that
// Leaflet's L.tileLayer expects.
//
// Renders metatiles (N×N tiles + a 1-tile buffer on every side, buffer discarded) so labels place
// the same way across tile seams. Tiles are palette-quantized with sharp (parchment has few colors).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'basemap/parchment');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const N = 6, B = 1; // metatile = 6×6 kept tiles + 1-tile buffer = 4096px canvas (headless WebGL cap)

// Same boxes as build-basemap.sh (keep in sync): SF at street zooms, Bay Area for the zoomed-out view.
const JOBS = [
  { src: 'bay.pmtiles', bbox: [-123.10, 37.20, -121.60, 38.30], minz: 8, maxz: 13 },
  { src: 'sf.pmtiles', bbox: [-122.56, 37.685, -122.34, 37.84], minz: 14, maxz: 17 },
];

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

const PAGE = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}#m{position:absolute;top:0;left:0}</style>
<div id="m"></div><script src="/node_modules/pmtiles/dist/pmtiles.js"></script>
<script type="module">
import * as maplibregl from '/node_modules/maplibre-gl/dist/maplibre-gl.mjs';
const protocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile);
window.setup = async (src, px) => {
  const buf = await (await fetch('/basemap/' + src)).arrayBuffer();
  protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(new File([buf], src))));
  const style = await (await fetch('/basemap/parchment-style.json')).json();
  style.sources.protomaps.url = 'pmtiles://' + src;
  const el = document.getElementById('m'); el.style.width = el.style.height = px + 'px';
  window.map = new maplibregl.Map({ container: el, style, pixelRatio: 2, interactive: false, fadeDuration: 0,
    attributionControl: false, canvasContextAttributes: { preserveDrawingBuffer: true } });
  await new Promise((r) => window.map.once('idle', r));
};
window.shot = async (lng, lat, zoom) => {
  window.map.jumpTo({ center: [lng, lat], zoom });
  await new Promise((r) => window.map.once('idle', r)); // idle = tiles + glyphs + symbols settled
  return window.map.getCanvas().toDataURL('image/png');
};
window.ready = true;
</script>`;

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.pmtiles': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  const f = path.join(ROOT, path.normalize(u));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=2600,2600'] });
const px = (N + 2 * B) * 256; // CSS px; ×2 pixelRatio → 512px per tile
let written = 0;
try {
  for (const job of JOBS) {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.error('  page:', m.text()); });
    await page.setViewport({ width: px, height: px });
    await page.goto(base); await page.waitForFunction('window.ready');
    await page.evaluate((s, p) => window.setup(s, p), job.src, px);
    const [w, s, e, n] = job.bbox;
    for (let z = job.minz; z <= job.maxz; z++) {
      const X0 = lon2x(w, z), X1 = lon2x(e, z), Y0 = lat2y(n, z), Y1 = lat2y(s, z);
      for (let mx = X0; mx <= X1; mx += N) for (let my = Y0; my <= Y1; my += N) {
        const cx = mx + N / 2, cy = my + N / 2; // block center (buffer is symmetric)
        const url = await page.evaluate((a, b, c) => window.shot(a, b, c), x2lon(cx, z), y2lat(cy, z), z - 1);
        const img = Buffer.from(url.split(',')[1], 'base64');
        const { width } = await sharp(img).metadata();
        if (width !== px * 2) throw new Error(`canvas is ${width}px, expected ${px * 2}px — lower N`);
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const x = mx + i, y = my + j;
          if (x > X1 || y > Y1) continue;
          const dir = path.join(OUT, String(z), String(x)); fs.mkdirSync(dir, { recursive: true });
          await sharp(img).extract({ left: (B + i) * 512, top: (B + j) * 512, width: 512, height: 512 })
            .png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(path.join(dir, `${y}.png`));
          written++;
        }
      }
      console.log(`z${z}: ${(X1 - X0 + 1) * (Y1 - Y0 + 1)} tiles`);
    }
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`✅ ${written} tiles → ${path.relative(ROOT, OUT)}/{z}/{x}/{y}.png`);
