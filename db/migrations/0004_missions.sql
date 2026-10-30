-- 0004 · Misiones, puntos y participación

CREATE TYPE mission_status       AS ENUM ('planning', 'active', 'closed');
CREATE TYPE point_kind           AS ENUM ('origin', 'waypoint', 'rendezvous');
CREATE TYPE target_source        AS ENUM ('coordinates', 'map', 'address');
CREATE TYPE participation_status AS ENUM ('pending', 'accepted', 'not_selected', 'withdrawn', 'removed');
CREATE TYPE participation_origin AS ENUM ('volunteer', 'team', 'coordinator');

CREATE TABLE missions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 120),
  description     text,
  coordinator_id  uuid        NOT NULL,                  -- INV-02, INV-03 (rol comprobado en disparador)
  status          mission_status NOT NULL DEFAULT 'planning',
  target          geometry(PointZ, 4326) NOT NULL,       -- [GIS] objetivo con altitud (RN-07)
  target_label    text,
  target_country  char(2),
  target_source   target_source NOT NULL,
  created_by      uuid        NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  closed_at       timestamptz,
  UNIQUE (id, organization_id),
  FOREIGN KEY (organization_id, coordinator_id) REFERENCES memberships (organization_id, user_id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CHECK (status <> 'closed' OR activated_at IS NOT NULL),
  CHECK (status <> 'planning' OR activated_at IS NULL)      -- una misión que se activó no vuelve a planning (disparador)
);
CREATE TRIGGER missions_updated BEFORE UPDATE ON missions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX missions_org_name_open_uq ON missions (organization_id, lower(name)) WHERE status <> 'closed';
CREATE INDEX missions_org_status_idx ON missions (organization_id, status, created_at DESC);
CREATE INDEX missions_coordinator_idx ON missions (coordinator_id);
CREATE INDEX missions_target_gix ON missions USING gist (target);        -- [GIS] sugerencias cerca del objetivo (2.ª entrega)
CREATE INDEX missions_name_trgm ON missions USING gin (name gin_trgm_ops);

CREATE TABLE mission_points (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  mission_id      uuid        NOT NULL,
  kind            point_kind  NOT NULL,
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  note            text,
  geom            geometry(PointZ, 4326) NOT NULL,       -- [GIS]
  position        integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, mission_id),
  FOREIGN KEY (mission_id, organization_id) REFERENCES missions (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX mission_points_mission_idx ON mission_points (mission_id, kind, position);
CREATE INDEX mission_points_gix ON mission_points USING gist (geom);     -- [GIS]

CREATE TABLE mission_team_assignments (
  mission_id      uuid        NOT NULL,
  team_id         uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  assigned_by     uuid        NOT NULL REFERENCES users(id),
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, team_id),
  FOREIGN KEY (mission_id, organization_id) REFERENCES missions (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, organization_id) REFERENCES teams (id, organization_id)
);

CREATE TABLE participations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  mission_id      uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  status          participation_status NOT NULL,
  origin          participation_origin NOT NULL,
  via_team_id     uuid,                                  -- equipo por el que entró, si origin = 'team'
  offered_at      timestamptz,                           -- fecha de la oferta (voluntarios)
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  participated    boolean,                               -- D-27: NULL = sin confirmar; se fija al cerrar la misión
  attendance_confirmed_by uuid REFERENCES users(id),
  attendance_confirmed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, user_id),                          -- INV-12
  FOREIGN KEY (mission_id, organization_id) REFERENCES missions (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships (organization_id, user_id),
  FOREIGN KEY (via_team_id, organization_id) REFERENCES teams (id, organization_id),
  CHECK (participated IS NULL OR status = 'accepted'),                         -- INV-27
  CHECK ((participated IS NULL) = (attendance_confirmed_at IS NULL)),
  CHECK ((participated IS NULL) = (attendance_confirmed_by IS NULL)),
  CHECK (status IN ('pending', 'withdrawn') OR decided_by IS NOT NULL),
  CHECK (origin <> 'volunteer' OR offered_at IS NOT NULL),
  CHECK ((origin = 'team') = (via_team_id IS NOT NULL))
);
CREATE TRIGGER participations_updated BEFORE UPDATE ON participations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX participations_mission_status_idx ON participations (mission_id, status, offered_at DESC);
CREATE INDEX participations_user_idx ON participations (user_id, status);
-- Historial (INV-21): participaciones confirmadas, con la misión cerrada
CREATE INDEX participations_history_idx ON participations (user_id, mission_id) WHERE participated;
