/* Flow map: the same trade, drawn on the world.
 *
 * Routes use the identical convention as the chord page -- a route is N discrete
 * strands of a fixed quantity, so a thick bundle between Brazil and Germany is
 * countable rather than merely "thicker than the others".
 *
 * Country positions come from the centroid of each country's geometry, joined to
 * the trade data on M49 codes. Anything the world file does not carry (small
 * territories, states that no longer exist) is placed from a small fallback table
 * rather than silently dropped from the map.
 */

const svg = d3.select('#map');
const tip = document.getElementById('tip');
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const FLOW_STEPS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1e3, 2.5e3, 5e3, 1e4, 2.5e4, 5e4, 1e5, 2e5, 3e5, 4e5, 5e5, 1e6];
const SCALES_QTY = [250, 500, 1e3, 2.5e3, 5e3, 1e4, 2.5e4, 5e4, 1e5];
const SCALES_VAL = [1e3, 5e3, 1e4, 2.5e4, 5e4, 1e5, 2.5e5, 5e5];
const TARGET_STRANDS = 1200, MAX_STRANDS = 7000;

// Centroids (lon, lat) for entities the 110m world file has no polygon for.
const FALLBACK_POS = {
  158: [17.6, 3.5],      // former/duplicated ids kept for safety
  228: [60, 60],         // USSR -> roughly Moscow-centred
  51:  [15.5, 49.8],     // Czechoslovakia
  248: [20.5, 44.2],     // Yugoslav SFR
  186: [20.8, 43.5],     // Serbia and Montenegro
  15:  [4.6, 50.6],      // Belgium-Luxembourg
  62:  [39.6, 9.1],      // Ethiopia PDR
  206: [30.2, 15.6],     // Sudan (former)
  96:  [114.2, 22.3],    // Hong Kong
  128: [113.5, 22.2],    // Macao
  214: [121, 23.7],      // Taiwan
  200: [103.8, 1.35],    // Singapore
  134: [14.4, 35.9],     // Malta
  140: [7.4, 43.7],      // Monaco
  177: [-66.5, 18.2],    // Puerto Rico
  135: [-61, 14.6],      // Martinique
  87:  [-61.5, 16.2],    // Guadeloupe
  182: [55.5, -21.1],    // Reunion
  69:  [-53, 4],         // French Guiana
  299: [35.2, 31.9],     // Palestine
  31:  [3.4, -54.4],     // Bouvet Island
};

/** The shipped view. The URL carries only what differs from this, and so do the chips. */
const DEFAULTS = {
  item: 656, metric: 'qty', year: 2024, span: 1, rule: 'importer',
  expZone: 'all', impZone: 'all',
  minFlowIdx: 6, topEdges: 400, scale: 'auto',
  directOnly: false, simpleLines: false,
};

const state = {
  ...DEFAULTS, unitPerStrand: 5000,
  projection: 'naturalEarth1', showLabels: true, showNodes: true, curved: true,
  selected: null, search: '', trace: false, chain: null,
  data: null, meta: null, world: null, centroids: new Map(),
  transform: d3.zoomIdentity, fitPending: true,
};

// ---------------------------------------------------------------- formatting

const fmt = (v) => state.metric === 'value'
  ? (v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'bn' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'm' : '$' + v.toFixed(0) + 'k')
  : (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M t' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k t' : v.toFixed(0) + ' t');
const scales = () => state.metric === 'value' ? SCALES_VAL : SCALES_QTY;
const short = (n) => window.shortCountryName(n, 0);

/**
 * Hue by role, lightness by volume. Exporters and importers are ranked against the
 * largest on their own side so neither side is flattened by the other.
 */
function nodeColour(n) {
  if (!n) return css('--cat-other');
  const seller = n.exports >= n.imports;
  const base = seller ? css('--origin') : css('--market');
  const max = seller ? (state.maxExports || 1) : (state.maxImports || 1);
  const v = seller ? n.exports : n.imports;
  return window.valueTint(base, max > 0 ? v / max : 0);
}

// ---------------------------------------------------------------- geography

async function loadWorld() {
  const topo = await (await fetch('/vendor/countries-110m.json')).json();
  const countries = topojson.feature(topo, topo.objects.countries);
  state.world = countries;

  // Join on M49: the world file's numeric ids are ISO 3166-1 numeric, same code space.
  for (const f of countries.features) {
    const id = +f.id;
    if (!Number.isFinite(id)) continue;
    const c = d3.geoCentroid(f);
    if (c && Number.isFinite(c[0])) state.centroids.set(id, c);
  }
}

/** lon/lat for a country row, by M49 with a fallback table. */
function posOf(country) {
  if (FALLBACK_POS[country.code]) return FALLBACK_POS[country.code];
  if (country.m49 && state.centroids.has(country.m49)) return state.centroids.get(country.m49);
  return null;
}

// ---------------------------------------------------------------- data

async function load() {
  setRunState('loading…');
  const p = new URLSearchParams({
    items: state.item, metric: state.metric,
    yearFrom: state.year, yearTo: state.year + state.span - 1,
    rule: state.rule, expZone: state.expZone, impZone: state.impZone,
    minFlow: FLOW_STEPS[state.minFlowIdx], topEdges: Math.max(state.topEdges, 50),
  });
  state.data = await window.fetchJSON('/api/network?' + p, 'nodes');
  refreshTimeline();
  state.fitPending = true;   // new selection -> reframe
  chooseScale();
  render();
  setRunState('');
}

function chooseScale() {
  const shown = state.data.nodes.reduce((s, n) => s + n.exports, 0) || 1;
  if (state.scale !== 'auto') { state.unitPerStrand = +state.scale; return; }
  const o = scales();
  state.unitPerStrand = o.find((u) => shown / u <= TARGET_STRANDS) ?? o[o.length - 1];
}

// ---------------------------------------------------------------- render

let projection, pathGen, zoom;

function buildProjection(w, h) {
  const fns = {
    naturalEarth1: d3.geoNaturalEarth1, equirectangular: d3.geoEquirectangular,
    mercator: d3.geoMercator, orthographic: d3.geoOrthographic,
  };
  projection = (fns[state.projection] ?? d3.geoNaturalEarth1)();
  if (state.projection === 'mercator') {
    // Mercator runs to infinity at the poles; clip to the inhabited band.
    projection.fitExtent([[4, 4], [w - 4, h - 4]], { type: 'Sphere' });
    projection.scale(projection.scale() * 1.35).translate([w / 2, h / 2 + h * 0.12]);
  } else {
    projection.fitExtent([[6, 6], [w - 6, h - 6]], { type: 'Sphere' });
  }
  pathGen = d3.geoPath(projection);
}

/** Everything that is not the shipped default, as removable chips, and in the URL. */
function syncFilters() {
  window.writeUrlState(state, DEFAULTS);
  const label = (id, v) => {
    const el = document.getElementById(id);
    const opt = el && [...el.options].find((o) => o.value === String(v));
    return opt ? opt.textContent : String(v);
  };
  const set = (patch) => { Object.assign(state, patch); state.selected = null; syncControls(); load().catch(() => {}); };

  const items = [];
  if (state.item !== DEFAULTS.item) items.push({ label: 'Product', value: label('item', state.item), clear: () => set({ item: DEFAULTS.item }) });
  if (state.expZone !== DEFAULTS.expZone) items.push({ label: 'Sellers', value: label('expZone', state.expZone), clear: () => set({ expZone: DEFAULTS.expZone }) });
  if (state.impZone !== DEFAULTS.impZone) items.push({ label: 'Buyers', value: label('impZone', state.impZone), clear: () => set({ impZone: DEFAULTS.impZone }) });
  if (state.rule !== DEFAULTS.rule) items.push({ label: 'Reported by', value: label('rule', state.rule), clear: () => set({ rule: DEFAULTS.rule }) });
  if (state.metric !== DEFAULTS.metric) items.push({ label: 'Measure', value: 'Value', clear: () => set({ metric: DEFAULTS.metric, scale: 'auto' }) });
  if (state.year !== DEFAULTS.year || state.span !== DEFAULTS.span) {
    items.push({ label: 'Years', value: yearLabel(), clear: () => {
      state.year = DEFAULTS.year; state.span = DEFAULTS.span;
      state.timeRange.set(state.year, state.year + state.span - 1);
    } });
  }
  if (state.directOnly !== DEFAULTS.directOnly) items.push({ label: 'Routes', value: 'direct only', clear: () => set({ directOnly: DEFAULTS.directOnly }) });
  if (state.simpleLines !== DEFAULTS.simpleLines) items.push({ label: 'Lines', value: 'simplified', clear: () => set({ simpleLines: DEFAULTS.simpleLines }) });

  window.renderChips(document.getElementById('chips'), items, () => {
    Object.assign(state, DEFAULTS); state.selected = null; syncControls();
    state.timeRange.set(state.year, state.year + state.span - 1);
  });
}

/** Push state back into the controls, for when a chip changed it rather than the control. */
function syncControls() {
  for (const id of ['item', 'rule', 'expZone', 'impZone', 'scale']) {
    const el = document.getElementById(id); if (el) el.value = String(state[id]);
  }
  const m = document.getElementById('metric');
  if (m) [...m.children].forEach((c) => c.setAttribute('aria-pressed', c.dataset.v === state.metric));
  for (const [id, k] of [['directOnly', 'directOnly'], ['simpleLines', 'simpleLines']]) {
    const el = document.getElementById(id); if (el) el.checked = state[k];
  }
}

function render() {
  syncFilters();
  const node = svg.node();
  const w = node.clientWidth || 900, h = node.clientHeight || 560;
  svg.attr('viewBox', `0 0 ${w} ${h}`);
  svg.selectAll('*').remove();
  buildProjection(w, h);

  const defs = svg.append('defs');
  const root = svg.append('g').attr('class', 'zoomroot');

  // --- basemap ---
  const base = root.append('g');
  base.append('path').attr('class', 'sphere').attr('d', pathGen({ type: 'Sphere' }));
  base.append('path').attr('class', 'graticule').attr('d', pathGen(d3.geoGraticule10()));
  base.append('g').selectAll('path').data(state.world.features).join('path')
    .attr('class', 'land').attr('d', pathGen);

  // --- routes ---
  const { nodes, edges } = state.data;
  const byIdx = new Map(nodes.map((n) => [n.idx, n]));
  // Scale each side against its own largest, once per render.
  state.maxExports = d3.max(nodes, (n) => n.exports) || 1;
  state.maxImports = d3.max(nodes, (n) => n.imports) || 1;
  const flowsG = root.append('g');
  let drawn = 0, routes = 0, skipped = 0;

  // A seller that takes in more than it ships is re-exporting rather than growing.
  // Half is a deliberate midpoint: pure growers sit near 0, pure entrepots near 1.
  const REEXPORT_CUT = 0.5;
  let ordered = [...edges].sort((a, b) => b.w - a.w);
  if (state.directOnly) {
    ordered = ordered.filter((e) => (byIdx.get(e.s)?.reexport ?? 0) <= REEXPORT_CUT);
  }
  ordered = ordered.slice(0, state.topEdges);
  let hiddenReexports = 0;
  if (state.directOnly) hiddenReexports = edges.length - ordered.length;

  for (const e of ordered) {
    const s = byIdx.get(e.s), t = byIdx.get(e.t);
    if (!s || !t) continue;
    const ps = posOf(s), pt2 = posOf(t);
    if (!ps || !pt2) { skipped++; continue; }
    const a = projection(ps), b = projection(pt2);
    if (!a || !b) { skipped++; continue; }

    const n = state.simpleLines ? 1 : Math.max(1, Math.round(e.w / state.unitPerStrand));
    let d = '';
    // Strands are spread by fanning the control point, so a heavy route reads as a
    // countable bundle rather than one fat line. In simplified mode a route is one
    // line whose width carries the volume instead.
    for (let i = 0; i < n && drawn < MAX_STRANDS; i++, drawn++) {
      const u = n === 1 ? 0 : (i / (n - 1)) - 0.5;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular offset: base bow plus a per-strand spread.
      const bow = state.curved ? len * 0.18 : 0;
      const off = bow + u * Math.min(len * 0.22, 46);
      const cx = mx - (dy / len) * off, cy = my + (dx / len) * off;
      d += `M${a[0].toFixed(1)},${a[1].toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
    }
    const gid = window.flowGradient(defs, `fg${routes}`, a[0], a[1], b[0], b[1],
      nodeColour(s), nodeColour(t));
    flowsG.append('path')
      .attr('class', 'flow')
      .attr('d', d)
      .attr('stroke', gid)
      .attr('stroke-width', state.simpleLines
        ? Math.max(0.6, Math.sqrt(e.w / (state.unitPerStrand * 4)) * 1.8) : 0.7)
      .attr('stroke-opacity', state.simpleLines ? 0.75 : 0.42)
      .attr('data-s', e.s).attr('data-t', e.t)
      .attr('data-w', state.simpleLines
        ? Math.max(0.6, Math.sqrt(e.w / (state.unitPerStrand * 4)) * 1.8) : 0.7)
      .on('mousemove', (ev) => showTip(ev, `${short(s.name)} → ${short(t.name)}`,
        [[fmt(e.w), 'shipped'], [`${n} strand${n === 1 ? '' : 's'}`, 'drawn']]))
      .on('mouseleave', hideTip);
    routes++;
  }

  // --- second leg (estimated re-exports), drawn dashed so it never reads as
  //     observed trade ---
  if (state.trace && state.chain) {
    const chainG = root.append('g');
    const byCode = new Map(state.chain.nodes.map((n) => [n.idx, n]));
    for (const leg of state.chain.secondLeg.slice(0, 120)) {
      const h = byCode.get(leg.hub), d2 = byCode.get(leg.dest);
      if (!h || !d2) continue;
      const ph = posOf(h), pd = posOf(d2);
      if (!ph || !pd) continue;
      const a = projection(ph), b = projection(pd);
      if (!a || !b) continue;

      const n = Math.max(1, Math.round(leg.w / state.unitPerStrand));
      let d = '';
      for (let i = 0; i < n && i < 60; i++) {
        const u = n === 1 ? 0 : (i / (n - 1)) - 0.5;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const off = (state.curved ? -len * 0.16 : 0) + u * Math.min(len * 0.2, 34);
        const cx = mx - (dy / len) * off, cy = my + (dx / len) * off;
        d += `M${a[0].toFixed(1)},${a[1].toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
      }
      chainG.append('path')
        .attr('class', 'flow leg2')
        .attr('d', d)
        .attr('stroke', css('--cat-2'))
        .attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '3 2.5')
        .attr('stroke-opacity', 0.6)
        .on('mousemove', (ev) => showTip(ev, `${short(h.name)} → ${short(d2.name)}`,
          [[fmt(leg.w), 'estimated onward'], [`${(leg.share * 100).toFixed(0)}%`, 'of hub intake from origin']]))
        .on('mouseleave', hideTip);
    }
  }

  // --- country circles ---
  const nodesG = root.append('g');
  if (state.showNodes) {
    const maxThru = d3.max(nodes, (n) => n.throughput) || 1;
    const r = d3.scaleSqrt().domain([0, maxThru]).range([1.2, 16]);
    const placed = nodes.map((n) => ({ n, p: posOf(n) })).filter((d) => d.p);

    nodesG.selectAll('circle').data(placed).join('circle')
      .attr('class', 'cnode')
      .attr('cx', (d) => projection(d.p)[0])
      .attr('cy', (d) => projection(d.p)[1])
      .attr('r', (d) => r(d.n.throughput))
      .attr('fill', (d) => nodeColour(d.n))
      .attr('fill-opacity', 0.85)
      .attr('stroke', css('--surface-1'))
      .attr('stroke-width', 0.8)
      .on('mousemove', (e, d) => showTip(e, short(d.n.name), [
        [fmt(d.n.exports), 'exported'], [fmt(d.n.imports), 'imported'],
        [d.n.reexport.toFixed(2), 're-export ratio'],
      ]))
      .on('mouseleave', hideTip)
      .on('click', (e, d) => {
        state.selected = state.selected === d.n.idx ? null : d.n.idx;
        refreshSelection();
        render();                       // the donut is part of the drawing
        loadChain().then(() => { if (state.trace) render(); });
      });

    if (state.showLabels) {
      const top = [...placed].sort((a, b) => b.n.throughput - a.n.throughput).slice(0, 26);
      nodesG.selectAll('text').data(top).join('text')
        .attr('class', 'cnode-label')
        .attr('x', (d) => projection(d.p)[0] + r(d.n.throughput) + 3)
        .attr('y', (d) => projection(d.p)[1] + 3)
        .text((d) => short(d.n.name));
    }
  }

  // --- selecting a country turns its partners into proportion pies ---
  if (state.selected != null) {
    const maxThru = d3.max(nodes, (n) => n.throughput) || 1;
    drawPartnerPies(root, byIdx.get(state.selected), byIdx, projection,
                    d3.scaleSqrt().domain([0, maxThru]).range([1.2, 16]));
    drawSelectionDonut(root, byIdx.get(state.selected), byIdx, projection);
  }

  // --- zoom ---
  zoom = d3.zoom().scaleExtent([1, 12]).on('zoom', (ev) => {
    state.transform = ev.transform;
    root.attr('transform', ev.transform);
    // Keep strokes visually constant as the map scales up.
    root.selectAll('.flow').attr('stroke-width', function () {
      const base = +this.getAttribute('data-w') || 0.7;
      return base / Math.sqrt(ev.transform.k);
    });
    root.selectAll('.cnode').attr('stroke-width', 0.8 / ev.transform.k);
    root.selectAll('.cnode-label').style('font-size', (10 / ev.transform.k) + 'px')
      .style('stroke-width', (2.6 / ev.transform.k) + 'px');
  });
  svg.call(zoom).on('dblclick.zoom', null);
  if (state.transform && state.transform.k !== 1) svg.call(zoom.transform, state.transform);

  // Filtering to a region leaves the rest of the world empty, so frame what is
  // actually drawn. Only on fresh data -- toggling a checkbox must not yank the
  // view out from under someone who has zoomed in deliberately.
  if (state.fitPending) {
    state.fitPending = false;
    const pts = state.data.nodes.map(posOf).filter(Boolean).map((p) => projection(p)).filter(Boolean);
    if (pts.length > 1) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pad = 60;
      const k = Math.max(1, Math.min(8,
        Math.min((w - pad * 2) / Math.max(x1 - x0, 1), (h - pad * 2) / Math.max(y1 - y0, 1))));
      const t = d3.zoomIdentity
        .translate(w / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2)
        .scale(k);
      state.transform = t;
    }
  }

  // The map is the content, not decoration, so its accessible name has to say what is on it
  // now rather than what it was called at build time.
  svg.attr('aria-label',
    `World map, ${routes.toLocaleString()} coffee routes drawn of ${state.data.totals.edgesTotal.toLocaleString()}, `
    + `${fmt(state.data.totals.world)} in total`);
  document.getElementById('cStrands').textContent = drawn.toLocaleString();
  document.getElementById('cFlows').textContent = routes.toLocaleString();
  updateScaleKey(drawn, skipped, routes);
  updateStats();
  updateTopRoutes();
  updateTable();
  refreshSelection();
  paint();
}

/**
 * Selecting a country turns each of its partners into a proportion pie, in place.
 *
 * Select an exporter and every country it ships to fills in by how much of ITS OWN intake
 * came from the selection: Germany reads about 42% full for Brazil, a country Brazil barely
 * supplies reads nearly empty. The denominator is always the partner's total, never the
 * selection's shipments, which is the whole point. A flow line can only say how much moved;
 * it cannot say whether that much mattered to the country receiving it. Brazil's largest
 * route by tonnage and Brazil's largest route by dependence are not the same route, and
 * until now the map could not show the second one.
 *
 * Selecting a buyer reads the same way in reverse: each origin fills in by the share of its
 * own shipments that go to the selection.
 *
 * The pie keeps the node's map radius, so size still means volume moved and the new channel
 * is angle alone. Only partners on routes the map has actually drawn get one, since a pie
 * over a filtered-out route would claim a precision the view is not showing.
 */
function drawPartnerPies(root, sel, byIdx, projection, r) {
  if (!sel) return;

  const rows = [];
  for (const e of state.data.edges) {
    const outgoing = e.s === sel.idx;
    if (!outgoing && e.t !== sel.idx) continue;
    const other = byIdx.get(outgoing ? e.t : e.s);
    if (!other) continue;
    // Against the partner's own total on the side that receives this flow.
    const whole = outgoing ? other.imports : other.exports;
    if (!(whole > 0)) continue;
    rows.push({ other, w: e.w, share: Math.min(1, e.w / whole), outgoing });
  }
  if (!rows.length) return;

  const g = root.append('g').attr('class', 'partner-pies');
  const arc = d3.arc().startAngle(0);

  for (const row of rows) {
    const p = posOf(row.other); if (!p) continue;
    const xy = projection(p); if (!xy) continue;
    // A floor on the radius: at map scale the smallest nodes are barely over a pixel, and an
    // angle cannot be read off a dot.
    const rad = Math.max(7, r(row.other.throughput));
    const cell = g.append('g').attr('transform', `translate(${xy[0]},${xy[1]})`);

    // A ring, not a disc, and it keeps the country's OWN colour: the same colour the node
    // was drawn in before it was selected into a ring, so the map's origin-to-market ramp
    // survives. Filling the share in the selection's colour instead made every ring on the
    // map the same hue, which threw away the one thing the node colour was already saying.
    //
    // The share is that colour at full strength and the remainder is the same colour ghosted,
    // so the proportion is read as one hue at two weights rather than as two categories.
    const rIn = rad * 0.5;
    const colour = nodeColour(row.other);
    cell.append('circle').attr('r', rad)
      .attr('fill', css('--surface')).attr('fill-opacity', 0.92)
      .attr('stroke', css('--line-strong')).attr('stroke-width', 0.7);
    cell.append('path')
      .attr('d', arc.innerRadius(rIn).outerRadius(rad).endAngle(2 * Math.PI)())
      .attr('fill', colour).attr('fill-opacity', 0.2);
    cell.append('path')
      .attr('d', arc.innerRadius(rIn).outerRadius(rad).endAngle(row.share * 2 * Math.PI)())
      .attr('fill', colour).attr('fill-opacity', 0.95);

    cell.append('circle').attr('r', rad).attr('fill', 'transparent')
      .on('mousemove', (e) => showTip(e,
        row.outgoing ? `${short(sel.name)} → ${short(row.other.name)}`
                     : `${short(row.other.name)} → ${short(sel.name)}`,
        [[fmt(row.w), row.outgoing ? 'supplied' : 'shipped'],
         [(row.share * 100).toFixed(1) + '%',
          row.outgoing ? `of ${short(row.other.name)}'s intake`
                       : `of ${short(row.other.name)}'s exports`]]))
      .on('mouseleave', hideTip);
  }

  // Label the partners where the selection matters most, which is not the same as the
  // partners it ships the most to. Brazil's biggest route by tonnage is Germany at 42%; its
  // biggest by dependence is Argentina at 90%, and only one of those is a headline.
  //
  // Candidates are walked in order of share and a label is dropped whenever it would land on
  // one already placed. Western Europe is a dozen buyers inside a few hundred kilometres, so
  // without this the strongest numbers on the map are the ones printed on top of each other.
  // The country names are already in the DOM at this point, so they can be treated as
  // occupied space rather than guessed at. Without this the percentages avoid each other
  // neatly and then land on "Poland".
  const taken = [];
  root.selectAll('text.cnode-label').each(function () {
    const x = +this.getAttribute('x'), y = +this.getAttribute('y');
    const w = (this.textContent || '').length * 5.2;
    const anchor = this.getAttribute('text-anchor');
    taken.push([anchor === 'middle' ? x - w / 2 : x, y - 9, w, 12]);
  });
  const hits = (bx) => taken.some((q) =>
    bx[0] < q[0] + q[2] && q[0] < bx[0] + bx[2] && bx[1] < q[1] + q[3] && q[1] < bx[1] + bx[3]);

  let n = 0;
  for (const row of [...rows].sort((a, b) => b.share - a.share)) {
    if (n >= 8) break;
    if (row.share < 0.15) break;              // below this it is not worth the ink
    const p = posOf(row.other); if (!p) continue;
    const xy = projection(p); if (!xy) continue;
    const rad = Math.max(7, r(row.other.throughput));
    const at = [xy[0], xy[1] - rad - 3];
    // Above first, then below: a partner worth labelling is worth one attempt at moving.
    let box = [at[0] - 13, at[1] - 9, 26, 12];
    if (hits(box)) {
      at[1] = xy[1] + rad + 11;
      box = [at[0] - 13, at[1] - 9, 26, 12];
      if (hits(box)) continue;
    }
    taken.push(box);
    n++;
    g.append('text')
      .attr('class', 'cnode-label')
      .attr('x', at[0]).attr('y', at[1])
      .attr('text-anchor', 'middle')
      .style('font-size', '9.5px').style('font-weight', 700)
      .text(Math.round(row.share * 100) + '%');
  }
}

/**
 * A selected country stops being a dot and becomes a donut of where its coffee came from.
 *
 * The ring is always the BUYING side: one wedge per origin, sized by how much of this
 * country's intake that origin supplied, each wedge in the origin's own colour. It used to
 * flip to the selling side for any country that exported more than it imported, which meant
 * the same ring answered two different questions depending on who you clicked, and nothing
 * on the ring said which. Fixing it to intake makes it the map's version of a breakdown
 * dial, and the flows already drawn on the map carry the outgoing side.
 *
 * A country with no recorded intake gets no ring. That is most pure origins, and it is the
 * honest outcome: the question the ring answers does not apply to them.
 */
function drawSelectionDonut(root, node, byIdx, projection) {
  if (!node) return;
  const p = posOf(node); if (!p) return;
  const [cx, cy] = projection(p);

  const rows = state.data.edges
    .filter((e) => e.t === node.idx)
    .map((e) => ({ other: byIdx.get(e.s), w: e.w }))
    .filter((r) => r.other)
    .sort((a, b) => b.w - a.w);
  if (!rows.length) return;

  const top = rows.slice(0, 8);
  const restW = rows.slice(8).reduce((a, b) => a + b.w, 0);
  if (restW > 0) top.push({ other: { name: `Other origins (${rows.length - 8})`, idx: -1 }, w: restW, pooled: true });
  const total = top.reduce((a, b) => a + b.w, 0) || 1;

  // Sized by intake against the largest importer, so a country that barely buys gets a
  // small ring. The old line divided throughput by the largest EXPORT, which is a ratio
  // between two different quantities and could exceed 1, and only the clamp hid it.
  const rOuter = Math.max(14, Math.min(38, 9 + Math.sqrt(node.imports / (state.maxImports || 1)) * 34));
  const rInner = rOuter * 0.52;

  const g = root.append('g').attr('class', 'sel-donut')
    .attr('transform', `translate(${cx},${cy})`);

  // A soft ground so the ring reads over land and flows alike.
  g.append('circle').attr('r', rOuter + 2.5)
    .attr('fill', css('--surface')).attr('fill-opacity', 0.9)
    .attr('stroke', css('--line-strong')).attr('stroke-width', 0.8);

  const pie = d3.pie().sort(null).value((d) => d.w);
  const arc = d3.arc().innerRadius(rInner).outerRadius(rOuter).padAngle(0.02).cornerRadius(1);

  g.selectAll('path').data(pie(top)).join('path')
    .attr('d', arc)
    .attr('fill', (d) => d.data.pooled ? css('--cat-other') : nodeColour(d.data.other))
    .attr('stroke', css('--surface')).attr('stroke-width', 0.6)
    .on('mousemove', (e, d) => showTip(e,
      `${short(d.data.other.name)} → ${short(node.name)}`,
      [[fmt(d.data.w), 'supplied'],
       [((d.data.w / total) * 100).toFixed(1) + '%', 'of its intake']]))
    .on('mouseleave', hideTip);

  // The country's own colour sits in the hole, so the ring still says who this is.
  g.append('circle').attr('r', rInner - 1.5).attr('fill', nodeColour(node));
  g.append('text').attr('y', rOuter + 12).attr('text-anchor', 'middle')
    .attr('class', 'cnode-label').style('font-size', '10px').style('font-weight', 650)
    .text(short(node.name));
}

/** Emphasis for selection/search, without re-rendering. */
function paint() {
  const sel = state.selected;
  const q = state.search;
  svg.selectAll('.flow').attr('stroke-opacity', function () {
    if (sel == null) return 0.42;
    const s = +this.getAttribute('data-s'), t = +this.getAttribute('data-t');
    return (s === sel || t === sel) ? 0.85 : 0.05;
  });
  svg.selectAll('.cnode').attr('fill-opacity', (d) => {
    if (q && !short(d.n.name).toLowerCase().includes(q)) return 0.15;
    if (sel == null) return 0.85;
    return d.n.idx === sel ? 1 : 0.25;
  });
}

// ---------------------------------------------------------------- panels

function updateScaleKey(drawn, skipped, routesDrawn) {
  document.getElementById('scaleKey').textContent = `1 strand = ${fmt(state.unitPerStrand)}`;
  const sw = d3.select('#scaleSwatch');
  sw.selectAll('*').remove();
  for (let i = 0; i < 10; i++) {
    sw.append('line').attr('x1', 3 + i * 5.5).attr('x2', 3 + i * 5.5).attr('y1', 3).attr('y2', 19)
      .attr('stroke', css('--text-secondary')).attr('stroke-width', 0.8).attr('stroke-opacity', 0.75);
  }
  const bits = [state.simpleLines
    ? `${routesDrawn.toLocaleString()} routes, one line each`
    : `${drawn.toLocaleString()} strands drawn`];
  if (state.directOnly) bits.push('re-export legs hidden');
  if (drawn >= MAX_STRANDS) bits.push('capped, choose a coarser scale');
  if (skipped) bits.push(`${skipped} route${skipped === 1 ? '' : 's'} without map coordinates`);
  document.getElementById('scaleNote').textContent = bits.join(' · ') + '.';
}

function updateStats() {
  const t = state.data.totals;
  const q = state.data.query || {};
  document.getElementById('stats').innerHTML = [
    ['Trade shown', fmt(t.world)],
    ['Routes total', t.edgesTotal.toLocaleString()],
    ['Countries', state.data.nodes.length],
    ['Sellers from', q.expLabel ?? 'Everywhere'],
    ['Buyers in', q.impLabel ?? 'Everywhere'],
  ].map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
}

/** Tabular fallback for the routes on screen. */
function updateTable() {
  const byIdx = new Map(state.data.nodes.map((n) => [n.idx, n]));
  const rows = [...state.data.edges].sort((a, b) => b.w - a.w).slice(0, 300);
  document.getElementById('flowTable').innerHTML =
    `<thead><tr><th>Seller</th><th>Buyer</th><th style="text-align:right">${state.metric === 'value' ? 'Value' : 'Quantity'}</th></tr></thead>
     <tbody>${rows.map((e) => {
       const s = byIdx.get(e.s), t = byIdx.get(e.t);
       if (!s || !t) return '';
       return `<tr><td>${short(s.name)}</td><td>${short(t.name)}</td><td class="num">${fmt(e.w)}</td></tr>`;
     }).join('')}</tbody>`;
}

function updateTopRoutes() {
  const byIdx = new Map(state.data.nodes.map((n) => [n.idx, n]));
  const rows = [...state.data.edges].sort((a, b) => b.w - a.w).slice(0, 12);
  document.getElementById('topRoutes').innerHTML = rows.map((e) => {
    const s = byIdx.get(e.s), t = byIdx.get(e.t);
    if (!s || !t) return '';
    return `<div class="rank"><span class="n">${short(s.name)} → ${short(t.name)}</span><span class="s">${fmt(e.w)}</span></div>`;
  }).join('');
}

/** Fetches the two-leg chain for the selected origin. */
async function loadChain() {
  const box = document.getElementById('chainSummary');
  const list = document.getElementById('chainList');
  const caveat = document.getElementById('chainCaveat');
  if (!state.trace || state.selected == null) {
    state.chain = null;
    box.innerHTML = '<p class="hint" style="margin:0">Turn on tracing and pick a country.</p>';
    list.innerHTML = ''; caveat.style.display = 'none';
    return;
  }
  const node = state.data.nodes.find((n) => n.idx === state.selected);
  if (!node) return;

  const p = new URLSearchParams({
    origin: node.code, items: state.item, metric: state.metric,
    yearFrom: state.year, yearTo: state.year + state.span - 1,
    rule: state.rule, expZone: state.expZone, impZone: state.impZone,
  });
  const res = await fetch('/api/chains?' + p);
  if (!res.ok) { box.textContent = 'chain unavailable'; return; }
  state.chain = await res.json();

  const t = state.chain.totals;
  box.innerHTML = `
    <div style="font-weight:650;margin-bottom:4px">${short(state.chain.origin.name)}</div>
    <div class="row"><span class="k">Direct exports</span><span class="v">${fmt(t.directExports)}</span></div>
    <div class="row"><span class="k">Est. onward</span><span class="v">${fmt(t.attributedOnward)}</span></div>
    <div class="row"><span class="k">Hubs</span><span class="v">${t.hubCount}</span></div>`;

  const byIdx = new Map(state.chain.nodes.map((n) => [n.idx, n]));
  list.innerHTML = state.chain.secondLeg.slice(0, 10).map((leg) => {
    const h = byIdx.get(leg.hub), d2 = byIdx.get(leg.dest);
    return `<div class="rank"><span class="n">→ ${h ? short(h.name) : '?'} → ${d2 ? short(d2.name) : '?'}</span><span class="s">${fmt(leg.w)}</span></div>`;
  }).join('') || '<div class="hint">No onward legs above the threshold.</div>';
  caveat.style.display = 'block';
}

function refreshSelection() {
  const box = document.getElementById('selBody');
  if (state.selected == null) {
    box.innerHTML = '<p class="hint" style="margin-top:0">Click a country on the map.</p>';
    return;
  }
  const byIdx = new Map(state.data.nodes.map((n) => [n.idx, n]));
  const n = byIdx.get(state.selected);
  if (!n) { box.innerHTML = '<p class="hint">Not in this view.</p>'; return; }

  const out = state.data.edges.filter((e) => e.s === n.idx).sort((a, b) => b.w - a.w).slice(0, 6);
  const inc = state.data.edges.filter((e) => e.t === n.idx).sort((a, b) => b.w - a.w).slice(0, 6);
  const line = (e, dir) => {
    const other = byIdx.get(dir === 'out' ? e.t : e.s);
    return `<div class="rank"><span class="n">${dir === 'out' ? '→' : '←'} ${other ? short(other.name) : '?'}</span><span class="s">${fmt(e.w)}</span></div>`;
  };
  box.innerHTML = `
    <div style="font-weight:650">${short(n.name)}</div>
    <div class="hint" style="margin:0 0 8px">${n.continent}</div>
    <div class="row"><span class="k">Exports</span><span class="v">${fmt(n.exports)}</span></div>
    <div class="row"><span class="k">Imports</span><span class="v">${fmt(n.imports)}</span></div>
    <div class="row"><span class="k">Re-export ratio</span><span class="v">${n.reexport.toFixed(2)}</span></div>
    ${out.length ? '<div class="k" style="margin-top:8px;font-size:12.5px">Ships to</div>' + out.map((e) => line(e, 'out')).join('') : ''}
    ${inc.length
      ? '<div class="k" style="margin-top:8px;font-size:12.5px">Receives from</div>' + inc.map((e) => line(e, 'in')).join('')
      : '<p class="hint" style="margin-top:8px">No recorded intake in this view, so no ring is drawn on the map. The ring always splits a country’s imports by origin; this one only ships.</p>'}`;
  document.getElementById('selBox').open = true;
}

function showTip(e, name, rows) {
  tip.innerHTML = `<div class="t-name">${name}</div>` +
    rows.map(([v, k]) => `<div class="t-row"><span class="t-num">${v}</span> ${k}</div>`).join('');
  tip.classList.add('on');
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
}
const hideTip = () => tip.classList.remove('on');
const setRunState = (t) => {
  const el = document.getElementById('runstate');
  el.textContent = t; el.style.display = t ? 'block' : 'none';
};

// ---------------------------------------------------------------- controls

function populateZones() {
  const groups = {};
  for (const z of state.meta.zones) (groups[z.group || ''] ??= []).push(z);
  const html = Object.entries(groups).map(([g, list]) =>
    g ? `<optgroup label="${g}">${list.map((z) => `<option value="${z.id}">${z.label}</option>`).join('')}</optgroup>`
      : list.map((z) => `<option value="${z.id}">${z.label}</option>`).join('')).join('');
  for (const id of ['expZone', 'impZone']) {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = html; el.value = 'all'; }
  }
}

function populateScaleOptions() {
  const sel = document.getElementById('scale');
  sel.innerHTML = '<option value="auto">Auto</option>' +
    scales().map((u) => `<option value="${u}">1 strand = ${fmt(u)}</option>`).join('');
  sel.value = 'auto'; state.scale = 'auto';
}

function wire() {
  const $ = (id) => document.getElementById(id);
  const reload = () => load().catch((e) => setRunState('failed: ' + e.message));
  const debounce = (fn, ms = 220) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const reloadSoon = debounce(reload);

  $('item').onchange = (e) => { state.item = +e.target.value; reload(); };
  $('rule').onchange = (e) => { state.rule = e.target.value; reload(); };
  $('expZone').onchange = (e) => { state.expZone = e.target.value; state.selected = null; reload(); };
  $('impZone').onchange = (e) => { state.impZone = e.target.value; state.selected = null; reload(); };
  $('metric').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.setAttribute('aria-pressed', c === b));
    state.metric = b.dataset.v; populateScaleOptions(); reload();
  };
  $('scale').onchange = (e) => { state.scale = e.target.value; chooseScale(); render(); };
  $('minFlow').oninput = (e) => {
    state.minFlowIdx = +e.target.value;
    $('minFlowVal').textContent = state.metric === 'value'
      ? '$' + FLOW_STEPS[state.minFlowIdx].toLocaleString() + 'k'
      : FLOW_STEPS[state.minFlowIdx].toLocaleString() + ' t';
    reloadSoon();
  };
  $('topEdges').oninput = (e) => {
    state.topEdges = +e.target.value; $('topEdgesVal').textContent = state.topEdges; render();
  };
  $('projection').onchange = (e) => { state.projection = e.target.value; state.transform = d3.zoomIdentity; render(); };
  $('directOnly').onchange = (e) => { state.directOnly = e.target.checked; render(); };
  $('simpleLines').onchange = (e) => { state.simpleLines = e.target.checked; render(); };
  $('showLabels').onchange = (e) => { state.showLabels = e.target.checked; render(); };
  $('showNodes').onchange = (e) => { state.showNodes = e.target.checked; render(); };
  $('curved').onchange = (e) => { state.curved = e.target.checked; render(); };
  $('traceOn').onchange = (e) => {
    state.trace = e.target.checked;
    loadChain().then(() => render());
  };
  $('showTable').onchange = (e) => document.getElementById('tableView').classList.toggle('on', e.target.checked);
  $('search').oninput = (e) => { state.search = e.target.value.trim().toLowerCase(); paint(); };

  // The poster renders the chord form, so this carries the filters across, not the
  // map framing.
  $('toPoster').onclick = () => {
    const p = new URLSearchParams({
      item: state.item, metric: state.metric, year: state.year, span: state.span,
      rule: state.rule, expZone: state.expZone, impZone: state.impZone,
    });
    if (state.scale !== 'auto') p.set('scale', state.scale);
    location.href = '/poster?' + p;
  };

  $('zIn').onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.6);
  $('zOut').onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6);
  $('zFit').onclick = () => {
    state.transform = d3.zoomIdentity;
    svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  };
  $('zFitData').onclick = () => { state.fitPending = true; render(); };

  addEventListener('resize', debounce(() => render(), 250));
}

/** Keeps the window inside the record. The range control renders its own readout. */
function syncYear() {
  const years = state.meta.years, last = years[years.length - 1];
  if (state.year + state.span - 1 > last) state.year = Math.max(years[0], last - state.span + 1);
}

/**
 * Reloading holds the previous render at reduced opacity rather than blanking it:
 * no skeleton, no layout jump, and the shape you were reading stays on screen while
 * the next slice arrives.
 */
let _rangeTimer = null;
async function refreshTimeline() {
  if (!state.timeRange) return;
  try {
    const p = new URLSearchParams({ items: state.item, rule: state.rule,
      metric: state.metric || 'qty', expZone: state.expZone, impZone: state.impZone });
    const r = await fetch('/api/timeline?' + p);
    if (r.ok) state.timeRange.setSeries((await r.json()).series);
  } catch { /* the control simply shows no profile */ }
}

function reloadFromRange() {
  document.body.classList.add('is-loading');
  clearTimeout(_rangeTimer);
  _rangeTimer = setTimeout(() => {
    load()
      .catch(() => {})
      .finally(() => document.body.classList.remove('is-loading'));
  }, 180);
}

// ---------------------------------------------------------------- boot

(async function boot() {
  // A shared link decides the view before anything is drawn.
  Object.assign(state, window.readUrlState(DEFAULTS));
  state.meta = await window.fetchJSON('/api/meta', 'items');
  await loadWorld();
  const years = state.meta.years;

  const sel = document.getElementById('item');
  sel.innerHTML = state.meta.items.map((i) => `<option value="${i.code}">${i.name}</option>`).join('');
  sel.value = String(state.item);

  // One range over the whole record, with the world profile drawn behind it.
  state.timeRange = window.TimeRange(document.getElementById('timeRange'), {
    // Seeded from state, not from the last year. Hardcoding "latest" here made the control
    // claim 2024 while the Breakdown page was querying and drawing 2019-2023. Flows and Map
    // only agreed with their controls by coincidence, because their defaults happen to be
    // the latest year; changing either default would have broken them the same way.
    years, from: state.year, to: state.year + state.span - 1,
    onChange: ({ from, to }) => {
      state.year = from;
      state.span = to - from + 1;
      reloadFromRange();
    },
  });

  populateZones();
  // After the selects exist, push the restored state into them: populateZones resets both
  // zone selects to "all", so a shared link would otherwise filter correctly while the
  // controls claimed the opposite.
  syncControls();
  populateScaleOptions();
  syncYear();
  wire();
  await load();
})().catch((err) => setRunState('could not start: ' + err.message));


// Colours come from the tokens, so a theme flip means a redraw.
addEventListener('themechange', () => { if (state.data) render(); });
