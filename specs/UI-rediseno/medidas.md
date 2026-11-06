# UI-rediseno · Medidas

Medidas de T1 (2026-11-05), tomadas antes de tocar código de producto sobre `main` en `071b73a`. Pila de pruebas `onway-e2e` (puerto 18080, superposición E2E, reconstruida con `--build` desde esta rama, que a efectos de código es `main`) y Chrome DevTools en contextos aislados (`t1-medicion`, coordinador; `t1-admin`, administrador). Cuentas de la semilla. Los umbrales de la sección 6 son los que usan T6, T7 y T9; T3 usa el recuento de `!important` de la sección 5.

## 1. Sprites oscuros (solo lectura)

`docker run --rm -v onway_geodata:/g:ro alpine ls /g/basemap/assets/sprites/v4`: **están los cuatro** (`dark.json` 3549 B, `dark.png` 16 054 B, `dark@2x.json` 3579 B, `dark@2x.png` 28 407 B), junto a `light.*`, `black.*`, `grayscale.*` y `white.*`. El volumen `onway_geodata` existe. **No hace falta tocar `infra/geodata`**: T5 sigue como está escrita (no se parte en dos ni se juntan T2 y T3).

## 2. Hipótesis (a): la pila de desarrollo sirve una web anterior a `fc74d6f`

**Confirmada.**
- `docker compose -p onway images` falla («No such image sha256:c0a7…», una imagen que ya no existe), así que se usó `docker inspect`: el contenedor `onway-web-1` del proyecto `onway` se **creó el 2026-11-02 09:32 +01:00** y corre la imagen `f1fc37291a89…`, que ya no lleva etiqueta; la etiqueta `onway/web:local` se reconstruyó después (2026-11-05 13:14 +01:00), pero el contenedor no se recreó y sigue con la imagen vieja.
- El arreglo de la issue #8 es `3a1f559` (2026-11-05 10:10 +01:00, dentro de la fusión `fc74d6f`, 2026-11-05 10:31 +01:00): posterior al contenedor.
- Prueba directa, solo lectura (`docker exec onway-web-1 grep` sobre el CSS servido `/srv/assets/index-BHRroUuB.css`): contiene la regla base `.map-canvas{position:relative;flex:none;height:20rem;…}` y **no** la regla con `.split-map` delante que añadió `3a1f559`; el bloque de escritorio es `.map-canvas{flex:1 1 auto;height:auto}` suelto, que la regla base (después, misma especificidad) anula. Exactamente el síntoma de la issue #8: mapa de 320 px dentro de una sección de ~800 px.
- Consecuencia: el usuario ve el mapa pequeño en la pila `onway` hasta que la recree (`docker compose up --build --wait`); tras cambiar de rama o fusionar hay que levantar con `--build` (nota para `CLAUDE.md`, T10).

## 3. Crear misión con la pila reconstruida (`onway-e2e`)

`/missions/new` como coordinador, a cada tamaño con `resize_page` y `evaluate_script` (desplazamiento 0). «Lleno» = `emptySpace`, la misma cuenta que la prueba de `h1-demo.spec.ts` (alto de `.map-view` menos la suma de sus hijos): ≤ 1 px.

| Ventana (CSS px) | Disposición | `.map-canvas` alto × ancho | Alto / ventana | Sección del mapa (alto) | Hueco vacío bajo el mapa | Primer campo (arriba) | Barra inferior |
|---|---|---|---|---|---|---|---|
| 375×812 | columna (mapa arriba) | 320 × 371 | 39 % | 579 (barra de capas 93 + mapa 320 + lectura 75 + atribuciones 87) | 0,4 | 919: bajo el pliegue, sin solape | 136, fija dentro del formulario |
| 375×667 | columna | 320 × 371 | 48 % | 579 | 0,4 | 919: bajo el pliegue | 136 |
| 768×1024 | columna | 320 × 764 | 31 % | 488 | 0,2 | 832 | 113 |
| 819×614 (1024 al 125 %) | columna | 320 × 815 | 52 % | 488 | 0,2 | 832 | 113 |
| 1024×768 | **escritorio** (mapa pegado) | 427 × 436 | 56 % | 664 (= 100dvh − 6,5rem − 0) | 0 | 321, a la izquierda | 136 |
| 1280×720 | escritorio | 417 × 692 | 58 % | 616 | 0 | 281 | 136 |
| 1920×1080 | escritorio | 824 × 1332 | 76 % | 976 | 0 | 281 | 136 |
| 2560×1440 | escritorio | 1199 × 1972 | 83 % | 1336 | 0 | 281 | 136 |

(Referencia 1440×900: el mismo comportamiento de escritorio.) Lo que sale:
- **Con la pila reconstruida, el mapa de Crear misión ya llena su contenedor en escritorio (≥ 1024 px):** hueco vacío 0 a todos los tamaños. No queda nada del síntoma de la issue #8; la causa de lo que vio el usuario es la **(a)**.
- A los 1024 px la sección mide `100dvh − 6,5rem` (664 de 768 menos la cabecera de 96 px, que en ese ancho ocupa dos filas) y el lienzo se queda en 427 px porque la barra de capas, la lectura y las atribuciones se llevan 237; en 1280×720 el lienzo es el 58 % del alto.
- **(b) también se da, por diseño:** por debajo de 1024 CSS px (ventana de 1024 al 125 % = 819 px, media pantalla de un portátil, tableta vertical) se usa la disposición de columna con el lienzo a **320 px fijos** (`.map-canvas { height: 20rem }`): 52 % de 614 px y 31 % de 1024 px.
- **(c) en móvil:** 320 px fijos = 39 % de 812 y 48 % de 667; todo el bloque del mapa (con capas, lectura y atribuciones) ocupa 579 px, el 71 % del alto de 812 y el 87 % del de 667, y el primer campo del formulario queda bajo el pliegue (919 px). El mapa no lo tapa (sin solape vertical). La barra inferior (136 px a 375 px, 113 a 768) es fija **dentro del formulario**: no se ve hasta llegar a él, y `scroll-padding-bottom: 11rem` (176 px) deja sitio al foco.
- Sin desborde horizontal en ningún tamaño (`scrollWidth` = ancho de la ventana).

## 4. Huecos laterales de `.content` (coordinador; administrador solo en Administración)

Huecos entre el borde de la ventana y el recuadro de `.content` (izquierdo siempre 0: no está centrado) y entre el borde y los hijos del contenido (relleno de 24 px incluido). `max-width` calculado de `.content`: 64rem = 1024 px (lectura y formularios), 80rem = 1280 px con `.page-wide-flow`, `none` con `.page-wide`.

| Vista | Clase de página | `max-width` | Hueco derecho 1280 | 1920 | 2560 | Hueco izquierdo (contenido) |
|---|---|---|---|---|---|---|
| Inicio (`/home`) | `page-wide-flow` | 1280 | 0 (los hijos, 24) | 640 (664) | 1280 (1304) | 0 (24) |
| Misiones (`/missions`) | ninguna (lectura) | 1024 | 256 (280) | 896 (920) | 1536 (1560) | 0 (24) |
| Detalle de misión (activa) | `page-wide` | ninguno | 0 (24) | 0 (24) | 0 (24) | 0 (24) |
| Rutas (`/routes`) | ninguna (lectura) | 1024 | 256 (280) | 896 (920) | 1536 (1560) | 0 (24) |
| Administración (`/admin`) | ninguna (lectura) | 1024 | 256 (280) | 896 (920) | 1536 (1560) | 0 (24) |
| Cuenta (`/account`) | ninguna (lectura) | 1024 | 256 (280) | 896 (920) | 1536 (1560) | 0 (24) |
| Crear misión (`/missions/new`) | `page-wide` | ninguno | 0 | 0 | 0 | 0 |

Lo que sale: ninguna página está centrada; a 1920 y 2560 px las de lectura dejan todo el hueco a la derecha (896 y 1536 px, más del 46 % y el 60 % del ancho) y Inicio (la única lista con `page-wide-flow`) 640 y 1280 px. `Misiones` y `Rutas` usan el límite de 1024 px, no el de `page-wide-flow`: T6 decide su tipo de página (el plan las pone entre «listas y tablas»). Las páginas con mapa llenan el ancho (24 px de relleno por lado).

## 5. Tamaños de partida y hoja

`pnpm --filter @onway/web build` en `main` (071b73a), `gzip -c <archivo> | wc -c`:

| Archivo | Bytes | gzip |
|---|---|---|
| `assets/index-*.css` (CSS principal) | 38 309 | **7 932** |
| `assets/index-*.js` (JS principal) | 897 298 | **262 856** |
| `assets/map-view-*.css` (maplibre, perezoso) | 71 505 | 10 217 |
| `assets/map-view-*.js` (perezoso) | 1 190 754 | 324 296 |

Objetivo de T10: CSS principal ≤ 7 932 + 5 120 = 13 052 B gzip y JS principal ≤ 262 856 + 2 048 = 264 904 B gzip. (El aviso de Vite de fragmentos > 500 kB ya existe y no cambia.)

`apps/web/src/styles.css` (3058 líneas): **`!important`: 0** (el recuento que fija T3: «ninguno»); **colores literales: 65** (63 hexadecimales en 60 líneas —28 distintos, 11 de ellos en las declaraciones de `:root` (`--rock`, `--slate`, `--stone`, `--snow`, `--paper`, `--line`, `--blaze`, `--blaze-deep`, `--signal`, `--signal-soft`, `--alarm-soft`) y 52 sueltos— más 2 funcionales: `rgb(23 38 43 / 72%)` en la línea 1535 y `rgba(31, 107, 58, 0.18)` en la 2250); nombres de color en declaraciones: ninguno; 17 declaraciones `max-width` (líneas 70, 309, 374, 439, 474, 590, 636, 736, 1164, 1541, 1618, 2300, 2595, 2623, 2696, 2861, 3041); 2 bloques `forced-colors`.

## 6. Umbrales para T6, T7 y T9

Medidas con `resize_page` + `evaluate_script`; cada una se anota «después» en esta tabla.

**Centrado (T6, T9).** Páginas de lectura y formularios (`.content` de 64rem), desde 1280 px: `|hueco izquierdo − hueco derecho| ≤ 1 px` medido en el recuadro de `.content` (y en los hijos). Lo mismo para `page-wide-flow` cuando el ancho supera su límite (1280 px, a partir de 1281). El acceso (`.login-main`, `.single-main`) también centrado ±1 px.

**Hueco máximo de las páginas anchas (T6, T9).**
- Páginas con mapa (`.page-wide`: detalle de misión, Crear misión, rutas): hueco por lado ≤ 24 px + 1 (el relleno) a **cualquier** ancho, como hoy.
- Listas y tablas (`.page-wide-flow`: Inicio, Mis misiones y, según T6, Misiones, Rutas y Administración): contenido de hasta 80rem (1280 px); hueco por lado ≤ 1 px del que sale de centrarlo: ≤ 321 px a 1920 y ≤ 641 px a 2560, y 0 + relleno hasta 1280. Cualquier hueco por lado mayor que eso a 1920 px o más es un fallo.
- Páginas de lectura (64rem): hueco por lado ≤ 449 px a 1920 y ≤ 769 px a 2560 (centradas).

**Alto del mapa de Crear misión (T7, T9).** Misma medida que arriba (alto de `.map-canvas`, hueco vacío de `h1-demo.spec.ts` ≤ 1 px, desplazamiento 0), en los dos temas:
- Escritorio (≥ 1024 px de ancho): hueco vacío ≤ 1 px (ya lo exige `h1-demo.spec.ts`) y alto de `.map-canvas` ≥ 50 % del alto de la ventana a 1024×768 y 1280×720 (hoy 56 % y 58 %), ≥ 70 % a 1920×1080 (hoy 76 %) y ≥ 75 % a 2560×1440 (hoy 83 %); nunca por debajo de lo medido hoy.
- Columna (< 1024 px; hipótesis (b) y (c)): el alto no baja de 20rem (320 px) en ningún tamaño; **propuesta para T7** (si cambia la hoja): `.map-canvas` ≥ 40 % del alto de la ventana a 375×812 y a 768×1024 (325 y 410 px; hoy 39 % y 31 %), ≥ 320 px a 375×667 y 819×614, sin que el mapa se solape con el primer campo (cajas sin solape vertical) ni la barra inferior fija recorte el campo enfocado (`scroll-padding-bottom` ≥ alto de la barra). Si T7 deja la columna como está, lo anota con estas cifras y su razón (la causa de lo visto fue (a)).
- Sin desborde horizontal a 375, 768, 1280, 1920 y 2560 (`expectNoHorizontalOverflow`).

## 7. Lo que cambia para el plan

- Nada obliga a cambiar el plan ni `tasks.md`: los sprites están, la causa del mapa pequeño visto por el usuario es **(a)** y se arregla recreando su pila con `--build` (T10 lo anota en `CLAUDE.md`).
- T7 no debería tocar la maquetación de escritorio (ya llena el contenedor); su trabajo real son la columna (hipótesis b y c) y la prueba de los umbrales de T9. Si el usuario no quiere cambiar la columna, T7 se reduce a la nota de (a) (ya prevista en `tasks.md`).
- `!important` parte de 0: T3 exige que siga en 0.
- El `docker compose -p onway images` falla en la pila del usuario por una imagen que ya no existe (probablemente de un servicio de un solo uso); no afecta a nada.

## 8. T3: recorrido de todas las vistas con los tokens (2026-11-06)

Pila `onway-e2e`, Chrome DevTools en contextos aislados (coordinador `t3-dark`, administrador `t3-admin`). Cada vista en oscuro (el tema por defecto) y en claro (fijando `data-theme='light'` a mano en `<html>`, como pide T3), a 1280 y 375 px. Además de mirar las capturas, un recorrido por script calcula la razón de contraste de **todo el texto visible** contra el fondo efectivo (ancestros con transparencia compuestos) en los dos temas, y exige 4,5:1: **sin ningún hallazgo** en Inicio, detalle de misión (con tabla de rutas, lista de preparación, puntos e historial), Rutas, detalle de ruta (perfil SVG, composición por tipo de vía, versiones), Generar rutas, Crear misión, Cuenta y Administración (solicitudes, selección, código de invitación).

| Vista | 1280 oscuro | 1280 claro | 375 oscuro | 375 claro |
|---|---|---|---|---|
| Acceso (login) | visto | no visto en T3 (T2: 375 claro) | (T2) | (T2) |
| Inicio | visto | recorrido por script | recorrido por script | recorrido por script |
| Misiones (lista) | visto | recorrido por script | — | — |
| Detalle de misión | visto | visto | recorrido por script | recorrido por script |
| Rutas (biblioteca) | visto | recorrido por script | — | — |
| Detalle de ruta con perfil | visto | visto | — | — |
| Generar rutas | recorrido por script | recorrido por script | visto | recorrido por script |
| Crear misión | — | — | visto | visto |
| Administración (con fila seleccionada y código) | recorrido por script | recorrido por script | visto | recorrido por script |
| Diálogo «Aprobar solicitudes» | — | — | visto | visto |

Sin elementos con el color antiguo ni texto ilegible. Lo que cambió respecto al diseño de T2 al pasar la hoja a tokens:
- Los **bordes de contenedor y control** que eran «tinta» (`--rock`) pasan a `--border-strong` (igual que la tinta en claro, gris 3:1 en oscuro) y los separadores (`--line`) a `--border`: el claro queda como estaba y el oscuro gana jerarquía.
- **Insignias y estados:** borde del estado (`--success`, `--accent-text`) sobre su fondo suave y el rótulo en `--text` (antes un verde o rojo oscuro propio en claro). Las franjas de las tarjetas de ruta usan los tokens de estado del tema; las **leyendas del mapa** usan los colores fijos de las rutas (`--route-*`, los mismos que `TONE_COLORS`) con el borde blanco que lleva la línea en el mapa (`outline`).
- **Controles inactivos** (`aria-disabled`): sin `opacity: 0,65`, que en oscuro dejaba el borde por debajo de 3:1; ahora fondo `--surface`, rótulo `--text-muted` y borde `--border-strong` (4,5:1 y 3:1 contados en `theme-contrast.test.ts`).
- Marcadores, manijas de vértice y marca de sendero con tokens **fijos** (`--mark-*`, `--map-origin`, `--map-rendezvous`); perfil de altitud con `--success`, `--border` y `--text-muted`.
- `--font-mono` ya se usa: código de invitación y coordenadas compartidas.
- Tamaños (gzip): CSS principal 8 415 B (T2: 8 426), JS principal 262 855 B (T2: 262 854).

## 9. T6: anchos «después» (2026-11-06)

Pila `onway-e2e` reconstruida con `--build` desde el código de T6; coordinador, administrador, rescatista (`rescatista1`), cuenta pendiente y vistas públicas de la semilla, a 375×812, 768×1024, 1280×720, 1920×1080 y 2560×1440, en oscuro y en claro. Los números salen de un guion de Playwright (`getBoundingClientRect` de `main.content`, `.single-main` y `.login-main` y de sus hijos, `scrollWidth` frente a `clientWidth`) que recorre toda la matriz (las 8 vistas del coordinador, 2 del administrador, 3 del rescatista, las 3 públicas y la espera, por ancho y tema: 160 filas); con Chrome DevTools (contexto aislado `t6-medicion`, coordinador) se miraron capturas de login a 1920, Misiones a 1920 y 375, Rutas a 1920 y Cuenta a 2560.

Cambios de la hoja: `.content` con `margin-inline: auto` (64rem por defecto, 80rem con `.page-wide-flow`, sin límite con `.page-wide`; la cabecera sigue a todo el ancho); `.login-main` y `.single-main` con `margin-inline: auto`. Clases de tipo de página que faltaban: `page-wide` en la biblioteca de Rutas, el detalle de ruta, el editor, Generar rutas e Importar ruta (todas con mapa); `page-wide-flow` en el panel de Misiones (la lista; Mis misiones e Inicio ya la tenían). Administración, Cuenta, Mi perfil, 403, 404 y «más adelante» se quedan de lectura (64rem). `max-width` que se quedan (prueba `layout-widths.test.ts`): medida de lectura (`--measure`), acceso (30rem), pantallas sueltas (38rem), diálogos (34rem y 44rem), columna de Administración (48rem), celda de ruta de la misión (22rem), nombre de la organización (14rem) y `100%`; no hay ningún tope que deje huecos a 1920 px o más que no sea el de su tipo de página.

| Tipo (vista) | max-width | Hueco por lado 375 | 768 | 1280 | 1920 | 2560 | Umbral (§6) | Resultado |
|---|---|---|---|---|---|---|---|---|
| Lectura (Cuenta, Administración, Mi perfil) | 1024 | 0 | 0 | 128 | 448 | 768 | centrado ±1; ≤ 449 a 1920 y ≤ 769 a 2560 | cumple (izq. = der., diferencia 0) |
| Lista (Inicio, Misiones, Mis misiones) | 1280 | 0 | 0 | 0 | 320 | 640 | centrado ±1; ≤ 321 a 1920 y ≤ 641 a 2560 | cumple (diferencia 0) |
| Mapa (detalle de misión, Crear misión, Rutas, detalle de ruta, Generar) | ninguno | 0 | 0 | 0 | 0 | 0 | ≤ 24 + 1 de relleno | cumple (hijos a 24 px por lado, 16 en 375) |
| Acceso (`.login-main`, centrado en su columna a partir de 768 px) | 480 | 0 | 0 | 0 | 0 | 0 | centrado ±1 | cumple (desviación del centro de la columna 0 a 768, 1280, 1920 y 2560; a 375 llena el ancho) |
| Espera (`.single-main`) | 608 | 0 | 80 | 336 | 656 | 976 | centrado ±1 | cumple (izq. = der.) |

Los huecos son los del recuadro de `.content`; los de los hijos suman el relleno de 16 px (< 768 px) o 24 px. La cabecera mantiene izquierda y derecha 0 en todos los anchos. **Sin desborde horizontal** (`scrollWidth` = ancho) en ninguna de las 160 filas, en oscuro y en claro. Antes (§4): ninguna página centrada, hueco derecho de 896 y 1536 px a 1920 y 2560 en las de lectura y de 640 y 1280 en Inicio. Efecto lateral buscado: Misiones y las vistas de Rutas ya no usan 1024 px (las pone en su tipo, §4 «T6 decide»).

Tamaños (gzip, `pnpm build`): CSS principal 8 584 B (T5: 8,56 kB) y JS principal 263 595 B (T5: 263,86 kB); frente a T1 (7 932 y 262 856): +0,65 kB y +0,74 kB.

## 10. T7: alto del mapa de Crear misión «después» (2026-11-06)

Pila `onway-e2e` reconstruida con `--build` desde el código de T7; coordinador de la semilla, un guion de Playwright con `getBoundingClientRect` (alto de `.map-canvas`, hueco vacío de `h1-demo.spec.ts`, cajas de la sección del mapa y del primer campo, `scroll-padding-bottom`) en oscuro y en claro, más capturas con Chrome DevTools a 375×812 en los dos temas (también con el primer campo enfocado). Cambio de la hoja: `.split-map .map-canvas { height: clamp(20rem, 42vh, 36rem); height: clamp(20rem, 42dvh, 36rem) }` (solo en columna; el bloque de escritorio, que va después, sigue con `flex: 1 1 auto; height: auto`).

| Ventana (CSS px) | Disposición | `.map-canvas` antes | **Después** | Alto / ventana | Umbral (§6) | Hueco vacío | Primer campo (arriba, página) | Solape con el mapa | Barra |
|---|---|---|---|---|---|---|---|---|---|
| 375×812 | columna | 320 (39 %) | **341** | 42 % | ≥ 40 % (325) | 0,4 | 941 | no | 136 |
| 375×667 | columna | 320 (48 %) | **320** | 48 % | ≥ 320 | 0,4 | 920 | no | 136 |
| 768×1024 | columna | 320 (31 %) | **430** | 42 % | ≥ 40 % (410) | 0,1 | 944 | no | 113 |
| 819×614 | columna | 320 (52 %) | **320** | 52 % | ≥ 320 | 0,2 | 833 | no | 113 |
| 1024×768 | escritorio | 427 (56 %) | **427** | 56 % | ≥ 50 %, hueco ≤ 1 | 0 | 322 | lado a lado | 136 |
| 1280×720 | escritorio | 417 (58 %) | **417** | 58 % | ≥ 50 %, hueco ≤ 1 | 0 | 282 | lado a lado | 136 |
| 1920×1080 | escritorio | 824 (76 %) | **824** | 76 % | ≥ 70 %, hueco ≤ 1 | 0 | 282 | lado a lado | 136 |
| 2560×1440 | escritorio | 1199 (83 %) | **1199** | 83 % | ≥ 75 %, hueco ≤ 1 | 0 | 282 | lado a lado | 136 |

Mismas cifras en oscuro y en claro (la maquetación no depende del tema); sin desborde horizontal en ningún tamaño. El primer campo sigue bajo el pliegue en móvil (la sección del mapa llega a 600 px a 375×812, frente a 579): por diseño el mapa va arriba y entero, y el formulario debajo; lo que se exigía era que no se tapen (no hay solape: la sección del mapa termina antes de donde empieza el formulario). **Barra inferior:** `scroll-padding-bottom` es 176 px (11rem) frente a una barra de 136 px como máximo: con el foco en el primer campo a 375×812 el campo queda en 292–344 px y la barra empieza en 676 px; al enfocar el último control del formulario, queda a 595 px y la barra empieza en 628 px (visible, no recortado). Tamaños (gzip): CSS principal 8 606 B (T6: 8 584) y JS principal 263 595 B (sin cambio).

## 11. T8: repaso de accesibilidad en los dos temas (2026-11-06)

Pila `onway-e2e` reconstruida con `--build` desde el código de T8; cuentas de la semilla (coordinador, `coordinatrice` en francés, administrador, `rescatista1`, `pendiente` y vistas públicas); Chrome DevTools (contexto aislado `t8-coord`) y dos guiones de Playwright que recorren la matriz (las capturas no se versionan). **Recorrido por script** (`getComputedStyle` y `getBoundingClientRect`, ambos temas en cada carga con `data-theme`): 190 combinaciones de vista y ancho × 2 temas = **380 filas** (375, 768, 1280 y 1920 px; coordinador con Inicio, Misiones, tres misiones, Crear misión, biblioteca, seis rutas, editor, Generar, Importar, Dibujar, Cuenta, Equipos y 404; administrador con `/admin`, Cuenta, 403; rescatista con Misiones, detalle, Inicio, Mi perfil, Cuenta, 403; cuenta pendiente; acceso, registro, recuperar y restablecer; coordinadora y acceso **en francés**) más **81 filas de estados** (375 y 1280 px, los dos temas): diálogos de activar, importar puntos, duplicar, cerrar y añadir ruta, y el de aprobar solicitudes; carga, error y vacío de Misiones; error de la biblioteca; campos con error en Crear misión, acceso y registro; «Solicitud recibida» y «Revisa tu correo» (respuesta simulada, no se crea ninguna cuenta); misión elegida en Inicio, ruta seleccionada, capa pulsada, solicitud marcada y pestaña de rechazadas. Por fila: desborde horizontal, contraste del texto visible (4,5:1; 3:1 en texto grande), foco de cada tipo de elemento enfocable (anillo visible, contraste de cada aro contra lo que hay detrás, recorte por antepasados con `overflow`) y botones o pestañas cuyo texto no cabe.

| Comprobación | Resultado |
|---|---|
| Desborde horizontal, 4 anchos, 2 temas, es y fr | ninguno |
| Contraste del texto, todas las vistas y estados, 2 temas | ningún texto por debajo de 4,5:1 (o 3:1 si es grande) |
| Texto cortado en botones, pestañas, selectores, menú y barras (francés a 375 px incluido: cabecera, selector de idioma y de tema, barra de Crear misión, diálogos) | ninguno |
| Foco visible | **2 hallazgos, corregidos** (abajo); el resto, anillo doble de 3 + 2 px a ≥ 3:1 contra cada superficie |
| Emulación `prefers-color-scheme` con «Como el sistema» (claro y oscuro, en vivo y tras recargar, francés a 375 px) | sigue al sistema; con «Oscuro» o «Claro» no |
| Emulación `forced-colors: active` (paleta clara y oscura del emulador; Inicio, Misiones, detalle de misión, Crear misión, biblioteca, detalle de ruta, editor, Administración, Cuenta, acceso con error) | **4 hallazgos, corregidos** (abajo) |
| Emulación `prefers-reduced-motion: reduce` | el indicador de carga no gira (`animation: none`); el único movimiento restante era el desvanecido de los marcadores de MapLibre (`transition: opacity 0.2s` de su hoja): **corregido**; el mapa y el código ya usaban duración 0 |

**Hallazgos y resolución**
1. **Foco sobre el lienzo del mapa invisible** (todas las vistas con mapa): el anillo, por fuera, lo recorta `.maplibregl-map { overflow: hidden }`. Ahora un pseudoelemento del mapa dibuja el anillo doble por dentro, sobre el lienzo y bajo los controles (`:has(.maplibregl-canvas:focus-visible)::after`).
2. **Foco recortado en la tabla de vértices del editor** (`.vertex-scroll { overflow: auto }`): botones y campos de la primera y última fila y de los bordes. Anillo doble por dentro (`outline-offset: -3px` y sombra interior).
3. **`forced-colors`: el texto seleccionado desaparecía** (pestañas, segmentos, capas del mapa, «Ver el tiempo»): Chrome pinta un fondo `Canvas` tras el texto, que con `HighlightText` quedaba blanco sobre blanco. Con `forced-color-adjust: none` y colores de sistema se lee.
4. **`forced-colors`: las bandas de vías no se veían**: Chrome deja `background-image: none`. Cada tipo conserva su patrón (macizo, rayas verticales, horizontales, puntos, diagonal) con `forced-color-adjust: none` y solo `CanvasText`/`Canvas`.
5. **`forced-colors`: la marca de sendero perdía su mitad blanca** sobre un `Canvas` claro y el menú pintaba la marca (borde transparente) en todos los enlaces: marco `CanvasText` y `forced-color-adjust: none` en la marca; los iconos de zoom y brújula quedaban blancos sobre blanco por el filtro del tema oscuro: `filter: none` (MapLibre ya trae iconos claros y oscuros según el esquema del sistema).
Además, para lo que solo se distinguía por fondo: insignias por el trazo del borde (macizo grueso, discontinuo, punteado, doble), filas y tarjetas marcadas con `Highlight`, campos con error con borde doble, indicador de carga por el trazo (arco continuo sobre aro punteado). Todo en un bloque `@media (forced-colors: active)` al final de `styles.css`, con los dos que ya había.

No son hallazgos: `<select>` del filtro de la biblioteca dentro de `<details>` cerrado (no es enfocable, correcto); el perfil de altitud SVG conserva su fondo oscuro en `forced-colors` y su texto sigue legible (T3). **Lo que no se ha podido ver:** `forced-colors` en Windows real (solo la emulación de Chrome, cuyo `GrayText` es un rojo muy oscuro: por eso el indicador de carga se distingue por trazo y no por color); el lector de pantalla y el tamaño de 29 px de los botones de zoom siguen en H7.

Tamaños (gzip, `pnpm build`): CSS principal 9 131 B (T7: 8 606) y JS principal 263 595 B (sin cambio); frente a T1 (7 932 y 262 856): +1,2 kB y +0,74 kB.
