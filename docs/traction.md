# CURB — traction & impact (funder one-pager)

A copy-paste sheet for grant applications, sponsors, and fiscal hosts. Last updated 2026-06-29.
All figures are reconstructed from San Francisco's public open data and are reproducible from this repo.

**CURB** — <https://curb.guide> · free, open-source (MIT), no accounts, no ads, no tracking.

---

## One line
A free map of San Francisco street-parking rules — block by block — that shows the part no sign tells you: **when street-cleaning tickets actually get written.**

## The problem we surfaced
San Francisco posts a **two-hour** street-cleaning window on every block, but the ticket doesn't wait two hours. By obtaining the city's **complete street-cleaning citation record — about 1,000,000 GPS-located citations (≈815,000 matched to their exact blocks)** via public-records request #26-5453, and matching each to the block it was written on, CURB found:

- The posted 2-hour window is really **~20 minutes** of real risk — the typical block's tickets land in a **~15-minute burst**, a median of **~25 minutes** into the window.
- **~77%** of tickets are written within the first **45 minutes**; **~90%** within the first **hour**.
- Example — **214–255 Steiner St** (posted 9–11am): 221 tickets, median at **9:11am**, 90% written by **9:21am**.
- Heaviest neighborhood: the **Mission** — **97,805 tickets / ~$10.3M**, peaking 8am Thursdays.

CURB also obtained the street sweepers' **actual GPS** (records request #26-5451) and confirmed the story directly: the ticket lands a median of **~19 minutes after the sweeper passes** (190 blocks covered and growing). The dataset is published openly in the repo.

## Press
- **SFGate** (June 2026) — feature on CURB; noted SFMTA has **not objected** to the app's use of public data, and that CURB had drawn 2,500+ visitors.
- **The Dissent SF** (June 2026) — "After $2,000 in sweeping tickets, a Haight developer read the city's own data."

## Traction
- Live at **curb.guide**; free native **iOS app** on the App Store (WebView wrapper of the same site).
- Move-your-car **push alerts** (evening-before + ~30 min before sweeping) and calendar reminders.
- **Open source** under MIT — the whole app, data pipelines, and the raw sweeper-GPS dataset are public.
- Built and maintained **solo** in ~a month, entirely on **public San Francisco open data (DataSF)**.

## What it runs on / sustainability ask
Infrastructure (basemap tiles, domain, Vercel serverless API, Redis for the push backend) plus a maintenance stipend keep CURB free and ad-free for the whole city. Funding extends new public-records data pipelines and expands sweeper-GPS coverage citywide.

## Links
- Site: <https://curb.guide> · Press kit: <https://curb.guide/press> · Changelog: <https://curb.guide/changelog>
- Source: <https://github.com/alevizio/curb> · License: MIT
- Open dataset: `data/sweeper-gps/` (raw SF Public Works sweeper-GPS trips + provenance)
- Records requests: SFMTA citations #26-5453 · SF Public Works sweeper-GPS #26-5451
