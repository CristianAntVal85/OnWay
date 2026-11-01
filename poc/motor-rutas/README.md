# PoC · Motor de rutas (R-01)

Prueba técnica aislada que decide el motor de rutas de H3: **GraphHopper frente a Valhalla**, con tres pares reales de los Pirineos. Plan y tareas: `specs/PoC-motor-rutas/`. Criterios: doc 04 §7.3 y plan §4.

Esto **no es parte de la aplicación**: no está en el workspace de pnpm, ni en `compose.yml`, ni en el CI. Los datos pesados viven en `.data/` (ignorado por git).

## Reproducir

```
poc/motor-rutas/scripts/fetch-extract.sh     # baja los extractos regionales (~1,3 GB), comprueba su MD5 y deja .data/pyrenees.osm.pbf + pyrenees.sha256
node poc/motor-rutas/run-cases.mjs --check   # valida cases/*.json
node --test poc/motor-rutas/lib/metrics.test.mjs   # pruebas de las métricas (solapamiento, composición, percentiles); no están en el CI
mkdir -p poc/motor-rutas/.data/{graphhopper,elevation}
docker compose -f poc/motor-rutas/compose.yml up --build --wait graphhopper   # GraphHopper en http://127.0.0.1:8989 (T2)
poc/motor-rutas/scripts/fetch-dem.sh          # 2 teselas Copernicus GLO-30 (85 MB) para la medición propia (T5)
pnpm build                                    # la medición propia importa packages/geo y apps/api ya compilados
node poc/motor-rutas/run-cases.mjs --engine graphhopper --runs 10 --out results/graphhopper.json   # mide los 8 criterios (T4 y T5)
poc/motor-rutas/scripts/peak-memory.sh onway-poc-graphhopper-1 300             # pico de memoria del contenedor, en MiB (para medir la carga)
docker compose -f poc/motor-rutas/compose.yml down                             # para; .data/ se conserva
```

Necesita Docker (construye `onway-poc-osmium`) y `curl`. Con el mismo `SNAPSHOT` del script y la misma versión de osmium sale el mismo extracto (misma suma SHA-256; comprobado dos veces seguidas). Resultado de la instantánea `261031`: 95 MB, 12,7 M de nodos, 771 000 vías y 11 000 relaciones (viales, barreras y restricciones de giro; caja real -1,98…3,30 / 41,76…43,29), SHA-256 `d479ba4e0dab4539f30b225b3a15b55bb7e4a2178e5e3430efa8c715ad9db706`.

## Datos y licencias (consultado el 2026-11-01)

| Pieza | Versión | Licencia | Fuente |
|---|---|---|---|
| Datos de OpenStreetMap vía Geofabrik | instantánea `261031` (2026-10-31) | ODbL 1.0; atribución «© OpenStreetMap contributors» | `https://download.geofabrik.de/` (siete regiones: Navarra, Aragón, Cataluña, Andorra, Aquitania, Midi-Pyrénées y Languedoc-Roussillon) |
| GraphHopper | 11.1 (publicada el 2026-09-29) | Apache-2.0 | `https://github.com/graphhopper/graphhopper/blob/master/LICENSE.txt`; `graphhopper-web-11.1.jar`, SHA-256 `8462f758d9ea49edaded557cec5c687a0a24f004ec371cd4daaeb0534824ea33` (T2) |
| Valhalla | 3.9.1 (publicada el 2026-10-06) | MIT (el `LICENSE.md` remite a `COPYING`, que es la MIT) | `https://github.com/valhalla/valhalla/blob/master/COPYING` (T3) |
| osmium-tool | 1.15.0 (paquete de Debian bookworm; la última de upstream es la 1.19.0) | GPL-3.0 (libosmium, BSL-1.0) | `https://github.com/osmcode/osmium-tool/blob/master/LICENSE.txt` |

- Las imágenes se fijan por huella (`@sha256:`). La de `osmium` (base `debian:bookworm-slim`) ya lo está en `docker/osmium/Dockerfile`; las de GraphHopper y Valhalla se fijan en T2 y T3, que son quienes las usan.
- El código de los motores no se copia al repositorio: solo se ejecutan en contenedores locales. Nada de esto entra en la aplicación hasta que H3 se planifique con el motor elegido.

## Casos (`cases/pairs.json`)

Tres pares fijados por el usuario el 2026-11-01. Las coordenadas son las de los objetos de OSM indicados (centro del objeto si es un área), tomadas de la instantánea `261031`:

| Par | Origen | Destino | Nota |
|---|---|---|---|
| `coronas-aneto` | Refugio de Coronas (`way/374407667`, 1965 m) | Aneto (`node/4252339778`, 3404 m, «Tuca d'Aneto / Maladeta de Corones») | El origen ya es un refugio de montaña: el «inicio del sendero» es el propio origen |
| `bujaruelo-brecha` | Aparcamiento de Bujaruelo (`way/140315162`) | Brèche de Roland (`node/2191612631`, 2807 m) | El destino está sobre la frontera (`touchesBorder`); si el motor pasa por el lado francés se anota en T4 |
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

Se añaden al corredor los criterios 3, 6 y 7. Las pendientes y los desniveles se miden con **la medición de OnWay** (`lib/ours.mjs` importa `prepareLine` y `computeMetrics` de `@onway/geo` y el lector de GLO-30 de `apps/api`, ya compilados; sin código nuevo en `apps/` ni en `packages/`), nunca con la altitud del motor. La altitud de GraphHopper (Skadi) discrepa de la nuestra: en `ordesa-perdido` da +2539 m de subida frente a +2032 m con GLO-30 (+25 %), y en el par 1 y el 2 la diferencia es del 1 % y del 11 %.

Resultado (`results/graphhopper.json`, `-Xmx2g`, parámetros `max_paths=3`, `max_share_factor=0.8`, `max_weight_factor=2.5`):

| Criterio | `coronas-aneto` | `bujaruelo-brecha` | `ordesa-perdido` |
|---|---|---|---|
| 1 · ≥ 2 alternativas, comparten ≤ 70 % | cumple (2: ambas nativas) | cumple (2: ambas nativas) | cumple (2: **una por bloqueo**) |
| 2 · ≥ 90 % en pista o sendero | cumple | cumple | cumple |
| 4 · p95 ≤ 5 s | cumple (11 ms) | cumple (11 ms) | cumple (43 ms) |
| 6 · zona a evitar (cuadrado de 200 m en medio de la ruta) | evitada, +14,2 km | evitada, +1,9 km | evitada, +4,0 km |
| 7 · ajuste de un dibujo burdo (a ~25 m del sendero) | 100 % sobre la red, orden conservado | 99 %, orden conservado | 98 %, orden conservado |
| 8 · composición sin «desconocido» | cumple | cumple | cumple |

Memoria (criterio 5): **1030 MiB de pico en consulta** (tope 2048; en dos pasadas salió 787 y 1030 MiB, porque el montón de la JVM crece con las consultas). Criterio 3 (sonda `bujaruelo-goriz`): el límite de 25 % cambia la ruta y baja la pendiente máxima medida de **97,8 % a 44,9 %**.

Lo que este resultado **no** dice, para que nadie lo lea de más:

- **Criterio 1, `ordesa-perdido`:** la búsqueda de alternativas de GraphHopper no devuelve ninguna con ningún parámetro probado (hasta `max_weight_factor=8`), aunque existe un rodeo de 19,7 km que comparte el 24 % con la ruta principal. Cumple solo con la estrategia de `proposeRoutes`: bloquear 200 m en medio de la ruta principal y volver a preguntar. Esa lógica sería del servidor en H3.
- **Criterio 3:** en los tres pares el límite casi no cambia la ruta (la subida final es inevitable) y en `coronas-aneto` empeoró (de 67,1 % a 72,4 % con el límite de 30 %), porque el motor juzga la pendiente con su propia altitud. La sonda `bujaruelo-goriz` **se eligió después de explorar**: es un par donde existe un rodeo más suave (22,5 km frente a 29,9 km). Demuestra que el mecanismo funciona, no que mejore las rutas del usuario. Para H3 conviene alimentar el motor con el mismo modelo digital que usa OnWay (GLO-30), no con Skadi.
- **Criterio 6:** si el polígono corta el único camino, el motor responde «Connection between locations not found» (un `NO_ROUTE_POSSIBLE` limpio), como pasó al bloquear el último cuarto de `coronas-aneto`.
- **Criterio 7:** `/match` ajusta bien un dibujo burdo y ordenado, pero se probó con dibujos hechos a partir de la propia ruta del motor (mismo grafo), que es el caso favorable; no se probó con un dibujo a mano real.
- Solo tres pares, todos del lado español y del Pirineo central: el lado francés de OSM (R-02, RF-304) sigue sin medirse.
