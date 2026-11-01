// Case runner of the routing-engine PoC (plan: specs/PoC-motor-rutas). No dependencies: Node >= 24.
//   node poc/motor-rutas/run-cases.mjs --check
//   node poc/motor-rutas/run-cases.mjs --engine graphhopper|valhalla [--runs 10] [--pairs extra-france.json] [--url http://127.0.0.1:8989] [--container onway-poc-graphhopper-1] [--out results/graphhopper.json]
// Criteria: 1 alternatives, 2 trails, 3 slope limit (probe), 4 time, 5 memory, 6 zone to avoid, 7 snap to the network, 8 road mix.
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as graphhopper from './lib/graphhopper.mjs';
import * as valhalla from './lib/valhalla.mjs';
import { keepsOrder, parseMemUsageMiB, percentile, pointsInsideSquare, resample, roughDrawing, sharedShare, squareRing } from './lib/metrics.mjs';

const run = promisify(execFile);
const engines = { graphhopper, valhalla };

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
export function checkPairs(document, expectedPairs = 3) {
  const problems = [];
  if (!isObject(document)) return ['the document is not an object'];
  const { thresholds, pairs } = document;
  const numbers = ['minAlternatives', 'maxSharedShare', 'minTrailShare', 'p95Seconds', 'peakMemoryMb'];
  for (const key of numbers) if (!Number.isFinite(thresholds?.[key])) problems.push(`thresholds.${key} is missing`);
  if (!Array.isArray(pairs) || pairs.length !== expectedPairs) return [...problems, `there must be exactly ${expectedPairs} pairs`];
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

/** Problems of `slope-probe.json`. */
export function checkProbe(document) {
  const problems = [];
  if (!isPoint(document?.from)) problems.push('from is not a valid point');
  if (!isPoint(document?.to)) problems.push('to is not a valid point');
  if (!(document?.limitPct > 0)) problems.push('limitPct must be positive');
  if (!(document?.maxSlopeRatio > 0 && document.maxSlopeRatio < 1)) problems.push('maxSlopeRatio must be between 0 and 1');
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
      { alternatives: paths.length, sources: paths.map((path) => path.source), sharedWithMain: shares.map((share) => Number(share.toFixed(2))) },
      paths.length >= thresholds.minAlternatives && shares.every((share) => share <= thresholds.maxSharedShare),
    ),
    2: check(Number(trail.toFixed(3)), trail >= thresholds.minTrailShare),
    4: check(Number(p95.toFixed(2)), p95 <= thresholds.p95Seconds),
    8: check(Number(unknown.toFixed(3)), unknown <= 0.02),
  };
}

const SLOPE_LIMIT_FOR_INFO_PCT = 25;

/** Criteria 6 (zone to avoid) and 7 (snap a rough drawing) of one pair, and the informative slope effect for criterion 3. */
async function capabilities(engine, url, pair, main, ours) {
  const out = {};
  // 6: a 200 m square over the middle of the main route; the new route must not cross it (or the engine must say there is no way).
  const middle = resample(main.coords, 10);
  const ring = squareRing(middle[Math.floor(middle.length / 2)], 100);
  const avoided = await engine.route({ url, from: pair.from, to: pair.to, customModel: engine.avoidModel(ring) });
  if (avoided.paths.length === 0) {
    // Only a clean "no way" counts; any other failure of the engine is a FAIL.
    const clean = engine.isNoRoute(avoided.error);
    out[6] = check({ outcome: clean ? 'no_route' : 'error', message: avoided.error ?? null }, clean);
  } else {
    const inside = pointsInsideSquare(avoided.paths[0].coords, ring, 5);
    out[6] = check({ outcome: inside === 0 ? 'avoided' : 'crossed', pointsInside: inside, detourKm: Number(((avoided.paths[0].distanceM - main.distanceM) / 1000).toFixed(2)) }, inside === 0);
  }
  // 7: a rough drawing of the main route (about 25 m off the trail) must come back on the network, in order.
  const drawing = roughDrawing(main.coords);
  const snapped = await engine.match({ url, points: drawing });
  if (snapped.coords.length === 0) out[7] = check({ error: snapped.error }, false);
  else {
    const onNetwork = sharedShare(snapped.coords, main.coords, 10);
    const covered = sharedShare(main.coords, snapped.coords, 10);
    const ordered = keepsOrder(drawing, snapped.coords);
    out[7] = check({ onNetwork: Number(onNetwork.toFixed(2)), covered: Number(covered.toFixed(2)), ordered }, onNetwork >= 0.9 && covered >= 0.9 && ordered);
  }
  // 3 (information only): the same pair with a slope limit, measured with OnWay's own measurement.
  const limited = await engine.route({ url, from: pair.from, to: pair.to, customModel: engine.slopeModel(SLOPE_LIMIT_FOR_INFO_PCT) });
  const base = await ours(main.coords);
  const slope = { limitPct: SLOPE_LIMIT_FOR_INFO_PCT, baseMaxSlopePct: base.maxSlopePct };
  if (limited.paths.length > 0) {
    slope.limitedMaxSlopePct = (await ours(limited.paths[0].coords)).maxSlopePct;
    slope.routeChanged = sharedShare(limited.paths[0].coords, main.coords) < 0.9;
  }
  return { criteria: out, slope };
}

/** Criterion 3: on a pair where a gentler way exists, the limit must change the route and lower the measured maximum slope. */
async function slopeProbe(engine, url, probe, ours) {
  // The baseline is the engine with the slope lever at its indifferent end (GraphHopper: no limit; Valhalla: use_hills 1).
  const base = await engine.route({ url, from: probe.from, to: probe.to, customModel: engine.slopeIndifferentModel?.() });
  const limited = await engine.route({ url, from: probe.from, to: probe.to, customModel: engine.slopeModel(probe.limitPct) });
  if (base.paths.length === 0 || limited.paths.length === 0) return { id: probe.id, ...check({ error: base.error ?? limited.error }, false) };
  const baseMax = (await ours(base.paths[0].coords)).maxSlopePct;
  const limitedMax = (await ours(limited.paths[0].coords)).maxSlopePct;
  const changed = sharedShare(limited.paths[0].coords, base.paths[0].coords) < 0.9;
  return {
    id: probe.id,
    ...check({ limitPct: probe.limitPct, baseMaxSlopePct: baseMax, limitedMaxSlopePct: limitedMax, routeChanged: changed }, changed && limitedMax <= baseMax * probe.maxSlopeRatio),
  };
}

async function measure(engineName) {
  const engine = engines[engineName];
  if (!engine) throw new Error(`unknown engine ${engineName} (known: ${Object.keys(engines).join(', ')})`);
  const url = argOf('url', engine.DEFAULTS.url);
  const container = argOf('container', engine.DEFAULTS.container);
  const runs = Number(argOf('runs', '10'));
  const { pairs, thresholds, extract } = JSON.parse(readFileSync(join(casesDir, argOf('pairs', 'pairs.json')), 'utf8'));
  const probe = JSON.parse(readFileSync(join(casesDir, 'slope-probe.json'), 'utf8'));
  const { measureLikeOnWay: ours } = await import('./lib/ours.mjs'); // needs `pnpm build` and .data/dem (scripts/fetch-dem.sh)

  const stopWatching = watchMemory(container);
  const results = [];
  for (const pair of pairs) {
    await engine.proposeRoutes({ url, from: pair.from, to: pair.to }); // warm-up, not counted
    const seconds = [];
    let first;
    for (let i = 0; i < runs; i++) {
      const answer = await engine.proposeRoutes({ url, from: pair.from, to: pair.to });
      seconds.push(answer.ms / 1000);
      first ??= answer;
    }
    if (first.paths.length === 0) {
      results.push({ id: pair.id, error: first.error ?? 'no route', criteria: {} });
      continue;
    }
    const criteria = evaluatePair(first.paths, seconds, thresholds);
    const extra = await capabilities(engine, url, pair, first.paths[0], ours);
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
      criteria: { ...criteria, ...extra.criteria },
      slopeLimitEffect: extra.slope,
    });
  }
  const slope = await slopeProbe(engine, url, probe, ours);
  const peakMiB = await stopWatching();
  const memory = check(peakMiB, peakMiB <= thresholds.peakMemoryMb);
  return { engine: engineName, date: new Date().toISOString(), extract, thresholds, alternatives: engine.ALTERNATIVES, runs, slopeProbe: slope, peakMemoryMiB: memory, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    let failed = false;
    for (const file of readdirSync(casesDir).filter((name) => name.endsWith('.json'))) {
      const document = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
      const problems = file === 'pairs.json' ? checkPairs(document) : file === 'extra-france.json' ? checkPairs(document, 1) : file === 'slope-probe.json' ? checkProbe(document) : [];
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
  console.log('pair'.padEnd(20), ['c1', 'c2', 'c4', 'c6', 'c7', 'c8'].map((c) => c.padEnd(6)).join(''), 'paths  p95 s');
  for (const result of report.results) {
    console.log(result.id.padEnd(20), [1, 2, 4, 6, 7, 8].map((c) => mark(result.criteria[c]).padEnd(6)).join(''), String(result.paths?.length ?? 0).padEnd(6), result.seconds?.p95 ?? result.error);
  }
  console.log(`c3 slope probe ${report.slopeProbe.id}: ${mark(report.slopeProbe)} ${JSON.stringify(report.slopeProbe.value)}`);
  const out = resolve(dirname(fileURLToPath(import.meta.url)), argOf('out', `results/${engineName}.json`)); // an absolute --out is used as given
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`written ${out}`);
}
