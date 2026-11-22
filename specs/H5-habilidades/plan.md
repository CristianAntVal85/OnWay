# H5-habilidades · Plan

Segunda de las tres partes del resto de H5 (doc 07 §3, cambio de alcance del 2026-11-22). Rama `hito/H5-habilidades`, creada desde `main` tras fusionar `H5-perfil` (PR #32).

## 1. Alcance

**Operaciones (6, `x-milestone: H5`):** `listMySkills`, `createMySkill`, `updateMySkill`, `deleteMySkill`, `getCertificateLink` y **`openCertificate`, que es nueva** (D-S1). Además, `uploadFile` pasa a aceptar `purpose = certificate`; es una operación de H2 que ya está montada. Al acabar hay **69 montadas**, no las 68 que dice el doc 07, por `openCertificate`. Las 9 de `H5-equipos` siguen respondiendo 404.

**Identificadores:** RF-808, RF-806 (la parte de cursos), D-29, RN-24, INV-26, INV-28 (la parte del certificado), INV-25 y AC-14, más las reglas 2, 3 y 10 de `CLAUDE.md`. Es la parte «añade un curso con certificado» de la demostración de H5 (doc 07).

**Demostración de `H5-habilidades`:**
- Un rescatista con el perfil completo entra en Mi perfil y añade un curso («Primeros auxilios en montaña», expedido por una entidad ficticia, con fecha y caducidad) con un certificado PDF.
- Añade también una habilidad sin certificado («Conducción 4x4»).
- Abre el certificado en una pestaña nueva, edita el curso, cambia el certificado por una imagen y elimina la habilidad.
- En escritorio y a 375 px, y una vez solo con teclado.
- El administrador pide el enlace del certificado de ese rescatista por API: queda una línea `certificate_opened` en la auditoría. La apertura por el propio rescatista no deja ninguna.

**Fuera del alcance:**
- La ficha del voluntario, donde el coordinador ve cursos y certificados: `getParticipationCard`, en H6.
- `getUser`, donde el administrador los ve: en `H5-equipos`.
- Este hito deja hecha y probada la regla del servidor para el coordinador y el administrador, pero sin pantalla.
- El filtro por habilidad (RF-811, segunda entrega).
- El barrido de archivos subidos que nunca se adjuntaron.
- Borrar mis datos (H6).

## 2. Contexto para el implementador

- **RF-808 (Must).** Lista de entradas útiles para estas labores: nombre, tipo (curso o habilidad), entidad que lo expidió, fecha y caducidad opcionales. El rescatista añade, edita y elimina las suyas. Al añadir un curso puede adjuntar su certificado (PDF o imagen), de forma opcional (D-29). Los coordinadores y el administrador las ven en la ficha del voluntario y pueden abrir el certificado. Cada apertura queda registrada.
- **RF-806.** Lo ve y edita el propio rescatista. Los coordinadores ven nombre, equipo, cursos y habilidades y contacto, pero no los datos sensibles ni el historial. Cursos y habilidades son opcionales en el alta («se puede completar después», doc 02 §3.9).
- **D-29.** El certificado de un curso es opcional y se adjunta al añadirlo. Coordinadores y administrador pueden abrirlo. Son archivos privados con enlace de corta duración, y cada apertura queda registrada.
- **RN-24.** Un certificado de curso es privado. Solo lo abren el propio rescatista, el administrador y los coordinadores, y cada apertura ajena queda registrada.
- **INV-26.** Abrir un certificado que no es propio (coordinador o administrador) genera un registro de auditoría. El enlace de acceso caduca en minutos. Doc 05: «la apertura de un certificado ajeno la registra el servicio al firmar el enlace. La base solo garantiza que el archivo sea del propio rescatista (`skills_guard`)».
- **INV-28 y doc 06 §7.1, fila «Certificado»:**
  - el rescatista abre el suyo con `getCertificateLink`;
  - el coordinador, con `getCertificateLink`, solo el de quien tiene una participación *Pendiente* o *Aceptada* en sus misiones, y queda auditado;
  - el administrador, con `getCertificateLink`, cualquiera de su organización, y queda auditado.
  - Doc 06 §8: «`getCertificateLink`: el servicio comprueba rol y relación (INV-28), escribe en `audit_log` (INV-26) y firma el enlace».
- **INV-25.** Una cuenta pendiente, rechazada o desactivada no accede a ningún dato. Lo aplica ya `RequireActive` o el guardia de la API; las operaciones nuevas no lo saltan.
- **AC-14.** Toda lectura que deja huella de auditoría es `POST` (`getCertificateLink`). `openCertificate` es `GET` porque no audita: el registro se escribe al firmar el enlace.
- **Regla 3 (datos mínimos).** El archivo nunca va en la respuesta de la habilidad: `Skill.hasCertificate` es un booleano y el enlace se pide aparte. Las claves de almacenamiento no dicen nada del archivo. La auditoría guarda ids, nunca nombres ni contenido.
- **Doc 02 §3.9, errores:** «Certificado de tipo o tamaño no admitido: error claro, el curso no se guarda con el archivo». En Mi perfil, «Cursos y habilidades» lleva una columna de certificado («📎 adjunto» o «Adjuntar»). Un curso sin certificado se muestra sin la marca «adjunto».
- **Firmas (contrato actual, `packages/contracts/src/endpoints.ts`):**
  - `listMySkills` · `GET /my/skills` · rescatista → 200 `{items: Skill[]}`.
  - `createMySkill` · `POST /my/skills` · rescatista · cuerpo `SkillInput` (`name` de 1 a 160, `kind`, `issuer?` hasta 160, `issuedOn?`, `expiresOn?`, `certificateFileId?`; solo un curso admite certificado y la caducidad no puede ser anterior a la fecha) → 201 `Skill`.
  - `updateMySkill` · `PATCH /my/skills/{skillId}` · rescatista · cuerpo `SkillFields.partial()` con `certificateFileId` que admite `null` (quitar) → 200 `Skill`.
  - `deleteMySkill` · `DELETE /my/skills/{skillId}` · rescatista → 204.
  - `getCertificateLink` · `POST /skills/{skillId}/certificate-link` · todos los roles · `audited` → 200 `SignedLink {url, expiresAt}`.
  - `uploadFile` · `POST /files` · multipart `purpose` + `file` → 201 `FileRef`. Errores `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE` e `INVALID_FILE_CONTENT`. Con `purpose = certificate`, solo el rescatista; tipos `CONTENT_TYPES_BY_PURPOSE.certificate` (`application/pdf`, `image/jpeg`, `image/png`) y como máximo 10 MB (`MAX_FILE_BYTES`).
- **Base de datos ya hecha (migraciones 0003, 0007, 0008 y 0012), sin migración nueva:**
  - **`skills`:** `CHECK (kind = 'course' OR certificate_file_id IS NULL)`, `CHECK (expires_on >= issued_on)`, clave foránea compuesta a `files` y `skills_guard`, que exige que el archivo sea `purpose = 'certificate'` y del propietario del perfil.
  - **Políticas de `skills`:** `skills_select` (personal o el propio) y `skills_write` (`FOR ALL`, solo el propio).
  - **`files`:**
    - `owner_user_id`, obligatorio cuando es un certificado;
    - `files_select` (personal o el propietario);
    - `files_insert` (el propietario con `certificate`, o el coordinador con `route_import`);
    - `files_update` (el propietario o el personal, para el borrado lógico con `deleted_at`);
    - no hay `DELETE`.
  - **`participation_status`:** `pending`, `accepted`, `not_selected`, `withdrawn` y `removed`.
- **Código que ya existe:**
  - `FilesService.upload` responde `VALIDATION_FAILED` a `certificate` («arrive in H5»).
  - `ProfileService.describe` ya incluye `skills` en `getMyProfile`.
  - `AuditAction` del contrato ya tiene `certificate_opened`.
  - `apps/api/src/common/download.ts` sirve archivos con `attachment`.

## 3. Qué cambia, por carpeta

**`packages/contracts`**
- **`openCertificate` (nueva):**
  - `GET /certificates/{token}`, `x-milestone: H5`, todos los roles, `delivery: 1`;
  - parámetro `token` de 1 a 512 caracteres;
  - respuesta 200 `file: 'application/pdf | image/jpeg | image/png'`;
  - nota: «el enlace es de quien lo pidió y caduca a los 5 minutos; si no es válido, ha caducado, es de otra persona o el certificado ya no existe, 404 `NOT_FOUND`; se entrega `inline`».
- **Notas:**
  - en `getCertificateLink`, quién puede abrir qué (§2, INV-28), la auditoría solo de las aperturas ajenas y la caducidad de 5 minutos;
  - en `uploadFile`, que `certificate` queda abierto al rescatista;
  - en `updateMySkill`, que `certificateFileId: null` quita el certificado y que las reglas de `SkillInput` se comprueban sobre el resultado;
  - en `createMySkill` y `updateMySkill`, que el certificado debe ser un archivo propio, sin adjuntar a otra entrada, y que hay un máximo de 50 entradas.
- `CertificateTokenParams` en `endpoints.ts` y `milestones.ts` (`openCertificate: 'H5'`).
- Regenerar `openapi.json` y el doc 06. No hay códigos de error nuevos.

**`apps/api`**
- **`src/files/certificate-file.ts`:** reconoce el tipo por el contenido: `%PDF-`, `FF D8 FF` y `89 50 4E 47 0D 0A 1A 0A`. Lo que no es ninguno de los tres es `UNSUPPORTED_FILE_TYPE`. `FilesService.upload` acepta `certificate` del rescatista, con `owner_user_id = principal.userId`.
- **`src/db/database.service.ts`:** `afterCommit(fn)`. Guarda tareas que corren cuando la transacción de la petición se confirma; si la transacción se deshace, se descartan, y un fallo de una tarea se registra sin romper la respuesta. Sirve para borrar los bytes de un certificado retirado solo después de que el borrado lógico se haya confirmado.
- **`src/profile/skills.service.ts` y `skills.controller.ts`, nuevos:**
  - Las cuatro operaciones de «Mis cursos y habilidades».
  - El perfil propio se busca como en `ProfileService.ownProfile`, y una entrada de otra persona da 404.
  - Al adjuntar, el archivo debe ser del rescatista, con `certificate`, sin `deleted_at` y sin estar ya en otra entrada. Si no, `VALIDATION_FAILED` con `details.issues[path=certificateFileId]`.
  - Al cambiar o quitar el certificado, o al eliminar la entrada, el archivo anterior recibe `deleted_at` y sus bytes se borran con `afterCommit`.
  - Las reglas de `SkillInput` se comprueban sobre la fila resultante del `PATCH` (por ejemplo, pasar a `skill` con un certificado, o una caducidad anterior a la fecha).
  - Máximo 50 entradas por perfil (D-S4).
  - `listMySkills` va ordenada por tipo (los cursos primero) y por nombre.
- **`src/files/certificate-links.ts` y `certificates.controller.ts`, nuevos:**
  - **`getCertificateLink`:** comprueba quién lo pide (§2) y, si no es el propietario, escribe `certificate_opened` en `audit_log` en la misma transacción, con `entity_type = 'skill'`, el id de la entrada y como detalle `{fileId}`. Firma un token HMAC-SHA256 sobre `fileId‖userId‖exp` (D-S2) y devuelve `url = /api/v1/certificates/<token>` y `expiresAt`.
  - **`openCertificate`:** verifica la firma con comparación de tiempo constante, la caducidad (con el `Clock`), que el `userId` sea el de la sesión y que el archivo exista y no esté borrado. Sirve los bytes con el `contentType` de la fila, `Content-Disposition: inline; filename="certificado.<ext>"`, `X-Content-Type-Options: nosniff` y `Cache-Control: no-store, private`.
  - Un token que no vale da 404 `NOT_FOUND`, igual en todos los casos.
- **`src/audit/audit.writer.ts`:** `recordCertificateOpened`.
- **`src/app.module.ts`:** se montan los controladores. Las listas de montadas de `test/api/app.test.ts` pasan de 63 a 69.

**`apps/web`**
- **`src/profile/skills.ts`:** consultas `useMySkills`, `useCreateSkill`, `useUpdateSkill`, `useDeleteSkill` y `useOpenCertificate`. Cada cambio invalida `my-skills` y `my-profile`.
- **`src/profile/skills-section.tsx`:**
  - la sección «Cursos y habilidades» con estados de carga, vacío y error;
  - una lista con nombre, tipo, entidad, fechas y la marca «📎 adjunto» o «Adjuntar»;
  - los botones Editar, Eliminar (con confirmación) y «Abrir certificado».
- **`src/profile/skill-dialog.tsx`:**
  - el diálogo para añadir o editar (`components/dialog.tsx`), validado con `SkillInput`;
  - el campo de archivo solo para los cursos, que acepta `application/pdf,image/jpeg,image/png`;
  - el archivo se sube al guardar, primero el archivo y después la entrada;
  - un error de tipo o tamaño se pinta en el campo y la entrada no se guarda;
  - «Quitar certificado».
- **Abrir el certificado:**
  1. se abre una pestaña vacía en el mismo gesto del clic;
  2. se pide el enlace;
  3. la pestaña navega a él, con `opener = null`;
  4. si falla, la pestaña se cierra y se avisa.
- **`src/pages/profile-page.tsx`:** la sección va también bajo el formulario del alta (doc 02: «se puede completar después», pero se puede ya).
- **`packages/i18n/src/es.ts` y `fr.ts`:** `profile.skills.*`.

**`infra`**
- **`Caddyfile`:** `handle /api/v1/certificates/*` lleva su propia CSP (`default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'none'; sandbox`) en lugar de la general.
  - Se comprueba en Chromium que el visor de PDF y la imagen se ven.
  - Si `sandbox` bloquea el visor de PDF, se quita `sandbox` y se mantiene lo demás. Si aun así no se ve, el PDF se entrega como `attachment` (D-S3), anotado como desviación.
- **`compose.yml`:** la `seed` monta el volumen `files` y lleva `FILES_DIR`.
- **`scripts/smoke.sh`:** `rescatista1` lista sus habilidades y abre su certificado, que responde 200 `application/pdf`.

**`data/seed` y `src/seed/`**
- `rescatista1` a `5` con 1 a 3 entradas ficticias («Primeros auxilios en montaña», «Técnico de rescate en montaña», «Conducción 4x4», «Manejo de dron»).
- `rescatista1` lleva además un certificado PDF mínimo e inventado, generado por la semilla («Certificado de demostración · datos ficticios»). Se guarda con el `DiskFileStorage` de `FILES_DIR`.
- La semilla es idempotente: no duplica entradas en una pila ya sembrada y no vuelve a subir el PDF si ya hay uno.

**`db/`:** sin cambios. Solo pruebas nuevas, en `apps/api/test/db/`.

## 4. Puertos implicados

- `FileStorage`, el que ya existe: `put`, `get` y `delete`; en disco en la pila y en memoria en las pruebas.
- `Clock`, para la caducidad del enlace.
- No hay puertos nuevos.

## 5. Decisiones

| Id | Decisión | Alternativa descartada |
|---|---|---|
| D-S1 | **Operación nueva `openCertificate`** (`GET /certificates/{token}`) que sirve los bytes. **Decisión del usuario, 2026-11-22.** | Una ruta de Nest fuera del contrato: rompe la regla 7 |
| D-S2 | **Token HMAC-SHA256 sin estado** (`fileId`, `userId` y caducidad en el token), con una **clave aleatoria por proceso** creada al arrancar la API. Un reinicio invalida los enlaces vivos, y como duran 5 minutos y el cliente pide uno nuevo en cada clic, no importa. El enlace solo vale con la sesión de quien lo pidió: pasado a otra persona, da 404 | Una tabla de enlaces (necesita migración y limpieza) o una clave derivada de un secreto del volumen (más configuración sin ganar nada, porque el enlace no debe sobrevivir a un reinicio) |
| D-S3 | **Entrega `inline` en una pestaña nueva**, con una CSP propia para esa ruta y `nosniff`. El tipo se decide por el contenido al subir y se sirve el de la fila. **Decisión del usuario.** Si el visor de PDF de Chromium no se ve con esa CSP, el PDF pasa a `attachment` | Descargar siempre: más simple, pero el rescatista tendría que abrir el archivo descargado |
| D-S4 | **Máximo 50 entradas por perfil** y un certificado por entrada. Por encima, `VALIDATION_FAILED` | Sin límite: un perfil podría llenar el disco a base de certificados |
| D-S5 | **Los bytes del certificado retirado se borran tras la confirmación** (`afterCommit`). La fila queda con `deleted_at` | Esperar a un barrido (no existe aún) o borrarlos antes del `COMMIT` (si la transacción se deshace, la entrada apuntaría a un archivo que ya no existe) |
| D-S6 | **Sin auditoría de añadir, editar o eliminar entradas.** No son datos sensibles, y la regla del doc 03 solo pide auditar la apertura ajena. Lo que se audita es `certificate_opened` | Auditar todo: ruido sin un requisito detrás |
| D-S7 | **Un coordinador sin relación, o un rescatista que pide el certificado de otro, recibe 404**, no 403. Así no se revela que la entrada existe; es la misma regla que entre organizaciones | 403 `FORBIDDEN`: confirma que la entrada existe |

## 6. Riesgos

- **El visor de PDF de Chromium con una CSP estricta (D-S3).** Se comprueba en T5, en la pila de revisión, con Chrome DevTools, antes de dar la tarea por hecha.
- **Ventanas emergentes.** La pestaña se abre dentro del gesto y después navega. En el E2E, `context.waitForEvent('page')`.
- **Archivos huérfanos.** Un certificado subido cuya entrada falla al guardarse queda sin adjuntar, y el cliente no lo reintenta con otro archivo. Se acepta y se anota para el barrido (doc 07, H7).
- **La semilla escribe en el volumen `files`.** El servicio `seed` necesita el montaje. Si se olvida, la semilla falla, pero no en silencio.
- **`skills_guard` no mira `deleted_at`.** El servicio lo comprueba. Se anota como bajo para la base y no se crea migración.

## 7. Verificación

**Pruebas por invariante, contra base real:**
- **INV-26** (`test:api certificates`):
  - la apertura por el administrador y por un coordinador con participación deja exactamente una fila `certificate_opened`, sin el nombre del curso;
  - la apertura por el propio rescatista no deja ninguna.
- **INV-28, parte del certificado** (`test:api certificates`):
  - un coordinador sin participación *Pendiente* o *Aceptada* recibe 404, y con *Retirado* también;
  - otro rescatista recibe 404;
  - otra organización recibe 404.
- **Enlace** (`test:api certificates`):
  - caducado (con el `Clock` de prueba), alterado, de otra sesión o de un archivo borrado: 404;
  - válido: 200 con el `Content-Type` de la fila, `nosniff`, `inline` y `no-store`.
- **`skills_guard` y políticas** (`test:db skills-policy`, SQL directo como `onway_app`):
  - el rescatista no lee ni escribe las entradas de otro;
  - el coordinador lee y no escribe;
  - no se adjunta el archivo de otra persona ni un `route_import`;
  - una habilidad no lleva certificado.
- **Las cuatro operaciones** (`test:api skills`):
  - las reglas de `SkillInput` también al editar;
  - el límite de 50;
  - el archivo adjunto a otra entrada;
  - borrar la entrada o cambiar el certificado deja `deleted_at` y borra los bytes del `InMemoryFileStorage`, y si la transacción se deshace, no los borra;
  - cuenta pendiente o desactivada (INV-25).
- **Subida** (`test:api files`): PDF, JPEG y PNG por su contenido; un `.pdf` que es texto da `UNSUPPORTED_FILE_TYPE`; un coordinador con `certificate` da `FORBIDDEN`.

**Demostración del hito:** `apps/web/e2e/h5-habilidades-demo.spec.ts`, en escritorio y a 375 px, con la historia de §1 y el PDF y el PNG inventados que genera la propia prueba. La auditoría se comprueba con `support/stack.ts`.

**Comandos:**
- Por tarea: la línea «Comprobación».
- Al cerrar, la verificación completa de `CLAUDE.md`: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm --filter @onway/api test:db`, `pnpm --filter @onway/api test:api` y `db/tests/run-postgis.sh`, y el E2E con `CI=1` en `onway-e2e` (puerto 18080).

## 8. Rama

`hito/H5-habilidades`. Commits `<tipo>(H5-habilidades): Tn <resumen>`.

## 9. Documentos que habrá que actualizar

- **Doc 06:** `openCertificate` y las notas, regenerado. Registro de cambios v1.14.
- **Doc 07:**
  - la tabla de las tres partes (6 operaciones, 69) y su registro de cambios en T1;
  - «Tal como se construyó (`H5-habilidades`)» en T9.
- **Doc 04:** §5.1 `files` (certificados y enlace firmado) y §6 (CSP de la ruta del certificado), con su registro de cambios.
- **Doc 02 §3.9:** «Tal como se construyó (`H5-habilidades`)», con su registro de cambios.
- **Doc 05:** la nota de `skills_guard` y `deleted_at` en el registro, si se confirma el bajo.
- **`apps/web/e2e/README.md`**, **`infra/README.md`** (la semilla monta `files`), la descripción de `smoke.sh` en **`CLAUDE.md`**, y **`docs/estado.md`** y **`docs/historial.md`**.
