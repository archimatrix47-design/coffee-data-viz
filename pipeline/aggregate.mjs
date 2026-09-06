/**
 * Reduces the raw FAOSTAT coffee extract into the flow dataset the site serves.
 *
 * The central problem this solves is that FAOSTAT reports every trade twice.
 * When Brazil ships coffee to Germany, Brazil files it as an export and Germany
 * files it as an import -- two rows, two different numbers, one physical shipment.
 * Naively summing them roughly doubles world trade.
 *
 * So rows are collapsed onto a canonical (exporter, importer, item, year) key, and
 * both sides are kept rather than picked between here. The reconciliation rule
 * lives at serve time so the UI can expose it, and so the disagreement between the
 * two sides stays visible instead of being quietly averaged away.
 *
 * Two directional facts drive everything below:
 *   import row  -> reporter bought FROM partner  -> flow is partner -> reporter
 *   export row  -> reporter sold   TO   partner  -> flow is reporter -> partner
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { continentOf, HISTORICAL_SUCCESSORS } from './continents.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RAW_CSV = path.join(ROOT, 'data', 'raw', 'coffee_raw.csv');
const OUT_DIR = path.join(ROOT, 'data', 'processed');

// Element codes, confirmed present in the extract (and only these four).
const EL_IMPORT_QTY = 5610;
const EL_IMPORT_VAL = 5622;
const EL_EXPORT_QTY = 5910;
const EL_EXPORT_VAL = 5922;

// Bit-packing budget: country < 256, item < 8, year offset < 64.
const YEAR_BASE = 1986;
const packKey = (exp, imp, item, yr) => ((exp * 256 + imp) * 8 + item) * 64 + (yr - YEAR_BASE);

/**
 * Splits a FAOSTAT bulk row. Every field is quoted, so splitting on the `","`
 * boundary is safe even though names like "Cake, oilseeds nes" contain commas --
 * which a naive split on "," would tear in half.
 */
function parseRow(line) {
  const f = line.split('","');
  if (f.length < 16) return null;
  f[0] = f[0].slice(1);
  f[f.length - 1] = f[f.length - 1].replace(/"\s*$/, '');
  return f;
}

async function main() {
  const t0 = Date.now();
  if (!fs.existsSync(RAW_CSV)) {
    console.error(`Missing ${RAW_CSV}. Run: npm run refresh`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const countryName = new Map();   // code -> name
  const countryM49 = new Map();    // code -> M49 numeric, for joining to world geometry
  const itemName = new Map();      // code -> name
  const flows = new Map();         // packed key -> [impQty, impVal, expQty, expVal]
  const yearsSeen = new Set();
  const flagCounts = new Map();

  let rows = 0, skippedSelf = 0, skippedUnparsed = 0, skippedNoValue = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(RAW_CSV, { highWaterMark: 1 << 20 }),
    crlfDelay: Infinity,
  });

  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line) continue;

    const f = parseRow(line);
    if (!f) { skippedUnparsed++; continue; }

    const reporter = +f[0];
    const reporterName = f[2];
    const partner = +f[3];
    const partnerName = f[5];
    const itemCode = +f[6];
    const item = f[8];
    const element = +f[9];
    const year = +f[12];
    const value = parseFloat(f[14]);
    const flag = f[15];

    rows++;

    // Self-trade (reporter == partner) would become a self-loop in the network
    // graph and an arc pointing at itself in the chord. It is an artifact.
    if (reporter === partner) { skippedSelf++; continue; }
    if (!Number.isFinite(value)) { skippedNoValue++; continue; }

    countryName.set(reporter, reporterName);
    countryName.set(partner, partnerName);
    // M49 arrives quoted with a leading apostrophe, e.g. "'004".
    if (!countryM49.has(reporter)) countryM49.set(reporter, +String(f[1]).replace(/'/g, ''));
    if (!countryM49.has(partner)) countryM49.set(partner, +String(f[4]).replace(/'/g, ''));
    itemName.set(itemCode, item);
    yearsSeen.add(year);
    flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);

    // Resolve the physical direction of the shipment.
    let exporter, importer, slot;
    if (element === EL_IMPORT_QTY)      { exporter = partner;  importer = reporter; slot = 0; }
    else if (element === EL_IMPORT_VAL) { exporter = partner;  importer = reporter; slot = 1; }
    else if (element === EL_EXPORT_QTY) { exporter = reporter; importer = partner;  slot = 2; }
    else if (element === EL_EXPORT_VAL) { exporter = reporter; importer = partner;  slot = 3; }
    else continue;

    // Stash by real code first; remapped to dense indices after the pass, since
    // the full country set is not known until the file is read.
    const key = `${exporter}|${importer}|${itemCode}|${year}`;
    let rec = flows.get(key);
    if (!rec) { rec = [null, null, null, null]; flows.set(key, rec); }
    rec[slot] = value;
  }

  // ---- Build dense index tables ----
  const countryCodes = [...countryName.keys()].sort((a, b) => a - b);
  const countryIdx = new Map(countryCodes.map((c, i) => [c, i]));
  const itemCodes = [...itemName.keys()].sort((a, b) => a - b);
  const itemIdx = new Map(itemCodes.map((c, i) => [c, i]));
  const years = [...yearsSeen].sort((a, b) => a - b);

  const countries = countryCodes.map((code) => ({
    code,
    m49: countryM49.get(code) ?? null,
    name: countryName.get(code),
    continent: continentOf(code),
    historical: HISTORICAL_SUCCESSORS[code] ? true : undefined,
  }));

  const unmapped = countries.filter((c) => c.continent === 'Other' && c.code !== 31);
  if (unmapped.length) {
    console.warn(`WARNING: ${unmapped.length} countries fell through the continent map:`,
      unmapped.map((c) => `${c.code}=${c.name}`).join(', '));
  }

  // ---- Emit columnar arrays ----
  const n = flows.size;
  const exporter = new Array(n), importer = new Array(n), item = new Array(n), year = new Array(n);
  const impQty = new Array(n), impVal = new Array(n), expQty = new Array(n), expVal = new Array(n);

  let i = 0;
  let bothQty = 0, onlyImp = 0, onlyExp = 0;
  const discrepancies = [];

  for (const [key, rec] of flows) {
    const [e, m, it, y] = key.split('|').map(Number);
    exporter[i] = countryIdx.get(e);
    importer[i] = countryIdx.get(m);
    item[i] = itemIdx.get(it);
    year[i] = y;
    impQty[i] = rec[0]; impVal[i] = rec[1]; expQty[i] = rec[2]; expVal[i] = rec[3];

    // Track how far the two reporting sides disagree -- a genuine quality signal.
    if (rec[0] != null && rec[2] != null) {
      bothQty++;
      const lo = Math.min(rec[0], rec[2]), hi = Math.max(rec[0], rec[2]);
      if (hi > 0) discrepancies.push(lo / hi);
    } else if (rec[0] != null) onlyImp++;
    else if (rec[2] != null) onlyExp++;
    i++;
  }

  discrepancies.sort((a, b) => a - b);
  const medianAgreement = discrepancies.length
    ? discrepancies[Math.floor(discrepancies.length / 2)] : null;

  const meta = {
    generatedAt: new Date().toISOString(),
    source: {
      name: 'FAOSTAT Detailed Trade Matrix',
      domain: 'TM',
      url: 'https://www.fao.org/faostat/en/#data/TM',
      bulkFile: 'Trade_DetailedTradeMatrix_E_All_Data_(Normalized).zip',
      bulkLastModified: '2025-12-23',
      licence: 'CC BY-4.0',
    },
    countries,
    items: itemCodes.map((code) => ({ code, name: itemName.get(code) })),
    years,
    elements: {
      5610: 'Import quantity (t)', 5622: 'Import value (1000 USD)',
      5910: 'Export quantity (t)', 5922: 'Export value (1000 USD)',
    },
    historicalSuccessors: HISTORICAL_SUCCESSORS,
    stats: {
      rawRows: rows,
      flows: n,
      skippedSelfTrade: skippedSelf,
      skippedUnparsed: skippedUnparsed,
      skippedNoValue: skippedNoValue,
      quantityBothSidesReported: bothQty,
      quantityOnlyImporterReported: onlyImp,
      quantityOnlyExporterReported: onlyExp,
      medianMirrorAgreement: medianAgreement,
      flagCounts: Object.fromEntries(flagCounts),
    },
    notes: [
      'Each flow is exporter -> importer. Import- and export-reported figures are both kept; the reconciliation rule is applied at serve time.',
      'Import values are CIF (include freight and insurance) while export values are FOB, so import values run systematically higher. Quantities are unaffected.',
      'Historical states (USSR, Czechoslovakia, Yugoslav SFR, Belgium-Luxembourg, Ethiopia PDR, Sudan former) are preserved so pre-1993 years stay accurate.',
    ],
  };

  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'flows.json'), JSON.stringify({
    n, exporter, importer, item, year, impQty, impVal, expQty, expVal,
  }));

  // ---- Validation: direction sanity check ----
  // If the exporter/importer assignment above were inverted, the largest coffee
  // exporters would come back as Germany and the USA instead of Brazil and Viet Nam.
  const latest = years[years.length - 1];
  const greenIdx = itemIdx.get(656);
  const byExporter = new Map();
  const byImporter = new Map();
  for (let k = 0; k < n; k++) {
    if (year[k] !== latest || item[k] !== greenIdx) continue;
    const q = impQty[k] ?? expQty[k];
    if (q == null) continue;
    byExporter.set(exporter[k], (byExporter.get(exporter[k]) ?? 0) + q);
    byImporter.set(importer[k], (byImporter.get(importer[k]) ?? 0) + q);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([idx, v]) => `${countries[idx].name} ${(v / 1000).toFixed(0)}k t`).join(', ');

  console.log(`\nParsed ${rows.toLocaleString()} rows -> ${n.toLocaleString()} flows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`Years ${years[0]}-${latest} | ${countries.length} countries | ${itemCodes.length} items`);
  console.log(`Dropped: ${skippedSelf} self-trade, ${skippedUnparsed} unparsed, ${skippedNoValue} non-numeric`);
  console.log(`Mirror coverage: ${bothQty.toLocaleString()} both sides, ${onlyImp.toLocaleString()} importer only, ${onlyExp.toLocaleString()} exporter only`);
  console.log(`Median agreement where both reported: ${medianAgreement != null ? (medianAgreement * 100).toFixed(1) + '%' : 'n/a'}`);
  console.log(`\nSANITY CHECK -- green coffee, ${latest}`);
  console.log(`  top exporters: ${top(byExporter)}`);
  console.log(`  top importers: ${top(byImporter)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
