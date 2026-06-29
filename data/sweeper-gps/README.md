# SF street-sweeper GPS — public-records dataset

The real GPS movements of San Francisco's **broom-sweeper fleet**, obtained through a public-records
request and published here openly so anyone can use it. This is the data behind CURB's *"🧹 Sweeper
passes ~9:04a"* lines and the finding that **a street-cleaning ticket lands a median of ~19 minutes
after the sweeper actually passes** (the truck is first on ~76% of blocks where we have both).

## 🙏 Thank you, San Francisco

Thank you to **San Francisco Public Works** for fulfilling the request and sharing this data, and to
**SFMTA** for the citation records that pair with it. Open data makes projects like CURB possible.

## Source & dates

| Dataset | Agency | Records request | Released |
|---|---|---|---|
| `sweeper-trips.csv` (this file) | SF Public Works | **#26-5451** | **June 26, 2026** (two rolling batches) |
| Street-cleaning citations (not bundled — ~1M rows) | SFMTA | **#26-5453** | **June 25, 2026** |

The source was the Public Works fleet AVL **"Advanced Trips Detail Report"** (10 broom-sweeper
vehicles, **March 1 – June 25, 2026**). The request is fulfilled on a rolling basis, so more may follow.

## What's in `sweeper-trips.csv`

10,525 unique trips (exact duplicate rows removed). One row = one logged trip for one truck.

| column | meaning |
|---|---|
| `vehicle_id` | the sweeper's AVL device id (10 distinct trucks) |
| `trip_start` / `trip_stop` | local timestamps (America/Los_Angeles) |
| `latitude` / `longitude` | the trip's GPS point |
| `location` | the city's reverse-geocoded address for that point |
| `distance_mi` | trip distance in miles |

## Honest caveats

- **One GPS point per trip**, not a dense breadcrumb track — great for *when* a sweeper passed a block,
  but **not dense enough to redraw exact street routes** (CURB's "Truck routes" layer stays inferred/Beta).
- **~36% of points sit at the Cesar Chavez yard** (deadheading, not sweeping) — CURB filters those out by
  only counting passes that fall on a swept block during its posted window.
- **Historical, not live** (Mar–Jun 2026). The posted street sign is always the source of truth.

## Derived product

`../sweeps.json` — each block's typical sweeper-pass time, built from this file by
[`scripts/build-sweeps.py`](../../scripts/build-sweeps.py): dedupe → match each GPS point to the nearest
street-segment (CNN, ≤40 m) → keep passes inside the posted window → aggregate by block × weekday
(≥3 passes). 190 blocks / 239 side-days so far, growing as the city releases more.

All public record. CURB is open source under the MIT license.
