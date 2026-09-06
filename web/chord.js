/* Chord view.
 *
 * Two rules shape this drawing:
 *   1. Sellers occupy one half of the circle and buyers the other, so every strand
 *      crosses the middle and no arc ever trades with its own neighbours. A country
 *      that both buys and re-sells (Germany, Belgium) appears on both halves --
 *      that duplication is the point, not an error.
 *   2. A flow is drawn as N discrete strands of a fixed quantity rather than one
 *      ribbon whose width you have to estimate. Counting strands is exact in a way
 *      that comparing ribbon thicknesses never is.
 */

const SIZE = 900, R_OUT = 300, R_IN = 288, R_STRAND = 285;
const svg = d3.select('#chord');
const tip = document.getElementById('tip');
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// Strand sizes, in tonnes and in thousands of USD. Geometric, so the useful range
// is reachable in a few clicks.
const SCALES_QTY = [250, 500, 1e3, 2.5e3, 5e3, 1e4, 2.5e4, 5e4, 1e5];
const SCALES_VAL = [1e3, 5e3, 1e4, 2.5e4, 5e4, 1e5, 2.5e5, 5e5];
const TARGET_STRANDS = 1400;      // readable density; also keeps the DOM sane
const MAX_STRANDS = 6000;

/** The shipped view. The URL carries only what differs from this, and so do the chips. */
const DEFAULTS = {
  item: 656, metric: 'qty', year: 2024, span: 1,
  topN: 12, rule: 'importer', other: true, scale: 'auto',
  expZone: 'all', impZone: 'all',
};

const state = {
  ...DEFAULTS,
  focus: null, hover: null,
  data: null, meta: null, unitPerStrand: 5000,
};

// ---------------------------------------------------------------- formatting

const fmtT = (v) =>
  v >= 1e6 ? (v / 1e6).toFixed(2) + 'M t' :
  v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k t' :
  v.toFixed(0) + ' t';

const fmtV = (v) =>                       // values arrive in thousands of USD
  v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'bn' :
  v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'm' :
  '$' + v.toFixed(0) + 'k';

const fmt = (v) => state.metric === 'value' ? fmtV(v) : fmtT(v);
const short = (n) => window.shortCountryName(n, 0);
const scales = () => state.metric === 'value' ? SCALES_VAL : SCALES_QTY;

// ---------------------------------------------------------------- colour

/**
 * Hue by side, lightness by how much this country moved relative to the largest on
 * its own side. Sellers and buyers are scaled independently, so the biggest seller
 * and the biggest buyer are both fully saturated rather than the smaller side being
 * washed out by the larger one.
 */
function buildColours(groups) {
  const { nodes } = state.data;
  let maxExp = 0, maxImp = 0;
  for (const g of groups) {
    const n = nodes[g.index];
    if (!n) continue;
    if (n.side === 'exporter') maxExp = Math.max(maxExp, g.value);
    else maxImp = Math.max(maxImp, g.value);
  }
  const out = new Array(nodes.length).fill(css('--cat-other'));
  for (const g of groups) {
    const n = nodes[g.index];
    if (!n) continue;
    if (n.idx < 0) { out[g.index] = css('--cat-other'); continue; }
    const base = n.side === 'exporter' ? css('--origin') : css('--market');
    const max = n.side === 'exporter' ? maxExp : maxImp;
    out[g.index] = window.valueTint(base, max > 0 ? g.value / max : 0);
  }
  return out;
}

// ---------------------------------------------------------------- data

async function load() {
  const p = new URLSearchParams({
    items: state.item, metric: state.metric,
    yearFrom: state.year, yearTo: state.year + state.span - 1,
    topExp: state.topN, topImp: state.topN,
    rule: state.rule, other: state.other ? '1' : '0', bipartite: '1',
    expZone: state.expZone, impZone: state.impZone,
  });
  state.data = await window.fetchJSON('/api/chord?' + p, 'nodes');
  refreshTimeline();
  document.getElementById('loading').style.display = 'none';
  chooseScale();
  render();
}

/** Picks a strand size that lands near the target density, unless one is pinned. */
function chooseScale() {
  const shown = state.data.totals.shown || 1;
  if (state.scale !== 'auto') { state.unitPerStrand = +state.scale; return; }
  const opts = scales();
  state.unitPerStrand = opts.find((u) => shown / u <= TARGET_STRANDS) ?? opts[opts.length - 1];
}

// ---------------------------------------------------------------- render

/** Everything that is not the shipped default, as removable chips, and in the URL. */
function syncFilters() {
  window.writeUrlState(state, DEFAULTS);
  const label = (id, v) => {
    const el = document.getElementById(id);
    const opt = el && [...el.options].find((o) => o.value === String(v));
    return opt ? opt.textContent : String(v);
  };
  const set = (patch) => { Object.assign(state, patch); state.focus = null; syncControls(); load().catch(() => {}); };

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
  if (state.topN !== DEFAULTS.topN) items.push({ label: 'Countries', value: String(state.topN), clear: () => set({ topN: DEFAULTS.topN }) });
  if (state.other !== DEFAULTS.other) items.push({ label: 'Rest of world', value: 'hidden', clear: () => set({ other: DEFAULTS.other }) });

  window.renderChips(document.getElementById('chips'), items, () => {
    Object.assign(state, DEFAULTS); state.focus = null; syncControls();
    state.timeRange.set(state.year, state.year + state.span - 1);
  });
}

/** Push state back into the controls, for when a chip changed it rather than the control. */
function syncControls() {
  for (const id of ['item', 'rule', 'expZone', 'impZone', 'scale']) {
    const el = document.getElementById(id); if (el) el.value = String(state[id]);
  }
  const tn = document.getElementById('topN');
  if (tn) { tn.value = state.topN; document.getElementById('topNVal').textContent = state.topN; }
  const oth = document.getElementById('showOther'); if (oth) oth.checked = state.other;
  const m = document.getElementById('metric');
  if (m) [...m.children].forEach((c) => c.setAttribute('aria-pressed', c.dataset.v === state.metric));
}

function render() {
  syncFilters();
  const { nodes, matrix } = state.data;
  svg.selectAll('*').remove();

  // chordDirected, not chord: plain d3.chord() sizes a group by its outgoing row
  // alone, which collapses every importer to zero width here because importers only
  // ever receive. chordDirected counts both directions, so each half of the circle
  // sums to the same total. Leaving the sort out preserves the exporters-then-
  // importers index order, which is what puts the two groups on opposite halves.
  const chord = d3.chordDirected().padAngle(0.018);
  const chords = chord(matrix);
  const arc = d3.arc().innerRadius(R_IN).outerRadius(R_OUT);

  const defs = svg.append('defs');
  const g = svg.append('g').attr('transform', `translate(${SIZE / 2},${SIZE / 2})`);
  const colours = buildColours(chords.groups);
  state.colours = colours;
  const pt = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];

  // --- strands ---
  let drawn = 0;
  const bundles = g.append('g').attr('class', 'bundles')
    .selectAll('g').data(chords).join('g')
      .attr('class', 'bundle');

  bundles.each(function (d, bi) {
    const value = d.source.value;
    if (value <= 0) return;
    const n = Math.max(1, Math.round(value / state.unitPerStrand));
    const sel = d3.select(this);
    // Each strand runs from its seller to its buyer, so it should carry both
    // colours rather than only the seller's.
    const am = (d.source.startAngle + d.source.endAngle) / 2;
    const bm = (d.target.startAngle + d.target.endAngle) / 2;
    const [gx1, gy1] = pt(R_STRAND, am), [gx2, gy2] = pt(R_STRAND, bm);
    const colour = window.flowGradient(defs, `sg${bi}`, gx1, gy1, gx2, gy2,
      colours[d.source.index], colours[d.target.index]);
    let path = '';
    for (let i = 0; i < n && drawn < MAX_STRANDS; i++, drawn++) {
      const u = (i + 0.5) / n;
      const a = d.source.startAngle + (d.source.endAngle - d.source.startAngle) * u;
      // Reversed on the far side so the bundle fans rather than crossing itself.
      const b = d.target.endAngle - (d.target.endAngle - d.target.startAngle) * u;
      const [x1, y1] = pt(R_STRAND, a), [x2, y2] = pt(R_STRAND, b);
      path += `M${x1.toFixed(1)},${y1.toFixed(1)}Q0,0 ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    sel.append('path')
      .attr('class', 'strands')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', colour)
      .attr('stroke-width', 0.85)
      .attr('stroke-opacity', 0.5);
  });

  // Invisible fat ribbon per bundle: the strands are far too thin to hover.
  const ribbon = d3.ribbon().radius(R_IN - 1);
  bundles.append('path')
    .attr('class', 'bundle-hit')
    .attr('d', ribbon)
    .attr('fill', 'transparent')
    .on('mousemove', (e, d) => {
      const n = Math.max(1, Math.round(d.source.value / state.unitPerStrand));
      showTip(e, `${short(nodes[d.source.index].name)} → ${short(nodes[d.target.index].name)}`,
        [[fmt(d.source.value), 'shipped'], [`${n} strand${n === 1 ? '' : 's'}`, 'drawn']]);
    })
    .on('mouseleave', hideTip);

  // --- arcs ---
  const groups = g.append('g').selectAll('g').data(chords.groups).join('g');

  groups.append('path')
    .attr('class', 'arc')
    .attr('d', arc)
    .attr('fill', (d) => colours[d.index])
    .attr('stroke', css('--surface-1'))
    .attr('stroke-width', 1.2);

  // The band is ~8px on screen; this is the real target, reaching past the labels
  // so clicking a country's name works too.
  const hitArc = d3.arc().innerRadius(R_IN - 5).outerRadius(R_OUT + 30);
  groups.append('path')
    .attr('class', 'arc-hit')
    .attr('d', hitArc)
    .attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('mousemove', (e, d) => {
      const n = nodes[d.index];
      showTip(e, `${short(n.name)}${n.idx >= 0 ? ` · ${n.side === 'exporter' ? 'selling' : 'buying'}` : ''}`,
        [[fmt(d.value), n.side === 'exporter' ? 'shipped out' : 'brought in']]);
      if (state.focus === null) { state.hover = d.index; paint(); }
    })
    .on('mouseleave', () => { hideTip(); if (state.focus === null) { state.hover = null; paint(); } })
    .on('click', (e, d) => {
      state.focus = state.focus === d.index ? null : d.index;
      state.hover = null; paint(); updateFocusPanel();
    });

  // --- labels ---
  groups.append('text')
    .attr('class', 'arc-label')
    .each(function (d) { d.mid = (d.startAngle + d.endAngle) / 2; })
    .attr('dy', '0.32em')
    .attr('transform', (d) => `
      rotate(${(d.mid * 180 / Math.PI) - 90})
      translate(${R_OUT + 8})
      ${d.mid > Math.PI ? 'rotate(180)' : ''}`)
    .attr('text-anchor', (d) => d.mid > Math.PI ? 'end' : null)
    .text((d) => {
      if (d.endAngle - d.startAngle < 0.03) return '';
      return window.shortCountryName(nodes[d.index].name, 22);
    });

  // --- side captions ---
  const sideLabel = (text, x, anchor) => g.append('text')
    .attr('x', x).attr('y', -R_OUT - 58)
    .attr('text-anchor', anchor)
    .attr('class', 'side-caption')
    .text(text);
  // Index 0 begins at 12 o'clock and runs clockwise, so the exporter block lands on
  // the right half and the importer block on the left.
  sideLabel('BUYERS', -R_OUT + 40, 'start');
  sideLabel('SELLERS', R_OUT - 40, 'end');

  svg.node().__bundles = bundles;
  svg.node().__groups = groups;

  paint();
  updateScaleKey(drawn);
  updateStats();
  updateFocusPanel();
  updateTable();

  const item = state.meta.items.find((i) => i.code === state.item);
  const yr = state.span > 1 ? `${state.year}–${state.year + state.span - 1}` : state.year;
  document.getElementById('title').textContent = `${item ? item.name : 'Coffee'}, ${yr}`;
}

/** Emphasis only, never rebuilds the DOM, so hovering stays cheap. */
function paint() {
  const active = state.focus ?? state.hover;
  const bundles = svg.node().__bundles, groups = svg.node().__groups;
  if (!bundles) return;

  bundles.selectAll('path.strands')
    .attr('stroke-opacity', (d) =>
      active === null ? 0.5
      : (d.source.index === active || d.target.index === active) ? 0.8 : 0.05);

  groups.selectAll('path.arc')
    .attr('opacity', (d) => active === null || d.index === active ? 1 : 0.3);

  groups.selectAll('text.arc-label')
    .classed('on', (d) => d.index === active)
    .attr('opacity', (d) => active === null || d.index === active ? 1 : 0.35);
}

// ---------------------------------------------------------------- panels

function updateScaleKey(drawn) {
  document.getElementById('scaleKey').textContent = `1 strand = ${fmt(state.unitPerStrand)}`;
  const sw = d3.select('#scaleSwatch');
  sw.selectAll('*').remove();
  for (let i = 0; i < 10; i++) {
    sw.append('line')
      .attr('x1', 4 + i * 6).attr('x2', 4 + i * 6).attr('y1', 4).attr('y2', 22)
      .attr('stroke', css('--text-secondary')).attr('stroke-width', 0.85).attr('stroke-opacity', 0.7);
  }
  sw.append('text').attr('x', 70).attr('y', 17)
    .attr('fill', css('--text-muted')).style('font-size', '11px')
    .text(`= ${fmt(state.unitPerStrand * 10)}`);

  const capped = drawn >= MAX_STRANDS;
  document.getElementById('scaleNote').textContent = capped
    ? `${drawn.toLocaleString()} strands drawn (capped), choose a coarser scale to see every flow.`
    : `${drawn.toLocaleString()} strands drawn. Flows smaller than half a strand are rounded up to one, so the smallest links stay visible.`;
}

function updateStats() {
  const { totals } = state.data;
  const pctShown = totals.world > 0 ? (totals.shown / totals.world) * 100 : 0;
  document.getElementById('stats').innerHTML = [
    ['World total', fmt(totals.world)],
    ['Shown here', `${fmt(totals.shown)} (${pctShown.toFixed(0)}%)`],
    ['Country pairs', totals.flows.toLocaleString()],
    ['Sellers', totals.exportersTotal],
    ['Buyers', totals.importersTotal],
  ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  document.getElementById('quality').textContent =
    state.rule === 'importer'
      ? 'Where both countries reported a shipment, the importer\'s figure is used, customs assess duty on imports, so those records get more scrutiny. The two sides agree within about 1% overall, but diverge sharply on the smallest shipments.'
      : state.rule === 'exporter'
      ? 'Using exporter-declared figures. These are FOB, so freight and insurance are excluded from values.'
      : 'Combining both reported sides. Import values are CIF and export values FOB, so value comparisons carry a freight gap; quantities do not.';
}

function updateFocusPanel() {
  const { nodes, matrix } = state.data;
  const i = state.focus;
  const nameEl = document.getElementById('focusName');
  const hintEl = document.getElementById('focusHint');
  const listEl = document.getElementById('focusList');

  if (i === null) {
    nameEl.textContent = 'No country selected';
    hintEl.textContent = 'Click any arc to focus it.';
    listEl.innerHTML = '';
    return;
  }
  const n = nodes[i];
  nameEl.innerHTML = `<span class="swatch" style="background:${(state.colours || [])[i] || css('--cat-other')}"></span>${short(n.name)}`;
  hintEl.textContent = n.idx < 0
    ? 'Everything outside the top countries on this side.'
    : `${n.continent} · ${n.side === 'exporter' ? 'selling side' : 'buying side'} · click again to release`;

  const rows = n.side === 'exporter'
    ? matrix[i].map((v, j) => ({ v, j, dir: '→' })).filter((d) => d.v > 0)
    : matrix.map((row, j) => ({ v: row[i], j, dir: '←' })).filter((d) => d.v > 0);
  rows.sort((a, b) => b.v - a.v);

  listEl.innerHTML = rows.slice(0, 14).map((d) => {
    const strands = Math.max(1, Math.round(d.v / state.unitPerStrand));
    return `<div class="partner">
       <span class="p-n">${d.dir} ${short(nodes[d.j].name)}</span>
       <span class="p-v">${fmt(d.v)} · ${strands}×</span>
     </div>`;
  }).join('') || '<div class="note">No flows in this view.</div>';
}

function updateTable() {
  const { nodes, matrix } = state.data;
  const rows = [];
  for (let i = 0; i < matrix.length; i++)
    for (let j = 0; j < matrix.length; j++)
      if (matrix[i][j] > 0) rows.push([short(nodes[i].name), short(nodes[j].name), matrix[i][j]]);
  rows.sort((a, b) => b[2] - a[2]);

  document.getElementById('flowTable').innerHTML =
    `<thead><tr><th>Seller</th><th>Buyer</th><th style="text-align:right">${state.metric === 'value' ? 'Value' : 'Quantity'}</th><th style="text-align:right">Strands</th></tr></thead>
     <tbody>${rows.slice(0, 250).map(([a, b, v]) =>
       `<tr><td>${a}</td><td>${b}</td><td class="num">${fmt(v)}</td><td class="num">${Math.max(1, Math.round(v / state.unitPerStrand))}</td></tr>`).join('')}</tbody>`;
}

// ---------------------------------------------------------------- tooltip

function showTip(e, name, rows) {
  tip.innerHTML = `<div class="t-name">${name}</div>` +
    rows.map(([v, k]) => `<div class="t-row"><span class="t-num">${v}</span> ${k}</div>`).join('');
  tip.classList.add('on');
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
}
const hideTip = () => tip.classList.remove('on');

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
  const keep = state.scale;
  sel.innerHTML = '<option value="auto">Auto</option>' +
    scales().map((u) => `<option value="${u}">1 strand = ${fmt(u)}</option>`).join('');
  sel.value = scales().includes(+keep) ? String(keep) : 'auto';
  state.scale = sel.value;
}

function wire() {
  const $ = (id) => document.getElementById(id);
  const reload = () => load().catch((err) => {
    $('loading').style.display = 'block';
    $('loading').textContent = 'Failed to load: ' + err.message;
  });
  const debounce = (fn, ms = 150) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const reloadSoon = debounce(reload);

  $('item').onchange = (e) => { state.item = +e.target.value; state.focus = null; reload(); };
  $('rule').onchange = (e) => { state.rule = e.target.value; reload(); };
  $('expZone').onchange = (e) => { state.expZone = e.target.value; state.focus = null; reload(); };
  $('impZone').onchange = (e) => { state.impZone = e.target.value; state.focus = null; reload(); };
  $('showOther').onchange = (e) => { state.other = e.target.checked; state.focus = null; reload(); };
  $('showTable').onchange = (e) => $('tableView').classList.toggle('on', e.target.checked);
  $('scale').onchange = (e) => { state.scale = e.target.value; chooseScale(); render(); };

  $('metric').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.setAttribute('aria-pressed', c === b));
    state.metric = b.dataset.v; state.scale = 'auto';
    populateScaleOptions(); reload();
  };

  $('topN').oninput = (e) => {
    state.topN = +e.target.value; $('topNVal').textContent = state.topN;
    state.focus = null; reloadSoon();
  };

  // Hand the current view to the poster exporter rather than making people
  // reproduce eight settings by hand.
  $('toPoster').onclick = () => {
    const p = new URLSearchParams({
      item: state.item, metric: state.metric, year: state.year, span: state.span,
      topN: Math.min(state.topN, 24), rule: state.rule,
      expZone: state.expZone, impZone: state.impZone,
      other: state.other ? '1' : '0',
    });
    if (state.scale !== 'auto') p.set('scale', state.scale);
    location.href = '/poster?' + p;
  };

  svg.on('click', (e) => {
    if (e.target.tagName === 'svg') { state.focus = null; paint(); updateFocusPanel(); }
  });
}

/** Keeps the window inside the record. The range control renders its own readout. */
function syncYearLabels() {
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
  populateScaleOptions();
  // After the selects exist, push the restored state into them. populateZones resets both
  // zone selects to "all", so without this a shared link filtered the data correctly while
  // the controls claimed the opposite.
  syncControls();
  syncYearLabels();
  wire();
  await load();
})().catch((err) => {
  document.getElementById('loading').textContent = 'Could not start: ' + err.message;
});


// Colours come from the tokens, so a theme flip means a redraw.
addEventListener('themechange', () => { if (state.data) render(); });
