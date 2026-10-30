-- 0005 · Biblioteca de rutas, versiones y rutas en misión

CREATE TYPE route_status     AS ENUM ('active', 'archived');
CREATE TYPE version_status   AS ENUM ('draft', 'validated');
CREATE TYPE provenance       AS ENUM ('generated', 'imported', 'drawn', 'edited', 'adapted');
CREATE TYPE road_type        AS ENUM ('road', 'track', 'path', 'offtrail');
CREATE TYPE mission_route_status AS ENUM ('added', 'unavailable');
CREATE TYPE job_kind         AS ENUM ('generate', 'adapt');
CREATE TYPE job_status       AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE calculation_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  requested_by    uuid        NOT NULL REFERENCES users(id),
  mission_id      uuid,
  kind            job_kind    NOT NULL,
  params          jsonb       NOT NULL,
  status          job_status  NOT NULL DEFAULT 'pending',
  progress        smallint    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_code      text,
  error_message   text,
  queue_job_id    uuid,                                   -- identificador del trabajo en pg-boss
  result          jsonb,                                  -- generar: {routeIds}. adaptar: {candidate} (trazado propuesto, aún sin guardar)
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  UNIQUE (id, organization_id),
  FOREIGN KEY (mission_id, organization_id) REFERENCES missions (id, organization_id),
  CHECK ((status = 'failed') = (error_code IS NOT NULL))
);
CREATE INDEX calculation_jobs_org_idx ON calculation_jobs (organization_id, created_at DESC);

CREATE TABLE routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  name            text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  status          route_status NOT NULL DEFAULT 'active',
  derived_from_route_id   uuid,
  derived_from_version_id uuid,
  latest_version_id           uuid,                       -- se rellenan al crear versiones (FK diferidas, más abajo)
  latest_validated_version_id uuid,
  created_by      uuid        NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (derived_from_route_id, organization_id) REFERENCES routes (id, organization_id),
  CHECK ((derived_from_route_id IS NULL) = (derived_from_version_id IS NULL))
);
CREATE TRIGGER routes_updated BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX routes_org_status_idx ON routes (organization_id, status);
CREATE INDEX routes_name_trgm ON routes USING gin (name gin_trgm_ops);
CREATE INDEX routes_derived_idx ON routes (derived_from_route_id) WHERE derived_from_route_id IS NOT NULL;

CREATE TABLE route_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  route_id        uuid        NOT NULL,
  version_number  integer     NOT NULL CHECK (version_number >= 1),
  status          version_status NOT NULL DEFAULT 'draft',
  geom            geometry(LineStringZ, 4326) NOT NULL,   -- [GIS]
  geog            geography(LineString, 4326)             -- [GIS] copia 2D en geography para ST_DWithin en metros (2.ª entrega)
                  GENERATED ALWAYS AS (ST_Force2D(geom)::geography) STORED,
  distance_m      numeric(10,1) NOT NULL CHECK (distance_m >= 0),
  ascent_m        numeric(8,1)  NOT NULL CHECK (ascent_m >= 0),
  descent_m       numeric(8,1)  NOT NULL CHECK (descent_m >= 0),
  min_elevation_m numeric(7,1)  NOT NULL,
  max_elevation_m numeric(7,1)  NOT NULL,
  max_slope_pct   numeric(5,1)  NOT NULL CHECK (max_slope_pct >= 0),
  provenance      provenance  NOT NULL,
  manually_modified boolean   NOT NULL DEFAULT false,
  generation_params jsonb,
  calculation_job_id uuid,
  source_file_id  uuid,                                   -- archivo GPX/KML original si fue importada
  note            text,
  created_by      uuid        NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  validated_by    uuid REFERENCES users(id),
  validated_at    timestamptz,
  UNIQUE (route_id, version_number),
  UNIQUE (id, route_id),                                  -- para fijar versión en misión (INV-06)
  UNIQUE (id, organization_id),
  FOREIGN KEY (route_id, organization_id) REFERENCES routes (id, organization_id),
  FOREIGN KEY (calculation_job_id, organization_id) REFERENCES calculation_jobs (id, organization_id),
  FOREIGN KEY (source_file_id, organization_id) REFERENCES files (id, organization_id),
  CHECK (min_elevation_m <= max_elevation_m),
  CHECK ((status = 'validated') = (validated_at IS NOT NULL AND validated_by IS NOT NULL))
);
CREATE INDEX route_versions_route_idx ON route_versions (route_id, version_number DESC);
CREATE INDEX route_versions_geom_gix ON route_versions USING gist (geom);    -- [GIS] biblioteca con mapa (1.ª entrega)
CREATE INDEX route_versions_geog_gix ON route_versions USING gist (geog);    -- [GIS] búsqueda por punto en metros (2.ª entrega)

-- Los punteros "última versión" y "última validada" cierran el círculo routes ⇄ route_versions.
ALTER TABLE routes
  ADD CONSTRAINT routes_latest_fk
      FOREIGN KEY (latest_version_id, organization_id) REFERENCES route_versions (id, organization_id)
      DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT routes_latest_validated_fk
      FOREIGN KEY (latest_validated_version_id, organization_id) REFERENCES route_versions (id, organization_id)
      DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT routes_derived_version_fk
      FOREIGN KEY (derived_from_version_id, organization_id) REFERENCES route_versions (id, organization_id)
      DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE route_segments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  version_id      uuid        NOT NULL,
  position        integer     NOT NULL CHECK (position >= 0),
  geom            geometry(LineStringZ, 4326) NOT NULL,   -- [GIS]
  road_type       road_type   NOT NULL,
  distance_m      numeric(10,1) NOT NULL CHECK (distance_m >= 0),
  ascent_m        numeric(8,1)  NOT NULL CHECK (ascent_m >= 0),
  descent_m       numeric(8,1)  NOT NULL CHECK (descent_m >= 0),
  UNIQUE (version_id, position),
  FOREIGN KEY (version_id, organization_id) REFERENCES route_versions (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE mission_routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  mission_id      uuid        NOT NULL,
  route_id        uuid        NOT NULL,
  pinned_version_id uuid      NOT NULL,                   -- D-19: versión fijada
  origin_point_id uuid,
  team_id         uuid,
  status          mission_route_status NOT NULL DEFAULT 'added',
  note            text,
  added_by        uuid        NOT NULL REFERENCES users(id),
  added_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, route_id),                          -- INV-13
  FOREIGN KEY (mission_id, organization_id) REFERENCES missions (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (route_id, organization_id) REFERENCES routes (id, organization_id),
  FOREIGN KEY (pinned_version_id, route_id) REFERENCES route_versions (id, route_id),   -- INV-06
  FOREIGN KEY (origin_point_id, mission_id) REFERENCES mission_points (id, mission_id),
  FOREIGN KEY (team_id, organization_id) REFERENCES teams (id, organization_id)
);
CREATE INDEX mission_routes_route_idx ON mission_routes (route_id);                -- "Usada en…"
CREATE INDEX mission_routes_pinned_idx ON mission_routes (pinned_version_id);

-- Zonas a evitar (RF-507). Opción más simple para Q-05: viven en la organización, con misión opcional;
-- solo las ven coordinadores y administrador.
CREATE TABLE avoid_zones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  mission_id      uuid,
  geom            geometry(Polygon, 4326) NOT NULL,       -- [GIS]
  reason          text,
  created_by      uuid        NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (mission_id, organization_id) REFERENCES missions (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX avoid_zones_gix ON avoid_zones USING gist (geom);              -- [GIS]
