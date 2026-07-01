#!/usr/bin/env python3
# Build data/routes.json from SF DPW's "All Sweeps on All Blocks" schedule (public-records request #26-5451).
# Gives each block its real DPW sweeper ROUTE (# + name) — the data behind CURB's Truck Routes layer.
#
# The source .xls is a ~2010-vintage schedule (base created 2008, re-exported by DPW 2026-07-01). We use it
# ONLY for the route ASSIGNMENT per block; days/hours come from the live DataSF schedule (yhqp-riqs), which is
# current, so this file's stale timing never drives CURB. Keyed per CNN (not per side): CURB's enforcement /
# sweep lines are already per-CNN, and a block's two sides sit on the same route the overwhelming majority of
# the time (the script prints the divergence). The .xls is not committed (large historical export) — set
# CURB_SWEEP_SCHEDULE_XLS to point at it. Local build only (needs `pip install xlrd`); like
# build-enforcement-records.py it is intentionally NOT in the data-refresh CI workflow.
import xlrd, json, os, sys, datetime
from collections import Counter, defaultdict

XLS = os.environ.get("CURB_SWEEP_SCHEDULE_XLS", os.path.expanduser("~/Downloads/AllSweepsOnAllBlocks062410.xls"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "routes.json")

if not os.path.exists(XLS):
    sys.exit(f"schedule .xls not found: {XLS}\nSet CURB_SWEEP_SCHEDULE_XLS to the AllSweepsOnAllBlocks*.xls path.")

sh = xlrd.open_workbook(XLS).sheet_by_index(0)
# cols: 0 Street | 1 CNN | 2 Block Description | 3 Side (L/R) | 6 Sweeper Route # | 7 Route Name
name_by_num = {}
conflicts = Counter()
cnn_routes = defaultdict(Counter)          # cnn -> Counter{route#}   (all sides/days)
side_dom = defaultdict(dict)               # cnn -> {L: route#, R: route#}  (for divergence check)
_side_c = defaultdict(lambda: defaultdict(Counter))
rows = 0
for i in range(1, sh.nrows):
    cnn = sh.cell_value(i, 1)
    if cnn in (None, ""):
        continue
    cnn = str(int(cnn)) if isinstance(cnn, float) else str(cnn).strip()
    side = str(sh.cell_value(i, 3)).strip().upper()
    rn = sh.cell_value(i, 6)
    try:
        rnum = int(rn) if isinstance(rn, (int, float)) else int(float(rn))
    except (TypeError, ValueError):
        continue
    rname = str(sh.cell_value(i, 7)).strip()
    rows += 1
    cnn_routes[cnn][rnum] += 1
    if side in ("L", "R"):
        _side_c[cnn][side][rnum] += 1
    if rname:
        if rnum in name_by_num and name_by_num[rnum] != rname:
            conflicts[rnum] += 1
        name_by_num.setdefault(rnum, rname)

# dominant route per CNN (across all its sides/days)
blocks = {cnn: c.most_common(1)[0][0] for cnn, c in cnn_routes.items()}

# how often do the two sides of a block sit on different dominant routes?
diverge = 0; both = 0
for cnn, sides in _side_c.items():
    if "L" in sides and "R" in sides:
        both += 1
        if sides["L"].most_common(1)[0][0] != sides["R"].most_common(1)[0][0]:
            diverge += 1

out = {
    "_meta": {
        "source": "SF DPW — All Sweeps on All Blocks (records request #26-5451, released 2026-07-01; base schedule ~2010 vintage)",
        "note": "Real DPW sweeper route per block (CNN). Days/hours come from live DataSF (yhqp-riqs); this file's schedule is historical and never drives timing.",
        "generated": datetime.date.today().isoformat(),
        "blocks": len(blocks),
        "routes": len(name_by_num),
    },
    "routeNames": {str(k): name_by_num[k] for k in sorted(name_by_num)},
    "blocks": blocks,   # cnn -> route#
}
json.dump(out, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)
print(f"rows used:     {rows}")
print(f"blocks (CNNs): {len(blocks)}")
print(f"routes:        {len(name_by_num)}")
print(f"L/R diverge:   {diverge} of {both} two-sided blocks ({100*diverge/max(1,both):.1f}%) — CNN-level keeps the dominant")
if conflicts:
    print(f"route#>1 name: {dict(conflicts)} (kept first)")
print(f"wrote {os.path.relpath(OUT)} ({os.path.getsize(OUT):,} bytes)")
