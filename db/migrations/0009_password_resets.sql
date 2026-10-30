-- 0009 · Recuperar contraseña (Q-33, resuelta: correo transaccional detrás del puerto Mailer).
-- Se guarda solo el hash SHA-256 del token; el token en claro viaja una vez, por correo. Un solo uso, caduca.
-- La tabla no tiene permisos para onway_app: solo se toca a través de las dos funciones de abajo.

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea       NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;   -- sin políticas: nadie la lee salvo el propietario (funciones)

-- Pide un restablecimiento. Devuelve a quién enviar el correo, o NINGUNA fila si no procede
-- (correo desconocido, cuenta rechazada/desactivada/anonimizada, o ya hay 3 solicitudes en la última hora).
-- El API responde 202 igual en todos los casos: no se revela si el correo existe.
CREATE OR REPLACE FUNCTION auth_request_password_reset(p_email citext, p_token_hash bytea, p_ttl_minutes int DEFAULT 60)
  RETURNS TABLE (email text, display_name text, locale text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM users WHERE users.email = p_email AND anonymized_at IS NULL AND account_status IN ('pending', 'active');
  IF NOT FOUND THEN RETURN; END IF;
  DELETE FROM password_resets WHERE expires_at < now() - interval '1 day';
  IF (SELECT count(*) FROM password_resets WHERE user_id = u.id AND created_at > now() - interval '1 hour') >= 3 THEN RETURN; END IF;
  INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (u.id, p_token_hash, now() + make_interval(mins => p_ttl_minutes));
  RETURN QUERY SELECT u.email::text, u.display_name, u.locale;
END $$;

-- Consume el token y fija la nueva contraseña. Devuelve false si el token no existe, ya se usó o caducó.
-- Cierra todas las sesiones, quita el bloqueo por intentos y anula los demás tokens pendientes de esa persona.
CREATE OR REPLACE FUNCTION auth_consume_password_reset(p_token_hash bytea, p_new_password_hash text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r password_resets%ROWTYPE; v_org uuid;
BEGIN
  SELECT pr.* INTO r FROM password_resets pr JOIN users u ON u.id = pr.user_id
   WHERE pr.token_hash = p_token_hash AND pr.used_at IS NULL AND pr.expires_at > now()
     AND u.anonymized_at IS NULL AND u.account_status IN ('pending', 'active')
   FOR UPDATE OF pr;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE users SET password_hash = p_new_password_hash, failed_logins = 0, locked_until = NULL WHERE id = r.user_id;
  UPDATE password_resets SET used_at = now() WHERE user_id = r.user_id AND used_at IS NULL;
  DELETE FROM sessions WHERE user_id = r.user_id;
  SELECT organization_id INTO v_org FROM memberships WHERE user_id = r.user_id AND status = 'active';
  IF v_org IS NOT NULL THEN
    INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id)
      VALUES (v_org, 'user', r.user_id, 'password_reset', r.user_id, r.user_id);
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION auth_request_password_reset(citext, bytea, int), auth_consume_password_reset(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_request_password_reset(citext, bytea, int), auth_consume_password_reset(bytea, text) TO onway_app;
