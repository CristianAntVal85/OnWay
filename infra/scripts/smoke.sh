#!/bin/sh
# Comprobación de humo de la pila de `docker compose up`: salud, página de acceso y el ciclo
# login -> getMe -> logout con cookie y CSRF, para un administrador, un coordinador y dos rescatistas (uno con el perfil incompleto). Comprueba también el acceso de H5:
# el administrador lee el código de invitación y los demás reciben 403, `register` con un código inválido da REGISTRATION_FAILED,
# `forgotPassword` responde 202 y la bandeja del administrador trae la solicitud de `pendiente@example.org`. No registra ninguna cuenta ni
# envía ningún correo (el correo del `forgotPassword` no existe), así que no deja nada en la pila.
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
check_account rescatista1@example.org rescuer home
check_account rescatista6@example.org rescuer complete-profile
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

# Perfil (H5-perfil): el de rescatista1 viene completo de la semilla, con el documento y la dirección enmascarados (sus datos en claro no
# salen en la lectura del perfil) y en claro solo a petición suya; el coordinador no tiene vía a los datos sensibles (INV-18).
sign_in() {
  : >"$jar"
  curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$password\"}" "$base/api/v1/auth/login" >/dev/null
}
sign_in rescatista1@example.org
body="$(curl -s -b "$jar" "$base/api/v1/my/profile")"
echo "$body" | grep -q '"status":"complete"' || fail "rescatista1's profile is not complete: $body"
echo "$body" | grep -q '"masked":"•••••••1R"' || fail "getMyProfile does not mask the document: $body"
echo "$body" | grep -q '00000001R' && fail "getMyProfile showed the document in clear"
echo "$body" | grep -q 'Inventado' && fail "getMyProfile showed the street"
[ "$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' "$base/api/v1/my/profile/sensitive")" = 200 ] || fail "getMySensitive for the rescuer is not 200"
curl -s -b "$jar" "$base/api/v1/my/profile/sensitive" | grep -q '"number":"00000001R"' || fail "getMySensitive does not decrypt the document"
sign_in coordinador@example.org
[ "$(status -b "$jar" "$base/api/v1/my/profile/sensitive")" = 403 ] || fail "a coordinator must get 403 on /my/profile/sensitive"
echo "ok  profile: rescatista1 complete and masked, sensitive data in clear only for them, coordinator 403"

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

# Rutas en la misión (H4-T7): la semilla pone 4 rutas en la misión activa «Valle de Ordesa». El coordinador las ve todas (incluida la de versión
# fijada en borrador); el rescatista solo las de versión validada fijada: 3 de las 4, y una de ellas marcada como no disponible (INV-05, RF-508).
login_as() {
  : >"$jar"
  curl -s -c "$jar" -b "$jar" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$password\"}" "$base/api/v1/auth/login" >/dev/null
}
login_as coordinador@example.org
missions="$(curl -s -b "$jar" "$base/api/v1/missions?status=active&pageSize=50")"
mission="$(echo "$missions" | sed -n 's/.*"id":"\([^"]*\)","name":"Simulacro ficticio · Valle de Ordesa".*/\1/p')"
[ -n "$mission" ] || fail "the active demo mission is not listed: $missions"
staff_routes="$(curl -s -b "$jar" "$base/api/v1/missions/$mission/routes")"
[ "$(echo "$staff_routes" | grep -o '"previewGeometry"' | wc -l)" = 4 ] || fail "the coordinator must see the 4 routes of the demo mission: $staff_routes"
echo "$staff_routes" | grep -q 'Variante de la Pradera' || fail "the coordinator does not see the route pinned to a Draft"
echo "$staff_routes" | grep -q '"newerValidatedVersion":{' || fail "the demo mission shows no newer validated version notice"
login_as rescatista1@example.org
my_routes="$(curl -s -b "$jar" "$base/api/v1/my/missions/$mission/routes")"
[ "$(echo "$my_routes" | grep -o '"previewGeometry"' | wc -l)" = 3 ] || fail "the rescuer must see 3 of the 4 routes of the demo mission: $my_routes"
echo "$my_routes" | grep -q 'Variante de la Pradera' && fail "the rescuer sees a route whose pinned version is a Draft"
[ "$(echo "$my_routes" | grep -o '"status":"unavailable"' | wc -l)" = 1 ] || fail "the rescuer must see exactly one route marked unavailable: $my_routes"
echo "$my_routes" | grep -Eq '"note"|validatedBy' && fail "the rescuer's routes carry a note or who validated"
echo "ok  demo mission: coordinator sees its 4 routes, rescuer sees 3 (one marked unavailable) and not the Draft"

# Acceso (H5-acceso): código de invitación, registro con un código inválido, recuperación de contraseña y bandeja de solicitudes.
# Los límites de peticiones de los endpoints públicos son por IP (forgotPassword: 5 por hora): repetir esta comprobación más veces en
# una hora, desde la misma pila arrancada, da 429 RATE_LIMITED; `docker compose restart api` vacía la cuenta.
login_as admin@example.org
invite="$(curl -s -b "$jar" "$base/api/v1/admin/invite-code")"
invite_code="$(echo "$invite" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')"
[ "${#invite_code}" -ge 10 ] || fail "getInviteCode as the administrator returned no code of 10 or more characters (the code is not printed)"
echo "$invite" | grep -q '"rotatedAt"' || fail "getInviteCode returned no rotatedAt"
for who in coordinador@example.org rescatista1@example.org; do
  login_as "$who"
  [ "$(status -b "$jar" "$base/api/v1/admin/invite-code")" = 403 ] || fail "getInviteCode as $who must be 403"
done
signups="$(login_as admin@example.org; curl -s -b "$jar" "$base/api/v1/admin/signup-requests?status=pending&pageSize=50")"
echo "$signups" | grep -q '"email":"pendiente@example.org"' || fail "listSignupRequests does not list the pending request of pendiente@example.org: $signups"
echo "$signups" | grep -q "$invite_code" && fail "listSignupRequests carries the invite code"
echo "ok  admin: getInviteCode 200 with a code (coordinator and rescuer 403); the inbox lists the pending request of pendiente@example.org"

register_body="{\"email\":\"smoke-register@example.org\",\"password\":\"$password\",\"passwordConfirm\":\"$password\",\"displayName\":\"Smoke ficticio\",\"inviteCode\":\"INVALID-CODE-0000\",\"locale\":\"es\"}"
register_out="$(curl -s -w ' %{http_code}' -H 'Content-Type: application/json' -d "$register_body" "$base/api/v1/auth/register")"
echo "$register_out" | grep -q '"code":"REGISTRATION_FAILED"' || fail "register with an invalid code must answer REGISTRATION_FAILED: $register_out"
[ "${register_out##* }" = 422 ] || fail "register with an invalid code must be 422: $register_out"
login_as admin@example.org
curl -s -b "$jar" "$base/api/v1/admin/signup-requests?status=pending&pageSize=50" | grep -q 'smoke-register@example.org' && fail "register with an invalid code left a request behind"
echo "ok  register with an invalid code -> 422 REGISTRATION_FAILED, nothing registered"

forgot_out="$(curl -s -w ' %{http_code}' -H 'Content-Type: application/json' -d '{"email":"nadie-smoke@example.org"}' "$base/api/v1/auth/password/forgot")"
[ "${forgot_out##* }" = 202 ] || fail "forgotPassword for an unknown address must be 202 (429 means more than 5 calls in the last hour): $forgot_out"
echo "$forgot_out" | grep -q '"ok":true' || fail "forgotPassword must answer {ok:true}: $forgot_out"
echo "ok  forgotPassword for an unknown address -> 202 {ok:true}"

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
