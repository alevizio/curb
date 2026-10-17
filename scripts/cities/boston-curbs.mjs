// The Curb Lab's curb policies (Curb Data Specification, read from sign photos) → the Boston map's layers.
// Used by scripts/cities/boston.mjs; tested in boston-curbs.test.mjs.
//
// A policy is a set of rules (activity, user_classes, user_classes_except, max_stay, purposes) over time spans.
// The City encodes many signs as an exception: "Resident Permit Only" is "no parking" except resident_permit,
// "2 hour parking, residents exempt" is "parking" max 2 hours plus "parking" for resident_permit.

export const clean = (a) => (Array.isArray(a) ? a.map((v) => String(v).replace(/^"|"$/g, '')) : []);
export const DOW3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const maxMinutes = (r) => (r.max_stay ? (r.max_stay_unit === 'hour' ? r.max_stay * 60 : r.max_stay) : null);
function clock(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return '';
  const h = +m[1] % 24, mi = +m[2];
  return (h % 12 || 12) + (mi ? ':' + String(mi).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM');
}
function daysText(list) {
  const d = clean(list).filter((x) => DOW3.includes(x)).map((x) => DOW3.indexOf(x)).sort();
  if (!d.length || d.length === 7) return 'Every day';
  const run = d.every((v, i) => !i || v === d[i - 1] + 1);
  return run && d.length > 2 ? `${SHORT[d[0]]} to ${SHORT[d[d.length - 1]]}` : d.map((v) => SHORT[v]).join(', ');
}
export const spanText = (spans) => (spans || []).filter(Boolean).map((t) => {
  const st = t.time_of_day_start, en = t.time_of_day_end;
  const hours = st && en && st !== en ? `${clock(st)} to ${clock(en)}` : 'all day';
  return `${daysText(t.days_of_week)}, ${hours}`;
}).join('; ');
// a street cleaning sign: no parking on some weeks of the month or months (the schedule covers those curbs)
export const isSweepSign = (p) => (p.rules || []).some((r) => r && (r.activity === 'no parking' || r.activity === 'no stopping'))
  && (p.time_spans || []).some((t) => t && (t.weeks_of_month || t.months));

// "no parking except X": the curb is X's loading zone
const LOADS = { commercial_vehicle: 'commercial', truck: 'commercial', bus: 'bus', rideshare: 'rideshare' };

// One policy → [[layer, fields], ...] for paid, permit, accessible, loading, limit (free, over 30 min), snow and
// nostop. Sweeping signs stay with the schedule; fire hydrant stubs, "no loading" and "stopping" are not drawn.
export function classifyPolicy(p) {
  const rules = (p.rules || []).filter((r) => r && r.activity && r.activity !== 'unusable image');
  if (!rules.length || isSweepSign(p)) return [];
  const spans = (p.time_spans || []).filter(Boolean);
  const period = spans.map((t) => String(t.designated_period || '')).find(Boolean) || '';
  if (/snow/i.test(period)) return [['snow', {}]];
  const hours = spanText(spans);
  const when = period ? period[0].toUpperCase() + period.slice(1) + (hours ? ': ' + hours : '') : hours;
  const of = (r) => ({ users: clean(r.user_classes), except: clean(r.user_classes_except), purposes: clean(r.purposes) });
  const mentions = (u) => rules.some((r) => of(r).users.includes(u) || of(r).except.includes(u));

  if (mentions('resident_permit')) {
    // residents only, or everyone else held to a time limit
    const others = rules.find((r) => r.activity === 'parking' && r.max_stay && !of(r).users.includes('resident_permit'));
    const only = !others && rules.some((r) => /^no (parking|stopping)$/.test(r.activity) && of(r).except.includes('resident_permit'));
    return [['permit', { max: others ? maxMinutes(others) : null, only, when }]];
  }
  if (mentions('accessible')) return [['accessible', { when }]];
  if (mentions('valet')) return [['loading', { who: 'valet', when }]];

  const out = [];
  for (const r of rules) {
    const { users, except, purposes } = of(r);
    if (r.activity === 'parking' && Array.isArray(p.rates) && p.rates.length) {
      const rt = p.rates[0], zone = /zone id\s*(\d+)/i.exec(p.name || '');
      out.push(['paid', { rate: rt.rate_unit === 'hour' ? rt.rate / 100 : null, max: maxMinutes(r), when, ...(zone ? { zone: zone[1] } : {}) }]);
    } else if (r.activity === 'loading') {
      const who = users.some((u) => LOADS[u] === 'commercial') ? 'commercial' : users.includes('bus') ? 'bus'
        : users.includes('rideshare') ? 'rideshare' : 'passenger';
      out.push(['loading', { who, max: maxMinutes(r), when }]);
    } else if (r.activity === 'parking' && !users.length && !except.length && r.max_stay) {
      const max = maxMinutes(r);
      out.push(max <= 30 ? ['loading', { who: 'short', max, when }] : ['limit', { max, when }]);
    } else if (/^no (parking|stopping)$/.test(r.activity) && !purposes.includes('fire_hydrant')) {
      const loads = except.map((u) => LOADS[u]).find(Boolean);
      if (loads) { out.push(['loading', { who: loads, when }]); continue; }
      const anytime = !period && (!spans.length || hours === 'Every day, all day');
      out.push(['nostop', { stop: r.activity === 'no stopping', ...(purposes.includes('bus_stop') ? { why: 'bus stop' } : {}),
        when: anytime ? '' : when, ...(except.length ? { except: except.join(',') } : {}) }]);
    }
  }
  return out;
}
