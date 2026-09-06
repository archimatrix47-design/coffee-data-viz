/* Poster export, all three visualisations.
 *
 * The poster is built as a fully self-contained SVG: every fill, font, gradient and
 * stroke is written as an attribute or a real <defs> node. Rasterising goes through an
 * <img>, which loads the SVG in an isolated context where the page's CSS, and
 * therefore every CSS variable, does not exist. Anything left to a stylesheet would
 * silently render black.
 *
 * One frame, three renderers. `beginPoster()` draws the title block, reserves the
 * footer, and hands back the box the design gets to fill; each renderer fills that box
 * and returns the legend rows to print under it. Preview and export call the identical
 * builder at identical dimensions, so what is on screen is what lands in the file.
 */

const THEMES = {
  espresso: { bg: '#0F0F10', ink: '#ECECEE', dim: '#9A9A9E', rule: '#2A2A2D',
              origin: '#8fbf5e', market: '#E8A33D', neutral: '#6E6E72', land: '#1B1B1D' },
  latte:    { bg: '#F4F2ED', ink: '#242220', dim: '#63605A', rule: '#DCD8D0',
              origin: '#4a7c2f', market: '#B4671F', neutral: '#A09C94', land: '#E6E2DA' },
  ink:      { bg: '#000000', ink: '#ffffff', dim: '#8b8b86', rule: '#2a2a28',
              origin: '#35b0a7', market: '#e2566b', neutral: '#6f6f6a', land: '#161616' },
  paper:    { bg: '#f4f1e8', ink: '#14140f', dim: '#6e6c62', rule: '#d8d4c6',
              origin: '#2a78d6', market: '#e34948', neutral: '#9b9890', land: '#e6e2d6' },
  slate:    { bg: '#22262b', ink: '#f2f4f6', dim: '#93999f', rule: '#343a41',
              origin: '#4ea8de', market: '#ef6f6c', neutral: '#7b8288', land: '#2c3137' },
};

const FONTS = {
  mono: `ui-monospace, "DejaVu Sans Mono", "Courier New", monospace`,
  sans: `system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`,
  serif: `"Libre Baskerville", Georgia, Cambria, ui-serif, "Times New Roman", serif`,
};

const SCALES_QTY = [250, 500, 1e3, 2.5e3, 5e3, 1e4, 2.5e4, 5e4, 1e5];
const SCALES_VAL = [1e3, 5e3, 1e4, 2.5e4, 5e4, 1e5, 2.5e5, 5e5];
const TARGET_STRANDS = 1300;
const MAX_STRANDS = 9000;

const S = {
  w: 1080, h: 1350, theme: 'auto', typeface: 'mono', design: 'flows',
  item: 656, metric: 'qty', year: 2024, span: 1, topN: 12, scale: 'auto',
  expZone: 'all', impZone: 'all', rule: 'importer', other: true,
  title: '', subtitle: '', credit: 'Source: FAOSTAT detailed trade matrix',
  titleTouched: false, subtitleTouched: false,
  data: null, meta: null, world: null, centroids: null, unitPerStrand: 5000,
};

// ---------------------------------------------------------------- formatting

const fmtT = (v) =>
  v >= 1e6 ? (v / 1e6).toFixed(2) + 'M t' :
  v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k t' : v.toFixed(0) + ' t';
const fmtV = (v) =>
  v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'bn' :
  v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'm' : '$' + v.toFixed(0) + 'k';
const fmt = (v) => S.metric === 'value' ? fmtV(v) : fmtT(v);
const scales = () => S.metric === 'value' ? SCALES_VAL : SCALES_QTY;
const yearLabel = () => S.span > 1 ? `${S.year}–${S.year + S.span - 1}` : String(S.year);

/** "Follow app" means the poster matches whatever light/dark the site is showing. */
function themeKey() {
  if (S.theme !== 'auto') return S.theme;
  return (window.themeResolved && window.themeResolved() === 'light') ? 'latte' : 'espresso';
}

const MAX_LABEL_CHARS = 15;
const shortName = (name) => window.shortCountryName(name, MAX_LABEL_CHARS);

// ---------------------------------------------------------------- data

const ENDPOINT = {
  flows: () => '/api/chord?' + new URLSearchParams({
    items: S.item, metric: S.metric, yearFrom: S.year, yearTo: S.year + S.span - 1,
    topExp: S.topN, topImp: S.topN, rule: S.rule, bipartite: '1',
    other: S.other ? '1' : '0', expZone: S.expZone, impZone: S.impZone }),
  map: () => '/api/network?' + new URLSearchParams({
    items: S.item, metric: S.metric, yearFrom: S.year, yearTo: S.year + S.span - 1,
    rule: S.rule, expZone: S.expZone, impZone: S.impZone,
    minFlow: S.metric === 'value' ? 500 : 250, topEdges: 600 }),
  breakdown: () => '/api/breakdown?' + new URLSearchParams({
    items: S.item, yearFrom: S.year, yearTo: S.year + S.span - 1,
    rule: S.rule, expZone: S.expZone, impZone: S.impZone,
    topSources: Math.min(S.topN, 16), maxImporters: 30 }),
};

async function load() {
  S.data = await window.fetchJSON(ENDPOINT[S.design](), S.design === 'breakdown' ? 'importers' : 'nodes');

  if (S.design === 'map' && !S.world) {
    const topo = await (await fetch('/vendor/countries-110m.json')).json();
    S.world = topojson.feature(topo, topo.objects.countries);
    S.centroids = new Map();
    for (const f of S.world.features) {
      const id = +f.id; if (!Number.isFinite(id)) continue;
      const c = d3.geoCentroid(f);
      if (c && Number.isFinite(c[0])) S.centroids.set(id, c);
    }
  }
  chooseScale();
  syncAutoText();
  draw();
}

function shownTotal() {
  const d = S.data;
  if (!d) return 1;
  if (S.design === 'flows') return d.totals.shown || 1;
  if (S.design === 'breakdown') return d.totals.qty || 1;
  return d.totals.world || 1;
}

function chooseScale() {
  if (S.scale !== 'auto') { S.unitPerStrand = +S.scale; return; }
  const o = scales();
  S.unitPerStrand = o.find((u) => shownTotal() / u <= TARGET_STRANDS) ?? o[o.length - 1];
}

const prettyItem = (name) => window.prettyItem(name);   // shared with the pages, in names.js

function syncAutoText() {
  const item = S.meta.items.find((i) => i.code === S.item);
  const nice = prettyItem(item ? item.name : 'Coffee');
  const q = S.data.query || {};
  const expNamed = S.expZone !== 'all', impNamed = S.impZone !== 'all';
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  if (!S.titleTouched) {
    S.title = expNamed && impNamed ? `${cap(nice)} from ${q.expTitle} to ${q.impTitle}`
      : expNamed ? `Where ${q.expTitle}'s ${nice} goes`
      : impNamed ? `Who supplies ${q.impTitle} with ${nice}`
      : `Where the world's ${nice} goes`;
    document.getElementById('title').value = S.title;
  }
  if (!S.subtitleTouched) {
    const d = S.data;
    if (S.design === 'breakdown') {
      S.subtitle = `${yearLabel()} · ${fmtT(d.totals.qty)} and ${fmtV(d.totals.val)} across ${d.totals.importers} buyers`;
    } else if (S.design === 'map') {
      S.subtitle = `${yearLabel()} · ${fmt(d.totals.world)} on ${d.totals.edgesTotal.toLocaleString()} routes`;
    } else {
      const t = d.totals, covered = t.world > 0 ? t.shown / t.world : 1;
      S.subtitle = covered >= 0.995
        ? `${yearLabel()} · ${fmt(t.world)} traded across ${t.countriesInvolved} countries`
        : `${yearLabel()} · ${fmt(t.shown)} shown, ${(covered * 100).toFixed(0)}% of ${fmt(t.world)} traded worldwide`;
    }
    document.getElementById('subtitle').value = S.subtitle;
  }
}

// ---------------------------------------------------------------- svg helpers

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};
const text = (str, attrs) => { const t = el('text', attrs); t.textContent = str; return t; };

function wrap(str, perLine) {
  const words = String(str).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Title block + reserved footer. Returns the box the design fills. */
function beginPoster() {
  const { w, h } = S;
  const t = THEMES[themeKey()];
  const font = FONTS[S.typeface];
  const svg = el('svg', { xmlns: SVGNS, width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'font-family': font });
  svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: t.bg }));
  const defs = el('defs'); svg.appendChild(defs);

  const M = Math.round(w * 0.065);
  const wide = w / h > 1.2;

  const titleSize = Math.round(w * (wide ? 0.036 : 0.049));
  let y = M + titleSize;
  for (const line of wrap(S.title, wide ? 60 : 26)) {
    svg.appendChild(text(line, {
      x: M, y, fill: t.ink, 'font-size': titleSize, 'font-weight': 700,
      'letter-spacing': S.typeface === 'mono' ? '-0.02em' : '-0.025em',
    }));
    y += titleSize * 1.12;
  }
  const subSize = Math.round(w * 0.0155);
  y += subSize * 0.5;
  svg.appendChild(text(S.subtitle, { x: M, y, fill: t.dim, 'font-size': subSize }));

  const legendH = Math.round(h * (wide ? 0.15 : 0.125));
  const footY = h - M - legendH;
  return {
    svg, defs, t, font, M, wide, legSize: Math.round(w * 0.0145), footY,
    box: { x: M, y: y + subSize, w: w - M * 2, h: footY - (y + subSize) - M * 0.6 },
  };
}

function drawFooter(P, keyRows, totalsLine) {
  const { svg, defs, t, M, legSize, footY } = P;
  let ly = footY + legSize * 1.6;
  svg.appendChild(el('line', { x1: M, y1: footY, x2: S.w - M, y2: footY, stroke: t.rule, 'stroke-width': 1 }));
  const chW = legSize * (S.typeface === 'mono' ? 0.60 : 0.52);

  for (const row of keyRows) {
    if (!row || (row.items && !row.items.length)) continue;
    if (row.type === 'strands') {
      const gap = Math.max(3, legSize * 0.36);
      for (let i = 0; i < 10; i++) {
        svg.appendChild(el('line', {
          x1: M + i * gap, x2: M + i * gap, y1: ly - legSize * 0.75, y2: ly + legSize * 0.35,
          stroke: t.ink, 'stroke-width': Math.max(0.5, S.w / 1400), 'stroke-opacity': 0.75,
        }));
      }
      svg.appendChild(text(`= ${fmt(S.unitPerStrand * 10)}   (one strand = ${fmt(S.unitPerStrand)})`,
        { x: M + 10 * gap + legSize * 0.7, y: ly, fill: t.dim, 'font-size': legSize }));
    } else if (row.type === 'swatches') {
      let x = M;
      for (const s of row.items) {
        svg.appendChild(el('rect', { x, y: ly - legSize * 0.72, width: legSize * 0.8, height: legSize * 0.8, rx: 2, fill: s.colour }));
        svg.appendChild(text(s.label, { x: x + legSize * 1.25, y: ly, fill: t.dim, 'font-size': legSize }));
        x += legSize * 1.25 + s.label.length * chW + legSize * 1.5;
      }
    } else if (row.type === 'ramp') {
      const rw = S.w * 0.16, rh = legSize * 0.7, gid = 'legramp';
      const g = el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '0' });
      g.appendChild(el('stop', { offset: '0%', 'stop-color': row.from }));
      g.appendChild(el('stop', { offset: '100%', 'stop-color': row.to }));
      defs.appendChild(g);
      svg.appendChild(text(row.lo, { x: M, y: ly, fill: t.dim, 'font-size': legSize }));
      const x0 = M + row.lo.length * chW + legSize * 0.8;
      svg.appendChild(el('rect', { x: x0, y: ly - rh, width: rw, height: rh, rx: rh / 2, fill: `url(#${gid})` }));
      svg.appendChild(text(row.hi, { x: x0 + rw + legSize * 0.6, y: ly, fill: t.dim, 'font-size': legSize }));
    }
    ly += legSize * 1.9;
  }

  if (totalsLine) {
    for (const line of wrap(totalsLine, Math.floor((S.w - M * 2) / chW))) {
      svg.appendChild(text(line, { x: M, y: ly, fill: t.dim, 'font-size': legSize }));
      ly += legSize * 1.5;
    }
  }

  if (S.expZone !== 'all' || S.impZone !== 'all') {
    const q = S.data.query || {};
    svg.appendChild(text(`${q.expLabel ?? 'Everywhere'} → ${q.impLabel ?? 'Everywhere'}`,
      { x: M, y: S.h - M * 0.55, fill: t.dim, 'font-size': Math.round(legSize * 0.88) }));
  }
  svg.appendChild(text(S.credit, {
    x: S.w - M, y: S.h - M * 0.55, 'text-anchor': 'end', fill: t.dim, 'font-size': Math.round(legSize * 0.88),
  }));
}

// ---------------------------------------------------------------- design 1: flows

function drawFlows(P) {
  const { svg, defs, t, box } = P;
  const { nodes, matrix } = S.data;
  const cx = S.w / 2, cy = box.y + box.h / 2;

  // A rotated label at the bottom extends downward by its whole length, so the
  // radius depends on the label size which depends on the radius. Iterate.
  const half = Math.min(box.w, box.h) / 2;
  const CH_W = S.typeface === 'mono' ? 0.60 : 0.52;
  let outer = half;
  for (let i = 0; i < 5; i++) {
    const ls = Math.max(8, outer * 0.038);
    outer = Math.max(60, half - (ls * 0.7 + MAX_LABEL_CHARS * ls * CH_W + 8));
  }
  const labelClearance = half - outer;
  const R_OUT = outer, R_IN = outer * 0.962, R_STRAND = outer * 0.952;

  const chords = d3.chordDirected().padAngle(0.02)(matrix);
  const arc = d3.arc().innerRadius(R_IN).outerRadius(R_OUT);
  const g = el('g', { transform: `translate(${cx},${cy})` });
  svg.appendChild(g);

  let maxExp = 0, maxImp = 0;
  for (const gr of chords.groups) {
    const n = nodes[gr.index]; if (!n || n.idx < 0) continue;
    if (n.side === 'exporter') maxExp = Math.max(maxExp, gr.value); else maxImp = Math.max(maxImp, gr.value);
  }
  const gv = new Map(chords.groups.map((gr) => [gr.index, gr.value]));
  const colourOf = (i) => {
    const n = nodes[i];
    if (!n || n.idx < 0) return t.neutral;
    const seller = n.side === 'exporter';
    const max = seller ? maxExp : maxImp;
    return window.valueTint(seller ? t.origin : t.market, max > 0 ? (gv.get(i) || 0) / max : 0);
  };
  const pt = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];

  const strandsG = el('g', { 'stroke-width': Math.max(0.35, outer / 620).toFixed(2), fill: 'none' });
  let drawn = 0, gi = 0;
  for (const d of chords) {
    const v = d.source.value; if (v <= 0) continue;
    const n = Math.max(1, Math.round(v / S.unitPerStrand));
    let path = '';
    for (let i = 0; i < n && drawn < MAX_STRANDS; i++, drawn++) {
      const u = (i + 0.5) / n;
      const a = d.source.startAngle + (d.source.endAngle - d.source.startAngle) * u;
      const b = d.target.endAngle - (d.target.endAngle - d.target.startAngle) * u;
      const [x1, y1] = pt(R_STRAND, a), [x2, y2] = pt(R_STRAND, b);
      path += `M${x1.toFixed(1)},${y1.toFixed(1)}Q0,0 ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    const am = (d.source.startAngle + d.source.endAngle) / 2;
    const bm = (d.target.startAngle + d.target.endAngle) / 2;
    const [gx1, gy1] = pt(R_STRAND, am), [gx2, gy2] = pt(R_STRAND, bm);
    const gid = `pg${gi++}`;
    const grad = el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse',
      x1: gx1.toFixed(1), y1: gy1.toFixed(1), x2: gx2.toFixed(1), y2: gy2.toFixed(1) });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': colourOf(d.source.index) }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': colourOf(d.target.index) }));
    defs.appendChild(grad);
    strandsG.appendChild(el('path', { d: path, stroke: `url(#${gid})`, 'stroke-opacity': 0.45 }));
  }
  g.appendChild(strandsG);

  const labelSize = Math.round(Math.max(8, outer * 0.038));
  for (const d of chords.groups) {
    g.appendChild(el('path', { d: arc(d), fill: colourOf(d.index) }));
    const mid = (d.startAngle + d.endAngle) / 2;
    if (d.endAngle - d.startAngle < 0.028) continue;
    const flip = mid > Math.PI;
    g.appendChild(text(shortName(nodes[d.index].name), {
      transform: `rotate(${(mid * 180 / Math.PI) - 90}) translate(${R_OUT + labelSize * 0.7})${flip ? ' rotate(180)' : ''}`,
      'text-anchor': flip ? 'end' : 'start', dy: '0.32em', fill: t.ink, 'font-size': labelSize,
    }));
  }

  const capSize = Math.round(labelSize * 0.95), capY = -(R_OUT + labelClearance * 0.72);
  g.appendChild(text('SELLERS', { x: R_OUT * 0.55, y: capY, 'text-anchor': 'middle',
    fill: t.origin, 'font-size': capSize, 'font-weight': 700, 'letter-spacing': '0.18em' }));
  g.appendChild(text('BUYERS', { x: -R_OUT * 0.55, y: capY, 'text-anchor': 'middle',
    fill: t.market, 'font-size': capSize, 'font-weight': 700, 'letter-spacing': '0.18em' }));

  svg.__strandCount = drawn;
  const totals = S.data.totals;
  const routes = chords.filter((c) => c.source.value > 0).length;
  return {
    keyRows: [
      { type: 'strands' },
      { type: 'swatches', items: [
        { colour: t.origin, label: 'Exporting country' },
        { colour: t.market, label: 'Importing country' }] },
      { type: 'ramp', from: window.valueTint(t.origin, 0.04), to: window.valueTint(t.origin, 1),
        lo: 'smaller', hi: 'larger trader' },
    ],
    totals: `${fmt(totals.shown)} across ${routes.toLocaleString()} routes drawn · ${totals.exportersTotal} sellers and ${totals.importersTotal} buyers in the data`,
  };
}

// ---------------------------------------------------------------- design 2: map

const FALLBACK_POS = {
  228: [60, 60], 51: [15.5, 49.8], 248: [20.5, 44.2], 186: [20.8, 43.5], 15: [4.6, 50.6],
  62: [39.6, 9.1], 206: [30.2, 15.6], 96: [114.2, 22.3], 128: [113.5, 22.2], 214: [121, 23.7],
  200: [103.8, 1.35], 134: [14.4, 35.9], 140: [7.4, 43.7], 177: [-66.5, 18.2], 135: [-61, 14.6],
  87: [-61.5, 16.2], 182: [55.5, -21.1], 69: [-53, 4], 299: [35.2, 31.9], 31: [3.4, -54.4],
};
const posOf = (c) => FALLBACK_POS[c.code] || (S.centroids && c.m49 && S.centroids.get(c.m49)) || null;

function drawMap(P) {
  const { svg, defs, t, box } = P;
  const { nodes, edges } = S.data;

  const projection = d3.geoNaturalEarth1();
  const pts = nodes.map(posOf).filter(Boolean);
  const fitTo = pts.length > 2
    ? { type: 'MultiPoint', coordinates: pts }
    : { type: 'Sphere' };
  // Padding so the curved routes, which bow outside the point cloud, stay inside.
  const pad = Math.min(box.w, box.h) * 0.10;
  projection.fitExtent([[box.x + pad, box.y + pad],
                        [box.x + box.w - pad, box.y + box.h - pad]], fitTo);
  const path = d3.geoPath(projection);

  const g = el('g'); svg.appendChild(g);
  g.appendChild(el('path', { d: path({ type: 'Sphere' }), fill: 'none', stroke: t.rule, 'stroke-width': 0.8 }));
  g.appendChild(el('path', { d: path(d3.geoGraticule10()), fill: 'none', stroke: t.rule, 'stroke-width': 0.4, opacity: 0.55 }));
  for (const f of S.world.features) {
    const d = path(f);
    if (d) g.appendChild(el('path', { d, fill: t.land, stroke: t.bg, 'stroke-width': 0.4 }));
  }

  const maxExp = d3.max(nodes, (n) => n.exports) || 1;
  const maxImp = d3.max(nodes, (n) => n.imports) || 1;
  const nodeColour = (n) => {
    const seller = n.exports >= n.imports;
    return window.valueTint(seller ? t.origin : t.market, seller ? n.exports / maxExp : n.imports / maxImp);
  };

  const byIdx = new Map(nodes.map((n) => [n.idx, n]));
  const flows = el('g', { fill: 'none' });
  let drawn = 0, routes = 0, gi = 0;
  for (const e of [...edges].sort((a, b) => b.w - a.w)) {
    if (drawn >= MAX_STRANDS) break;
    const s = byIdx.get(e.s), tt = byIdx.get(e.t);
    if (!s || !tt) continue;
    const ps = posOf(s), pd = posOf(tt); if (!ps || !pd) continue;
    const a = projection(ps), b = projection(pd); if (!a || !b) continue;

    const n = Math.max(1, Math.round(e.w / S.unitPerStrand));
    let d = '';
    for (let i = 0; i < n && drawn < MAX_STRANDS; i++, drawn++) {
      const u = n === 1 ? 0 : (i / (n - 1)) - 0.5;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const off = len * 0.18 + u * Math.min(len * 0.22, 40);
      const cxp = mx - (dy / len) * off, cyp = my + (dx / len) * off;
      d += `M${a[0].toFixed(1)},${a[1].toFixed(1)}Q${cxp.toFixed(1)},${cyp.toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
    }
    const gid = `mg${gi++}`;
    const grad = el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse',
      x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1) });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': nodeColour(s) }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': nodeColour(tt) }));
    defs.appendChild(grad);
    flows.appendChild(el('path', { d, stroke: `url(#${gid})`,
      'stroke-width': Math.max(0.4, S.w / 1900), 'stroke-opacity': 0.45 }));
    routes++;
  }
  g.appendChild(flows);

  const maxThru = d3.max(nodes, (n) => n.throughput) || 1;
  const r = d3.scaleSqrt().domain([0, maxThru]).range([S.w / 900, S.w / 62]);
  const placed = nodes.map((n) => ({ n, p: posOf(n) })).filter((d) => d.p);
  for (const d of placed) {
    const [x, y] = projection(d.p);
    g.appendChild(el('circle', { cx: x, cy: y, r: r(d.n.throughput), fill: nodeColour(d.n),
      'fill-opacity': 0.92, stroke: t.bg, 'stroke-width': 0.7 }));
  }
  const labelSize = Math.round(S.w * 0.0125);
  const chWidth = labelSize * (S.typeface === 'mono' ? 0.60 : 0.52);
  const taken = [];
  const hits = (a) => taken.some((b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);

  for (const d of [...placed].sort((a, b) => b.n.throughput - a.n.throughput)) {
    if (taken.length >= 18) break;
    const label = shortName(d.n.name);
    const [x, y] = projection(d.p);
    const rad = r(d.n.throughput);
    // Try right of the dot, then left, then above; give up rather than overprint.
    const boxes = [
      { x: x + rad + 3, y: y - labelSize * 0.6, w: label.length * chWidth, h: labelSize * 1.2, anchor: 'start', tx: x + rad + 3 },
      { x: x - rad - 3 - label.length * chWidth, y: y - labelSize * 0.6, w: label.length * chWidth, h: labelSize * 1.2, anchor: 'end', tx: x - rad - 3 },
      { x: x - label.length * chWidth / 2, y: y - rad - labelSize * 1.6, w: label.length * chWidth, h: labelSize * 1.2, anchor: 'middle', tx: x },
    ];
    const spot = boxes.find((b) => !hits(b));
    if (!spot) continue;
    taken.push(spot);
    g.appendChild(text(label, {
      x: spot.tx, y: spot.y + labelSize * 0.95, 'text-anchor': spot.anchor,
      fill: t.ink, 'font-size': labelSize,
      stroke: t.bg, 'stroke-width': labelSize * 0.3, 'paint-order': 'stroke', 'stroke-linejoin': 'round',
    }));
  }

  svg.__strandCount = drawn;
  return {
    keyRows: [
      { type: 'strands' },
      { type: 'swatches', items: [
        { colour: t.origin, label: 'Grows and ships' },
        { colour: t.market, label: 'Buys' }] },
    ],
    totals: `${fmt(S.data.totals.world)} on ${routes.toLocaleString()} routes drawn of ${S.data.totals.edgesTotal.toLocaleString()} · circle area is total volume handled, colour deepens with it`,
  };
}

// ---------------------------------------------------------------- design 3: breakdown

function drawBreakdown(P) {
  const { svg, t, box } = P;
  const d = S.data;
  const importers = d.importers.slice(0, 30);
  const nSlots = d.legend.length;
  const slotColour = (slot) => {
    if (slot < 0) return t.neutral;
    const k = nSlots <= 1 ? 0.55 : slot / (nSlots - 1);
    return d3.interpolateYlOrBr(0.34 + k * 0.60);
  };

  // --- the two headline totals, as on the page ---
  //
  // Both numbers were only in the subtitle and the footer, as prose. A poster is read from
  // across a room before it is read at arm's length, and at that distance a sentence is a
  // grey band. These are the two figures the whole sheet is about, so they get the size.
  //
  // Two panels, not one pair of axes: tonnes and dollars share no scale, and drawing them
  // together would put a crossing point on the poster that is an artefact of the units.
  // Laid out top down from a stated height, not by stacking offsets and hoping. The first
  // attempt did the latter and the chart came out 8px tall behind the number.
  // The height comes first and the type is derived from it, never the other way round. Sized
  // off the page width instead, the panel kept its type when the band shrank, and the
  // landscape format pushed the number straight out through the bottom of its own box.
  const statH = Math.min(box.h * 0.24, Math.round(S.h * 0.12));
  const capPx = Math.max(6, Math.min(Math.round(S.w * 0.0115), Math.round(statH * 0.16)));
  const numPx = Math.max(11, Math.min(Math.round(S.w * 0.029), Math.round(statH * 0.34)));
  const pad = Math.max(4, Math.round(statH * 0.13));
  const statGap = box.w * 0.035;
  const statW = (box.w - statGap) / 2;

  [{ label: 'TOTAL IMPORTED', value: fmtT(d.totals.qty), key: 'qty', colour: t.origin },
   { label: 'TOTAL VALUE', value: fmtV(d.totals.val), key: 'val', colour: t.market },
  ].forEach((pan, i) => {
    const px = box.x + i * (statW + statGap), py = box.y;
    const g = el('g'); svg.appendChild(g);
    g.appendChild(el('rect', { x: px.toFixed(1), y: py.toFixed(1),
      width: statW.toFixed(1), height: statH.toFixed(1), rx: (statH * 0.09).toFixed(1),
      fill: t.ink, 'fill-opacity': 0.045 }));

    const yLabel = py + pad + capPx;
    const yValue = yLabel + capPx * 0.6 + numPx;
    g.appendChild(text(pan.label, { x: (px + pad).toFixed(1), y: yLabel.toFixed(1),
      fill: t.dim, 'font-size': capPx, 'letter-spacing': (capPx * 0.10).toFixed(2) }));
    g.appendChild(text(pan.value, { x: (px + pad).toFixed(1), y: yValue.toFixed(1),
      fill: t.ink, 'font-size': numPx, 'font-weight': 700 }));

    const ser = d.series || [];
    const x0 = px + pad, x1 = px + statW - pad;
    const yB = py + statH - pad - capPx * 1.2;
    const chartH = yB - (yValue + numPx * 0.30);
    // Below this a trend line is a smear, and a smear that looks like a chart is worse than
    // no chart. The headline number is the panel's job; the sparkline is the bonus.
    if (ser.length > 1 && chartH >= 14) {
      const max = Math.max(...ser.map((v) => v[pan.key])) || 1;
      const sx = (k) => x0 + (k / (ser.length - 1)) * (x1 - x0);
      const sy = (v) => yB - (v / max) * chartH;
      const line = ser.map((v, k) => `${k ? 'L' : 'M'} ${sx(k).toFixed(1)} ${sy(v[pan.key]).toFixed(1)}`).join(' ');
      g.appendChild(el('path', {
        d: `${line} L ${x1.toFixed(1)} ${yB.toFixed(1)} L ${x0.toFixed(1)} ${yB.toFixed(1)} Z`,
        fill: pan.colour, 'fill-opacity': 0.17 }));
      g.appendChild(el('path', { d: line, fill: 'none', stroke: pan.colour,
        'stroke-width': Math.max(1, S.w * 0.0022), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      g.appendChild(text(String(ser[0].year), { x: x0.toFixed(1), y: (yB + capPx * 1.15).toFixed(1),
        fill: t.dim, 'font-size': capPx * 0.85 }));
      g.appendChild(text(String(ser[ser.length - 1].year), { x: x1.toFixed(1),
        y: (yB + capPx * 1.15).toFixed(1), 'text-anchor': 'end', fill: t.dim, 'font-size': capPx * 0.85 }));
    }
  });

  // The grid takes what the panels left.
  const grid = { x: box.x, y: box.y + statH + statGap * 0.7,
                 w: box.w, h: box.h - statH - statGap * 0.7 };

  // Choose the column count whose resulting cell is closest to square.
  let cols = 4, best = Infinity;
  for (let c = 3; c <= 6; c++) {
    const rws = Math.ceil(importers.length / c);
    const ratio = (grid.w / c) / (grid.h / rws);
    if (Math.abs(Math.log(ratio)) < best) { best = Math.abs(Math.log(ratio)); cols = c; }
  }
  const rows = Math.ceil(importers.length / cols);
  const cellW = grid.w / cols;
  const cellH = Math.min(grid.h / rows, cellW * 1.2);
  const radius = Math.min(cellH * 0.40, cellW * 0.27);
  const labelSize = Math.max(7, Math.round(Math.min(radius * 0.34, cellW * 0.075)));

  const gridTop = grid.y + Math.max(0, (grid.h - rows * cellH) / 2);
  importers.forEach((imp, i) => {
    const cellX = grid.x + (i % cols) * cellW;
    const cellY = gridTop + Math.floor(i / cols) * cellH;
    // Identical spec to the interactive page; the poster only chooses the palette.
    const cell = window.dialCell({ imp, W: cellW, H: cellH, R: radius, maxRibbons: 9, labelSize });
    const cellG = el('g', { transform: `translate(${cellX.toFixed(1)},${cellY.toFixed(1)})` });
    svg.appendChild(cellG);

    // The same painter the page uses. The poster supplies the printed palette and nothing
    // else, so it cannot lose or resize a part of the cell on its own the way it did before.
    window.paintDialCell(cellG, cell, {
      ink: t.ink, dim: t.dim, trend: t.dim, trendOpacity: 0.85,
      stroke: t.bg, strokeWidth: 0.4,
      totalText: fmtT(imp.qty),
      fill: (b) => slotColour(b.source.slot),
    });
  });

  const items = d.legend.slice(0, 10).map((l) => ({ colour: slotColour(l.slot), label: shortName(l.name) }));
  if (d.otherSellers > 0) items.push({ colour: t.neutral, label: `+${d.otherSellers} more` });

  svg.__strandCount = 0;
  return {
    keyRows: [
      { type: 'swatches', items: items.slice(0, 4) },
      { type: 'swatches', items: items.slice(4, 8) },
      { type: 'swatches', items: items.slice(8) },
    ],
    totals: `${fmtT(d.totals.qty)} · ${fmtV(d.totals.val)} · ${d.totals.importers} buyers from ${d.totals.sellers} origins · each dial is one buyer: the small line is its intake year by year, and the divided line beside it funnels out to the rim, one ribbon per origin, sized by its share`,
  };
}

// ---------------------------------------------------------------- build & preview

function buildPoster() {
  const P = beginPoster();
  const out = S.design === 'map' ? drawMap(P)
    : S.design === 'breakdown' ? drawBreakdown(P)
    : drawFlows(P);
  drawFooter(P, out.keyRows, out.totals);
  return P.svg;
}

function draw() {
  const host = document.getElementById('preview');
  host.innerHTML = '';
  const svg = buildPoster();
  svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
  svg.removeAttribute('width'); svg.removeAttribute('height');
  host.style.width = Math.min(S.w, 640) + 'px';
  host.appendChild(svg);

  const scale = +document.getElementById('res').value;
  const n = svg.__strandCount || 0;
  document.getElementById('pxHint').textContent =
    `${S.w * scale} × ${S.h * scale} px` + (n ? ` · ${n.toLocaleString()} strands` : '');
}

// ---------------------------------------------------------------- export

function serialize(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', S.w);
  clone.setAttribute('height', S.h);
  clone.removeAttribute('style');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

const setStatus = (m) => { document.getElementById('status').textContent = m; };

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function saveToProject(blob, filename) {
  try {
    const res = await fetch('/api/save?name=' + encodeURIComponent(filename),
      { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    if (!res.ok) return null;
    return (await res.json()).file;
  } catch { return null; }
}

function baseName() {
  const item = S.meta.items.find((i) => i.code === S.item);
  const slug = (item ? item.name : 'coffee').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const zone = (S.expZone === 'all' && S.impZone === 'all') ? 'world' : `${S.expZone}-to-${S.impZone}`;
  return `coffee-${S.design}-${slug}-${zone}-${yearLabel().replace('–', '-')}-${S.w}x${S.h}`;
}

async function exportPNG() {
  const btn = document.getElementById('download');
  btn.disabled = true;
  setStatus('rendering…');
  try {
    const scale = +document.getElementById('res').value;
    const blob = new Blob([serialize(buildPoster())], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('the SVG could not be rasterised'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = S.w * scale; canvas.height = S.h * scale;
    const ctx = canvas.getContext('2d');
    // PNG is transparent by default; a poster whose ground is merely "not drawn"
    // looks broken everywhere it lands.
    ctx.fillStyle = THEMES[themeKey()].bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!png) throw new Error('PNG encoding failed');
    const filename = baseName() + `@${scale}x.png`;
    saveBlob(png, filename);
    const saved = await saveToProject(png, filename);
    setStatus(`${canvas.width} × ${canvas.height} px · ${(png.size / 1e6).toFixed(1)} MB`
      + (saved ? ` · also in ${saved}` : ''));
  } catch (err) {
    setStatus('failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function exportSVG() {
  const blob = new Blob([serialize(buildPoster())], { type: 'image/svg+xml' });
  const filename = baseName() + '.svg';
  saveBlob(blob, filename);
  const saved = await saveToProject(blob, filename);
  setStatus('vector SVG' + (saved ? ` · in ${saved}` : ' saved'));
}

// ---------------------------------------------------------------- controls

function populateZones() {
  const groups = {};
  for (const z of S.meta.zones) (groups[z.group || ''] ??= []).push(z);
  const html = Object.entries(groups).map(([g, list]) =>
    g ? `<optgroup label="${g}">${list.map((z) => `<option value="${z.id}">${z.label}</option>`).join('')}</optgroup>`
      : list.map((z) => `<option value="${z.id}">${z.label}</option>`).join('')).join('');
  for (const id of ['expZone', 'impZone']) {
    const node = document.getElementById(id);
    if (node) { node.innerHTML = html; node.value = S[id]; }
  }
}

function populateScaleOptions() {
  const sel = document.getElementById('scale');
  sel.innerHTML = '<option value="auto">Auto</option>' +
    scales().map((u) => `<option value="${u}">1 strand = ${fmt(u)}</option>`).join('');
  sel.value = 'auto'; S.scale = 'auto';
}

/** Controls that do not apply to the current design are hidden, not left inert. */
function syncDesignUI() {
  document.querySelectorAll('[data-only]').forEach((n) => {
    n.style.display = n.dataset.only.split(' ').includes(S.design) ? '' : 'none';
  });
}

function wire() {
  const $ = (id) => document.getElementById(id);
  const reload = () => load().catch((e) => setStatus('failed: ' + e.message));
  const debounce = (fn, ms = 220) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const reloadSoon = debounce(reload);

  $('design').onchange = (e) => {
    S.design = e.target.value;
    S.titleTouched = false; S.subtitleTouched = false;
    syncDesignUI(); reload();
  };
  $('format').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.setAttribute('aria-pressed', c === b));
    S.w = +b.dataset.w; S.h = +b.dataset.h; draw();
  };
  $('theme').onchange = (e) => { S.theme = e.target.value; draw(); };
  $('typeface').onchange = (e) => { S.typeface = e.target.value; draw(); };
  $('item').onchange = (e) => { S.item = +e.target.value; reload(); };
  $('metric').onchange = (e) => { S.metric = e.target.value; populateScaleOptions(); reload(); };
  $('rule').onchange = (e) => { S.rule = e.target.value; reload(); };
  $('showOther').onchange = (e) => { S.other = e.target.checked; reload(); };
  $('expZone').onchange = (e) => { S.expZone = e.target.value; S.titleTouched = false; S.subtitleTouched = false; reload(); };
  $('impZone').onchange = (e) => { S.impZone = e.target.value; S.titleTouched = false; S.subtitleTouched = false; reload(); };
  $('res').onchange = draw;
  $('year').oninput = (e) => { S.year = +e.target.value; syncYear(); reloadSoon(); };
  $('span').oninput = (e) => { S.span = +e.target.value; syncYear(); reloadSoon(); };
  $('topN').oninput = (e) => { S.topN = +e.target.value; $('topNVal').textContent = S.topN; reloadSoon(); };
  $('scale').onchange = (e) => { S.scale = e.target.value; chooseScale(); draw(); };
  $('title').oninput = (e) => { S.title = e.target.value; S.titleTouched = true; draw(); };
  $('subtitle').oninput = (e) => { S.subtitle = e.target.value; S.subtitleTouched = true; draw(); };
  $('credit').oninput = (e) => { S.credit = e.target.value; draw(); };
  $('download').onclick = exportPNG;
  $('downloadSvg').onclick = exportSVG;

  // While the poster theme is "Follow app", the site's own toggle drives it.
  addEventListener('themechange', () => { if (S.theme === 'auto' && S.data) draw(); });
}

function syncYear() {
  const years = S.meta.years, last = years[years.length - 1];
  if (S.year + S.span - 1 > last) S.year = Math.max(years[0], last - S.span + 1);
  document.getElementById('year').value = S.year;
  document.getElementById('yearVal').textContent = yearLabel();
  document.getElementById('spanVal').textContent = S.span > 1 ? `${S.span} years` : 'single year';
  S.subtitleTouched = false;
}

// ---------------------------------------------------------------- boot

function applyURLState() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  const num = (k, lo, hi, dflt) => {
    if (!q.has(k)) return dflt;
    const v = Number(q.get(k));
    return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : dflt;
  };
  const known = (k, list, dflt) => (list.includes(q.get(k)) ? q.get(k) : dflt);
  const zoneIds = S.meta.zones.map((z) => z.id);
  const years = S.meta.years;

  S.design = known('design', ['flows', 'map', 'breakdown'], S.design);
  const item = num('item', 0, 1e5, S.item);
  if (S.meta.items.some((i) => i.code === item)) S.item = item;
  S.metric = known('metric', ['qty', 'value'], S.metric);
  S.year = num('year', years[0], years[years.length - 1], S.year);
  S.span = num('span', 1, 20, S.span);
  S.topN = num('topN', 4, 24, S.topN);
  S.rule = known('rule', ['importer', 'exporter', 'max', 'mean'], S.rule);
  S.expZone = known('expZone', zoneIds, 'all');
  S.impZone = known('impZone', zoneIds, 'all');
  if (q.has('other')) S.other = q.get('other') !== '0';
  const sc = q.get('scale');
  S.scale = sc && scales().includes(Number(sc)) ? sc : 'auto';
}

function syncControls() {
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = String(v); };
  set('design', S.design); set('item', S.item); set('metric', S.metric); set('rule', S.rule);
  set('expZone', S.expZone); set('impZone', S.impZone); set('theme', S.theme);
  set('year', S.year); set('span', S.span); set('topN', S.topN); set('scale', S.scale);
  document.getElementById('topNVal').textContent = S.topN;
  const oc = document.getElementById('showOther'); if (oc) oc.checked = S.other;
  syncYear();
  syncDesignUI();
}

(async function boot() {
  S.meta = await window.fetchJSON('/api/meta', 'items');
  const years = S.meta.years;

  document.getElementById('item').innerHTML =
    S.meta.items.map((i) => `<option value="${i.code}">${i.name}</option>`).join('');

  const y = document.getElementById('year');
  y.min = years[0]; y.max = years[years.length - 1];
  S.year = years[years.length - 1]; y.value = S.year;

  populateZones();
  populateScaleOptions();
  applyURLState();
  syncControls();
  wire();
  await load();
})().catch((err) => setStatus('could not start: ' + err.message));
