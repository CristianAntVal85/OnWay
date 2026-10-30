\set QUIET on
\set A 'a0000000-0000-0000-0000-000000000001'
\set B 'b0000000-0000-0000-0000-000000000002'

-- ===== AISLAMIENTO Y VISIBILIDAD (RLS) =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.count_is('sin contexto no se ve ninguna misión','SELECT 1 FROM missions',0);
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000c1','coordinator');
SELECT t.count_is('INV-01 coordinador A ve sus 2 misiones','SELECT 1 FROM missions',2);
SELECT t.count_is('INV-01 coordinador A no ve rutas de B','SELECT 1 FROM routes WHERE organization_id = ''b0000000-0000-0000-0000-000000000002''',0);
SELECT t.count_is('coordinador ve nombres de los 4 perfiles propios de la org (3 rescatistas)','SELECT 1 FROM rescuer_profiles',3);
SELECT t.count_is('INV-18 coordinador no lee datos sensibles','SELECT 1 FROM rescuer_sensitive',0);
SELECT t.count_is('INV-28 coordinador ve el teléfono solo de quien tiene participación (rescatista 1)','SELECT 1 FROM rescuer_contact',1);
SELECT t.count_is('coordinador ve las habilidades del personal (0 datos pero sin error)','SELECT 1 FROM skills',0);
SELECT t.count_is('usuarios visibles al coordinador = miembros de la org (5)','SELECT 1 FROM users',5);
SELECT t.fails('coordinador no puede aprobar solicitudes','SELECT admin_decide_signup(''00000000-0000-0000-0000-000000000003'', true, ''rescuer'')');
SELECT t.fails('coordinador no puede leer sensibles por función','SELECT * FROM read_rescuer_sensitive(''c0000000-0000-0000-0000-000000000001'')');
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'B','00000000-0000-0000-0000-0000000000cb','coordinator');
SELECT t.count_is('INV-01 coordinador B ve 1 misión','SELECT 1 FROM missions',1);
SELECT t.count_is('INV-01 coordinador B no ve participaciones de A','SELECT 1 FROM participations',0);
SELECT t.fails('INV-01 no puede insertar una misión en la org A','INSERT INTO missions (organization_id,name,coordinator_id,target,target_source,created_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''Intrusa'',''00000000-0000-0000-0000-0000000000cb'',''POINT Z (0 0 0)'',''map'',''00000000-0000-0000-0000-0000000000cb'')');
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-000000000001','rescuer');
SELECT t.count_is('INV-08 el rescatista no ve la misión en planificación','SELECT 1 FROM missions',1);
SELECT t.count_is('rescatista solo ve su propio usuario','SELECT 1 FROM users',1);
SELECT t.count_is('INV-18 rescatista lee sus propios datos sensibles','SELECT 1 FROM rescuer_sensitive',1);
SELECT t.count_is('rescatista no ve el contacto ajeno, solo el suyo','SELECT 1 FROM rescuer_contact',1);
SELECT t.count_is('rescatista ve su participación y no la de otros','SELECT 1 FROM participations',1);
SELECT t.count_is('INV-05 rescatista ve 1 mission_route (versión validada) y no la del borrador','SELECT 1 FROM mission_routes',1);
SELECT t.count_is('INV-05 rescatista ve solo la versión validada fijada','SELECT 1 FROM route_versions',1);
SELECT t.count_is('rescatista ve solo la ruta fijada (1)','SELECT 1 FROM routes',1);
SELECT t.count_is('rescatista ve los puntos de la misión activa','SELECT 1 FROM mission_points',2);
SELECT t.count_is('rescatista ve su equipo','SELECT 1 FROM teams',1);
SELECT t.fails('rescatista no crea misiones','INSERT INTO missions (organization_id,name,coordinator_id,target,target_source,created_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''Mia'',''00000000-0000-0000-0000-0000000000c1'',''POINT Z (0 0 0)'',''map'',''00000000-0000-0000-0000-000000000001'')');
SELECT t.rows_changed('rescatista no puede editar rutas (0 filas)','UPDATE routes SET name=''X''',0);
SELECT t.fails('rescatista no puede autoaprobarse (UPDATE users.account_status)','UPDATE users SET account_status=''active'' WHERE id=''00000000-0000-0000-0000-000000000001''');
SELECT t.works('rescatista puede cambiar su idioma','UPDATE users SET locale=''fr'' WHERE id=''00000000-0000-0000-0000-000000000001''');
ROLLBACK;

-- ===== PARTICIPACIÓN =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-000000000002','rescuer');
SELECT t.works('rescatista 2 se ofrece a la misión activa','INSERT INTO participations (organization_id,mission_id,user_id,status,origin,offered_at) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''00000000-0000-0000-0000-000000000002'',''pending'',''volunteer'',now())');
SELECT t.fails('INV-09 no puede ofrecerse a misión en planificación','INSERT INTO participations (organization_id,mission_id,user_id,status,origin,offered_at) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000002'',''pending'',''volunteer'',now())');
SELECT t.fails('INV-09 no puede ofrecer a otro rescatista','INSERT INTO participations (organization_id,mission_id,user_id,status,origin,offered_at) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''00000000-0000-0000-0000-000000000003'',''pending'',''volunteer'',now())');
SELECT t.fails('INV-10 no puede crear su participación como Aceptado','INSERT INTO participations (organization_id,mission_id,user_id,status,origin,offered_at,decided_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''00000000-0000-0000-0000-000000000002'',''accepted'',''volunteer'',now(),''00000000-0000-0000-0000-000000000002'')');
SELECT t.fails('INV-10 no puede autoaceptarse','UPDATE participations SET status=''accepted'', decided_by=user_id WHERE user_id=''00000000-0000-0000-0000-000000000002''');
SELECT t.rows_changed('puede retirar su oferta','UPDATE participations SET status=''withdrawn'' WHERE user_id=''00000000-0000-0000-0000-000000000002''',1);
SELECT t.works('puede volver a ofrecerse tras retirarla','UPDATE participations SET status=''pending'' WHERE user_id=''00000000-0000-0000-0000-000000000002''');
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-000000000003','rescuer');
SELECT t.fails('INV-20 perfil incompleto no puede ofrecerse','INSERT INTO participations (organization_id,mission_id,user_id,status,origin,offered_at) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''00000000-0000-0000-0000-000000000003'',''pending'',''volunteer'',now())');
ROLLBACK;

-- ===== CICLO DE VIDA Y CIERRE CON CONFIRMACIÓN =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000c1','coordinator');
SELECT t.works('coordinador acepta a la rescatista 1','UPDATE participations SET status=''accepted'', decided_by=''00000000-0000-0000-0000-0000000000c1'', decided_at=now() WHERE user_id=''00000000-0000-0000-0000-000000000001''');
SELECT t.fails('INV-27 no se puede marcar participó en una participación no aceptada','INSERT INTO participations (organization_id,mission_id,user_id,status,origin,participated,attendance_confirmed_by,attendance_confirmed_at) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''00000000-0000-0000-0000-000000000002'',''pending'',''coordinator'',true,''00000000-0000-0000-0000-0000000000c1'',now())');
SELECT t.works('al cerrar: confirma participó = sí','UPDATE participations SET participated=true, attendance_confirmed_by=''00000000-0000-0000-0000-0000000000c1'', attendance_confirmed_at=now() WHERE user_id=''00000000-0000-0000-0000-000000000001'' AND status=''accepted''');
SELECT t.works('cierra la misión','UPDATE missions SET status=''closed'', closed_at=now() WHERE id=''e0000000-0000-0000-0000-000000000002''');
SELECT t.fails('INV-11 no se añaden puntos a una misión cerrada','INSERT INTO mission_points (organization_id,mission_id,kind,name,geom) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''origin'',''Tarde'',''P'')');
SELECT t.fails('INV-11 no se cambian participaciones de una misión cerrada','UPDATE participations SET status=''removed'' WHERE user_id=''00000000-0000-0000-0000-000000000001''');
SELECT t.fails('INV-11 no se edita una misión cerrada','UPDATE missions SET name=''Otro nombre'' WHERE id=''e0000000-0000-0000-0000-000000000002''');
SELECT t.fails('INV-11 no se añaden rutas a una misión cerrada','INSERT INTO mission_routes (organization_id,mission_id,route_id,pinned_version_id,added_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''90000000-0000-0000-0000-000000000001'',''91000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-0000000000c1'')');
SELECT t.count_is('INV-21 historial: 1 participación confirmada','SELECT 1 FROM participations WHERE participated AND user_id=''00000000-0000-0000-0000-000000000001''',1);
SELECT t.works('reabre la misión','UPDATE missions SET status=''active'', closed_at=NULL WHERE id=''e0000000-0000-0000-0000-000000000002''');
SELECT t.works('quita al aceptado','UPDATE participations SET status=''removed'' WHERE user_id=''00000000-0000-0000-0000-000000000001''');
SELECT t.count_is('INV-27 al quitarlo, participó vuelve a NULL','SELECT 1 FROM participations WHERE participated IS NULL AND user_id=''00000000-0000-0000-0000-000000000001''',1);
SELECT t.fails('misión no vuelve a planificación','UPDATE missions SET status=''planning'', activated_at=NULL WHERE id=''e0000000-0000-0000-0000-000000000002''');
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000c1','coordinator');
SELECT t.fails('INV-03 el responsable no puede ser un rescatista','UPDATE missions SET coordinator_id=''00000000-0000-0000-0000-000000000001'' WHERE id=''e0000000-0000-0000-0000-000000000001''');
SELECT t.fails('INV-23 equipo sin localidad','INSERT INTO teams (organization_id,name,locality) VALUES (''a0000000-0000-0000-0000-000000000001'',''Sin sitio'','' '')');
SELECT t.fails('equipo duplicado ignorando mayúsculas','INSERT INTO teams (organization_id,name,locality) VALUES (''a0000000-0000-0000-0000-000000000001'',''equipo NORTE'',''X'')');
SELECT t.fails('nombre de misión abierta duplicado','INSERT INTO missions (organization_id,name,coordinator_id,target,target_source,created_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''MISION ACTIVA'',''00000000-0000-0000-0000-0000000000c1'',''POINT Z (0 0 0)'',''map'',''00000000-0000-0000-0000-0000000000c1'')');
ROLLBACK;

-- ===== RUTAS =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000c1','coordinator');
SELECT t.fails('INV-04 una versión validada no se edita','UPDATE route_versions SET note=''x'' WHERE id=''91000000-0000-0000-0000-000000000001''');
SELECT t.fails('INV-04 una versión validada no se borra','DELETE FROM route_versions WHERE id=''91000000-0000-0000-0000-000000000001''');
SELECT t.fails('INV-04 un borrador no cambia de geometría','UPDATE route_versions SET geom=''OTRA'' WHERE id=''91000000-0000-0000-0000-000000000002''');
SELECT t.fails('INV-04 un borrador no cambia de nota','UPDATE route_versions SET note=''x'' WHERE id=''91000000-0000-0000-0000-000000000002''');
SELECT t.works('un borrador pasa a validada','UPDATE route_versions SET status=''validated'', validated_by=''00000000-0000-0000-0000-0000000000c1'', validated_at=now() WHERE id=''91000000-0000-0000-0000-000000000002''');
SELECT t.fails('validada sin quién ni cuándo','UPDATE route_versions SET status=''validated'' WHERE id=''91000000-0000-0000-0000-000000000003''');
SELECT t.fails('INV-06 fijar una versión de otra ruta','INSERT INTO mission_routes (organization_id,mission_id,route_id,pinned_version_id,added_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000001'',''90000000-0000-0000-0000-000000000001'',''91000000-0000-0000-0000-000000000003'',''00000000-0000-0000-0000-0000000000c1'')');
SELECT t.fails('INV-01 fijar una ruta de otra organización','INSERT INTO mission_routes (organization_id,mission_id,route_id,pinned_version_id,added_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000001'',''90000000-0000-0000-0000-0000000000b1'',''91000000-0000-0000-0000-0000000000b1'',''00000000-0000-0000-0000-0000000000c1'')');
SELECT t.fails('INV-13 la misma ruta dos veces en una misión','INSERT INTO mission_routes (organization_id,mission_id,route_id,pinned_version_id,added_by) VALUES (''a0000000-0000-0000-0000-000000000001'',''e0000000-0000-0000-0000-000000000002'',''90000000-0000-0000-0000-000000000001'',''91000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-0000000000c1'')');
SELECT t.fails('INV-07 no se archiva una ruta usada en misión no cerrada','UPDATE routes SET status=''archived'' WHERE id=''90000000-0000-0000-0000-000000000001''');
SELECT t.fails('origen de ruta debe ser un punto de tipo origen','UPDATE mission_routes SET origin_point_id=''f0000000-0000-0000-0000-000000000002'' WHERE route_id=''90000000-0000-0000-0000-000000000001''');
SELECT t.works('origen válido','UPDATE mission_routes SET origin_point_id=''f0000000-0000-0000-0000-000000000001'' WHERE route_id=''90000000-0000-0000-0000-000000000001''');
ROLLBACK;

-- ===== AUDITORÍA Y DATOS SENSIBLES =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000a1','admin');
SELECT t.count_is('INV-19 el administrador lee sensibles por función (1 fila)','SELECT * FROM read_rescuer_sensitive(''c0000000-0000-0000-0000-000000000001'')',1);
SELECT t.count_is('INV-19 la lectura quedó auditada','SELECT 1 FROM audit_log WHERE action=''sensitive_data_read'' AND subject_user_id=''00000000-0000-0000-0000-000000000001''',1);
SELECT t.count_is('INV-18 el administrador no lee sensibles por SELECT directo','SELECT 1 FROM rescuer_sensitive',0);
SELECT t.fails('auditoría de solo añadir: UPDATE','UPDATE audit_log SET action=''x''');
SELECT t.fails('auditoría de solo añadir: DELETE','DELETE FROM audit_log');
SELECT t.count_is('administrador ve los 5 usuarios de su org','SELECT 1 FROM users',5);
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000a1','admin');
SELECT * FROM read_rescuer_sensitive('c0000000-0000-0000-0000-000000000001') \gset
SELECT t.ctx(:'A','00000000-0000-0000-0000-000000000001','rescuer');
SELECT t.count_is('el rescatista ve quién consultó sus datos (1 acceso)','SELECT 1 FROM audit_log WHERE action=''sensitive_data_read''',1);
SELECT t.ctx(:'A','00000000-0000-0000-0000-000000000002','rescuer');
SELECT t.count_is('otro rescatista no ve esos accesos','SELECT 1 FROM audit_log',0);
ROLLBACK;

-- ===== REGISTRO Y APROBACIÓN =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.works('registro con código válido','SELECT auth_register(''nuevo@a.test'',''hash'',''Nuevo'',''INVITE-AAAAAAAA'',''es'')');
SELECT t.fails('registro con código inválido','SELECT auth_register(''otro@a.test'',''hash'',''Otro'',''NOPE'',''es'')');
SELECT t.fails('registro con correo repetido','SELECT auth_register(''nuevo@a.test'',''hash'',''Otro'',''INVITE-AAAAAAAA'',''es'')');
SELECT t.count_is('auth_find_user devuelve el usuario pendiente sin membresía','SELECT 1 FROM auth_find_user(''nuevo@a.test'') WHERE account_status=''pending'' AND organization_id IS NULL',1);
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000a1','admin');
SELECT t.count_is('el administrador ve la solicitud pendiente','SELECT 1 FROM signup_requests WHERE status=''pending''',1);
SELECT t.count_is('el administrador ve al usuario pendiente','SELECT 1 FROM users WHERE email=''nuevo@a.test''',1);
SELECT t.works('aprueba como rescatista','SELECT admin_decide_signup((SELECT id FROM users WHERE email=''nuevo@a.test''), true, ''rescuer'')');
SELECT t.count_is('se creó la membresía y el perfil incompleto','SELECT 1 FROM memberships m JOIN rescuer_profiles p ON p.user_id=m.user_id WHERE m.user_id=(SELECT id FROM users WHERE email=''nuevo@a.test'') AND p.status=''incomplete''',1);
SELECT t.fails('no se decide dos veces la misma solicitud','SELECT admin_decide_signup((SELECT id FROM users WHERE email=''nuevo@a.test''), false, NULL)');
SELECT t.fails('INV-25 completar el perfil sin datos falla','UPDATE rescuer_profiles SET status=''complete'', completed_at=now() WHERE full_name=''Nuevo''');
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.works('registro','SELECT auth_register(''rechazado@a.test'',''hash'',''Rechazado'',''INVITE-AAAAAAAA'',''es'')');
SELECT t.ctx(:'A','00000000-0000-0000-0000-0000000000a1','admin');
SELECT t.works('rechaza','SELECT admin_decide_signup((SELECT id FROM users WHERE email=''rechazado@a.test''), false, NULL)');
SELECT t.count_is('rechazado: sin membresía','SELECT 1 FROM memberships WHERE user_id=(SELECT id FROM users WHERE email=''rechazado@a.test'')',0);
SELECT t.count_is('rechazado: estado de cuenta rechazado','SELECT 1 FROM auth_find_user(''rechazado@a.test'') WHERE account_status=''rejected''',1);
ROLLBACK;

-- ===== ELIMINAR DATOS PROPIOS =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(:'A','00000000-0000-0000-0000-000000000001','rescuer');
SELECT t.works('elimina sus datos','SELECT * FROM delete_own_rescuer_data()');
SELECT t.count_is('INV-22 la participación sigue existiendo','SELECT 1 FROM participations WHERE user_id=''00000000-0000-0000-0000-000000000001''',1);
SELECT t.count_is('perfil marcado eliminado y anónimo','SELECT 1 FROM rescuer_profiles WHERE status=''deleted'' AND full_name=''Participante anónimo''',1);
SELECT t.count_is('sin teléfono ni sensibles','SELECT 1 FROM rescuer_contact',0);
ROLLBACK;

-- ===== PLATAFORMA =====
BEGIN; SET LOCAL ROLE onway_platform;
SELECT t.works('plataforma crea una organización','INSERT INTO organizations (name,country,invite_code) VALUES (''Org C'',''ES'',''INVITE-CCCCCCCC'')');
SELECT t.fails('plataforma no lee perfiles','SELECT * FROM rescuer_profiles');
SELECT t.fails('plataforma no lee datos sensibles','SELECT * FROM rescuer_sensitive');
SELECT t.fails('plataforma no lee archivos','SELECT * FROM files');
ROLLBACK;



-- ===== RECUPERAR CONTRASEÑA (0009) =====
BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.count_is('pide restablecer: usuario activo recibe fila de envío','SELECT * FROM auth_request_password_reset(''r2@a.test'', decode(''aa01'',''hex''))',1);
SELECT t.count_is('correo desconocido: ninguna fila (no se revela nada)','SELECT * FROM auth_request_password_reset(''nadie@a.test'', decode(''aa02'',''hex''))',0);
SELECT t.fails('la tabla de tokens no se lee directamente','SELECT * FROM password_resets');
SELECT t.fails('la tabla de tokens no se escribe directamente','INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (gen_random_uuid(), decode(''bb01'',''hex''), now() + interval ''1 hour'')');
SELECT t.count_is('límite: la 2.ª y la 3.ª solicitud pasan','SELECT * FROM auth_request_password_reset(''r2@a.test'', decode(''aa04'',''hex'')) UNION ALL SELECT * FROM auth_request_password_reset(''r2@a.test'', decode(''aa05'',''hex''))',2);
SELECT t.count_is('límite: la 4.ª en una hora no genera token','SELECT * FROM auth_request_password_reset(''r2@a.test'', decode(''aa06'',''hex''))',0);
SELECT t.rec('token inexistente: false', auth_consume_password_reset(decode('ffff','hex'), 'nuevo-hash') = false);
SELECT t.rec('token válido: true', auth_consume_password_reset(decode('aa01','hex'), 'hash-nuevo') = true);
SELECT t.count_is('la contraseña cambió','SELECT 1 FROM auth_find_user(''r2@a.test'') WHERE password_hash=''hash-nuevo''',1);
SELECT t.rec('el mismo token no sirve dos veces', auth_consume_password_reset(decode('aa01','hex'), 'otro') = false);
SELECT t.rec('los demás tokens de esa persona quedan anulados', auth_consume_password_reset(decode('aa04','hex'), 'otro') = false);
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.works('token con caducidad corta','SELECT * FROM auth_request_password_reset(''r3@a.test'', decode(''cc01'',''hex''), 1)');
RESET ROLE;
UPDATE password_resets SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = decode('cc01','hex');
SET LOCAL ROLE onway_app;
SELECT t.rec('token caducado: false', auth_consume_password_reset(decode('cc01','hex'), 'x') = false);
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.works('prepara token para cuenta con bloqueo','SELECT * FROM auth_request_password_reset(''r3@a.test'', decode(''dd01'',''hex''))');
RESET ROLE;
UPDATE users SET failed_logins = 5, locked_until = now() + interval '10 minutes' WHERE email = 'r3@a.test';
INSERT INTO sessions (id, user_id, expires_at) VALUES (decode('ee01','hex'), '00000000-0000-0000-0000-000000000003', now() + interval '1 day');
SET LOCAL ROLE onway_app;
SELECT t.rec('consumir token', auth_consume_password_reset(decode('dd01','hex'), 'hash-r3') = true);
SELECT t.count_is('quita el bloqueo por intentos','SELECT 1 FROM auth_find_user(''r3@a.test'') WHERE failed_logins=0 AND locked_until IS NULL',1);
RESET ROLE;
SELECT t.count_is('cierra todas las sesiones','SELECT 1 FROM sessions WHERE user_id=''00000000-0000-0000-0000-000000000003''',0);
SELECT t.count_is('deja rastro en la auditoría','SELECT 1 FROM audit_log WHERE action=''password_reset'' AND subject_user_id=''00000000-0000-0000-0000-000000000003''',1);
ROLLBACK;

BEGIN; SET LOCAL ROLE onway_app;
SELECT t.ctx(NULL,NULL,NULL);
SELECT t.works('cuenta que luego se desactiva: solicitud','SELECT * FROM auth_request_password_reset(''r1@a.test'', decode(''ab01'',''hex''))');
RESET ROLE;
UPDATE users SET account_status='disabled' WHERE email='r1@a.test';
SET LOCAL ROLE onway_app;
SELECT t.rec('cuenta desactivada después de pedir: el token no sirve', auth_consume_password_reset(decode('ab01','hex'), 'x') = false);
SELECT t.count_is('cuenta desactivada: no se pide otro','SELECT * FROM auth_request_password_reset(''r1@a.test'', decode(''ab02'',''hex''))',0);
ROLLBACK;

-- ===== ROLES =====
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('onway_app','onway_platform') LOOP
    PERFORM t.rec('rol ' || r.rolname || ' sin superusuario ni BYPASSRLS', NOT r.rolsuper AND NOT r.rolbypassrls);
  END LOOP;
  PERFORM t.rec('las tablas de negocio con RLS activada = todas menos sessions y forecast_cache',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity AND c.relname <> 'spatial_ref_sys') = 2);
END $$;
