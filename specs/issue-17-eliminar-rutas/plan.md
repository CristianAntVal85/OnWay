# issue-17-eliminar-rutas · Eliminar rutas definitivamente — Plan

Estado: **BORRADOR 2, pendiente de aprobación del usuario** · Origen: issue #17 · Rama prevista: `hito/issue-17-eliminar-rutas` (desde `main`; aún no creada) · Fase: Cambio de alcance (`/sdd-change`), sin código.

**Revisión 2 (el usuario recorta la issue).** El motivo es práctico: hay rutas ficticias en línea recta que solo manchan el mapa. Se define un **protocolo de borrado** en tres pasos y **solo hay botón de eliminar en la lista archivada** (`/routes?status=archived`), con selección múltiple. En el detalle `/routes/:id` y en la lista de activas **no hay botón de eliminar**, por lo que se descarta el punto 2 de la issue. Los pasos son:
1. **Quitar** la ruta de las misiones en planificación o activas (ya se puede hacer: «Quitar ruta de la misión»; comprobado por el usuario).
2. **Archivarla** (ya existe; INV-07 exige que no esté en ninguna misión no cerrada).
3. **Eliminarla** desde `/routes?status=archived`, seleccionando una o varias.

**No es un hito de v1.** Como `H5-acceso` (issue #9) y `UI-rediseno` (issue #14), es un cambio aprobado por una issue. **A diferencia de ellos, revierte una decisión de los documentos y un principio de la constitución**, así que antes de escribir código hay que editar esos documentos (§6) y el usuario debe aprobarlo expresamente.

## 0. Qué contradice (y qué documento hay que editar)

| Dónde | Dice hoy | Cambio propuesto | Registro de cambios |
|---|---|---|---|
| `docs/constitution.md` punto 10 | «Versiones de ruta inmutables; **se archivan, no se borran**» | «…se archivan; solo se elimina del todo una ruta archivada y sin misión, por decisión expresa del coordinador (issue #17)» | Anotar en su historial, si lo tiene; si no, en `docs/estado.md` |
| `CLAUDE.md` regla inviolable 4 | «Las rutas se archivan, no se borran» | Igual que arriba; la regla 4 conserva «las versiones son inmutables» mientras la ruta exista | (índice, sin registro propio) |
| `docs/01` **RN-14** (§ reglas) y **RF-512** | «Una ruta usada en alguna misión no se elimina. Se archiva.» | «Una ruta usada en alguna misión **no se elimina**. Una ruta **archivada y sin misión** se puede eliminar definitivamente.» | `01` §12 Registro de cambios |
| `docs/03` §5 (versión validada «no se borra»), §6 (ciclo de la ruta), **INV-04** e **INV-07** | INV-04: «una versión guardada no cambia»; INV-07: «una ruta en misión no cerrada no se elimina ni se archiva» | INV-04 se reformula: la versión no se *modifica*, y una validada solo desaparece junto con su ruta archivada y sin misión. INV-07 se amplía: **una ruta que esté (o haya estado) en cualquier misión, también cerrada, no se elimina**. Ciclo de la ruta: *Activa ⇄ Archivada → Eliminada* (terminal) | `03` §19 |
| `docs/05` §5 tabla de invariantes, §6.3 matriz, §15 | INV-04: `route_versions_guard` impide borrar una validada | Migración **0013** (§2); INV-04 e INV-07 con su nueva redacción; DB-15 sin cambio | `05` §15 |
| `docs/06` `archiveRoute` (nota «No existe DELETE de rutas (RN-14)»), §1 recuento, §13 | 96 operaciones | `deleteRoute`: 97 operaciones; la nota de `archiveRoute` cambia | `06` §13 (siguiente versión tras la 1.9) |
| `docs/02` §3.6 (acciones de la lista; el detalle **no** cambia) y §8 (casos límite «Se intenta eliminar una ruta usada») | «solo archivar» | Botón «Eliminar seleccionadas» **solo en la lista de archivadas**, con su confirmación; el protocolo quitar → archivar → eliminar; el caso límite pasa a «solo se elimina lo archivado y sin misión» | `02` §12 |
| `docs/07` | No hay sección | Sección nueva para este cambio, como la de `UI-rediseno` | `07` §8 |

**Decisión del usuario (no se reabre):** borrado real de **cualquier ruta archivada** (y sin misión). Una ruta activa no se elimina: primero se archiva.

## 1. Alcance

- **Requisitos:** RF-512 (biblioteca) y RN-14 (modificada), RN-12 (se mantiene mientras la ruta existe). RF nuevos: ninguno.
- **Invariantes tocados:** INV-04 (reformulado), INV-07 (ampliado a «cualquier misión»). Cada uno con su prueba contra base real (regla 8). INV-01 (aislamiento) y las políticas de escritura de 0011 se prueban para la operación nueva.
- **Operación nueva (1):** `deleteRoute` — `DELETE /routes/{routeId}`, roles `MISSION_WRITERS` (coordinador), 204, *(auditado)*, errores `ROUTE_IN_USE` (la ruta está o estuvo en una misión; reutiliza `details.missions`) e `INVALID_STATE_TRANSITION` (la ruta no está archivada). Ningún código de error nuevo. `x-milestone: H2` (es de la biblioteca); `CURRENT_MILESTONE` sigue en `'H5'`: pasan a **59 las montadas** (97 en el registro). Contrato primero (regla 7).
- **Fuera:** el botón de eliminar en `/routes/:id` y en la lista de activas (revisión 2), desarchivar (pendiente (g) de `estado.md`), eliminar versiones sueltas, papelera o deshacer, eliminar rutas desde la misión, borrado por lotes atómico en el servidor. Archivar y quitar de la misión **no cambian**.

## 2. Qué cambia, por carpeta

**`packages/contracts`.** `endpoints.ts` (`deleteRoute`), `milestones.ts` (`deleteRoute: 'H2'`), nota de `archiveRoute`; se regeneran `openapi.json` y el documento 06 (`gen:openapi`, `gen:doc`), y `registry.test.ts` pasa a 97. Respuesta 204 sin cuerpo (como `deleteAvoidZone`).

**`db/migrations/0013_route_delete.sql`** (aditiva; la 0007 no se edita). Sustituye `route_versions_guard()` (ahora `SECURITY DEFINER SET search_path = public`, como los demás disparadores que consultan otras tablas): el `DELETE` de una versión **validada** se permite solo si su ruta está `archived` y no hay filas en `mission_routes` para esa ruta; en cualquier otro caso sigue lanzando INV-04. La rama del borrador y la de `UPDATE` no cambian. Los tramos caen en cascada (ya hay `ON DELETE CASCADE` en `route_segments`) y `route_segments_immutable` solo cubre `UPDATE`. Las políticas `routes_/versions_/segments_coordinator_delete` ya existen desde 0011; no se tocan. `mission_routes.route_id` (sin cascada) sigue siendo la segunda defensa de INV-07 incluso con misiones cerradas.

**`apps/api`** (`src/routes/`, módulo existente `route-writes.service.ts` y `routes.controller.ts`). En una transacción: bloquear la fila de la ruta (`FOR UPDATE`, como las demás escrituras) → si no está archivada, `INVALID_STATE_TRANSITION` → si hay `mission_routes`, `ROUTE_IN_USE` con las misiones → deshacer el vínculo «deriva de» de las rutas derivadas (`derived_from_route_id` y `derived_from_version_id` a `NULL` en las dos columnas a la vez por el `CHECK`) → borrar versiones (tramos en cascada) → borrar la ruta → retirar del almacenamiento el GPX de origen (`source_file_id`) si ninguna otra versión lo usa → `AuditWriter.recordRoute` con `route_deleted` (nombre, nº de versiones, derivadas desvinculadas; sin geometría). El `entity_id` de `audit_log` no tiene clave foránea: la huella sobrevive (la auditoría es de solo añadir). La ruta de otra organización responde 404 (regla 1); el rescatista y el administrador no escriben (regla 2).

**`apps/web`.**
- `src/library/selection-bar.tsx`: recibe si el filtro de estado de la lista es `archived` (el filtro vive en `filters.status`; en la URL es `?status=archived`, y vacío significa activas). **Solo en ese caso** y para quien puede escribir (`canArchive`), aparece el botón «Eliminar seleccionadas» (con `data-testid`/clase `btn-eliminar-ruta` para el E2E; en las demás vistas **no se monta**, no se oculta con CSS, para que tampoco lo alcance el teclado ni el lector de pantalla). En esa vista no se muestra «Archivar» (ya están archivadas). `Dialog` de confirmación: cuántas rutas, que **no se puede deshacer**; foco inicial en «Cancelar». Mismo patrón que archivar: una llamada por ruta con informe de hechas y fallidas (`ROUTE_IN_USE`: en qué misiones, aunque estén cerradas). Al terminar, se limpia de la selección lo eliminado y se invalida `['routes']`. La selección se conserva entre páginas, como hoy, y se vacía al cambiar el filtro de estado para que nunca se elimine algo que no se ve.
- Detalle `/routes/:id` y lista de activas: **sin cambios**.
- Sin geometría ni lógica de rutas en componentes (regla 9).

**`packages/i18n`.** Textos es/fr de los dos diálogos, el informe y los errores (paridad comprobada por la prueba existente).

**No cambian:** `packages/geo`, `infra/`, `data/seed`, `compose*.yml`, CSP.

## 3. Puertos implicados

`FileStorage` (retirar el GPX de origen de las versiones importadas). Ninguno nuevo.

## 4. Decisiones con alternativa descartada

| # | Decisión (propuesta, **pendiente del usuario** salvo D-I1) | Alternativa descartada |
|---|---|---|
| D-I1 | Solo se elimina una ruta **archivada** y **sin misión** (decisión del usuario) | Eliminar también rutas activas: contradice «archivar primero» y la protección de INV-07 |
| D-I2 | **Una operación `deleteRoute`** (una ruta) y el lote lo hace el cliente con informe, como el archivado actual | `deleteRoutes` atómica en el servidor: dos formas de error por ruta en un solo cuerpo (nuevo esquema de `details`) y una segunda operación para el detalle. La atomicidad aquí aporta poco: cada ruta se eliminó con el mismo permiso y la misma confirmación |
| D-I3 | Excepción de INV-04 **dentro del disparador** (ruta archivada y sin misión) | Función `SECURITY DEFINER` + variable de sesión: la variable la puede fijar cualquier sesión de `onway_app`, así que no añade defensa. Habilitar `ON DELETE CASCADE` en las claves foráneas: quitaría la segunda defensa de INV-07 |
| D-I4 | Las rutas **derivadas sobreviven** y pierden solo el vínculo «deriva de» (queda en la auditoría de la eliminada) | Prohibir eliminar una ruta con derivadas: obliga a un orden de borrado y atasca las bibliotecas con cadenas de derivación. Borrar las derivadas en cascada: destruye trabajo que nadie pidió |
| D-I5 | El GPX original de una versión importada se **retira** con la ruta (marca de borrado y retirada del almacenamiento) si ninguna otra versión lo usa | Dejarlo huérfano: guarda datos sin dueño (regla 3, mínimos) |
| D-I6 | Una ruta que figura en **cualquier** misión, aunque esté cerrada, **no se puede eliminar** (quitarla de una misión cerrada está prohibido por la regla 5). **Consecuencia que conviene ver:** archivar sí se permite con misiones cerradas (INV-07), así que una ruta archivada que quedó en una misión cerrada seguirá sin poder eliminarse. Las demostraciones E2E dejan misiones cerradas con rutas archivadas, por ejemplo | Permitirlo en misiones cerradas: rompería el historial de lo que se ofreció a los rescatistas y obligaría a reescribir `mission_routes` de una misión de solo lectura. **Pendiente de tu decisión (pregunta 3)** |
| D-I7 | **Protocolo de borrado de tres pasos y botón solo en la lista archivada** (revisión 2): quitar de las misiones abiertas → archivar → eliminar. El servidor sigue exigiendo «archivada y sin misión» aunque el botón no exista en otras vistas (regla 2: los permisos los decide el servidor) | Botón también en el detalle (punto 2 de la issue): más superficie para borrar por error y ruta activa borrable de un clic. Botón oculto con CSS: seguiría en el árbol de accesibilidad |

## 5. Riesgos

- **Irreversible.** No hay papelera. Mitigación: solo archivadas, confirmación con el número exacto, foco en «Cancelar», auditoría `route_deleted`.
- **Pierde la historia de derivación** de las rutas derivadas (D-I4). Mitigación: el evento de auditoría lista cuáles se desvincularon.
- **INV-04 deja de ser absoluto.** Es lo más delicado del cambio: prueba SQL directa de que, fuera de «archivada y sin misión», la versión validada sigue sin poder borrarse, ni siquiera con el rol de coordinador.
- **Carrera** entre eliminar y añadir la ruta a una misión: el `FOR UPDATE` de la ruta y el `mission_routes.route_id` (sin cascada) la cierran; se prueba.
- **E2E que deja residuos.** Aquí no: la demostración crea sus propias rutas, las archiva y las elimina de verdad (la biblioteca queda como estaba).
- **Revisar** que `h2-demo`, `h3` y `h4` no dependan de eliminar nada (no lo hacen: solo archivan).

## 6. Verificación

- **Contratos:** `pnpm --filter @onway/contracts test` (97 operaciones, hito en cada una), `gen:openapi`, `gen:doc` sin diferencias salvo las esperadas.
- **INV-04** (`test:db`, base real): borrar una versión validada de una ruta activa → falla; de una archivada con misión (abierta o cerrada) → falla; de una archivada sin misión → pasa y se llevan los tramos; `UPDATE` de una validada sigue fallando siempre; el borrador sigue pudiendo borrarse.
- **INV-07** (`test:db`): `DELETE` de una ruta con `mission_routes` (misión cerrada incluida) → falla; archivar una ruta en misión no cerrada sigue fallando.
- **API** (`test:api`, `routes-delete.test.ts`): coordinador elimina una archivada; ruta activa → 409 `INVALID_STATE_TRANSITION`; en misión (abierta y cerrada) → 409 `ROUTE_IN_USE` con las misiones; derivadas desvinculadas y vivas; GPX de origen retirado; `route_deleted` en `audit_log`; después `getRoute` → 404; rescatista y administrador no pueden (403 y, en base, 0 filas afectadas); ruta de otra organización → 404; dos eliminaciones a la vez → una 204 y otra 404; AC-02 con 59 montadas.
- **Web** (`pnpm --filter @onway/web test`): el botón `btn-eliminar-ruta` **no existe** en la lista de activas ni en el detalle y **sí** con `?status=archived`; diálogo (conteo, mensaje irreversible, foco en «Cancelar», cancelar no llama a la API), informe de fallos, la selección se vacía al cambiar de filtro; es y fr.
- **Demostración E2E** (`route-delete-demo.spec.ts`, escritorio y móvil 375 px, francés solo con teclado): crear/importar dos rutas; comprobar que en la lista de activas y en el detalle no hay botón de eliminar; archivarlas; en `/routes?status=archived` seleccionarlas, cancelar una vez, confirmar y comprobar que desaparecen de la lista y de `getRoute` (404); una ruta archivada que está en una misión cerrada no se elimina y el informe lo explica. Pila: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y `E2E_BASE_URL=http://localhost:18080 pnpm --filter @onway/web e2e`.
- Siempre: `pnpm lint`, `format:check`, `typecheck`, `test`, `build`, `test:db`, `test:api`; los 12 criterios del doc 07 §4.

## 7. Documentos que habrá que actualizar

`docs/constitution.md` (punto 10), `CLAUDE.md` (regla 4 y recuentos de pruebas/operaciones), `docs/01` (RN-14, RF-512), `docs/02` (§3.6, §8), `docs/03` (§5, §6, INV-04, INV-07), `docs/05` (INV-04, INV-07, migración 0013, recuento de comprobaciones SQL), `docs/06` (operación, recuento, nota de `archiveRoute`, OpenAPI), `docs/07` (sección nueva y registro), `docs/estado.md` (pendiente (g) y esta decisión). Cada uno con su entrada de registro de cambios.

## 8. Preguntas abiertas para el usuario

1. **¿Apruebas editar el punto 10 de la constitución y la regla 4 de `CLAUDE.md`?** Sin esto no se empieza.
2. **D-I4 (derivadas):** ¿sobreviven y solo pierden el vínculo «deriva de»? (propuesto) o ¿se prohíbe eliminar una ruta con derivadas?
3. **D-I6 (misiones cerradas):** ¿una ruta archivada que está en una misión cerrada se queda sin poder eliminarse? (propuesto, protege el historial) o ¿se permite eliminarla y se borra su fila de `mission_routes`, lo que exige un caso especial en una misión de solo lectura?
4. D-I2 (el cliente repite `deleteRoute` por ruta, con informe) y D-I5 (se retira el GPX de origen): ¿de acuerdo?
