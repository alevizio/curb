#!/usr/bin/env python3
# Regenerate data/stats.json `hoods` from the GPS records pull (SFMTA request #26-5453): point each
# GPS-located street-cleaning citation into an SF Analysis Neighborhood (DataSF j2bu-swwd) and roll up
# n + rev (rev = n * $105, the flat street-cleaning fine, which reproduces the canonical figures e.g.
# Mission 97,805 -> ~$10.3M). Run this AFTER `npm run build:stats` — build-stats.mjs rebuilds the rest of
# stats.json from the lossy address->EAS join and would otherwise leave the per-hood totals understated.
#   usage:  CURB_CITATIONS_XLSX=/path/to/TRC7.2.22_*.xlsx  python3 scripts/build-hood-stats.py
import openpyxl, json, os, sys, urllib.request, urllib.parse, datetime
import numpy as np
from shapely import STRtree, points as shp_points
from shapely.geometry import shape

XLSX  = os.environ.get("CURB_CITATIONS_XLSX", "/Users/alevizio/Downloads/TRC7.2.22_1.1.2024_06.24.2026.xlsx")  # records #26-5453 (not redistributable)
STATS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "stats.json")
FINE  = 105  # flat SF street-cleaning fine (assessed, not collected), 2024-2026

# 1) SF Analysis Neighborhoods
u = 'https://data.sfgov.org/resource/j2bu-swwd.json?' + urllib.parse.urlencode({'$select': 'nhood,the_geom', '$limit': '100'})
nb = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'curb-hoodstats'}), timeout=90))
names, polys = [], []
for r in nb:
    g = r.get('the_geom')
    if not g:
        continue
    try:
        polys.append(shape(g)); names.append(r['nhood'])
    except Exception:
        pass
tree = STRtree(polys)
print(f"{len(polys)} neighborhoods", file=sys.stderr)

# 2) citations -> lon/lat
ws = openpyxl.load_workbook(XLSX, read_only=True).active
it = ws.iter_rows(values_only=True); next(it)
xs, ys = [], []
for r in it:
    la, lo = r[6], r[7]
    if isinstance(la, (int, float)) and isinstance(lo, (int, float)) and -123 < lo < -122 and 37 < la < 38:
        xs.append(lo); ys.append(la)
print(f"{len(xs)} GPS citations", file=sys.stderr)

# 3) point-in-polygon rollup
res = tree.query(shp_points(np.asarray(xs), np.asarray(ys)), predicate='intersects')  # (point_idx, poly_idx)
from collections import Counter
cnt = Counter(names[int(res[1][k])] for k in range(res.shape[1]))
matched = sum(cnt.values())
hoods = [{"hood": h, "n": n, "rev": round(n * FINE)} for h, n in sorted(cnt.items(), key=lambda kv: -kv[1])]
print(f"matched {matched} into hoods; top: {hoods[:5]}", file=sys.stderr)

# 4) patch stats.json (only the `hoods` array + provenance; the rest of the file is untouched)
d = json.load(open(STATS))
d["hoods"] = hoods
d["_meta"]["generated"] = datetime.datetime.now().isoformat(timespec="seconds")
d["_meta"]["source"] = "SFMTA public-records request #26-5453 (GPS-geocoded) point-in-polygon to SF Analysis Neighborhoods"
d["_meta"]["note"] = "rev = n * $105 flat street-cleaning fine (assessed, not collected). hoods = GPS-located street-cleaning citations, 2024-2026."
d["_meta"]["matched_total"] = matched
json.dump(d, open(STATS, "w"))
print(f"PATCHED {STATS}: {len(hoods)} hoods, {matched} matched", file=sys.stderr)
