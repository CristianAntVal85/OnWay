import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DemElevationProvider } from '../geo/dem-elevation.js';
import { buildHgtTile, hgtTileName } from '../geo/hgt.js';

// Converts OnWay's elevation model (Copernicus GLO-30 tiles, or the synthetic ones of the E2E) into the tiles the routing
// engine reads, so that it sees the same ground the server measures with (H3 D-H3-02).
//   ELEVATION_DEM_DIR=<tiles> node dist/src/cli/build-hgt.js <output directory>
// Optional: HGT_TILES=N42W001,N42E000 converts only those tiles; HGT_BBOX=south,west,north,east fills only that box of each
// tile (the E2E network is a few kilometres wide: a whole tile would be 46 s of wasted work).
const input = process.env.ELEVATION_DEM_DIR;
const output = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!input || !output) {
  console.error('usage: ELEVATION_DEM_DIR=<GLO-30 tiles> build-hgt <output directory>');
  process.exit(2);
}

/** `Copernicus_DSM_COG_10_N42_00_W001_00_DEM.tif` -> south 42, west -1. */
const TILE = /^Copernicus_DSM_COG_10_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM\.tif$/;
const tiles = readdirSync(input)
  .map((name) => TILE.exec(name))
  .filter((match): match is RegExpExecArray => match !== null)
  .map((match) => ({ file: match[0], south: (match[1] === 'S' ? -1 : 1) * Number(match[2]), west: (match[3] === 'W' ? -1 : 1) * Number(match[4]) }));
const only = process.env.HGT_TILES?.split(',').map((name) => name.trim().toUpperCase());
const selected = only ? tiles.filter(({ south, west }) => only.includes(hgtTileName(south, west).replace('.hgt.gz', ''))) : tiles;
const bbox = process.env.HGT_BBOX?.split(',').map(Number);
if (bbox && (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value)))) {
  console.error('HGT_BBOX must be south,west,north,east in degrees');
  process.exit(2);
}
const region = bbox ? { south: bbox[0]!, west: bbox[1]!, north: bbox[2]!, east: bbox[3]! } : undefined;
if (selected.length === 0) {
  console.error(`no GLO-30 tiles to convert in ${input}`);
  process.exit(1);
}

mkdirSync(output, { recursive: true });
const provider = new DemElevationProvider(input);
for (const { file, south, west } of selected) {
  const target = join(output, hgtTileName(south, west));
  // Idempotent: a tile that is newer than its source is kept (the volume survives restarts).
  if (existsSync(target) && statSync(target).mtimeMs > statSync(join(input, file)).mtimeMs) {
    console.log(`${hgtTileName(south, west)} up to date`);
    continue;
  }
  const started = Date.now();
  const raw = await buildHgtTile(provider, south, west, { region });
  writeFileSync(`${target}.part`, gzipSync(raw, { level: 6 }));
  renameSync(`${target}.part`, target);
  console.log(`${hgtTileName(south, west)} written in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
