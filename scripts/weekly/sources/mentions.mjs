// Weekly report section: where CURB was mentioned during the report week, from free sources with
// stable, deterministic answers (a separate Claude web-search step covers the rest of the web).
//   Hacker News   Algolia search API: stories and comments that link or name curb.guide
//   Reddit        search RSS, posts only (no comments); Reddit often blocks cloud IPs such as
//                 GitHub Actions' and allows ~1 anonymous request a minute, so it is ONE request and
//                 a 403/429 becomes reddit: { blocked: true }, never a failure
//   Google News   RSS search, kept only when the headline names CURB (see refersToCurb)
//   Product Hunt  GraphQL API: the launch post (slug curb-7, launched Wed Oct 7 2026), its totals
//                 right now and the comments written during the week
//
//   import { collect } from './sources/mentions.mjs'; await collect({ week, env, fetch, now })
// Env: PH_TOKEN (optional, a Product Hunt API developer token; unset → producthunt: { skipped }).
// Section shape (dates are ISO strings, items newest first, deduped by url, inside the week only):
//   { items: [{ source, title, url, date, snippet?, points?, comments?, by?, where? }],
//     producthunt: { name, tagline, url, votes, comments, dailyRank, weeklyRank, featuredAt,
//                    launchedAt, asOf, recentComments: [{ author, body, date }] } | null | { skipped } | { error },
//     reddit?: { blocked: true } | { error }, hackerNews?: { error }, googleNews?: { error },
//     allTime: { hackerNews?, reddit? } }
// `by` is the poster's public handle (HN, Reddit), `where` the subreddit or news outlet. The
// hackerNews / googleNews / reddit keys only appear when that source failed or was blocked.
// Snippets, titles and comment bodies are third-party text: escape them when rendering.
import { addDays } from '../week.mjs';

export const DOMAIN = /\bcurb\.guide\b/i;
export const PH_SLUG = 'curb-7';
const HN_API = 'https://hn.algolia.com/api/v1/search_by_date';
const REDDIT_RSS = 'https://www.reddit.com/search.rss';
const NEWS_RSS = 'https://news.google.com/rss/search';
const PH_API = 'https://api.producthunt.com/v2/api/graphql';
const UA = 'curb-weekly-report/1.0 (+https://github.com/alevizio/curb)';
const SNIPPET = 200;      // characters of context per item
const PH_COMMENTS = 5;    // the latest few launch comments in the week
const PH_BODY = 300;      // characters per launch comment

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Decode HTML/XML entities (named basics plus numeric). */
export const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; // a bogus code point must not throw
});
/** HTML fragment → plain text on one line. */
export const plain = (html) => decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** About SNIPPET characters of text, centered on the curb.guide mention when there is one. */
export function excerpt(text, max = SNIPPET) {
  const t = plain(text);
  if (t.length <= max) return t;
  const at = t.search(DOMAIN);
  const from = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(max / 2), t.length - max));
  return `${from ? '…' : ''}${t.slice(from, from + max).trim()}${from + max < t.length ? '…' : ''}`;
}

/**
 * Does this text mean the app? Yes when it contains curb.guide, or when it spells CURB in capitals
 * (the app's name; the everyday word is lowercase or Title Case) in text that is not itself all caps,
 * next to a parking word. Checked against ~300 HN hits and ~150 Google News headlines for
 * "curb"/"CURB parking" queries (Oct 2026): no false positives.
 */
export function refersToCurb(text) {
  if (DOMAIN.test(decode(text))) return true; // before stripping tags: a link's href counts
  const t = plain(text);
  const letters = t.replace(/[^a-z]/gi, '');
  const shouting = letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.5;
  return /\bCURB\b/.test(t) && !shouting && /\b(parking|park|sweeping|street[- ](sweep|clean)\w*|tickets?|app)\b/i.test(t);
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const inWeek = (date, week) => { const t = Date.parse(date); return t >= week.start && t < week.end; };

/** Algolia search_by_date JSON → items (stories and comments that refer to CURB). */
export function parseHN(json) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits.filter((h) => refersToCurb([h.title, h.url, h.story_text, h.comment_text].filter(Boolean).join(' ')))
    .map((h) => {
      const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
      const date = iso((h.created_at_i ?? NaN) * 1000) ?? iso(Date.parse(h.created_at));
      if (h.comment_text != null) {
        return { source: 'Hacker News', title: `Comment on "${plain(h.story_title) || 'a Hacker News thread'}"`, url, date, snippet: excerpt(h.comment_text), by: h.author };
      }
      const item = { source: 'Hacker News', title: plain(h.title), url, date, points: h.points ?? 0, comments: h.num_comments ?? 0, by: h.author };
      if (h.story_text) item.snippet = excerpt(h.story_text);
      return item;
    });
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1') : '';
};
const attr = (xml, name, a) => (xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`)) || [])[1] || '';

/** Reddit search Atom feed → items, keeping only posts that contain curb.guide (search is fuzzy). */
export function parseRedditFeed(xml) {
  const entries = String(xml).match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.filter((e) => DOMAIN.test(decode(e))).map((e) => ({
    source: 'Reddit',
    title: plain(tag(e, 'title')),
    url: decode(attr(e, 'link', 'href')),
    date: iso(Date.parse(tag(e, 'published') || tag(e, 'updated'))),
    snippet: excerpt(decode(tag(e, 'content'))), // content is escaped HTML: decode once, then strip
    by: plain(tag(e, 'name')).replace(/^\/u\//, '') || undefined,
    where: decode(attr(e, 'category', 'label')) || undefined,
  }));
}

/** Google News RSS → items whose headline names CURB. Titles end in " - Outlet"; that goes to `where`. */
export function parseGoogleNews(xml) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    const where = plain(tag(it, 'source'));
    let title = plain(tag(it, 'title'));
    if (where && title.endsWith(` - ${where}`)) title = title.slice(0, -(where.length + 3));
    return { source: 'Google News', title, url: decode(tag(it, 'link')).trim(), date: iso(Date.parse(tag(it, 'pubDate'))), where: where || undefined };
  }).filter((i) => refersToCurb(i.title));
}

/** Product Hunt URLs carry the API app's utm_* tags; drop them. */
export function cleanUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
    return url.toString();
  } catch { return u || null; }
}

/** GraphQL `post` → the producthunt block (null when the post is not visible) plus the launch item if it fell in the week. */
export function parsePH(post, week, now) {
  if (!post) return { block: null, item: null };
  const url = cleanUrl(post.url);
  const recentComments = (post.comments?.edges || []).map((e) => e?.node).filter((c) => c && inWeek(c.createdAt, week))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, PH_COMMENTS)
    .map((c) => {
      const body = String(c.body || '').replace(/\s+/g, ' ').trim();
      const name = c.user?.name;
      return { author: name && name !== '[REDACTED]' ? name : null, body: body.length > PH_BODY ? `${body.slice(0, PH_BODY).trim()}…` : body, date: c.createdAt };
    });
  const block = {
    name: post.name, tagline: post.tagline ?? null, url,
    votes: post.votesCount ?? 0, comments: post.commentsCount ?? 0,
    dailyRank: post.dailyRank ?? null, weeklyRank: post.weeklyRank ?? null,
    featuredAt: post.featuredAt ?? null, launchedAt: post.createdAt ?? null, asOf: iso(now), recentComments,
  };
  const item = post.createdAt && inWeek(post.createdAt, week)
    ? { source: 'Product Hunt', title: post.tagline ? `${post.name}: ${post.tagline}` : post.name, url, date: post.createdAt, points: block.votes, comments: block.comments }
    : null;
  return { block, item };
}

/** Week filter, dedupe by url (first wins), newest first. */
export function mergeItems(lists, week) {
  const seen = new Set();
  return lists.flat().filter((i) => i?.url && i.date && inWeek(i.date, week) && !seen.has(i.url) && seen.add(i.url))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

async function get(f, url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await f(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}

async function hackerNews(f, week) {
  const search = async (query, extra) => {
    const r = await get(f, `${HN_API}?${new URLSearchParams({ query, tags: '(story,comment)', ...extra })}`);
    if (!r.ok) throw new Error(`Algolia HTTP ${r.status}`);
    return r.json();
  };
  const range = { numericFilters: `created_at_i>=${Math.floor(week.start / 1000)},created_at_i<${Math.floor(week.end / 1000)}`, hitsPerPage: '100' };
  // the domain itself, the app described in words (filtered by refersToCurb), and the all-time count
  const [byDomain, byWords, all] = await Promise.all([
    search('curb.guide', range), search('CURB parking San Francisco', range), search('curb.guide', { hitsPerPage: '0' }),
  ]);
  return { items: [...parseHN(byDomain), ...parseHN(byWords)], allTime: all.nbHits ?? 0 };
}

async function reddit(f) {
  // one request (anonymous limit is ~1/min): link posts to the site and posts that mention it
  const r = await get(f, `${REDDIT_RSS}?${new URLSearchParams({ q: 'url:curb.guide OR "curb.guide"', sort: 'new', limit: '100' })}`);
  if (r.status === 403 || r.status === 429) return { blocked: true };
  if (!r.ok) throw new Error(`Reddit HTTP ${r.status}`);
  const xml = await r.text();
  if (!xml.includes('<feed')) return { blocked: true }; // an HTML block page instead of the feed
  return { items: parseRedditFeed(xml) };
}

async function googleNews(f, week) {
  // after:/before: keep the search on the week (one spare day each side; mergeItems trims exactly)
  const when = ` after:${addDays(week.days[0], -1)} before:${addDays(week.days[6], 1)}`;
  const queries = ['"curb.guide"', 'CURB app (parking OR "street sweeping" OR "street cleaning") "San Francisco"'];
  const pages = await Promise.all(queries.map(async (q) => {
    const r = await get(f, `${NEWS_RSS}?${new URLSearchParams({ q: q + when, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`);
    if (!r.ok) throw new Error(`Google News HTTP ${r.status}`);
    return parseGoogleNews(await r.text());
  }));
  return { items: pages.flat() };
}

const PH_QUERY = `query($slug: String!) { post(slug: $slug) {
  name tagline url votesCount commentsCount dailyRank weeklyRank featuredAt createdAt
  comments(first: 20, order: NEWEST) { edges { node { body createdAt user { name } } } } } }`;

async function productHunt(f, token, week, now) {
  const r = await get(f, PH_API, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: PH_QUERY, variables: { slug: PH_SLUG } }),
  });
  if (!r.ok) throw new Error(`Product Hunt HTTP ${r.status}`);
  const j = await r.json();
  if (j?.errors?.length) throw new Error(`Product Hunt API: ${String(j.errors[0]?.message || 'error').slice(0, 80)}`);
  return parsePH(j?.data?.post ?? null, week, now);
}

const settle = (p) => p.then((value) => ({ value }), (e) => ({ error: e?.message || String(e) }));

export async function collect(ctx) {
  const { week, env, fetch: f, now } = ctx;
  const token = env.PH_TOKEN;
  const [hn, rd, gn, ph] = await Promise.all([
    settle(hackerNews(f, week)), settle(reddit(f)), settle(googleNews(f, week)),
    token ? settle(productHunt(f, token, week, now)) : Promise.resolve(null),
  ]);

  const section = { items: [], producthunt: null, allTime: {} };
  if (hn.error) section.hackerNews = { error: hn.error }; else section.allTime.hackerNews = hn.value.allTime;
  if (rd.error) section.reddit = { error: rd.error };
  else if (rd.value.blocked) section.reddit = { blocked: true };
  else section.allTime.reddit = rd.value.items.length; // newest 100 search results that really contain curb.guide
  if (gn.error) section.googleNews = { error: gn.error };
  if (!ph) section.producthunt = { skipped: 'missing PH_TOKEN' };
  else if (ph.error) section.producthunt = { error: ph.error };
  else section.producthunt = ph.value.block;

  const worked = [hn, rd, gn, ph].filter((s) => s && !s.error && !s.value?.blocked);
  if (!worked.length) {
    throw new Error(`every mention source failed: ${[hn, rd, gn, ph].filter((s) => s?.error).map((s) => s.error).join('; ') || 'Reddit blocked'}`);
  }
  section.items = mergeItems([hn.value?.items, rd.value?.items, gn.value?.items, ph?.value?.item].filter(Boolean), week);
  return section;
}
