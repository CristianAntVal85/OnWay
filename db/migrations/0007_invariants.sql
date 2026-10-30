-- 0007 · Invariantes que no caben en una restricción simple (documento 03, sección 7)

-- INV-04: una versión guardada no cambia. Única mutación permitida: Borrador → Validada
-- (con quién y cuándo). Una versión validada no se puede borrar.
CREATE OR REPLACE FUNCTION route_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validated' THEN
      RAISE EXCEPTION 'INV-04: una versión validada no se puede borrar' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'validated' THEN
    RAISE EXCEPTION 'INV-04: una versión validada es inmutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Borrador: solo puede pasar a Validada; el resto de columnas no cambia
  IF NEW.status <> 'validated'
     OR (NEW.id, NEW.organization_id, NEW.route_id, NEW.version_number, NEW.geom, NEW.distance_m, NEW.ascent_m, NEW.descent_m,
         NEW.min_elevation_m, NEW.max_elevation_m, NEW.max_slope_pct, NEW.provenance, NEW.manually_modified,
         NEW.generation_params, NEW.calculation_job_id, NEW.source_file_id, NEW.note, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.organization_id, OLD.route_id, OLD.version_number, OLD.geom, OLD.distance_m, OLD.ascent_m, OLD.descent_m,
         OLD.min_elevation_m, OLD.max_elevation_m, OLD.max_slope_pct, OLD.provenance, OLD.manually_modified,
         OLD.generation_params, OLD.calculation_job_id, OLD.source_file_id, OLD.note, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'INV-04: una versión solo puede pasar de Borrador a Validada' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER route_versions_guard_trg BEFORE UPDATE OR DELETE ON route_versions
  FOR EACH ROW EXECUTE FUNCTION route_versions_guard();

CREATE OR REPLACE FUNCTION route_segments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'INV-04: los tramos de una versión no se modifican' USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER route_segments_immutable_trg BEFORE UPDATE ON route_segments
  FOR EACH ROW EXECUTE FUNCTION route_segments_immutable();

-- Las funciones de disparador que consultan otras tablas son SECURITY DEFINER: deben ver todas las filas
-- aunque quien escribe esté limitado por RLS (por ejemplo, un rescatista no ve misiones en planificación).

-- INV-07: una ruta usada en una misión no cerrada no se archiva.
CREATE OR REPLACE FUNCTION routes_archive_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'archived' AND OLD.status <> 'archived' AND EXISTS (
       SELECT 1 FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id
       WHERE mr.route_id = NEW.id AND m.status <> 'closed') THEN
    RAISE EXCEPTION 'INV-07: la ruta está en una misión no cerrada' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER routes_archive_guard_trg BEFORE UPDATE OF status ON routes
  FOR EACH ROW EXECUTE FUNCTION routes_archive_guard();

-- INV-03: el responsable de una misión es un miembro activo con rol de coordinador o administrador
-- (la pregunta Q-14 decide si el administrador puede serlo).
CREATE OR REPLACE FUNCTION missions_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships
                 WHERE organization_id = NEW.organization_id AND user_id = NEW.coordinator_id
                   AND status = 'active' AND role IN ('coordinator', 'admin')) THEN
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
CREATE TRIGGER missions_guard_trg BEFORE INSERT OR UPDATE ON missions
  FOR EACH ROW EXECUTE FUNCTION missions_guard();

-- INV-11: ninguna tabla hija de una misión cerrada admite escrituras.
CREATE OR REPLACE FUNCTION assert_mission_open() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mid uuid; st mission_status;
BEGIN
  mid := CASE WHEN TG_OP = 'DELETE' THEN OLD.mission_id ELSE NEW.mission_id END;
  SELECT status INTO st FROM missions WHERE id = mid;
  IF st = 'closed' THEN
    RAISE EXCEPTION 'INV-11: la misión está cerrada' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER mission_points_open_trg BEFORE INSERT OR UPDATE OR DELETE ON mission_points
  FOR EACH ROW EXECUTE FUNCTION assert_mission_open();
CREATE TRIGGER mission_team_assignments_open_trg BEFORE INSERT OR UPDATE OR DELETE ON mission_team_assignments
  FOR EACH ROW EXECUTE FUNCTION assert_mission_open();
CREATE TRIGGER mission_routes_open_trg BEFORE INSERT OR UPDATE OR DELETE ON mission_routes
  FOR EACH ROW EXECUTE FUNCTION assert_mission_open();
CREATE TRIGGER participations_open_trg BEFORE INSERT OR UPDATE OR DELETE ON participations
  FOR EACH ROW EXECUTE FUNCTION assert_mission_open();

-- Ruta en misión: el punto de origen debe ser de tipo origen (RF-513).
CREATE OR REPLACE FUNCTION mission_routes_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.origin_point_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM mission_points WHERE id = NEW.origin_point_id AND kind = 'origin') THEN
    RAISE EXCEPTION 'El punto de origen debe ser de tipo origen' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mission_routes_guard_trg BEFORE INSERT OR UPDATE ON mission_routes
  FOR EACH ROW EXECUTE FUNCTION mission_routes_guard();

-- Participación: INV-09, INV-10, INV-20, INV-27 y transiciones de estado.
CREATE OR REPLACE FUNCTION participations_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st mission_status;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = NEW.organization_id
                 AND user_id = NEW.user_id AND role = 'rescuer' AND status = 'active') THEN
    RAISE EXCEPTION 'Solo un rescatista activo puede participar en una misión' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.origin = 'volunteer' THEN
      SELECT status INTO st FROM missions WHERE id = NEW.mission_id;
      IF st IS DISTINCT FROM 'active' THEN                                -- RN-15
        RAISE EXCEPTION 'RN-15: solo se puede uno ofrecer en una misión activa' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      IF NEW.status <> 'pending' THEN
        RAISE EXCEPTION 'Una oferta nace Pendiente' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
  ELSE
    IF OLD.status <> NEW.status AND NOT (
         (OLD.status = 'pending'      AND NEW.status IN ('accepted', 'not_selected', 'withdrawn')) OR
         (OLD.status = 'accepted'     AND NEW.status = 'removed') OR
         (OLD.status = 'not_selected' AND NEW.status IN ('pending', 'accepted')) OR
         (OLD.status = 'withdrawn'    AND NEW.status = 'pending') OR
         (OLD.status = 'removed'      AND NEW.status = 'accepted')) THEN
      RAISE EXCEPTION 'Transición de participación no permitida: % → %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- Al dejar de estar aceptado, la asistencia confirmada deja de valer (INV-27)
    IF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN
      NEW.participated := NULL; NEW.attendance_confirmed_by := NULL; NEW.attendance_confirmed_at := NULL;
    END IF;
  END IF;

  -- INV-20: una oferta (Pendiente) exige el perfil completo
  IF NEW.status = 'pending' AND NOT EXISTS (
       SELECT 1 FROM rescuer_profiles WHERE user_id = NEW.user_id AND status = 'complete') THEN
    RAISE EXCEPTION 'INV-20: el perfil debe estar completo para ofrecerse' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participations_guard_trg BEFORE INSERT OR UPDATE ON participations
  FOR EACH ROW EXECUTE FUNCTION participations_guard();

-- Perfil completo: exige nombre, teléfono y datos sensibles (RF-807).
CREATE OR REPLACE FUNCTION rescuer_profiles_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'complete' AND (OLD.status IS DISTINCT FROM 'complete') THEN
    IF NOT EXISTS (SELECT 1 FROM rescuer_contact WHERE profile_id = NEW.id)
       OR NOT EXISTS (SELECT 1 FROM rescuer_sensitive WHERE profile_id = NEW.id) THEN
      RAISE EXCEPTION 'Perfil incompleto: faltan teléfono o datos sensibles' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rescuer_profiles_guard_trg BEFORE UPDATE OF status ON rescuer_profiles
  FOR EACH ROW EXECUTE FUNCTION rescuer_profiles_guard();

-- El certificado de un curso es un archivo de ese rescatista con finalidad "certificate".
CREATE OR REPLACE FUNCTION skills_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.certificate_file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM files f JOIN rescuer_profiles p ON p.user_id = f.owner_user_id
       WHERE f.id = NEW.certificate_file_id AND f.purpose = 'certificate' AND p.id = NEW.profile_id) THEN
    RAISE EXCEPTION 'El certificado debe ser un archivo propio con finalidad certificate' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER skills_guard_trg BEFORE INSERT OR UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION skills_guard();

-- Auditoría de solo añadir.
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El registro de auditoría es de solo añadir' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_append_only_trg BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
