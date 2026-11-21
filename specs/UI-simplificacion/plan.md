# UI-simplificacion · Menos botones, formularios ordenados y el aspecto del boceto — Plan

Estado: **aprobado por el usuario el 2026-11-15** (D-S1 a D-S3 como se recomendaban) · Origen: petición del usuario del 2026-11-15 y boceto de `docs/boteto-interface/` · Rama: `hito/UI-simplificacion` (desde `chore/flujo-tres-vias` si aún no está en `main`; trae `pnpm check`).

**Hito fuera de la hoja de ruta, como `UI-rediseno`.** No añade requisitos, operaciones, tablas ni invariantes. Cambia cómo se reparte y se ve la interfaz que ya existe. La petición del usuario es la aprobación que pide la constitución (punto 2).

## 0. Qué se ha visto (auditoría del 2026-11-15, pila `onway`, 1440 px, coordinador)

| Vista | Problema |
|---|---|
| Detalle de ruta | 6 botones del mismo peso en tres filas desiguales («Exportar GPX», «Exportar KML», «Validar esta versión», «Crear una versión nueva a partir de esta», «Derivar», «Archivar ruta»). Selector de capas con tres botones de texto que ocupan una franja entera sobre el mapa |
| Detalle de misión | Cada ruta de la tabla lleva 3 botones y un aviso de tres líneas (con 4 rutas, 12 botones). La tabla se corta en la columna estrecha. En total, más de 25 botones en una pantalla. «Exportar» y «Generar rutas» son secciones enteras con título, párrafo y botones |
| Generar rutas | Columna de controles sin jerarquía: etiquetas sin peso («Punto de inicio») junto a otras en negrita, «Cómo indicar el punto» repetido, el botón principal pegado al secundario, cinco textos de ayuda |
| Crear misión | Párrafo de introducción, ayuda bajo cada campo, la barra inferior fija **tapa** la descripción, `fieldset` con leyenda que no alinea con el resto |
| Rutas | Tres botones en la cabecera, «Buscar» como botón aparte, texto de ayuda sobre la selección, tarjetas de 230 px de alto por ruta |
| Inicio | Mucho vacío, sin jerarquía, «Crear misión» dos veces |
| General | 38 textos `field-help` y otros 12 avisos y notas explicativas. Ningún icono. Botones de 48 px de alto en escritorio que pesan más que el contenido. Sin escala de espaciado: cada sección separa a su manera |

## 1. Decisiones

**Las tres primeras necesitan el sí del usuario** (van con mi recomendación; si no dice otra cosa, se aplican así).

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-S1 | **«Versionar» y «Derivar» se quedan en una sola acción visible: «Editar ruta».** Hoy son dos cosas distintas: *crear una versión* cambia el trazado de **la misma** ruta (conserva el historial; las misiones siguen con la versión que tenían fijada) y *derivar* crea **otra ruta** con otro nombre que recuerda de cuál viene. Pero el editor ya ofrece las dos salidas al guardar («Guardar como versión nueva» / «Guardar como nueva ruta»), así que el botón «Derivar» del detalle duplica una decisión que se toma mejor al final. Queda «Editar ruta» (abre el editor) y, en el menú «Más», **«Duplicar ruta»** (el `deriveRoute` de hoy, sin editar), que es la única salida para una ruta archivada. RF-517 se sigue cumpliendo | Quitar derivar del todo: RF-517 es *Must* y una ruta archivada no se puede editar. Renombrar solo el botón («Versionar ruta») y dejar los dos: sigue habiendo dos botones para elegir antes de saber qué se quiere |
| D-S2 | **Aspecto del boceto:** superficies azul pizarra (`#0D131C`, `#151E2A`, `#1B2635`, borde `#303D4D`), naranja de acción, turquesa informativo, tarjetas con cabecera de icono y título, navegación con icono y subrayado en la sección activa. **Sustituye a D-U3** (rojo de rescate y base GitHub Dark). El AA sigue siendo obligatorio: blanco sobre `#F15A32` da 3,3:1 y no vale para texto, así que el **fondo de los botones** usa el naranja más cercano que llegue a 4,5:1 con blanco (≈ `#CF4520`; lo fija la prueba de contraste) y `#F15A32` queda para iconos, subrayado activo y acentos no textuales. El tema claro se mantiene con la misma estructura | Dejar la paleta actual y cambiar solo la disposición: el usuario pide ir hacia el boceto. Texto oscuro sobre `#F15A32`: cumple AA pero se aleja del boceto |
| D-S3 | **Textos de ayuda fuera.** Se eliminan las ayudas bajo los campos, los párrafos de introducción y las notas explicativas. Se conserva: la **etiqueta** de cada campo (un `placeholder` no la sustituye: desaparece al escribir y los lectores de pantalla no lo leen de forma fiable), el `placeholder` solo donde enseña un formato (coordenadas, dirección), los **errores** junto al campo y los **avisos que evitan un error operativo** (borrador que el rescatista no ve, validación caducada, motor de rutas caído), en una línea o como insignia. La regla que antes explicaba la ayuda («de 3 a 120 caracteres») sale como error cuando se incumple | Pasar las ayudas a un icono «i» con texto emergente: sigue siendo ruido y en móvil no hay *hover* |
| D-S4 | **Presupuesto de botones por vista:** una sola acción principal (naranja); como mucho dos secundarias a la vista; el resto, en un menú. Dos menús con nombre fijo en toda la aplicación: **«Exportar ▾»** (GPX, KML) y **«Más ⋯»** (acciones poco frecuentes o destructivas: duplicar, archivar, quitar, marcar no disponible). En filas de tabla o lista, solo el menú «⋯» | Barra de herramientas con iconos sin texto: más compacta, pero obliga a aprender los iconos y falla el criterio de no depender de un solo indicio |
| D-S5 | **Componente `Menu` propio** (botón con `aria-haspopup="menu"` y `aria-expanded`, lista `role="menu"`, flechas, Inicio/Fin, Escape devuelve el foco, cierre al pulsar fuera). Sin dependencia nueva | Radix o Headless UI: dependencia nueva (constitución 12). `<details>`: no da el patrón de teclado de menú. `<select>` nativo: no sirve para acciones |
| D-S6 | **Capas del mapa: un botón con el icono de capas** dentro del mapa (esquina superior izquierda) que despliega Satélite / Topográfico / Carreteras como `menuitemradio`. Libera la franja sobre el mapa. El formato de coordenadas (Decimal / GMS / UTM) pasa al mismo estilo compacto en el pie | Dejar los tres botones: es el ejemplo que da el usuario |
| D-S7 | **Iconos SVG propios en línea** en `src/components/icon.tsx` (trazo de 1,5 px, 20 px, `currentColor`, `aria-hidden`; como ya hace `weather-icons.tsx`). Unos 25 iconos. Siempre acompañan a un texto, salvo «⋯», capas y tema, que llevan `aria-label` | Lucide u otra librería: dependencia nueva. Fuente de iconos: descarga y `@font-face`, que la prueba de recursos prohíbe |
| D-S8 | **Tamaño de los controles:** 40 px de alto con puntero fino (escritorio) y 48 px con puntero táctil (`@media (pointer: coarse)`), con una sola variable `--control-h`. Se mantiene el uso con guantes en campo (doc 04 §3) sin que los botones dominen la pantalla de escritorio | 48 px siempre: es lo de hoy y es parte del peso visual. 40 px siempre: incumple el doc 04 en móvil |
| D-S9 | **Escala única** en `tokens.css`: espaciado `--space-1…8` (4, 8, 12, 16, 24, 32, 48, 64 px), radios `--radius-sm|md|lg`, tipografía `--text-xs…2xl`, `--control-h`, `--icon`. `styles.css` deja de usar medidas sueltas en lo que se toque. La tipografía sigue siendo la del sistema (D-U9: sin descargas) | Fuente nueva como la del boceto: descarga y licencia; se puede ver después por separado |
| D-S10 | **Formularios:** una columna, etiqueta encima, campos al ancho del contenedor, separación `--space-4` entre campos y `--space-6` entre secciones; cada sección con cabecera de icono y título (sin `fieldset` con borde). Obligatorios con asterisco y `aria-required`. Acciones al final: secundaria a la izquierda, principal a la derecha y más ancha. La barra fija de Crear misión reserva su alto para no tapar contenido | — |
| D-S11 | **El selector de tema pasa a la cabecera** (icono de luna/sol que alterna oscuro y claro) junto al acceso a Cuenta; «Como el sistema» sigue en Cuenta (D-U13 no cambia) | Dejarlo solo en Cuenta: el boceto lo trae en la cabecera y es un cambio de un clic |

## 2. Alcance

- **Requisitos que se cumplen mejor, sin RF nuevos:** doc 01 §7 (uso en campo), doc 02 §1 (principios) y cada vista de su §3, doc 07 §4 criterio 8 (carga, vacío y error; es y fr; móvil y teclado).
- **Vistas:** todas las del coordinador y las compartidas (Inicio, Misiones, detalle de misión, Crear misión, Rutas, detalle, editor, Generar, Importar, Cuenta, Tiempo), las del rescatista (Mis misiones y su detalle), Administración y acceso. Estas dos últimas solo reciben el sistema común y la purga de ayudas, sin rediseño propio.
- **Operaciones:** ninguna. **Invariantes:** ninguno. No hay pruebas `test:api` ni `test:db` nuevas.
- **Fuera:** lógica de negocio, validaciones, contrato, base de datos, proveedores de mapa, cifras en Inicio que el API no dé ya (nada de datos inventados: «equipos disponibles» del boceto llega con H5), fuente tipográfica nueva, lector de pantalla a fondo (H7).

## 3. Contexto para el implementador

- **Stack de la interfaz:** React + Vite, una hoja `apps/web/src/styles.css` (3478 líneas, por secciones con comentario `/* ---------- nombre ---------- */`) y los tokens en `apps/web/src/theme/tokens.css` (únicos colores literales; `test/no-literal-colors.test.ts` lo vigila y `test/theme-contrast.test.ts` recalcula cada par: 4,5:1 texto, 3:1 componentes; claro a 7:1 en texto). Sin `!important` ni selectores para ganar especificidad. Sin `@font-face`, `@import` ni `url(` remotos (`test/no-external-resources.test.ts`).
- **Textos:** siempre por `packages/i18n` (`src/es.ts`, `src/fr.ts`, con prueba de paridad); `test/no-fixed-text.test.ts` prohíbe texto fijo en componentes. Al quitar una ayuda se borra su clave en **los dos** idiomas.
- **Regla 9:** nada de geometría en componentes. **Regla 2:** lo que ve cada rol no cambia; solo se mueve de sitio.
- **Mapa:** todo lo de MapLibre vive en `src/map/` (regla de límites de ESLint). El selector de capas está en `src/map/map-view.tsx:198-203` (`.map-layers`, botones con `aria-pressed`); el cambio de capa entra por `setStyle` sin volver a montar el mapa. No se toca `style.ts`, `ign.ts` ni la atribución (siempre visible).
- **Rutas (regla 4):** las versiones son inmutables; «Editar ruta» lleva a `/routes/:id/edit?base=<versionId>` (hoy `routeDetail.actions.newVersion`) y el editor guarda con `createRouteVersion` o `deriveRoute`. `DeriveDialog` (`src/library/route-dialogs.tsx:80`) sigue igual y se abre desde «Duplicar ruta». Una ruta archivada solo ofrece Exportar y Duplicar.
- **E2E:** las demostraciones buscan por rol y nombre accesible con los textos de `@onway/i18n`. Al pasar un botón a un menú, el paso de la prueba abre primero el menú y pulsa el `menuitem`. Apoyo común en `apps/web/e2e/support/`.
- **Cada vista:** estados de carga, vacío y error; usable a 375 px; manejable con teclado.

## 4. Qué cambia, por carpeta

**`apps/web`**
- `src/theme/tokens.css`: paleta del boceto en oscuro y su equivalente en claro; escalas de D-S9; `--control-h`.
- `src/components/` (nuevos): `icon.tsx`, `menu.tsx`, `section-card.tsx` (tarjeta con cabecera de icono y título), `page-header.tsx` (icono, título, subtítulo opcional y hueco de acciones), `segmented.tsx` (el grupo Mapa / Coordenadas / Dirección y las pestañas de Misiones). `text-field.tsx` pierde la ayuda y gana la marca de obligatorio.
- `src/components/shell.tsx`, `src/nav/navigation.ts`: icono por entrada, subrayado activo, tema y cuenta como iconos a la derecha.
- `src/map/map-view.tsx`, `src/map/readout.tsx`: D-S6.
- Páginas y secciones: las de la tabla de tareas.
- `public/topografia-oscuro.webp` y `topografia-claro.webp` (añadido el 2026-11-21, fuera del plan inicial): fondo del `body` por tema, a tamaño real y en mosaico; `test/no-external-resources.test.ts` admite `url('/x.webp')` local.
- `src/styles.css`: se reescriben las secciones «botones y formularios», «marco con sesión», «páginas con mapa», «mapa» y las de cada vista tocada, sobre las escalas. Se borra el CSS que quede sin uso.
- Pruebas unitarias existentes de cada vista (`test/*.test.tsx`) y E2E (`e2e/*.spec.ts`): se ajustan a los menús. Nueva: `test/menu.test.tsx` y `e2e/ui-simplificacion-demo.spec.ts`.

**`packages/i18n`**: rótulos cortos nuevos («Editar ruta», «Duplicar ruta», «Exportar», «Más acciones», «Nueva ruta», «Capas»), claves de ayuda borradas, en es y fr.

**No cambian:** `apps/api`, `packages/contracts`, `packages/geo`, `db/`, `data/seed`, `infra/` (la CSP no cambia: sin recursos de terceros nuevos).

## 5. Cómo queda cada vista

| Vista | Antes → después |
|---|---|
| Cabecera | Texto → icono + texto, subrayado naranja en la activa, luna/sol y cuenta a la derecha. En móvil, menú desplegable como hoy |
| Inicio | «Centro de operaciones»: cabecera con una sola «Crear misión»; franja de organización; tarjeta «Tiempo en tu zona»; tarjeta «Misiones activas» (responsable, aceptados/pendientes, «Ver misión»); fila de cifras solo con lo que ya devuelve `listMissions` (activas, en planificación) |
| Crear misión | Sin introducción ni ayudas. Secciones: Datos de la misión (nombre\*, coordinador\*), Punto objetivo\* (segmentado con iconos), Información adicional (descripción), Puntos de origen. Barra de acciones fija que no tapa nada: «Cancelar» + «Crear misión» |
| Rutas | Cabecera: **«Nueva ruta ▾»** (Generar, Importar, Dibujar). Búsqueda con icono dentro del campo (Enter busca) y botón «Filtros». Tarjetas compactas: nombre, insignia y una línea de cifras (km · desnivel · altitud máx.). La barra de selección aparece solo al marcar: «Exportar ▾» y «Más ⋯» |
| Detalle de ruta | **«Validar»** (principal, si es borrador) · «Editar ruta» · «Exportar ▾» · «Más ⋯» (Duplicar ruta, Archivar ruta). Una sola fila. Versiones: «Ver» por fila; «Comparar versiones» dentro del encabezado de la sección |
| Editor | Sin párrafo de instrucciones (queda el aviso de simplificación en una línea). Guardar: «Guardar versión» (principal) con desplegable «Guardar como ruta nueva» |
| Generar rutas | Secciones en orden: Inicio, Final, Intermedios, Opciones (alternativas y nombre en una fila), Zonas a evitar. Un solo estilo de etiqueta. «Generar rutas» al final, a todo el ancho |
| Detalle de misión | Cabecera: estado + **acción principal del ciclo** («Activar misión») + «Más ⋯» (Editar datos, Duplicar misión). Rutas: fila con nombre, versión, cifras e insignia «Borrador»; acciones de fila en «⋯» (Validar, Marcar no disponible, Quitar); cabecera de la sección con «Añadir ruta» y «⋯» (Generar rutas, Exportar GPX, Exportar KML). Puntos: «Añadir punto ▾» (Origen, Intermedio, Reunión, Importar) y «⋯» por punto (Editar, Borrar). La tabla deja de cortarse |
| Misiones | Pestañas con el segmentado común; búsqueda como en Rutas; fila de misión en una línea de datos |

## 6. Riesgos

- **E2E amplio** (unas 175 búsquedas de botón): cada tarea ajusta las demostraciones de sus vistas; la última pasa el E2E entero.
- **Contraste con la paleta nueva:** la prueba manda; si un par no llega, se ajusta el tono, no la prueba.
- **Acciones escondidas en exceso:** validar una ruta y activar una misión no van nunca en un menú.
- **Móvil:** los menús se abren dentro de la ventana (se alinean al borde que tenga sitio) y sus opciones miden 48 px.
- **CSS muerto:** al final se buscan las clases sin uso de las secciones reescritas.

## 7. Verificación

- Por tarea: `pnpm check @onway/web @onway/i18n` y una mirada a 375 px si cambia la maquetación.
- Demostración (`e2e/ui-simplificacion-demo.spec.ts`), en escritorio y a 375 px: el coordinador entra, cambia la capa desde el icono, crea una misión sin ver textos de ayuda, abre una ruta, exporta GPX desde «Exportar», la duplica desde «Más», la edita y guarda una versión; en el detalle de la misión valida una ruta desde «⋯». Comprueba además que ninguna vista del coordinador muestra más de una acción principal y que no queda ningún `.field-help`.
- Completa al cerrar: los comandos de `CLAUDE.md` «Verificación» (sin `test:db`, `test:api` ni `run-postgis.sh` si el diff no sale de `apps/web` y `packages/i18n`) y el E2E con `CI=1` en la pila `onway-e2e`. Revisores: `reviewer` y `reviewer-ui`.

## 8. Documentos que hay que actualizar

- `docs/02-flujo-coordinador-y-vistas.md`: acciones del detalle de ruta (§ línea 259: «editar, duplicar…»), disposición de Inicio, Crear misión y detalle de misión; registro de cambios.
- `docs/04-arquitectura-y-stack.md` §3 «Interfaz»: objetivos de 48 px con puntero táctil y 40 px con puntero fino (D-S8).
- `docs/07-plan-de-implementacion.md`: fila del hito «Tal como se construyó».
- `specs/UI-rediseno/plan.md`: nota de que D-U3 queda sustituida por D-S2.
- `docs/estado.md` y `docs/historial.md` al cerrar. `apps/web/e2e/README.md`: la demostración nueva.
