// Case runner of the routing-engine PoC (plan: specs/PoC-motor-rutas). No dependencies: Node >= 24.
//   node poc/motor-rutas/run-cases.mjs --check
//   node poc/motor-rutas/run-cases.mjs --engine graphhopper [--runs 10] [--url http://127.0.0.1:8989] [--container onway-poc-graphhopper-1] [--out results/graphhopper.json]
// T4 measures criteria 1, 2, 4, 5 and 8; T5 adds 3, 6 and 7.
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as graphhopper from './lib/graphhopper.mjs';
import { parseMemUsageMiB, percentile, sharedShare } from './lib/metrics.mjs';

const run = promisify(execFile);
const engines = { graphhopper };

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

const argOf = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};

/** Samples the container's memory once a second until `stop()`; returns the peak in MiB. */
function watchMemory(container) {
  let peak = 0;
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        const { stdout } = await run('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', container]);
        const mib = parseMemUsageMiB(stdout);
        if (Number.isFinite(mib)) peak = Math.max(peak, mib);
      } catch {
        // the container may be gone: the peak so far stands
      }
    }
  })();
  return async () => {
    stopped = true;
    await loop;
    return Math.round(peak);
  };
}

const check = (value, pass) => ({ value, pass });

/** Criteria of one pair from the paths of the first query and the timings of all of them. */
export function evaluatePair(paths, secondsList, thresholds) {
  const main = paths[0];
  const shares = paths.slice(1).map((path) => sharedShare(path.coords, main.coords));
  const trail = main ? main.mix.track + main.mix.path : 0;
  const unknown = Math.max(0, ...paths.map((path) => path.mix.unknown));
  const p95 = percentile(secondsList, 95);
  return {
    1: check(
      { alternatives: paths.length, sharedWithMain: shares.map((share) => Number(share.toFixed(2))) },
      paths.length >= thresholds.minAlternatives && shares.every((share) => share <= thresholds.maxSharedShare),
    ),
    2: check(Number(trail.toFixed(3)), trail >= thresholds.minTrailShare),
    4: check(Number(p95.toFixed(2)), p95 <= thresholds.p95Seconds),
    8: check(Number(unknown.toFixed(3)), unknown <= 0.02),
  };
}

async function measure(engineName) {
  const engine = engines[engineName];
  if (!engine) throw new Error(`unknown engine ${engineName} (known: ${Object.keys(engines).join(', ')})`);
  const url = argOf('url', 'http://127.0.0.1:8989');
  const container = argOf('container', 'onway-poc-graphhopper-1');
  const runs = Number(argOf('runs', '10'));
  const { pairs, thresholds, extract } = JSON.parse(readFileSync(join(casesDir, 'pairs.json'), 'utf8'));

  const stopWatching = watchMemory(container);
  const results = [];
  for (const pair of pairs) {
    await engine.route({ url, from: pair.from, to: pair.to }); // warm-up, not counted
    const seconds = [];
    let first;
    for (let i = 0; i < runs; i++) {
      const answer = await engine.route({ url, from: pair.from, to: pair.to });
      seconds.push(answer.ms / 1000);
      first ??= answer;
    }
    if (first.paths.length === 0) {
      results.push({ id: pair.id, error: first.error ?? 'no route', criteria: {} });
      continue;
    }
    results.push({
      id: pair.id,
      paths: first.paths.map((path) => ({
        distanceKm: Number((path.distanceM / 1000).toFixed(2)),
        timeH: Number((path.timeS / 3600).toFixed(2)),
        ascentM: Math.round(path.ascentM),
        descentM: Math.round(path.descentM),
        mix: Object.fromEntries(Object.entries(path.mix).map(([key, share]) => [key, Number(share.toFixed(3))])),
      })),
      seconds: { p50: Number(percentile(seconds, 50).toFixed(3)), p95: Number(percentile(seconds, 95).toFixed(3)), max: Number(Math.max(...seconds).toFixed(3)) },
      criteria: evaluatePair(first.paths, seconds, thresholds),
    });
  }
  const peakMiB = await stopWatching();
  const memory = check(peakMiB, peakMiB <= thresholds.peakMemoryMb);
  return { engine: engineName, date: new Date().toISOString(), extract, thresholds, alternatives: engine.ALTERNATIVES, runs, peakMemoryMiB: memory, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    let failed = false;
    for (const file of readdirSync(casesDir).filter((name) => name.endsWith('.json'))) {
      const problems = file === 'pairs.json' ? checkPairs(JSON.parse(readFileSync(join(casesDir, file), 'utf8'))) : [];
      for (const problem of problems) console.error(`${file}: ${problem}`);
      console.log(`${file}: ${problems.length === 0 ? 'ok' : 'FAILED'}`);
      failed ||= problems.length > 0;
    }
    process.exit(failed ? 1 : 0);
  }
  const engineName = argOf('engine');
  if (!engineName) {
    console.error('usage: node poc/motor-rutas/run-cases.mjs --check | --engine graphhopper [--runs 10] [--out results/graphhopper.json]');
    process.exit(2);
  }
  const report = await measure(engineName);
  const mark = (criterion) => (criterion ? (criterion.pass ? 'PASS' : 'FAIL') : '  - ');
  console.log(`\n${engineName}  runs=${report.runs}  peak memory ${report.peakMemoryMiB.value} MiB (${mark(report.peakMemoryMiB)})`);
  console.log('pair'.padEnd(20), ['c1', 'c2', 'c4', 'c8'].map((c) => c.padEnd(6)).join(''), 'paths  p95 s');
  for (const result of report.results) {
    console.log(result.id.padEnd(20), [1, 2, 4, 8].map((c) => mark(result.criteria[c]).padEnd(6)).join(''), String(result.paths?.length ?? 0).padEnd(6), result.seconds?.p95 ?? result.error);
  }
  const out = join(dirname(fileURLToPath(import.meta.url)), argOf('out', `results/${engineName}.json`));
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`written ${out}`);
}
