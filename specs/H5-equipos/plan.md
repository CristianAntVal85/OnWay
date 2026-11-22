# H5-equipos · Plan

Última parte de H5. Rama `hito/H5-equipos`, creada desde `main` tras fusionar `H5-usuarios` (PR #34). Al acabar, H5 queda completo.

## 1. Alcance

**Operaciones (7, `x-milestone: H5`):** `listTeams`, `createTeam`, `getTeam`, `updateTeam`, `addTeamMembers` y `removeTeamMember`, más `listRescuers`, que se adelanta de H6 a H5 (doc 07 v0.22). Al acabar hay **81 montadas**, las 74 anteriores más estas 7, y H5 queda entero.

**Identificadores:**
- RF-801, INV-23, Q-12 (resuelta), D-34 (backlog B-01), Q-36 (alias, backlog B-02).
- RF-805: el selector de equipo en la fila de la ruta de la misión. Es la parte que H4 dejó para H5.
- Las reglas 1, 2 y 3 de `CLAUDE.md`, y RN-21: en los equipos, nada de contacto.

**Decisiones del usuario para el alias (Q-36, 2026-11-22):**
- **El código de localidad es un campo del equipo** (`teams.code`).
  - Son 3 caracteres en mayúscula, obligatorios y únicos en la organización.
  - Al escribir la localidad se propone uno solo: la primera letra y las consonantes que la siguen (Alicante → `ALC`, Sabiñánigo → `SBN`). Se puede corregir al crear el equipo.
- **El nombre del que sale el alias** es el nombre completo del perfil en el rescatista, en cuanto completa el perfil. En el coordinador y el administrador es su nombre visible, en cuanto se aprueba la cuenta.
  - La parte de localidad se añade una sola vez, cuando la persona entra en su primer equipo.
  - Desde ahí no cambia, ni al cambiar de nombre ni de equipo.
  - Si coincide con otro alias, lleva un sufijo numérico: `criantval2 ALC`.
- **En este hito, el alias solo se muestra al rescatista:** es el alias del coordinador responsable en Mis misiones y en el detalle de la misión. Hoy le llega `null` (pendiente (a) del backlog). El resto de las vistas lo enseñarán cuando se decida, en H6 con las listas de voluntarios.

**Demostración de `H5-equipos`, en escritorio y a 375 px, con una pasada solo con teclado y en francés:**
1. **Crear el equipo.** Un coordinador abre Equipos y crea «E2E Equipo Alicante» con localidad «Alicante». La app propone el código `ALC`. Lo cambia y lo vuelve a dejar en `ALC`. Al intentar crear otro equipo con el mismo nombre o el mismo código, se le rechaza (`DUPLICATE_NAME`).
2. **Añadir miembros.** Abre el equipo y añade a dos rescatistas creados por la prueba con el selector `listRescuers`, que lleva búsqueda y solo enseña perfiles completos. La lista de miembros enseña solo nombres. Quita a uno.
3. **Asignar el equipo.** En una misión «E2E …» activa, asigna el equipo a una de sus rutas (RF-805).
4. **Lo que ve el rescatista.** Un rescatista de la prueba que **no** es miembro abre la misión y ve en la ruta el nombre y la localidad del equipo (D-34). Ve además el alias del coordinador responsable. El alias del rescatista miembro, leído en la base, termina en ` ALC`.
5. **Archivar.** El coordinador archiva el equipo: sale de la lista de activos y queda en «Archivados».
6. **Administrador.** También gestiona los equipos (Q-12), con una prueba de API y otra de interfaz.

**Fuera del alcance:**
- Asignar equipos a la misión entera (`teamIds` de la misión) y los voluntarios: son de H6.
- Mostrar el alias en las listas del personal.
- Cambiar un alias a mano.

## 2. Contexto para el implementador

- **RF-801 (Must), gestionar equipos.** Crear, nombrar, indicar su localidad obligatoria, añadir y quitar miembros y archivar. Lo gestionan el administrador y el coordinador (Q-12, `TEAM_MANAGERS = ['coordinator','admin']`). El rescatista no.
- **Doc 02 §3.8 (boceto 12):**
  - la lista de equipos tiene nombre, localidad, número de miembros y estado;
  - el detalle tiene los miembros (nombre), añadir y quitar, y desactivar el equipo;
  - crear o editar pide nombre y localidad, y la localidad es lo que se enseña en la lista de voluntarios;
  - «agrupación» y «equipo» son lo mismo (D-26).
- **INV-23.** Un equipo siempre tiene nombre y localidad: `teams.locality NOT NULL CHECK (char_length(btrim(locality)) >= 1)`. El nombre es único en la organización: `teams_org_name_uq (organization_id, lower(name))`.
- **D-34 y B-01.** El rescatista ve el nombre y la localidad de su equipo y de los demás equipos de su organización. Sigue sin ver quién es miembro de cada uno.
  - Hoy `teams_select` (0008) solo deja leer al personal y a los miembros, y por eso `listMyMissionRoutes.team` sale `null` si el rescatista no es del equipo (desviación C3 de H4).
  - Se resuelve ampliando la lectura de `teams` a todos los roles de la organización. `team_members` no cambia.
  - Pruebas: el rescatista lee los equipos de su organización y no los de otra (INV-01), y sigue sin leer sus miembros.
- **RF-805 (Should).** Asignar un equipo a una ruta de la misión. `updateMissionRoute` ya admite `teamId: Id | null` y `MissionRouteStaff.team`, y `MissionRouteRescuer.team` ya existen. Solo falta el selector en la interfaz (doc 07 H4: «el selector llega con los equipos en H5»).
- **RN-21.** Nada de contacto en equipos ni en selectores. `TeamDetail.members` es `PersonRef[]` (`id`, `displayName`).
- **Firmas** (`packages/contracts/src/endpoints.ts` y `teams.ts`):
  - **`listTeams`** · `GET /teams` · personal (STAFF). Consulta: `page`, `pageSize`, `status?` (`active` | `archived`) y `q?`. Responde 200 con una página de `TeamItem {id, name, locality, status, memberCount}`.
  - **`createTeam`** · `POST /teams` · `TEAM_MANAGERS` · auditada. Recibe `{name, locality}`. Responde 201 con `TeamDetail` (`TeamItem` más `members: PersonRef[]` y `createdAt`). Error propio: `DUPLICATE_NAME`.
  - **`getTeam`** · `GET /teams/{teamId}` · STAFF. Responde 200 con `TeamDetail`.
  - **`updateTeam`** · `PATCH /teams/{teamId}` · `TEAM_MANAGERS` · auditada. Recibe `{name?, locality?, status?}`, con al menos uno. Responde 200 con `TeamDetail`. Error: `DUPLICATE_NAME`.
  - **`addTeamMembers`** · `POST /teams/{teamId}/members` · `TEAM_MANAGERS` · auditada. Recibe `{userIds: Id[] (1–200)}`. Responde 200 con `TeamDetail`.
  - **`removeTeamMember`** · `DELETE /teams/{teamId}/members/{userId}` · `TEAM_MANAGERS` · auditada. Responde 204.
  - **`listRescuers`** · `GET /rescuers` · STAFF. Consulta: `page`, `pageSize`, `q?`, `teamId?` y `profileComplete` (por defecto `true`). Responde 200 con una página de `RescuerPickerItem {userId, displayName, teams: TeamRef[]}`.
  - Las misiones del rescatista (`MyMissionItem`, `MyMissionDetail` en `missions.ts`) llevan `coordinatorName: string | null`, que hoy es `null` para el rescatista (`apps/api/src/missions/my-missions.service.ts:36`).
- **Base de datos que ya existe:**
  - `teams (id, organization_id, name, locality, status team_status DEFAULT 'active', created_at)`;
  - `team_members (team_id, user_id, organization_id, added_at)`, con su clave foránea a `memberships`;
  - las políticas `teams_write` y `team_members_write` (`app_is_staff()`);
  - `missions.coordinator_id`.
- **Código que ya existe:**
  - En la API: `apps/api/src/admin/` (modelo de servicio con paginación y `likePattern`), `apps/api/src/missions/my-missions.service.ts`, `profile.service.ts` (paso a `complete`, línea ~89), `signup-requests.service.ts` (`admin_decide_signup`) y `users.service.ts` (cambio de rol).
  - En la web: la ruta `/teams`, que hoy es una `LaterPage` (`apps/web/src/app/routes.tsx:133`); `navigation.ts` (`teams: STAFF`); `mission-routes-section.tsx:387` (celda de equipo, solo lectura); `my-missions-page.tsx:98` y `my-mission-detail-page.tsx:91` (`coordinatorName ?? coordinatorNeutral`).
  - En la semilla: 4 equipos en `data/seed/demo.json` y `seed.ts:254`.

## 3. Qué cambia, por carpeta

**`packages/contracts`**
- **`src/alias.ts`, nuevo. Funciones puras, que usan la API y la web:**
  - **`normalizeWord`:** quita acentos y deja solo letras.
  - **`aliasBase(fullName)`:** tres letras de cada una de las tres primeras palabras, en minúscula: «Cristian Antón Valdés» → `criantval`. Con dos palabras sale `criant`. Las partículas «de», «del», «la», «y» se saltan. Una palabra corta aporta las letras que tenga.
  - **`localityCode(locality)`:** la primera letra y las consonantes siguientes, en mayúscula, hasta 3. Si no llega a 3, se completa con las letras siguientes: Jaca → `JCA`.
  - Se exportan en `index.ts`.
- **`teams.ts`:**
  - `TeamItem`, y con él `TeamDetail`, ganan `code`.
  - `CreateTeamRequest` gana `code` (`^[A-Z0-9]{3}$`).
  - `UpdateTeamRequest` gana `code?`. Cambiarlo no toca los alias ya fijados.
  - `DUPLICATE_NAME` lleva `details.field: 'name' | 'code'`.
- **`missions.ts`:** `MyMissionItem` y `MyMissionDetail` ganan `coordinatorAlias: string | null`.
- **`milestones.ts`:** `listRescuers: 'H5'`.
- **Notas en `endpoints.ts`:**
  - los equipos archivados no admiten miembros nuevos (`INVALID_STATE_TRANSITION`);
  - los miembros son personas activas de la organización, de cualquier rol;
  - `listRescuers` sin contacto;
  - el alias y cuándo se fija.
- Se regeneran el OpenAPI y el doc 06.

**`db/migrations/0015_teams_code_alias.sql`**
- **`teams.code`:**
  - se añade como columna nullable y se rellena en los equipos que ya existen con la regla de `localityCode`, hecha en plpgsql con `translate` de acentos;
  - si dos equipos chocan, el último carácter pasa a ser un dígito del 2 al 9;
  - después, `SET NOT NULL`, `CHECK (code ~ '^[A-Z0-9]{3}$')` y `UNIQUE (organization_id, code)`.
- **`teams_select`:** se sustituye por la lectura de todos los roles de la organización (D-34). La restrictiva `org_isolation` sigue.
- **`memberships.alias`:** `text NULL`, con `UNIQUE (organization_id, lower(alias))` parcial `WHERE alias IS NOT NULL`. La aplicación no la escribe directamente (permiso por columna, como DB-13).
- **`set_member_alias(p_user uuid, p_base text, p_code text) RETURNS text`**, `SECURITY DEFINER`.
  - Puede llamarla la propia persona o el personal de su organización, y la persona debe tener membresía en `app_org_id()`.
  - Si no tiene alias y `p_base` no es nulo, fija el primero libre entre `base`, `base2`, `base3`… Si además llega `p_code`, el alias es `base CODE`.
  - Si ya tiene alias sin código y llega `p_code`, añade ` CODE`. Si con eso choca, el sufijo numérico va antes del código.
  - En cualquier otro caso no cambia nada (alias fijo).
  - Devuelve el alias.
- **`mission_coordinator_alias(p_mission uuid) RETURNS text`**, `SECURITY DEFINER` y `STABLE`. Devuelve el alias del responsable si la misión es de `app_org_id()` y la puede ver quien llama: el personal, o un rescatista si la misión está activa o cerrada (RN-16). Si no, `NULL`.
- `GRANT EXECUTE` a `onway_app` y `REVOKE` de `PUBLIC`. La entrada va en `meta/_journal.json`.

**`apps/api`**
- **`src/teams/teams.service.ts`, `teams.controller.ts` y `teams.module.ts`, nuevos.** Las 6 operaciones de equipos:
  - **Lista:** búsqueda por nombre o localidad, filtro de estado, paginación y `memberCount`.
  - **Detalle:** los miembros activos por nombre, como `PersonRef`.
  - **Crear y editar:** un `23505` de `teams_org_name_uq` da `DUPLICATE_NAME` con `field: 'name'`, y el de la unicidad del código, `field: 'code'`.
  - **Archivar y reactivar:** con `status`.
  - **Añadir miembros:**
    - solo en un equipo activo;
    - `userIds` deben ser miembros activos de la organización; si no, `VALIDATION_FAILED` con `path = userIds`;
    - si ya son miembros, no pasa nada;
    - al entrar en su **primer** equipo, `set_member_alias(user, null, team.code)` añade el código.
  - **Quitar:** 404 si no era miembro.
  - **Auditoría:** `team_created`, `team_updated`, `team_members_added` y `team_member_removed`, con ids y nunca nombres.
- **`src/teams/rescuers.service.ts`:** `listRescuers`. Rescatistas activos con perfil `complete` por defecto, búsqueda por nombre, filtro `teamId`, sus equipos activos y orden por nombre.
- **Alias, en tres caminos:**
  - **`profile.service.ts`:** al pasar a `complete`, `set_member_alias(self, aliasBase(fullName), primerCódigo)`.
  - **`signup-requests.service.ts`:** al aprobar como coordinador, `set_member_alias(user, aliasBase(displayName), null)`.
  - **`users.service.ts`:** al pasar a coordinador o administrador alguien sin alias, lo mismo.
- **`my-missions.service.ts`:** `coordinatorAlias = mission_coordinator_alias(m.id)`. `coordinatorName` sigue a `null` para el rescatista.
- **`src/audit/audit.writer.ts`:** `recordTeam`. **`app.module.ts`** monta `TeamsModule`, y `app.test.ts` pasa a 81 y sin operaciones de H5 por montar.
- **`src/seed/`:**
  - los equipos llevan su `code` (Biescas `BSC`, Benasque `BNS`, Torla `TRL`, Sabiñánigo `SBN`);
  - alias para todos los miembros que aún no lo tienen (rescatistas completos con su nombre completo, y personal con su nombre visible, con el código de su primer equipo);
  - es idempotente y deja los alias ya fijados como están.

**`apps/web`**
- **`src/teams/`, nuevo:**
  - **`queries.ts`:** `useTeams`, `useTeam`, `useCreateTeam`, `useUpdateTeam`, `useAddMembers`, `useRemoveMember` y `useRescuers`.
  - **`teams-page.tsx`:** la vista `/teams`, que sustituye la `LaterPage`.
    - Pestañas Activos / Archivados, búsqueda y paginación, todo en la dirección.
    - Estados de carga, vacío y error.
    - Cada fila lleva nombre, localidad y código, y número de miembros.
  - **`team-form-dialog.tsx`:** crear y editar con nombre, localidad y código. El código se propone con `localityCode` mientras el usuario no lo haya tocado. `DUPLICATE_NAME` sale en el campo que diga `details.field`.
  - **`team-page.tsx`:** `/teams/:teamId` con los miembros (solo nombres), «Quitar» con confirmación, «Añadir miembros» y «Archivar» o «Reactivar» con confirmación.
  - **`add-members-dialog.tsx`:** el selector con `listRescuers` (búsqueda y paginación), casillas de hasta 200 y los que ya son miembros marcados y desactivados.
- **`src/missions/mission-routes-section.tsx`:**
  - la celda de equipo pasa a ser un selector con `listTeams` en estado `active` (`<select>` con «Sin equipo»), que envía `updateMissionRoute {teamId}` y solo aparece cuando la misión no está cerrada;
  - en el diálogo «Añadir ruta», el equipo opcional queda fuera de este hito.
- **`my-missions-page.tsx` y `my-mission-detail-page.tsx`:** se muestra `coordinatorAlias ?? coordinatorName ?? coordinatorNeutral`.
- **`app/routes.tsx` y `nav/navigation.ts`:** las rutas de equipos. **`packages/i18n`:** `teams.*` en es y fr.

**`infra/scripts/smoke.sh`**
- El coordinador lista equipos y recibe los 4 de la semilla, con código.
- `rescatista1` recibe 403 en `listTeams`.
- `listRescuers` no trae teléfono ni correo.
- `listMyMissions` de `rescatista1` trae `coordinatorAlias` no nulo.

## 4. Puertos implicados

`Clock`, para `created_at` y la auditoría. No hay puertos nuevos.

## 5. Decisiones

| Id | Decisión | Alternativa descartada |
|---|---|---|
| D-E1 | **El alias vive en `memberships`**: es por organización y su unicidad es por organización. Lo escribe solo `set_member_alias` (`SECURITY DEFINER`) | Una columna en `users`, que no es de la organización, o escribirla desde la aplicación, que deja la unicidad y el «fijo» al cuidado del servicio |
| D-E2 | **El alias se calcula en TypeScript** (`packages/contracts/src/alias.ts`: la base y el código) y **se asigna en SQL**, que resuelve colisiones y lo fija. La web reutiliza `localityCode` para proponer el código | Calcularlo todo en SQL: normalizar nombres en plpgsql es frágil y no se comparte con la web |
| D-E3 | **El rescatista lee el alias del responsable con `mission_coordinator_alias`**, `SECURITY DEFINER` y solo para misiones que puede ver. `coordinatorName` sigue a `null` para él | Abrirle la lectura de `users` o `memberships`, que deja salir datos personales (regla 3) |
| D-E4 | **Miembros de cualquier rol activo**: un coordinador puede ser de un equipo. El selector `listRescuers` solo ofrece rescatistas; añadir personal se hace por API | Solo rescatistas, cuando la semilla y el alias de un coordinador con equipo («`… ALC`») suponen lo contrario |
| D-E5 | **Un equipo archivado no admite miembros nuevos** (`INVALID_STATE_TRANSITION`). Sus miembros se conservan y se puede reactivar | Vaciarlo al archivar: se pierde a quién tenía |
| D-E6 | **Cambiar el código de un equipo no toca los alias ya fijados** (Q-36: fijo) | Regenerarlos: rompe que sean fijos |
| D-E7 | **Selector de RF-805 con `<select>` nativo** en la celda, con los equipos activos | Un diálogo aparte: más pasos para un solo campo |

## 6. Riesgos

- **Relleno de `teams.code` en una base que ya tiene datos**, como la pila `onway` del usuario. Si dos equipos chocan, se resuelve con dígitos. La prueba de la migración parte de una base con equipos.
- **Dos personas que reciben a la vez el mismo alias base.** `set_member_alias` toma `pg_advisory_xact_lock` por organización y la unicidad parcial es la defensa final.
- **El E2E en paralelo.** La demostración solo crea equipos «E2E …» y cuentas `e2e-…`, y deja los equipos archivados. Ampliar `teams_select` no cambia lo que ven las demostraciones anteriores, salvo `team` en las rutas del rescatista, que pasa de `null` al equipo. Hay que revisar `h4-demo` y las pruebas que esperaban `null` (C3).
- **El tamaño del hito:** 10 tareas. Si crece, el selector de RF-805 puede pasar a una vía `/feature` posterior.

## 7. Verificación

**Pruebas por invariante, contra base real:**
- **INV-23** (`test:db teams-alias` y `test:api teams`): no se crea un equipo sin localidad ni sin código. El nombre y el código son únicos por organización.
- **D-34 e INV-01** (`test:db teams-alias` y `test:api mission-routes-rescuer`):
  - el rescatista lee todos los equipos de su organización, ninguno de otra, y ningún `team_members` ajeno;
  - `listMyMissionRoutes.team` llega relleno también si no es miembro.
- **Q-12** (`test:api teams`): coordinador y administrador escriben, el rescatista recibe 403, otra organización da 404 y la auditoría no lleva nombres.
- **Alias** (`test:db teams-alias` y `test:api teams profile`):
  - se fija al completar el perfil y al aprobar un coordinador;
  - el código se añade al entrar en el primer equipo y no cambia al entrar en otro, al salir ni al renombrar;
  - una colisión lleva sufijo;
  - `mission_coordinator_alias` no responde para una misión en planificación si quien llama es un rescatista;
  - `set_member_alias` rechaza a quien no es la propia persona ni del personal.
- **Unitarias de `alias.ts`** (`pnpm check @onway/contracts`): «Cristian Antón Valdés» → `criantval`; Alicante → `ALC`; Sabiñánigo → `SBN`; Jaca → `JCA`; partículas y palabras cortas.
- **RN-21 y regla 3:** `listRescuers` y `getTeam` sin contacto (`schema-guards`).

**Demostración del hito:** `apps/web/e2e/h5-equipos-demo.spec.ts`, en escritorio y a 375 px.

**Comandos:**
- Por tarea, la línea «Comprobación».
- Al cerrar, la verificación completa de `CLAUDE.md` y el E2E con `CI=1` en `onway-e2e`.

## 8. Rama

`hito/H5-equipos`. Commits con el formato `<tipo>(H5-equipos): Tn <resumen>`.

## 9. Documentos que habrá que actualizar

- **Doc 01:** Q-36 con el detalle de las respuestas (código de equipo, nombre de origen, dónde se ve) y D-34 construida, con su registro de cambios.
- **Doc 03:** el equipo gana el código y la membresía gana el alias, con su registro.
- **Doc 05:** la 0015 (columnas, funciones y la nueva `teams_select`), la matriz de permisos y su registro.
- **Doc 06:** regenerado (`code`, `coordinatorAlias`, `listRescuers` en H5), con su registro.
- **Doc 02 §3.8:** «Tal como se construyó (`H5-equipos`)», con su registro.
- **Doc 07:** «Tal como se construyó (`H5-equipos`)», con H5 completo (81 montadas) y su registro.
- **`docs/backlog-post-mvp.md`:** B-01 y B-02 construidos, y el pendiente (a) resuelto para el rescatista.
- **`data/seed/README.md`:** los códigos y los alias.
- **`apps/web/e2e/README.md`**, **`CLAUDE.md`** (`smoke.sh` y `test:db`), **`docs/estado.md`** y **`docs/historial.md`**.
