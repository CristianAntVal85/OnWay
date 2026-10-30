// Genera gen/client.ts a partir del registro. Uso: tsx scripts/gen-client.ts [salida]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ENDPOINTS } from '../src/index.js';
import { renderClient } from './client-source.js';

const out = process.argv[2] ?? 'gen/client.ts';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderClient());
console.log(`Cliente: ${ENDPOINTS.length} operaciones → ${out}`);
