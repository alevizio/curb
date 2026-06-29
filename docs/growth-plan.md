# CURB Growth Plan — making it findable

_Written 2026-06-12. Goal: people searching "sf street cleaning", "{neighborhood} street
sweeping", "sf parking ticket map" — or asking ChatGPT/Perplexity the same — find CURB.
Companion file: `launch-kit.md` (finished post drafts; this file is the strategy + order)._

## Already in place (don't redo)
- Titles, descriptions, canonicals, OG + Twitter cards on all 3 pages; robots.txt + sitemap.xml
- JSON-LD: WebApplication (/), WebApplication + FAQPage (/about), Article + Dataset + Breadcrumb (/tickets)
- Top nav + shared footer (internal links), press section + maker bio on /about
- Launch kit with finished Reddit / Show HN / Product Hunt / press / Nextdoor drafts
- Free data refresh path: stats, zones, white-zones, enforcement all scripted

## Week 1 — switch on the machinery (mostly Alejandro actions)

1. **Google Search Console + Bing Webmaster Tools** (~20 min, free).
   Verify curb.guide (DNS TXT via the domain registrar), submit sitemap.xml on both.
   Bing matters more than it looks: it feeds ChatGPT search and Copilot. Without GSC
   we are blind to every query that already lands here.
2. **Analytics** (WEB-45 — decide now): Vercel Web Analytics free tier. Cookieless,
   anonymous, zero config on our existing Vercel project — consistent with the
   "no accounts, no tracking, no ads" promise (it counts pageviews, not people).
   Add one disclosure line to the /about fine print. Without this, nothing below is measurable.
3. **Execute the launch-kit sequence** (assets are done, just post):
   - Tue: r/sanfrancisco (the ~20-minute-window finding — data first, app second)
   - Thu 8–10am ET: Show HN (link to /about, technical first comment ready)
   - Next Tue 12:01am PT: Product Hunt
   - Same week: press emails
   - Rolling: Nextdoor per-neighborhood template
   Respond to every comment fast — that is most of the work.
4. **Press pitch, warm angle**: The SF Standard ran the ticket-surge story June 10–11 —
   the same reporters are already linked from /about. Email them + Mission Local with
   what they DON'T have: (a) the ~20-minute enforcement-window finding, (b) our
   neighborhood surge cut of their own story, (c) the school white-zone layer built
   from SFMTA's unpublished-on-DataSF inventory. One short email each, three angles.
5. **DataSF showcase**: datasf.org features apps built on their data. Free submission,
   authoritative backlink, exactly the right audience. Mention the EAS address-join
   methodology — they like seeing their data used well.

## Month 1 — the organic engine

6. **Neighborhood pages** (WEB-47 — the biggest SEO lever left).
   `/sweeping/{hood}` for all 41 analysis neighborhoods, statically generated at build
   from data we already compute: sweep-day/hour histogram, median ticket time, ticket +
   fine totals, surge stat, heaviest streets, map deep-link centered on the hood.
   Targets the long-tail that actually converts: "street cleaning mission sf",
   "noe valley street sweeping schedule", "richmond district parking permit".
   Each page: unique title/description, FAQ block ("When is street cleaning in X?" —
   answerable from data), Dataset JSON-LD, links to adjacent hoods + both story pages.
7. **Dynamic OG images** (WEB-49): per-page cards (tickets chart for /tickets, hood
   stat cards for /sweeping/*). Social CTR is the multiplier on every share.
8. **One canonical URL per finding**: short explainer pages like /22-minutes that posts
   and tweets can link — links accumulate on one URL instead of scattering.

## Ongoing loops

9. **Monthly data drop**: stats refresh is one command; each refresh = new chart deltas →
   short X thread + a Reddit comment in old threads + dateModified bump. Fresh-content
   signal for free.
10. **AI search (GEO)**: FAQPage schema is live; keep question-phrased headings; the
    Dataset schema + downloadable stats.json is what LLM crawlers cite. After Bing
    verification, periodically ask ChatGPT/Perplexity "when does street cleaning
    happen in SF" and check whether CURB gets cited; adjust /about copy to answer
    the exact questions they're asked.
11. **Backlink targets** (slow drip, one per week): SFist/SFGate tips lines,
    awesome-civic-tech + awesome-open-data GitHub lists (repo is public),
    SF Civic Tech (sfcivictech.org) demo night, parking/urbanism newsletters,
    @DataSF on X (they amplify showcase apps; tag them on the launch thread).
12. **X thread template** (pin after launch):
    1/ SF posts a 2-hour street-cleaning window. I matched ~815k tickets to blocks
       (of ~1M): on the median block every ticket lands in a ~20-MINUTE span. [chart]
    2/ Built curb.guide — every curb colored by its next sweep. Tap your block,
       see when tickets actually land there. [video]
    3/ It knows the permit areas, meters, loading zones — even the white school
       zones SFMTA doesn't publish on DataSF. [screenshot]
    4/ Free, no account, no ads. Data: DataSF. Posted sign always wins. curb.guide

## Measure (weekly, 10 min)
- GSC: impressions/clicks per query — watch "street cleaning" + hood names
- Analytics: referrers on launch days; /tickets vs / entry split
- Activation: alert subscribers (KV count), PWA installs
- KPIs at 90 days: 1k organic visits/mo · 3 press mentions · 200 alert subscribers

## Done this round (2026-06-12)
- Dataset + Article + BreadcrumbList JSON-LD on /tickets (Google Dataset Search eligibility)
- og:image:alt on /tickets; sitemap lastmod refreshed
