# issue-pintar-ruta · Tareas

Plan aprobado por el usuario el 2026-11-21 (`plan.md`, D-P1 a D-P8). Rama `hito/issue-pintar-ruta`, desde `main`. Nueve tareas en orden de dependencia. Pruebas primero. Un commit por tarea, con la comprobación rápida en verde (skill `sdd` §4: archivos por nombre, nunca `git add -A`).

Operaciones nuevas: ninguna. Operación que cambia: `createRouteVersion` (`continueFrom`).

- [x] **T1. Documentos.** RF-503, RF-505, RF-513, RF-516 y doc 02 §4.3 B; D-P1 a D-P8.
  - Archivos (cada uno con su entrada en el registro de cambios):
    - `docs/01-vision-y-requisitos.md`: RF-503, RF-505, RF-513 y §12;
    - `docs/02-flujo-coordinador-y-vistas.md`: §3.5, §3.6 (editor y detalle de la ruta), §4.3 B y §12;
    - `docs/03-modelo-de-dominio.md`: §16 y su registro, si procede;
    - `docs/07-plan-de-implementacion.md`: subsección nueva tras «Issue · Nombre de las rutas…», con Demostración, Alcance, Operaciones (0 nuevas, 1 cambia), Salida y Fuera, y §8;
    - estos `plan.md` y `tasks.md`.
  - Comprobación: `pnpm format:check`.
  - Hecho cuando: los documentos dicen lo del plan §8, cada uno con su entrada de registro, y `format:check` está limpio.
  - Commit: `docs(issue-draw-route): T1 draw routes by hand from the mission and continue a generated route by hand`.

- [ ] **T2. Corte y proyección en `packages/geo`.** Regla 9; D-P7.
  - Pruebas primero (`packages/geo/test/cut.test.ts`):
    - `projectOnLine` da el vértice más cercano, su distancia acumulada y `offsetM` (sobre la línea es 0; a 100 m de lado son ~100 m);
    - `pointAtDistance` en 0, en la mitad, en el final y más allá (se limita al final);
    - `cutAt` conserva los vértices `0..index`;
    - líneas de 2 vértices y punto fuera de la línea.
  - Archivos: `packages/geo/src/cut.ts` (nuevo), `packages/geo/src/index.ts` y `packages/geo/test/cut.test.ts`.
  - Comprobación: `pnpm check @onway/geo`.
  - Hecho cuando: las pruebas están en verde y la regla de dependencias de `packages/geo` (`test/dependency-rule.test.ts`) sigue en verde.
  - Commit: `feat(issue-draw-route): T2 project a point on a route and cut it in packages/geo`.

- [ ] **T3. Contrato: `createRouteVersion` con `continueFrom`.** Regla 7; D-P4 y D-P8.
  - Pruebas primero (`packages/contracts/test/behavior.test.ts`):
    - con `geometry` sola, válido (como hoy);
    - con `continueFrom` solo, válido;
    - con los dos, o con ninguno, inválido;
    - `points` con 0 puntos o con 201, inválido;
    - `continueFrom` con `calculationJobId`, inválido;
    - un campo de más dentro de `continueFrom`, inválido.
  - Archivos:
    - `packages/contracts/src/routes.ts` (`CreateVersionRequest`);
    - `packages/contracts/src/endpoints.ts` (nota de `createRouteVersion`);
    - `packages/contracts/test/behavior.test.ts`;
    - `docs/06-contratos-de-api.md`: la fila copiada de `gen/endpoints.md` y el registro v1.12.
  - Comprobación: `pnpm --filter @onway/contracts gen:openapi && pnpm --filter @onway/contracts gen:doc gen/` y luego `pnpm check @onway/contracts @onway/api @onway/web`.
  - Hecho cuando: las pruebas del contrato están en verde, el cliente generado compila en la web y la API, y el doc 06 tiene la nota nueva.
  - Commit: `feat(issue-draw-route): T3 accept continueFrom in createRouteVersion`.

- [ ] **T4. API: continuar una versión a mano.** RF-503, RF-505, RF-516; INV-01, INV-04, INV-16; regla 6; D-P5, D-P7, D-P8.
  - Pruebas primero, contra base real (`apps/api/test/api/routes-continue.test.ts`, nuevo, con los ayudantes de `routes-writes.test.ts`). Base: una ruta **generada** con varios tramos (como en `generate-routes.test.ts`, con el motor falso) y una **dibujada** en línea recta.
    - Corte en mitad y 3 puntos: 201, versión N+1 `edited` con `manuallyModified`.
    - La geometría empieza igual que la base hasta el corte y acaba en el último punto.
    - `roadMix` tiene los tipos de la base hasta el corte más `offtrail` igual a la longitud del tramo a mano (±1 m), y `distanceM` es la conservada más la del tramo a mano (±1 m).
    - Desde la dibujada: `unknown` hasta el corte más `offtrail`.
    - INV-04: la versión base queda idéntica (geometría, métricas y tramos).
    - INV-16: una línea `route_version_created` con `continued: true` y `keptDistanceM`.
    - Corte a 300 m de la línea, o en el primer vértice: 400 `VALIDATION_FAILED` y nada creado.
    - Ruta archivada: 409 `INVALID_STATE_TRANSITION`.
    - El administrador y el rescatista reciben 403; el coordinador de otra organización, 404. En ningún caso cambia nada.
    - `baseVersionId` de otra ruta: 404 (como hoy).
  - Archivos: `apps/api/src/routes/route-writes.service.ts` (`createVersion` y un método privado para la línea continuada) y `apps/api/test/api/routes-continue.test.ts`. Si hace falta, `apps/api/src/routes/route-reads.ts` para leer los tramos de la base.
  - Comprobación: `pnpm check @onway/api` y `pnpm --filter @onway/api test:api routes-continue routes-writes`.
  - Hecho cuando: todo lo anterior está en verde.
  - Commit: `feat(issue-draw-route): T4 continue a route version by hand from a cut point`.

- [ ] **T5. Web: interruptor «Pintar ruta» y casilla desmarcada.** RF-505; D-P1 y D-P2.
  - Pruebas primero (`apps/web/test/route-editor.test.tsx`):
    - al dibujar, el interruptor empieza pulsado (`aria-pressed=true`) y un toque en el mapa añade un punto; desactivado, un toque no añade nada;
    - al editar, empieza sin pulsar;
    - arrastrar, deshacer y la lista siguen funcionando con el interruptor desactivado;
    - la casilla de unir por los caminos viene desmarcada y `createRoute` se envía con `snapToPaths: false`;
    - el interruptor se maneja con teclado;
    - es y fr.
  - Archivos: `apps/web/src/pages/route-editor-page.tsx`, `apps/web/test/route-editor.test.tsx`, `packages/i18n/src/{es,fr,types}.ts` (`routeEditor.paint`) y `apps/web/src/styles.css`, si hace falta, con tokens.
  - Comprobación: `pnpm check @onway/web @onway/i18n` y una mirada a 375 px en `pnpm --filter @onway/web dev`.
  - Hecho cuando: las pruebas están en verde y el interruptor se ve junto al mapa a 375 px sin desplazarse.
  - Commit: `feat(issue-draw-route): T5 add the paint toggle to the route editor and draw in straight lines by default`.

- [ ] **T6. Web: pintar una ruta desde la misión.** RF-513, doc 02 §4.3 B; INV-11; D-P3.
  - Pruebas primero:
    - `apps/web/test/mission-routes.test.tsx`: «Más ⋯» de la sección tiene «Pintar ruta» con la misión abierta y con origen; sin origen está desactivado, igual que generar; con la misión cerrada no aparece.
    - `apps/web/test/route-editor.test.tsx`, con `?mission=`:
      - el primer punto es el origen y cambiar de origen lo mueve;
      - el nombre se propone con el del origen y es obligatorio;
      - «Terminar en el objetivo» añade el objetivo;
      - al guardar se envía `addToMission { missionId, originPointId }` y se vuelve a la misión con el aviso;
      - `MISSION_CLOSED` muestra su mensaje;
      - carga y error de la misión.
  - Archivos:
    - `apps/web/src/missions/mission-routes-section.tsx`;
    - `apps/web/src/pages/mission-detail-page.tsx`, si hay que pasar el enlace;
    - `apps/web/src/pages/route-editor-page.tsx`, o un componente nuevo `apps/web/src/library/editor-mission-panel.tsx`;
    - `apps/web/test/mission-routes.test.tsx`, `apps/web/test/route-editor.test.tsx`;
    - `packages/i18n/src/{es,fr,types}.ts`.
  - Comprobación: `pnpm check @onway/web @onway/i18n`.
  - Hecho cuando: las pruebas están en verde.
  - Commit: `feat(issue-draw-route): T6 draw a route from the mission, from the origin to the target`.

- [ ] **T7. Web: «Continuar a mano».** RF-505, RF-503; D-P4, D-P5, D-P6.
  - Pruebas primero (`apps/web/test/route-continue.test.tsx`, nuevo):
    - carga la versión base;
    - un toque cerca de la línea fija el corte y muestra los km conservados;
    - el campo «Conservar los primeros N km» mueve el corte (teclado);
    - con «Pintar ruta» se añaden puntos después del corte;
    - «Terminar en el objetivo» solo con `?mission=`;
    - guardar envía `createRouteVersion` con `continueFrom { cutPoint, points }` y sin `geometry`, y lleva al detalle en la versión nueva;
    - desde la misión, vuelve a ella con el aviso de borrador sin fijar;
    - `VALIDATION_FAILED` (corte lejos) muestra su mensaje;
    - carga y error; ruta archivada sin acción; es y fr.
    - En `route-detail.test.tsx` y `mission-routes.test.tsx`: la acción está en «Más ⋯» y en el «⋯» de la fila, y no aparece para el administrador ni con la ruta archivada.
  - Archivos:
    - `apps/web/src/pages/route-continue-page.tsx`, o el modo `continue` en `route-editor-page.tsx`;
    - `apps/web/src/app/routes.tsx`, `apps/web/src/nav/navigation.ts`;
    - `apps/web/src/pages/route-detail-page.tsx`, `apps/web/src/missions/mission-routes-section.tsx`;
    - `apps/web/src/map/` si hace falta, para la parte descartada atenuada;
    - `apps/web/test/route-continue.test.tsx`, `apps/web/test/route-detail.test.tsx`, `apps/web/test/mission-routes.test.tsx`;
    - `packages/i18n/src/{es,fr,types}.ts`.
  - Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm lint` (frontera del mapa).
  - Hecho cuando: las pruebas están en verde, sin geometría en componentes (la proyección viene de `@onway/geo`) y la vista funciona a 375 px.
  - Commit: `feat(issue-draw-route): T7 continue a generated route by hand from its detail and from the mission`.

- [ ] **T8. Demostración E2E.** Plan §7.
  - Archivos:
    - `apps/web/e2e/pintar-ruta-demo.spec.ts` (nuevo): pintar desde la misión; generar y continuar a mano desde la fila; francés con teclado; 375 px;
    - `apps/web/e2e/playwright.config.ts` (el proyecto móvil la incluye);
    - `apps/web/e2e/README.md` (qué crea y deja);
    - las pruebas E2E existentes que dependían de la casilla marcada por defecto, si las hay (`grep -rn snapLabel apps/web/e2e`).
  - Comprobación: `pnpm --filter @onway/i18n build`, la pila `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables más `E2E_BASE_URL=http://localhost:18080`, `pnpm --filter @onway/web exec playwright test -c e2e pintar-ruta-demo.spec.ts`.
  - Hecho cuando: la demostración está en verde en escritorio y en móvil.
  - Commit: `test(issue-draw-route): T8 add the draw and continue by hand demonstration`.

- [ ] **T9. Verificación completa y cierre.**
  - Archivos: `docs/07-plan-de-implementacion.md` («Tal como se construyó»), `docs/estado.md`, `docs/historial.md` y este `tasks.md`.
  - Comprobación:
    - `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`;
    - `pnpm --filter @onway/api test:db`, `pnpm --filter @onway/api test:api` y `db/tests/run-postgis.sh`;
    - el E2E entero con `CI=1` en `onway-e2e`.
  - Hecho cuando: todo está en verde, con las desviaciones anotadas.
  - Commit: `docs(issue-draw-route): T9 record the build and close the change`.
