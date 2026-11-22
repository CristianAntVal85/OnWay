-- 0014 · H5-usuarios: reasignar las misiones de un coordinador (RN-11, INV-03, INV-11, Q-14)
--
-- El administrador no escribe misiones (0011: solo el coordinador). Pero al desactivar a un coordinador, o quitarle el rol,
-- sus misiones no cerradas necesitan un responsable nuevo (RN-11). Esta función es el único camino: corre con los privilegios
-- de su dueño, exige ser administrador y deja que `missions_guard` siga aplicando INV-03 (el destino es un coordinador activo)
-- e INV-11 (una misión cerrada no se toca: por eso solo se reasignan las no cerradas).
-- Cada misión reasignada deja en `audit_log` una línea `mission_updated` con el mismo formato que `updateMission`.

CREATE OR REPLACE FUNCTION admin_reassign_missions(p_from uuid, p_to uuid)
  RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mission uuid;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador reasigna misiones' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_to = p_from THEN
    RAISE EXCEPTION 'El nuevo responsable debe ser otra persona' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships
                 WHERE organization_id = app_org_id() AND user_id = p_to AND status = 'active' AND role = 'coordinator') THEN
    RAISE EXCEPTION 'El nuevo responsable debe ser un coordinador activo de la organización' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_mission IN
    UPDATE missions SET coordinator_id = p_to
     WHERE organization_id = app_org_id() AND coordinator_id = p_from AND status <> 'closed'
    RETURNING id
  LOOP
    INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, detail)
      VALUES (app_org_id(), 'mission', v_mission, 'mission_updated', app_user_id(),
              jsonb_build_object('fields', jsonb_build_array('coordinatorId'), 'reassignedFrom', p_from, 'reassignedTo', p_to));
    RETURN NEXT v_mission;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION admin_reassign_missions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reassign_missions(uuid, uuid) TO onway_app;
