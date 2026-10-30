#!/bin/bash
# Prueba el esquema en un PostgreSQL 16 SIN PostGIS (lo espacial se sustituye por texto).
# Requisitos: un clúster en /tmp/pgtest (socket) en el puerto 55432 con el usuario postgres de confianza.
# Para probar con PostGIS real, usar la imagen postgis/postgis:16 y aplicar migrations/ tal cual.
# Uso, desde cualquier carpeta:  db/tests/run.sh
set -e
cd "$(dirname "$0")/.."
python3 tests/stub.py /tmp/pgtest/stub
P="psql -h /tmp/pgtest -p 55432 -q"
$P -U postgres -d postgres -c "DROP DATABASE IF EXISTS onway_test" -c "CREATE DATABASE onway_test" >/dev/null 2>&1
$P -U postgres -d onway_test -v ON_ERROR_STOP=1 -f /tmp/pgtest/stub/0001_extensions_roles.sql >/dev/null
$P -U postgres -d onway_test -c "ALTER ROLE onway_owner LOGIN" -c "ALTER SCHEMA public OWNER TO onway_owner" -c "ALTER DATABASE onway_test OWNER TO onway_owner" -c "GRANT onway_app, onway_platform TO onway_owner" >/dev/null 2>&1
for f in /tmp/pgtest/stub/000[2-9]_*.sql; do $P -U onway_owner -d onway_test -v ON_ERROR_STOP=1 -f $f >/dev/null; done
$P -U onway_owner -d onway_test -f tests/seed_and_tests.sql 2>&1 | grep -i -E 'error' | head -5 || true
$P -U onway_owner -d onway_test -f tests/run_tests.sql 2>&1 | grep -E 'RESULT\||ERROR' | head -400 | sed 's/^psql:[^ ]* NOTICE:  //' > /tmp/pgtest/results.txt
echo "PASS: $(grep -c '|PASS|' /tmp/pgtest/results.txt)"
echo "FAIL: $(grep -c '|FAIL|' /tmp/pgtest/results.txt)"
grep -E '\|FAIL\||ERROR' /tmp/pgtest/results.txt || true
