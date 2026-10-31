#!/bin/bash
# Prueba el esquema sobre PostGIS real (imagen postgis/postgis:16-3.4), con las migraciones tal cual.
# Requisito: Docker. Uso, desde cualquier carpeta:  db/tests/run-postgis.sh
set -e
cd "$(dirname "$0")/.."
C=onway-db-test
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -e POSTGRES_PASSWORD=test postgis/postgis:16-3.4 >/dev/null
trap 'docker rm -f $C >/dev/null 2>&1' EXIT
until docker exec $C pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
sleep 2
docker cp . $C:/db
P="docker exec $C psql -q -v ON_ERROR_STOP=1"
$P -U postgres -c "CREATE DATABASE onway_test" >/dev/null
$P -U postgres -d onway_test -f /db/migrations/0001_extensions_roles.sql >/dev/null
$P -U postgres -d onway_test -c "ALTER ROLE onway_owner LOGIN" -c "ALTER SCHEMA public OWNER TO onway_owner" -c "ALTER DATABASE onway_test OWNER TO onway_owner" -c "GRANT onway_app, onway_platform TO onway_owner" >/dev/null
for f in migrations/000[2-9]_*.sql migrations/00[1-9][0-9]_*.sql; do $P -U onway_owner -d onway_test -f /db/$f >/dev/null; done
docker exec $C psql -q -U onway_owner -d onway_test -f /db/tests/seed_and_tests.sql 2>&1 | grep -i error | head -5 || true
docker exec $C psql -q -U onway_owner -d onway_test -f /db/tests/run_tests.sql 2>&1 | grep -E 'RESULT\||ERROR' | sed 's/^psql:[^ ]* NOTICE:  //' > /tmp/onway-results.txt
echo "PASS: $(grep -c '|PASS|' /tmp/onway-results.txt)"
echo "FAIL: $(grep -c '|FAIL|' /tmp/onway-results.txt)"
grep -E '\|FAIL\||ERROR' /tmp/onway-results.txt || true
