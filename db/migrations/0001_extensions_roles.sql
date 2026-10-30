-- 0001 · Extensiones, roles y utilidades
-- Se ejecuta como superusuario (una sola vez, en el arranque de la base).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Roles. Ninguno de los dos roles de ejecución es superusuario ni propietario de tablas.
-- onway_owner : propietario del esquema, ejecuta las migraciones. No lo usa la aplicación.
-- onway_app   : lo usa la API y el worker. Sujeto a RLS (sin BYPASSRLS).
-- onway_platform : operaciones de plataforma (alta de organizaciones). Solo ve tablas de identidad.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onway_owner')    THEN CREATE ROLE onway_owner    NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onway_app')      THEN CREATE ROLE onway_app      NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onway_platform') THEN CREATE ROLE onway_platform NOLOGIN NOBYPASSRLS; END IF;
END $$;

-- Funciones auxiliares de contexto. La aplicación fija estas variables al abrir cada transacción:
--   SELECT set_config('app.org_id',  '<uuid>', true);
--   SELECT set_config('app.user_id', '<uuid>', true);
--   SELECT set_config('app.role',    'coordinator|rescuer|admin', true);
-- Si una variable no está fijada, las funciones devuelven NULL y las políticas no dejan ver nada.
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.role', true), '') $$;
CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean   -- coordinador o administrador
  LANGUAGE sql STABLE AS $$ SELECT app_role() IN ('coordinator', 'admin') $$;
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app_role() = 'admin' $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
