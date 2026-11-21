# issue-rutas-nombre-y-desvincular · Tareas

Plan aprobado por el usuario el 2026-11-21 (`plan.md`, D-N1 a D-N8 tal como se proponían). Rama `hito/issue-rutas-nombre`, desde `hito/UI-simplificacion`. Ocho tareas en orden de dependencia. Pruebas primero; un commit por tarea, con la comprobación rápida en verde (skill `sdd` §4: archivos por nombre, nunca `git add -A`).

Operación nueva (1): `updateRoute` (`x-milestone: H2`). Operaciones que cambian: `generateRoutes` (`namePrefix` obligatorio) y `getRoute` (`usedIn[].missionRouteId`).

- [x] **T1. Documentos.** RF-501, RF-512, RF-513, INV-16; D-N1 a D-N7.
  - Archivos: `docs/01-vision-y-requisitos.md` (RF-501, RF-512, §12), `docs/02-flujo-coordinador-y-vistas.md` (§3.5 tabla de la misión, §3.6 A paso 3 y detalle de ruta, §12), `docs/03-modelo-de-dominio.md` (§8.3 punto 9, §16, §19), `docs/07-plan-de-implementacion.md` (subsección nueva tras «UI-simplificacion», con Demostración, Alcance, Operaciones (1), Salida, Fuera; y §8).
  - Comprobación: `pnpm format:check`.
  - Hecho cuando: los cuatro documentos dicen lo del plan §8, cada uno con su entrada de registro de cambios; `format:check` limpio.
  - Commit: `docs(issue-route-names): T1 require route names, allow renaming and unlinking from the route`.

- [x] **T2. Nombre obligatorio al generar, de punta a punta.** RF-501; D-N1, D-N2; `generateRoutes`.
  - Pruebas primero:
    - contratos: `GenerateRoutesRequest` sin `namePrefix` se rechaza;
    - API (`apps/api/test/api/generate-routes.test.ts`): sin nombre → 400 `VALIDATION_FAILED` y ningún trabajo; con «Collado Norte» y 2 alternativas → «Collado Norte 1» y «Collado Norte 2»; un trabajo guardado sin `namePrefix` (anterior al cambio) usa «Ruta» y no falla;
    - web (`apps/web/test/generate-routes.test.tsx`): propuesta con el nombre del origen; sigue al selector hasta que se escribe; vacío → error en línea y no llama a la API; línea de ejemplo.
  - Archivos: `packages/contracts/src/routes.ts`, `packages/contracts/src/endpoints.ts` (nota de `generateRoutes`), `packages/contracts/test/behavior.test.ts`, `openapi.json` y doc 06 regenerados, `apps/api/src/routes/route-generation.service.ts` (fuera `DEFAULT_NAME_PREFIX`; respaldo «Ruta» solo para trabajos antiguos, con aviso en el registro), `apps/api/test/api/generate-routes.test.ts`, `apps/web/src/pages/generate-routes-page.tsx`, `apps/web/test/generate-routes.test.tsx`, `packages/i18n/src/{es,fr,types}.ts` (`generate.nameLabel`, `nameRequired`, `nameHint`).
  - Comprobación: `pnpm --filter @onway/contracts gen:openapi && pnpm --filter @onway/contracts gen:doc` y luego `pnpm check @onway/contracts @onway/api @onway/web @onway/i18n` y `pnpm --filter @onway/api test:api generate-routes`.
  - Hecho cuando: todo lo anterior en verde y el formulario no se puede enviar sin nombre.
  - Commit: `feat(issue-route-names): T2 make the name of generated routes required and propose the origin name`.
  - *Hecho así:* **sin la línea de ejemplo** bajo el campo: la D-S3 de `UI-simplificacion` quita los textos de ayuda; la regla sale como error («Escribe un nombre para las rutas.»). El campo es `TextField` con asterisco y `aria-required`. El worker lee los parámetros con `namePrefix` opcional (`StoredParams`) y usa «Ruta» con un aviso en el registro para los trabajos anteriores al cambio. El doc 06 se actualiza a mano con la fila de `gen/endpoints.md` (el OpenAPI no está versionado).

- [x] **T3. Contrato de `updateRoute` y `usedIn.missionRouteId`.** Regla 7; D-N3, D-N6.
  - Pruebas primero: `registry.test.ts` con 98 operaciones; `UpdateRouteRequest` rechaza vacío, solo espacios, 161 caracteres y campos de más; `RouteDetail.usedIn[]` exige `missionRouteId`; `routes-reads.test.ts` comprueba que `getRoute` lo devuelve y que es el id de `mission_routes`.
  - Archivos: `packages/contracts/src/routes.ts`, `packages/contracts/src/endpoints.ts` (`updateRoute`: `PATCH /routes/{routeId}`, `MISSION_WRITERS`, `200 RouteDetail`, errores `INVALID_STATE_TRANSITION`, `audited: true`, nota), `packages/contracts/src/milestones.ts` (`updateRoute: 'H2'`), `packages/contracts/test/registry.test.ts`, `packages/contracts/test/behavior.test.ts`, `openapi.json` y doc 06 regenerados, `apps/api/src/routes/route-reads.ts` (`mission_routes.id` en `usedIn`), `apps/api/test/api/routes-reads.test.ts`, `apps/api/test/api/app.test.ts` (AC-02 con `NOT_BUILT_YET = ['updateRoute']` hasta T4).
  - Comprobación: `pnpm --filter @onway/contracts gen:openapi && pnpm --filter @onway/contracts gen:doc` y luego `pnpm check @onway/contracts @onway/api` y `pnpm --filter @onway/api test:api routes-reads app`.
  - Hecho cuando: contratos con 98 operaciones; doc 06 regenerado con `updateRoute`; `test:api` de lecturas y AC-02 en verde.
  - Commit: `feat(issue-route-names): T3 add the updateRoute contract and the mission route id to usedIn`.

- [x] **T4. API de `updateRoute`.** INV-01, INV-04, INV-16, regla 2; D-N4, D-N5.
  - Pruebas primero (`apps/api/test/api/routes-writes.test.ts`, `describe('updateRoute')`):
    - renombra, devuelve el detalle y las versiones no cambian (geometría, métricas y estado idénticos: INV-04);
    - una fila `route_renamed` con `from` y `to` (INV-16), y ninguna con el mismo nombre;
    - con espacios alrededor, guarda el nombre recortado;
    - archivada → 409 `INVALID_STATE_TRANSITION`;
    - una ruta en una misión cerrada sí se renombra;
    - administrador y rescatista → 403 y nada cambia en la base;
    - otra organización → 404 (INV-01);
    - renombrar y archivar a la vez → los dos terminan en orden y sin error 500.
  - Archivos: `apps/api/src/routes/route-writes.service.ts` (`rename`, mismo patrón que `archive`: transacción, `FOR UPDATE`, estado, `UPDATE`, auditoría, detalle), `apps/api/src/routes/routes.controller.ts` (`@Operation('updateRoute')`), `apps/api/src/audit/audit.writer.ts` (`'route_renamed'`), `apps/api/test/api/routes-writes.test.ts`, `apps/api/test/api/app.test.ts` (fuera `NOT_BUILT_YET`, `updateRoute` en `BUILT`, 60 montadas).
  - Comprobación: `pnpm check @onway/api` y `pnpm --filter @onway/api test:api routes-writes app`.
  - Hecho cuando: las pruebas nuevas en verde contra PostGIS real, con AC-02 con 60 montadas.
  - Commit: `feat(issue-route-names): T4 add the updateRoute operation`.

- [x] **T5. Cambiar nombre en la web.** RF-512; D-N4.
  - Pruebas primero:
    - `apps/web/test/route-detail.test.tsx`: «Cambiar nombre» en «Más ⋯» solo para quien escribe y con la ruta no archivada; el diálogo pone el foco en el campo, no guarda vacío, guarda con `updateRoute` y muestra el nombre nuevo; error del servidor visible;
    - `apps/web/test/mission-routes.test.tsx`: «Cambiar nombre» en el «⋯» de la fila; no aparece con la misión cerrada ni para el administrador.
    - En es y fr.
  - Archivos: `apps/web/src/library/route-dialogs.tsx` (`RenameDialog`), `apps/web/src/pages/route-detail-page.tsx` (`moreItems`), `apps/web/src/missions/mission-routes-section.tsx` (opción del menú de la fila), `apps/web/test/route-detail.test.tsx`, `apps/web/test/mission-routes.test.tsx`, `packages/i18n/src/{es,fr,types}.ts` (`routeDetail.actions.rename`, `routeDetail.rename.*`, `missionRoutes.rename.action`).
  - Comprobación: `pnpm check @onway/web @onway/i18n`; y a 375 px y con teclado en `pnpm --filter @onway/web dev`.
  - Hecho cuando: pruebas en verde y el diálogo se maneja con teclado a 375 px.
  - Commit: `feat(issue-route-names): T5 rename a route from its detail and from the mission row`.

- [ ] **T6. Quitar de la misión, visible.** RF-512, RF-513, INV-07, INV-11; D-N6, D-N7.
  - Pruebas primero:
    - `apps/web/test/route-detail.test.tsx`: «Usada en» enseña «Quitar de la misión» solo en misiones en planificación o activas y para quien escribe; confirmación en la fila, con foco en «No quitar»; confirmar llama a `removeMissionRoute` con `missionRouteId`; las cerradas dicen «cerrada · solo lectura» sin botón; `ArchiveDialog` con `ROUTE_IN_USE` dice las misiones y cómo quitarla;
    - `apps/web/test/mission-routes.test.tsx`: el texto de la opción es «Quitar de la misión»;
    - `apps/api/test/api/mission-routes-writes.test.ts`: comprobar que hay una prueba de `removeMissionRoute` con la misión cerrada → 409 `MISSION_CLOSED` y la fila sigue; si no existe, añadirla (INV-11).
  - Archivos: `apps/web/src/pages/route-detail-page.tsx` (sección «Usada en»), `apps/web/src/library/route-dialogs.tsx` (`ArchiveDialog`), `apps/web/src/missions/mission-routes-section.tsx`, `apps/web/test/route-detail.test.tsx`, `apps/web/test/mission-routes.test.tsx`, `apps/api/test/api/mission-routes-writes.test.ts` (solo si falta la prueba), `packages/i18n/src/{es,fr,types}.ts` (`missionRoutes.remove.action|confirm`, `routeDetail.relations.remove*`, `closedReadOnly`, `routeDetail.archive.inUse`), `apps/web/src/styles.css` (solo si la fila de «Usada en» necesita una regla).
  - Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm --filter @onway/api test:api mission-routes-writes`; a 375 px y con teclado.
  - Hecho cuando: pruebas en verde; desde el detalle de una ruta se puede soltar de una misión activa y después archivarla.
  - Commit: `feat(issue-route-names): T6 unlink a route from its missions from the route detail and name the action clearly`.

- [ ] **T7. Demostración E2E y demostraciones afectadas.** Demostración del plan §7.
  - `rutas-nombre-demo.spec.ts` (escritorio y móvil; francés solo con teclado):
    1. generar desde una misión con el nombre propuesto del origen; vacío no deja generar;
    2. salen «<origen> 1» y «<origen> 2»;
    3. renombrar una desde la fila y otra desde el detalle;
    4. «Usada en» → «Quitar de la misión» → archivar → eliminar en `/routes?status=archived`;
    5. misión cerrada sin «Quitar de la misión» en la fila ni en «Usada en».

    Los nombres llevan el sello de la ejecución. Se anota en `apps/web/e2e/README.md` qué deja: la misión cerrada de la prueba y las rutas que no se eliminan.
  - Se ajusta `h3-engine-down.spec.ts` (rellena el nombre antes de generar) y se revisan las demás que generan.
  - Archivos: `apps/web/e2e/rutas-nombre-demo.spec.ts`, `apps/web/e2e/h3-engine-down.spec.ts`, `apps/web/e2e/playwright.config.ts` (proyecto `mobile` incluye la nueva), `apps/web/e2e/README.md`.
  - Comprobación: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables, `E2E_BASE_URL=http://localhost:18080 CI=1 pnpm --filter @onway/web e2e`.
  - Hecho cuando: el E2E entero en verde contra la pila `onway-e2e`.
  - Commit: `test(issue-route-names): T7 add the route name and unlink demonstration`.

- [ ] **T8. Cierre.** Criterios del doc 07 §4.
  - Archivos: `docs/07-plan-de-implementacion.md` (fila «Tal como se construyó»), `docs/estado.md` (≤ 30 líneas), `docs/historial.md`, `CLAUDE.md` (recuentos y la demostración nueva en la lista del E2E), `specs/issue-rutas-nombre-y-desvincular/tasks.md` (marcas y desviaciones).
  - Comprobación: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm test && pnpm --filter @onway/api test:db && pnpm --filter @onway/api test:api && db/tests/run-postgis.sh`, y el E2E de T7.
  - Hecho cuando: todo en verde y los documentos al día; listo para `/sdd-validate`.
  - Commit: `docs(issue-route-names): T8 record the build and close the change`.
