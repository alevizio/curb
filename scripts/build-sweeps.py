#!/usr/bin/env python3
# Build data/sweeps.json — when the street sweeper ACTUALLY passes each block — from the SF Public
# Works AVL "Advanced Trips Detail" GPS data (records request #26-5451). Same shape as enforcement.json:
#   { "<cnn>": { "<jsDow>": [n, avgMin, loMin, hiMin] }, "_meta": {...} }
import openpyxl, json, math, sys, glob, os, datetime
import urllib.request, urllib.parse
import numpy as np
from shapely import STRtree, points, LineString

TRIPDIR = "/Users/alevizio/Downloads/26-5451_2026-06-26 14_35_30 -0700"
OUT = "/private/tmp/claude-501/-Users-alevizio/70280dca-066e-48ef-a199-c71bc5209b0d/scratchpad/sweeps.json"
ENF = "/Users/alevizio/curb/data/enforcement.json"
TOL_M = 40.0
MIN_N = 4
SFLAT, SFLON = (37.69, 37.84), (-122.53, -122.34)
LAT0, LON0 = 37.7749, -122.4194
KX = math.cos(math.radians(LAT0)) * 111320.0; KY = 110540.0
def proj(lon, lat): return ((lon - LON0) * KX, (lat - LAT0) * KY)
DAY = {'sun':0,'mon':1,'tue':2,'wed':3,'thu':4,'fri':5,'sat':6}

def fetch(url, params):
    u = url + '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'curb-sweeps'}), timeout=90) as r:
        return json.load(r)

# 1) segments + schedule
print("fetching segments…", file=sys.stderr)
rows = fetch('https://data.sfgov.org/resource/yhqp-riqs.json', {'$select':'cnn,weekday,fromhour,tohour,line','$limit':'45000'})
seg_line, sched = {}, {}
for r in rows:
    cnn = r.get('cnn')
    if not cnn: continue
    wd = r.get('weekday')
    if wd:
        dow = DAY.get(wd.strip().lower()[:3])
        try: fromH = int(float(r.get('fromhour')))
        except (TypeError, ValueError): fromH = None
        if dow is not None and fromH is not None:
            try: toH = int(float(r.get('tohour')))
            except (TypeError, ValueError): toH = fromH + 2
            sched.setdefault(cnn, {})[dow] = (fromH*60, toH*60)
    if cnn not in seg_line:
        ln = r.get('line')
        if ln and ln.get('coordinates'):
            try: seg_line[cnn] = LineString([proj(c[0], c[1]) for c in ln['coordinates']])
            except Exception: pass
cnns = list(seg_line.keys())
tree = STRtree([seg_line[c] for c in cnns])
print(f"  {len(cnns)} segments", file=sys.stderr)

# 2) parse sweeper trips from all xlsx Data sheets
print("reading sweeper trips…", file=sys.stderr)
xs, ys, mins, dows = [], [], [], []
for p in sorted(glob.glob(os.path.join(TRIPDIR, "*.xlsx"))):
    ws = openpyxl.load_workbook(p, read_only=True)["Data"]
    it = ws.iter_rows(values_only=True); hdr = False
    for r in it:
        if not r: continue
        if r[0] == 'DeviceName': hdr = True; continue
        if not hdr or r[0] is None: continue
        lat, lon, st = r[18], r[19], r[13]
        if not isinstance(lat,(int,float)) or not isinstance(lon,(int,float)) or not hasattr(st,'hour'): continue
        if not (SFLAT[0] <= lat <= SFLAT[1] and SFLON[0] <= lon <= SFLON[1]): continue
        x, y = proj(lon, lat)
        xs.append(x); ys.append(y); mins.append(st.hour*60 + st.minute); dows.append((st.weekday()+1)%7)
xs = np.asarray(xs); ys = np.asarray(ys); mins = np.asarray(mins, np.int32); dows = np.asarray(dows, np.int8)
print(f"  {len(xs)} sweeper GPS points in SF", file=sys.stderr)

# 3) match to nearest segment + aggregate (only on a swept day, near the posted window)
acc = {}
res, dist = tree.query_nearest(points(xs, ys), return_distance=True, all_matches=False)
matched = 0
for j in range(len(res[0])):
    if dist[j] > TOL_M: continue
    cnn = cnns[int(res[1][j])]; sc = sched.get(cnn)
    if not sc: continue
    dow = int(dows[int(res[0][j])]); minute = int(mins[int(res[0][j])])
    if dow not in sc: continue
    fromMin, toMin = sc[dow]
    if minute < fromMin - 30 or minute > toMin + 60: continue   # sweeper passes during/around the window
    matched += 1
    a = acc.get((cnn, dow))
    if a is None: a = [0, 0, 1440, 0]; acc[(cnn, dow)] = a
    a[0] += 1; a[1] += minute; a[2] = min(a[2], minute); a[3] = max(a[3], minute)

out = {}; kept = 0; blocks = set()
for (cnn, dow), a in acc.items():
    if a[0] < MIN_N: continue
    out.setdefault(cnn, {})[str(dow)] = [a[0], round(a[1]/a[0]), a[2], a[3]]
    kept += 1; blocks.add(cnn)
print(f"\nmatched {matched} passes → {len(blocks)} blocks / {kept} side-days (>= {MIN_N} passes)", file=sys.stderr)

# 4) validate vs tickets: where we have BOTH, does the sweeper come before the ticket?
leads = []
try:
    enf = json.load(open(ENF))
    for cnn, days in out.items():
        ed = enf.get(cnn)
        if not ed: continue
        for dow, v in days.items():
            if dow in ed:
                leads.append(ed[dow][1] - v[1])   # ticket avg − sweeper avg (min)
except Exception as e:
    print("enf compare skipped:", e, file=sys.stderr)
print("\n=== VALIDATION: sweeper vs ticket ===")
if leads:
    L = np.array(leads)
    print(f"blocks with both sweeper + ticket data: {len(L)}")
    print(f"ticket lands a median of {int(np.median(L))} min AFTER the sweeper passes (mean {L.mean():.0f})")
    print(f"  sweeper-before-ticket on {100*(L>0).mean():.0f}% of those block-days")

out["_meta"] = {
    "generated": datetime.datetime.now().isoformat(timespec="seconds"),
    "window": "2026-03-01 to 2026-06-25", "min_passes": MIN_N, "blocks": len(blocks), "side_days": kept,
    "source": "SF Public Works fleet AVL 'Advanced Trips Detail' (broom sweepers), records request #26-5451",
    "method": "sweeper GPS matched to nearest CNN segment (<=40m), passes during the posted window, by cnn x jsDow",
    "note": "avgMin/loMin/hiMin = local minutes-of-day of the sweeper pass; dow is JS getDay (0=Sun).",
}
json.dump(out, open(OUT, "w"))
print(f"\nwrote {OUT} ({os.path.getsize(OUT)//1024} KB) — {len(blocks)} blocks", file=sys.stderr)
