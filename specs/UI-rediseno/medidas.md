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
