-- 0011 · Q-14 = no: el administrador lee las misiones y lo que cuelga de ellas, pero no las escribe
-- Decisión de producto (2026-10-31): solo el coordinador crea y edita misiones y rutas. El contrato y el API ya lo
-- hacen así (MISSION_WRITERS); esta migración lo repite en la base de datos (defensa en profundidad, regla 2):
-- aunque un fallo del servidor dejara pasar al administrador, la seguridad por filas lo pararía.
--
-- Hasta la 0010 las políticas «FOR ALL USING (app_is_staff())» de estas tablas daban escritura (y lectura) a los dos
-- roles de personal. Aquí se sustituyen por: lectura para app_is_staff() (el administrador sigue leyendo lo mismo) y
-- escritura (INSERT, UPDATE, DELETE) solo para app_is_coordinator(). Se conservan tal cual la restrictiva
-- org_isolation, las lecturas del rescatista (missions_select, points_select, part_select, routes_rescuer,
-- versions_rescuer, segments_rescuer, mroutes_rescuer) y la oferta y retirada del rescatista (part_offer,
-- part_withdraw). No se tocan teams ni team_members (el administrador gestiona equipos, Q-12), calculation_jobs,
-- files, audit_log (el administrador sigue leyendo el historial), users ni memberships.

CREATE OR REPLACE FUNCTION app_is_coordinator() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app_role() = 'coordinator' $$;

DO $$
DECLARE
  -- tabla, política «FOR ALL» que se sustituye, prefijo de las nuevas, y si la lectura del personal ya la cubre otra política
  spec constant text[][] := ARRAY[
    ['missions',                 'missions_write',    'missions',    'covered'],
    ['mission_points',           'points_write',      'points',      'covered'],
    ['mission_team_assignments', 'assignments_staff', 'assignments', 'new'],
    ['participations',           'part_staff',        'part',        'covered'],
    ['mission_routes',           'mroutes_staff',     'mroutes',     'new'],
    ['routes',                   'routes_staff',      'routes',      'new'],
    ['route_versions',           'versions_staff',    'versions',    'new'],
    ['route_segments',           'segments_staff',    'segments',    'new'],
    ['avoid_zones',              'zones_staff',       'zones',       'new']];
BEGIN
  FOR i IN 1 .. array_length(spec, 1) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', spec[i][2], spec[i][1]);
    IF spec[i][4] = 'new' THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO onway_app USING (app_is_staff())', spec[i][3] || '_staff_read', spec[i][1]);
    END IF;
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO onway_app WITH CHECK (app_is_coordinator())', spec[i][3] || '_coordinator_insert', spec[i][1]);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO onway_app USING (app_is_coordinator()) WITH CHECK (app_is_coordinator())', spec[i][3] || '_coordinator_update', spec[i][1]);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO onway_app USING (app_is_coordinator())', spec[i][3] || '_coordinator_delete', spec[i][1]);
  END LOOP;
END $$;

-- INV-03: el responsable de una misión es un miembro activo con rol de coordinador (ya no de administrador).
-- El resto de controles de la función (transiciones e INV-11) queda igual que en la 0007.
CREATE OR REPLACE FUNCTION missions_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships
                 WHERE organization_id = NEW.organization_id AND user_id = NEW.coordinator_id
                   AND status = 'active' AND role = 'coordinator') THEN
    RAISE EXCEPTION 'INV-03: el responsable debe ser un coordinador activo de la organización' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Ciclo de vida: planning → active → closed → active (no se vuelve a planning)
    IF OLD.status <> NEW.status AND NOT (
         (OLD.status = 'planning' AND NEW.status = 'active') OR
         (OLD.status = 'active'   AND NEW.status = 'closed') OR
         (OLD.status = 'closed'   AND NEW.status = 'active')) THEN
      RAISE EXCEPTION 'Transición de misión no permitida: % → %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- INV-11: una misión cerrada no admite cambios salvo reabrirla
    IF OLD.status = 'closed' AND NEW.status = 'closed' THEN
      RAISE EXCEPTION 'INV-11: la misión está cerrada' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
