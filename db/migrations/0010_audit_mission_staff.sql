-- 0010 · El personal lee el historial de las misiones de su organización (H1, listMissionHistory)
-- La política audit_select (0008) solo deja leer audit_log al administrador y a quien es sujeto de la fila. El
-- coordinador necesita el historial de sus misiones (RN-05, RF-205). Esta política es permisiva y de solo lectura:
-- añade únicamente las filas con entity_type = 'mission'; el resto de la auditoría (accesos a datos sensibles,
-- apertura de certificados, cambios de cuenta) sigue siendo del administrador. El filtro de organización
-- (org_isolation, restrictiva) se sigue aplicando encima.
CREATE POLICY audit_mission_staff ON audit_log FOR SELECT TO onway_app
  USING (app_is_staff() AND entity_type = 'mission');
