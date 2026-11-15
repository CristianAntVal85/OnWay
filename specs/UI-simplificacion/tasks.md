# UI-simplificacion — Tareas

Plan: `specs/UI-simplificacion/plan.md`. Comprobación rápida de todas: `pnpm check @onway/web @onway/i18n`. Con cambios de maquetación, una mirada a 375 px.

- [x] **T1. Tokens: paleta del boceto y escalas.** D-S2, D-S8, D-S9
- Archivos: `apps/web/src/theme/tokens.css`, `apps/web/test/theme-contrast.test.ts`, `apps/web/src/styles.css` (solo sección «botones y formularios»: alto de control con `--control-h`), `specs/UI-rediseno/plan.md` (nota en D-U3).
- Comprobación: `pnpm check @onway/web`.
- Hecho cuando: los dos temas usan la paleta nueva, la prueba de contraste pasa con todos sus pares, existen `--space-*`, `--radius-*`, `--text-*`, `--control-h` (40 px; 48 px con `pointer: coarse`) e `--icon`, y botones, campos y selectores miden lo mismo de alto.

- [ ] **T2. Componentes comunes: iconos, menú, tarjeta, cabecera de página, segmentado y campo.** D-S4, D-S5, D-S7, D-S10
- Archivos: nuevos `apps/web/src/components/icon.tsx`, `menu.tsx`, `section-card.tsx`, `page-header.tsx`, `segmented.tsx`; `apps/web/src/components/text-field.tsx`; `apps/web/src/styles.css` (sección nueva «componentes comunes»); nuevo `apps/web/test/menu.test.tsx`; `packages/i18n/src/es.ts` y `fr.ts` (`common.more`, `common.export`).
- Comprobación: `pnpm check @onway/web @onway/i18n`.
- Hecho cuando: `menu.test.tsx` cubre abrir con clic, Enter y flecha abajo, moverse con flechas, Inicio y Fin, activar, Escape con vuelta del foco al botón, cierre al pulsar fuera y `menuitemradio` con `aria-checked`; `TextField` no admite ayuda y marca los obligatorios con asterisco y `aria-required`.

- [ ] **T3. Cabecera y navegación.** D-S11
- Archivos: `apps/web/src/components/shell.tsx`, `apps/web/src/nav/navigation.ts`, `apps/web/src/components/theme-switch.tsx`, `apps/web/src/styles.css` (sección «marco con sesión»), `apps/web/test/navigation.test.ts`, `apps/web/test/app.test.tsx`, `apps/web/test/theme.test.tsx`, `packages/i18n/src/es.ts` y `fr.ts`.
- Comprobación: `pnpm check @onway/web @onway/i18n`.
- Hecho cuando: cada entrada lleva icono y la activa un subrayado de acento; hay un botón de tema (alterna oscuro y claro, con `aria-label`) y el acceso a Cuenta como icono; a 375 px el menú desplegable sigue funcionando con teclado y la cabecera no cambia de alto entre páginas.

- [ ] **T4. Mapa: capas en un desplegable con icono y pie compacto.** D-S6
- Archivos: `apps/web/src/map/map-view.tsx` (líneas 198-203), `apps/web/src/map/readout.tsx`, `apps/web/src/styles.css` (sección «mapa (src/map)»), `apps/web/test/map-parts.test.tsx`, `apps/web/test/map-theme.test.tsx`, `apps/web/e2e/support/` (ayuda `chooseMapLayer`), las demostraciones que cambian de capa (`h1-demo.spec.ts`, `ui-rediseno-demo.spec.ts`), `packages/i18n/src/es.ts` y `fr.ts`.
- Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm --filter @onway/web exec playwright test -c e2e h1-demo.spec.ts ui-rediseno-demo.spec.ts` contra la pila `onway-e2e`.
- Hecho cuando: el mapa no tiene franja superior; un botón con icono de capas y `aria-label` abre Satélite / Topográfico / Carreteras como `menuitemradio`; cambiar de capa no vuelve a montar el mapa; la atribución sigue visible.

- [ ] **T5. Inicio como centro de operaciones.**
- Archivos: `apps/web/src/pages/home-page.tsx`, `apps/web/src/environment/weather-card.tsx`, `apps/web/src/environment/environment-section.tsx`, `apps/web/src/styles.css` (secciones «inicio, tiempo…» y «tarjeta del tiempo simple»), `apps/web/test/home.test.tsx`, `apps/web/test/weather-card.test.tsx`, `apps/web/e2e/weather-simple-demo.spec.ts`, `packages/i18n/src/es.ts` y `fr.ts`.
- Comprobación: `pnpm check @onway/web @onway/i18n`.
- Hecho cuando: la vista sigue el boceto (cabecera con una sola «Crear misión», franja de organización, tarjetas de tiempo y de misiones activas, fila de cifras) solo con datos que ya da el API; conserva los estados de carga, vacío y error; a 375 px queda en una columna.

- [ ] **T6. Crear misión: secciones, sin ayudas y barra que no tapa.** D-S3, D-S10
- Archivos: `apps/web/src/pages/create-mission-page.tsx`, `apps/web/src/missions/point-input.tsx`, `apps/web/src/missions/point-form.tsx`, `apps/web/src/missions/point-row.tsx`, `apps/web/src/styles.css` (secciones «utilidades de formulario» y «páginas con mapa»), `apps/web/test/create-mission.test.tsx`, `apps/web/test/create-mission-map-height.test.ts`, `apps/web/e2e/h1-demo.spec.ts`, `packages/i18n/src/es.ts` y `fr.ts`.
- Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm --filter @onway/web exec playwright test -c e2e h1-demo.spec.ts`.
- Hecho cuando: el formulario tiene las cuatro secciones del plan §5 con cabecera de icono; no queda ningún `.field-help` ni párrafo de introducción; las reglas de validación son las mismas y sus mensajes salen como error; la barra de acciones no cubre ningún campo a 1440 × 900 ni a 375 px.

- [ ] **T7. Detalle de ruta y editor: una fila de acciones.** D-S1, D-S4, RF-517
- Archivos: `apps/web/src/pages/route-detail-page.tsx` (líneas 156-193 y sección de versiones), `apps/web/src/library/route-dialogs.tsx`, `apps/web/src/library/compare-panel.tsx`, `apps/web/src/pages/route-editor-page.tsx`, `apps/web/src/styles.css` (secciones «detalle de ruta» y «editar y dibujar rutas»), `apps/web/test/route-detail.test.tsx`, `apps/web/test/route-editor.test.tsx`, `apps/web/e2e/h2-demo.spec.ts`, `packages/i18n/src/es.ts` y `fr.ts` (`routeDetail.actions.*`, `routeDetail.archivedNotice`, `routeDetail.derive.*`).
- Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm --filter @onway/web exec playwright test -c e2e h2-demo.spec.ts`.
- Hecho cuando: el detalle muestra «Validar» (solo en borrador), «Editar ruta», «Exportar ▾» y «Más ⋯» (Duplicar ruta, Archivar ruta) en una fila; una ruta archivada solo ofrece Exportar y Duplicar; el editor guarda con un botón principal y su desplegable; no queda el rótulo «Crear una versión nueva a partir de esta» ni «Derivar».

- [ ] **T8. Rutas, Generar e Importar.** D-S3, D-S4
- Archivos: `apps/web/src/pages/routes-page.tsx`, `apps/web/src/library/route-card.tsx`, `apps/web/src/library/filters.tsx`, `apps/web/src/library/selection-bar.tsx`, `apps/web/src/pages/generate-routes-page.tsx`, `apps/web/src/pages/import-route-page.tsx`, `apps/web/src/styles.css` (sección «biblioteca de rutas» y la parte de generar de «editar y dibujar rutas»), `apps/web/test/routes-library.test.tsx`, `apps/web/test/generate-routes.test.tsx`, `apps/web/test/route-import.test.tsx`, `apps/web/test/route-import-mission.test.tsx`, `apps/web/e2e/h2-demo.spec.ts`, `h3-demo.spec.ts`, `h3-engine-down.spec.ts`, `route-delete-demo.spec.ts`, `packages/i18n/src/es.ts` y `fr.ts`.
- Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm --filter @onway/web exec playwright test -c e2e h2-demo.spec.ts h3-demo.spec.ts h3-engine-down.spec.ts route-delete-demo.spec.ts`.
- Hecho cuando: Rutas tiene una sola acción de cabecera («Nueva ruta ▾»), búsqueda con Enter, tarjetas de una línea de cifras y barra de selección solo con algo marcado; Generar sigue el orden del plan §5 con un único estilo de etiqueta y el botón al final; en las tres vistas no queda ningún texto de ayuda salvo los avisos operativos.

- [ ] **T9. Misiones y detalle de misión (coordinador y rescatista).** D-S4
- Archivos: `apps/web/src/pages/mission-detail-page.tsx`, `apps/web/src/missions/lifecycle-actions.tsx`, `apps/web/src/missions/mission-routes-section.tsx`, `apps/web/src/missions/add-route-dialog.tsx`, `apps/web/src/missions/point-row.tsx`, `apps/web/src/missions/mission-edit-form.tsx`, `apps/web/src/pages/missions-page.tsx`, `apps/web/src/missions/list-controls.tsx`, `apps/web/src/pages/my-missions-page.tsx`, `apps/web/src/pages/my-mission-detail-page.tsx`, `apps/web/src/missions/my-routes-section.tsx`, `apps/web/src/styles.css` (secciones «misiones: lista y detalle», «ciclo de vida…», «rutas de la misión…», «añadir ruta…» y «…vista del rescatista»), `apps/web/test/missions.test.tsx`, `apps/web/test/mission-routes.test.tsx`, `apps/web/test/add-route-dialog.test.tsx`, `apps/web/test/my-mission-routes.test.tsx`, `apps/web/e2e/h1-demo.spec.ts`, `h4-demo.spec.ts`, `mobile.spec.ts`, `roles.spec.ts`, `packages/i18n/src/es.ts` y `fr.ts`.
- Comprobación: `pnpm check @onway/web @onway/i18n` y `pnpm --filter @onway/web exec playwright test -c e2e h1-demo.spec.ts h4-demo.spec.ts mobile.spec.ts roles.spec.ts`.
- Hecho cuando: el detalle sigue el plan §5 (una acción principal del ciclo, «⋯» por fila de ruta y de punto, «Añadir punto ▾», exportar y generar dentro del «⋯» de la sección); la tabla de rutas no se corta a 1440 px ni desborda a 375 px; el aviso de borrador es una insignia; el rescatista sigue sin ver ninguna acción de escritura.

- [ ] **T10. Resto de vistas, limpieza, demostración y documentos.** D-S3
- Archivos: `apps/web/src/admin/signup-inbox.tsx`, `invite-code-section.tsx`, `decide-dialog.tsx`, `apps/web/src/pages/account-page.tsx`, `weather-page.tsx`, páginas de acceso (`login-page.tsx`, `register-page.tsx`, `forgot-password-page.tsx`, `reset-password-page.tsx`), `apps/web/src/environment/light-card.tsx`, `apps/web/src/missions/share-location.tsx`, `mission-history.tsx`, `apps/web/src/styles.css` (borrado de clases sin uso), nuevo `apps/web/e2e/ui-simplificacion-demo.spec.ts`, `apps/web/e2e/README.md`, `packages/i18n/src/es.ts` y `fr.ts` (claves sin uso), `docs/02-flujo-coordinador-y-vistas.md`, `docs/04-arquitectura-y-stack.md`, `docs/07-plan-de-implementacion.md`, `docs/estado.md`, `docs/historial.md`.
- Comprobación: `pnpm check @onway/web @onway/i18n`; `grep -rn "field-help" apps/web/src` sin resultados; `CI=1 E2E_BASE_URL=http://localhost:18080 COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e pnpm --filter @onway/web e2e`.
- Hecho cuando: todas las vistas usan los componentes comunes; no quedan claves de i18n ni clases CSS huérfanas de lo retirado; la demostración del plan §7 pasa en escritorio y a 375 px; el E2E completo pasa; los documentos del plan §8 están al día.
