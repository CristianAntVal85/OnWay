# H5-perfil · Alta y perfil del rescatista, datos sensibles cifrados y cuenta — Plan

Estado: **aprobado por el usuario (2026-11-22)**, con P1, P2 y D-P1 a D-P8 · Rama: `hito/H5-perfil` (desde `main` en `94bd5bc`).

**Es la primera de tres partes del resto de H5** (decisión del usuario, 2026-11-22), partido por demostración como `H5-acceso` (issue #9):

| Parte | Operaciones (conservan `x-milestone: H5`) | Montadas al acabar |
|---|---|---|
| `H5-acceso` (hecho) | `register`, `forgotPassword`, `resetPassword`, `listSignupRequests`, `decideSignupRequests`, `getInviteCode`, `rotateInviteCode` | 58 |
| **`H5-perfil` (este)** | `getMyProfile`, `updateMyProfile`, `getMySensitive`, `updateMe`, `changePassword` | **63** |
| `H5-habilidades` | `listMySkills`, `createMySkill`, `updateMySkill`, `deleteMySkill`, `getCertificateLink` | 68 |
| `H5-equipos` | `listUsers`, `getUser`, `updateUser`, `listTeams`, `createTeam`, `getTeam`, `updateTeam`, `addTeamMembers`, `removeTeamMember` y **el alias de Q-36** (decisión del usuario, 2026-11-22) | 77 |

## 0. Decisiones tomadas por el usuario (2026-11-22)

- **P1. Alta obligatoria en la web**, como dicen RF-101 y doc 02 §3.9. Con el perfil incompleto, cualquier vista lleva a «Mi perfil»; solo quedan «Mi perfil» y «Cuenta». El servidor no bloquea lecturas, porque RN-20 solo impide ofrecerse (H6). **Consecuencia:** la semilla completa `rescatista1` a `rescatista5` con datos ficticios cifrados, y `rescatista6` queda incompleto para el caso «completa tu perfil» (smoke, `roles.spec.ts`).
- **P2. Q-36 (alias) pasa a `H5-equipos`.** Aquí no se toca.

## 1. Alcance

- **Requisitos:** RF-807 (alta del rescatista, sin cursos), RF-806 (perfil propio: verlo y editarlo; lo que ven otros, en `H5-equipos`), RF-810 (protección de datos sensibles: cifrado, enmascarado y lectura propia), RF-101 (la parte de «llega antes al formulario de alta»), RF-102 («no puede cambiar su propio rol»), RF-812 (solo «ver y corregir sus datos»; eliminar y exportar son de H6). Bocetos 2 (alta) y 15 (Mi perfil, sin cursos, historial ni privacidad).
- **Invariantes:** **INV-18**, **INV-24**, **INV-31** e **INV-32**. INV-25 ya está construido y probado (`H5-acceso`) y aquí solo se comprueba que no se rompe.
- **Operaciones (5):** `getMyProfile`, `updateMyProfile`, `getMySensitive`, `updateMe`, `changePassword`.
- **Fuera:**
  - Cursos y habilidades, y el certificado (`H5-habilidades`). La lista `skills` de `MyProfile` sale con lo que haya en la base, hoy vacía.
  - Ver el perfil de otros (`getUser`, `readUserSensitive`), equipos y alias (`H5-equipos` y H6).
  - Historial, registro de accesos, exportar y eliminar mis datos (H6).
  - Rotar la clave de cifrado: solo se deja preparado con `key_id = 1`.

## 2. Contexto para el implementador

Textos mínimos copiados de los documentos; no hace falta abrir los docs 01–06.

**Requisitos (doc 01)**
- **RF-101:** «Tras iniciar sesión, el usuario llega a la pantalla de inicio (RF-701). Si es rescatista con el perfil incompleto, llega antes al formulario de alta (RF-807).»
- **RF-102:** «Un usuario no puede cambiar su propio rol.»
- **RF-806:** «Lo ve y edita el propio rescatista. Los coordinadores ven nombre, equipo, cursos y habilidades, y contacto, pero no los datos sensibles ni el historial (RN-18, RN-23).»
- **RF-807 (Must) Alta de rescatista.** Campos:
  - nombre completo;
  - teléfono y correo, ambos obligatorios; «el correo es el del inicio de sesión y viene rellenado (D-28)»;
  - documento de identidad (tipo y número): «para DNI y NIE se valida el formato y la letra de control. Se admite pasaporte u otro documento»;
  - dirección completa: calle, número, piso, código postal, localidad, provincia y país;
  - cursos opcionales en el alta (fuera de este hito).
- **RF-810:** «Documento de identidad y dirección solo los ven el propio rescatista y el administrador de organización (D-24) … Nunca aparecen en listas, exportaciones ni respuestas de API pensadas para listas (RN-21).»
- **RF-812:** «El rescatista puede ver y corregir sus datos» (eliminar sus datos es de H6).
- **RN-18:** documento y dirección solo los ven él mismo y el administrador. **RN-20:** sin perfil completo no puede ofrecerse. **RN-23:** teléfono y correo obligatorios; los ven el administrador y los coordinadores.

**Invariantes (doc 03 §10)**
- **INV-18:** «El documento de identidad y la dirección solo los puede leer el propio usuario y un administrador de su organización. Ningún listado ni respuesta de API de listado los devuelve. El coordinador nunca los lee.»
- **INV-24:** «El documento de identidad no puede repetirse dentro de una organización.» En la base: `UNIQUE (organization_id, document_hash)` en `rescuer_sensitive`.
- **INV-31:** «El campo de contacto "correo" de un rescatista es el correo de acceso: no existe un segundo correo editable por separado.»
- **INV-32:** «Nombre, contacto y datos sensibles de un rescatista son tres entidades separadas, cada una con su propia regla de acceso. Ninguna consulta puede traer contacto o sensibles "de paso" al leer el perfil.»

**Flujo «Alta del perfil» (doc 03 §8.8)**
1. En el primer acceso tras la aprobación, la app lleva al formulario antes de cualquier otra vista.
2. Se rellenan nombre completo, teléfono, documento y dirección. El correo viene del usuario (INV-31). Se validan el formato y, para DNI y NIE, la letra de control.
3. Se calcula la huella del documento y se comprueba que no exista ya en la organización (INV-24).
4. Los sensibles se guardan cifrados. El perfil pasa a *Completo* y se registra en auditoría.

**Vista (doc 02 §3.9)**
- **Bloques del alta:**
  - Datos personales: nombre completo; tipo de documento (DNI, NIE, pasaporte, otro); número.
  - Contacto: teléfono, y el correo relleno y no editable.
  - Dirección: calle y número obligatorios, piso opcional; código postal, localidad, provincia y país obligatorios.
- **Aviso fijo:** «Teléfono y correo los ven el administrador y los coordinadores. Documento y dirección se guardan cifrados: los ves tú y el administrador».
- **Mi perfil**, en dos bloques separados:
  - **Datos de contacto**: nombre, teléfono y correo, que no se edita aquí.
  - **Datos sensibles**: documento y dirección, enmascarados.
  - Más **Mis equipos** (solo lectura, con su localidad).
- **Errores:**
  - Documento con formato o letra inválidos: mensaje claro y no se guarda.
  - Documento ya registrado: se rechaza «sin revelar de quién es».
  - Formulario abandonado a medias: el perfil queda incompleto y se pide al volver.
  - Los sensibles salen enmascarados hasta que el propio usuario los pide.
- **Cuenta (doc 02 §2):** idioma, tema y cerrar sesión. Este hito añade nombre visible y cambiar la contraseña.

**Operaciones (contrato `packages/contracts/src/endpoints.ts`, esquemas en `profile.ts` y `auth.ts`)**

| Operación | Firma | Roles | Errores |
|---|---|---|---|
| `getMyProfile` | `GET /my/profile` → 200 `MyProfile {status, fullName, email, phone, document:{type,masked}\|null, addressSummary, skills, teams, missingFields, completedAt}` | rescuer | — |
| `updateMyProfile` | `PATCH /my/profile` cuerpo `{fullName?, phone?, document?:{type,number}, address?:{street,number,floor?,postalCode,locality,province,country}}` (al menos uno; `document` y `address` van completos) → 200 `MyProfile` · *auditado* | rescuer | `INVALID_DOCUMENT` 422, `DOCUMENT_ALREADY_REGISTERED` 409 («no revela de quién es») |
| `getMySensitive` | `GET /my/profile/sensitive` → 200 `{document:{type,number}\|null, address\|null}` · `Cache-Control: no-store` | rescuer | — |
| `updateMe` | `PATCH /auth/me` cuerpo `{displayName?, locale?}` (al menos uno; estricto, así que no admite `role` ni `email`) → 200 `MeResponse` | todos | — |
| `changePassword` | `POST /auth/password/change` cuerpo `{currentPassword, newPassword}` (la nueva cumple `Password` y es distinta) → 204 · cierra las demás sesiones | todos | `INVALID_CREDENTIALS` 401 |

- **Validadores que ya existen** (`packages/contracts/src/validators.ts`): `normalizeDocument`, `isValidDocument`, `maskDocument` (deja los dos últimos caracteres) y `PHONE_PATTERN`. Los usan la web, para el aviso inmediato, y la API, que es la que decide.

**Cifrado (doc 04 §6.3, doc 05 §7)**
- **Algoritmo:** AES-256-GCM en la aplicación, antes de guardar.
- **Formato:** `nonce (12 bytes) ‖ texto cifrado ‖ etiqueta (16 bytes)`. La dirección se cifra como JSON.
- **Datos autenticados adicionales:** `profile_id ‖ nombre del campo`, para que un valor no se pueda copiar a otro perfil.
- **`key_id`:** identifica la clave usada.
- **Huella:** `HMAC-SHA256` con **otra clave**, sobre `tipo ‖ número normalizado`.
- **Dónde viven las claves:** en un archivo de secretos del servidor, fuera de la base y de sus copias. Si se pierde la clave, se pierden documento y dirección: es un riesgo aceptado y va al README.

**Base de datos (sin migración nueva)**
- **Tablas (`0003`):**
  - `rescuer_profiles` (`full_name`, `status` incomplete|complete|deleted, `completed_at`);
  - `rescuer_contact` (`phone`, con el CHECK de `PHONE_PATTERN`);
  - `rescuer_sensitive` (`document_type`, `document_enc`, `document_hash`, `address_enc`, `key_id`).
- **Disparador `rescuer_profiles_guard` (`0007`):** pasar a `complete` exige que existan contacto y sensibles. La restricción `CHECK ((status='complete') = (completed_at IS NOT NULL))` obliga a fijar `completed_at` a la vez.
- **Políticas (`0008`):**
  - `profiles_update`: el propio usuario o el administrador;
  - `contact_write`: solo el propio;
  - `sensitive_own`: solo el propio, en todas las operaciones (el administrador no hace SELECT directo);
  - `users_update_self` con `GRANT UPDATE (display_name, locale, password_hash) ON users`;
  - `sessions` sin seguridad por filas: `logout` ya borra por `id`.

## 3. Qué cambia, por carpeta

**`packages/contracts`**
- Sin esquemas nuevos.
- Notas de las 5 operaciones:
  - formato del enmascarado (`addressSummary` = «•••••, <código postal> <localidad> (<país>)»);
  - qué hace `updateMyProfile`: actualización parcial, y el perfil pasa a `complete` en cuanto no falta nada;
  - `changePassword`: mantiene la sesión actual, borra las demás, y una contraseña actual errónea cuenta como intento fallido;
  - `updateMe`: `locale` es el idioma de la cuenta (el de los correos).
- `changePassword` pasa a `audited: true`.
- Se regeneran el OpenAPI y el doc 06.

**`apps/api`**
- `src/sensitive/` (nuevo):
  - `SensitiveCipher` (AES-256-GCM con AAD y `key_id`) y `DocumentFingerprint` (HMAC), con claves de 32 bytes derivadas por HKDF-SHA256 del archivo de secretos;
  - configuración `SENSITIVE_KEY_FILE` y `DOCUMENT_HASH_KEY_FILE`, que si faltan impiden arrancar;
  - `node:crypto`, sin dependencias nuevas.
- `src/profile/` (nuevo): controlador y servicio de `getMyProfile`, `updateMyProfile` y `getMySensitive`.
  - El enmascarado se calcula al descifrar el propio dato.
  - `INVALID_DOCUMENT` sale del esquema (`message: 'INVALID_DOCUMENT'`).
  - `DOCUMENT_ALREADY_REGISTERED` sale del `23505` de la restricción única.
  - La auditoría (`entity_type = 'rescuer_profile'`, acción `profile_completed` o `profile_updated`) guarda **solo los nombres** de los bloques tocados, nunca valores.
- `src/identity/`: `updateMe` y `changePassword` en `IdentityController` y `AuthService`.
- `test/api/app.test.ts`: lista `PROFILE_BUILT` con las 5 (AC-02).

**`apps/web`**
- `pages/profile-page.tsx` deja de ser provisional:
  - con el perfil incompleto es el formulario de alta;
  - completo es «Mi perfil»: contacto, sensibles enmascarados con «Mostrar» (`getMySensitive`) y «Corregir», y Mis equipos.
- Componentes nuevos en `src/profile/`.
- `components/guards.tsx`: un guardia `RequireCompleteProfile` que, con `nextStep = complete-profile`, lleva a `/profile` desde cualquier vista salvo `/profile` y `/account`.
- `nav/navigation.ts`: con el perfil incompleto la barra solo enseña «Mi perfil» y «Cuenta».
- `pages/account-page.tsx`: nombre visible (`updateMe`) y cambiar contraseña (`changePassword`).
- `i18n/use-locale.ts`: el idioma elegido en Cuenta se guarda también en la cuenta con `updateMe`; deja de valer solo para el navegador. Cambia D-H0-21.
- `packages/i18n`: textos es y fr.

**`infra`**
- `scripts/gen-secrets.sh`: dos secretos nuevos (`sensitive/key` y `fingerprint/key`).
- `compose.yml`: los monta en `api` y `seed`, con las variables `*_FILE`.
- `scripts/smoke.sh`:
  - `rescatista1` pasa a `home` y `rescatista6` a `complete-profile`;
  - `getMyProfile` de `rescatista1` sale enmascarado;
  - un coordinador recibe `FORBIDDEN` en `/my/profile/sensitive`.
- `infra/README.md`: las claves y qué se pierde con `down -v`.

**`data/seed`**
- `demo.json`: perfiles ficticios de `rescatista1` a `rescatista5`, con DNI de letra válida, teléfono y dirección inventados.
- `apps/api/src/seed/seed.ts`: un paso idempotente `seedProfiles` que **completa los que sigan incompletos y sin sensibles**, para que una pila ya sembrada los reciba en el siguiente `up` (como `seedMissions`).
- `README.md`: la tabla de cuentas al día.

**`db/`:** sin cambios. Si al implementar falta algo, será una `0014` aditiva y se anota.

## 4. Puertos implicados

- `Clock`, ya existente: `completed_at` y la auditoría.
- Ningún puerto nuevo. El cifrado es un servicio interno, no algo externo.

## 5. Decisiones con alternativa descartada

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-P1 | Claves en archivos de secretos generados por `secrets`. Se derivan con HKDF-SHA256 (información distinta por uso) a 32 bytes. `key_id = 1` | Leer la clave en hexadecimal tal cual: obliga a un formato de archivo distinto al del resto de secretos de `gen-secrets.sh` |
| D-P2 | `DOCUMENT_ALREADY_REGISTERED` sale de la restricción `UNIQUE (organization_id, document_hash)`: el rescatista no puede leer la huella de otros, por la política `sensitive_own` | Comprobar antes con una función `SECURITY DEFINER`: hace falta migración y abre una vía para preguntar si existe un documento |
| D-P3 | `getMyProfile` descifra el propio dato para enmascararlo. No se guarda ninguna versión enmascarada | Guardar el enmascarado en claro: es un dato derivado del sensible fuera de la tabla cifrada (INV-32) |
| D-P4 | La auditoría del perfil guarda qué bloques cambiaron (`["phone","document"]`), nunca valores | Guardar el antes y el después: el registro de solo añadir acabaría con datos sensibles en claro |
| D-P5 | `changePassword` mantiene la sesión actual y borra las demás. Una contraseña actual errónea cuenta como intento fallido (`auth_record_attempt`), con el mismo bloqueo que el inicio de sesión | Cerrar también la sesión actual: obliga a volver a entrar sin motivo. No contar los intentos: deja probar contraseñas con una sesión robada |
| D-P6 | El idioma de Cuenta se guarda en la cuenta (`updateMe`) y en el navegador. Cambia D-H0-21 | Seguir solo en el navegador: el correo saldría en un idioma distinto al elegido |
| D-P7 | El alta obligatoria es de la web: el guardia redirige con `nextStep = complete-profile`. El servidor no bloquea lecturas (P1) | Bloquear en el servidor todo salvo perfil y cuenta: no lo pide ningún RF y RN-20 ya cubre ofrecerse |
| D-P8 | La semilla completa sus perfiles con el mismo `SensitiveCipher` que la API (como `onway_owner`) | Insertar bytes ya cifrados en `demo.json`: atados a una clave concreta, no sirven en otra pila |

## 6. Riesgos

- **Gestión de la clave** (doc 07, H5): si se pierde el volumen `secrets` con la base viva, se pierden documento y dirección. Se documenta en `infra/README.md` y en la nota de `down -v` de `CLAUDE.md`.
- **Las demostraciones existentes usan `rescatista1`:** al completarse, deja de caer en «Mi perfil». Hay que actualizar `roles.spec.ts`, `smoke.sh` y `seed.test.ts` (T6).
- **Un rescatista nuevo del E2E** queda con perfil completo y documento ficticio. Se retira como en `H5-acceso` (aprobado y desactivado). Cada ejecución usa un DNI distinto, generado con letra válida a partir del sello, para no chocar con INV-24.

## 7. Verificación

**Pruebas por invariante, contra base real (`test:api`)**

| INV | Prueba |
|---|---|
| INV-18 | `getMySensitive` devuelve lo propio en claro. Coordinador y administrador reciben `FORBIDDEN` en `/my/profile*`. En la base, `document_enc` y `address_enc` no contienen el texto en claro, y descifrar con el `profile_id` de otro perfil falla |
| INV-24 | Mismo documento en otro perfil de la misma organización: `DOCUMENT_ALREADY_REGISTERED`, sin nombre ni identificador en la respuesta. En otra organización, sí se admite. Volver a guardar el propio documento no falla |
| INV-31 | `getMyProfile.email` es `users.email`. `updateMyProfile` con `email` da `VALIDATION_FAILED` (esquema estricto) |
| INV-32 | Contacto y sensibles se guardan en sus tablas. Un perfil a medias (solo nombre y teléfono) queda `incomplete` con `missingFields` correcto, y al completar pasa a `complete` con `completed_at` |
| RF-102 | `updateMe` con `role` da `VALIDATION_FAILED` y el rol no cambia |

**Demostración como prueba de extremo a extremo:** `apps/web/e2e/h5-perfil-demo.spec.ts`, en escritorio y 375 px.
1. Una persona nueva se registra con el código y el administrador la aprueba como rescatista.
2. Cae en el alta. Si intenta abrir `/missions`, vuelve al alta.
3. Un DNI con la letra mal da el error en el campo.
4. El DNI de `rescatista1` da «ya registrado», sin revelar de quién es.
5. Con un DNI válido el perfil queda completo y entra en Mis misiones.
6. En Mi perfil, el documento sale enmascarado; con «Mostrar» se ve entero.
7. Cambia el idioma a francés y, en otro contexto, entra y la app sale en francés.
8. Cambia la contraseña con dos sesiones abiertas: la otra caduca y entra con la nueva.
9. Por el API, el coordinador recibe `FORBIDDEN` en `/my/profile/sensitive`.
10. Al terminar, la cuenta queda desactivada.

**Comandos de cierre**
- Rápida por tarea: `pnpm check` (y `pnpm --filter @onway/api test:api` cuando toca un INV).
- Completa:
  - `pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm test`;
  - `pnpm --filter @onway/api test:db`, `pnpm --filter @onway/api test:api` y `db/tests/run-postgis.sh`;
  - `infra/scripts/smoke.sh` contra la pila `onway`;
  - el E2E con `CI=1` en la pila `onway-e2e`: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d`, y luego, con las mismas variables más `E2E_BASE_URL=http://localhost:18080 CI=1`, `pnpm --filter @onway/web e2e`.
- Revisores: `reviewer`, `reviewer-security` (datos personales, sesión y claves), `reviewer-db` (consultas y semilla) y `reviewer-ui`.

## 8. Documentos que habrá que actualizar

- **Doc 07 §3 H5:** el reparto en tres partes, la tabla de arriba y «Tal como se construyó (`H5-perfil`)». Se anota en su registro de cambios.
- **Doc 01:** Q-36, «se decide en `H5-equipos`». Se anota en el registro.
- **Doc 02:** §3.9 y §2 (Cuenta) tal como se construyeron: alta obligatoria, «Mostrar», nombre visible, contraseña e idioma en la cuenta. Se anota en el registro.
- **Doc 06:** se regenera tras T1, con sus notas y su registro de cambios.
- **Doc 05:** la fila «Datos sensibles» de §12 (semilla), marcada como construida.
- **`specs/H0-cimientos/plan.md`:** nada. Cambian D-H0-19 y D-H0-21, y se dice en `docs/historial.md`.
- **Al cierre:** `CLAUDE.md` («Comandos»: las claves nuevas y qué borra `down -v`), `data/seed/README.md`, `infra/README.md`, `apps/web/e2e/README.md`, `docs/estado.md` y `docs/historial.md`.
