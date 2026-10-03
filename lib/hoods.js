// Which SF neighborhoods get a /n/<slug> page — one rule shared by the page builder
// (scripts/build-hood-pages.mjs) and the block-schedule bake (scripts/build-schedules.mjs), so a
// /b/ page never links a neighborhood page the build didn't write.
export const MIN_TICKETS = 1500; // editorial floor — below this a hood page is too thin to be useful

export const slug = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Retired 27 Sep 2026: park land with only a handful of swept blocks (thin pages). They 301 to /n/
// (vercel.json), so they stay retired even though the GPS totals put them over the ticket floor.
export const RETIRED = new Set(['presidio', 'golden-gate-park']);

// stats.json hoods (already sorted desc by ticket count) that get a page
export const pagedHoods = (stats) => (stats.hoods || []).filter((h) => h.n >= MIN_TICKETS && slug(h.hood) && !RETIRED.has(slug(h.hood)));
