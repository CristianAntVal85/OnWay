-- 0006 · Auditoría y caché meteorológica

-- Registro de auditoría: solo se añade (INV-16, INV-19, INV-26). Sin claves foráneas a propósito:
-- el registro debe sobrevivir a la anonimización de usuarios y al archivado de entidades.
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       uuid,
  action          text        NOT NULL,
  actor_user_id   uuid,
  subject_user_id uuid,                                   -- de quién son los datos consultados (para "quién ha accedido a mis datos")
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  detail          jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_entity_idx  ON audit_log (organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_actor_idx   ON audit_log (organization_id, actor_user_id, occurred_at DESC);
CREATE INDEX audit_subject_idx ON audit_log (subject_user_id, occurred_at DESC) WHERE subject_user_id IS NOT NULL;
CREATE INDEX audit_action_idx  ON audit_log (organization_id, action, occurred_at DESC);

-- Caché meteorológica. Datos públicos de un punto redondeado (~1 km): no es de ninguna organización
-- ni se relaciona con quien consultó (INV-30).
CREATE TABLE forecast_cache (
  provider        text        NOT NULL,
  cell_lat        numeric(5,2) NOT NULL,                  -- latitud redondeada a 0,01°
  cell_lon        numeric(5,2) NOT NULL,                  -- longitud redondeada a 0,01°
  elevation_band  smallint    NOT NULL,                   -- altitud redondeada a 100 m
  data            jsonb       NOT NULL,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  PRIMARY KEY (provider, cell_lat, cell_lon, elevation_band)
);
CREATE INDEX forecast_cache_expires_idx ON forecast_cache (expires_at);
