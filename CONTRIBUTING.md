# Contributing to CURB

Thanks for looking under the hood. CURB is deliberately small: one static
`index.html` (vanilla JS + Leaflet, no build step), two story pages, a handful of
Vercel serverless functions for Web Push, and precomputed JSON data assets. Keeping
it that way is a feature — please don't introduce frameworks, bundlers, or build
steps.

## Quick start

```bash
npm install        # only for the web-push dep used by the API routes
npm run dev        # http://localhost:3000 (localhost origin needed for geolocation + SW)
```

The map works immediately against live DataSF APIs. Push notifications need env
setup — see the README.

## Ground rules

- **Vanilla JS, no build.** If your change needs a transpiler, it doesn't fit.
- **The posted sign is the source of truth.** Any feature that predicts or infers
  (ticket times, truck routes) must say so in the UI and never present itself as
  official guidance.
- **Free infrastructure only.** Everything runs on free tiers (Vercel Hobby,
  Upstash free, GitHub Actions on a public repo, keyless public APIs). PRs that
  require paid services won't be merged.
- **Privacy promise.** No accounts, no ads, no cookies, no tracking of people.
  Don't add SDKs that phone home.
- **Design system.** Paper `#F2ECDF` / ink `#17150F`, Anton + Hanken Grotesk, hard
  offset shadows, design tokens in `:root`. Match the existing language; no
  inline-style one-offs.
- **Data layers** follow the snapshot pattern: fetch at build time via a
  `scripts/build-*.mjs` script, commit the JSON artifact, never query undocumented
  feeds live from clients.

`CLAUDE.md` documents the architecture, data schemas, and a "don't regress" list —
read it before touching the map internals.

## Data corrections

Wrong schedule on your block? That's usually upstream DataSF data, not CURB code.
Open an issue with the block + what the posted sign says — there's an issue
template for it. If it reproduces in the raw dataset (`yhqp-riqs`), report it to
DataSF too; CURB inherits their fixes on the next data refresh.

## Pull requests

- One logical change per PR, conventional commit messages (`feat:`, `fix:`, …).
- Verify locally: open the map, tap a block, toggle every layer, check the browser
  console is clean. For story-page changes, check mobile (≤520px) and desktop.
- Don't commit `data/*.json` regenerations unless the PR is about the data.
- Don't commit secrets — `.env` and `config.js` are gitignored for a reason.

## Asking "can CURB do this for my city?"

The honest answer: the code is MIT-licensed and the patterns transfer, but every
data pipeline here is SF-specific (DataSF dataset IDs, EAS address joins, SFMTA
quirks). A port is a fork with new `scripts/build-*.mjs` files, not a config flag.
If you build one, tell us — we'll link it.
