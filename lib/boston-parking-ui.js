/* CURB · Parking mode on the Boston page: a Sweeping | Parking switch, time chips, curbs colored by what applies at the chosen
   time, and a sheet that says what applies and until when. The rules are in lib/boston-parking.js, the spec and street check in
   private/boston-parking-mode/. Loaded after the page's own script by scripts/cities/boston-page.mjs; the page calls window.PARK
   where it takes a map tap, draws the overview and fills a sheet. The page's names (map, L, openSheet, bosRule…) are read when
   these functions run. ?view=parking opens straight into it, ?at=2026-11-10T14:00 at that Boston time. */
(function () {
  const P = window.BOS_PARK;
  const COLOR = { clear: '#1F9E5A', paid: '#2F5BD0', limit: '#2F5BD0', restricted: '#7A4FB5', no: '#C2187E', sweep: '#C1121F', check: '#E08A1E', unknown: '#8C8678' };
  const ORDER = ['unknown', 'clear', 'limit', 'paid', 'restricted', 'check', 'no', 'sweep'];
  const LEGEND = [['clear', 'Clear'], ['paid', 'Paid or time limit'], ['restricted', 'Permit or placard'], ['no', 'No parking'], ['sweep', 'Sweeping now'], ['check', 'Check the sign'], ['unknown', 'No sign on record']];
  const GROUP = { limit: 'paid' };  // legend rows that cover two states
  const CELL = 0.004, MIN_ZOOM = 13, CHUNK = 1500, REDRAW_MS = 5 * 60e3;
  const FLOORS = { 13: 60, 14: 15 };  // shortest stretch drawn at a zoomed out view: a stub is invisible there, and thousands of them cost a phone

  const hiddenStates = new Set();
  let D = null, cells = null, onSide = null, blockAt = null, loading = null;
  let T = null, choice = 'now', tok = 0, selected = null, selLine = null, lines = null, renderer = null, redrawn = 0, moveT = 0, zoomToasted = false;
  let graded = new Map(), gradedAt = '';

  const nowT = () => { const p = BOS.core.parts(new Date()); return P.at(p.y, p.mo, p.da, p.h, p.mi); };
  const rulesOf = (c, side) => { const b = blockAt && blockAt.get(String(c)); return b ? (b.d.find(([s]) => s === side) || [])[2] : null; };
  const answerAt = (zone, t) => P.grade(D, zone, t, rulesOf, BOS.HOLIDAYS);
  // The map asks once per kind of curb at a time: the same signs on the same kind of stretch say the same thing.
  function answer(zone) {
    const key = T.iso + T.min;
    if (key !== gradedAt) { graded = new Map(); gradedAt = key; }
    if (zone.c) return answerAt(zone, T);
    const k = zone.rs + '|' + zone.short;
    if (!graded.has(k)) graded.set(k, answerAt(zone, T));
    return graded.get(k);
  }
  const zoneMeters = (z) => { let m = 0; for (let i = 1; i < z.g.length; i++) m += map.distance(z.g[i - 1], z.g[i]); return m; };
  const shown = (zone, zoom, a) => {
    if (hiddenStates.has(GROUP[a.st] || a.st)) return false;
    if (zoom >= 16) return true;
    if (a.st === 'unknown' || zone.short) return false;
    return zoom >= 15 || zoneMeters(zone) >= FLOORS[zoom];
  };

  /* ---------- the data ---------- */
  function load() {
    return loading || (loading = (async () => {
      const [data, blocks] = await Promise.all([fetch('/data/boston/zones.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), BOS.load()]);
      D = P.decode(data);
      blockAt = new Map(blocks.map((b) => [String(b.c), b]));
      cells = new Map(); onSide = new Map();
      for (const z of D.zones) {
        const m = z.g[Math.floor(z.g.length / 2)], k = Math.floor(m[0] / CELL) + ',' + Math.floor(m[1] / CELL);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(z);
        if (z.c && z.rs >= 0) { const s = z.c + '|' + z.side; if (!onSide.has(s)) onSide.set(s, []); onSide.get(s).push(z); }
      }
    })().catch((e) => { loading = null; throw e; }));
  }
  function zonesNear(bounds) {
    const out = [];
    for (let i = Math.floor(bounds.getSouth() / CELL); i <= Math.floor(bounds.getNorth() / CELL); i++)
      for (let j = Math.floor(bounds.getWest() / CELL); j <= Math.floor(bounds.getEast() / CELL); j++) {
        const c = cells.get(i + ',' + j);
        if (c) out.push(...c);
      }
    return out;
  }

  /* ---------- the map ---------- */
  const weightAt = (zoom) => (zoom >= 17 ? 5 : zoom >= 16 ? 4 : zoom >= 15 ? 3 : 2);
  async function draw() {
    if (!PARK.on || !D) return;
    const my = ++tok, zoom = map.getZoom();
    lines.clearLayers();
    redrawn = Date.now();
    if (zoom < MIN_ZOOM) {
      if (!zoomToasted) { zoomToasted = true; toast('Zoom in to see each curb.'); }
      return;
    }
    const list = [];
    for (const zone of zonesNear(map.getBounds().pad(0.12))) { const a = answer(zone); if (shown(zone, zoom, a)) list.push([zone, a.st]); }
    list.sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1]));
    const weight = weightAt(zoom);
    for (let i = 0; i < list.length; i += CHUNK) {
      if (my !== tok) return;
      for (const [zone, st] of list.slice(i, i + CHUNK)) {
        L.polyline(zone.g, { renderer, color: COLOR[st], weight: st === 'unknown' ? Math.max(2, weight - 1) : weight, opacity: st === 'unknown' ? 0.5 : 0.95,
          lineCap: 'butt', dashArray: st === 'check' ? '6 5' : null, interactive: false }).addTo(lines);
      }
      if (i + CHUNK < list.length) await new Promise((r) => requestAnimationFrame(r));
    }
  }
  function highlight(zone) {
    if (selLine) { map.removeLayer(selLine); selLine = null; }
    if (zone) selLine = L.polyline(zone.g, { pane: 'curbs', color: '#17150F', weight: weightAt(map.getZoom()) + 4, opacity: 0.35, lineCap: 'round', interactive: false }).addTo(map);
  }
  function tap(e) {
    if (!D) return;
    const reach = matchMedia('(pointer:coarse)').matches ? 20 : 12, zoom = map.getZoom(), at = e.containerPoint;
    const near = L.latLngBounds([e.latlng.lat - CELL, e.latlng.lng - CELL], [e.latlng.lat + CELL, e.latlng.lng + CELL]);
    let best = null, bd = reach;
    for (const zone of zonesNear(near)) {
      if (!shown(zone, zoom, answer(zone))) continue;
      const pts = zone.g.map((p) => map.latLngToContainerPoint(p));
      for (let i = 1; i < pts.length; i++) {
        const d = L.LineUtil.pointToSegmentDistance(at, pts[i - 1], pts[i]);
        if (d < bd) { bd = d; best = zone; }
      }
    }
    if (best) openZone(best);
    else { selected = null; highlight(null); document.getElementById('sheet').classList.remove('open'); }
  }

  /* ---------- the sheet ---------- */
  function openZone(zone) {
    selected = zone;
    const mid = zone.g[Math.floor(zone.g.length / 2)];
    if (map.getZoom() < 16) map.setView(mid, 17);
    highlight(zone);
    const block = zone.c && blockAt.get(String(zone.c));
    if (block) {
      // the page's own sheet for the block, with its alerts and calendar: its drawing goes to a layer that isn't on the map
      drawSegments(BOS.rowsOf(block));
      const hit = segCache.find((o) => o.side.rows[0].cnnrightleft === zone.side);
      if (hit) { openSheet(hit.group, hit.side.key); return; }
    }
    document.getElementById('sheetBody').innerHTML = `<div class="verdict"><span class="kicker"></span><div class="headrow"><span class="head"></span><span class="hmeter" id="headMeter" style="display:none"></span></div></div>
      <div class="where"><span class="wtxt"></span></div><div class="crules" id="curbRules" hidden></div>`;
    document.querySelector('#sheetBody .wtxt').textContent = zone.name || 'This curb';
    fill(zone);
    document.getElementById('sheet').classList.add('open');
  }
  // The page opened a sheet (a tap here, or its other-side row): say what this side's curb allows.
  function decorate(group, active) {
    const lr = active.rows[0].cnnrightleft, sameSide = selected && String(selected.c) === String(group.cnn) && selected.side === lr;
    const longest = () => (onSide.get(group.cnn + '|' + lr) || []).reduce((a, z) => (!a || zoneMeters(z) > zoneMeters(a) ? z : a), null);
    fill(sameSide ? selected : longest(), active);
  }
  function fill(zone, swept) {
    const body = document.getElementById('sheetBody');
    const none = { st: 'unknown', why: 'no-sign' }, here = (t) => (zone ? answerAt(zone, t) : none);
    const a = here(T), next = P.nextChange((t) => here(t), T), w = P.words(a, next, T);
    const v = body.querySelector('.verdict');
    v.className = 'verdict';
    v.querySelector('.kicker').textContent = (choice === 'now' ? 'Now · ' : '') + P.dayTime(T);
    const head = v.querySelector('.head');
    head.textContent = w.head;
    head.style.color = a.st === 'unknown' ? 'var(--ink-soft)' : a.st === 'check' ? 'var(--amber-text)' : COLOR[a.st];
    const meter = document.getElementById('headMeter');
    if (meter) {
      if (w.rate) { meter.innerHTML = METER_ICON + '$' + (+w.rate).toFixed(2).replace(/\.00$/, '') + '/hr'; meter.style.display = 'inline-flex'; }
      else meter.style.display = 'none';
    }
    const bar = P.dayBar((t) => here(t), T).map((s) => `<i style="width:${(s.to - s.from) / 14.4}%;background:${COLOR[s.st]}" title="${P.clock(s.from)} to ${P.clock(s.to % 1440)}"></i>`).join('');
    const block = document.createElement('div');
    block.className = 'pk-now-block';
    block.innerHTML = (w.sub ? '<div class="pk-sub"></div>' : '')
      + `<div class="pk-bar" role="img" aria-label="This day, hour by hour">${bar}<span class="pk-at" style="left:${T.min / 14.4}%"></span></div><div class="pk-ticks"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>`;
    if (w.sub) block.querySelector('.pk-sub').textContent = w.sub;
    body.querySelector('.where').after(block);
    const sched = body.querySelector('.asched');
    if (sched && a.st !== 'sweep') sched.insertAdjacentText('afterbegin', 'Next sweep: ');
    if (!swept) block.after(Object.assign(document.createElement('div'), { className: 'afterpass', textContent: "The City lists no sweeping schedule for this curb." }));
    list(zone, a);
  }
  // Everything else on record for this stretch, in the page's own words: we can't always place a sign on the block, so none is hidden.
  function list(zone, a) {
    const el = document.getElementById('curbRules'); if (!el) return;
    const seen = new Set(), rows = [];
    for (const i of zone && zone.rs >= 0 ? D.rs[zone.rs][0] : []) {
      const p = D.p[i];
      if (!p.r || p === a.top) continue;
      const [k, f] = p.r, id = JSON.stringify(p.r);
      if (seen.has(id)) continue;
      seen.add(id);
      const t = k === 'hydrant' ? { color: '#A4277C', head: 'Fire hydrant', sub: '', when: '' } : bosRule(k, f);
      rows.push(`<div class="crule"><i style="background:${t.color}"></i><span><b>${t.head}</b>${t.sub ? ' · ' + t.sub : ''}${t.when ? ' · ' + t.when : ''}</span></div>`);
    }
    const unread = zone && zone.rs >= 0 && D.rs[zone.rs][1];
    if (unread && a.why !== 'unread') rows.push('<div class="crule"><i style="background:#8C8678"></i><span>One sign here couldn\'t be read.</span></div>');
    const month = D._meta.published ? new Date(D._meta.published + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    el.innerHTML = (rows.length ? '<div class="pk-eye">Also posted on this stretch</div>' : '') + rows.join('')
      + `<div class="crsrc">Posted signs, read from photos by the City's Curb Lab (beta${month ? ', ' + month : ''}). The sign on the street wins.</div>`;
    el.hidden = false;
  }

  /* ---------- the time ---------- */
  function chooseTime(which, t) {
    const n = nowT();
    choice = which;
    T = t || (which === 'tonight' ? P.at(n.y, n.mo, n.da, 21) : which === 'morning' ? P.at(n.y, n.mo, n.da + 1, 9) : n);
    paintChips();
    draw();
    if (selected && document.getElementById('sheet').classList.contains('open')) openZone(selected);
  }
  function paintChips() {
    const n = nowT();
    const set = (id, on, text) => { const el = document.getElementById(id); el.classList.toggle('on', on); el.setAttribute('aria-pressed', on); if (text) el.querySelector('span').textContent = text; };
    set('pkNow', choice === 'now', 'Now · ' + P.dayTime(n));
    set('pkTonight', choice === 'tonight');
    document.getElementById('pkTonight').hidden = n.min >= 21 * 60;
    set('pkMorning', choice === 'morning', P.dayTime(P.at(n.y, n.mo, n.da + 1, 9)));
    set('pkPick', choice === 'pick', choice === 'pick' ? P.dayTime(T) : 'Pick');
  }
  function buildControls() {
    const row = document.querySelector('.dayrow');
    row.insertAdjacentHTML('afterbegin', '<span class="pk-seg" role="group" aria-label="What the map shows"><button id="pkSweep" class="on" aria-pressed="true">Sweeping</button><button id="pkPark" aria-pressed="false">Parking</button></span>');
    row.insertAdjacentHTML('beforeend', '<button class="dchip pk-chip" id="pkNow"><span></span></button><button class="dchip pk-chip" id="pkTonight"><span>Tonight</span></button><button class="dchip pk-chip" id="pkMorning"><span></span></button><label class="dchip pk-chip pk-pick" id="pkPick"><span>Pick</span><input id="pkPickInput" type="datetime-local" aria-label="Pick a day and time in Boston"></label>');
    document.getElementById('pkSweep').onclick = () => exit();
    document.getElementById('pkPark').onclick = () => enter();
    document.getElementById('pkNow').onclick = () => chooseTime('now');
    document.getElementById('pkTonight').onclick = () => chooseTime('tonight');
    document.getElementById('pkMorning').onclick = () => chooseTime('morning');
    document.getElementById('pkPickInput').onchange = (e) => {
      const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(e.target.value);
      if (m) chooseTime('pick', P.at(+m[1], +m[2], +m[3], +m[4], +m[5]));
    };
    const legend = document.createElement('div');
    legend.className = 'legend2'; legend.id = 'parkLegend'; legend.setAttribute('aria-label', 'Parking map legend');
    legend.innerHTML = LEGEND.map(([st, label]) => `<button class="lst on" data-pk="${st}" aria-pressed="true"><i style="${st === 'check' ? `background:repeating-linear-gradient(90deg,${COLOR.check} 0 5px,transparent 5px 8px)` : `background:${st === 'unknown' ? '#8C867880' : COLOR[st]}`}"></i>${label}</button>`).join('');
    document.body.append(legend);
    legend.querySelectorAll('.lst').forEach((b) => { b.onclick = () => {
      const st = b.dataset.pk, off = !hiddenStates.has(st);
      if (off) hiddenStates.add(st); else hiddenStates.delete(st);
      b.classList.toggle('on', !off); b.setAttribute('aria-pressed', !off);
      draw();
    }; });
  }

  /* ---------- in and out ---------- */
  const SWEEP_LAYERS = () => [segLayer, rppLayer, loadLayer, meterLayer, limitLayer, snowLayer, stopLayer];
  function setSwitch(on) {
    document.body.classList.toggle('parking', on);
    const a = document.getElementById('pkPark'), b = document.getElementById('pkSweep');
    a.classList.toggle('on', on); a.setAttribute('aria-pressed', on);
    b.classList.toggle('on', !on); b.setAttribute('aria-pressed', !on);
    const u = new URL(location.href);
    if (on) u.searchParams.set('view', 'parking'); else { u.searchParams.delete('view'); u.searchParams.delete('at'); }
    history.replaceState(null, '', u);
  }
  async function enter() {
    if (PARK.on) return;
    PARK.on = true;
    setSwitch(true);
    document.getElementById('sheet').classList.remove('open');
    try { showEveryCurb(); } catch (_) { /* the page's reset is only for tidiness here */ }
    SWEEP_LAYERS().forEach((l) => map.removeLayer(l));
    if (map.hasLayer(overviewLayer)) map.removeLayer(overviewLayer);
    if (!T) T = nowT();
    paintChips();
    try { await load(); }
    catch (e) {
      toast("Couldn't load the curb rules. Check your connection and try again.");
      try { curbReport('data-load', String((e && e.message) || e)); } catch (_) {}
      exit();
      return;
    }
    if (!PARK.on) return;
    try { track('parking_mode'); } catch (_) {}
    draw();
  }
  function exit() {
    if (!PARK.on) { setSwitch(false); return; }
    PARK.on = false;
    tok++;
    selected = null; highlight(null);
    lines.clearLayers();
    setSwitch(false);
    document.getElementById('sheet').classList.remove('open');
    SWEEP_LAYERS().forEach((l) => l.addTo(map));
    ovrKey = '';
    loadViewport();
  }

  const PARK = window.PARK = { on: false, tap, decorate, enter, exit };
  renderer = L.canvas({ padding: 0.2, pane: 'curbs' }).addTo(map);
  lines = L.layerGroup().addTo(map);
  buildControls();
  map.on('moveend zoomend', () => { clearTimeout(moveT); moveT = setTimeout(() => { draw(); if (selected) highlight(selected); }, 120); });
  setInterval(() => {
    if (!PARK.on || choice !== 'now') return;
    T = nowT();
    paintChips();
    if (Date.now() - redrawn > REDRAW_MS) draw();
  }, 60e3);

  const qs = new URLSearchParams(location.search), m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(qs.get('at') || '');
  if (m) { T = P.at(+m[1], +m[2], +m[3], +m[4], +m[5]); choice = 'pick'; }
  if (qs.get('view') === 'parking') enter();
})();
