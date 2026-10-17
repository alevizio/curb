// The streets the Boston basemap is drawn from (OpenStreetMap, the Protomaps "roads" layer at z15), read out of
// basemap/boston.pmtiles, for scripts/cities/boston.mjs to check each block's line against (boston-fixes.mjs).
// Needs the basemap toolchain (CITY=boston bash scripts/build-basemap.sh: the .pmtiles file and maplibre-gl, which
// brings pmtiles, @mapbox/vector-tile and pbf into node_modules). The build caches the result in private/cache/boston/.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const KEEP = new Set(['highway', 'major_road', 'minor_road', 'other', 'path']);
const Z = 15;
const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z); };

/** [{k: kind, d: kind_detail, n: name, c: [[lng, lat]]}] for every street piece in the bbox [w, s, e, n]. */
export async function basemapStreets(file, [W, S, E, N] = [-71.20, 42.22, -70.98, 42.40]) {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: build it with CITY=boston bash scripts/build-basemap.sh`);
  const req = createRequire(new URL('../../package.json', import.meta.url));
  const { PMTiles } = req('pmtiles');
  const { VectorTile } = req('@mapbox/vector-tile');
  const { PbfReader } = req('pbf');
  const fd = fs.openSync(file, 'r');
  const source = {
    getKey: () => file,
    async getBytes(offset, length) {
      const b = Buffer.alloc(length);
      fs.readSync(fd, b, 0, length, offset);
      return { data: b.buffer.slice(b.byteOffset, b.byteOffset + length) };
    },
  };
  const tiles = new PMTiles(source), out = [];
  try {
    for (let x = lon2x(W); x <= lon2x(E); x++) for (let y = lat2y(N); y <= lat2y(S); y++) {
      const t = await tiles.getZxy(Z, x, y);
      if (!t) continue;
      let buf = Buffer.from(t.data);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      const roads = new VectorTile(new PbfReader(buf)).layers.roads;
      if (!roads) continue;
      for (let i = 0; i < roads.length; i++) {
        const f = roads.feature(i), p = f.properties;
        if (!KEEP.has(p.kind)) continue;
        const g = f.toGeoJSON(x, y, Z).geometry;
        const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
        for (const c of lines) out.push({ k: p.kind, d: p.kind_detail || '', n: p.name || '', c: c.map(([lo, la]) => [+lo.toFixed(6), +la.toFixed(6)]) });
      }
    }
  } finally { fs.closeSync(fd); }
  return out;
}
