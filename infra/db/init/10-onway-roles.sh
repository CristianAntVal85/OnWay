#!/bin/bash
# Runs once, as the PostgreSQL superuser, when the data directory is created
# (docker-entrypoint-initdb.d). Migration 0001 needs a superuser: extensions and roles.
# Then the roles that log in get their passwords, read from files (never from the repository).
#
#   ONWAY_MIGRATION_0001            path to db/migrations/0001_extensions_roles.sql
#   ONWAY_OWNER_PASSWORD_FILE       password of onway_owner (migrations, seed)
#   ONWAY_APP_PASSWORD_FILE         password of onway_app (API and worker)
set -euo pipefail

: "${ONWAY_MIGRATION_0001:?}" "${ONWAY_OWNER_PASSWORD_FILE:?}" "${ONWAY_APP_PASSWORD_FILE:?}"
owner_pw="$(cat "$ONWAY_OWNER_PASSWORD_FILE")"
app_pw="$(cat "$ONWAY_APP_PASSWORD_FILE")"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$ONWAY_MIGRATION_0001"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$owner_pw" -v app_pw="$app_pw" -v db="$POSTGRES_DB" <<'SQL'
ALTER ROLE onway_owner LOGIN PASSWORD :'owner_pw';
ALTER ROLE onway_app LOGIN PASSWORD :'app_pw';
ALTER SCHEMA public OWNER TO onway_owner;
SELECT format('ALTER DATABASE %I OWNER TO onway_owner', :'db') \gexec
GRANT onway_app, onway_platform TO onway_owner;
SQL
