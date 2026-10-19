/* CURB · winter alternate side parking on a city's page (city.json `winter`: Madison), loaded after lib/city.js by
   scripts/cities/city-page.mjs. The design picked on 2026-10-18 (view A, "tonight's side"): while the City enforces
   the rule, the map colors tonight's closed side red and the open side green, under a plate naming the side to park on
   tonight; before that, winter sides are dashed, the plate says the rule isn't in effect yet, and a side's alerts can
   be turned on so they start with it (the alert server holds them until then: lib/notify-core.js winterPlan).

   Whether the City enforces it is data/<id>/winter.json, read by PLACE.load() before anything is drawn. The page calls
   WINTER from its own functions (sideNext, drawSegments, overviewStyle, previewHtml, openSheet, the calendar and the
   Sweep alerts panel); the page's names (getCSS, statusFor, esc, …) are read only when those calls run. */
(function (root) {
  'use strict';
  const P = root.PLACE;
  if (!P || !P.winter || typeof document === 'undefined') return;
  const W = P.winter, CITY = (P.cfg && P.cfg.name) || 'The City';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const other = (p) => (p === 'odd' ? 'even' : 'odd');
  // the rule's hours as a sign says them: "1 AM", "7 AM", "1 to 7 AM" (lib/city.js)
  const START = clockText(W.start), END = clockText(W.end), WIN = hoursText(W.start, W.end);
  // dates as "YYYY-MM-DD": n days later, the weekday, "Nov 16", "November 15"
  const shift = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const wd = (iso) => WD[new Date(iso + 'T12:00:00Z').getUTCDay()];
  const md = (iso) => MON[+iso.slice(5, 7) - 1] + ' ' + +iso.slice(8, 10);
  const longDay = (iso) => MONTH[+iso.slice(5, 7) - 1] + ' ' + +iso.slice(8, 10);

  // Tonight, worked out once a minute (the citywide view asks once per block) and again when the City's switch is read.
  let memo = null;
  function tonight() {
    const k = Math.floor(Date.now() / 6e4), st = P.getWinter();
    if (!memo || memo.k !== k || memo.st !== st) memo = { k, st, night: P.winterNight() };
    return memo.night;
  }
  /* Tonight and what the City does with it: 'on' (enforced tonight), 'soon' (switched on from a later night), 'waiting'
     (not switched on yet), 'paused', or 'over' (after the season). */
  function phase() {
    const night = tonight(), st = P.getWinter();
    const mode = night.iso > W.to ? 'over' : night.enforced ? 'on' : st.state === 'on' ? 'soon' : st.state;
    return { night, mode, st };
  }
  // A night with no rule on either side (Milwaukee's Sunday and holiday mornings), as the file's two lists say: either side.
  const freeNight = (iso) => { const l = P.getLists(); return !!(l.odd && l.even) && !l.odd.includes(iso) && !l.even.includes(iso); };
  // Why a night is free, for the words: a holiday's name, else "Sunday morning"
  const freeWhy = (iso) => P.HOLIDAYS[iso] || 'Sunday morning';
  // A side's name: its house numbers ("Odd side"), else its compass side; and the dates that close it
  const sideName = (ws, s) => (ws.parity ? cap(ws.parity) + ' side' : (s && s.blockside ? s.blockside + ' side' : 'This side'));
  const closeDates = (ws) => (ws.parity ? `on ${other(ws.parity)} dates` : 'on its nights');
  // The night k nights after tonight in words: its window falls on the morning iso + k, so its evening is iso + k - 1
  const nightWord = (iso, k) => (k === 1 ? 'tomorrow night' : `${wd(shift(iso, k - 1))} night`);
  // The first night within two weeks after tonight when this side is (or isn't) closed, 0 if none
  const nextNight = (ws, iso, closed, after = 0) => { for (let k = after + 1; k <= 14; k++) if (ws.closed(shift(iso, k)) === closed) return k; return 0; };
  // "Dec 1 to Mar 1": the span of a side's ban on both sides
  const banSpan = (ws) => { const b = ws.rules.find((r) => r.flags & 8); return b ? `${md(b.dates[0])} to ${md(b.dates[b.dates.length - 1])}` : ''; };

  // The map: a side-switching rule enforced tonight is red on a side closed tonight and green on one open, whatever the hour
  // (the question at night is which side); not enforced, it ranks under every sweep and its side is drawn dashed.
  function statusFor(r, ns) {
    if (!P.isWinterRule(r)) return root.statusFor(ns);
    const night = tonight();
    if (!night.enforced) return { rank: 1, color: getCSS('--winter-dash') };
    return r.dates.includes(night.iso) ? { rank: 5, color: getCSS('--red') } : { rank: 2, color: getCSS('--green') };
  }
  const lineStyle = (rows, rank) => (rank <= 1 && rows.some(P.isWinterRule)
    ? { color: getCSS('--winter-dash'), weight: 4, dashArray: '7 8', lineCap: 'butt' } : null);
  // The citywide view draws one line a block, where sides can't show: a block whose only rule is the winter one is a
  // quiet line once it's enforced (the plate says the side) and dashed before; sweeps keep their colors.
  function ovStyle(rules, ow) {
    if (!rules.some(P.isWinterRule)) return undefined;
    let rank = 0, color = getCSS('--gray');
    rules.forEach((r) => { if (P.isWinterRule(r)) return; const st = root.statusFor(nextSweep(r)); if (st.rank > rank) { rank = st.rank; color = st.color; } });
    if (rank >= 2) return statusOn[rank >= 5 ? 'red' : rank >= 4 ? 'amber' : 'green'] ? { color, weight: ow, opacity: .8, dashArray: null } : null;
    return tonight().enforced ? { color: getCSS('--ink-soft'), weight: ow, opacity: .45, dashArray: null }
      : { color: getCSS('--winter-dash'), weight: ow, opacity: .9, dashArray: '4 5' };
  }

  // The words for a night the City doesn't enforce: a pill and a sentence. A year-round rule (Milwaukee) is only ever "over"
  // once its listed nights run out.
  const yearRound = Date.parse(W.to) - Date.parse(W.from) > 300 * 864e5;
  function notYet(mode, st, night) {
    if (mode === 'paused') return { pill: 'Paused', text: (typeof st.reason === 'string' && st.reason.trim()) || `${CITY} paused enforcement. Park on either side at night until it starts again; your alerts start again with it.` };
    if (mode === 'over') return yearRound ? { pill: 'No nights listed', text: `This map lists the nights through ${longDay(W.to)}.` }
      : { pill: 'Over for this winter', text: `Alternate side parking ran ${longDay(W.from)} to ${longDay(W.to)}.` };
    if (mode === 'soon') {
      const eve = shift(st.from > W.from ? st.from : W.from, -1);   // the evening its first night begins
      return { pill: `Starts ${wd(eve)} night`, text: `${CITY} turned it on from the night of ${wd(eve)} ${md(eve)}. Until then, park on either side at night.` };
    }
    return { pill: 'Not in effect yet', text: `${night.iso < W.from ? `From ${longDay(W.from)}, ` : ''}${CITY} turns it on with the first plowing of the winter. Until then, park on either side at night. When it starts, this map shows tonight's side and your alerts begin.` };
  }
  // A city where the rule is for cars with a night permit (Milwaukee): what tonight means without one.
  const permitNote = (night) => (freeNight(night.iso)
    ? `<p class="wnp">${esc(freeWhy(night.iso))}: no permit needed tonight, ${WIN}.</p>`
    : `<p class="wnp">Night parking needs a City permit. Without one, no parking ${WIN} on either side.</p>`);

  // A side's alert and calendar arm its next occurrence, which a rule the City doesn't enforce yet doesn't have: on a
  // side with only that rule, alerts arm its coming night as if enforced, so they can be on before it starts (the server
  // sends nothing for a night the City doesn't enforce). null leaves the page's own arming.
  function arm(side, now = new Date()) {
    if (side.ns) return null;
    const ws = P.winterSide(side.rows);
    if (!ws || phase().mode === 'over') return null;
    for (const iso of ws.rule.dates) {
      const { start, end } = P.winterWindow(iso);
      if (+end <= +now) continue;
      const [y, mo, da] = iso.split('-').map(Number);
      return { armNs: { start, end, fromH: toHours(W.start), toH: toHours(W.end), y, mo, da, dow: new Date(Date.UTC(y, mo - 1, da)).getUTCDay() },
        armRow: ws.rule, sweepingNow: false, waiting: true };
    }
    return null;
  }

  // What a side does tonight and next, from its own nights (they alternate, skip Sunday mornings, or close both sides all
  // winter): "Closed tonight. Open tomorrow night, closed again Thu night."
  function sideText(ws, night) {
    const iso = night.iso, closed = ws.closed(iso), next = ws.closed(shift(iso, 1));
    if (night.inWindow) return closed ? `Closed until ${END}.${next ? ' Closed the next night too.' : ' Open the next night.'}`
      : `Open until ${END}${next ? `, then closed the next night, ${WIN}` : ''}.`;
    if (closed && ws.both(iso)) return `No night parking on either side, ${banSpan(ws)}.`;
    if (closed) {
      const open = nextNight(ws, iso, false), again = open ? nextNight(ws, iso, true, open) : 0;
      return `Closed tonight.${open ? ` Open ${nightWord(iso, open)}${again ? `, closed again ${nightWord(iso, again)}` : ''}.` : ''}`;
    }
    const shut = nextNight(ws, iso, true);
    return `Open tonight.${shut ? ` Closed ${nightWord(iso, shut)} ${WIN}.` : ''}`;
  }

  // The block's sides as cards (design A): the side tapped first, "where you are", then the one across the street. While
  // the City enforces the rule they say tonight; before, which dates close each side. A side's sweep gets a line.
  function cards(group, active, night, mode) {
    const on = mode === 'on';
    const sides = group.sides.map((s) => ({ s, w: P.winterSide(s.rows) })).filter((x) => x.w)
      .sort((a, b) => (a.s === active ? -1 : b.s === active ? 1 : 0));
    const html = sides.map(({ s, w }) => {
      const closed = w.closed(night.iso), here = s === active;
      const badge = !on ? `<div class="wbadge wait">${w.parity ? cap(other(w.parity)) + ' dates' : 'Listed nights'}<br>${WIN}</div>`
        : closed ? `<div class="wbadge now">${night.inWindow ? 'Now' : 'Tonight'}<br>${WIN}</div>` : `<div class="wbadge ok">OK<br>${night.inWindow ? 'now' : 'tonight'}</div>`;
      const text = !on ? (mode === 'over' ? `Closed ${WIN} ${closeDates(w)} this past winter.` : `Closed ${WIN} ${closeDates(w)}, once ${CITY} turns it on.`) : sideText(w, night);
      let sweep = null;
      s.rows.forEach((r) => { if (P.isWinterRule(r)) return; const n = nextSweep(r); if (n && (!sweep || +n.start < +sweep.start)) sweep = n; });
      const tap = here ? '' : ` tap" data-side="${esc(s.key)}" role="button" tabindex="0" aria-label="Switch to the ${esc(s.blockside || 'other')} side`;
      return `<div class="srow wcard${tap}">${badge}<div class="smeta"><div class="wcn">${esc(sideName(w, s))} · ${here ? 'where you are' : 'across the street'}</div>`
        + `<div class="wcx">${text}</div>${sweep ? `<div class="wcx">Street sweeping ${esc(relPhrase(sweep).short)}</div>` : ''}</div></div>`;
    }).join('');
    return `<div class="sideslbl">${!on ? 'Both sides' : night.inWindow ? 'Right now' : 'Tonight'}</div><div class="sides">${html}</div>`;
  }

  /* The sheet of a side with a winter rule: what replaces the page's verdict, schedule line and other sides (null: keep
     the page's), a note (a night the City doesn't enforce; a permit city's rule), and whether Calendar has a night to add.
     A sweep that comes first keeps the page's verdict. */
  let calWinter = false;
  function sheet(group, active) {
    calWinter = false;
    const ws = P.winterSide(active.rows);
    if (!ws) return null;
    const { night, mode, st } = phase();
    const sweepFirst = !!(active.ns && active.row && !P.isWinterRule(active.row));
    if (mode === 'on') {
      const out = { sides: cards(group, active, night, mode), ...(W.permit ? { note: permitNote(night) } : {}) };
      if (!sweepFirst) {
        const iso = night.iso, closed = ws.closed(iso), name = sideName(ws, active);
        const open = closed ? nextNight(ws, iso, false) : 0, shut = closed ? 0 : nextNight(ws, iso, true);
        Object.assign(out, closed && night.inWindow ? { vClass: 'now', kicker: 'No parking', head: 'Until ' + END }
          : closed ? { vClass: 'now', kicker: 'Move by', head: START + ' tonight' }
          : shut ? { vClass: 'ok', kicker: 'Park until', head: `${START} ${nightWord(iso, shut)}` }
          : { vClass: 'ok', kicker: 'Tonight', head: 'OK to park' });
        out.sched = `<div class="asched ${closed ? 'red' : 'green'}">${esc(name)} · ${closed
          ? (night.inWindow ? `no parking until ${END}` : ws.both(iso) ? `no night parking on either side, ${WIN}, ${banSpan(ws)}`
            : `no parking on this side ${WIN} tonight${open ? `, OK again ${nightWord(iso, open)}` : ''}`)
          : `OK tonight${shut ? `, no parking ${WIN} ${nightWord(iso, shut)}` : ''}`}</div>`;
        calWinter = true;
      }
      return out;
    }
    const w = notYet(mode, st, night), sides = cards(group, active, night, mode);
    const rule = `${sideName(ws, active)} · no parking ${WIN} ${closeDates(ws)}, ${md(W.from)} to ${md(W.to)}`;
    if (active.ns) return { note: `<div class="wnote"><span class="wpill">${w.pill}</span><div class="wnh">Winter rule</div><p>${esc(rule)}. ${w.text}</p></div>`, sides };
    return { vClass: 'soon', kicker: 'Winter rule', head: w.pill, sched: `<div class="asched amber">${esc(rule)}</div>`,
      note: `<p class="wnp">${w.text}</p>`, noCal: true, sides };
  }
  // The calendar event of a winter night (the sheet armed on one), else null (the page's sweeping words).
  const calTitle = (street) => (calWinter ? `🚗 Move car: no parking ${WIN} (${street})` : null);
  const calDesc = () => (calWinter ? `Alternate side parking: no parking on this side ${WIN}. Move your car.` : null);

  // The hover card of a side whose verdict is its winter rule.
  function tip(group, side) {
    const ws = P.winterSide(side.rows);
    if (!ws || (side.ns && side.row && !P.isWinterRule(side.row))) return null;
    const { night, mode, st } = phase();
    let head, next, cls;
    if (mode === 'on') {
      const closed = ws.closed(night.iso);
      head = closed ? (night.inWindow ? 'No parking until ' + END : 'No parking tonight') : 'OK tonight';
      next = sideText(ws, night);
      cls = closed ? 'red' : 'green';
    } else { const w = notYet(mode, st, night); head = 'Winter rule · ' + w.pill.toLowerCase(); next = `Alternate side parking, ${WIN}`; cls = 'amber'; }
    return `<div class="tip-head">${esc(head)}</div>
    <div class="tip-where">${fmtRange(group.cnn)}${esc(group.corridor || 'This block')} <span class="blk">· ${esc(fmtLimits(group.limits))}</span></div>
    <div class="tip-side">${esc(sideName(ws, side))} · closed ${WIN} ${closeDates(ws)}</div>
    <div class="tip-next ${cls}">${next}</div>
    <div class="tip-cta">Click for details &amp; alerts</div>`;
  }

  // The Sweep alerts panel's line for a saved side whose next occurrence is a winter night (or will be), else null.
  function apNext(x, level) {
    const ws = x && x.rows && P.winterSide(x.rows), a = x && x.armNs;
    if (!ws || !a || !x.spot) return null;
    const iso = `${a.y}-${String(a.mo).padStart(2, '0')}-${String(a.da).padStart(2, '0')}`;
    if (!ws.closed(iso) || Math.abs(a.fromH - toHours(W.start)) > 1e-6) return null;   // a sweep comes first
    const { mode, st, night } = phase();
    if (mode !== 'on') return `<div class="ap-next amber">Winter rule: ${esc(notYet(mode, st, night).pill.toLowerCase())}. Alerts start when ${esc(CITY)} turns it on.</div>`;
    const rp = relPhrase(a);
    return `<div class="ap-next ${rp.cls}">No parking ${esc(rp.txt)}</div><div class="ap-ping">${ICONS.bell}<span>${esc(pingLine(x.spot, level))}</span></div>`;
  }

  // The plate under the day chips, and the legend's words for tonight.
  function paint() {
    const el = document.getElementById('wPlate');
    if (!el) return;
    const { night, mode, st } = phase();
    if (mode === 'over') el.hidden = true;
    else if (mode === 'on') {
      const eve = shift(night.iso, -1), tmr = shift(night.iso, 1), free = freeNight(night.iso);
      const sub = W.permit ? (free ? `${freeWhy(night.iso)}: no permit needed, ${WIN}` : `With a night parking permit, ${WIN}. Without one, no parking.`)
        : `${WIN} · Alternate side parking, ${md(W.from)} to ${md(W.to)}`;
      el.className = 'wplate on';
      el.innerHTML = `<div class="wpk">Tonight · ${wd(eve)} ${md(eve)} into ${wd(night.iso)} ${md(night.iso)}</div>`
        + `<div class="wh">Park on ${free ? '<span>either side</span>' : `the <span>${night.park} side</span>`}</div>`
        + `<div class="ws"><span>${esc(sub)}</span><b>Tomorrow night: ${freeNight(tmr) ? 'either side' : P.winterPark(tmr) + ' side'}</b></div>`;
      el.hidden = false;
    } else {
      const w = notYet(mode, st, night);
      el.className = 'wplate';
      el.innerHTML = `<span class="wpill">${w.pill}</span><div class="wh">Alternate side parking</div><div class="ws">${w.text}</div>`;
      el.hidden = false;
    }
    legend(mode === 'on');
  }
  const LABELS = {};
  function legend(on) {
    for (const [st, word] of [['green', 'Park here tonight'], ['red', 'No parking tonight']]) {
      const b = document.querySelector(`.legend2 [data-st="${st}"]`), t = b && b.lastChild;
      if (!t || t.nodeType !== 3) continue;
      if (!(st in LABELS)) LABELS[st] = t.data;
      t.data = on ? word : LABELS[st];
    }
    let row = document.getElementById('wLeg');
    if (on) { if (row) row.remove(); return; }
    if (row) return;
    row = document.createElement('div');
    row.id = 'wLeg'; row.className = 'lst on wleg';
    row.innerHTML = '<i class="wdash" aria-hidden="true"></i>Winter rule, not in effect';
    const ovl = document.getElementById('ovlLeg');
    if (ovl) ovl.before(row);
  }

  const css = document.createElement('style');
  css.textContent = `
  :root{--winter-dash:#A9A291;--winter-hi:#FFC94A;--winter-pill:#F7E7C5;--winter-sub:#E7DFCC;--winter-kick:#BDB4A0}
  .wplate{pointer-events:auto;background:var(--sign-white);border:2px solid var(--ink);border-radius:12px;padding:14px 16px;
    display:flex;flex-direction:column;align-items:flex-start;gap:5px;box-shadow:4px 4px 0 var(--ink);color:var(--ink)}
  .wplate[hidden]{display:none}
  .wplate .wpill{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:var(--winter-pill);color:var(--amber-text);border-radius:999px;padding:3px 9px}
  .wplate .wh{font-family:'Anton',sans-serif;font-size:24px;line-height:1.05;text-transform:uppercase}
  .wplate .ws{font-size:13px;color:var(--ink-soft);line-height:1.4}
  .wplate.on{background:var(--ink);color:var(--paper);gap:3px;box-shadow:4px 4px 0 rgba(23,21,15,.25)}
  .wplate.on .wpk{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--winter-kick)}
  .wplate.on .wh{font-size:30px}
  .wplate.on .wh span{color:var(--winter-hi)}
  .wplate.on .ws{color:var(--winter-sub);display:flex;flex-wrap:wrap;gap:4px 12px;width:100%;justify-content:space-between}
  .wplate.on .ws b{color:var(--paper);font-weight:800}
  @media (max-width:767px){body:has(#sheet.open) .wplate{display:none}}
  .lst i.wdash{height:0;border-top:4px dashed var(--winter-dash);border-radius:0;background:transparent}
  .wleg{cursor:default}
  .wnote{margin:9px 0 2px;border:2px solid var(--amber);border-radius:15px;padding:10px 12px;background:rgba(224,138,30,.08)}
  .wnote .wpill{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:var(--winter-pill);color:var(--amber-text);border-radius:999px;padding:2px 8px}
  .wnote .wnh{font-family:'Anton',sans-serif;font-size:18px;line-height:1;text-transform:uppercase;margin:5px 0 3px}
  .wnote p,.wnp{font-size:12px;font-weight:600;color:var(--ink-soft);line-height:1.4;margin:0}
  .wnp{margin:4px 0 2px}
  .wcard .wbadge{flex:none;width:74px;border-radius:8px;color:var(--sign-white);text-align:center;padding:6px 4px;
    font-family:'Anton',sans-serif;font-size:13px;line-height:1.1;text-transform:uppercase}
  .wcard .wbadge.now{background:var(--red)} .wcard .wbadge.ok{background:var(--green-text)}
  .wcard .wbadge.wait{background:var(--winter-pill);color:var(--amber-text)}
  .wcard .wcn{font-size:13.5px;font-weight:800}
  .wcard .wcx{font-size:12.5px;color:var(--ink-soft);margin-top:2px;line-height:1.35}`;
  document.head.appendChild(css);

  // Paint once the blocks and the City's switch are in, then again whenever tonight changes (7 AM ends a night) or the
  // City's switch starts: the page itself redraws only when the date changes.
  let shown = '';
  function tick() {
    const n = tonight(), k = n.iso + (n.enforced ? '+' : '-') + (n.inWindow ? 'w' : '');
    if (k === shown) return;
    const first = !shown;
    shown = k; paint();
    if (!first && typeof drawSegments === 'function') { drawSegments(lastRows); if (ovMode) drawOverview(); }
  }
  document.addEventListener('DOMContentLoaded', () => { P.load().then(tick).catch(() => {}); setInterval(tick, 60e3); });

  root.WINTER = { phase, statusFor, lineStyle, ovStyle, arm, sheet, calTitle, calDesc, tip, apNext, paint };
})(typeof window !== 'undefined' ? window : globalThis);
