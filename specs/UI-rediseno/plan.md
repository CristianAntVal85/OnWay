# UI-rediseno · Rediseño visual: tema oscuro, pantallas anchas y mapa de Crear misión — Plan

Estado: **aprobado por el usuario el 2026-11-05** (P1 resuelta con D-U13) · Origen: issue #14 · Rama: `hito/UI-rediseno` (desde `main` en `071b73a`).

**Es un hito fuera de la hoja de ruta, no un hito nuevo de v1.** No añade requisitos, operaciones, tablas ni invariantes: cambia cómo se ve y se reparte la interfaz que ya existe (H0–H4 y `H5-acceso`). Como en `H5-acceso`, la issue es la aprobación explícita que pide la constitución (punto 2) para adelantar una parte de H7 («accesibilidad básica»: aquí solo el **contraste**, calculado sobre tokens; el lector de pantalla y los botones de zoom de 29 px siguen en H7, pendiente (c) de `docs/estado.md`). El doc 07 no tiene sección para esto: hay que añadirla (§7).

## 0. Decisiones

**Tomadas por el usuario (no se reabren):**

| # | Decisión |
|---|---|
| D-U1 | **Tema oscuro por defecto y claro de alto contraste** disponible, con `prefers-color-scheme` y un selector en la vista Cuenta recordado en el navegador. Dos conjuntos de tokens (`:root` / `[data-theme]`) |
| D-U2 | El mapa base de **carreteras sigue al tema** (`namedFlavor('dark')` y sprites `v4/dark` de `@protomaps/basemaps`). Satélite y topográfico (IGN) **no** se tematizan. Atribuciones siempre visibles |
| D-U3 | **Acento: el rojo de rescate** (`--blaze`) como color de acción sobre el fondo oscuro; el resto se inspira en GitHub Dark (superficies `#0d1117`/`#161b22`, bordes sutiles, texto `#e6edf3`), pero el acento no es azul. **AA obligatorio** en todos los pares (4,5:1 texto, 3:1 componentes). *Sustituida el 2026-11-15 por D-S2 de `specs/UI-simplificacion/plan.md` (azul pizarra y naranja del boceto); el AA sigue siendo obligatorio* |
| D-U13 | (2026-11-05, resuelve P1) **Sin elección guardada se ve el oscuro.** El selector de Cuenta ofrece «Oscuro», «Claro (alto contraste)» y «Como el sistema»; solo esta última sigue a `prefers-color-scheme` |

**Pregunta que era del usuario:** P1 (§10), resuelta con D-U13.

## 1. Alcance

- **Requisitos que se cumplen mejor, sin RF nuevos:** doc 01 §7 «Accesibilidad y uso en campo» (legible con luz solar y con guantes, controles grandes, alto contraste) e «Internacionalización» (sin textos fijos); doc 04 §3 fila «Interfaz» (componentes propios, objetivos de 48 px, foco visible, teclado); doc 07 §4 **criterio 8** (carga, vacío y error, es y fr, móvil y teclado) y **criterio 7** / regla inviolable 9 (nada de geometría en componentes); doc 02 §1 principios y §2 Navegación (fila «Cuenta»); doc 02 §3.4 Crear misión (formulario con el mapa visible al lado, barra inferior fija) y §8 «El mapa no carga».
- **Vistas que se repasan (todas las que existen):** acceso (login, registro, «Solicitud recibida», recuperar y restablecer contraseña, espera), Inicio (tiempo, luz y luna), Misiones y su detalle (coordinador y rescatista, rutas de la misión, historial, diálogos), Crear misión, Rutas (biblioteca, detalle, generar, importar, editor, comparación, perfil de altitud), Administración (bandeja y código de invitación), Cuenta, Mi perfil provisional, 403/404 y «más adelante». **Voluntariado:** sus vistas no existen todavía (H6); heredarán los tokens.
- **Operaciones:** ninguna. `CURRENT_MILESTONE` sigue en `'H5'`; AC-02 no cambia (58 montadas).
- **Invariantes:** ninguno nuevo ni tocado (no hay INV de interfaz). Por eso no hay pruebas `test:api`/`test:db` nuevas.
- **Fuera:** funcionalidad, contratos de API, base de datos, el resto de H5, lector de pantalla y tamaño de los botones de zoom de MapLibre (H7), tematizar las capas de IGN, guardar el tema en el servidor (necesitaría `updateMe`, de H5).

## 2. Qué cambia, por carpeta

**`apps/web`.**
- `src/styles.css` (3058 líneas, un solo archivo): los tokens actuales llevan nombre de color (`--rock`, `--snow`, `--paper`) y se usan a la vez como tinta y como superficie oscura (cabecera). Pasan a **tokens semánticos** (§5) definidos en un archivo nuevo `src/theme/tokens.css` (importado antes que `styles.css`), con un conjunto para `[data-theme='dark']` y otro para `[data-theme='light']`. Los ~49 colores hexadecimales y `rgb()` sueltos de la hoja (estados, insignias, bandas de la composición por tipo de vía, perfil SVG, bandeja, `.tagline`, `color: #fff` del botón…) pasan a tokens. Sin `!important` ni selectores para ganar especificidad (lección de la issue #8). `color-scheme` por tema para que los controles nativos (`select`, barras de desplazamiento) sigan al tema.
- **Anchos:** `.content` (línea ~590, `max-width: 64rem` sin centrar) se centra con `margin-inline: auto` y un ancho por tipo de página: lectura y formularios, listas y tablas (`.page-wide-flow`, hoy 80rem) y páginas con mapa (`.page-wide`, sin límite). `.single-main` (38rem) y `.login-main` también se centran. Se revisan los demás `max-width` (líneas 70, 309, 374, 439, 474, 1164, 1541, 1618, 2623, 2696, 2861): los de medida de lectura (`--measure`) y diálogos se quedan; se corrige el que deje huecos a 1920 px o más. La cabecera sigue a todo el ancho (como GitHub), con el contenido centrado debajo.
- **Crear misión** (`src/pages/create-mission-page.tsx` y `.split-*` de la hoja, líneas 735–954): solo lo que diga la **medición** del bloque 1. Hoy, por debajo de 64rem (1024 px) el mapa va arriba con `.map-canvas { height: 20rem }` (320 px: el 39 % de 812 px y el 30 % de 1080 px); a partir de 1024 px ocupa `100dvh − 6,5rem` y el E2E de la issue #8 lo comprueba. Hipótesis a confirmar, por orden: (a) la pila de desarrollo se levantó sin `--build` y sirve una web anterior a `fc74d6f`; (b) la ventana mide menos de 1024 px CSS (portátil con zoom del 125 %, media pantalla) y cae en la disposición móvil de 320 px; (c) móvil: 320 px fijos, con la barra inferior fija restando alto.
- `src/theme/` (nuevo): proveedor y gancho `useTheme()` (preferencia guardada, tema resuelto, cambio), constantes de la clave y los valores. `public/theme-boot.js` (nuevo, clásico y bloqueante, ~15 líneas): fija `data-theme` en `<html>` antes de pintar (§4, D-U5).
- `index.html`: `<script src="/theme-boot.js">` en `<head>`, `<meta name="color-scheme" content="dark light">` y `theme-color` acorde al tema (lo actualiza el arranque).
- `src/components/theme-switch.tsx` (nuevo, como `language-switch.tsx`) en `src/pages/account-page.tsx`: grupo de opciones con teclado, objetivos de 48 px.
- `src/map/style.ts`: `buildStyle(layer, language, origin, theme)` con sprites `v4/dark|light` y `namedFlavor(theme)` para carreteras; el fondo de las capas ráster sigue al tema. `src/map/map-view.tsx` lee el tema con `useTheme()`; el mapa **no se vuelve a montar** (el estilo nuevo entra por `setStyle` con diferencias, el mismo camino que ya usa el cambio de capa). `route-layers.ts` no cambia: los colores de las rutas son fijos y su borde blanco las hace legibles sobre el mapa claro y el oscuro (§5). Los marcadores (`.map-marker`) y la marca de sendero usan tokens **fijos de mapa/marca**, no los del tema. Los controles de MapLibre (`.maplibregl-ctrl-group`) se tiñen con tokens desde la hoja, sin cambiar su tamaño.
- Pruebas: `test/theme-contrast.test.ts` (nueva, §6), `test/no-external-resources.test.ts` amplía la regla «el CSS no importa nada ni carga fuentes remotas» a **todos** los `src/**/*.css`, prueba de que `styles.css` no tiene colores literales fuera de los tokens, `test/map-parts.test.tsx` (hoy exige `sprites/v4/light`) y pruebas del selector y del arranque del tema. E2E: demostración nueva y ajustes de las existentes (§6).

**`packages/i18n`.** Textos es/fr del selector («Tema», «Oscuro», «Claro (alto contraste)» y, según P1, «Como el sistema»), con su paridad.

**`infra/`.** **Previsiblemente nada.** La CSP de `infra/Caddyfile` no cambia: el tema no usa estilos, fuentes ni scripts de terceros (`script-src 'self'` admite `theme-boot.js`; `font-src 'self'` y la prueba de recursos externos siguen). `infra/geodata/manifest.json` incluye `sprites/v4` **entero** desde el commit fijado `028c18f…` con suma del árbol: el repositorio `basemaps-assets` publica en `v4` los sprites `light` y `dark` (y otros), y `@protomaps/basemaps` 5.7.2 del lockfile tiene el sabor `dark` (comprobado en `node_modules`). **No se ha podido comprobar desde aquí** que `dark.json`, `dark.png` y `dark@2x.*` estén en el volumen descargado: es lo primero del bloque 1 (`docker run --rm -v onway_geodata:/g alpine ls /g/basemap/assets/sprites/v4`). Si faltaran, cambiar el commit fijado obliga a recalcular `treeSha256`, a volver a descargar los activos (14 MB) y a revisar la prueba `apps/api/test/unit/geodata.test.ts`: sería un bloque más y se avisaría antes.

**No cambian:** `apps/api`, `packages/contracts` (ni OpenAPI ni doc 06), `packages/geo`, `db/`, `data/seed`, `infra/compose*.yml`, `smoke.sh`.

## 3. Puertos implicados

Ninguno nuevo y ninguno tocado. El mapa base sigue siendo el extracto propio servido por Caddy.

## 4. Decisiones de diseño con alternativa descartada

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-U4 | **Variables CSS semánticas con `[data-theme]`** sobre la hoja propia; los componentes no cambian de clases | Tailwind, CSS-in-JS o una librería de componentes: dependencia nueva (constitución 12), reescribir 3058 líneas y más bundle sin ganancia para el móvil |
| D-U5 | **Sin destello:** `public/theme-boot.js`, script clásico y bloqueante del propio origen en `<head>`, lee la preferencia y fija `data-theme` antes del primer pintado; la CSP no cambia. Si `localStorage` falla, queda el tema por defecto del CSS | Script en línea con su `sha256` en la CSP: obliga a tocar el Caddyfile y a mantener el hash en sincronía. Sin script: destello del tema equivocado en cada carga para quien eligió el otro |
| D-U6 | La preferencia se guarda **solo en este navegador** (`localStorage`, clave `onway.theme`, valor validado contra una lista cerrada antes de tocar el DOM), como el idioma (D-H0-21) | En el servidor: necesita `updateMe` (H5) y contrato. En una cookie: viajaría al API en cada petición sin uso |
| D-U7 | **El mapa se entera por el contexto de React** (`useTheme()` dentro de `src/map/`), y el estilo nuevo entra con `setStyle` por diferencias; las rutas y marcadores se conservan | `MutationObserver` sobre `<html>` dentro del mapa (estado duplicado); pasar el tema como propiedad a cada `MapView` (una docena de llamadas); `key={theme}` (recrea el mapa y pierde la vista) |
| D-U8 | **Dividir solo los tokens** (`src/theme/tokens.css`); el resto de `styles.css` se queda en un archivo y en su orden | Partir la hoja por vistas: cambia el orden de la cascada (el fallo de la issue #8 fue de orden y especificidad) y mezcla un diff enorme sin valor con el cambio de color |
| D-U9 | **Se mantiene `Bahnschrift`/DIN** (fuente del sistema, sin descarga) para rótulos y se añade `--font-mono` del sistema (`ui-monospace`, `Consolas`…) para coordenadas, altitudes, métricas y el código de invitación: el aire «técnico» sin recursos externos | Una fuente propia (Inter, JetBrains Mono…): descarga de 100 kB o más, licencia y la prueba que prohíbe `@font-face`/`url(` en el CSS |
| D-U10 | **El claro es «de alto contraste» de verdad:** texto y texto secundario a ≥ 7:1 (AAA). El oscuro cumple AA. Los botones rojos se quedan en AA en los dos temas para conservar el rojo de rescate (D-U3) | AAA también en los botones: obligaría a un granate (`#9d1d13`) como color de acción y se perdería el rojo |
| D-U11 | **Hover del botón principal en oscuro sin cambiar el fondo** (subrayado del rótulo y borde): ningún rojo más oscuro cumple 3:1 contra todas las superficies oscuras, y uno más claro baja el texto blanco de 4,5:1 | Oscurecer el rojo al pasar el ratón, como en el claro: falla 3:1 sobre `--surface-raised` |
| D-U12 | Los **colores de las rutas** (`TONE_COLORS`) no dependen del tema: el borde blanco que ya llevan da ≥ 5:1 a cada color sobre el mapa claro, el oscuro, el satélite y el topográfico; la forma del trazo (sólido, discontinuo, punteado) sigue diciendo lo mismo sin color | Una paleta de rutas por tema: dos leyendas y dos conjuntos de pruebas para el mismo significado |

## 5. Tokens y contraste (calculados con la fórmula de WCAG 2.x)

Valores propuestos; la prueba `theme-contrast.test.ts` los recalcula desde `tokens.css` y es la que manda. «Deco» = borde decorativo (separadores, contenedores): no identifica un componente y no necesita 3:1; cualquier borde que delimite un control usa `--border-strong`.

| Token | Oscuro (defecto) | Claro (alto contraste) |
|---|---|---|
| `--bg` | `#0d1117` | `#eef1f0` |
| `--surface` (paneles, cabecera en oscuro, campos) | `#161b22` | `#ffffff` |
| `--surface-raised` (diálogos, barra inferior, elemento actual) | `#21262d` | `#ffffff` |
| `--border` (deco) | `#30363d` | `#a9b8ba` |
| `--border-strong` (campos, botones secundarios, grupos de capas) | `#6e7681` | `#17262b` |
| `--text` | `#e6edf3` | `#17262b` |
| `--text-muted` | `#9198a1` | `#3a4a50` (hoy `#4b5f66`, 5,9:1) |
| `--accent` (botón principal, marca) | `#d9381e` | `#c4271b` |
| `--accent-hover` | = `--accent` (D-U11) | `#9d1d13` |
| `--on-accent` | `#ffffff` | `#ffffff` |
| `--accent-text` (enlaces rojos, errores) | `#ff7b72` | `#9d1d13` |
| `--focus` / `--focus-inner` | `#ffc425` fuera / `--bg` dentro | `#17262b` fuera / `#ffc425` dentro (como hoy) |
| `--success` · `--warn` · `--info` | `#3fb950` · `#d29922` · `#58a6ff` | `#1f6b3a` · `#8a5a00` · `#0b5cad` |
| `--success-soft` · `--warn-soft` · `--danger-soft` | `#0f2a1a` · `#33270a` · `#3d1714` | `#e3f3e8` · `#fff3c4` · `#fbe9e7` |
| Cabecera | `--surface` con `--text` | `#17262b` con `#eef1f0` (como hoy) |

**Razones calculadas (oscuro):** `--text` sobre `--bg` 16,0 · `--surface` 14,6 · `--surface-raised` 12,9. `--text-muted`: 6,5 · 5,9 · 5,2. `--on-accent` sobre `--accent` **4,6** (justo; la prueba lo vigila). `--accent` contra `--bg` 4,1 · `--surface` 3,7 · `--surface-raised` 3,3. `--accent-text`: 7,5 · 6,9 · 6,0. `--border-strong`: 4,1 · 3,8 · 3,3. `--border` (deco) 1,6. Foco `--focus` contra `--bg` 11,9 · `--surface` 10,9 · `--surface-raised` 9,5. `--success` 7,5 · 6,8 · 6,0; `--warn` 7,5 · 6,9 · 6,0; `--info` 7,5 · 6,8 · 6,0. Sobre los fondos suaves: `--text` 13,0 (success-soft) · 12,4 (warn-soft) · 13,4 (danger-soft); `--success` sobre el suyo 6,1; `--warn` 5,8; `--accent-text` 6,3. Elemento pulsado (capas del mapa): `--bg` sobre `--text` 16,0.

**Razones calculadas (claro):** `--text` sobre `--bg` 13,7 · sobre blanco 15,6. `--text-muted` 8,1 · 9,2 (AAA, D-U10). `--on-accent` sobre `--accent` 5,7; sobre `--accent-hover` 8,0. `--accent` contra `--bg` 5,1 · blanco 5,7. `--accent-text` 7,1 · 8,0. `--border-strong` 13,7 · 15,6. `--border` (deco) 1,8 · 2,0: hoy `--line` delimita algún control; se pasa a `--border-strong`. Foco exterior 13,7. `--success` 5,7 · 6,5; `--warn` 5,2 · 5,9; `--info` 5,9 · 6,7. Fondos suaves: `#124a27` sobre `--success-soft` 9,0; `--text` sobre `--warn-soft` 14,0; `#7a1913` sobre `--danger-soft` 9,1; `--accent-text` sobre `#fdeceb` (alarma actual) 7,0.

**Mapa y marca (fijos en los dos temas):** rutas contra su borde blanco: `validated` 6,5 · `draft` 5,9 · `compare-a` 6,7 (el resto, más oscuros); el borde blanco contra el mapa oscuro ≥ 15. Marca de sendero blanco y rojo, como hoy. Los controles inactivos (`aria-disabled`, opacidad 0,65) están exentos de contraste en WCAG; aun así no bajan de 3:1 su borde.

## 6. Riesgos

- **Contraste justo** del texto blanco sobre el rojo oscuro (4,6:1): un ajuste de matiz lo rompe. Mitigación: la prueba unitaria falla por debajo de 4,5 y de 3; D-U11 para el hover.
- **Luz solar con el tema oscuro por defecto** (doc 01 pide legible al sol): el oscuro se lee peor a pleno sol. Mitigación: el claro AAA a un toque en Cuenta (y P1); se matiza el doc 01 (§7).
- **Destello del tema equivocado** al cargar o con `localStorage` bloqueado. Mitigación: D-U5, y E2E que recarga con la preferencia guardada y comprueba `data-theme` ya en `DOMContentLoaded`. Vite avisa de que no empaqueta un `<script>` sin `type="module"`: es lo buscado (vive en `public/`).
- **Vistas o estados olvidados** (diálogos, errores, insignias, perfil SVG, bandas de vías, avisos del mapa, `:hover`, `aria-pressed`, `aria-invalid`). Mitigación: prueba que prohíbe colores literales fuera de `tokens.css` y recorrido con Chrome DevTools de la lista del §1 en los dos temas.
- **El mapa se recrea o pierde las rutas** al cambiar de tema. Mitigación: D-U7; E2E que comprueba que el `<canvas>` es el mismo nodo antes y después y que las rutas siguen dibujadas. En la pila E2E no hay extracto PMTiles (no se descarga): allí se comprueba qué sprite **se pide** (`v4/dark.json` / `v4/light.json`), no el pintado; el pintado real se mira a mano en la pila de desarrollo.
- **E2E existentes que miden maquetación:** `h1-demo.spec.ts` (hueco bajo el mapa ≥ 1024 px), `mobile.spec.ts` (cajas de los enlaces), `expectNoHorizontalOverflow`, `expectWithinViewportWidth` y los clics en el centro del mapa tras `scrollIntoViewIfNeeded`; la intermitente `h2-demo.spec.ts:352` (móvil). Ninguna prueba E2E compara colores (comprobado). Mitigación: cambiar la maquetación en bloques separados del color y pasar el E2E entero en cada uno.
- **Tamaño:** solo CSS y unas líneas de JS; objetivo, el CSS crece ≤ 5 kB gzip y el JS principal ≤ 2 kB gzip (se mide antes en el bloque 1 y después en el 10).
- **CSP y almacenamiento:** ningún anfitrión nuevo; el valor de `localStorage` se valida contra la lista cerrada antes de escribirlo en `data-theme`. Lo revisa `reviewer-security`.
- **`forced-colors`** (contraste alto de Windows): los colores del sistema sustituyen a los tokens; lo que hoy solo se distingue por fondo (pulsado, insignias, bandas de vías, marca) necesita borde o `forced-color-adjust` (ya hay dos bloques, líneas 1850 y 2171). **`prefers-reduced-motion`**: sin transición al cambiar de tema; cualquier transición nueva va dentro de `(prefers-reduced-motion: no-preference)`; el mapa ya lo respeta.
- **Sprites oscuros ausentes** en el volumen `geodata` (§2, `infra/`): bloque extra si pasa.
- **Francés más largo** en el selector y en la cabecera a 375 px: se mira en fr a 375 px.

## 7. Verificación

No hay invariantes nuevos ni tocados (dicho en §1): la verificación es de interfaz.

- **Unitarias (Vitest, `pnpm test`):** `theme-contrast.test.ts` lee los dos conjuntos de `tokens.css`, calcula la razón WCAG de **cada par de la tabla del §5** (texto/fondo, texto/superficies, acento/texto, acento/superficies, foco/superficies, bordes de componentes, estados sobre fondos suaves) y exige 4,5:1 o 3:1 según el tipo (7:1 para `--text` y `--text-muted` del claro, D-U10); sin colores literales en `styles.css` fuera de los tokens; ningún `@import`, `@font-face` ni `url(` en ningún CSS; `buildStyle` pide `sprites/v4/dark` y el sabor oscuro en oscuro y `light` en claro, y no toca satélite ni topográfico; `ThemeSwitch` con teclado, es y fr, y la clave guardada; `theme-boot.js` y `src/theme/` usan la misma clave y los mismos valores, y un valor no válido cae al defecto.
- **Demostración como prueba E2E** (`apps/web/e2e/ui-rediseno-demo.spec.ts`, proyecto `desktop`, que fija él mismo los anchos 375, 768, 1280, 1920 y 2560 px):
  1. Sin preferencia guardada, el login sale con `data-theme="dark"` y el fondo del `body` es el valor de `--bg` (leído de la variable, no un literal).
  2. En cada ancho, con coordinador, administrador y rescatista: sin desborde horizontal en todas las vistas del §1; a partir de 1280 px el contenido de las páginas no anchas queda **centrado** (huecos izquierdo y derecho iguales ±1 px) y las páginas de lista y de mapa usan el ancho (sin hueco mayor que el umbral fijado tras medir).
  3. **Crear misión, alto del mapa medido** a 375 (×812 y ×667), 768, 1280×720 y 1920×1080, con los umbrales que salgan del bloque 1 (orientación: ≥ alto de pantalla − cabecera − 2rem desde 1024 px, y una fracción mínima del alto en móvil sin tapar el primer campo).
  4. Cuenta → selector → «Claro»: `data-theme="light"` al momento, sigue tras recargar y tras cerrar sesión (login en claro), y vuelta a oscuro; solo con teclado y en francés a 375 px.
  5. Mapa con la capa de carreteras: se pide `sprites/v4/dark.json`; al pasar a claro, `light.json`; el `<canvas>` es el mismo nodo y las rutas de la biblioteca siguen pintadas.
  Además, el E2E entero (`pnpm --filter @onway/web e2e`, hoy 99 pruebas) en la pila `onway-e2e` y en el CI.
- **A mano con Chrome DevTools** (contexto aislado, pila `onway-e2e` y, para el mapa base real, la de desarrollo reconstruida): capturas de cada vista del §1 en oscuro y claro a 375, 768, 1280 y 1920 px; emulación de `prefers-color-scheme`, `forced-colors: active` y `prefers-reduced-motion: reduce`; medidas con `evaluate_script`.
- **Comandos:** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` (tamaños del bundle antes y después); `pnpm --filter @onway/web exec playwright test -c e2e ui-rediseno-demo.spec.ts`; `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables y `E2E_BASE_URL=http://localhost:18080`, `pnpm --filter @onway/web e2e`; `infra/scripts/smoke.sh`; `test:api`, `test:db` y `test:routing` no deberían cambiar (los corre el CI).
- **Revisión:** `reviewer` (doc 07 §4), `reviewer-ui` (tamaños, contraste calculado, teclado, `forced-colors`, bundle) y `reviewer-security` (CSP sin cambios, `theme-boot.js`, `localStorage`). `reviewer-db` no aplica (sin SQL ni migraciones).

## 8. Documentos que habrá que actualizar

Como en `H5-acceso`: los de «aprobación» al aprobar este plan; los de «cierre» en el último bloque.

| Documento | Cambio | Registro de cambios |
|---|---|---|
| **07** (plan) | Aprobación: subsección nueva en §3, tras H5, «UI-rediseno · Rediseño visual (fuera de la hoja de ruta, issue #14)» con filas Demostración, Alcance (§1 de este plan), Operaciones (0), Salida (§7), Fuera; y una nota de que adelanta de H7 solo el contraste. Cierre: fila «Tal como se construyó» | **v0.10** (aprobación: «Cambio de alcance (issue #14): rediseño visual fuera de la hoja de ruta…») y **v0.11** (cierre) |
| **04** (arquitectura) | §3 fila «Interfaz»: tokens semánticos con dos temas (oscuro por defecto y claro AAA), arranque sin destello, preferencia en el navegador, `--font-mono` del sistema; §8.1 fila «Carreteras»: estilo y sprites según el tema; §9.0 fila de fuentes y sprites: los `dark` se usan | **v1.4** (aprobación) y, si al construir cambia algo, **v1.5** (cierre) |
| **02** (vistas) | §2 Navegación: «Cuenta (idioma, **tema**, cerrar sesión)»; §1 principios: una línea sobre tema y contraste; §3.4 Crear misión: el alto del mapa medido en escritorio y móvil | **v1.2** |
| **01** (visión) | §7 «Accesibilidad y uso en campo»: matiz «tema oscuro por defecto y claro de alto contraste para pleno sol» (D-U1) | **v1.4** |
| `CLAUDE.md` | Recuentos de web y E2E; que tras cambiar de rama la pila se levanta con `--build` (si el bloque 1 confirma la hipótesis a) | — |
| `docs/estado.md` | Estado del cambio; pendiente (c) se divide: contraste hecho, lector de pantalla y zoom de 29 px siguen en H7 | — |
| 03, 05, 06 | **Sin cambios** | — |

## 9. Orden propuesto de trabajo (orientación para `tasks.md`, no son las tareas)

1. **Medir antes de tocar:** pila reconstruida; Crear misión y vistas principales a 375 (×812/×667), 768, 1024, 1280, 1920 y 2560 px; sprites `dark` en el volumen `geodata`; tamaños del bundle. Resultado en `specs/UI-rediseno/medidas.md` y umbrales del E2E.
2. **Tokens y prueba de contraste:** `tokens.css` con los dos temas, `theme-contrast.test.ts`, ampliar la prueba de recursos externos; base (cuerpo, cabecera, botones, campos, foco).
3. **El resto de la hoja a tokens:** estados, insignias, tablas, diálogos, barra inferior, perfil SVG, bandas de vías, bandeja; prueba de «sin colores literales».
4. **Arranque y selector de tema:** `theme-boot.js`, `src/theme/`, `ThemeSwitch` en Cuenta, `index.html`, i18n es/fr (y P1).
5. **Mapa base que sigue al tema:** `buildStyle`, `MapView` con `useTheme()`, controles de MapLibre, marcadores fijos; `map-parts.test.tsx`.
6. **Anchos:** `.content` centrado y anchos por tipo de página, acceso y pantallas sueltas centradas, repaso de los `max-width`.
7. **Crear misión:** alto del mapa en escritorio, ancho intermedio y móvil según el bloque 1.
8. **Repaso de accesibilidad:** `forced-colors`, `prefers-reduced-motion`, francés a 375 px, foco en los dos temas; capturas con Chrome DevTools.
9. **Demostración E2E** `ui-rediseno-demo.spec.ts` y ajustes de las pruebas existentes.
10. **Documentos, recuentos, `estado.md`, bundle final y CI en verde.**

Cada bloque cerraría con commit `<tipo>(UI-rediseno): Tn <resumen en inglés>` y push a `hito/UI-rediseno`. Si los sprites oscuros no están en el volumen, el bloque 5 se parte en dos (geodata y mapa) y habría que juntar 2 y 3 para seguir en diez.

## 10. Preguntas abiertas

1. **P1 · ¿Qué tema se ve sin una elección guardada?** **Resuelta (2026-11-05, D-U13):** se adopta la recomendación. Sin elección guardada se ve el **oscuro**; el selector de Cuenta ofrece «Oscuro», «Claro (alto contraste)» y «Como el sistema», y solo esta última sigue a `prefers-color-scheme`.
