/**
 * Assemble the directory Netlify publishes.
 *
 * The server refuses to serve the study harness, the reference viewer and the traced
 * reference art in production, but on Netlify the static files never touch the server: they
 * are handed straight to the CDN. A server-side guard cannot protect a file the CDN is
 * serving on its own, so the only way to keep those off a public URL is to not deploy them.
 *
 * Copying to dist/ rather than publishing web/ directly is what makes that possible, and it
 * keeps `npm run dev` serving the full set locally.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'dist');

/** Local-only. Kept in the repo, kept off the internet. */
const EXCLUDE = new Set([
  'dial-study.html',
  'ref.html',
  'vendor/reference-dial.svg',
  'src',                        // esbuild input for the vendor bundle, not a served asset
]);

function copy(from, to, rel = '') {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const key = rel ? `${rel}/${entry.name}` : entry.name;
    if (EXCLUDE.has(key)) { console.log(`  skipped ${key}`); continue; }
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copy(a, b, key);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
console.log('building dist/ from web/');
copy(SRC, OUT);

// The data has to travel with the function, not the CDN: it is 12MB and only the API reads
// it. netlify.toml's included_files handles that; this is only a check that it exists, so a
// deploy fails loudly at build time rather than quietly at the first request.
const flows = path.join(ROOT, 'data', 'processed', 'flows.json');
if (!fs.existsSync(flows)) {
  console.error(`\nMissing ${path.relative(ROOT, flows)}. Run: npm run refresh`);
  process.exit(1);
}
const mb = (fs.statSync(flows).size / 1e6).toFixed(1);
const files = fs.readdirSync(OUT, { recursive: true }).filter((f) => !fs.statSync(path.join(OUT, f)).isDirectory());
console.log(`\ndist/: ${files.length} files`);
console.log(`data:  flows.json ${mb}MB travels with the function`);
