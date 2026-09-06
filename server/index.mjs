/**
 * Serves the coffee trade dataset as query-able slices.
 *
 * The whole flow table (~410k rows) is held in memory as columnar arrays, so a
 * request is a single linear scan -- a few milliseconds. That is what lets the year
 * slider and the filters feel instant without shipping 12MB to the browser or
 * pre-baking every combination of item x year x metric x rule to disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { ZONES, zoneCodes, zoneLabel, zoneTitleLabel } from '../pipeline/zones.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROCESSED = path.join(ROOT, 'data', 'processed');
// 3000 is deliberately avoided: another project's dev server commonly holds it, and
// a half-bound port (IPv4 here, IPv6 there) produces confusing cross-talk.
const PORT = process.env.PORT || 3200;

/**
 * Anything that only makes sense on the machine doing the building.
 *
 * Two things fall under this. The study harness and the reference viewer are working tools,
 * and the reference art is someone else's drawing that was traced from; neither belongs on a
 * public URL. And POST /api/save writes a file to disk with no authentication, which is a
 * convenience when the browser and the disk are the same computer and an open invitation to
 * fill a volume when they are not.
 *
 * Defaults to on for local work and off the moment NODE_ENV says production. Set
 * ALLOW_DEV_ROUTES explicitly to override in either direction.
 */
const DEV_ROUTES = process.env.ALLOW_DEV_ROUTES
  ? !/^(0|false|off)$/i.test(process.env.ALLOW_DEV_ROUTES)
  : process.env.NODE_ENV !== 'production';

const DEV_ONLY_PATHS = [
  '/dial-study', '/dial-study.html',
  '/ref', '/ref.html',
  '/vendor/reference-dial.svg',
];

// ---------------------------------------------------------------- load

function loadData() {
  const metaPath = path.join(PROCESSED, 'meta.json');
  const flowsPath = path.join(PROCESSED, 'flows.json');
  if (!fs.existsSync(metaPath) || !fs.existsSync(flowsPath)) {
    console.error('No processed data found. Run: npm run refresh');
    process.exit(1);
  }
  const t0 = Date.now();
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const raw = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));

  // Typed arrays: ~10x less memory than JS number arrays, and faster to scan.
  // null (not reported) is preserved as NaN so it stays distinct from a real zero.
  const toF64 = (a) => { const t = new Float64Array(a.length); for (let i = 0; i < a.length; i++) t[i] = a[i] == null ? NaN : a[i]; return t; };
  const flows = {
    n: raw.n,
    exporter: Int16Array.from(raw.exporter),
    importer: Int16Array.from(raw.importer),
    item: Int8Array.from(raw.item),
    year: Int16Array.from(raw.year),
    impQty: toF64(raw.impQty), impVal: toF64(raw.impVal),
    expQty: toF64(raw.expQty), expVal: toF64(raw.expVal),
  };
  console.log(`Loaded ${flows.n.toLocaleString()} flows in ${Date.now() - t0}ms`);
  return { meta, flows };
}

const { meta, flows } = loadData();
const itemIndexByCode = new Map(meta.items.map((it, i) => [it.code, i]));

// ---------------------------------------------------------------- query core

/**
 * Reconciles the two reported sides of one flow into a single figure.
 *
 * Default prefers the importer's number: customs assess duty on imports, so those
 * records get more scrutiny than export declarations. Where only one side filed,
 * that side is used rather than dropping the flow.
 */
function pick(i, metric, rule) {
  const imp = metric === 'value' ? flows.impVal[i] : flows.impQty[i];
  const exp = metric === 'value' ? flows.expVal[i] : flows.expQty[i];
  const hasImp = !Number.isNaN(imp), hasExp = !Number.isNaN(exp);
  if (rule === 'exporter') return hasExp ? exp : (hasImp ? imp : 0);
  if (rule === 'max') return Math.max(hasImp ? imp : 0, hasExp ? exp : 0);
  if (rule === 'mean' && hasImp && hasExp) return (imp + exp) / 2;
  return hasImp ? imp : (hasExp ? exp : 0);
}

function parseQuery(q) {
  const years = meta.years;
  const yearFrom = Math.max(+q.yearFrom || years[years.length - 1], years[0]);
  const yearTo = Math.min(+q.yearTo || yearFrom, years[years.length - 1]);
  // items: comma-separated FAO codes, default green coffee (the core commodity)
  const itemCodes = (q.items ? String(q.items).split(',').map(Number) : [656])
    .filter((c) => itemIndexByCode.has(c));
  const itemIdx = new Set(itemCodes.map((c) => itemIndexByCode.get(c)));
  // Zones restrict each side independently, which is what allows a question like
  // "African origins into the EU" rather than just "everything touching Africa".
  const expZone = q.expZone || 'all';
  const impZone = q.impZone || 'all';
  const expSet = zoneCodes(expZone);
  const impSet = zoneCodes(impZone);

  return {
    yearFrom: Math.min(yearFrom, yearTo),
    yearTo: Math.max(yearFrom, yearTo),
    itemIdx,
    itemCodes,
    metric: q.metric === 'value' ? 'value' : 'qty',
    rule: ['importer', 'exporter', 'max', 'mean'].includes(q.rule) ? q.rule : 'importer',
    expZone, impZone,
    expLabel: zoneLabel(expZone), impLabel: zoneLabel(impZone),
    expTitle: zoneTitleLabel(expZone), impTitle: zoneTitleLabel(impZone),
    // Indices are resolved once here rather than per row.
    expAllowed: expSet ? new Set(meta.countries.map((c, i) => (expSet.has(c.code) ? i : -1)).filter((i) => i >= 0)) : null,
    impAllowed: impSet ? new Set(meta.countries.map((c, i) => (impSet.has(c.code) ? i : -1)).filter((i) => i >= 0)) : null,
  };
}

/** One pass over the table -> pair totals plus per-country export/import totals. */
function aggregate(opts) {
  const { yearFrom, yearTo, itemIdx, metric, rule, expAllowed, impAllowed } = opts;
  const pairs = new Map();               // exporter*1000+importer -> weight
  const exportTot = new Map(), importTot = new Map();
  let matched = 0, total = 0;

  for (let i = 0; i < flows.n; i++) {
    const y = flows.year[i];
    if (y < yearFrom || y > yearTo) continue;
    if (!itemIdx.has(flows.item[i])) continue;

    const e = flows.exporter[i], m = flows.importer[i];
    if (expAllowed && !expAllowed.has(e)) continue;
    if (impAllowed && !impAllowed.has(m)) continue;

    const w = pick(i, metric, rule);
    if (!(w > 0)) continue;
    const key = e * 1000 + m;
    pairs.set(key, (pairs.get(key) ?? 0) + w);
    exportTot.set(e, (exportTot.get(e) ?? 0) + w);
    importTot.set(m, (importTot.get(m) ?? 0) + w);
    matched++; total += w;
  }
  return { pairs, exportTot, importTot, matched, total };
}

/** Countries ranked by total involvement (what they ship plus what they receive). */
function rankCountries({ exportTot, importTot }) {
  const tot = new Map();
  for (const [c, v] of exportTot) tot.set(c, (tot.get(c) ?? 0) + v);
  for (const [c, v] of importTot) tot.set(c, (tot.get(c) ?? 0) + v);
  return [...tot.entries()].sort((a, b) => b[1] - a[1]);
}

const countryOut = (idx) => {
  const c = meta.countries[idx];
  return { idx, code: c.code, m49: c.m49, name: c.name, continent: c.continent, historical: c.historical };
};

// ---------------------------------------------------------------- app

const app = express();

// Before the static middleware, or express.static answers first and the guard never runs.
app.use((req, res, next) => {
  if (!DEV_ROUTES && DEV_ONLY_PATHS.includes(req.path)) return res.status(404).send('Not found');
  next();
});

app.use(express.static(path.join(ROOT, 'web'), { extensions: ['html'] }));

app.get('/api/meta', (_req, res) => {
  res.json({
    countries: meta.countries, items: meta.items, years: meta.years,
    source: meta.source, stats: meta.stats, notes: meta.notes,
    zones: ZONES.map(({ id, label, group }) => ({ id, label, group, titleLabel: zoneTitleLabel(id) })),
    generatedAt: meta.generatedAt,
  });
});

/**
 * Bipartite chord: every country is split into its selling side and its buying
 * side, so exporters occupy one half of the circle and importers the other and
 * every ribbon crosses the middle. A hub like Germany legitimately appears twice --
 * it is a large buyer and a large re-seller, and collapsing those into one arc
 * hides exactly the behaviour worth seeing.
 */
function buildBipartite(agg, opts, req) {
  const topExp = Math.min(Math.max(+req.query.topExp || 12, 2), 40);
  const topImp = Math.min(Math.max(+req.query.topImp || 12, 2), 40);
  const includeOther = req.query.other !== '0';

  const exRank = [...agg.exportTot.entries()].sort((a, b) => b[1] - a[1]);
  const imRank = [...agg.importTot.entries()].sort((a, b) => b[1] - a[1]);
  const exTop = exRank.slice(0, topExp).map(([i]) => i);
  const imTop = imRank.slice(0, topImp).map(([i]) => i);

  const exPos = new Map(exTop.map((idx, i) => [idx, i]));
  const imPos = new Map(imTop.map((idx, i) => [idx, i]));

  const exOther = includeOther && exRank.length > exTop.length ? exTop.length : -1;
  const eCount = exTop.length + (exOther >= 0 ? 1 : 0);
  const imOther = includeOther && imRank.length > imTop.length ? eCount + imTop.length : -1;
  const size = eCount + imTop.length + (imOther >= 0 ? 1 : 0);

  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  let shown = 0, spilled = 0;

  for (const [key, w] of agg.pairs) {
    const e = Math.floor(key / 1000), m = key % 1000;
    const ei = exPos.has(e) ? exPos.get(e) : exOther;
    const mi = imPos.has(m) ? eCount + imPos.get(m) : imOther;
    if (ei < 0 || mi < 0) { spilled += w; continue; }
    matrix[ei][mi] += w;
    shown += w;
  }

  const node = (idx, side) => {
    const c = meta.countries[idx];
    return {
      idx, side, code: c.code, name: c.name, continent: c.continent,
      exports: agg.exportTot.get(idx) ?? 0,
      imports: agg.importTot.get(idx) ?? 0,
    };
  };
  const nodes = exTop.map((i) => node(i, 'exporter'));
  if (exOther >= 0) nodes.push({ idx: -1, side: 'exporter', code: -1, name: `Other exporters (${exRank.length - exTop.length})`, continent: 'Other' });
  nodes.push(...imTop.map((i) => node(i, 'importer')));
  if (imOther >= 0) nodes.push({ idx: -2, side: 'importer', code: -2, name: `Other importers (${imRank.length - imTop.length})`, continent: 'Other' });

  return {
    nodes, matrix, bipartite: true, exporterCount: eCount,
    query: { ...opts, itemIdx: undefined, expAllowed: undefined, impAllowed: undefined, topExp, topImp, includeOther },
    totals: {
      world: agg.total, shown, spilled, flows: agg.matched,
      countriesInvolved: new Set([...agg.exportTot.keys(), ...agg.importTot.keys()]).size,
      exportersTotal: exRank.length, importersTotal: imRank.length,
    },
    unit: opts.metric === 'value' ? '1000 USD' : 'tonnes',
  };
}

/** Square matrix for the chord diagram, restricted to the top N countries. */
app.get('/api/chord', (req, res) => {
  const opts = parseQuery(req.query);
  const topN = Math.min(Math.max(+req.query.topN || 15, 2), 60);
  const includeOther = req.query.other !== '0';

  const agg = aggregate(opts);
  if (req.query.bipartite === '1') return res.json(buildBipartite(agg, opts, req));

  const ranked = rankCountries(agg);
  const top = ranked.slice(0, topN).map(([idx]) => idx);
  const topSet = new Map(top.map((idx, i) => [idx, i]));

  const size = includeOther ? top.length + 1 : top.length;
  const otherIdx = top.length;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));

  let shown = 0, spilled = 0;
  for (const [key, w] of agg.pairs) {
    const e = Math.floor(key / 1000), m = key % 1000;
    const ei = topSet.has(e) ? topSet.get(e) : (includeOther ? otherIdx : -1);
    const mi = topSet.has(m) ? topSet.get(m) : (includeOther ? otherIdx : -1);
    if (ei < 0 || mi < 0) { spilled += w; continue; }
    if (ei === otherIdx && mi === otherIdx) { spilled += w; continue; } // other->other is noise
    matrix[ei][mi] += w;
    shown += w;
  }

  const nodes = top.map((idx) => ({
    ...countryOut(idx),
    exports: agg.exportTot.get(idx) ?? 0,
    imports: agg.importTot.get(idx) ?? 0,
  }));
  if (includeOther) {
    nodes.push({ idx: -1, code: -1, name: `Other (${ranked.length - top.length} countries)`, continent: 'Other' });
  }

  res.json({
    nodes, matrix,
    query: { ...opts, itemIdx: undefined, expAllowed: undefined, impAllowed: undefined, topN, includeOther },
    totals: { world: agg.total, shown, spilled, flows: agg.matched, countriesInvolved: ranked.length },
    unit: opts.metric === 'value' ? '1000 USD' : 'tonnes',
  });
});

/**
 * Two-leg trade: origin -> hub -> final market.
 *
 * IMPORTANT: the second leg is ESTIMATED, not observed. Coffee is fungible and
 * customs records do not follow a bean through a warehouse, so no dataset can say
 * which of Germany's re-exports were originally Brazilian. The standard method,
 * used here, is proportional attribution: if Brazil supplied 42% of everything
 * Germany imported, then 42% of what Germany ships onward is attributed to Brazil.
 *
 * That assumes a hub blends its intake evenly -- wrong in the specific case (a
 * trader may re-export exactly the lot it bought) but unbiased in aggregate. The
 * response is flagged `estimated: true` so the UI never shows it as reported fact.
 */
app.get('/api/chains', (req, res) => {
  const opts = parseQuery(req.query);
  const originCode = +req.query.origin;
  const minShare = +req.query.minShare || 0.005;
  const agg = aggregate(opts);

  const originIdx = meta.countries.findIndex((c) => c.code === originCode);
  if (originIdx < 0) return res.status(400).json({ error: 'unknown origin country' });

  // First leg: what the origin ships directly, and to whom.
  const firstLeg = [];
  for (const [key, w] of agg.pairs) {
    if (Math.floor(key / 1000) !== originIdx) continue;
    firstLeg.push({ hub: key % 1000, w });
  }
  firstLeg.sort((a, b) => b.w - a.w);

  // Second leg: each hub's onward exports, scaled by the origin's share of intake.
  //
  // Crucially this is capped at what the hub actually imported. Without the cap a
  // grower like Viet Nam -- which buys a little coffee and exports its own harvest
  // by the million tonnes -- appears to "re-export" hundreds of thousands of tonnes
  // of Brazilian coffee, because Brazil happens to supply half of its small intake.
  // A country cannot re-export more than it brought in, so the re-exportable pool is
  // min(exports, imports) and only that part is attributable to origins.
  const secondLeg = [], hubs = [];
  for (const { hub, w } of firstLeg) {
    const hubImports = agg.importTot.get(hub) ?? 0;
    const hubExports = agg.exportTot.get(hub) ?? 0;
    if (hubImports <= 0 || hubExports <= 0) continue;
    const share = w / hubImports;
    if (share < minShare) continue;

    const reexportable = Math.min(hubExports, hubImports);
    const factor = (reexportable / hubExports) * share;   // applied to each onward flow

    hubs.push({
      ...countryOut(hub),
      received: w, hubImports, hubExports, share,
      reexportable,
      // Share of the hub's exports that could be re-exports at all. Near 1 for a
      // true entrepot (Germany, Belgium); near 0 for a producer (Viet Nam, Brazil).
      reexportCapacity: reexportable / hubExports,
      attributedOnward: reexportable * share,
    });

    for (const [key, w2] of agg.pairs) {
      if (Math.floor(key / 1000) !== hub) continue;
      const dest = key % 1000;
      if (dest === originIdx) continue;      // back to source is not a re-export chain
      const attributed = w2 * factor;
      if (attributed > 0) secondLeg.push({ hub, dest, w: attributed, observedHubFlow: w2, share, factor });
    }
  }
  secondLeg.sort((a, b) => b.w - a.w);
  hubs.sort((a, b) => b.attributedOnward - a.attributedOnward);

  const involved = new Set([originIdx]);
  for (const f of firstLeg) involved.add(f.hub);
  for (const s of secondLeg) { involved.add(s.hub); involved.add(s.dest); }

  res.json({
    origin: countryOut(originIdx),
    firstLeg, secondLeg, hubs,
    nodes: [...involved].map((idx) => {
      const ex = agg.exportTot.get(idx) ?? 0, im = agg.importTot.get(idx) ?? 0;
      return { ...countryOut(idx), exports: ex, imports: im, throughput: ex + im,
        reexport: ex + im > 0 ? im / (ex + im) : 0 };
    }),
    estimated: true,
    method: 'proportional attribution: second leg = hub onward exports x origin share of hub imports',
    totals: {
      directExports: firstLeg.reduce((s, f) => s + f.w, 0),
      attributedOnward: secondLeg.reduce((s, f) => s + f.w, 0),
      hubCount: hubs.length,
    },
    unit: opts.metric === 'value' ? '1000 USD' : 'tonnes',
  });
});

/**
 * Per-importer breakdown: for each buying country, how much it took in and from
 * which sellers, plus a year-by-year series for the trend inset.
 *
 * Both quantity and value are computed in the same pass. The inset needs the two at
 * once ("X tonnes worth $Y"), and running the scan twice to get them would double the
 * work for no reason.
 */
app.get('/api/breakdown', (req, res) => {
  const opts = parseQuery(req.query);
  const topSources = Math.min(Math.max(+req.query.topSources || 12, 1), 40);
  const maxImporters = Math.min(Math.max(+req.query.maxImporters || 36, 1), 120);

  const { yearFrom, yearTo, itemIdx, rule, expAllowed, impAllowed } = opts;
  const byImporter = new Map();          // importer -> { qty, val, sources:Map, years:Map }
  const sellerTotals = new Map();        // exporter -> qty (for a stable colour order)
  const yearTotals = new Map();          // year -> { qty, val }

  for (let i = 0; i < flows.n; i++) {
    const y = flows.year[i];
    if (y < yearFrom || y > yearTo) continue;
    if (!itemIdx.has(flows.item[i])) continue;
    const e = flows.exporter[i], m = flows.importer[i];
    if (expAllowed && !expAllowed.has(e)) continue;
    if (impAllowed && !impAllowed.has(m)) continue;

    const qty = pick(i, 'qty', rule);
    const val = pick(i, 'value', rule);
    if (!(qty > 0) && !(val > 0)) continue;

    let rec = byImporter.get(m);
    if (!rec) { rec = { qty: 0, val: 0, sources: new Map(), years: new Map() }; byImporter.set(m, rec); }
    rec.qty += qty; rec.val += val;
    rec.sources.set(e, (rec.sources.get(e) ?? 0) + qty);
    const yr = rec.years.get(y) ?? { qty: 0, val: 0 };
    yr.qty += qty; yr.val += val; rec.years.set(y, yr);

    sellerTotals.set(e, (sellerTotals.get(e) ?? 0) + qty);
    const wt = yearTotals.get(y) ?? { qty: 0, val: 0 };
    wt.qty += qty; wt.val += val; yearTotals.set(y, wt);
  }

  // Colour order is by overall volume across the whole selection, not per importer,
  // so a given seller keeps the same colour in every small multiple.
  const sellerRank = [...sellerTotals.entries()].sort((a, b) => b[1] - a[1]);
  const palettePos = new Map(sellerRank.slice(0, topSources).map(([idx], i) => [idx, i]));

  const importers = [...byImporter.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, maxImporters)
    .map(([idx, rec]) => {
      const sources = [...rec.sources.entries()].sort((a, b) => b[1] - a[1]);
      const named = [], grouped = { idx: -1, name: 'Other origins', value: 0, slot: -1 };
      for (const [sIdx, v] of sources) {
        if (palettePos.has(sIdx)) {
          named.push({ ...countryOut(sIdx), value: v, slot: palettePos.get(sIdx) });
        } else grouped.value += v;
      }
      named.sort((a, b) => b.value - a.value);
      if (grouped.value > 0) named.push(grouped);
      return {
        ...countryOut(idx),
        qty: rec.qty, val: rec.val,
        sourceCount: sources.length,
        sources: named,
        series: [...rec.years.entries()].sort((a, b) => a[0] - b[0])
          .map(([year, v]) => ({ year, qty: v.qty, val: v.val })),
      };
    });

  res.json({
    importers,
    // The legend: the sellers that earned their own colour, in that order.
    legend: sellerRank.slice(0, topSources).map(([idx, v], i) => ({ ...countryOut(idx), total: v, slot: i })),
    otherSellers: Math.max(0, sellerRank.length - topSources),
    series: [...yearTotals.entries()].sort((a, b) => a[0] - b[0])
      .map(([year, v]) => ({ year, qty: v.qty, val: v.val })),
    totals: {
      qty: [...yearTotals.values()].reduce((a, b) => a + b.qty, 0),
      val: [...yearTotals.values()].reduce((a, b) => a + b.val, 0),
      importers: byImporter.size,
      sellers: sellerTotals.size,
    },
    query: { ...opts, itemIdx: undefined, expAllowed: undefined, impAllowed: undefined, topSources },
  });
});

/**
 * World totals per year for the current filters. The time-range control draws this
 * behind its track, so you can see where the interesting years are before scrubbing
 * into them rather than hunting blind.
 */
app.get('/api/timeline', (req, res) => {
  const opts = parseQuery({ ...req.query, yearFrom: meta.years[0], yearTo: meta.years[meta.years.length - 1] });
  const { itemIdx, metric, rule, expAllowed, impAllowed } = opts;
  const byYear = new Map(meta.years.map((y) => [y, 0]));

  for (let i = 0; i < flows.n; i++) {
    if (!itemIdx.has(flows.item[i])) continue;
    const e = flows.exporter[i], m = flows.importer[i];
    if (expAllowed && !expAllowed.has(e)) continue;
    if (impAllowed && !impAllowed.has(m)) continue;
    const w = pick(i, metric, rule);
    if (!(w > 0)) continue;
    byYear.set(flows.year[i], (byYear.get(flows.year[i]) ?? 0) + w);
  }

  const series = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value }));
  res.json({
    series,
    peak: series.reduce((a, b) => (b.value > a.value ? b : a), series[0] || { year: null, value: 0 }),
    unit: metric === 'value' ? '1000 USD' : 'tonnes',
  });
});

/** Node/edge list for the network graph. Metrics are computed client-side. */
app.get('/api/network', (req, res) => {
  const opts = parseQuery(req.query);
  const minFlow = Math.max(+req.query.minFlow || 0, 0);
  const topEdges = Math.min(Math.max(+req.query.topEdges || 1500, 10), 20000);

  const agg = aggregate(opts);

  let edges = [];
  for (const [key, w] of agg.pairs) {
    if (w < minFlow) continue;
    edges.push({ s: Math.floor(key / 1000), t: key % 1000, w });
  }
  const totalEdges = edges.length;
  edges.sort((a, b) => b.w - a.w);
  const cut = edges.length > topEdges;
  if (cut) edges = edges.slice(0, topEdges);

  // Only emit nodes that survive the edge filter, else the graph fills with isolates.
  const live = new Set();
  for (const e of edges) { live.add(e.s); live.add(e.t); }

  const nodes = [...live].map((idx) => {
    const ex = agg.exportTot.get(idx) ?? 0;
    const im = agg.importTot.get(idx) ?? 0;
    return {
      ...countryOut(idx),
      exports: ex, imports: im, throughput: ex + im,
      // Re-export intensity: how much a country takes in relative to everything it
      // handles. Pure origins (Brazil) sit near 0; pure markets (USA) near 1;
      // entrepot hubs that import to re-export (Germany, Belgium) sit mid-range
      // while moving large volume -- that combination is what identifies them.
      reexport: ex + im > 0 ? im / (ex + im) : 0,
      balance: ex - im,
    };
  });

  res.json({
    nodes, edges,
    query: { ...opts, itemIdx: undefined, expAllowed: undefined, impAllowed: undefined, minFlow, topEdges },
    totals: {
      world: agg.total, flows: agg.matched,
      edgesTotal: totalEdges, edgesShown: edges.length, truncated: cut,
    },
    unit: opts.metric === 'value' ? '1000 USD' : 'tonnes',
  });
});

/**
 * Saves a rendered poster straight into the project's exports/ folder.
 *
 * The browser's own download works fine in a normal window, but it is at the mercy
 * of download prompts, sandboxes and whatever the user's browser decides to do with
 * a 20MB blob. Posting the bytes here puts the file somewhere known, every time.
 */
/**
 * Write a rendered poster next to the project, for local work only.
 *
 * The page downloads the file through the browser first and calls this afterwards as a
 * convenience, so switching it off costs the user nothing but the "also in exports/" note.
 */
app.post('/api/save', express.raw({ type: ['image/png', 'image/svg+xml'], limit: '80mb' }), (req, res) => {
  if (!DEV_ROUTES) return res.status(404).json({ error: 'not available' });
  const raw = String(req.query.name || 'poster');
  // Keep this to a bare filename in exports/ -- never a caller-controlled path.
  const safe = path.basename(raw).replace(/[^a-zA-Z0-9._@-]/g, '_');
  if (!/\.(png|svg)$/i.test(safe)) return res.status(400).json({ error: 'only .png or .svg' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty body' });

  const dir = path.join(ROOT, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safe);
  fs.writeFileSync(file, req.body);
  console.log(`saved ${safe} (${(req.body.length / 1e6).toFixed(2)} MB)`);
  res.json({ ok: true, file: path.relative(ROOT, file), bytes: req.body.length });
});

// Express swallows handler errors into a bare 500 otherwise, which makes a broken
// query look identical to a broken server.
app.use((err, _req, res, _next) => {
  console.error('API error:', err);
  res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 4) });
});

app.listen(PORT, () => {
  console.log(`Coffee trade viz -> http://localhost:${PORT}`);
  console.log(`  dev routes and local save: ${DEV_ROUTES ? 'on' : 'off'}`);
  console.log(`  chord   http://localhost:${PORT}/`);
  console.log(`  network http://localhost:${PORT}/network`);
});
