/* Breakdown: one dial per buying country, split by where its coffee came from.
 *
 * Two things are worth knowing about the encoding.
 *
 * Colour here is ORDINAL, not categorical. Forty-odd origins can supply one region and
 * no palette carries forty distinguishable hues, so origins are ranked by total volume
 * across the whole selection and drawn from a warm ramp in that order. Rank is assigned
 * globally rather than per dial, so a given origin keeps its colour in every dial on the
 * page; past the named cut the tail collapses into one neutral wedge rather than being
 * given colours that cannot be told apart.
 *
 * The two trend panels are deliberately two panels. Tonnes and dollars on one pair of
 * axes would be a dual-axis chart, where the crossing point is an artefact of the
 * scales chosen rather than anything in the data.
 */

const tip = document.getElementById('tip');
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const short = (n) => window.shortCountryName(n, 0);

/** The shipped view. The URL carries only what differs from this, and so do the chips. */
const DEFAULTS = {
  item: 656, year: 2019, span: 5, rule: 'importer',
  expZone: 'africa', impZone: 'europe', topSources: 12,
};

const state = {
  ...DEFAULTS, equalSize: true,
  data: null, meta: null,
};

// ---------------------------------------------------------------- formatting

const fmtT = (v) =>
  v >= 1e6 ? (v / 1e6).toFixed(2) + 'M t' :
  v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k t' : v.toFixed(0) + ' t';
const fmtV = (v) =>                       // thousands of USD in
  v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'bn' :
  v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'm' : '$' + v.toFixed(0) + 'k';
const yearLabel = () => state.span > 1 ? `${state.year}–${state.year + state.span - 1}` : String(state.year);

/** Warm ordinal ramp: yellow through orange to brown, ordered by volume rank. */
function slotColour(slot, total) {
  if (slot < 0) return css('--cat-other');
  const t = total <= 1 ? 0.55 : 0.34 + (slot / (total - 1)) * 0.60;
  return d3.interpolateYlOrBr(t);
}

// ---------------------------------------------------------------- data

async function load() {
  document.getElementById('loading').style.display = 'block';
  const p = new URLSearchParams({
    items: state.item, yearFrom: state.year, yearTo: state.year + state.span - 1,
    rule: state.rule, expZone: state.expZone, impZone: state.impZone,
    topSources: state.topSources, maxImporters: 36,
  });
  state.data = await window.fetchJSON('/api/breakdown?' + p, 'importers');
  refreshTimeline();
  document.getElementById('loading').style.display = 'none';
  render();
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
  const set = (patch) => { Object.assign(state, patch); syncControls(); load().catch(() => {}); };

  const items = [];
  if (state.item !== DEFAULTS.item) items.push({ label: 'Product', value: label('item', state.item), clear: () => set({ item: DEFAULTS.item }) });
  if (state.expZone !== DEFAULTS.expZone) items.push({ label: 'Sellers', value: label('expZone', state.expZone), clear: () => set({ expZone: DEFAULTS.expZone }) });
  if (state.impZone !== DEFAULTS.impZone) items.push({ label: 'Buyers', value: label('impZone', state.impZone), clear: () => set({ impZone: DEFAULTS.impZone }) });
  if (state.rule !== DEFAULTS.rule) items.push({ label: 'Reported by', value: label('rule', state.rule), clear: () => set({ rule: DEFAULTS.rule }) });
  if (state.year !== DEFAULTS.year || state.span !== DEFAULTS.span) {
    items.push({ label: 'Years', value: yearLabel(), clear: () => {
      state.year = DEFAULTS.year; state.span = DEFAULTS.span;
      state.timeRange.set(state.year, state.year + state.span - 1);
    } });
  }
  if (state.topSources !== DEFAULTS.topSources) items.push({ label: 'Named origins', value: String(state.topSources), clear: () => set({ topSources: DEFAULTS.topSources }) });

  window.renderChips(document.getElementById('chips'), items, () => {
    Object.assign(state, DEFAULTS);
    syncControls();
    state.timeRange.set(state.year, state.year + state.span - 1);
  });
}

/** Push state back into the controls, for when a chip changed it rather than the control. */
function syncControls() {
  for (const id of ['item', 'rule', 'expZone', 'impZone']) {
    const el = document.getElementById(id); if (el) el.value = String(state[id]);
  }
  const ts = document.getElementById('topSources');
  if (ts) { ts.value = state.topSources; document.getElementById('topSourcesVal').textContent = state.topSources; }
}

function render() {
  const d = state.data;
  const q = d.query || {};
  syncFilters();
  const item = state.meta.items.find((i) => i.code === state.item);
  const nice = window.prettyItem(item ? item.name : 'Coffee');

  document.getElementById('title').innerHTML =
    `${q.expTitle ?? 'World'} ${nice} exports to ${q.impTitle ?? 'the world'} ` +
    `<span class="yr">${yearLabel()}</span>`;
  document.getElementById('ruleNote').textContent =
    state.rule === 'importer' ? 'figures as reported by the importing country'
    : state.rule === 'exporter' ? 'figures as declared by the exporting country'
    : 'importer and exporter figures combined';

  document.getElementById('totQty').textContent = fmtT(d.totals.qty);
  document.getElementById('totVal').textContent = fmtV(d.totals.val);
  drawTrend('#qtyChart', d.series, 'qty', css('--origin'));
  drawTrend('#valChart', d.series, 'val', css('--market'));

  // A combination with nothing in it used to render as an ordinary page: headline panels
  // reading zero, an empty grid, and no clue which filter was responsible.
  const empty = document.getElementById('emptyState');
  const none = !d.importers.length;
  empty.hidden = !none;
  document.getElementById('grid').hidden = none;
  if (none) {
    const culprits = [];
    if (state.expZone !== 'all') culprits.push(`sellers in ${q.expTitle}`);
    if (state.impZone !== 'all') culprits.push(`buyers in ${q.impTitle}`);
    empty.innerHTML = `<p class="empty-t">No ${nice} moved from ${q.expTitle ?? 'anywhere'} to ${q.impTitle ?? 'anywhere'} in ${yearLabel()}.</p>`
      + `<p class="empty-s">${culprits.length ? 'Try widening ' + culprits.join(' or ') + ', or a longer range.' : 'Try a longer range or a different product.'}</p>`;
    drawLegend(d); updateTable(d);
    return;
  }

  drawFinding(d, nice);
  drawGrid(d);
  drawLegend(d);
  drawHowTo(d);
  updateTable(d);
  // The grid is rebuilt on every query, so the observer has to be re-attached.
  if (window.revealIn) window.revealIn();
}

/** One measure, one panel, one y scale. */
function drawTrend(sel, series, key, colour) {
  const svg = d3.select(sel);
  svg.selectAll('*').remove();
  if (!series.length) return;

  const box = svg.node().getBoundingClientRect();
  const w = Math.max(120, box.width), h = 62;
  const m = { t: 6, r: 4, b: 13, l: 4 };
  svg.attr('viewBox', `0 0 ${w} ${h}`);

  const x = d3.scalePoint().domain(series.map((s) => s.year)).range([m.l, w - m.r]);
  const y = d3.scaleLinear().domain([0, d3.max(series, (s) => s[key]) || 1]).nice()
    .range([h - m.b, m.t]);

  const area = d3.area().x((s) => x(s.year)).y0(y(0)).y1((s) => y(s[key])).curve(d3.curveMonotoneX);
  const line = d3.line().x((s) => x(s.year)).y((s) => y(s[key])).curve(d3.curveMonotoneX);

  svg.append('path').attr('d', area(series)).attr('fill', colour).attr('fill-opacity', 0.16);
  svg.append('path').attr('d', line(series)).attr('fill', 'none')
    .attr('stroke', colour).attr('stroke-width', 2);

  // Label only the ends: a tick under every year is noise at this size.
  const ends = series.length > 1 ? [series[0], series[series.length - 1]] : series;
  svg.selectAll('text.ax').data(ends).join('text')
    .attr('class', 'ax')
    .attr('x', (s, i) => i === 0 ? m.l : w - m.r)
    .attr('y', h - 3)
    .attr('text-anchor', (s, i) => i === 0 ? 'start' : 'end')
    .text((s) => s.year);

  svg.selectAll('circle').data(series).join('circle')
    .attr('cx', (s) => x(s.year)).attr('cy', (s) => y(s[key])).attr('r', 5)
    .attr('fill', 'transparent')
    .on('mousemove', (e, s) => showTip(e, String(s.year),
      [[key === 'qty' ? fmtT(s.qty) : fmtV(s.val), key === 'qty' ? 'imported' : 'value']]))
    .on('mouseleave', hideTip);
}

function drawGrid(d) {
  const host = d3.select('#grid');
  host.selectAll('*').remove();
  const nSlots = d.legend.length;
  const maxQty = d3.max(d.importers, (i) => i.qty) || 1;
  // Area, not radius, carries the volume -- radius would exaggerate the big buyers.
  const r = d3.scaleSqrt().domain([0, maxQty]).range([16, 52]);

  const cards = host.selectAll('div.dialcard').data(d.importers).join('div')
    .attr('class', 'dialcard').attr('data-reveal', '');

  cards.each(function (imp) {
    const card = d3.select(this);
    const W = 196, H = 116;
    const R = state.equalSize ? 40 : Math.min(40, r(imp.qty));
    const cell = window.dialCell({ imp, W, H, R, maxRibbons: 9, labelSize: 12 });

    // Named, not decorative: each dial is the only place a buyer's figure appears on this
    // page unless the table is open, so a reader who cannot see it still needs the number.
    const top = imp.sources.slice(0, 3).map((x) => short(x.name)).join(', ');
    const svg = card.append('svg').attr('class', 'dial')
      .attr('role', 'img')
      .attr('aria-label', `${short(imp.name)} imported ${fmtT(imp.qty)}${top ? ', mostly from ' + top : ''}`)
      .attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);

    // Everything visible comes out of the one painter. This page's only job is the
    // palette and the hover, so it cannot drift from the poster or the study page.
    const ribbons = window.paintDialCell(svg.node(), cell, {
      ink: css('--ink'), dim: css('--ink-2'), trend: css('--ink-3'),
      stroke: css('--surface'), strokeWidth: 0.5,
      totalText: fmtT(imp.qty),
      fill: (b) => slotColour(b.source.slot, nSlots),
    });

    for (const { node, band } of ribbons) {
      d3.select(node)
        .on('mousemove', (e) => showTip(e, `${short(imp.name)} ← ${short(band.source.name)}`, [
          [fmtT(band.source.value), 'imported'],
          [(band.share * 100).toFixed(1) + '%', 'of its intake'],
        ]))
        .on('mouseleave', hideTip);
    }
  });
}

/**
 * The finding, in one sentence, above the evidence.
 *
 * Every page here was a builder: controls, then a chart, and nothing telling you what you
 * were looking at. OEC hit the same wall and rebuilt around leading with the reading, with
 * the builder demoted behind it. This is that, computed from whatever is on screen, so it
 * stays true as the filters change rather than being a caption someone wrote once.
 */
function drawFinding(d, nice) {
  const host = document.getElementById('finding');
  if (!host) return;
  if (!d.importers.length || !d.legend.length) { host.hidden = true; return; }
  host.hidden = false;

  const total = d.totals.qty || 1;
  const buyer = d.importers[0];
  const origin = d.legend[0];
  const top3 = d.legend.slice(0, 3).reduce((a, b) => a + b.total, 0);
  const pc = (v) => Math.round((v / total) * 100) + '%';

  host.innerHTML =
    `<b>${short(buyer.name)}</b> took the most, ${fmtT(buyer.qty)}. `
    + `<b>${short(origin.name)}</b> grew ${pc(origin.total)} of the ${nice} in this view`
    + (d.legend.length >= 3 ? `, and the three largest origins ${pc(top3)} between them.` : '.');
}

/** Tabular fallback: each buyer, its total, and where the coffee came from. */
function updateTable(d) {
  document.getElementById('buyerTable').innerHTML =
    `<thead><tr><th>Buyer</th><th style="text-align:right">Quantity</th><th style="text-align:right">Value</th><th>Largest origins</th></tr></thead>
     <tbody>${d.importers.map((imp) => {
       const top = imp.sources.slice(0, 4)
         .map((s) => `${short(s.name)} ${((s.value / imp.qty) * 100).toFixed(0)}%`).join(', ');
       return `<tr><td>${short(imp.name)}</td><td class="num">${fmtT(imp.qty)}</td><td class="num">${fmtV(imp.val)}</td><td>${top}</td></tr>`;
     }).join('')}</tbody>`;
}

function drawLegend(d) {
  const host = d3.select('#legend');
  host.selectAll('*').remove();
  const rows = d.legend.map((l) => ({ name: short(l.name), colour: slotColour(l.slot, d.legend.length), v: l.total }));
  if (d.otherSellers > 0) {
    const namedTotal = d.legend.reduce((a, b) => a + b.total, 0);
    rows.push({ name: `Other origins (${d.otherSellers})`, colour: css('--cat-other'), v: Math.max(0, d.totals.qty - namedTotal) });
  }
  host.selectAll('div.lg').data(rows).join('div').attr('class', 'lg')
    .html((row) => `<i style="background:${row.colour}"></i>${row.name}<span class="v">${fmtT(row.v)}</span>`);
}

/** Miniature of a single dial, so the legend explains the form itself. */
function drawHowTo(d) {
  const svg = d3.select('#howtoArt');
  svg.selectAll('*').remove();
  const g = svg.append('g').attr('transform', 'translate(43,43)');
  const demo = [0.46, 0.24, 0.14, 0.09, 0.07].map((v, i) => ({ value: v, slot: i, name: '' }));
  const mini = window.funnelDial({ sources: demo, total: 1, R: 34, maxRibbons: 6 });
  g.selectAll('path').data(mini.bands).join('path')
    .attr('d', (b) => b.d)
    .attr('fill', (b) => slotColour(b.source.slot, 5))
    .attr('stroke', css('--surface')).attr('stroke-width', 0.5);
  g.append('line').attr('x1', mini.line.x).attr('x2', mini.line.x)
    .attr('y1', mini.line.yTop).attr('y2', mini.line.yTop + mini.line.height)
    .attr('stroke', css('--ink')).attr('stroke-width', 0.8).attr('opacity', 0.4);
  document.getElementById('howtoTitle').textContent =
    `How to read this, ${d.importers.length} buyers, ${d.totals.sellers} origins`;
  // The description has to track the toggle, or it describes a chart that is not
  // on screen.
  document.getElementById('howtoBody').textContent =
    'Each dial is one buying country. The short vertical line on its left is that '
    + 'country’s whole intake, divided by origin, and every origin funnels out from '
    + 'its slot on the line to a matching slice of the rim. A supplier with a tenth of '
    + 'the intake takes a tenth of the line and a tenth of the rim, so it leaves the '
    + 'line thin and opens out wide. Small origins gather as fine ribbons at the top, '
    + 'the dominant one is the broad sweep below. '
    + (state.equalSize
      ? 'All dials are drawn the same size so the shapes can be compared directly, with the tonnage printed beside each name.'
      : 'Dial size is the volume that country brought in.')
    + ' The small line to the left traces that intake across the years shown, with a dot on '
    + 'the most recent one. It is scaled to that country’s own range rather than a shared '
    + 'one, so it reads as a direction of travel and not as a size. Origins past the largest '
    + `${d.legend.length} are pooled into one neutral ribbon.`;
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
  document.getElementById('expZone').innerHTML = html;
  document.getElementById('impZone').innerHTML = html;
  document.getElementById('expZone').value = state.expZone;
  document.getElementById('impZone').value = state.impZone;
}

function wire() {
  const $ = (id) => document.getElementById(id);
  const reload = () => load().catch((e) => {
    $('loading').style.display = 'block';
    $('loading').textContent = 'Failed to load: ' + e.message;
  });
  const debounce = (fn, ms = 220) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const reloadSoon = debounce(reload);

  $('item').onchange = (e) => { state.item = +e.target.value; reload(); };
  $('rule').onchange = (e) => { state.rule = e.target.value; reload(); };
  $('expZone').onchange = (e) => { state.expZone = e.target.value; reload(); };
  $('impZone').onchange = (e) => { state.impZone = e.target.value; reload(); };
  $('topSources').oninput = (e) => {
    state.topSources = +e.target.value; $('topSourcesVal').textContent = state.topSources; reloadSoon();
  };
  $('sizeByVolume').onchange = (e) => { state.equalSize = !e.target.checked; render(); };
  $('showTable').onchange = (e) => document.getElementById('tableView').classList.toggle('on', e.target.checked);
  $('toPoster').onclick = () => {
    const p = new URLSearchParams({
      design: 'breakdown', item: state.item,
      year: state.year, span: state.span, rule: state.rule,
      expZone: state.expZone, impZone: state.impZone,
      // The poster reads this as topSources for the breakdown design.
      topN: Math.min(state.topSources, 24),
    });
    location.href = '/poster?' + p;
  };

  addEventListener('resize', debounce(() => { if (state.data) render(); }, 250));
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
  const years = state.meta.years, last = years[years.length - 1];

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
  syncYear();
  wire();
  await load();
})().catch((err) => {
  document.getElementById('loading').textContent = 'Could not start: ' + err.message;
});


// Colours come from the tokens, so a theme flip means a redraw.
addEventListener('themechange', () => { if (state.data) render(); });
