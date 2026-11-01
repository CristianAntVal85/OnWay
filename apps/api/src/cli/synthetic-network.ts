import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { syntheticNetworkXml } from '../geo/synthetic-network.js';

// Writes the made-up road network (no real data) used by the end-to-end stack and the CI:
//   pnpm --filter @onway/api synthetic-network        -> data/seed/network.osm
const out = resolve(process.argv[2] ?? join('..', '..', 'data', 'seed', 'network.osm'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, syntheticNetworkXml());
console.log(`${out} written`);
