// geodata: one-shot job that fills the `geodata` volume (H1 plan, P2). Plain Node, no dependencies.
//
//   dem/       Copernicus GLO-30 tiles of a fixed box of the Pyrenees (read by the `api` and `seed`)
//   basemap/   PMTiles extract of the same box, plus the fonts and sprites of its style (served by the `web`)
//   status.json  what was done, for a person reading it
//
// Rules: idempotent (a second run downloads nothing); DEM tiles and the fonts/sprites are checked against SHA-256 values pinned in
// manifest.json, the PMTiles extract (the build is chosen at run time) against a size cap and the hash recorded when it was made; a
// total size cap; and it NEVER makes the stack fail: whatever cannot be fetched is reported and
// left out, and the application degrades (no base map, or `OUTSIDE_COVERAGE`). Nothing here runs in CI or in the
// end-to-end tests: they use the synthetic DEM (data/seed/dem).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** SHA-256 of a file, streamed. */
export async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** SHA-256 over the sorted list of `relative path NUL file hash` of a folder: it does not depend on how an archive was compressed. */
export async function treeHash(dir) {
  const lines = [];
  const walk = async (current, prefix) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`);
      else if (entry.isFile()) lines.push(`${prefix}${entry.name}\0${await sha256File(path)}\n`);
    }
  };
  await walk(dir, '');
  return createHash('sha256').update(lines.join('')).digest('hex');
}

async function exists(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/** Downloads `url` to `dest` through a `.part` file, refusing anything over `maxBytes` and anything whose hash is not `sha256`. */
export async function downloadVerified(url, dest, { sha256, maxBytes, fetchImpl = fetch, timeoutMs = 600_000 }) {
  const part = `${dest}.part`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${url} is ${declared} bytes, over the limit of ${maxBytes}`);
  const hash = createHash('sha256');
  let received = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (source) {
        for await (const chunk of source) {
          received += chunk.length;
          if (received > maxBytes) throw new Error(`${url} passed the limit of ${maxBytes} bytes`);
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(part),
    );
    const actual = hash.digest('hex');
    if (sha256 && actual !== sha256) throw new Error(`${url}: SHA-256 is ${actual}, expected ${sha256}`);
    await rename(part, dest);
    return { bytes: received, sha256: actual };
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}

async function withRetries(attempts, delayMs, task) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      last = error;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw last;
}

// ---------- DEM ----------
async function fetchDem(manifest, ctx) {
  const dir = join(ctx.dir, 'dem');
  await mkdir(dir, { recursive: true });
  const expectedTotal = manifest.dem.tiles.reduce((sum, tile) => sum + tile.bytes, 0);
  if (expectedTotal > ctx.budget.remaining) throw new Error(`DEM needs ${expectedTotal} bytes, over the remaining budget of ${ctx.budget.remaining}`);
  const failed = [];
  let downloaded = 0;
  let present = 0;
  let next = 0;
  const worker = async () => {
    while (next < manifest.dem.tiles.length) {
      const tile = manifest.dem.tiles[next++];
      const dest = join(dir, `${tile.name}.tif`);
      const current = await exists(dest);
      if (current && current.size === tile.bytes && (await sha256File(dest)) === tile.sha256) {
        present += 1;
        continue;
      }
      await rm(dest, { force: true });
      try {
        await withRetries(ctx.attempts, ctx.retryDelayMs, () =>
          downloadVerified(`${manifest.dem.baseUrl}/${tile.name}/${tile.name}.tif`, dest, { sha256: tile.sha256, maxBytes: tile.bytes, fetchImpl: ctx.fetchImpl }),
        );
        downloaded += 1;
      } catch (error) {
        failed.push(`${tile.name}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ctx.concurrency, manifest.dem.tiles.length) }, worker));
  ctx.budget.remaining -= expectedTotal;
  const summary = { tiles: present + downloaded, of: manifest.dem.tiles.length, downloaded, bytes: expectedTotal };
  return failed.length > 0 ? { status: 'degraded', ...summary, failed } : { status: 'ok', ...summary };
}

// ---------- Fonts and sprites of the base map ----------
async function run(command, args, { timeoutMs = 600_000, onSpawn } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    onSpawn?.(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(undefined);
      else reject(new Error(`${command} ended with ${signal ?? `code ${code}`}`));
    });
  });
}

async function fetchAssets(manifest, ctx) {
  const target = join(ctx.dir, 'basemap', 'assets');
  const spec = manifest.assets;
  if ((await exists(target)) && (await treeHash(target)) === spec.treeSha256) return { status: 'ok', downloaded: false, commit: spec.commit };

  const work = await mkdtemp(join(ctx.dir, '.assets-'));
  try {
    const archive = join(work, 'assets.tar.gz');
    await withRetries(ctx.attempts, ctx.retryDelayMs, () => downloadVerified(spec.url, archive, { maxBytes: Math.min(spec.maxBytes, ctx.budget.remaining), fetchImpl: ctx.fetchImpl }));
    const unpacked = join(work, 'unpacked');
    await mkdir(unpacked);
    await run(ctx.tar, ['-xzf', archive, '-C', unpacked]);
    const [root] = await readdir(unpacked);
    if (!root) throw new Error('the assets archive is empty');
    const staged = join(work, 'staged');
    for (const path of spec.include) {
      await mkdir(dirname(join(staged, path)), { recursive: true });
      await cp(join(unpacked, root, path), join(staged, path), { recursive: true });
    }
    const actual = await treeHash(staged);
    if (actual !== spec.treeSha256) throw new Error(`assets tree hash is ${actual}, expected ${spec.treeSha256}`);
    await mkdir(dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(staged, target);
    return { status: 'ok', downloaded: true, commit: spec.commit };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ---------- PMTiles extract ----------
/** The newest daily Protomaps build whose tile schema is the one our style library reads. */
export async function latestBuild(spec, fetchImpl) {
  const response = await fetchImpl(spec.index, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${spec.index} answered ${response.status}`);
  const builds = await response.json();
  if (!Array.isArray(builds)) throw new Error('the Protomaps build index is not a list');
  const usable = builds
    .filter((b) => typeof b?.key === 'string' && /^\d{8}\.pmtiles$/.test(b.key) && String(b.version).split('.')[0] === String(spec.schemaMajor))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const newest = usable.at(-1);
  if (!newest) throw new Error(`no Protomaps build has tile schema ${spec.schemaMajor}`);
  return { key: newest.key, version: newest.version };
}

async function fetchTiles(manifest, ctx) {
  const spec = manifest.tiles;
  const dest = join(ctx.dir, 'basemap', spec.file);
  await mkdir(dirname(dest), { recursive: true });
  const record = ctx.previous?.tiles;
  const current = await exists(dest);
  // Made once and kept: the daily build is not re-extracted each day. A file that no longer matches its recorded hash is made again.
  if (current && record?.status === 'ok' && record.bytes === current.size && (await sha256File(dest)) === record.sha256) {
    return { ...record, downloaded: false };
  }

  const build = await latestBuild(spec, ctx.fetchImpl);
  const source = `${spec.base}${build.key}`;
  const cap = Math.min(spec.maxBytes, ctx.budget.remaining);
  const part = `${dest}.part`;
  await rm(part, { force: true });
  let killed = false;
  const watcher = { timer: undefined };
  try {
    await run(ctx.pmtiles, ['extract', source, part, `--bbox=${spec.bbox.join(',')}`, `--maxzoom=${spec.maxzoom}`, '--download-threads=4'], {
      timeoutMs: ctx.tilesTimeoutMs,
      onSpawn: (child) => {
        watcher.timer = setInterval(async () => {
          const written = await exists(part);
          if (written && written.size > cap) {
            killed = true;
            child.kill('SIGKILL');
          }
        }, 2000);
      },
    });
  } catch (error) {
    await rm(part, { force: true });
    throw killed ? new Error(`the extract passed the limit of ${cap} bytes`) : error;
  } finally {
    clearInterval(watcher.timer);
  }

  const written = await exists(part);
  if (!written) throw new Error('pmtiles produced no file');
  if (written.size > cap) {
    await rm(part, { force: true });
    throw new Error(`the extract is ${written.size} bytes, over the limit of ${cap}`);
  }
  const actual = await sha256File(part);
  await rename(part, dest);
  ctx.budget.remaining -= written.size;
  return { status: 'ok', downloaded: true, build: build.key, version: build.version, bbox: spec.bbox, maxzoom: spec.maxzoom, bytes: written.size, sha256: actual };
}

const STEPS = { dem: fetchDem, assets: fetchAssets, tiles: fetchTiles };

/**
 * Runs every step; one failing never stops the others and nothing here throws. Returns the status that is also written to
 * `status.json`. `skip` lists steps to leave out (`GEODATA_SKIP`).
 */
export async function runGeodata(manifest, options = {}) {
  const ctx = {
    dir: options.dir ?? '/geodata',
    fetchImpl: options.fetchImpl ?? fetch,
    tar: options.tar ?? 'tar',
    pmtiles: options.pmtiles ?? 'pmtiles',
    attempts: options.attempts ?? 3,
    retryDelayMs: options.retryDelayMs ?? 5000,
    concurrency: options.concurrency ?? 3,
    tilesTimeoutMs: options.tilesTimeoutMs ?? 30 * 60_000,
    budget: { remaining: options.maxTotalBytes ?? manifest.maxTotalBytes },
    previous: undefined,
  };
  await mkdir(ctx.dir, { recursive: true });
  const statusFile = join(ctx.dir, 'status.json');
  try {
    ctx.previous = JSON.parse(await readFile(statusFile, 'utf8')).components;
  } catch {
    ctx.previous = undefined;
  }
  const components = {};
  for (const [name, step] of Object.entries(STEPS)) {
    if ((options.skip ?? []).includes(name)) {
      components[name] = { status: 'skipped' };
      continue;
    }
    const started = Date.now();
    try {
      components[name] = { ...(await step(manifest, ctx)), seconds: Math.round((Date.now() - started) / 1000) };
    } catch (error) {
      components[name] = { status: 'degraded', error: error instanceof Error ? error.message : String(error), seconds: Math.round((Date.now() - started) / 1000) };
    }
    console.log(`geodata ${name}: ${JSON.stringify(components[name])}`);
  }
  const status = { updatedAt: new Date().toISOString(), components };
  await writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`);
  return status;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(await readFile(process.env.GEODATA_MANIFEST ?? join(here, 'manifest.json'), 'utf8'));
  const status = await runGeodata(manifest, {
    dir: process.env.GEODATA_DIR ?? '/geodata',
    pmtiles: process.env.PMTILES_BIN ?? 'pmtiles',
    skip: (process.env.GEODATA_SKIP ?? '').split(',').filter(Boolean),
    ...(process.env.GEODATA_MAX_BYTES ? { maxTotalBytes: Number(process.env.GEODATA_MAX_BYTES) } : {}),
  });
  const degraded = Object.entries(status.components).filter(([, c]) => c.status === 'degraded');
  if (degraded.length > 0) console.warn(`geodata finished with ${degraded.length} part(s) missing (${degraded.map(([n]) => n).join(', ')}): the stack starts without them`);
  else console.log('geodata ready');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Even a broken manifest must not stop the stack from starting.
    console.error('geodata could not run:', error);
  });
}
