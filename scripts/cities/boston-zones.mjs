// The Curb Lab's curb records → data/boston/zones.json, the data behind Parking mode on the Boston page. Used by
// scripts/cities/boston.mjs; tested in boston-zones.test.mjs. lib/boston-parking.js grades what this writes.
//
// One City record often lists every sign on a block, and a sign's photo can be unreadable, so a record alone can't say what
// a curb allows. This file only sorts each sign. The rules that weigh them (and the street check behind those rules,
// 5 Nov 2026, private/boston-parking-mode/stage0/results.md) are in lib/boston-parking.js.
import { classifyPolicy, clean, DOW3, isSweepSign } from './boston-curbs.mjs';

const UNREADABLE = 'unusable image';
const mask = (values) => values.reduce((m, v) => m | (1 << v), 0);
const minutes = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : 0; };

// One span → [days, from, to, weeks, months]: bit masks (days bit 0 = Sunday, weeks bit 0 = the 1st of that weekday in the
// month, months bit 0 = January; weeks and months 0 = all) and minutes after midnight (from = to = all day).
export function spanWindow(t) {
  const days = clean(t.days_of_week).map((d) => DOW3.indexOf(d)).filter((d) => d >= 0);
  const weeks = clean(t.weeks_of_month).map((w) => +w - 1).filter((w) => w >= 0 && w < 5);
  const months = clean(t.months).map((m) => +m - 1).filter((m) => m >= 0 && m < 12);
  return [days.length ? mask(days) : 127, minutes(t.time_of_day_start), minutes(t.time_of_day_end), mask(weeks), mask(months)];
}

// What a sign does to a driver while it's in force, or null when it does nothing to one.
function stateOf(rules, sorted) {
  const k = sorted.map(([layer]) => layer);
  if (k.includes('nostop') || k.includes('loading')) return 'no';
  if (k.includes('permit')) return sorted.find(([layer]) => layer === 'permit')[1].only ? 'restricted' : 'limit';
  if (k.includes('accessible')) return 'restricted';
  if (k.includes('paid')) return 'paid';
  if (k.includes('limit')) return 'limit';
  if (rules.some((r) => r.activity === 'parking')) return 'clear';
  return rules.some((r) => /^no (parking|stopping)$/.test(r.activity)) ? 'no' : null;
}

/** One City policy → what lib/boston-parking.js needs, or null for a sign that says nothing to a car (an unreadable photo, a
 *  motorcycle meter). Flags: n = a note on a long stretch (a hydrant, bus stop or accessible sign covers a car or two),
 *  m = metered, pl = a plain all-day "No Parking", sw = a street cleaning sign, per = only in a named period (snow emergency,
 *  school days: we can't know when), r = [layer, fields] for the sheet's list. */
export function compactPolicy(p) {
  const rules = (p.rules || []).filter((r) => r && r.activity && r.activity !== UNREADABLE);
  if (!rules.length) return null;
  const usersOf = (r) => clean(r.user_classes), exceptOf = (r) => clean(r.user_classes_except), purposesOf = (r) => clean(r.purposes);
  if (rules.some((r) => usersOf(r).includes('motorcycle'))) return null;
  const sorted = classifyPolicy(p), spans = (p.time_spans || []).filter(Boolean);
  const hydrant = rules.some((r) => purposesOf(r).includes('fire_hydrant'));
  const out = { pr: p.priority ?? 1000, st: stateOf(rules, sorted) };
  if (hydrant || rules.some((r) => purposesOf(r).includes('bus_stop') || usersOf(r).includes('accessible') || exceptOf(r).includes('accessible'))) out.n = 1;
  if (rules.some((r) => r.activity === 'parking') && (p.rates || []).length) out.m = 1;
  if (/^\*?\s*No Parking\s*$/i.test(p.description || '')) out.pl = 1;
  if (rules.some((r) => r.activity === 'no stopping')) out.stop = 1;
  if (isSweepSign(p)) out.sw = 1;
  const plain = spans.filter((t) => !t.designated_period), named = spans.find((t) => t.designated_period);
  if (plain.length) out.w = plain.map(spanWindow);
  else if (named) out.per = String(named.designated_period).replace(/[{}"]/g, '');
  const paid = sorted.find(([layer]) => layer === 'paid'), permit = sorted.find(([layer]) => layer === 'permit'), limit = sorted.find(([layer]) => layer === 'limit');
  const max = paid?.[1].max ?? limit?.[1].max ?? permit?.[1].max;
  if (paid?.[1].rate) out.rate = paid[1].rate;
  if (max) out.max = max;
  const first = sorted[0];
  if (first) out.r = first;
  else if (hydrant) out.r = ['hydrant', {}];
  return out;
}

const round = (v) => Math.round(v * 1e5);
const lengthOf = (g) => {
  const kx = 111320 * Math.cos(42.33 * Math.PI / 180), ky = 111320; let m = 0;
  for (let i = 1; i < g.length; i++) m += Math.hypot((g[i][0] - g[i - 1][0]) * kx, (g[i][1] - g[i - 1][1]) * ky);
  return m;
};
export const SHORT_M = 15;  // a stretch this short is one sign's own, so its top sign can speak for it

/** Every curb record → zones.json. sideOf(line) → {c, side} of the swept block side it runs along, or null; streetOf(line) →
 *  a street name for the sheet on any other curb. A zone is [lng,lat in 1e-5 degrees, each pair the step from the last, ruleset (-1 = no usable sign),
 *  1 when short, block c or 0, side, name index or -1]; a ruleset is [policy indexes, 1 when a sign couldn't be read]. */
export function buildZones({ zones, policies, sideOf, streetOf, generated, source }) {
  const compact = new Map(policies.map((p) => [p.curb_policy_id, compactPolicy(p)]));
  const unreadableIds = new Set(policies.filter((p) => (p.rules || []).some((r) => r && r.activity === UNREADABLE)).map((p) => p.curb_policy_id));
  const list = [], listAt = new Map(), sets = [], setAt = new Map(), names = [], nameAt = new Map(), z = [];
  const indexOf = (obj) => { const id = JSON.stringify(obj); if (!listAt.has(id)) { listAt.set(id, list.length); list.push(obj); } return listAt.get(id); };
  let published = 0;
  for (const zone of zones) {
    if (!zone.geometry || zone.geometry.type !== 'LineString') continue;
    published = Math.max(published, zone.published_date || 0);
    const g = zone.geometry.coordinates, ids = [...new Set(zone.curb_policy_ids || [])];
    const used = [...new Set(ids.map((i) => compact.get(i)).filter(Boolean).map(indexOf))].sort((a, b) => a - b);
    let rs = -1;
    if (used.length) {
      const set = [used, ids.some((i) => unreadableIds.has(i)) ? 1 : 0], id = JSON.stringify(set);
      if (!setAt.has(id)) { setAt.set(id, sets.length); sets.push(set); }
      rs = setAt.get(id);
    }
    const hit = sideOf(g);
    let name = -1;
    if (!hit && rs >= 0) {
      const n = streetOf(g);
      if (n) { if (!nameAt.has(n)) { nameAt.set(n, names.length); names.push(n); } name = nameAt.get(n); }
    }
    let x = 0, y = 0;
    const flat = g.flatMap(([lo, la]) => { const dx = round(lo) - x, dy = round(la) - y; x += dx; y += dy; return [dx, dy]; });
    z.push([flat, rs, lengthOf(g) <= SHORT_M ? 1 : 0, hit ? hit.c : 0, hit ? hit.side : '', name]);
  }
  return {
    _meta: { generated, source, published: published ? new Date(published).toISOString().slice(0, 10) : null, zones: z.length,
      format: 'z = [[lng,lat in 1e-5 degrees, each pair the step from the last, ruleset or -1 (no usable sign), 1 when 15 m or shorter, block c or 0, side, street index or -1]]; '
        + 'rs = [[policy indexes, 1 when a sign on the record could not be read]]; p = policies (scripts/cities/boston-zones.mjs compactPolicy); n = street names' },
    p: list, rs: sets, n: names, z };
}
