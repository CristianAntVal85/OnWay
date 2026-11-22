# H5-usuarios · Plan

Tercera parte del resto de H5. **Cambio de alcance (decisión del usuario, 2026-11-22):** la antigua `H5-equipos` se parte por demostración en **`H5-usuarios`** (este plan) y **`H5-equipos`**, sin cambiar `x-milestone`. Rama `hito/H5-usuarios`, creada desde `main` tras fusionar `H5-habilidades` (PR #33).

## 1. Alcance

**Operaciones (3, `x-milestone: H5`):** `listUsers`, `getUser` y `updateUser`. Al acabar hay **74 montadas**: las 71 anteriores más estas 3. Las 6 de equipos siguen respondiendo 404.

**Identificadores:** RF-813, RN-11, RN-25, INV-25, INV-29, INV-03, INV-11, DB-13 y la fila «Usuarios de la organización» del doc 02 §3.10 (boceto 13). También la parte de RF-808 y D-29 en la que el administrador ve las habilidades y abre el certificado desde la ficha; `getCertificateLink` ya está construida. Y las reglas 1, 2 y 3 de `CLAUDE.md`.

**Decisiones del usuario que se registran aquí y construye `H5-equipos`:**
- **Q-12, resuelta:** gestionan los equipos el administrador y el coordinador (`TEAM_MANAGERS`, como ya proponía el contrato).
- **`listRescuers` se adelanta de H6 a H5.** Es el selector de miembros del coordinador. `H5-equipos` cambia su `x-milestone` y la construye, así que tendrá 7 operaciones y 81 montadas.
- **Q-36, decidida.** El alias es **generado y fijo**: tres letras del nombre y de cada apellido, más un código de tres letras de la localidad del primer equipo (sin equipo, sin código). Una colisión lleva sufijo numérico. El rescatista lo ve en lugar del nombre en las listas; el personal ve ambos.

**Demostración de `H5-usuarios`, en escritorio y a 375 px:**
1. El administrador abre Administración → Usuarios, busca a `rescatista1` y filtra por rol y por estado.
2. Abre su ficha: correo, teléfono, cursos y habilidades, equipos. Abre su certificado, que queda registrado en la auditoría.
3. A un rescatista creado por la prueba le cambia el rol a coordinador y la auditoría registra `role_changed`.
4. Intenta desactivar a un coordinador creado por la prueba que es responsable de una misión abierta. La app pide reasignarla a otro coordinador activo; al confirmarlo, la cuenta queda desactivada, la misión pasa a `coordinador@example.org` y la persona desactivada ya no entra.
5. La reactiva.
6. Intenta quitarse a sí mismo el rol de administrador: se le rechaza porque es el último administrador (`LAST_ADMIN`) y nada cambia.

Una pasada se hace solo con teclado y en francés.

**Fuera del alcance:**
- `readUserSensitive`, el historial de un usuario y el registro de auditoría: son de H6.
- Los equipos, el alias y D-34: son de `H5-equipos`.
- La ficha muestra los equipos de la persona en solo lectura, a partir de `team_members`.

## 2. Contexto para el implementador

- **RF-813 (Must), administración de usuarios.** El administrador ve los usuarios de su organización, cambia el rol y desactiva cuentas. El registro de accesos llega en H6.
- **Doc 02 §3.10, «Usuarios de la organización»:**
  - Es una lista con nombre, rol, estado (activo o desactivado) y último acceso.
  - Las acciones son cambiar el rol, desactivar y reactivar.
  - Un administrador no puede quitarse a sí mismo el rol si es el último.
  - Si se desactiva a un coordinador responsable de misiones, la app obliga a reasignarlas (RN-11).
- **RN-11.** Toda misión tiene siempre un coordinador responsable. Si su cuenta se desactiva, hay que reasignar la misión.
- **RN-25 e INV-29.** El rol de coordinador o de administrador solo lo concede un administrador. Doc 05: «solo `admin_decide_signup()` crea membresías; solo el administrador puede cambiar un rol (`memberships_admin`)».
- **INV-25.** Una cuenta pendiente, rechazada o desactivada no accede a ningún dato. `admin_set_account_status` borra las sesiones al desactivar.
- **INV-03.** El responsable de una misión es un coordinador activo de la organización, nunca un administrador. Lo comprueba `missions_guard` (migración 0011) en cada `INSERT` o `UPDATE` de `missions`.
- **INV-11 (regla 5).** Una misión cerrada es de solo lectura, y el disparador rechaza cambiarla. Por eso **solo se reasignan las misiones no cerradas**; una cerrada conserva a su responsable aunque esté desactivado.
- **DB-13.** La aplicación no puede cambiar directamente `account_status`, `email` ni `is_platform_admin`, porque están protegidos por permisos de columna. El estado solo cambia con `admin_set_account_status(p_user, p_status)` (0008, `SECURITY DEFINER`). Esa función:
  - comprueba `app_is_admin()` y que la membresía sea de su organización;
  - actualiza `users` y `memberships.status`;
  - borra las sesiones al desactivar;
  - escribe `account_active` o `account_disabled` en `audit_log`.
- **Q-14.** El administrador no escribe misiones: las políticas `missions_coordinator_*` (0011) solo dejan escribir al coordinador. Por eso la reasignación necesita una función `SECURITY DEFINER` nueva (D-U1).
- **Doc 06 §7.1.** El administrador ve el teléfono y el correo en `getUser` y `listUsers`, y las habilidades en `getUser`. El certificado se abre con `getCertificateLink`, que deja registro. Documento y dirección nunca salen aquí: van por `readUserSensitive`, en H6.
- **Doc 06 §8, `updateUser`:** usa `admin_set_account_status` y actualiza `memberships.role`. `LAST_ADMIN` y `COORDINATOR_HAS_MISSIONS` se comprueban antes en el servicio. `COORDINATOR_HAS_MISSIONS` lleva en `details` el campo `missionIds[]`.
- **Firmas** (`packages/contracts/src/endpoints.ts` y `admin.ts`):
  - **`listUsers`** · `GET /admin/users` · admin. Consulta: `page`, `pageSize`, `q` (hasta 120), `role` (`MemberRole`) y `accountStatus`. Responde 200 con una página de `AdminUserItem`: `userId`, `displayName`, `email`, `role`, `accountStatus`, `lastLoginAt` (nullable), `profileStatus` (solo para rescatistas) y `hasMissionsAsResponsible` (misiones no cerradas de las que es responsable).
  - **`getUser`** · `GET /admin/users/{userId}` · admin. Responde 200 con `AdminUserDetail`, que es `AdminUserItem` más `phone` (nullable), `skills` (`Skill[]`), `teams` (`TeamRef[]`) y `createdAt`.
  - **`updateUser`** · `PATCH /admin/users/{userId}` · admin · auditada. Cuerpo `UpdateUserRequest`: `role?`, `accountStatus?` (`active` o `disabled`) y `reassignMissionsTo?`, con al menos rol o estado. Responde 200 con `AdminUserDetail`. Errores propios: `COORDINATOR_HAS_MISSIONS` (409) y `LAST_ADMIN` (409).
- **Datos que ya existen:**
  - `users.last_login_at`, `memberships` (`role`, `status`) y `missions.coordinator_id`.
  - `rescuer_profiles` (la política `profiles_insert` deja insertar al administrador), `rescuer_contact` (`contact_select` deja leer al administrador) y `skills`.
  - `team_members` y `teams`, que el personal puede leer.
  - `audit_log`, con las acciones `role_changed`, `account_active` y `account_disabled` en `AuditAction`.
- **Código que ya existe:**
  - El módulo `apps/api/src/admin/` (`signup-requests.service.ts`, `admin.controller.ts`).
  - `listSkillsOf` (`apps/api/src/profile/skill-rows.ts`).
  - `getCertificateLink` (`apps/api/src/files/certificate-links.ts`).
  - En la web, `apps/web/src/admin/` (`signup-inbox.tsx` sirve de modelo de bandeja con su estado en la dirección) y `pages/admin-page.tsx`.
  - `useOpenCertificate` (`apps/web/src/profile/skills.ts`) y el selector `listCoordinators`.

## 3. Qué cambia, por carpeta

**`packages/contracts`.** No hay esquemas ni operaciones nuevas. Cambian las notas de tres operaciones:
- **`listUsers`:** solo lista personas con membresía en la organización. Las solicitudes pendientes y rechazadas están en la bandeja. Orden por nombre.
- **`getUser`:** sin documento ni dirección; el certificado se abre con `getCertificateLink`.
- **`updateUser`:**
  - Cambiar el rol de un coordinador, o desactivarlo, cuando es responsable de misiones no cerradas exige `reassignMissionsTo`, que debe ser otro coordinador activo. Sin él, la respuesta es `COORDINATOR_HAS_MISSIONS` con `missionIds`.
  - `LAST_ADMIN` sale al quitar el rol o desactivar al último administrador activo.
  - Pasar a rescatista crea un perfil incompleto si no lo tenía.
  - Reactivar solo vale para cuentas desactivadas.
  - Cada cambio deja su línea de auditoría.

Después se regeneran el OpenAPI y el doc 06.

**`db/migrations/0014_admin_reassign_missions.sql`**
- **`admin_reassign_missions(p_from uuid, p_to uuid) RETURNS SETOF uuid`**, `SECURITY DEFINER` y con `search_path` fijado.
  - Exige `app_is_admin()`, y que `p_to` sea un coordinador activo de `app_org_id()` distinto de `p_from`. Si no, `RAISE` con un `ERRCODE` reconocible.
  - Hace `UPDATE missions SET coordinator_id = p_to` sobre las misiones de la organización con `coordinator_id = p_from AND status <> 'closed'`. `missions_guard` sigue aplicando INV-03.
  - Por cada misión, inserta en `audit_log` una línea `mission_updated` con `detail {fields:['coordinatorId'], reassignedFrom, reassignedTo}`. Es el mismo formato que usa `updateMission` para su historial.
  - Devuelve los ids de las misiones reasignadas.
- `GRANT EXECUTE … TO onway_app` y `REVOKE … FROM PUBLIC`.
- Se registra en `meta/_journal.json`, como las anteriores.

**`apps/api`**
- **`src/admin/users.service.ts` y `users.controller.ts`, nuevos.**
  - **`list`:**
    - Une `memberships` y `users` de la organización.
    - Busca con `q` en nombre y correo (`ILIKE`) y filtra por rol y estado.
    - Calcula `profileStatus` con un `LEFT JOIN rescuer_profiles` y `hasMissionsAsResponsible` con un recuento de las misiones no cerradas.
    - Pagina con `PageQuery` y ordena por `lower(display_name)` e id.
  - **`detail`:** lo mismo, más `rescuer_contact.phone`, `listSkillsOf(profileId)`, los equipos (`team_members` y `teams`) y `users.created_at`. Una persona de otra organización o inexistente da 404.
  - **`update`**, todo en la transacción de la petición:
    1. Lee el estado actual.
    2. Comprueba `LAST_ADMIN`: el objetivo es administrador activo, pierde el rol o se desactiva, y no queda otro administrador activo.
    3. Si el objetivo es coordinador, pierde el rol o se desactiva y tiene misiones no cerradas: con `reassignMissionsTo` llama a `admin_reassign_missions`; sin él, `COORDINATOR_HAS_MISSIONS` con `missionIds`.
    4. Si `reassignMissionsTo` no vale (no es coordinador activo o es la misma persona), la respuesta es `VALIDATION_FAILED` con `path = reassignMissionsTo`.
    5. Hace `UPDATE memberships SET role` y deja `role_changed` en la auditoría con `{from, to}`.
    6. Si pasa a rescatista sin perfil, inserta `rescuer_profiles` con `full_name = display_name`, en estado incompleto.
    7. Desactiva o reactiva con `admin_set_account_status`.
    8. Reactivar una cuenta que no está desactivada, o enviar un cambio que no cambia nada, da `INVALID_STATE_TRANSITION`.
- **`src/audit/audit.writer.ts`:** `recordRoleChanged`.
- **`src/admin/admin.module.ts`:** se monta el controlador nuevo. `test/api/app.test.ts` pasa a 74 montadas.

**`apps/web`**
- **`src/admin/users-section.tsx`** (sección «Usuarios» en `/admin`):
  - búsqueda, filtros de rol y estado, y paginación, todo en la dirección (`?users.q=…`, como la bandeja);
  - estados de carga, vacío y error;
  - filas con nombre, correo, rol, estado y último acceso, y un enlace a la ficha.
- **`src/admin/user-page.tsx`** (ruta `/admin/users/:userId`, bajo `RoleGate` de administración):
  - la ficha con contacto, habilidades («Abrir certificado» reutiliza `useOpenCertificate`, con el aviso «La apertura queda registrada») y equipos;
  - las acciones «Cambiar rol», «Desactivar» y «Reactivar».
- **`src/admin/user-dialogs.tsx`:**
  - **Cambiar rol:** sin opción marcada de antemano y con el aviso de permisos para coordinador o administrador, igual que en `decide-dialog.tsx`.
  - **Desactivar:** con confirmación. Si la persona es responsable de misiones abiertas, o el servidor responde `COORDINATOR_HAS_MISSIONS`, el diálogo pide el nuevo responsable con `listCoordinators` sin incluirla a ella y enseña cuántas misiones se reasignan.
  - **Errores:** `LAST_ADMIN` se explica en el diálogo y no cambia nada.
  - **Foco:** en «Cancelar» al abrir y de vuelta al botón al cerrar.
- **`src/admin/queries.ts`:** `useUsers`, `useUser` y `useUpdateUser`. Las dos primeras se invalidan al cambiar algo.
- **`src/app/routes.tsx`:** la ruta de la ficha. `pages/admin-page.tsx` añade la sección.
- **`packages/i18n/src/es.ts`, `fr.ts` y `types.ts`:** `admin.users.*`.

**`data/seed` e `infra`**
- No hace falta semilla nueva: hay un administrador, dos coordinadores y seis rescatistas. La reasignación de la demostración usa cuentas y misiones «E2E …» creadas por la prueba.
- **`smoke.sh`:** el administrador lista los usuarios (200 y al menos 9). Un coordinador recibe 403 en `listUsers`. La ficha de `rescatista1` trae `skills` y no trae `document` ni `address`.

## 4. Puertos implicados

`Clock`, que ya se usa en la auditoría. No hay puertos nuevos.

## 5. Decisiones

| Id | Decisión | Alternativa descartada |
|---|---|---|
| D-U1 | **Función `admin_reassign_missions` `SECURITY DEFINER`** (migración 0014). El administrador reasigna en la misma transacción que la desactivación, y la base aplica INV-03 e INV-11 | Abrir a todo el personal la escritura de `missions.coordinator_id`, lo que rompe Q-14; o pedir al coordinador que reasigne antes, cuando quizá ya no está |
| D-U2 | **Cambiar el rol de un coordinador con misiones abiertas también exige reasignarlas**, igual que desactivarlo. INV-03 no admite un responsable que no sea coordinador | Dejar misiones con un responsable que ya no es coordinador, algo que el disparador rechazaría en su siguiente edición |
| D-U3 | **Pasar a rescatista crea un perfil incompleto si no existe.** Pasar a coordinador o administrador conserva el perfil, oculto y sin borrar nada. Si vuelve a rescatista, recupera sus datos | Borrar el perfil al cambiar de rol, que pierde datos sin que nadie lo pida (RF-812 es la vía para borrar) |
| D-U4 | **Un cambio que no cambia nada da `INVALID_STATE_TRANSITION`**, que ya existe. También reactivar una cuenta que no está desactivada | Responder 200 sin cambios, que deja una línea de auditoría vacía o ninguna sin avisar |
| D-U5 | **El administrador puede cambiarse el rol o desactivarse a sí mismo** salvo si es el último administrador activo (`LAST_ADMIN`), que es lo que dice el doc 02 | Prohibirlo siempre: más restrictivo de lo documentado |
| D-U6 | **`listUsers` solo devuelve miembros.** Pendientes y rechazados viven en la bandeja de solicitudes, porque `MemberRole` no admite nulo en `AdminUserItem` | Mezclarlos aquí, lo que obliga a cambiar el esquema |
| D-U7 | **La ficha se abre en `/admin/users/:userId`**, una página con su propia dirección (enlazable, botón de volver) | Un panel lateral en la lista, peor en móvil |

## 6. Riesgos

- **Las pruebas E2E en paralelo.** Desactivar o cambiar de rol cuentas de la semilla rompería otras demostraciones. La demostración solo toca cuentas `e2e-…` creadas por `stack.ts`, y `retireE2eAccounts` las deja desactivadas. El intento de `LAST_ADMIN` no cambia nada.
- **Sesiones.** El rol se lee de la membresía en cada petición (`standingOf`), así que el cambio de rol vale desde la siguiente petición, sin cerrar sesiones. Al desactivar, la función ya borra las sesiones. Se prueba con una petición tras el cambio.
- **Carrera de `LAST_ADMIN`.** Dos administradores que se desactivan a la vez podrían dejar la organización sin ninguno. Se toma `pg_advisory_xact_lock` por organización en `update`, como en `decideSignupRequests`.
- **`missions_guard` en la reasignación.** Si el nuevo responsable deja de ser coordinador a mitad del proceso, el disparador falla y la transacción se deshace. Se traduce a `VALIDATION_FAILED`.

## 7. Verificación

**Pruebas por invariante, contra base real:**
- **INV-29** (`test:api users`):
  - solo el administrador cambia un rol; el coordinador y el rescatista reciben 403;
  - el cambio deja `role_changed` con `{from, to}`;
  - en `test:db admin-reassign`, como `onway_app` con el rol de coordinador, `UPDATE memberships SET role` no afecta a ninguna fila.
- **INV-25** (`test:api users`): la persona desactivada pierde la sesión y su siguiente petición da 401; reactivada, vuelve a entrar.
- **INV-03, INV-11 y RN-11** (`test:db admin-reassign` y `test:api users`):
  - la función reasigna solo las misiones no cerradas;
  - rechaza un destino que no es coordinador activo y la llamada de quien no es administrador;
  - deja una línea de historial por misión;
  - `updateUser` sin `reassignMissionsTo` da `COORDINATOR_HAS_MISSIONS` con los `missionIds`, y con él reasigna y desactiva en una sola transacción.
- **`LAST_ADMIN`:** quitarse el rol o desactivarse siendo el único administrador da 409, y con dos administradores, sí se puede.
- **Aislamiento (regla 1):** `getUser` y `updateUser` de otra organización dan 404, y `listUsers` no la mezcla.
- **Regla 3:** `getUser` no lleva documento ni dirección, y la prueba de contrato `schema-guards` sigue en verde.

**Demostración del hito:** `apps/web/e2e/h5-usuarios-demo.spec.ts`, en escritorio y a 375 px, con la historia de §1.

**Comandos:**
- Por tarea, la línea «Comprobación».
- Al cerrar, la verificación completa de `CLAUDE.md` y el E2E con `CI=1` en `onway-e2e`.

## 8. Rama

`hito/H5-usuarios`. Commits `<tipo>(H5-usuarios): Tn <resumen>`.

## 9. Documentos que habrá que actualizar

- **Doc 07:** las partes de H5, que pasan a cuatro (`H5-usuarios` con 3 operaciones y 74 montadas; `H5-equipos` con 7 y 81, `listRescuers` incluida), y su registro de cambios en T1. «Tal como se construyó (`H5-usuarios`)» en T9.
- **Doc 01:** Q-12 resuelta, Q-36 decidida con sus respuestas (en `H5-equipos`) y el registro de cambios.
- **`docs/backlog-post-mvp.md`:** B-02 con la decisión.
- **Doc 06:** notas regeneradas, con su registro de cambios.
- **Doc 05:** la 0014 y la función, en §3, en la tabla de migraciones y en el registro de cambios.
- **Doc 02 §3.10:** «Tal como se construyó (`H5-usuarios`)».
- **`apps/web/e2e/README.md`**, la línea de `smoke.sh` en **`CLAUDE.md`** (y `test:db` si cambia su descripción), y **`docs/estado.md`** y **`docs/historial.md`**.
