import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SYNTHETIC_TILES, syntheticTile } from '../geo/synthetic-dem.js';

// Writes the synthetic DEM (made-up terrain, no real data) used by the end-to-end stack and the tests:
//   pnpm --filter @onway/api synthetic-dem            -> data/seed/dem
const out = resolve(process.argv[2] ?? join('..', '..', 'data', 'seed', 'dem'));
mkdirSync(out, { recursive: true });
for (const { south, west } of SYNTHETIC_TILES) {
  const tile = syntheticTile(south, west);
  writeFileSync(join(out, tile.name), tile.bytes);
  console.log(`${tile.name} ${tile.bytes.length} bytes`);
}
