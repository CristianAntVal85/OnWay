#!/bin/sh
# Regresión REAL del motor de rutas (H3, P3): levanta el motor con el extracto de los Pirineos y el DEM Copernicus de verdad en un
# proyecto aparte (`onway-regression`) y pasa los casos de la prueba técnica (poc/motor-rutas/cases/): los tres pares del usuario y el
# par del lado francés, con los umbrales del plan de la prueba técnica y el criterio 3 con su texto literal.
# Uso (desde la raíz del repositorio): infra/scripts/routing-regression.sh [--keep]
#   --keep  deja el proyecto levantado (y sus volúmenes) al terminar; sin él se para, pero se conservan las descargas (~1,3 GB + DEM).
# Necesita Docker, Node >= 24.7 con `pnpm install` hecho, ~3 GB libres y ~20 min la primera vez (descarga, recorte con osmium y
# conversión del DEM); las siguientes, minutos. NO corre en cada push: el CI usa la red inventada. Hay un workflow manual con lo mismo
# (.github/workflows/routing-regression.yml). Resultados en poc/motor-rutas/results/h3-regression*.json; sale con error si falla un criterio.
set -eu

cd "$(dirname "$0")/../.."
keep=0
[ "${1:-}" != "--keep" ] || keep=1
project=onway-regression
port=18990
results=poc/motor-rutas/results
compose() { docker compose -p "$project" -f compose.yml -f infra/compose.regression.yml "$@"; }
cleanup() { [ "$keep" = 1 ] || compose down >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== motor real (descarga la primera vez)"
compose up --build --wait routing

echo "== altitud de la medición propia (DEM del PoC, 2 teselas)"
[ -n "$(ls poc/motor-rutas/.data/dem 2>/dev/null)" ] || poc/motor-rutas/scripts/fetch-dem.sh

echo "== medición propia compilada"
pnpm build >/dev/null

status=0
run() {
  pairs="$1" out="$2"
  node poc/motor-rutas/run-cases.mjs --engine graphhopper --url "http://127.0.0.1:$port" --container "${project}-routing-1" --runs 5 \
    ${pairs:+--pairs "$pairs"} --out "$out"
  # Falla si algún criterio de algún par (o la sonda, o la memoria) no pasa.
  node -e '
    const report = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const bad = [];
    for (const result of report.results) for (const [id, c] of Object.entries(result.criteria)) if (c && c.pass === false) bad.push(`${result.id} c${id}`);
    if (report.peakMemoryMiB && report.peakMemoryMiB.pass === false) bad.push("memory");
    if (report.slopeProbe && report.slopeProbe.pass === false) bad.push("slope probe");
    if (bad.length) { console.error("FAILED: " + bad.join(", ")); process.exit(1); }
  ' "$out" || status=1
}

echo "== tres pares del usuario"
run "" "$PWD/$results/h3-regression.json"
echo "== par del lado francés"
run extra-france.json "$PWD/$results/h3-regression-france.json"

[ "$status" = 0 ] && echo "regression OK" || echo "regression FAILED (see $results/h3-regression*.json)" >&2
exit "$status"
