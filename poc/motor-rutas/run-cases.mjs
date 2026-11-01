// Case runner of the routing-engine PoC (plan: specs/PoC-motor-rutas). T1 only validates the case files
// (`--check`); T4 and T5 add the engines, the metrics and the results. No dependencies: Node >= 24.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const casesDir = join(dirname(fileURLToPath(import.meta.url)), 'cases');

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPoint = (point) =>
  isObject(point) &&
  typeof point.name === 'string' &&
  point.name.length > 0 &&
  Number.isFinite(point.lat) &&
  point.lat >= 41.9 &&
  point.lat <= 43.2 &&
  Number.isFinite(point.lon) &&
  point.lon >= -1.9 &&
  point.lon <= 3.3 &&
  /^(node|way|relation)\/\d+$/.test(point.osm ?? '');

/** Returns the list of problems of a `pairs.json` document (empty when it is valid). */
export function checkPairs(document) {
  const problems = [];
  if (!isObject(document)) return ['the document is not an object'];
  const { thresholds, pairs } = document;
  const numbers = ['minAlternatives', 'maxSharedShare', 'minTrailShare', 'p95Seconds', 'peakMemoryMb'];
  for (const key of numbers) if (!Number.isFinite(thresholds?.[key])) problems.push(`thresholds.${key} is missing`);
  if (!Array.isArray(pairs) || pairs.length !== 3) return [...problems, 'there must be exactly 3 pairs'];
  const ids = new Set();
  for (const pair of pairs) {
    const label = `pair ${pair?.id}`;
    if (typeof pair?.id !== 'string' || ids.has(pair.id)) problems.push(`${label}: id missing or repeated`);
    ids.add(pair?.id);
    for (const key of ['from', 'trailhead', 'to']) if (!isPoint(pair?.[key])) problems.push(`${label}: ${key} is not a valid point`);
    if (typeof pair?.touchesBorder !== 'boolean') problems.push(`${label}: touchesBorder must be true or false`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--check')) {
    console.error('usage: node poc/motor-rutas/run-cases.mjs --check (engines arrive in T2-T5)');
    process.exit(2);
  }
  let failed = false;
  for (const file of readdirSync(casesDir).filter((name) => name.endsWith('.json'))) {
    const problems = file === 'pairs.json' ? checkPairs(JSON.parse(readFileSync(join(casesDir, file), 'utf8'))) : [];
    for (const problem of problems) console.error(`${file}: ${problem}`);
    console.log(`${file}: ${problems.length === 0 ? 'ok' : 'FAILED'}`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
