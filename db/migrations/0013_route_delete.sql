-- 0013 · Issue #17: eliminar rutas archivadas y sin misión
--
-- INV-04 decía que una versión validada no se borra nunca. Se mantiene todo salvo una excepción: una versión
-- validada se puede borrar si su ruta está archivada y no figura en NINGUNA misión (tampoco cerrada). Lo que decide
-- borrar la ruta entera (versiones, tramos y fila) lo hace la API en una sola transacción; la base de datos solo
-- garantiza que la excepción no se abre en otro caso. Editar una versión validada sigue prohibido siempre.
--
-- La función consulta otras tablas (`routes`, `mission_routes`), así que corre con los privilegios de su dueño, como
-- los demás disparadores de este tipo (0007): debe ver todas las filas aunque quien borra esté limitado por RLS.
-- INV-07 no cambia: `mission_routes.route_id` no tiene `ON DELETE CASCADE`, de modo que una ruta que figura en una
-- misión, cerrada o no, tampoco se puede borrar por esa vía. Las políticas `*_coordinator_delete` de 0011 bastan:
-- solo el coordinador de la organización borra.

CREATE OR REPLACE FUNCTION route_versions_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'validated' AND NOT (
         EXISTS (SELECT 1 FROM routes r WHERE r.id = OLD.route_id AND r.status = 'archived')
         AND NOT EXISTS (SELECT 1 FROM mission_routes mr WHERE mr.route_id = OLD.route_id)) THEN
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
