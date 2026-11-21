# issue-rutas-nombre-y-desvincular · Nombre de las rutas y desvincularlas de la misión — Plan

Estado: **APROBADO por el usuario el 2026-11-21** (D-N1 a D-N8 y preguntas 1 a 3 tal como se proponían) · Origen: petición del usuario del 2026-11-21 (sin número de issue todavía) · Rama: `hito/issue-rutas-nombre`, desde `hito/UI-simplificacion` (D-N8).

**Qué pasa hoy (flujo del coordinador).** Crea una misión con nombre, uno o varios orígenes y el objetivo, y genera rutas desde la misión. En el formulario, el nombre es opcional («Nombre (opcional)»). Si lo deja vacío, el servidor llama a todas «Ruta generada 1», «Ruta generada 2»… (`DEFAULT_NAME_PREFIX`), y no hay forma de cambiar el nombre después. La biblioteca se llena de rutas que se llaman igual. Además, quitar una ruta de la misión ya existe, pero no se encuentra: es la opción «Quitar» de un menú ⋯ de icono en la fila de la tabla de la misión. Sin quitarla, archivar responde `ROUTE_IN_USE` y la ruta no se puede eliminar (protocolo de la issue #17: quitar → archivar → eliminar).

**Qué pide el usuario:**
1. Nombre **obligatorio** al generar. Por defecto, el **nombre del punto de inicio** con el índice de la alternativa («Collado Norte 1», «Collado Norte 2»…).
2. Poder **cambiar el nombre** de una ruta después.
3. Poder **desvincular** una ruta de la misión mientras la misión esté **en planificación o activa** («estamos expuestos a cambios: meteorología, perfil de los rescatistas…»). Con la misión **cerrada**, solo lectura (regla 5 sin cambios).

**No es un hito de v1.** Como las issues #17 y #18, es un cambio de alcance pedido por el usuario. **No revierte ninguna regla inviolable.** Renombrar no rompe la inmutabilidad de las versiones, porque el nombre vive en `routes` y no en `route_versions` (regla 4, RN-12, INV-04). Desvincular de una misión cerrada sigue prohibido (regla 5, INV-11, D-I6).

## 1. Alcance

- **Requisitos:** RF-501 (el nombre pasa a obligatorio), RF-512 (renombrar desde el detalle; quitar de la misión desde «Usada en»), RF-513 (quitar de la misión, más visible), RN-12 y RN-14 (sin cambios, se respetan).
- **Invariantes tocados:** INV-16 (renombrar deja auditoría), INV-01 (aislamiento de la operación nueva), INV-11 (sin desvincular en una misión cerrada; solo se prueba, no cambia). Cada uno con su prueba contra base real.
- **Operación nueva (1):** `updateRoute`, con `PATCH /routes/{routeId}`, cuerpo `{ name }` (`strictObject`, `trim`, 1 a 160 caracteres, como `routes.name` en la base) y respuesta `200 RouteDetail`. Roles `MISSION_WRITERS` (coordinador), *auditada*, errores `INVALID_STATE_TRANSITION` (ruta archivada) y `VALIDATION_FAILED`, `x-milestone: H2` (es de la biblioteca, como `deleteRoute`). Quedan 98 en el registro y **60 montadas**. `CURRENT_MILESTONE` sigue en `'H5'`.
- **Operaciones que cambian (2):**
  - `generateRoutes`: `namePrefix` pasa de opcional a **obligatorio** (1 a 100 caracteres). Sin él, `VALIDATION_FAILED`.
  - `getRoute`: cada elemento de `usedIn` gana `missionRouteId` (aditivo), para poder quitar desde el detalle con la operación que ya existe.
- **Sin cambios:** `removeMissionRoute`, que ya devuelve `MISSION_CLOSED` con la misión cerrada; `archiveRoute`; `deleteRoute`.
- **Fuera:** renombrar una ruta archivada; desvincular en una misión cerrada; renombrar o quitar varias a la vez; nombres únicos en la biblioteca (hoy no lo son y no se pide); renombrar en masa las «Ruta generada N» que ya existen (se hace a mano con la operación nueva); cambios en la base de datos.

## 2. Contexto para el implementador

Texto mínimo de cada identificador. No hace falta abrir los docs 01 a 06.

- **RF-501 (Must) Crear ruta generándola.** «Dados un punto de inicio y un punto final, la app calcula una o más rutas por la red existente… Se puede lanzar desde la biblioteca (el coordinador elige los dos puntos) o desde una misión (se rellenan con el objetivo y un origen de la misión). Desde una misión, requiere objetivo y al menos un origen (RN-08)… Cada alternativa se guarda como una ruta de la biblioteca, en *Borrador*, versión 1.» Hoy, en el doc 02 §3.6 A paso 3: «Elige el número de alternativas (1 a 4) y, **si quiere**, el nombre: se añade el número de la alternativa.» → pasa a «y el nombre (obligatorio; se propone el del punto de inicio): se añade el número de la alternativa».
- **RF-402.** «Puntos de origen: cero, uno o varios por misión, **cada uno con nombre** y descripción.» Por eso un origen de misión siempre tiene nombre que proponer.
- **RF-512 (Must) Biblioteca.** «Detalle de cada ruta: mapa, métricas, historial de versiones, ruta de la que deriva y **misiones donde se usa**… Una ruta usada en alguna misión no se puede eliminar, solo archivar (RN-14). Una ruta archivada y sin misión se elimina definitivamente desde la lista de archivadas…; para eliminar una activa hay que quitarla de sus misiones, archivarla y eliminarla (issue #17).»
- **RF-513 (Must) Añadir ruta a una misión.** La misión fija una versión. En el doc 03 §8.3 punto 9: «Quitar una ruta de la misión no la borra (RN-14): vuelve a poder archivarse si ya no está en ninguna misión sin cerrar (INV-07).»
- **RN-12 / INV-04.** «Las versiones de ruta son inmutables. Editar crea una versión nueva.» «Una versión de ruta guardada no cambia, y una validada solo se borra junto con su ruta archivada y sin misión.» **El nombre no es de la versión:** `routes.name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160)` (`db/migrations/0005_routes.sql:36`).
- **INV-07.** «Una ruta en alguna misión no cerrada no se archiva, y una ruta en cualquier misión (también cerrada) no se elimina.»
- **INV-11 / regla 5.** «Una misión cerrada no admite ninguna escritura salvo reabrirla.» `removeMissionRoute` ya responde `409 MISSION_CLOSED`, y el disparador `mission_routes_open_trg` (0007) lo garantiza en la base.
- **INV-16.** «Todo cambio en misiones, rutas y participación genera un registro de auditoría.» Doc 03 §16: «Ruta creada, derivada o archivada — Coordinador» → se añade «renombrada».
- **INV-01 / regla 1.** Un recurso de otra organización responde 404, nunca 403. Lo garantiza la política RLS `routes_staff` (`FOR ALL … app_is_staff()`, 0008) más el filtro de la aplicación. **Regla 2:** el rescatista y el administrador no escriben en rutas. `MISSION_WRITERS` es solo el coordinador, y la API lo decide.
- **Operación existente:** `removeMissionRoute`, con `DELETE /missions/{missionId}/routes/{missionRouteId}`, 204, `MISSION_WRITERS`, auditada, error `MISSION_CLOSED`. Deja la ruta en la biblioteca.
- **Convenciones:** `strictObject`; errores solo de `ERROR_HTTP`; textos por `packages/i18n` (es y fr); cada vista con carga, vacío y error, móvil y teclado; la interfaz de `UI-simplificacion` lleva una acción principal por vista y el resto en «Más ⋯» o en el «⋯» de cada fila.

## 3. Qué cambia, por carpeta

**`packages/contracts`**
- `src/routes.ts`:
  - `GenerateRoutesRequest.namePrefix` pasa a obligatorio: `z.string().trim().min(1).max(100)`.
  - `RouteDetail.usedIn[]` gana `missionRouteId: Id`.
  - Esquema nuevo `UpdateRouteRequest = z.strictObject({ name: z.string().trim().min(1).max(160) })`.
- `src/endpoints.ts`:
  - `updateRoute`, en el bloque «Biblioteca de rutas», junto a `archiveRoute`. Nota: «Solo cambia el nombre de la ruta; las versiones no cambian (RN-12). Con la ruta archivada, INVALID_STATE_TRANSITION.»
  - En la nota de `generateRoutes`: «`namePrefix` obligatorio: cada alternativa se llama `<namePrefix> <n>`».
- `src/milestones.ts`: `updateRoute: 'H2'`.
- Se regeneran `openapi.json` y el doc 06 (`gen:openapi`, `gen:doc`).
- `test/registry.test.ts` pasa a 98 operaciones.

**`apps/api`** (módulo `src/routes/`)
- `route-generation.service.ts`: desaparece `DEFAULT_NAME_PREFIX`; se usa `params.namePrefix` tal cual. Las alternativas siguen siendo `${prefix} ${index + 1}`.
- `route-reads.ts`: la consulta de `usedIn` también devuelve `mission_routes.id` como `missionRouteId`.
- `route-writes.service.ts`: método `rename(viewer, routeId, name)`, que sigue el patrón de `archive`:
  1. abre la transacción con el contexto;
  2. bloquea la ruta con `SELECT … FOR UPDATE` (si no existe en la organización, `NOT_FOUND`);
  3. si está `archived`, `INVALID_STATE_TRANSITION`;
  4. `UPDATE routes SET name`;
  5. registra `audit.recordRoute` con la acción `route_renamed` y el detalle `{ from, to }` (sin geometría ni datos personales);
  6. devuelve el detalle.

  Si el nombre no cambia, se responde 200 sin auditar.
- `routes.controller.ts`: `@Operation('updateRoute')`.
- `src/audit/audit.writer.ts`: `RouteAuditAction` gana `'route_renamed'`.
- Sin cambios en el historial de la misión: renombrar es de la biblioteca.

**`apps/web`**
- `src/pages/generate-routes-page.tsx`:
  - El campo nombre deja de ser opcional: es obligatorio, con asterisco y error en línea (`TextField` o el patrón actual de `field` con `aria-invalid`), y no se envía sin nombre.
  - **Propuesta del nombre (D-N1):**
    - desde una misión, el nombre del origen elegido;
    - desde la biblioteca, el texto de la dirección si el inicio se eligió por dirección (`PickedPoint.label`); si no, vacío.
  - Mientras el coordinador no escriba nada, la propuesta sigue al origen elegido. En cuanto edita el campo, se respeta lo que escribió.
  - Debajo, una línea de ayuda con el ejemplo de lo que saldrá («Se llamarán «Collado Norte 1», «Collado Norte 2»…»).
- `src/library/route-dialogs.tsx`: `RenameDialog({ routeId, currentName, onClose, onRenamed? })`.
  - Campo con el nombre actual, foco en el campo, `trim` y obligatorio.
  - Error de servidor con `errorMessage`.
  - Al terminar invalida `['route', routeId]`, `['routes']` y `['missions']`.
- `src/pages/route-detail-page.tsx`:
  - «Más ⋯» gana «Cambiar nombre» (solo si `canWrite` y la ruta no está archivada).
  - La sección **«Usada en»** gana, en cada misión en planificación o activa y para quien escribe, un botón **«Quitar de la misión»**. Pide confirmación en la misma fila, como en la tabla de la misión, con foco en «No quitar», y llama a `removeMissionRoute` con `missionRouteId`.
  - Para las cerradas no hay botón, solo el texto «cerrada · solo lectura».
- `ArchiveDialog`: con `ROUTE_IN_USE`, el mensaje dice en qué misiones está y **cómo quitarla** («Quítala desde «Usada en», en esta misma página»).
- `src/missions/mission-routes-section.tsx`: en el «⋯» de la fila, la opción pasa de «Quitar» a **«Quitar de la misión»** y se añade **«Cambiar nombre»** (reutiliza `RenameDialog`). Con la misión cerrada o para el administrador sigue sin aparecer ninguna opción de escritura.
- Sin lógica de rutas ni geometría en componentes (regla 9). La propuesta del nombre es texto.

**`packages/i18n`** (es y fr, paridad por la prueba existente)
- Claves que cambian: `generate.nameLabel` («Nombre de las rutas»), y `missionRoutes.remove.action` y `confirm`.
- Claves nuevas:
  - `generate.nameRequired`, `generate.nameHint`;
  - `routeDetail.actions.rename`, `routeDetail.rename.*` (título, campo, guardar, guardando, cancelar, hecho);
  - `routeDetail.relations.remove*`, `routeDetail.relations.closedReadOnly`;
  - `routeDetail.archive.inUse`, con la indicación de cómo quitarla;
  - `missionRoutes.rename.action`.

**`apps/web/e2e`**
- `rutas-nombre-demo.spec.ts` nuevo (escritorio y 375 px; francés solo con teclado).
- Se revisan las demostraciones que generan sin nombre: `h3-engine-down.spec.ts` genera desde la biblioteca y ahora tiene que rellenar el nombre. `h3-demo` y `h4-demo` ya lo rellenan.

**No cambian:** `db/` (ni migración ni RLS: `routes_staff` ya permite el `UPDATE` al personal y la API restringe al coordinador), `packages/geo`, `infra/`, `data/seed`. La semilla ya pone nombres propios a sus rutas.

## 4. Puertos implicados

Ninguno.

## 5. Decisiones con alternativa descartada

| # | Decisión (propuesta) | Alternativa descartada |
|---|---|---|
| D-N1 | Desde la misión, el nombre **se propone** con el nombre del origen elegido y sigue al selector hasta que el coordinador escribe. Desde la biblioteca, con la dirección elegida si la hay; si no, vacío y obligatorio | Que lo ponga el servidor cuando falte (hoy): es justo lo que produce los nombres repetidos. Que la biblioteca use coordenadas como nombre: ilegible |
| D-N2 | El índice lo sigue añadiendo **el servidor** (`<nombre> <n>`), también con una sola alternativa («Collado Norte 1») | Un nombre por alternativa en el formulario: más campos para algo que se renombra después si hace falta |
| D-N3 | **`updateRoute` (`PATCH /routes/{routeId}`) con solo `{ name }`**, extensible después (etiquetas, Q-21) | `renameRoute` como verbo (`POST /routes/{id}/rename`): la convención de verbos es para cambios de estado, y editar datos va por `PATCH`, como `updateTeam` y `updateMission` |
| D-N4 | No se renombra una ruta **archivada** (`INVALID_STATE_TRANSITION`), como pasa con `createRouteVersion`. Una ruta activa que figura en una misión **cerrada** sí se puede renombrar: el nombre es de la biblioteca, y el historial de la misión y la auditoría conservan el nombre de entonces | Prohibirlo si está en una misión cerrada: bloquea para siempre las rutas viejas de la biblioteca (como la D-I6) sin proteger nada que la auditoría no guarde ya |
| D-N5 | Se audita `route_renamed` con `{ from, to }`. Renombrar con el mismo nombre responde 200 y no audita | Auditar siempre: llena el registro de cambios sin cambio real |
| D-N6 | Quitar de la misión desde **dos sitios**: el «⋯» de la fila («Quitar de la misión», con el texto completo) y la sección **«Usada en»** del detalle de la ruta, donde el coordinador llega cuando archivar falla. El segundo usa la operación que ya existe; solo pide `missionRouteId` en `usedIn` (aditivo) | Solo cambiar el texto del menú: no resuelve que, desde la ruta, no haya forma de saber cómo soltarla. Una operación nueva «quitar de todas las misiones»: no se pide y mezcla misiones distintas en una sola confirmación |
| D-N7 | Con la misión **cerrada**: sin botón (solo «cerrada · solo lectura»). El servidor ya responde `MISSION_CLOSED` | Permitirlo: lo descartó el usuario (regla 5) |
| D-N8 | Rama **`hito/issue-rutas-nombre` creada desde `hito/UI-simplificacion`**: este cambio toca los mismos archivos (menús de la fila y del detalle) que `UI-simplificacion`, que aún no está fusionada. La pull request se abre después de la de `UI-simplificacion` | Desde `main`: obligaría a rehacer los menús de `UI-simplificacion` o a resolver conflictos grandes al fusionar. **Pendiente de tu confirmación (pregunta 1)** |

## 6. Riesgos

- **Contrato que deja de aceptar lo que aceptaba** (`namePrefix` obligatorio). El único cliente es la web, que cambia en la misma tarea. Un trabajo encolado antes del despliegue ya guardó su `namePrefix` en los parámetros del trabajo, o no lo llevaba. Para no fallar con esos, el worker usa `params.namePrefix` y, **solo si falta en un trabajo antiguo**, cae a «Ruta» con un aviso en el registro. Se prueba.
- **Renombrar cambia lo que ve el rescatista** en una misión activa (el nombre es de la ruta, no de la versión fijada). Es lo esperado: es la misma ruta. Se anota en el doc 02.
- **Carrera entre renombrar y archivar:** el `FOR UPDATE` de la ruta las ordena; se prueba.
- **Demostraciones que generan sin nombre:** `h3-engine-down.spec.ts` (biblioteca). Se ajusta en T7 y se corre el E2E entero.
- **Discoverability:** el problema de partida es de interfaz. La demostración E2E recorre el camino exacto del usuario: generar → no me gusta → quitar → archivar → eliminar.

## 7. Verificación

- **Contratos:** `pnpm --filter @onway/contracts test` (98 operaciones). `generateRoutes` sin `namePrefix` se rechaza; `UpdateRouteRequest` rechaza vacío, espacios, más de 160 caracteres y campos de más. `gen:openapi` y `gen:doc` sin diferencias salvo las esperadas.
- **API** (`test:api`, base real):
  - `generate-routes.test.ts`: sin nombre → 400 `VALIDATION_FAILED` sin trabajo; con «Collado Norte» → «Collado Norte 1…n»; un trabajo antiguo sin `namePrefix` no falla.
  - `routes-writes.test.ts` (`describe('updateRoute')`):
    - renombra y devuelve el detalle, y las versiones quedan idénticas (INV-04);
    - una fila `route_renamed` con `from` y `to` (INV-16), y ninguna si el nombre es el mismo;
    - archivada → 409 `INVALID_STATE_TRANSITION`;
    - vacía → 400;
    - administrador y rescatista → 403;
    - otra organización → 404 (INV-01);
    - renombrar y archivar a la vez quedan ordenados.
  - `routes-reads.test.ts`: `usedIn[].missionRouteId` existe y sirve para `removeMissionRoute`.
  - `mission-routes-writes.test.ts`: `removeMissionRoute` con la misión cerrada → 409 `MISSION_CLOSED` (INV-11; ya existe, se comprueba que sigue).
  - AC-02 de `app.test.ts` con 60 montadas.
- **Web** (`pnpm --filter @onway/web test`):
  - `generate-routes.test.tsx`: el nombre propuesto es el del origen y cambia con el selector hasta que se escribe; vacío → error en línea y no llama a la API; la línea de ejemplo.
  - `route-detail.test.tsx`:
    - «Cambiar nombre» en «Más ⋯» (no en archivada ni para el administrador);
    - el diálogo valida y guarda;
    - «Quitar de la misión» en «Usada en» solo para misiones en planificación o activas, con confirmación;
    - el mensaje de `ROUTE_IN_USE`.
  - `mission-routes.test.tsx`: «Quitar de la misión» y «Cambiar nombre» en el «⋯», y ninguno con la misión cerrada.
  - Todo en es y fr.
- **Demostración E2E** (`rutas-nombre-demo.spec.ts`, escritorio y 375 px, francés solo con teclado):
  1. Un coordinador genera rutas desde una misión: el nombre viene propuesto con el del origen; si lo borra, no se puede generar.
  2. Las rutas salen como «<origen> 1», «<origen> 2».
  3. Renombra una desde la fila de la misión y otra desde su detalle.
  4. Desde el detalle de una ruta, «Usada en» → «Quitar de la misión» → la archiva → desde `/routes?status=archived` la elimina.
  5. En una misión cerrada no hay «Quitar de la misión» ni en la fila ni en «Usada en».

  Pila: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables, `E2E_BASE_URL=http://localhost:18080 CI=1 pnpm --filter @onway/web e2e`.
- **Al cerrar:** `pnpm lint`, `format:check`, `typecheck`, `test`, `build`, `test:db` (no cambia, pero se corre), `test:api`, `db/tests/run-postgis.sh` y E2E. Los 12 criterios del doc 07 §4. Revisores: `reviewer`, `reviewer-ui`, `reviewer-security` (operación de escritura nueva y permisos) y `reviewer-db` (consultas de `apps/api`).

## 8. Documentos que habrá que actualizar

| Documento | Cambio | Registro |
|---|---|---|
| `docs/01` | RF-501: nombre obligatorio, propuesto con el del punto de inicio. RF-512: renombrar desde el detalle y quitar de la misión desde «Usada en» | §12 |
| `docs/02` | §3.6 A paso 3 (nombre obligatorio y propuesto). Acciones del detalle de ruta («Cambiar nombre» en «Más»; «Usada en» con «Quitar de la misión»). Tabla de la misión §3.5 («Quitar de la misión», «Cambiar nombre»). Nota: renombrar cambia el nombre que ve el rescatista | §12 |
| `docs/03` | §16 «Ruta creada, derivada, **renombrada** o archivada». §8.3 punto 9 (dónde se quita) | §19 |
| `docs/06` | `updateRoute`, `namePrefix` obligatorio, `usedIn.missionRouteId`, recuento (OpenAPI regenerado) | §13 (1.11) |
| `docs/07` | Subsección nueva «Issue · Nombre de las rutas y desvincular» y fila «Tal como se construyó» | §8 |
| `docs/estado.md` y `CLAUDE.md` | Estado, siguiente paso y recuentos de operaciones | — |

`docs/04` y `docs/05` no cambian (sin tablas, columnas ni políticas nuevas).

## 9. Preguntas abiertas para el usuario

1. **Rama (D-N8):** ¿se crea desde `hito/UI-simplificacion` (propuesto, porque toca los mismos menús) o esperas a fusionar `UI-simplificacion` y se crea desde `main`?
2. **Desde la biblioteca (D-N1):** si el inicio se pica en el mapa o por coordenadas no hay nombre que proponer y el campo empieza vacío (obligatorio). ¿De acuerdo, o prefieres otra propuesta (por ejemplo, «Ruta» + fecha)?
3. **Renombrar una ruta que está en una misión cerrada (D-N4):** se permite (propuesto). ¿De acuerdo?
