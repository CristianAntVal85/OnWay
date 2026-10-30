-- 0003 · Archivos privados, perfiles de rescatista y equipos

CREATE TYPE file_purpose   AS ENUM ('certificate', 'route_import');
CREATE TYPE profile_status AS ENUM ('incomplete', 'complete', 'deleted');
CREATE TYPE skill_kind     AS ENUM ('course', 'skill');
CREATE TYPE document_type  AS ENUM ('dni', 'nie', 'passport', 'other');
CREATE TYPE team_status    AS ENUM ('active', 'archived');

-- Archivos privados: certificados y GPX/KML importados. El contenido vive en disco (puerto FileStorage).
CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  owner_user_id   uuid        REFERENCES users(id),       -- propietario (rescatista) si es un certificado
  purpose         file_purpose NOT NULL,
  content_type    text        NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'application/gpx+xml', 'application/vnd.google-earth.kml+xml')),
  size_bytes      integer     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),   -- 10 MB
  storage_key     text        NOT NULL UNIQUE,
  sha256          bytea       NOT NULL,
  created_by      uuid        NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (id, organization_id),
  CHECK (purpose <> 'certificate' OR owner_user_id IS NOT NULL)
);
CREATE INDEX files_owner_idx ON files (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Perfil de rescatista, dividido en tres tablas por nivel de visibilidad (documento 03, sección 11):
--   rescuer_profiles  nombre y estado          → coordinadores y administrador
--   rescuer_contact   teléfono (el correo es el de users, INV-31)
--                                              → propio, administrador y coordinadores con una participación (INV-28)
--   rescuer_sensitive documento y dirección, cifrados → solo el propio; el administrador, por función auditada (INV-18, INV-19)
CREATE TABLE rescuer_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  user_id         uuid        NOT NULL UNIQUE REFERENCES users(id),
  full_name       text        NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 160),
  status          profile_status NOT NULL DEFAULT 'incomplete',
  completed_at    timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id),
  CHECK ((status = 'complete') = (completed_at IS NOT NULL)),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);
CREATE TRIGGER rescuer_profiles_updated BEFORE UPDATE ON rescuer_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX rescuer_profiles_org_name_trgm ON rescuer_profiles USING gin (full_name gin_trgm_ops);

CREATE TABLE rescuer_contact (
  profile_id      uuid PRIMARY KEY,
  organization_id uuid        NOT NULL,
  phone           text        NOT NULL CHECK (phone ~ '^\+?[0-9 ().-]{6,20}$'),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (profile_id, organization_id) REFERENCES rescuer_profiles (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE rescuer_sensitive (
  profile_id      uuid PRIMARY KEY,
  organization_id uuid        NOT NULL,
  document_type   document_type NOT NULL,
  document_enc    bytea       NOT NULL,                    -- AES-256-GCM: nonce || texto cifrado || etiqueta
  document_hash   bytea       NOT NULL,                    -- HMAC-SHA256 del número normalizado (clave distinta)
  address_enc     bytea       NOT NULL,                    -- JSON de la dirección, cifrado igual
  key_id          smallint    NOT NULL,                    -- identificador de la clave de cifrado (rotación)
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (profile_id, organization_id) REFERENCES rescuer_profiles (id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, document_hash)                  -- INV-24
);

CREATE TABLE skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  profile_id      uuid        NOT NULL,
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  kind            skill_kind  NOT NULL,
  issuer          text,
  issued_on       date,
  expires_on      date,
  certificate_file_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (profile_id, organization_id) REFERENCES rescuer_profiles (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (certificate_file_id, organization_id) REFERENCES files (id, organization_id),
  CHECK (kind = 'course' OR certificate_file_id IS NULL),   -- D-29: el certificado es de un curso
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX skills_profile_idx ON skills (profile_id);
CREATE INDEX skills_name_trgm   ON skills USING gin (name gin_trgm_ops);   -- filtro por habilidad (2.ª entrega, RF-811)

CREATE TABLE teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  locality        text        NOT NULL CHECK (char_length(btrim(locality)) >= 1),      -- INV-23
  status          team_status NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX teams_org_name_uq ON teams (organization_id, lower(name));

CREATE TABLE team_members (
  team_id         uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id, organization_id) REFERENCES teams (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);
