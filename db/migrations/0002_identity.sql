-- 0002 · Identidad y organizaciones

CREATE TYPE account_status    AS ENUM ('pending', 'active', 'rejected', 'disabled');
CREATE TYPE member_role       AS ENUM ('coordinator', 'rescuer', 'admin');
CREATE TYPE member_status     AS ENUM ('active', 'disabled');
CREATE TYPE request_status    AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  country       char(2)     NOT NULL,                       -- ISO 3166-1 alfa-2
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  invite_code   text        NOT NULL UNIQUE CHECK (char_length(invite_code) >= 10),  -- D-25 (propuesto)
  invite_rotated_at timestamptz NOT NULL DEFAULT now(),
  validation_max_age_days integer NOT NULL DEFAULT 90 CHECK (validation_max_age_days BETWEEN 1 AND 3650),  -- N de RF-519: pasados estos días una validación se marca «posiblemente desactualizada»
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Los usuarios son globales: el correo es único en toda la plataforma y el inicio de sesión
-- ocurre antes de saber la organización. No contienen datos sensibles (INV-18, INV-31).
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext      NOT NULL UNIQUE,            -- es el correo de acceso y de contacto (D-28)
  password_hash  text        NOT NULL,                   -- Argon2id
  display_name   text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  locale         text        NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'fr')),
  account_status account_status NOT NULL DEFAULT 'pending',
  is_platform_admin boolean  NOT NULL DEFAULT false,
  failed_logins  smallint    NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  anonymized_at  timestamptz,                            -- INV-22: usuario cuyos datos se eliminaron
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id          bytea       PRIMARY KEY,                   -- hash SHA-256 del identificador de sesión
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  user_id         uuid        NOT NULL REFERENCES users(id),
  role            member_role   NOT NULL,
  status          member_status NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  UNIQUE (user_id),                                      -- v1: un usuario, una organización (RF-102). Quitar esta línea habilita varias.
  UNIQUE (organization_id, user_id, role)                -- para claves foráneas compuestas (INV-03)
);
CREATE INDEX memberships_org_role_idx ON memberships (organization_id, role) WHERE status = 'active';

CREATE TABLE signup_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  user_id         uuid        NOT NULL UNIQUE REFERENCES users(id),
  status          request_status NOT NULL DEFAULT 'pending',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  granted_role    member_role,
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK ((status = 'approved') = (granted_role IS NOT NULL))
);
CREATE INDEX signup_requests_org_status_idx ON signup_requests (organization_id, status, requested_at);
