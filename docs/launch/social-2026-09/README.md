# CURB update · social posts

> In the repo since 16 Oct 2026: the posted images and texts only. The `_build/` folder (design sources,
> screenshots, node_modules) was not kept, so the parts below that mention it no longer apply.

The story of the Sep 27 update (iOS 1.0.2): a 1 star review titled "No longer working" is my QA team. Harsh. Accurate. Hired. Each frame shows one thing they got me to ship.

All three were posted on Sep 28. The preview page with copy buttons was deleted afterwards; `node _build/preview/gen.mjs` can rebuild it if it's ever needed again.

## What's in here

| Folder | What to post | Instructions |
|---|---|---|
| `instagram-story/` | `ig-s01.png` to `ig-s06.png`, in order | `POST.md`: stickers (frames 1, 3 and 6), alt text, optional feed caption |
| `linkedin/` | The post text plus `curb-linkedin-carousel.pdf` as a document | `POST.md`: post, PDF title, first comment with the links. The `li-0N.png` files are the PDF's pages, for review only |
| `x-thread/` | 6 posts, `x-1.png` on post 1 and so on | `POST.md`: the 6 posts with counts, image descriptions |
| `_build/` | Nothing. Only needed to change a design | Sources, screenshots, the brief and the storyboard |

Numbers used everywhere: 8,000+ visitors, 380 iPhone downloads, 4.2 stars (5 ratings), 134 alert sign ups, press in SFGate and The Dissent SF.

## Changing a design

Sources are in `_build/src/` (`story/`, `linkedin/`, `x/`), shared styles in `_build/src/common.css` and `frames.js`. Re-render everything with:

```
PATH=$HOME/.local/bin:$PATH node ~/Desktop/curb-social-2026-09/_build/src/render.mjs story linkedin x
```

It writes the PNGs into the three platform folders and rebuilds the LinkedIn PDF, and checks every frame: fonts and images loaded, exact size, no dashes or italics, nothing rotated, the CURB logo untouched, screenshots uncropped, notification text verbatim, Story text inside the safe area. A line starting with `!` is a failure.

Screenshots of curb.guide live in `_build/screenshots/` (see its `manifest.md`). To retake some: `PATH=$HOME/.local/bin:$PATH node _build/screenshots/src/capture.mjs P2 D2`. Map shots need a Sunday after 9 PM to match. The spec for this version is `_build/storyboard.md`, the verified facts are in `_build/brief.md`.

Older versions (the v1 carousel, the v2 builder story with the ticket data, old screenshots) were moved to the Trash on Sep 28, in `curb-social-old-2026-09-28`, until you empty it.
