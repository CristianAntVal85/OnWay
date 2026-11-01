#!/bin/sh
# Comprobación de humo de la pila de `docker compose up`: salud, página de acceso y el ciclo
# login -> getMe -> logout con cookie y CSRF, para un administrador, un coordinador y un rescatista.
# Uso (desde la raíz del repositorio): infra/scripts/smoke.sh [URL]   (por defecto http://localhost:8080)
# La contraseña es la ficticia y pública de data/seed/demo.json (R-10); no hay ninguna otra.
# También comprueba en la base real los roles (regla inviolable 1): necesita `docker compose` y el servicio `db`;
# con SMOKE_SKIP_DB_ROLES=1 se omite (por ejemplo, al probar un despliegue remoto por URL).
set -eu

base="${1:-http://localhost:8080}"
seed="$(dirname "$0")/../../data/seed/demo.json"
password="$(sed -n 's/.*"demoPassword": *"\([^"]*\)".*/\1/p' "$seed")"
[ -n "$password" ] || { echo "demoPassword not found in $seed" >&2; exit 1; }
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

[ "$(status "$base/api/v1/health")" = 200 ] || fail "GET /api/v1/health is not 200"
curl -fs "$base/" | grep -q '<div id="root">' || fail "the web shell is not served at /"
[ "$(status "$base/missions")" = 200 ] || fail "deep links do not fall back to index.html"
echo "ok  health and web shell"

# curl guarda la cookie Secure y la devuelve a http://localhost (contexto seguro), como hacen los navegadores.
check_account() {
  email="$1" role="$2" step="$3"
  : >"$jar"
  body="$(curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" "$base/api/v1/auth/login")"
  echo "$body" | grep -q "\"nextStep\":\"$step\"" || fail "login $email: unexpected nextStep: $body"
  [ -z "$role" ] || echo "$body" | grep -q "\"role\":\"$role\"" || fail "login $email: role is not $role"
  csrf="$(echo "$body" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')"
  [ -n "$csrf" ] || fail "login $email: no csrfToken"
  [ "$(status -b "$jar" "$base/api/v1/auth/me")" = 200 ] || fail "getMe with the session cookie is not 200 ($email)"
  [ "$(status -b "$jar" -X POST "$base/api/v1/auth/logout")" = 403 ] || fail "logout without CSRF must be 403 ($email)"
  [ "$(status -b "$jar" -X POST -H "X-CSRF-Token: $csrf" "$base/api/v1/auth/logout")" = 204 ] || fail "logout with CSRF is not 204 ($email)"
  [ "$(status -b "$jar" "$base/api/v1/auth/me")" = 401 ] || fail "the session still works after logout ($email)"
  echo "ok  $email ${role:-pending} -> $step"
}

check_account admin@example.org admin home
check_account coordinador@example.org coordinator home
check_account rescatista1@example.org rescuer complete-profile
check_account pendiente@example.org "" awaiting-approval

# Altitud del servidor (H1-T4): un punto de los Pirineos lo resuelve el DEM local (Copernicus o el sintético del E2E); es solo para el personal.
check_elevation() {
  : >"$jar"
  curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$password\"}" "$base/api/v1/auth/login" >/dev/null
  code="$(status -b "$jar" "$base/api/v1/geo/elevation?lat=42.63&lon=-0.1")"
  [ "$code" = "$2" ] || fail "getElevation as $1 must be $2, got $code"
}
check_elevation coordinador@example.org 200
body="$(curl -s -b "$jar" "$base/api/v1/geo/elevation?lat=42.63&lon=-0.1")"
echo "$body" | grep -Eq '"elevationM":-?[0-9]+(\.[0-9]+)?' || fail "getElevation returned no altitude: $body"
check_elevation rescatista1@example.org 403
echo "ok  getElevation: coordinator 200 with an altitude, rescuer 403"

# Entorno (H1-T5): el tiempo puede venir del proveedor real, de la caché o no estar disponible, pero la respuesta es siempre 200 y trae
# luz y luna calculadas en local. Lo piden también el rescatista y la posición se redondea (la respuesta devuelve la celda de ~1 km).
check_environment() {
  : >"$jar"
  curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$password\"}" "$base/api/v1/auth/login" >/dev/null
  code="$(status -b "$jar" "$base/api/v1/environment?lat=42.634567&lon=-0.104321")"
  [ "$code" = 200 ] || fail "getEnvironment as $1 must be 200, got $code"
  body="$(curl -s -b "$jar" "$base/api/v1/environment?lat=42.634567&lon=-0.104321")"
  echo "$body" | grep -Eq '"weather":\{"status":"(ok|stale|unavailable)"' || fail "getEnvironment returned no weather block: $body"
  echo "$body" | grep -q '"sun":{' || fail "getEnvironment returned no sun: $body"
  echo "$body" | grep -q '"moon":{' || fail "getEnvironment returned no moon: $body"
  echo "$body" | grep -q '"lat":42.63,' || fail "getEnvironment did not round the position to its cell: $body"
  echo "$body" | grep -q '42.634567' && fail "getEnvironment echoed the exact position"
  return 0
}
check_environment coordinador@example.org
check_environment rescatista1@example.org
echo "ok  getEnvironment: coordinator and rescuer 200 with weather, sun and moon, position rounded"

# Biblioteca de rutas (H2-T6): la semilla deja 6 rutas ficticias (5 activas y 1 archivada); el coordinador las lista, el administrador las lee y el rescatista no.
# Se exporta una a GPX y se comprueba que no lleva autor.
check_routes() {
  : >"$jar"
  curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$password\"}" "$base/api/v1/auth/login" >/dev/null
  code="$(status -b "$jar" "$base/api/v1/routes?pageSize=50")"
  [ "$code" = "$2" ] || fail "listRoutes as $1 must be $2, got $code"
}
check_routes coordinador@example.org 200
routes="$(curl -s -b "$jar" "$base/api/v1/routes?pageSize=50")"
echo "$routes" | grep -Eq '"total":[0-9]+' || fail "listRoutes returned no total: $routes"
[ "$(echo "$routes" | grep -o '"previewGeometry"' | wc -l)" -ge 5 ] || fail "listRoutes must list the 5 active demo routes: $routes"
curl -s -b "$jar" "$base/api/v1/routes?status=archived" | grep -q 'Camino antiguo' || fail "the archived demo route is not in the archived list"
first="$(echo "$routes" | sed -n 's/.*"items":\[{"id":"\([^"]*\)".*/\1/p')"
[ -n "$first" ] || fail "listRoutes returned no id: $routes"
export_file="$(curl -s -b "$jar" "$base/api/v1/routes/$first/export")"
echo "$export_file" | grep -q '<trk>' || fail "exportRoute returned no track"
echo "$export_file" | grep -Eq '<author|@' && fail "exportRoute carries an author or an e-mail"
check_routes admin@example.org 200
check_routes rescatista1@example.org 403
echo "ok  routes: coordinator lists the 5 active demo routes plus the archived one and exports one without author, administrator reads, rescuer 403"

wrong="$(status -H 'Content-Type: application/json' -d '{"email":"admin@example.org","password":"incorrecta-incorrecta"}' "$base/api/v1/auth/login")"
[ "$wrong" = 401 ] || fail "wrong credentials must be 401, got $wrong"
echo "ok  wrong credentials -> 401"

# Los roles de ejecución no saltan la seguridad por filas (regla inviolable 1, doc 05): ni superusuario, ni BYPASSRLS, ni dueños
# de objetos, y onway_app no es miembro de ningún otro rol (no puede heredar el poder del propietario).
# El superusuario entra por el socket del contenedor: la base no publica ningún puerto.
if [ "${SMOKE_SKIP_DB_ROLES:-0}" = 1 ]; then
  echo "skip database role check (SMOKE_SKIP_DB_ROLES=1)"
else
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  sql="SELECT
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('onway_app', 'onway_owner', 'onway_platform')),
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('onway_app', 'onway_owner', 'onway_platform')
       AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)),
    (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname IN ('onway_app', 'onway_platform')),
    (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname IN ('onway_app', 'onway_platform')),
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'onway_owner')"
  roles="$(cd "$root" && docker compose exec -T db psql -U postgres -d onway -At -F ' ' -c "$sql")" || fail "cannot query pg_roles in the db container"
  # found | privileged | owned by app/platform | memberships of app/platform | tables owned by onway_owner
  set -- $roles
  [ "$1" = 3 ] || fail "expected the 3 onway roles, found $1"
  [ "$2" = 0 ] || fail "an onway role is superuser, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION"
  [ "$3" = 0 ] || fail "onway_app or onway_platform own database objects"
  [ "$4" = 0 ] || fail "onway_app or onway_platform are members of another role"
  [ "$5" -gt 0 ] || fail "onway_owner owns no tables"
  echo "ok  onway_app, onway_platform and onway_owner: no superuser, no BYPASSRLS; the app roles own nothing and inherit nothing"
fi

# H3: el worker de cálculos está sano (toma los trabajos de la cola).
if [ "${SMOKE_SKIP_ROUTING:-0}" = 1 ]; then
  echo "skip worker check (SMOKE_SKIP_ROUTING=1)"
else
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  (cd "$root" && docker compose exec -T worker node -e "fetch('http://127.0.0.1:3001/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))") \
    || fail "the worker does not answer /health: see docker compose logs worker"
  echo "ok  the calculation worker answers /health"
fi

# H3: el motor de rutas responde y no está en reposo (si la descarga de la red de caminos falló, el motor espera y la API
# responde ROUTING_UNAVAILABLE: una instalación sana no debería estar así).
if [ "${SMOKE_SKIP_ROUTING:-0}" = 1 ]; then
  echo "skip routing engine check (SMOKE_SKIP_ROUTING=1)"
else
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  (cd "$root" && docker compose exec -T routing sh -c 'test ! -e /tmp/degraded && curl -fsS http://127.0.0.1:8989/health >/dev/null') \
    || fail "the routing engine is not serving (no road network, or not healthy): see docker compose logs routing-data routing"
  echo "ok  the routing engine answers /health"
fi

echo "smoke test passed"
