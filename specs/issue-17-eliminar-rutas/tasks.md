# issue-17-eliminar-rutas · Tareas

Plan aprobado por el usuario (revisión 2; decisiones D-I1 a D-I7 y preguntas 1 a 4 aceptadas tal como se proponían). Rama `hito/issue-17-eliminar-rutas`. Seis tareas en orden de dependencia. Pruebas primero, contra base real. Una tarea por vez, con commit y push al cerrarla (archivos por nombre, nunca `git add -A`), `docs/estado.md` al día y todo en verde.

Operación del cambio (1): `deleteRoute` (`x-milestone: H2`).

- [x] **T1. Documentos y contrato.** RN-14, RF-512, INV-04, INV-07; regla 7; operación `deleteRoute`.
  - Se editan primero `docs/constitution.md` (punto 10), `CLAUDE.md` (regla 4), `docs/01`, `02`, `03`, `05` (solo texto de INV-04/INV-07 y la migración prevista) y `06`, cada uno con su registro de cambios. Después `packages/contracts`: `deleteRoute` (`DELETE /routes/{routeId}`, 204, `MISSION_WRITERS`, auditada, errores `ROUTE_IN_USE` e `INVALID_STATE_TRANSITION`), `milestones.ts`, nota de `archiveRoute`; se regeneran OpenAPI y documento 06.
  - *Hecho así:* el docs 04 no cambia. En `apps/api/test/api/app.test.ts` AC-02 lleva `NOT_BUILT_YET = ['deleteRoute']` (la operación es de H2, ya pasado, pero se monta en T3); T3 vacía la lista. La prueba `schema-guards` «sin DELETE de rutas» pasa a «el único es `deleteRoute`». La constitución no tiene registro de cambios: la decisión se anota en `docs/estado.md`.
  - Hecho cuando: `pnpm --filter @onway/contracts test` en verde con 97 operaciones; `gen:openapi` y `gen:doc` sin diferencias salvo las esperadas; `pnpm format:check` limpio.
  - Cierre: commit `docs(issue-17): T1 allow deleting archived routes and add the deleteRoute contract` + push.

- [x] **T2. Migración 0013 e INV-04 / INV-07 en la base.** INV-04, INV-07.
  - Pruebas primero (`test:db`): borrar una versión validada de una ruta activa falla; de una archivada con misión (abierta o cerrada) falla; de una archivada sin misión pasa y se llevan los tramos; `UPDATE` de una validada sigue fallando; el borrador sigue pudiendo borrarse; `DELETE` de una ruta con `mission_routes` falla. Después `0013_route_delete.sql` con `route_versions_guard()` nueva (`SECURITY DEFINER SET search_path = public`).
  - *Hecho así:* 14 pruebas nuevas en `apps/api/test/db/route-delete-guard.test.ts` (con `onway_app` de verdad: activa, archivada en misión abierta o cerrada, UPDATE, borrado completo con derivadas, borrador, administrador, rescatista y otra organización); `test:db` pasa de 34 a 48 pruebas y las 194 comprobaciones SQL no cambian. Una misión cerrada solo se prepara cerrándola después de fijar la ruta (INV-11). El diario de Drizzle y los rangos «0002-0013» (migrate.ts, compose, doc 05 §9) quedan al día; el recuento de migraciones de `schema.test.ts` pasa de 11 a 12.
  - Hecho cuando: `pnpm --filter @onway/api test:db` y `db/tests/run-postgis.sh` en verde con las comprobaciones nuevas; las existentes de INV-04 siguen pasando.
  - Cierre: commit `feat(issue-17): T2 let the database delete validated versions of an archived unused route` + push.

- [x] **T3. API de `deleteRoute`.** INV-01, INV-04, INV-07, reglas 1 y 2.
  - Pruebas primero (`test:api`, `routes-delete.test.ts`): coordinador elimina una archivada (204) y `getRoute` da 404; activa → 409 `INVALID_STATE_TRANSITION`; en misión abierta o cerrada → 409 `ROUTE_IN_USE` con las misiones; derivadas vivas y desvinculadas; GPX de origen retirado si nadie más lo usa; `route_deleted` en `audit_log`; rescatista y administrador no pueden; otra organización → 404; dos eliminaciones a la vez → 204 y 404; AC-02 con 59 montadas.
  - *Hecho así:* `RouteWrites.remove` (módulo `src/routes/`) y `deleteRoute` en el controlador; `route_deleted` en `RouteAuditAction`. 13 pruebas nuevas en `routes-delete.test.ts` y AC-02 con 59 montadas (`NOT_BUILT_YET` retirada; `BUILT` gana `deleteRoute`). La prueba de `archiveRoute` ya no comprueba el 404 de `DELETE`. Orden en la transacción: ruta bloqueada → `INVALID_STATE_TRANSITION` si no está archivada → `ROUTE_IN_USE` si está en cualquier misión → derivadas sin vínculo → versiones → ruta → GPX de origen marcado (`files.deleted_at`) si ninguna otra versión lo usa → auditoría `route_deleted` (`name`, `versions`, `derivativesUnlinked`) → bytes del almacén, al final y con el fallo solo registrado. `test:api` pasa de 486 a 499.
  - Hecho cuando: `pnpm --filter @onway/api test`, `test:api` y `typecheck` en verde.
  - Cierre: commit `feat(issue-17): T3 add the deleteRoute operation` + push.

- [x] **T4. Botón «Eliminar seleccionadas» en la lista archivada.** RF-512; D-I7.
  - Pruebas primero (`@onway/web`): `btn-eliminar-ruta` no existe en la lista de activas ni en el detalle; existe con `?status=archived`; diálogo con el número de rutas y el aviso de irreversibilidad, foco en «Cancelar»; cancelar no llama a la API; informe de hechas y fallidas; la selección se vacía al cambiar de filtro. Textos es/fr en `packages/i18n`.
  - *Hecho así:* `SelectionBar` gana `canDelete` (solo con `?status=archived` y para quien escribe) y `onDeleted`; el botón lleva la clase `btn-eliminar-ruta` y fuera de esa vista **no se monta** (no se oculta con CSS). El diálogo pone el foco en «Cancelar» y trae una nota con lo que sí se elimina. `routes-page.tsx` vacía la selección al cambiar `filters.status`. Textos nuevos `routes.selection.delete|hintDelete` y `routes.delete.*` en es y fr. 9 pruebas web nuevas (web 797). El repaso a 375 px y con teclado va en el E2E de T5.
  - Hecho cuando: `pnpm --filter @onway/web test`, `@onway/i18n test`, `lint` y `typecheck` en verde; revisado a 375 px y con teclado.
  - Cierre: commit `feat(issue-17): T4 add bulk delete to the archived routes list` + push.

- [ ] **T5. Demostración E2E.** Protocolo quitar → archivar → eliminar.
  - `route-delete-demo.spec.ts`, escritorio y móvil, francés solo con teclado: sin botón en activas ni en el detalle; archivar dos rutas propias; en `/routes?status=archived` cancelar una vez y confirmar después; desaparecen de la lista y dan 404; una archivada en una misión cerrada no se elimina y el informe lo explica. La prueba no deja residuos.
  - Hecho cuando: `pnpm --filter @onway/web e2e` entero en verde contra la pila de pruebas (`onway-e2e`, puerto 18080).
  - Cierre: commit `test(issue-17): T5 add the route deletion demonstration` + push.

- [ ] **T6. Cierre.** Criterios del doc 07 §4.
  - Sección del cambio en `docs/07` («Tal como se construyó»), `docs/estado.md`, recuentos de `CLAUDE.md`, pendiente (g) y esta decisión; los 12 criterios.
  - Hecho cuando: `pnpm lint`, `format:check`, `typecheck`, `test`, `build`, `test:db`, `test:api` y E2E en verde; CI de la rama en verde.
  - Cierre: commit `docs(issue-17): T6 record the build and close the change` + push.
