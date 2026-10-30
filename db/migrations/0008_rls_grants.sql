-- 0008 · Permisos, funciones de identidad y Row Level Security
-- Modelo: cada tabla de negocio tiene una política RESTRICTIVA de organización (INV-01) más políticas
-- PERMISIVAS por rol. El propietario (onway_owner) no está sujeto a RLS: lo usan las migraciones,
-- la carga de datos de ejemplo y las funciones SECURITY DEFINER de más abajo. La aplicación nunca lo usa.

-- ---------- Funciones SECURITY DEFINER (propiedad de onway_owner) ----------

-- Evitan recursión entre políticas y dan acceso controlado a lo que las políticas no pueden expresar.

CREATE OR REPLACE FUNCTION version_is_validated(p_version uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM route_versions WHERE id = p_version AND status = 'validated') $$;

-- Inicio de sesión: la búsqueda por correo ocurre antes de conocer la organización.
CREATE OR REPLACE FUNCTION auth_find_user(p_email citext)
  RETURNS TABLE (id uuid, password_hash text, account_status account_status, locked_until timestamptz,
                 failed_logins smallint, organization_id uuid, role member_role, locale text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.password_hash, u.account_status, u.locked_until, u.failed_logins, m.organization_id, m.role, u.locale
  FROM users u LEFT JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
  WHERE u.email = p_email AND u.anonymized_at IS NULL $$;

-- Registro (RF-104): crea usuario Pendiente y solicitud. Un código inválido y un correo repetido
-- devuelven el mismo error genérico.
CREATE OR REPLACE FUNCTION auth_register(p_email citext, p_password_hash text, p_display_name text, p_invite_code text, p_locale text)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_user uuid;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE invite_code = p_invite_code AND status = 'active';
  IF v_org IS NULL OR EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
    RAISE EXCEPTION 'No se pudo completar el registro' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO users (email, password_hash, display_name, locale, account_status)
    VALUES (p_email, p_password_hash, p_display_name, p_locale, 'pending') RETURNING id INTO v_user;
  INSERT INTO signup_requests (organization_id, user_id) VALUES (v_org, v_user);
  INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id)
    VALUES (v_org, 'signup_request', v_user, 'signup_requested', v_user);
  RETURN v_user;
END $$;

-- Lectura de datos sensibles por el administrador: la única vía. Deja la auditoría en la misma
-- transacción (INV-19), así que no puede haber una lectura sin registro.
CREATE OR REPLACE FUNCTION read_rescuer_sensitive(p_profile uuid)
  RETURNS TABLE (document_type document_type, document_enc bytea, address_enc bytea, key_id smallint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_subject uuid;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede consultar datos sensibles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.user_id INTO v_subject FROM rescuer_profiles p WHERE p.id = p_profile AND p.organization_id = app_org_id();
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'Perfil no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id)
    VALUES (app_org_id(), 'rescuer_sensitive', p_profile, 'sensitive_data_read', app_user_id(), v_subject);
  RETURN QUERY SELECT s.document_type, s.document_enc, s.address_enc, s.key_id
               FROM rescuer_sensitive s WHERE s.profile_id = p_profile;
END $$;


-- Registro de intentos de acceso (antes de que exista sesión, no hay app.user_id).
CREATE OR REPLACE FUNCTION auth_record_attempt(p_user uuid, p_success boolean, p_max_failures int DEFAULT 5, p_lock_minutes int DEFAULT 15)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_success THEN
    UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = p_user;
  ELSE
    UPDATE users SET failed_logins = failed_logins + 1,
                     locked_until = CASE WHEN failed_logins + 1 >= p_max_failures
                                         THEN now() + make_interval(mins => p_lock_minutes) ELSE locked_until END
    WHERE id = p_user;
  END IF;
END $$;

-- Aprobar o rechazar una solicitud de alta (RF-106, INV-25, INV-29). Todo en una transacción.
CREATE OR REPLACE FUNCTION admin_decide_signup(p_user uuid, p_approve boolean, p_role member_role DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador decide solicitudes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM signup_requests WHERE user_id = p_user AND organization_id = app_org_id() AND status = 'pending') THEN
    RAISE EXCEPTION 'No hay una solicitud pendiente de ese usuario' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_approve AND p_role IS NULL THEN
    RAISE EXCEPTION 'Al aprobar hay que elegir un rol' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE signup_requests
     SET status = CASE WHEN p_approve THEN 'approved'::request_status ELSE 'rejected'::request_status END,
         decided_by = app_user_id(), decided_at = now(), granted_role = CASE WHEN p_approve THEN p_role END
   WHERE user_id = p_user;
  UPDATE users SET account_status = CASE WHEN p_approve THEN 'active'::account_status ELSE 'rejected'::account_status END
   WHERE id = p_user RETURNING display_name INTO v_name;

  IF p_approve THEN
    INSERT INTO memberships (organization_id, user_id, role) VALUES (app_org_id(), p_user, p_role);
    IF p_role = 'rescuer' THEN
      INSERT INTO rescuer_profiles (organization_id, user_id, full_name) VALUES (app_org_id(), p_user, v_name);
    END IF;
  END IF;
  INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id, detail)
    VALUES (app_org_id(), 'signup_request', p_user,
            CASE WHEN p_approve THEN 'signup_approved' ELSE 'signup_rejected' END,
            app_user_id(), p_user, jsonb_build_object('role', p_role));
END $$;

-- Desactivar o reactivar una cuenta (el estado de cuenta no es editable directamente por la aplicación).
CREATE OR REPLACE FUNCTION admin_set_account_status(p_user uuid, p_status account_status)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador cambia el estado de una cuenta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'Estado no permitido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = p_user AND organization_id = app_org_id()) THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE users SET account_status = p_status WHERE id = p_user;
  UPDATE memberships SET status = CASE WHEN p_status = 'active' THEN 'active'::member_status ELSE 'disabled'::member_status END
   WHERE user_id = p_user AND organization_id = app_org_id();
  IF p_status = 'disabled' THEN DELETE FROM sessions WHERE user_id = p_user; END IF;
  INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id, detail)
    VALUES (app_org_id(), 'user', p_user, 'account_' || p_status::text, app_user_id(), p_user, '{}');
END $$;

-- Eliminar los datos propios (RF-812, INV-22, flujo 8.10). Conserva participaciones y auditoría.
-- Devuelve las claves de almacenamiento de los certificados para que la aplicación borre los archivos.
CREATE OR REPLACE FUNCTION delete_own_rescuer_data() RETURNS SETOF text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile uuid;
BEGIN
  SELECT id INTO v_profile FROM rescuer_profiles WHERE user_id = app_user_id() AND organization_id = app_org_id() AND status <> 'deleted';
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'No hay un perfil que eliminar' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY UPDATE files SET deleted_at = now()
                WHERE owner_user_id = app_user_id() AND purpose = 'certificate' AND deleted_at IS NULL RETURNING storage_key;
  DELETE FROM skills WHERE profile_id = v_profile;
  DELETE FROM rescuer_contact   WHERE profile_id = v_profile;
  DELETE FROM rescuer_sensitive WHERE profile_id = v_profile;
  UPDATE rescuer_profiles SET status = 'deleted', deleted_at = now(), completed_at = NULL, full_name = 'Participante anónimo'
   WHERE id = v_profile;
  UPDATE users SET email = 'eliminado-' || id || '@invalid.onway', display_name = 'Participante anónimo',
                   password_hash = '!', account_status = 'disabled', anonymized_at = now()
   WHERE id = app_user_id();
  UPDATE memberships SET status = 'disabled' WHERE user_id = app_user_id();
  DELETE FROM sessions WHERE user_id = app_user_id();
  INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id)
    VALUES (app_org_id(), 'rescuer_profile', v_profile, 'personal_data_deleted', app_user_id(), app_user_id());
END $$;

REVOKE ALL ON FUNCTION auth_find_user(citext), auth_register(citext, text, text, text, text),
                       read_rescuer_sensitive(uuid), version_is_validated(uuid), auth_record_attempt(uuid, boolean, int, int),
                       admin_decide_signup(uuid, boolean, member_role), admin_set_account_status(uuid, account_status),
                       delete_own_rescuer_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(citext), auth_register(citext, text, text, text, text),
                          read_rescuer_sensitive(uuid), version_is_validated(uuid), auth_record_attempt(uuid, boolean, int, int),
                          admin_decide_signup(uuid, boolean, member_role), admin_set_account_status(uuid, account_status),
                          delete_own_rescuer_data() TO onway_app;

-- ---------- Concesiones ----------

GRANT USAGE ON SCHEMA public TO onway_app, onway_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO onway_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM onway_app;
-- users: la aplicación solo cambia sus datos de perfil y su contraseña. El estado de cuenta, el correo y los
-- intentos de acceso cambian únicamente a través de las funciones SECURITY DEFINER de arriba.
REVOKE INSERT, UPDATE, DELETE ON users FROM onway_app;
GRANT UPDATE (display_name, locale, password_hash) ON users TO onway_app;
-- Las solicitudes y las membresías de alta se crean por funciones; la aplicación solo las lee.
REVOKE INSERT, UPDATE, DELETE ON signup_requests FROM onway_app;
REVOKE ALL ON rescuer_sensitive FROM onway_app;                 -- se reescribe abajo con permisos mínimos
GRANT SELECT, INSERT, UPDATE, DELETE ON rescuer_sensitive TO onway_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO onway_app;
-- La plataforma solo ve identidad: nunca perfiles, contacto, datos sensibles ni certificados.
GRANT SELECT, INSERT, UPDATE ON organizations, users, memberships TO onway_platform;

-- ---------- Políticas ----------

-- Plantilla de aislamiento por organización (restrictiva) para toda tabla con organization_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','signup_requests','files','rescuer_profiles','rescuer_contact','rescuer_sensitive','skills',
    'teams','team_members','missions','mission_points','mission_team_assignments','participations',
    'calculation_jobs','routes','route_versions','route_segments','mission_routes','avoid_zones','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I AS RESTRICTIVE FOR ALL USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())', t);
  END LOOP;
END $$;

-- organizations: cada una se ve a sí misma; solo el administrador la edita.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_select ON organizations FOR SELECT TO onway_app USING (id = app_org_id());
CREATE POLICY org_update ON organizations FOR UPDATE TO onway_app USING (id = app_org_id() AND app_is_admin()) WITH CHECK (id = app_org_id());
CREATE POLICY org_platform ON organizations FOR ALL TO onway_platform USING (true) WITH CHECK (true);

-- users: la propia fila; el personal ve a los miembros de su organización; el administrador, además,
-- a quienes tienen solicitud pendiente. Los accesos previos a la sesión usan las funciones de arriba.
-- Quien se registra (auth_register) no pasa por estas políticas: la función pertenece al propietario.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users FOR SELECT TO onway_app USING (
  id = app_user_id()
  OR (app_is_staff() AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.organization_id = app_org_id()))
  OR (app_is_admin() AND EXISTS (SELECT 1 FROM signup_requests s WHERE s.user_id = users.id AND s.organization_id = app_org_id())));
CREATE POLICY users_update_self ON users FOR UPDATE TO onway_app USING (id = app_user_id()) WITH CHECK (id = app_user_id());
CREATE POLICY users_platform ON users FOR ALL TO onway_platform USING (true) WITH CHECK (true);

-- sesiones y caché no pertenecen a una organización: sin RLS (solo guardan hashes y datos públicos).

-- memberships: el personal las ve; el rescatista, la suya; solo el administrador cambia un rol (INV-29). Las altas, por admin_decide_signup().
CREATE POLICY memberships_select ON memberships FOR SELECT TO onway_app USING (app_is_staff() OR user_id = app_user_id());
CREATE POLICY memberships_admin  ON memberships FOR UPDATE TO onway_app USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY memberships_platform ON memberships FOR ALL TO onway_platform USING (true) WITH CHECK (true);

CREATE POLICY signup_admin ON signup_requests FOR SELECT TO onway_app USING (app_is_admin());

-- rescuer_profiles: nombre y estado. Propio, coordinadores y administrador.
CREATE POLICY profiles_select ON rescuer_profiles FOR SELECT TO onway_app USING (app_is_staff() OR user_id = app_user_id());
CREATE POLICY profiles_insert ON rescuer_profiles FOR INSERT TO onway_app WITH CHECK (app_is_admin() OR user_id = app_user_id());
CREATE POLICY profiles_update ON rescuer_profiles FOR UPDATE TO onway_app USING (app_is_admin() OR user_id = app_user_id()) WITH CHECK (app_is_admin() OR user_id = app_user_id());

-- rescuer_contact (INV-28): propio, administrador y coordinadores con una participación Pendiente o Aceptada.
CREATE POLICY contact_select ON rescuer_contact FOR SELECT TO onway_app USING (
  EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = rescuer_contact.profile_id AND p.user_id = app_user_id())
  OR app_is_admin()
  OR (app_role() = 'coordinator' AND EXISTS (
        SELECT 1 FROM rescuer_profiles p JOIN participations pa ON pa.user_id = p.user_id AND pa.organization_id = p.organization_id
        WHERE p.id = rescuer_contact.profile_id AND pa.status IN ('pending', 'accepted'))));
CREATE POLICY contact_write ON rescuer_contact FOR ALL TO onway_app
  USING (EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = rescuer_contact.profile_id AND p.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = rescuer_contact.profile_id AND p.user_id = app_user_id()));

-- rescuer_sensitive (INV-18): solo el propio. El administrador pasa por read_rescuer_sensitive().
CREATE POLICY sensitive_own ON rescuer_sensitive FOR ALL TO onway_app
  USING (EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = rescuer_sensitive.profile_id AND p.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = rescuer_sensitive.profile_id AND p.user_id = app_user_id()));

-- skills: lectura propia y del personal; escritura solo propia.
CREATE POLICY skills_select ON skills FOR SELECT TO onway_app USING (
  app_is_staff() OR EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = skills.profile_id AND p.user_id = app_user_id()));
CREATE POLICY skills_write ON skills FOR ALL TO onway_app
  USING (EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = skills.profile_id AND p.user_id = app_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.id = skills.profile_id AND p.user_id = app_user_id()));

-- files: certificados propios o, para el personal, cualquiera de la organización (la apertura se audita en la aplicación, INV-26).
CREATE POLICY files_select ON files FOR SELECT TO onway_app USING (app_is_staff() OR owner_user_id = app_user_id());
CREATE POLICY files_insert ON files FOR INSERT TO onway_app WITH CHECK (
  (owner_user_id = app_user_id() AND purpose = 'certificate') OR (app_is_staff() AND purpose = 'route_import'));
CREATE POLICY files_update ON files FOR UPDATE TO onway_app USING (owner_user_id = app_user_id() OR app_is_staff()) WITH CHECK (owner_user_id = app_user_id() OR app_is_staff());

-- teams y miembros: gestiona el personal (propuesto, Q-12); el rescatista ve los suyos.
CREATE POLICY teams_select ON teams FOR SELECT TO onway_app USING (
  app_is_staff() OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = teams.id AND tm.user_id = app_user_id()));
CREATE POLICY teams_write  ON teams FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY team_members_select ON team_members FOR SELECT TO onway_app USING (app_is_staff() OR user_id = app_user_id());
CREATE POLICY team_members_write  ON team_members FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());

-- missions (INV-08): el rescatista no ve las que están en planificación.
CREATE POLICY missions_select ON missions FOR SELECT TO onway_app USING (app_is_staff() OR status IN ('active', 'closed'));
CREATE POLICY missions_write  ON missions FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());

-- Hijas de la misión: visibles si la misión lo es (la política de missions se aplica dentro del EXISTS).
CREATE POLICY points_select ON mission_points FOR SELECT TO onway_app USING (EXISTS (SELECT 1 FROM missions m WHERE m.id = mission_points.mission_id));
CREATE POLICY points_write  ON mission_points FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY assignments_staff ON mission_team_assignments FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());

-- participations (INV-09, INV-10): el rescatista solo ve las suyas; puede crear su oferta y retirarla o repetirla,
-- pero nunca pasar a Aceptado.
CREATE POLICY part_select ON participations FOR SELECT TO onway_app USING (app_is_staff() OR user_id = app_user_id());
CREATE POLICY part_staff  ON participations FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY part_offer  ON participations FOR INSERT TO onway_app
  WITH CHECK (user_id = app_user_id() AND origin = 'volunteer' AND status = 'pending');
CREATE POLICY part_withdraw ON participations FOR UPDATE TO onway_app
  USING (user_id = app_user_id() AND status IN ('pending', 'withdrawn'))
  WITH CHECK (user_id = app_user_id() AND status IN ('pending', 'withdrawn'));

-- Rutas: el personal lo ve todo. El rescatista, solo lo fijado (y validado) en misiones que ya puede ver (INV-05).
CREATE POLICY routes_staff ON routes FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY routes_rescuer ON routes FOR SELECT TO onway_app USING (
  EXISTS (SELECT 1 FROM mission_routes mr WHERE mr.route_id = routes.id));
CREATE POLICY versions_staff ON route_versions FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY versions_rescuer ON route_versions FOR SELECT TO onway_app USING (
  status = 'validated' AND EXISTS (SELECT 1 FROM mission_routes mr WHERE mr.pinned_version_id = route_versions.id));
CREATE POLICY segments_staff ON route_segments FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY segments_rescuer ON route_segments FOR SELECT TO onway_app USING (
  EXISTS (SELECT 1 FROM route_versions v WHERE v.id = route_segments.version_id));
CREATE POLICY mroutes_staff ON mission_routes FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY mroutes_rescuer ON mission_routes FOR SELECT TO onway_app USING (
  EXISTS (SELECT 1 FROM missions m WHERE m.id = mission_routes.mission_id) AND version_is_validated(pinned_version_id));

-- Solo personal: trabajos de cálculo y zonas a evitar (Q-05, opción simple).
CREATE POLICY jobs_staff  ON calculation_jobs FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());
CREATE POLICY zones_staff ON avoid_zones      FOR ALL TO onway_app USING (app_is_staff()) WITH CHECK (app_is_staff());

-- audit_log: el administrador lee toda la de su organización; el rescatista, los accesos a sus datos.
-- Cualquiera escribe una línea suya (el actor siempre es quien tiene la sesión).
CREATE POLICY audit_select ON audit_log FOR SELECT TO onway_app USING (app_is_admin() OR subject_user_id = app_user_id());
CREATE POLICY audit_insert ON audit_log FOR INSERT TO onway_app WITH CHECK (actor_user_id = app_user_id());
