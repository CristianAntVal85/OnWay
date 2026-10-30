#!/bin/sh
# Comprobación de humo de la pila de `docker compose up`: salud, página de acceso y el ciclo
# login -> getMe -> logout con cookie y CSRF, para un administrador, un coordinador y un rescatista.
# Uso (desde la raíz del repositorio): infra/scripts/smoke.sh [URL]   (por defecto http://localhost:8080)
# La contraseña es la ficticia y pública de data/seed/demo.json (R-10); no hay ninguna otra.
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

wrong="$(status -H 'Content-Type: application/json' -d '{"email":"admin@example.org","password":"incorrecta-incorrecta"}' "$base/api/v1/auth/login")"
[ "$wrong" = 401 ] || fail "wrong credentials must be 401, got $wrong"
echo "ok  wrong credentials -> 401"
echo "smoke test passed"
