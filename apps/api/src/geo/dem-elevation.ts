import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fromFile, type GeoTIFFImage } from 'geotiff';
import type { ElevationProvider, GroundPoint } from './elevation.js';

/** Name of the Copernicus GLO-30 tile that holds a point: `Copernicus_DSM_COG_10_N42_00_E000_00_DEM.tif` (1° x 1°, named by its south-west corner). */
export function demTileName(lat: number, lon: number): string {
  const south = Math.floor(lat);
  const west = Math.floor(lon);
  const ns = `${south >= 0 ? 'N' : 'S'}${String(Math.abs(south)).padStart(2, '0')}`;
  const ew = `${west >= 0 ? 'E' : 'W'}${String(Math.abs(west)).padStart(3, '0')}`;
  return `Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM.tif`;
}

interface Tile {
  image: GeoTIFFImage;
  width: number;
  height: number;
  /** Position of the centre of the first pixel when the file is `PixelIsPoint` (GLO-30 is), of its corner otherwise. */
  originX: number;
  originY: number;
  stepX: number;
  stepY: number;
  /** `PixelIsPoint` (GTRasterTypeGeoKey = 2): the stored positions are sample points, not pixel corners. */
  pointRaster: boolean;
  noData: number | null;
}

/** Runs at most `limit` tasks at once; the rest wait their turn. */
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

/**
 * `ElevationProvider` over Copernicus GLO-30 tiles in a folder (doc 04 §5.2, R-15: it is a surface model, trees included).
 * One point reads a 2x2 window of its tile and many points read blocks (a cloud-optimised GeoTIFF is never loaded whole);
 * both interpolate bilinearly. A tile that is not in the folder (outside the downloaded box, or sea) answers `null`.
 * Reading is serialised to `concurrency` at once so that the memory of the `api` service stays bounded.
 */
export class DemElevationProvider implements ElevationProvider {
  private readonly tiles = new Map<string, Promise<Tile>>();
  private readonly gate: Gate;

  constructor(
    private readonly directory: string,
    concurrency = 2,
    private readonly blockSize = BLOCK,
  ) {
    this.gate = new Gate(concurrency);
  }

  async elevationAt({ lat, lon }: GroundPoint): Promise<number | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const file = join(this.directory, demTileName(lat, lon));
    try {
      await stat(file);
    } catch {
      return null;
    }
    const tile = await this.open(file);
    return this.sample(tile, lat, lon);
  }

  private open(file: string): Promise<Tile> {
    let tile = this.tiles.get(file);
    if (!tile) {
      tile = this.load(file);
      this.tiles.set(file, tile);
      tile.catch(() => this.tiles.delete(file));
    }
    return tile;
  }

  private async load(file: string): Promise<Tile> {
    const tiff = await fromFile(file);
    const image = await tiff.getImage(0);
    const [originX, originY] = image.getOrigin();
    const [stepX, stepY] = image.getResolution();
    if (originX === undefined || originY === undefined || stepX === undefined || stepY === undefined) throw new Error(`${file} has no georeference`);
    return {
      image,
      width: image.getWidth(),
      height: image.getHeight(),
      originX,
      originY,
      stepX,
      stepY,
      pointRaster: image.getGeoKeys()?.GTRasterTypeGeoKey === 2,
      noData: image.getGDALNoData(),
    };
  }

  private async sample(tile: Tile, lat: number, lon: number): Promise<number | null> {
    const cell = locate(tile, lat, lon);
    if (!cell) return null;
    const window: [number, number, number, number] = [cell.x0, cell.y0, cell.x1 + 1, cell.y1 + 1];
    const band = await this.read(tile, window);
    if (!band) return null;
    const columns = cell.x1 + 1 - cell.x0;
    return interpolate(tile, cell, (x, y) => band[(y - cell.y0) * columns + (x - cell.x0)] as number);
  }

  /**
   * Many points (D-H2-02): grouped by tile, then by block of `BLOCK` pixels (plus the one pixel that closes it), each block
   * read once however many points fall in it. A line of 20 000 vertices touches a few dozen blocks, not 20 000 windows.
   * The answer for a point is the same as `elevationAt` would give.
   */
  async elevationsAt(points: readonly GroundPoint[]): Promise<(number | null)[]> {
    const result: (number | null)[] = points.map(() => null);
    const byTile = new Map<string, number[]>();
    points.forEach(({ lat, lon }, index) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const file = join(this.directory, demTileName(lat, lon));
      const group = byTile.get(file);
      if (group) group.push(index);
      else byTile.set(file, [index]);
    });

    for (const [file, indexes] of byTile) {
      try {
        await stat(file);
      } catch {
        continue;
      }
      const tile = await this.open(file);
      const blocks = new Map<string, { window: [number, number, number, number]; cells: { index: number; cell: Cell }[] }>();
      for (const index of indexes) {
        const cell = locate(tile, points[index]!.lat, points[index]!.lon);
        if (!cell) continue;
        const bx = Math.floor(cell.x0 / this.blockSize);
        const by = Math.floor(cell.y0 / this.blockSize);
        const key = `${bx},${by}`;
        let block = blocks.get(key);
        if (!block) {
          block = { window: [bx * this.blockSize, by * this.blockSize, Math.min((bx + 1) * this.blockSize + 1, tile.width), Math.min((by + 1) * this.blockSize + 1, tile.height)], cells: [] };
          blocks.set(key, block);
        }
        block.cells.push({ index, cell });
      }
      await Promise.all(
        [...blocks.values()].map(async ({ window, cells }) => {
          const band = await this.read(tile, window);
          if (!band) return;
          const columns = window[2] - window[0];
          for (const { index, cell } of cells) result[index] = interpolate(tile, cell, (x, y) => band[(y - window[1]) * columns + (x - window[0])] as number);
        }),
      );
    }
    return result;
  }

  /** One window of the first band, serialised with the gate so that the memory of the `api` stays bounded. */
  private read(tile: Tile, window: [number, number, number, number]): Promise<ArrayLike<number> | undefined> {
    return this.gate.run(async () => {
      const bands = (await tile.image.readRasters({ window, samples: [0], interleave: false })) as unknown as ArrayLike<number>[];
      return bands[0];
    });
  }
}

/** Pixels per side of the blocks `elevationsAt` reads (the COG of GLO-30 stores 1 024-pixel tiles: a block is a fraction of one). */
const BLOCK = 256;

/** The 2x2 pixels around a point and the weights between them. */
interface Cell {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  wx: number;
  wy: number;
}

function locate(tile: Tile, lat: number, lon: number): Cell | null {
  // Continuous pixel coordinates in which an integer is the centre of a pixel.
  const shift = tile.pointRaster ? 0 : 0.5;
  const fx = (lon - tile.originX) / tile.stepX - shift;
  const fy = (lat - tile.originY) / tile.stepY - shift;
  if (fx < -1 || fy < -1 || fx > tile.width || fy > tile.height) return null;
  const x0 = Math.min(Math.max(Math.floor(fx), 0), tile.width - 1);
  const y0 = Math.min(Math.max(Math.floor(fy), 0), tile.height - 1);
  return { x0, y0, x1: Math.min(x0 + 1, tile.width - 1), y1: Math.min(y0 + 1, tile.height - 1), wx: Math.min(Math.max(fx - x0, 0), 1), wy: Math.min(Math.max(fy - y0, 0), 1) };
}

function interpolate(tile: Tile, { x0, y0, x1, y1, wx, wy }: Cell, at: (x: number, y: number) => number): number | null {
  const values = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
  if (values.some((v) => !Number.isFinite(v) || (tile.noData !== null && v === tile.noData))) return null;
  const top = values[0]! * (1 - wx) + values[1]! * wx;
  const bottom = values[2]! * (1 - wx) + values[3]! * wx;
  return Math.round((top * (1 - wy) + bottom * wy) * 10) / 10;
}
