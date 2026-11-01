# PoC · Motor de rutas (R-01)

Prueba técnica aislada que decide el motor de rutas de H3: **GraphHopper frente a Valhalla**, con tres pares reales de los Pirineos. Plan y tareas: `specs/PoC-motor-rutas/`. Criterios: doc 04 §7.3 y plan §4.

Esto **no es parte de la aplicación**: no está en el workspace de pnpm, ni en `compose.yml`, ni en el CI. Los datos pesados viven en `.data/` (ignorado por git).

## Reproducir

```
poc/motor-rutas/scripts/fetch-extract.sh     # baja los extractos regionales (~1,3 GB), comprueba su MD5 y deja .data/pyrenees.osm.pbf + pyrenees.sha256
node poc/motor-rutas/run-cases.mjs --check   # valida cases/*.json
node --test poc/motor-rutas/lib/metrics.test.mjs   # pruebas de las métricas (solapamiento, composición, percentiles); no están en el CI
mkdir -p poc/motor-rutas/.data/{graphhopper,elevation,valhalla} && ln -f poc/motor-rutas/.data/pyrenees.osm.pbf poc/motor-rutas/.data/valhalla/
docker compose -f poc/motor-rutas/compose.yml up --build --wait graphhopper   # GraphHopper en http://127.0.0.1:8989 (T2)
docker compose -f poc/motor-rutas/compose.yml up --wait valhalla               # Valhalla en http://127.0.0.1:8002 (T3); construye las teselas y baja la altitud la primera vez
poc/motor-rutas/scripts/fetch-dem.sh          # 2 teselas Copernicus GLO-30 (85 MB) para la medición propia (T5)
pnpm build                                    # la medición propia importa packages/geo y apps/api ya compilados
node poc/motor-rutas/run-cases.mjs --engine graphhopper|valhalla --runs 10 --out results/<motor>.json   # mide los 8 criterios (T4 y T5)
poc/motor-rutas/scripts/peak-memory.sh onway-poc-graphhopper-1 300             # pico de memoria del contenedor, en MiB (para medir la carga)
docker compose -f poc/motor-rutas/compose.yml down                             # para; .data/ se conserva
```

Necesita Docker (construye `onway-poc-osmium`) y `curl`. Si Geofabrik retira la instantánea fechada, hay que fijar otra en `SNAPSHOT` y los resultados se repiten con el extracto nuevo. Con el mismo `SNAPSHOT` del script y la misma versión de osmium sale el mismo extracto (misma suma SHA-256; comprobado dos veces seguidas). Resultado de la instantánea `261031`: 95 MB, 12,7 M de nodos, 771 000 vías y 11 000 relaciones (viales, barreras y restricciones de giro; caja real -1,98…3,30 / 41,76…43,29), SHA-256 `d479ba4e0dab4539f30b225b3a15b55bb7e4a2178e5e3430efa8c715ad9db706`.

## Datos y licencias (consultado el 2026-11-01)

| Pieza | Versión | Licencia | Fuente |
|---|---|---|---|
| Datos de OpenStreetMap vía Geofabrik | instantánea `261031` (2026-10-31) | ODbL 1.0; atribución «© OpenStreetMap contributors» | `https://download.geofabrik.de/` (siete regiones: Navarra, Aragón, Cataluña, Andorra, Aquitania, Midi-Pyrénées y Languedoc-Roussillon) |
| GraphHopper | 11.1 (publicada el 2026-09-29) | Apache-2.0 | `https://github.com/graphhopper/graphhopper/blob/master/LICENSE.txt`; `graphhopper-web-11.1.jar`, SHA-256 `8462f758d9ea49edaded557cec5c687a0a24f004ec371cd4daaeb0534824ea33` (T2) |
| Valhalla | 3.9.1 (publicada el 2026-10-06) | MIT (el `LICENSE.md` remite a `COPYING`, que es la MIT) | `https://github.com/valhalla/valhalla/blob/master/COPYING` (T3) |
| osmium-tool | 1.15.0 (paquete de Debian bookworm; la última de upstream es la 1.19.0) | GPL-3.0 (libosmium, BSL-1.0) | `https://github.com/osmcode/osmium-tool/blob/master/LICENSE.txt` |
| Teselas de altitud Skadi («Terrain Tiles» de AWS Open Data; las baja GraphHopper y Valhalla solo para sus pesos de pendiente) | datos públicos (SRTM, GMTED y otras fuentes que citan en su ficha) | las condiciones de cada fuente figuran en la ficha del conjunto de datos de AWS | `https://registry.opendata.aws/terrain-tiles/` (consultar antes de usarlas fuera de la prueba) |
| Copernicus DEM GLO-30 (2 teselas en `.data/dem/`, solo para la medición propia) | tal como en el documento 04 §9.0 | «© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved» | `https://copernicus-dem-30m.s3.amazonaws.com/` |

- Las imágenes se fijan por huella (`@sha256:`). La de `osmium` (base `debian:bookworm-slim`) ya lo está en `docker/osmium/Dockerfile`; las de GraphHopper y Valhalla se fijan en T2 y T3, que son quienes las usan.
- El código de los motores no se copia al repositorio: solo se ejecutan en contenedores locales. Nada de esto entra en la aplicación hasta que H3 se planifique con el motor elegido.

## Casos (`cases/pairs.json`)

Tres pares fijados por el usuario el 2026-11-01. Las coordenadas son las de los objetos de OSM indicados (centro del objeto si es un área), tomadas de la instantánea `261031`:

| Par | Origen | Destino | Nota |
|---|---|---|---|
| `coronas-aneto` | Refugio de Coronas (`way/374407667`, 1965 m) | Aneto (`node/4252339778`, 3404 m, «Tuca d'Aneto / Maladeta de Corones») | El origen ya es un refugio de montaña: el «inicio del sendero» es el propio origen |
| `bujaruelo-brecha` | Aparcamiento de Bujaruelo (`way/140315162`) | Brèche de Roland (`node/2191612631`, 2807 m) | El destino está sobre la frontera (`touchesBorder`); las rutas principales de los dos motores pasan a 0 m del Puerto de Bujaruelo / Port de Boucharo (`node/668991342`, el collado de la frontera): pasan por el collado de la frontera (`results/rutas-principales.json`; no se comprobó en qué país queda cada tramo) |
| `ordesa-perdido` | Aparcamiento de la Pradera de Ordesa (`way/97212138`) | Monte Perdido (`node/948790896`, 3349 m en OSM) | Ver supuestos |

Supuestos a confirmar con el usuario:

- **«Parking de Ordesa»:** en OSM el único aparcamiento con «Ordesa» en el nombre es el del Centro de Visitantes (`way/97209630`, a unos 8 km por carretera del valle). Se usa el de la **Pradera de Ordesa** (`way/97212138`, final de la carretera y salida habitual hacia Góriz y Monte Perdido), porque el criterio 2 mide el tramo de sendero desde el inicio del sendero. Cambiar de aparcamiento es cambiar tres números en `pairs.json`.
- **Monte Perdido:** el nodo de OSM se llama «Punta de Treserols / Monte Perdido» y lleva `ele=3349`, no los 3355 m oficiales. Es el único pico de esa cima en la instantánea; se usa tal cual (su altitud no entra en el cálculo: la mide el servidor, no OSM).
- Origen y «inicio del sendero» coinciden en los tres pares. La clasificación `road`/`track`/`path` desde ese punto es lo que mide el criterio 2.

## GraphHopper (T2)

- Imagen propia (`docker/graphhopper/Dockerfile`): `graphhopper-web-11.1.jar` con su SHA-256 comprobado por Docker sobre `eclipse-temurin:21-jre`, fijada por huella. El contenedor corre con tu usuario (`POC_UID` y `POC_GID`, 1000 por defecto) para no dejar archivos de root en `.data/`.
- Configuración en `graphhopper/config.yml`: modo flexible (sin CH ni LM, que no admiten alternativas ni modelos por petición), sin autopistas ni vías rápidas en el grafo, y los valores codificados que usa el perfil (`hike_rating`, `road_class`, `average_slope`, `max_slope`, `track_type`, `surface`…). La altitud del grafo viene de las teselas Skadi (datos abiertos de terreno en AWS, `elevation-tiles-prod.s3.amazonaws.com`), que GraphHopper baja solo la primera vez a `.data/elevation/`. Solo alimenta los pesos de pendiente del motor: las pendientes de los resultados se juzgan con la medición de OnWay (D-PoC-01).
- Perfil `mountain` (`graphhopper/mountain.json`): prioridad `foot_priority`; escala SAC (`hike_rating`) ≥ 6 prohibida, 5 a ×0,3 y 4 a ×0,6 (el perfil de a pie por defecto prohíbe desde el 2, que cerraría casi toda la alta montaña); carreteras de coche (primaria, secundaria, terciaria, residencial, sin clasificar, servicio, calle residencial) a ×0,5, de modo que un sendero o pista de longitud parecida gana; velocidades por pendiente como en el `foot_elevation.json` de serie. **Primera pasada: los pesos se ajustan en T5 y T6.**
- Alternativas: se piden por petición con `algorithm=alternative_route`, `alternative_route.max_paths`, `max_share_factor` y `max_weight_factor`, y los tramos con `details=road_class,track_type,hike_rating`.

Primera pasada (3 pares, pesos sin ajustar; no son conclusiones):

| Par | Rutas | Distancia | Subida | Composición (`road_class`) |
|---|---|---|---|---|
| `coronas-aneto` | 1 | 5,6 km | +1418 m | 92 % sendero, 8 % pista |
| `bujaruelo-brecha` | 2 | 9,1 km y 10,9 km | +1629 m y +2121 m | 99 % y 100 % sendero |
| `ordesa-perdido` | 1 | 15,7 km | +2539 m | 80 % sendero, 12 % pista, 7 % vía peatonal, 1 % servicio |

Con `max_paths=3`, `max_share_factor=0.7` y `max_weight_factor=1.6` solo el par 2 devuelve una segunda alternativa; el criterio 1 se mide y se ajusta en T4–T6.

Tiempos y memoria (equipo de desarrollo, 12 núcleos): importar el extracto tarda ~32 s con las teselas ya bajadas (~2 min la primera vez, con la descarga); 1,18 M de nodos y 1,50 M de aristas en el grafo. Pico de memoria del contenedor con `-Xmx2g`: **1907 MiB durante la carga** y 1,85 GiB ya sirviendo, porque la JVM no devuelve el montón; es una primera lectura, no el mínimo: en T4 se mide con montones menores (el criterio 5 pide ≤ 2 GB en consulta).

## Corredor de casos (T4)

`run-cases.mjs --engine graphhopper` pregunta a cada motor los 3 pares (una petición de calentamiento y `--runs` medidas), calcula los criterios del plan §4 y escribe un JSON en `results/`. Las métricas puras viven en `lib/metrics.mjs` (con pruebas en `lib/metrics.test.mjs`) y el adaptador del motor en `lib/graphhopper.mjs`:

- **Solapamiento** (criterio 1): se remuestrea la alternativa cada 25 m y se cuenta qué parte queda a ≤ 15 m de la ruta principal.
- **Composición** (criterios 2 y 8): la longitud de cada tramo `road_class` se reparte en `road` (carreteras de coche), `track` (pistas y caminos de herradura) y `path` (senderos, vías peatonales, escaleras). Lo que no encaja es `unknown` y debe ser ≤ 2 %.
- **Tiempo** (criterio 4): p95 de `--runs` peticiones tras calentar, en segundos, medido en el cliente.
- **Memoria** (criterio 5): pico de `docker stats` del contenedor durante las consultas (la carga se mide aparte con `scripts/peak-memory.sh`).

Primera medición de GraphHopper (`results/graphhopper-t4-xmx2g.json`, pesos y parámetros de alternativas sin ajustar, `-Xmx2g`):

| Criterio | `coronas-aneto` | `bujaruelo-brecha` | `ordesa-perdido` |
|---|---|---|---|
| 1 · ≥ 2 alternativas, la segunda comparte ≤ 70 % | **FALLA** (1 ruta) | cumple (2 rutas) | **FALLA** (1 ruta) |
| 2 · ≥ 90 % en pista o sendero | cumple | cumple | cumple |
| 4 · p95 ≤ 5 s | cumple (0,01 s) | cumple (0,03 s) | cumple (0,01 s) |
| 8 · composición sin «desconocido» (≤ 2 %) | cumple | cumple | cumple |

Memoria (criterio 5): **563–588 MiB de pico en consulta** (cumple, tope 2048), tras una carga que llegó a 1907 MiB con el mismo montón. El tiempo, de milisegundos, es tan holgado que no será un factor de decisión.

El resultado importante es el criterio 1: en dos de los tres pares solo sale una ruta con `max_paths=3`, `max_share_factor=0.7` y `max_weight_factor=1.6`. Hay que ver en T5/T6 si es una limitación del terreno (un solo valle de subida, RF-501 pide alternativas «cuando el terreno lo permita») o de los parámetros.

## Pendientes, zonas a evitar y ajuste a caminos (T5)

Se añaden al corredor los criterios 3, 6 y 7. Las pendientes y los desniveles se miden con **la medición de OnWay** (`lib/ours.mjs` importa `prepareLine` y `computeMetrics` de `@onway/geo` y el lector de GLO-30 de `apps/api`, ya compilados; sin código nuevo en `apps/` ni en `packages/`), nunca con la altitud del motor. La altitud de GraphHopper (Skadi) discrepa de la nuestra, y no por contar otra cosa: **los dos medimos el desnivel acumulado** (la suma de todos los tramos de subida, incluida una bajada intermedia que obliga a subir más), no el desnivel neto de A a B. Descenso de 100 m y luego subida a 1500 m desde 1000 m cuenta 600 m de subida acumulada en los dos. El neto es `subida − bajada` y se comprueba solo. La diferencia viene de dos causas que se separan así (`scripts/compare-elevation.mjs`, mismas rutas del motor):

| Par | Subida que dice GraphHopper | …con su altitud y nuestro algoritmo | …con nuestra altitud y nuestro algoritmo | Neto de A a B (GraphHopper / OnWay) |
|---|---|---|---|---|
| `coronas-aneto` | 1418 m | 1401 m | 1408 m | 1395 / 1407 m |
| `bujaruelo-brecha` | 1629 m | 1470 m | 1462 m | 1439 / 1450 m |
| `ordesa-perdido` | 2539 m | 2175 m | 2032 m | 1781 / 2001 m |

- **El algoritmo** (la mayor parte): GraphHopper suma todas las subidas entre vértices sin filtro, así que cada pequeño rizado de la altitud engorda la subida y también la bajada (en `ordesa-perdido` da 758 m de bajada en una ruta que solo sube; nosotros 34 m). OnWay remuestrea cada 30 m, aplica mediana de 3 y descarta variaciones de menos de 3 m (R-07). Con nuestro algoritmo sobre la altitud de GraphHopper, la subida de `ordesa-perdido` baja de 2539 a 2175 m.
- **La fuente de altitud** (el resto, solo notable en el cañón de Ordesa): en el aparcamiento de la Pradera de Ordesa, Skadi da 1535 m y GLO-30 1314 m. Hasta donde sé la Pradera está a unos 1300 m (no lo he contrastado con otra fuente en esta sesión), así que Skadi suaviza la pared del cañón y sube el fondo del valle unos 220 m. Por eso el neto de ese par sale 1781 m en GraphHopper y 2001 m en OnWay.
- La coherencia interna se cumple en los dos: `subida − bajada` es igual al neto (OnWay: 2032 − 34 ≈ 2001).

Resultado (`results/graphhopper.json`, `-Xmx2g`, parámetros `max_paths=3`, `max_share_factor=0.8`, `max_weight_factor=2.5`):

| Criterio | `coronas-aneto` | `bujaruelo-brecha` | `ordesa-perdido` |
|---|---|---|---|
| 1 · ≥ 2 alternativas, comparten ≤ 70 % | cumple (2: ambas nativas) | cumple (2: ambas nativas) | cumple (2: **una por bloqueo**) |
| 2 · ≥ 90 % en pista o sendero | cumple | cumple | cumple |
| 4 · p95 ≤ 5 s | cumple (11 ms) | cumple (11 ms) | cumple (43 ms) |
| 6 · zona a evitar (cuadrado de 200 m en medio de la ruta) | evitada, +14,2 km | evitada, +1,9 km | evitada, +4,0 km |
| 7 · ajuste de un dibujo burdo (a ~25 m del sendero) | 100 % sobre la red, orden conservado | 99 %, orden conservado | 98 %, orden conservado |
| 8 · composición sin «desconocido» | cumple | cumple | cumple |

Memoria (criterio 5): **1198 MiB de pico en consulta** (tope 2048; la medición de T4 dio 588 MiB, `results/graphhopper-t4-xmx2g.json`: el montón de la JVM crece con las consultas y es un muestreo a 1 Hz, no una cota). Criterio 3 (sonda `bujaruelo-goriz`): el límite de 25 % cambia la ruta y baja la pendiente máxima medida de **97,8 % a 44,9 %**, con un umbral relativo (≤ 0,7 × la inicial) que fijé en T5 sin que figurara en el plan; el literal del plan (no pasar del límite, y avisar) **no se cumple**: 44,9 % supera el 25 %.

Lo que este resultado **no** dice, para que nadie lo lea de más:

- **Criterio 1, `ordesa-perdido`:** la búsqueda de alternativas de GraphHopper no devuelve ninguna con ningún parámetro probado (hasta `max_weight_factor=8`), aunque existe un rodeo de 19,7 km que comparte el 24 % con la ruta principal. Cumple solo con la estrategia de `proposeRoutes`: bloquear 200 m en medio de la ruta principal y volver a preguntar. Esa lógica sería del servidor en H3.
- **Criterio 3:** en los tres pares el límite casi no cambia la ruta (la subida final es inevitable) y en `coronas-aneto` no mejoró (67,1 % → 68,7 % con el límite de 25 %), porque el motor juzga la pendiente con su propia altitud. La sonda `bujaruelo-goriz` **se eligió después de explorar**: es un par donde existe un rodeo más suave (22,5 km frente a 29,9 km). Demuestra que el mecanismo funciona, no que mejore las rutas del usuario. Para H3 conviene alimentar el motor con el mismo modelo digital que usa OnWay (GLO-30), no con Skadi.
- **Criterio 6:** si el polígono corta el único camino, el motor responde «Connection between locations not found» (un `NO_ROUTE_POSSIBLE` limpio), como pasó al bloquear el último cuarto de `coronas-aneto`.
- **Criterio 7:** `/match` ajusta bien un dibujo burdo y ordenado, pero se probó con dibujos hechos a partir de la propia ruta del motor (mismo grafo), que es el caso favorable; no se probó con un dibujo a mano real.
- Solo tres pares, todos con el origen en el lado español y del Pirineo central. `bujaruelo-brecha` cruza el collado de la frontera, pero ningún par tiene origen y destino en países distintos (RF-304, la demostración de H3 pide «un origen a cada lado»). El lado francés de OSM se midió después con un par extra (T6).
- Los números de memoria son un muestreo de `docker stats` a 1 Hz: lo observado, no una cota; la carga simultánea no se midió.

## Valhalla (T3, por decisión del usuario tras ver que GraphHopper cumplía)

- **Imagen:** `ghcr.io/valhalla/valhalla-scripted:3.9.1`, la que documenta el propio proyecto (`docker/README.md` de su repositorio), fijada por huella `sha256:6238809f…`. Construye los teselas del extracto y baja la altitud (las mismas teselas Skadi que GraphHopper) en la primera arrancada: ~1 min y 150 teselas de grafo (286 MB en un `.tar`). Se apagan las bases de administración y de zonas horarias (necesitan relaciones de frontera y una descarga, y caminar no las usa) y la configuración de velocidades remota.
- **Perfil:** costing `pedestrian` con `max_hiking_difficulty: 4` (el valor por defecto, 1, prohibiría casi todo sendero de montaña), `use_tracks: 1` y `use_hills: 0.5`. Se fijan esos cuatro (con `step_penalty: 0`); Valhalla documenta unas 16 opciones de peatón (`walkway_factor`, `sidewalk_factor`, `alley_factor`, `driveway_factor`, `service_factor`, `service_penalty`…), pero **no hay pendiente máxima**, ni pesos por nivel SAC (solo un máximo), ni forma de penalizar las carreteras `unclassified` o `secondary`, como sí permite el *custom model* de GraphHopper. Se probaron `service_factor`, `service_penalty`, `driveway_factor`, `alley_factor` y `use_hills` en el par francés y la composición no cambió de forma apreciable. Este perfil no está tan afinado como el de GraphHopper. El criterio 3 se mide moviendo `use_hills` entre 1 (indiferente) y 0 (evitar cuestas).
- **Diferencias de uso:** `/route` no devuelve el tipo de vía por tramo, así que cada ruta necesita una segunda llamada a `/trace_attributes` para la composición; las zonas a evitar son `exclude_polygons` y el ajuste a caminos es `/trace_route` con `shape_match: map_snap`.

Resultado con el mismo corredor (`results/valhalla.json`): **cumple 7 de los 8 criterios sobre los tres pares; el 3 solo en la sonda**, igual que GraphHopper, y con más matices:

- Criterio 1: sus alternativas propias (`alternates: 2`) no aportaron ninguna ruta suficientemente distinta en ningún par; las tres segundas rutas vienen de la estrategia de bloqueo.
- Criterio 3: no hay límite de pendiente; baja la pendiente máxima medida de 71,1 % a 45,5 % al pasar `use_hills` de 1 a 0 en la sonda.
- Criterio 6: los rodeos salen *negativos* en dos pares (−2,5 y −2,7 km): su ruta principal no es la más corta, porque optimiza un coste con penalización de cuestas, y bloquear su tramo medio da una ruta más corta.

### Comparación (mismos pares, mismos criterios, misma máquina)

| | GraphHopper 11.1 | Valhalla 3.9.1 |
|---|---|---|
| Criterios cumplidos (tres pares) | 7 de 8; el 3 solo en la sonda | 7 de 8; el 3 solo en la sonda |
| 1 · segunda alternativa | nativa en 2 pares; por bloqueo en `ordesa-perdido` | por bloqueo en los 3 pares |
| 3 · pendiente (sonda) | 97,8 % → 44,9 % con límite de 25 % | 71,1 % → 45,5 % con `use_hills` 1 → 0 |
| 4 · p95 | 47–137 ms | 36–105 ms |
| 5 · memoria sirviendo (pico) | 588–1198 MiB (JVM con `-Xmx2g`, según la pasada) | 705–715 MiB |
| 5 · memoria al cargar (pico) | 1907 MiB | 2569 MiB (8 hilos, tope de 3 GB) |
| 6 · rodeo por zona evitada | +14,2 / +1,9 / +4,0 km | −2,5 / +1,2 / −2,7 km |
| 7 · ajuste a la red | 98–100 % | 99–100 % |
| Grafo en disco | 190 MB | 286 MB (+ altitud) |
| Ruta principal, medida con OnWay | `coronas-aneto` 5,3 km, +1408 m, 67 % máx.; `bujaruelo-brecha` 8,7 km, +1462 m, 55 %; `ordesa-perdido` 14,9 km, +2032 m, 97 % | 7,7 km, +1593/−189 m, 73 %; 8,8 km, +1469 m, 52 %; 18,9 km, +2248/−247 m, 93 % |

Cómo leerlo:

- **Las dos cumplen**; la diferencia no está en pasar o no pasar, sino en cuánto control da cada una. GraphHopper escribe reglas por dificultad SAC (cada nivel con su peso), tipo de vía y pendiente; Valhalla documenta unas 16 opciones de peatón (`walkway_factor`, `alley_factor`, `driveway_factor`, `service_factor`, `use_tracks`, `use_hills`, `max_hiking_difficulty`…), pero ninguna pendiente máxima, ningún peso por nivel SAC (solo un máximo) y ninguna forma de penalizar las carreteras `unclassified` o `secondary` (probado con el par francés).
- **Las rutas principales de Valhalla son más largas** en dos de los tres pares (7,7 frente a 5,3 km y 18,9 frente a 14,9 km, con más subida y con bajadas que GraphHopper no hace). No se puede decir cuál es «mejor» sin que alguien que conozca esas rutas las mire; el perfil de GraphHopper está ajustado a mano y el de Valhalla solo con cuatro parámetros fijados, así que la comparación no es entre perfiles igual de afinados.
- **Memoria:** Valhalla sirve con menos (~700 MiB) y carga con más (2,5 GiB); la carga es un paso que se puede hacer fuera del servidor y copiar el grafo, así que pesa menos que lo que ocupa sirviendo. GraphHopper con `-Xmx2g` está dentro del tope en ambos momentos.
- **Lo que no se midió:** el lado francés, el comportamiento con muchas peticiones a la vez, ni una comparación a ciegas de qué ruta prefiere un rescatista.

## Par extra del lado francés y veredicto (T6)

`cases/extra-france.json` (Aparcamiento de Gavarnie → Vignemale, `--pairs extra-france.json`) mide el lado francés de OSM, que los tres pares del usuario no tocan. No forma parte de la aceptación. GraphHopper cumple todo (2 rutas, 97,2 % en pista o sendero); Valhalla **falla el criterio 2** (30,5 % de la ruta principal por carretera). La propuesta de motor, el veredicto por criterio y las condiciones para H3 están en `results/veredicto.md`.

## El motor con el DEM de OnWay (H3-T1)

`pnpm --filter @onway/api build-hgt` (con `ELEVATION_DEM_DIR=<teselas GLO-30>` y un directorio de salida) convierte las teselas de OnWay al formato que lee GraphHopper: `N42W001.hgt.gz`, 3601 × 3601 muestras de 16 bits en metros, de norte a sur y de oeste a este. Si el directorio de caché de elevación del motor ya trae esos archivos, GraphHopper no descarga nada (lo comprueba `AbstractSRTMElevationProvider` de la v11.1: solo descarga si no existe el archivo). Cada tesela tarda unos 46 s en un equipo de desarrollo.

Resultado con las dos teselas reales de los tres pares (motor con un extracto de 1° de latitud, `results/graphhopper-onway-dem.json`):

| Par | Subida que dice GraphHopper (antes, con Skadi → ahora) | Con nuestro algoritmo (antes → ahora) | Nuestra medición | Neto de A a B (antes → ahora) |
|---|---|---|---|---|
| `coronas-aneto` | 1418 → 1426 m | 1401 → 1408 m | 1408 m | 1395 → 1405 m |
| `bujaruelo-brecha` | 1629 → 1572 m | 1470 → 1465 m | 1462 m | 1439 → 1449 m |
| `ordesa-perdido` | 2539 → 2293 m | 2175 → 2039 m | 2041 m | 1781 → 2001 m |

La altitud del aparcamiento de la Pradera de Ordesa pasa de 1535 m (Skadi) a **1314 m**, igual que la nuestra, y el neto de ese par coincide (2001 m). Con el algoritmo de OnWay, la diferencia entre lo que ve el motor y lo que mide el servidor queda en ≤ 0,5 %.

**Hallazgo sobre el límite de pendiente (criterio 3, texto literal del plan):** GraphHopper guarda `max_slope` en 5 bits (`MaxSlope`, factor 1): toda pendiente de 31 % o más se lee como 31. Un límite por encima de 30 % no puede expresarse (con 31 o más no cambia la ruta) y con uno de 30 % o menos **los tres pares dejan de tener ruta** (`Connection between locations not found`): en cada uno hay algún tramo de 31 % o más. Es el «no hay otra salida» que admite el texto literal del criterio, así que se anota como **cumplido (inevitable)** en los tres pares. Pero lo que mide nuestra medición en esos mismos pares es 55–100 % de pendiente máxima en una ventana de 60 m: un límite de pendiente solo discrimina rutas de pendiente moderada, no el tramo final de una cima. `generateRoutes` no lo expone (el contrato no tiene ese campo).
