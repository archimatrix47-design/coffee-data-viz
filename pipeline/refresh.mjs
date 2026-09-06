/**
 * Keeps the dataset current.
 *
 * FAOSTAT publishes coffee trade annually, in bulk releases a few times a year, so
 * "up to date" means noticing a new release rather than polling for live figures --
 * there is no live tick of coffee trade to stream. This checks the published file's
 * Last-Modified/ETag and does the expensive work only when it actually changed.
 *
 * The 420MB archive is streamed through `unzip -p` and filtered in flight, so the
 * 8.5GB CSV inside never lands on disk, and the archive itself is deleted once the
 * coffee rows are out. What survives is the ~168MB coffee extract and the JSON the
 * site serves.
 *
 *   node pipeline/refresh.mjs          # refresh only if FAOSTAT published anew
 *   node pipeline/refresh.mjs --force  # refresh regardless
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const META_DIR = path.join(RAW_DIR, 'meta');
const ZIP = path.join(RAW_DIR, 'TM_normalized.zip');
const CSV = path.join(RAW_DIR, 'coffee_raw.csv');
const MANIFEST = path.join(RAW_DIR, 'source-manifest.json');

const BULK_URL = 'https://bulks-faostat.fao.org/production/Trade_DetailedTradeMatrix_E_All_Data_(Normalized).zip';
const INNER_CSV = 'Trade_DetailedTradeMatrix_E_All_Data_(Normalized).csv';
const META_FILES = [
  'Trade_DetailedTradeMatrix_E_ReporterCountries.csv',
  'Trade_DetailedTradeMatrix_E_PartnerCountries.csv',
  'Trade_DetailedTradeMatrix_E_ItemCodes.csv',
  'Trade_DetailedTradeMatrix_E_Elements.csv',
  'Trade_DetailedTradeMatrix_E_Flags.csv',
];

const force = process.argv.includes('--force');
const log = (...a) => console.log('[refresh]', ...a);

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return null; }
}

async function checkRemote() {
  const res = await fetch(BULK_URL, { method: 'HEAD' });
  if (!res.ok) throw new Error(`HEAD ${BULK_URL} -> ${res.status}`);
  return {
    lastModified: res.headers.get('last-modified'),
    etag: res.headers.get('etag'),
    size: Number(res.headers.get('content-length')),
  };
}

async function download(remote) {
  log(`downloading ${(remote.size / 1e6).toFixed(0)}MB ...`);
  const res = await fetch(BULK_URL);
  if (!res.ok) throw new Error(`GET ${BULK_URL} -> ${res.status}`);

  let seen = 0, lastPct = -10;
  const progress = new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      const pct = Math.floor((seen / remote.size) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  ${pct}%\r`); }
      cb(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(ZIP));
  const got = fs.statSync(ZIP).size;
  if (remote.size && got !== remote.size) {
    throw new Error(`truncated download: got ${got}, expected ${remote.size}`);
  }
  log(`downloaded ${got.toLocaleString()} bytes (matches Content-Length)`);
}

function requireUnzip() {
  return new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-v'], { shell: true });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error('`unzip` not available on PATH')));
  });
}

/**
 * Streams the archive and keeps only coffee rows. Item names in the data carry a
 * comma ("Coffee, green"), so every field is quoted -- matching on `"Coffee` is
 * what actually works here; matching on `,Coffee` silently returns nothing.
 */
async function extractCoffee() {
  log('streaming 8.5GB CSV, keeping coffee rows only ...');
  const out = fs.createWriteStream(CSV);
  const unzip = spawn('unzip', ['-p', ZIP, INNER_CSV], { shell: true, stdio: ['ignore', 'pipe', 'ignore'] });

  let buf = '', kept = 0, seen = 0, headerWritten = false;
  await new Promise((resolve, reject) => {
    unzip.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        seen++;
        if (!headerWritten) { out.write(line + '\n'); headerWritten = true; continue; }
        if (line.includes('"Coffee')) { out.write(line + '\n'); kept++; }
      }
    });
    unzip.stdout.on('end', () => {
      if (buf && buf.includes('"Coffee')) { out.write(buf + '\n'); kept++; }
      out.end(); resolve();
    });
    unzip.on('error', reject);
  });

  log(`scanned ${seen.toLocaleString()} rows, kept ${kept.toLocaleString()} coffee rows`);
  if (kept < 100000) throw new Error(`only ${kept} coffee rows found -- extraction looks wrong, keeping archive for inspection`);
  return kept;
}

async function extractMeta() {
  fs.mkdirSync(META_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-o', ZIP, ...META_FILES.map((f) => `"${f}"`), '-d', `"${META_DIR}"`],
      { shell: true, stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', () => resolve());
  });
  log('extracted lookup tables');
}

function runAggregate() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--max-old-space-size=4096', path.join(ROOT, 'pipeline', 'aggregate.mjs')],
      { stdio: 'inherit' });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`aggregate exited ${code}`)));
  });
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  await requireUnzip();

  const remote = await checkRemote();
  const prev = readManifest();
  const unchanged = prev && prev.lastModified === remote.lastModified && prev.etag === remote.etag;

  if (unchanged && !force && fs.existsSync(CSV)) {
    log(`FAOSTAT unchanged since ${prev.lastModified} -- nothing to do (use --force to rebuild)`);
    return;
  }
  if (unchanged && force) log('unchanged upstream, but --force given');
  else log(`new FAOSTAT release: ${remote.lastModified} (had: ${prev?.lastModified ?? 'nothing'})`);

  try {
    await download(remote);
    await extractMeta();
    const kept = await extractCoffee();

    fs.rmSync(ZIP, { force: true });          // the archive has served its purpose
    log('deleted 420MB archive; kept the coffee extract only');

    fs.writeFileSync(MANIFEST, JSON.stringify({
      ...remote, refreshedAt: new Date().toISOString(), coffeeRows: kept,
    }, null, 2));

    await runAggregate();
    log('done');
  } catch (err) {
    log(`FAILED: ${err.message}`);
    if (fs.existsSync(ZIP)) log(`archive left at ${ZIP} for inspection`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
