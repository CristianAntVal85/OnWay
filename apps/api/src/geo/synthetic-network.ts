import { syntheticSurface } from './synthetic-elevation.js';

/**
 * The made-up road network of the end-to-end stack and the CI (H3, P2): a lattice of paths over the synthetic terrain, in
 * OSM XML so that the real routing engine reads it like any other extract. Nothing in it is real data.
 *
 * - 19 meridians (lon -0.10 ... 0.08) by 9 parallels (lat 42.62 ... 42.70), every 0.01°.
 * - The southern parallel is a road, the outer meridians are tracks, every other edge is a path
 *   (SAC `hiking` along the parallels, `mountain_hiking` along the meridians).
 * - The meridian lon -0.02 is the made-up "border" of the demonstration; the pass on it is a named node.
 */
export const NETWORK = {
  south: 42.62,
  north: 42.7,
  west: -0.1,
  east: 0.08,
  step: 0.01,
  /** The made-up frontier: a meridian crossed by every east-west edge. */
  border: -0.02,
} as const;

/** Box of the network plus a margin, for `HGT_BBOX` (only that part of the elevation tiles is converted). */
export const NETWORK_BOX = { south: 42.58, west: -0.14, north: 42.74, east: 0.12 } as const;

const round = (value: number): number => Math.round(value * 1e5) / 1e5;

export function syntheticNetworkXml(): string {
  const columns = Math.round((NETWORK.east - NETWORK.west) / NETWORK.step) + 1;
  const rows = Math.round((NETWORK.north - NETWORK.south) / NETWORK.step) + 1;
  const id = (row: number, column: number): number => row * columns + column + 1;
  const lat = (row: number): number => round(NETWORK.south + row * NETWORK.step);
  const lon = (column: number): number => round(NETWORK.west + column * NETWORK.step);

  const lines: string[] = ["<?xml version='1.0' encoding='UTF-8'?>", "<osm version='0.6' generator='onway-synthetic-network'>"];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const isPass = row === 4 && Math.abs(lon(column) - NETWORK.border) < 1e-9;
      const ele = Math.round(syntheticSurface(lat(row), lon(column)));
      lines.push(
        isPass
          ? `  <node id='${id(row, column)}' lat='${lat(row)}' lon='${lon(column)}'><tag k='name' v='Collado ficticio de la frontera'/><tag k='mountain_pass' v='yes'/><tag k='ele' v='${ele}'/></node>`
          : `  <node id='${id(row, column)}' lat='${lat(row)}' lon='${lon(column)}'/>`,
      );
    }
  }

  let way = 100000;
  const edge = (a: number, b: number, tags: Record<string, string>): void => {
    way += 1;
    const body = Object.entries(tags)
      .map(([key, value]) => `<tag k='${key}' v='${value}'/>`)
      .join('');
    lines.push(`  <way id='${way}'><nd ref='${a}'/><nd ref='${b}'/>${body}</way>`);
  };
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns - 1; column++) {
      edge(id(row, column), id(row, column + 1), row === 0 ? { highway: 'unclassified', surface: 'asphalt' } : { highway: 'path', sac_scale: 'hiking' });
    }
  }
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows - 1; row++) {
      const outer = column === 0 || column === columns - 1;
      edge(id(row, column), id(row + 1, column), outer ? { highway: 'track', tracktype: 'grade2' } : { highway: 'path', sac_scale: 'mountain_hiking' });
    }
  }
  lines.push('</osm>');
  return `${lines.join('\n')}\n`;
}
