import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// The `geodata` job is plain Node in infra/ (it runs in its own image). Its logic is tested here against a local server:
// no test reaches the Internet and nothing real is downloaded.
import { downloadVerified, latestBuild, runGeodata, treeHash, type GeodataManifest } from '../../../../infra/geodata/geodata.mjs';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const TILES = ['Tile_A', 'Tile_B', 'Tile_C'].map((name, i) => ({ name, body: Buffer.from(`fictitious dem tile ${name} ${'x'.repeat(100 * (i + 1))}`) }));

let root: string;
let server: Server;
let base: string;
const hits: string[] = [];
const broken = new Set<string>();
let builds: unknown = [];
let assetsArchive: Buffer;
let assetsTree: string;
let pmtilesBin: string;
let pmtilesCalls: string;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  root = mkdtempSync(join(tmpdir(), 'onway-geodata-'));
  // A tiny stand-in for the basemaps-assets repository, packed the way GitHub does (one top folder).
  const repo = join(root, 'repo', 'basemaps-assets-abc');
  for (const file of ['fonts/Noto Sans Regular/0-255.pbf', 'fonts/OFL.txt', 'sprites/v4/light.json', 'fonts/Other Font/0-255.pbf']) {
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), `fictitious ${file}`);
  }
  // The hash the manifest would pin: the included paths only, as they are copied to the volume.
  for (const path of ['fonts/Noto Sans Regular', 'fonts/OFL.txt', 'sprites/v4']) {
    mkdirSync(join(root, 'expected', path, '..'), { recursive: true });
    cpSync(join(repo, path), join(root, 'expected', path), { recursive: true });
  }
  assetsTree = await treeHash(join(root, 'expected'));
  spawnSync('tar', ['-czf', join(root, 'assets.tar.gz'), '-C', join(root, 'repo'), 'basemaps-assets-abc'], { stdio: 'ignore' });
  assetsArchive = readFileSync(join(root, 'assets.tar.gz'));

  pmtilesBin = join(root, 'fake-pmtiles.sh');
  pmtilesCalls = join(root, 'pmtiles-calls.txt');
  // `pmtiles extract <source> <output> --bbox=… --maxzoom=… …`: writes SIZE bytes (env) to the output and records the call.
  writeFileSync(pmtilesBin, `#!/bin/sh\necho "$@" >> "${pmtilesCalls}"\n[ -z "$FAKE_PMTILES_FAIL" ] || exit 3\nhead -c "\${FAKE_PMTILES_SIZE:-2000}" /dev/zero > "$3"\n`);
  chmodSync(pmtilesBin, 0o755);

  server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '').split('?')[0]!);
    hits.push(path);
    const tile = TILES.find((t) => path === `/dem/${t.name}/${t.name}.tif`);
    if (tile) {
      if (broken.has(tile.name)) return void response.writeHead(200).end(Buffer.from('corrupted in transit'));
      return void response.writeHead(200, { 'content-length': tile.body.length }).end(tile.body);
    }
    if (path === '/assets.tar.gz') return void response.writeHead(200).end(assetsArchive);
    if (path === '/builds.json') return void response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(builds));
    response.writeHead(404).end('nope');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((done) => server?.close(done));
  rmSync(root, { recursive: true, force: true });
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(root, 'volume-'));
  hits.length = 0;
  broken.clear();
  delete process.env.FAKE_PMTILES_FAIL;
  delete process.env.FAKE_PMTILES_SIZE;
  rmSync(pmtilesCalls, { force: true });
  builds = [
    { key: '20261029.pmtiles', version: '4.15.2' },
    { key: '20261030.pmtiles', version: '4.15.2' },
    { key: '20261031.pmtiles', version: '5.0.0' },
    { key: '20230918.pmtiles', version: '0.0.0' },
  ];
});

const manifest = (overrides: Partial<GeodataManifest> = {}): GeodataManifest => ({
  maxTotalBytes: 1_000_000,
  dem: { baseUrl: `${base}/dem`, tiles: TILES.map((t) => ({ name: t.name, bytes: t.body.length, sha256: sha(t.body) })) },
  assets: {
    url: `${base}/assets.tar.gz`,
    commit: 'abc',
    maxBytes: 100_000,
    treeSha256: assetsTree,
    include: ['fonts/Noto Sans Regular', 'fonts/OFL.txt', 'sprites/v4'],
  },
  tiles: { index: `${base}/builds.json`, base: `${base}/builds/`, schemaMajor: 4, file: 'pyrenees.pmtiles', bbox: [-2, 42, 4, 44], maxzoom: 14, maxBytes: 10_000 },
  ...overrides,
});

const run = (m = manifest(), extra = {}) => runGeodata(m, { dir, pmtiles: pmtilesBin, retryDelayMs: 0, attempts: 2, ...extra });
const files = (sub: string) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : []);

describe('geodata: the one-shot job that fills the volume (H1 plan, P2)', () => {
  it('downloads the DEM tiles, the fonts and sprites, and the extract; every part checked', async () => {
    const status = await run();
    expect(Object.values(status.components).map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
    expect(files('dem')).toEqual(TILES.map((t) => `${t.name}.tif`));
    for (const t of TILES) expect(readFileSync(join(dir, 'dem', `${t.name}.tif`))).toEqual(t.body);
    // Only what the style needs: the other font of the repository is left out.
    expect(files('basemap/assets/fonts')).toEqual(['Noto Sans Regular', 'OFL.txt']);
    expect(existsSync(join(dir, 'basemap/assets/sprites/v4/light.json'))).toBe(true);
    expect(statSync(join(dir, 'basemap/pyrenees.pmtiles')).size).toBe(2000);
    expect(JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')).components.dem.status).toBe('ok');
    // The extract is asked for the fixed box and zoom, from the newest build of the right tile schema (4.x, not 5.x).
    expect(readFileSync(pmtilesCalls, 'utf8')).toMatch(/extract .*\/builds\/20261030\.pmtiles .*pyrenees\.pmtiles\.part --bbox=-2,42,4,44 --maxzoom=14/);
  });

  it('is idempotent: a second run downloads nothing and does not extract again', async () => {
    await run();
    const hitsBefore = hits.length;
    const callsBefore = readFileSync(pmtilesCalls, 'utf8');
    const status = await run();
    expect(hits).toHaveLength(hitsBefore);
    expect(readFileSync(pmtilesCalls, 'utf8')).toBe(callsBefore);
    expect(status.components.dem).toMatchObject({ status: 'ok', downloaded: 0, tiles: 3 });
    expect(status.components.assets).toMatchObject({ status: 'ok', downloaded: false });
    expect(status.components.tiles).toMatchObject({ status: 'ok', downloaded: false });
  });

  it('downloads again only what is damaged or missing', async () => {
    await run();
    writeFileSync(join(dir, 'dem', 'Tile_B.tif'), 'damaged on disk');
    rmSync(join(dir, 'dem', 'Tile_C.tif'));
    hits.length = 0;
    const status = await run();
    expect(hits.filter((h) => h.startsWith('/dem/')).sort()).toEqual(['/dem/Tile_B/Tile_B.tif', '/dem/Tile_C/Tile_C.tif']);
    expect(status.components.dem).toMatchObject({ status: 'ok', downloaded: 2 });
    expect(readFileSync(join(dir, 'dem', 'Tile_B.tif'))).toEqual(TILES[1]!.body);
  });

  it('refuses a tile whose SHA-256 does not match: nothing is kept, the rest still arrives, and the job does not fail', async () => {
    broken.add('Tile_B');
    const status = await run();
    expect(status.components.dem).toMatchObject({ status: 'degraded', tiles: 2, of: 3 });
    expect(files('dem')).toEqual(['Tile_A.tif', 'Tile_C.tif']);
    expect(status.components.assets?.status).toBe('ok');
    expect(status.components.tiles?.status).toBe('ok');
  });

  it('refuses a download over the size cap without keeping a partial file', async () => {
    await expect(downloadVerified(`${base}/dem/Tile_C/Tile_C.tif`, join(dir, 'out.tif'), { maxBytes: 50 })).rejects.toThrow(/limit/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps inside the total size cap: a DEM that does not fit is not downloaded', async () => {
    const status = await run(manifest(), { maxTotalBytes: 100 });
    expect(status.components.dem).toMatchObject({ status: 'degraded' });
    expect(files('dem')).toEqual([]);
    expect(hits.some((h) => h.startsWith('/dem/'))).toBe(false);
  });

  it('degrades when a source is down and starts the stack anyway (it never throws)', async () => {
    const status = await run(manifest({ dem: { baseUrl: `${base}/missing`, tiles: manifest().dem.tiles } }));
    expect(status.components.dem).toMatchObject({ status: 'degraded', tiles: 0 });
    expect(status.components.assets?.status).toBe('ok');
  });

  it('degrades the extract when pmtiles fails, or when the extract is over its cap, leaving no file behind', async () => {
    process.env.FAKE_PMTILES_FAIL = '1';
    expect((await run()).components.tiles).toMatchObject({ status: 'degraded' });
    expect(files('basemap').filter((f) => f.startsWith('pyrenees'))).toEqual([]);

    delete process.env.FAKE_PMTILES_FAIL;
    process.env.FAKE_PMTILES_SIZE = '20000';
    const status = await run();
    expect(status.components.tiles).toMatchObject({ status: 'degraded', error: expect.stringMatching(/limit/) });
    expect(files('basemap').filter((f) => f.startsWith('pyrenees'))).toEqual([]);
  });

  it('degrades the extract when no build has the tile schema our style reads', async () => {
    builds = [{ key: '20261031.pmtiles', version: '5.0.0' }];
    expect((await run()).components.tiles).toMatchObject({ status: 'degraded', error: expect.stringMatching(/schema 4/) });
  });

  it('rejects fonts and sprites that are not what was pinned', async () => {
    const status = await run(manifest({ assets: { ...manifest().assets, treeSha256: sha('something else') } }));
    expect(status.components.assets).toMatchObject({ status: 'degraded', error: expect.stringMatching(/tree hash/) });
    expect(existsSync(join(dir, 'basemap/assets'))).toBe(false);
  });

  it('leaves out the steps it is told to skip', async () => {
    const status = await run(manifest(), { skip: ['dem', 'tiles'] });
    expect(status.components.dem).toEqual({ status: 'skipped' });
    expect(hits.filter((h) => h.startsWith('/dem/'))).toEqual([]);
    expect(status.components.assets?.status).toBe('ok');
  });

  it('picks the newest build of the right schema', async () => {
    expect(await latestBuild(manifest().tiles, fetch)).toEqual({ key: '20261030.pmtiles', version: '4.15.2' });
  });
});

describe('the committed manifest (infra/geodata/manifest.json)', () => {
  const real = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../infra/geodata/manifest.json'), 'utf8')) as GeodataManifest;

  it('pins every DEM tile of the Pyrenees box (lon -2..4, lat 42..44) with a size and a SHA-256, from the official bucket, within the total cap', () => {
    expect(real.dem.baseUrl).toBe('https://copernicus-dem-30m.s3.amazonaws.com');
    expect(real.dem.tiles).toHaveLength(12);
    for (const tile of real.dem.tiles) {
      expect(tile.name).toMatch(/^Copernicus_DSM_COG_10_N4[23]_00_[WE]00[0-3]_00_DEM$/);
      expect(tile.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(tile.bytes).toBeGreaterThan(1_000_000);
    }
    const total = real.dem.tiles.reduce((sum, t) => sum + t.bytes, 0);
    expect(total + real.tiles.maxBytes).toBeLessThanOrEqual(real.maxTotalBytes);
  });

  it('takes the base map from the official Protomaps builds and the fonts and sprites from a pinned commit of protomaps/basemaps-assets', () => {
    expect(real.tiles.base).toBe('https://build.protomaps.com/');
    expect(real.tiles.index).toBe('https://build-metadata.protomaps.dev/builds.json');
    expect(real.tiles.bbox).toEqual([-2, 42, 4, 44]);
    expect(real.assets.url).toBe(`https://github.com/protomaps/basemaps-assets/archive/${real.assets.commit}.tar.gz`);
    expect(real.assets.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(real.assets.treeSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
