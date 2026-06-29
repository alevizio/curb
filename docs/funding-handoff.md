# CURB — funding & launch handoff brief

**For:** a cloud agent / coworker executing CURB's remaining funding, repo, and launch tasks on Alejandro's behalf.
**Owner:** Alejandro Vizio · **Updated:** 2026-06-29

Each task below has a one-paragraph instruction + links; the **full step-by-step lives in the linked Linear ticket** (open it for the detailed checklist, gotchas, and any ready-to-paste copy — but read the "Use these numbers" section first, because some tickets contain stale figures).

---

## CURB in 30 seconds
**CURB** (<https://curb.guide>) is a free, open-source (MIT) map of San Francisco street-parking rules — block by block — that also shows *when street-cleaning tickets actually get written*, reconstructed from the city's complete citation record. No accounts, no ads, no tracking. Built and maintained solo by Alejandro, entirely on public San Francisco open data (DataSF). Live web app + a free iOS app (App Store). Featured by **SFGate** (June 2026).

## ⚠️ Use THESE numbers — not the old ones
Several Linear tickets and older drafts contain **stale figures**. Always use the corrected, verified ones:

| Use this ✅ | Never use this ❌ |
|---|---|
| ~1,000,000 GPS-located citations (≈815,000 matched to blocks) | 659,000 / 650,000 |
| Posted 2-hr window is really **~20 minutes** | "~22 minutes" |
| ~77% within 45 min · ~90% within the first hour | "87%" |
| Steiner 200-block: **221 tickets, median 9:11, 90% by 9:21** | "203 / 9:14 / 9:39" |
| Mission: **97,805 tickets / ~$10.3M**, #1, peaks 8am Thursdays | "71,129 / $7.2M" |
| Sweeper GPS: ticket lands **~19 min after the sweeper**, 190 blocks | — |

Source: SFMTA citations via records request **#26-5453**; sweeper-GPS via **#26-5451**. Verified + reproducible from this repo.

## Credibility line to reuse verbatim
> Featured in **SFGate** (June 2026) — https://www.sfgate.com/local/article/sf-street-sweeping-app-22317534.php · 2,500+ visitors · SFMTA has **not objected** to its use of public data.

Also: **The Dissent SF** (June 2026), "After $2,000 in sweeping tickets, a Haight developer read the city's own data." A full impact one-pager is at **`docs/traction.md`** in this repo — reuse it for applications.

## ✅ Already done — do NOT redo
- `funding.json` (corrected) + `.well-known/funding-manifest-urls` + `SECURITY.md` exist at repo root.
- Repo hardening: **Dependabot** (`.github/dependabot.yml`) and **CodeQL** (`.github/workflows/codeql.yml`) are enabled via files.
- **Traction one-pager** at `docs/traction.md`.
- **The ~$200/mo Google Maps bill is already stopped** — the app was flipped to free CARTO basemap tiles (commit on `main`). So the *cost emergency is over*; Google-credit tickets are now optional, not urgent.

## Global rules
- **Deploy order:** always `git push origin HEAD:main` FIRST (prod branch = main; Vercel git-integration). Verify on curb.guide before submitting any URL to a funder.
- **No PII:** CURB stores no user data; the serverless API handles public DataSF data only — say this in security/grant narratives.
- **The `@curb.guide` email (Task 0) unblocks everything** — Google for Startups auto-rejects gmail addresses; do it first.
- **Donation rails are paused** — Alejandro is sorting Stripe and asked to hold the on-site donation link (it's been removed from the footer). **Confirm with him before setting up GitHub Sponsors / Ko-fi / re-adding any donate link.**

---

## Tasks (in suggested order)

### 0 · Prerequisite — unblocks everything · ALE-192 (In Progress)
Set up **`alejandro@curb.guide`** (or `hello@curb.guide`) — cheapest is Cloudflare Email Routing (free, forwards to Gmail). Then surface the SFGate credibility line **above the fold in the GitHub README** and on the **curb.guide About/press page**. *(The traction one-pager is already done.)*
→ https://linear.app/alevizio/issue/ALE-192

### 1 · FLOSS/fund — the grant anchor ($10k+) · ALE-194 (In Progress)
`funding.json` is already live in the repo. Validate it at <https://dir.floss.fund/validate>, then **submit the URL `https://curb.guide/funding.json`** at <https://dir.floss.fund/submit>. Ask the **$10k floor**. Rolling; quarterly review. *(Don't paste the JSON from the ticket — it's an old draft with stale numbers; the live file is correct.)*
→ https://linear.app/alevizio/issue/ALE-194

### 2 · GitHub Secure Open Source Fund ($10k) · ALE-196 (In Progress)
Hardening is mostly done (Dependabot + CodeQL via files, SECURITY.md exists). **Remaining:** enable **secret scanning** (repo Settings → Security), optionally pin the Actions cron to a commit SHA, then **submit the form** (link in ticket). Frame it as *security hardening of real civic infrastructure* (SFGate + 2,500 visitors), not "fund my hosting."
→ https://linear.app/alevizio/issue/ALE-196

### 3 · Donation rails — CONFIRM FIRST · ALE-195 (Backlog)
GitHub Sponsors (recurring) + Ko-fi (one-off), both 0% platform fee; produces the channel URL `funding.json` references. **Hold until Alejandro confirms** (Stripe decision in progress). If approved: enable 2FA on GitHub, set up Sponsors + Ko-fi, add `.github/FUNDING.yml`, and a tasteful footer link.
→ https://linear.app/alevizio/issue/ALE-195

### 4 · Cloudflare Project Alexandria (open now) + Vercel OSS · ALE-197 (Backlog)
Infra credits that zero out everything *except* tiles (Vercel, Workers/KV/R2, Upstash). Cloudflare Alexandria is open + rolling — **apply now**; Vercel OSS reopens ~Aug 2026.
→ https://linear.app/alevizio/issue/ALE-197

### 5 · Google for Startups + Maps credit — NOW OPTIONAL · ALE-193 (Backlog)
Would give ~$600/mo Maps credit + $2k GCP. **Only worth it if Alejandro wants to keep Google tiles as an option** — the bill is already $0 on CARTO. Note the two-step trap (GCP credit and Maps credit are separate applications). Needs the @curb.guide email (Task 0).
→ https://linear.app/alevizio/issue/ALE-193

### 6 · Bigger/slower money — needs decisions · ALE-199 (Backlog)
Open Source Collective fiscal host (the entity/bank-account unlock) · **Fast Forward ($25k, applications open Jul 30)** · NLnet (after summer). Each needs a decision or a future window — queue, don't rush.
→ https://linear.app/alevizio/issue/ALE-199

### 7 · Outreach — Automotus + OMF/CDS · ALE-189 (In Progress)
Build relationships in the curb-data / open-mobility world. Sequence: warm-up via OMF/CDS (reply to Michael Schnuerle's LinkedIn CDS comment + a friendly CDS GitHub discussion) → then Automotus. Drafts are in the ticket.
→ https://linear.app/alevizio/issue/ALE-189

### 8 · Product Hunt launch · ALE-181 (In Progress)
Launch-day centerpiece. Assets are prepared (gallery/trailer paths in the ticket). Being present all day to reply is the work. Coordinate the date with Alejandro.
→ https://linear.app/alevizio/issue/ALE-181

---

## Where things live
- **Repo:** <https://github.com/alevizio/curb> (work on `main`; push triggers Vercel deploy)
- **Traction one-pager:** `docs/traction.md` · **Funding manifest:** `funding.json` · **Security policy:** `SECURITY.md`
- **Open dataset:** `data/sweeper-gps/` · **Press kit:** <https://curb.guide/press> · **Changelog:** <https://curb.guide/changelog>
- **Linear board:** Curb project, Alevizio (ALE) team — <https://linear.app/alevizio/project/curb-6a0e35314fec>

## Report back to Alejandro
For each task: what was submitted/created (with the link or confirmation #), what's pending a decision from him, and anything that needs his login/2FA/payment. Don't make payments, sign agreements, or change donation/Stripe settings without his explicit OK.
