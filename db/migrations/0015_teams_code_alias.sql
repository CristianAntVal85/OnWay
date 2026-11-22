-- 0015 · H5-equipos: código del equipo, lectura de equipos para todos los roles (D-34) y alias de personas (Q-36)
--
-- 1. teams.code: tres caracteres en mayúscula, obligatorio y único en la organización. Los equipos que ya existen reciben el que
--    propone la regla de la web (la primera letra y las consonantes siguientes del nombre de la localidad, sin acentos; si no
--    llega a tres, las letras que siguen; si dos equipos de una organización chocan, el último carácter pasa a ser un dígito del 2 al 9).
-- 2. teams_select: todos los roles de la organización leen los equipos (D-34, B-01). team_members no cambia: el rescatista sigue
--    sin ver quién es miembro de cada equipo.
-- 3. memberships.alias: único por organización sin distinguir mayúsculas. La aplicación NO lo escribe (permiso por columna, como
--    DB-13); solo lo fija set_member_alias, que lo hace una sola vez (el alias es fijo, Q-36).
-- 4. mission_coordinator_alias: lo que el rescatista ve del responsable de una misión, sin abrirle `users` ni `memberships` (D-E3).

-- ---------- 1. teams.code ----------
ALTER TABLE teams ADD COLUMN code text;

DO $$
DECLARE
  t        record;
  v_src    text;
  v_code   text;
  v_try    text;
  v_len    int;
  i        int;
  d        int;
  e        int;
  v_picked int[];
BEGIN
  FOR t IN SELECT id, organization_id, locality FROM teams ORDER BY organization_id, created_at, id LOOP
    v_src := regexp_replace(
               lower(translate(t.locality, 'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñÇç', 'AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuuNnCc')),
               '[^a-z]', '', 'g');
    v_len := char_length(v_src);
    IF v_len = 0 THEN
      v_code := 'XXX';
    ELSE
      v_picked := ARRAY[1];
      FOR i IN 2..v_len LOOP
        EXIT WHEN cardinality(v_picked) >= 3;
        IF substr(v_src, i, 1) !~ '[aeiou]' THEN v_picked := v_picked || i; END IF;
      END LOOP;
      FOR i IN 2..v_len LOOP
        EXIT WHEN cardinality(v_picked) >= 3;
        IF NOT (i = ANY (v_picked)) THEN v_picked := v_picked || i; END IF;
      END LOOP;
      v_code := '';
      FOREACH i IN ARRAY v_picked LOOP v_code := v_code || upper(substr(v_src, i, 1)); END LOOP;
      v_code := rpad(v_code, 3, 'X');
    END IF;

    v_try := v_code;
    IF EXISTS (SELECT 1 FROM teams WHERE organization_id = t.organization_id AND code = v_try) THEN
      v_try := NULL;
      FOR d IN 2..9 LOOP
        IF NOT EXISTS (SELECT 1 FROM teams WHERE organization_id = t.organization_id AND code = left(v_code, 2) || d::text) THEN
          v_try := left(v_code, 2) || d::text;
          EXIT;
        END IF;
      END LOOP;
      IF v_try IS NULL THEN
        <<second>> FOR e IN 0..9 LOOP
          FOR d IN 2..9 LOOP
            IF NOT EXISTS (SELECT 1 FROM teams WHERE organization_id = t.organization_id AND code = left(v_code, 1) || e::text || d::text) THEN
              v_try := left(v_code, 1) || e::text || d::text;
              EXIT second;
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    END IF;
    UPDATE teams SET code = v_try WHERE id = t.id;
  END LOOP;
END $$;

ALTER TABLE teams ALTER COLUMN code SET NOT NULL;
ALTER TABLE teams ADD CONSTRAINT teams_code_chk CHECK (code ~ '^[A-Z0-9]{3}$');
ALTER TABLE teams ADD CONSTRAINT teams_org_code_uq UNIQUE (organization_id, code);

-- ---------- 2. teams_select (D-34) ----------
DROP POLICY teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT TO onway_app USING (organization_id = app_org_id());

-- ---------- 3. memberships.alias ----------
ALTER TABLE memberships ADD COLUMN alias text CHECK (alias IS NULL OR alias ~ '^[a-z]+[0-9]*( [A-Z0-9]{3})?$');
CREATE UNIQUE INDEX memberships_org_alias_uq ON memberships (organization_id, lower(alias)) WHERE alias IS NOT NULL;

-- La aplicación solo escribe el rol (INV-29, solo el administrador por la política); el estado y el alias van por funciones.
REVOKE UPDATE ON memberships FROM onway_app;
GRANT UPDATE (role) ON memberships TO onway_app;

-- set_member_alias(persona, base, código): fija el alias una sola vez y lo devuelve.
--  · sin alias y con base: el primero libre entre `base`, `base2`, `base3`…, con ` CÓDIGO` detrás si llega;
--  · con alias sin código y con código: añade ` CÓDIGO`; si choca, el sufijo numérico va antes del código;
--  · en cualquier otro caso no cambia nada (alias fijo).
-- La llama la propia persona o el personal de su organización; la persona debe tener membresía en ella.
CREATE OR REPLACE FUNCTION set_member_alias(p_user uuid, p_base text, p_code text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org     uuid := app_org_id();
  v_current text;
  v_stem    text;
  v_n       int;
  v_cand    text;
BEGIN
  IF v_org IS NULL OR app_user_id() IS NULL THEN
    RAISE EXCEPTION 'Sin contexto de organización' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (p_user = app_user_id() OR app_is_staff()) THEN
    RAISE EXCEPTION 'Solo la propia persona o el personal fijan un alias' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_base IS NOT NULL AND p_base !~ '^[a-z]+$' THEN
    RAISE EXCEPTION 'Base de alias no válida' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_code IS NOT NULL AND p_code !~ '^[A-Z0-9]{3}$' THEN
    RAISE EXCEPTION 'Código de localidad no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('member_alias:' || v_org::text, 0));
  SELECT alias INTO v_current FROM memberships WHERE organization_id = v_org AND user_id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current IS NULL THEN
    IF p_base IS NULL THEN RETURN NULL; END IF;
    v_stem := p_base;
    v_n := 1;
  ELSIF position(' ' IN v_current) = 0 AND p_code IS NOT NULL THEN
    v_stem := substring(v_current FROM '^[a-z]+');
    v_n := COALESCE(NULLIF(substring(v_current FROM '[0-9]+$'), '')::int, 1);
  ELSE
    RETURN v_current;
  END IF;

  LOOP
    v_cand := v_stem || CASE WHEN v_n > 1 THEN v_n::text ELSE '' END || CASE WHEN p_code IS NULL THEN '' ELSE ' ' || p_code END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = v_org AND lower(alias) = lower(v_cand) AND user_id <> p_user);
    v_n := v_n + 1;
  END LOOP;
  UPDATE memberships SET alias = v_cand WHERE organization_id = v_org AND user_id = p_user;
  RETURN v_cand;
END $$;

-- mission_coordinator_alias(misión): el alias del responsable, si la misión es de la organización de quien llama y la puede ver
-- (el personal siempre; un rescatista solo si está activa o cerrada, RN-16). Si no, NULL.
CREATE OR REPLACE FUNCTION mission_coordinator_alias(p_mission uuid)
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cm.alias
    FROM missions m
    JOIN memberships cm ON cm.organization_id = m.organization_id AND cm.user_id = m.coordinator_id
   WHERE m.id = p_mission AND m.organization_id = app_org_id() AND (app_is_staff() OR m.status IN ('active', 'closed'))
$$;

REVOKE ALL ON FUNCTION set_member_alias(uuid, text, text), mission_coordinator_alias(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_member_alias(uuid, text, text), mission_coordinator_alias(uuid) TO onway_app;
