/**
 * Diagnostic: how far apart are the two reported sides, and does it depend on size?
 * A 52% median across all flows is alarming; a 52% median driven entirely by
 * three-tonne shipments is not. This tells the two apart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const flows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/processed/flows.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/processed/meta.json'), 'utf8'));

const buckets = [
  { label: '< 10 t', min: 0, max: 10 },
  { label: '10-100 t', min: 10, max: 100 },
  { label: '100-1k t', min: 100, max: 1e3 },
  { label: '1k-10k t', min: 1e3, max: 1e4 },
  { label: '> 10k t', min: 1e4, max: Infinity },
];
for (const b of buckets) b.ratios = [];

let totalImp = 0, totalExp = 0;
for (let i = 0; i < flows.n; i++) {
  const iq = flows.impQty[i], eq = flows.expQty[i];
  if (iq == null || eq == null) continue;
  const lo = Math.min(iq, eq), hi = Math.max(iq, eq);
  if (hi <= 0) continue;
  totalImp += iq; totalExp += eq;
  const b = buckets.find((x) => hi >= x.min && hi < x.max);
  if (b) b.ratios.push(lo / hi);
}

const pct = (a) => (a * 100).toFixed(1) + '%';
const median = (a) => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

console.log('Agreement between the two reporting sides, by shipment size:\n');
console.log('  size bucket    flows     median agreement   within 10%');
for (const b of buckets) {
  const close = b.ratios.filter((r) => r >= 0.9).length;
  console.log(`  ${b.label.padEnd(12)} ${String(b.ratios.length).padStart(7)}   ${pct(median(b.ratios) ?? 0).padStart(10)}      ${pct(b.ratios.length ? close / b.ratios.length : 0).padStart(8)}`);
}

console.log(`\nAggregate tonnage where both sides reported:`);
console.log(`  importer-reported total: ${(totalImp / 1e6).toFixed(2)}M t`);
console.log(`  exporter-reported total: ${(totalExp / 1e6).toFixed(2)}M t`);
console.log(`  importer/exporter ratio: ${(totalImp / totalExp).toFixed(3)}`);

// Does the gap concentrate in particular years? Early data is often thinner.
const byYear = new Map();
for (let i = 0; i < flows.n; i++) {
  const iq = flows.impQty[i], eq = flows.expQty[i];
  if (iq == null || eq == null) continue;
  const hi = Math.max(iq, eq); if (hi <= 0) continue;
  const y = flows.year[i];
  if (!byYear.has(y)) byYear.set(y, []);
  byYear.get(y).push(Math.min(iq, eq) / hi);
}
console.log(`\nMedian agreement by year (every 6th year):`);
[...byYear.keys()].sort((a, b) => a - b).filter((_, i) => i % 6 === 0)
  .forEach((y) => console.log(`  ${y}: ${pct(median(byYear.get(y)))}  (n=${byYear.get(y).length})`));

console.log(`\nFile sizes:`);
for (const f of ['meta.json', 'flows.json']) {
  const s = fs.statSync(path.join(ROOT, 'data/processed', f));
  console.log(`  ${f}: ${(s.size / 1e6).toFixed(1)} MB`);
}
console.log(`  countries: ${meta.countries.length}, flows: ${flows.n.toLocaleString()}`);
