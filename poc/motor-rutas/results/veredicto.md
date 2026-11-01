# Prueba técnica del motor de rutas — Veredicto (T6)

Estado: **propuesta aceptada por el usuario (2026-11-01): GraphHopper 11.1**, tras una primera ronda de correcciones del `reviewer` (T7) · Fecha de las mediciones: 2026-11-01 · Plan: `specs/PoC-motor-rutas/plan.md` (§4 criterios, P5 corte, P7 orden) · Datos: `results/graphhopper.json`, `results/valhalla.json`, `results/extra-france-*.json`, `results/rutas-principales.json`, `results/carga-memoria.json` · Cómo repetirlo: `poc/motor-rutas/README.md`.

## 1. Propuesta

**Motor para H3: GraphHopper 11.1.** Valhalla 3.9.1 queda como plan B documentado (adaptador, perfil y resultados se conservan en esta rama; no se integra en la aplicación).

**P5 (corte): no se activa.** Los dos motores cumplen 7 de los 8 criterios sobre los tres pares del usuario. **El criterio 3 (pendiente) solo se cumple en una sonda elegida a posteriori y con un umbral relativo, no como lo escribe el plan** (ver la fila 3 y §5); por eso el criterio 3 es la primera comprobación de H3. No hace falta pgRouting.

## 2. Veredicto por criterio y por motor

Tres pares del usuario (`coronas-aneto`, `bujaruelo-brecha`, `ordesa-perdido`) y la sonda de pendiente. Umbrales del plan §4.

| # | Criterio | GraphHopper 11.1 | Valhalla 3.9.1 |
|---|---|---|---|
| 1 | ≥ 2 alternativas, la segunda comparte ≤ 70 % | **Cumple.** Nativa en 2 pares; en `ordesa-perdido` solo con bloqueo (compartido 43 %, 2 %, 24 %) | **Cumple**, siempre con bloqueo: sus `alternates` no dieron ninguna ruta distinta (compartido 63 %, 40 %, 24 %) |
| 2 | ≥ 90 % en pista o sendero | **Cumple** (100 %, 100 %, 99 %) | **Cumple** (100 %, 100 %, 99 %) |
| 3 | Pendiente configurable: la pendiente máxima medida baja con el límite y no pasa de él salvo si no hay otra salida (y avisa) | **Solo en la sonda** `bujaruelo-goriz` y con un umbral relativo (baja a ≤ 0,7 × la inicial): 97,8 % → 44,9 % con un límite de 25 %. **No cumple el literal del plan**: 44,9 % supera el 25 % y el aviso no se evalúa. En los tres pares apenas cambia (67,1 → 68,7 %, 54,8 → 53,9 %, 97,1 → 94,1 %) | **Solo en la sonda**, sin límite de pendiente: 71,1 % → 45,5 % moviendo `use_hills` de 1 a 0. En los tres pares no cambia nada |
| 4 | p95 ≤ 5 s | **Cumple** (47, 137 y 77 ms) | **Cumple** (36, 105 y 97 ms) |
| 5 | Memoria ≤ 2 GB sirviendo | **Cumple** (1198 MiB en la medición guardada; una pasada anterior dio 588 MiB y otras hasta ≈1170: el montón de la JVM con `-Xmx2g` crece con las consultas). Carga: 1907 MiB | **Cumple** (705 MiB; 693–715 en las demás). Carga: 2569 MiB (8 hilos) |
| 6 | Zona a evitar (solo cuenta un «no hay camino» limpio como alternativa a esquivarla) | **Cumple**: evitada, rodeos +14,18 / +1,85 / +4,00 km | **Cumple**: evitada; rodeos −2,46 / +1,19 / −2,69 km (su ruta principal no era la más corta) |
| 7 | Ajuste a la red de un dibujo burdo | **Cumple** (100 %, 99 %, 98 % sobre la red, orden conservado) | **Cumple** (100 %, 99 %, 100 %, orden conservado) |
| 8 | Composición sin «desconocido» | **Cumple** (0 %) | **Cumple** (0 %) |

La memoria es un muestreo de `docker stats` a 1 Hz: lo observado, no una cota.

### Par extra del lado francés (`cases/extra-france.json`, Gavarnie → Vignemale; no forma parte de la aceptación)

| Criterio | GraphHopper | Valhalla |
|---|---|---|
| 1 | Cumple (nativa + bloqueo, compartido 61 %) | Cumple (nativa + bloqueo, 29 %) |
| 2 · pista o sendero | **Cumple** (97,2 %; 2,8 % carretera) | **Falla** (69,5 %; **30,5 % carretera** en la ruta principal) |
| 4 · p95 | Cumple (154 ms) | Cumple (380 ms) |
| 6, 7, 8 | Cumple | Cumple |

El inicio de ese par es un aparcamiento del pueblo, no el inicio del sendero, así que el criterio 2 no se aplica del todo bien. Lo que enseña: en Valhalla el 23 % de la ruta es una vía `unclassified` y el 5 % `secondary`, y **ninguna de sus opciones de peatón penaliza esas clases** (se probaron `service_factor`, `service_penalty`, `driveway_factor`, `alley_factor` y `use_hills`: la composición no cambió de forma apreciable). GraphHopper la penaliza con una regla propia.

### Rutas principales, medidas con la medición de OnWay (no con la del motor; `results/rutas-principales.json`)

| Par | GraphHopper | Valhalla |
|---|---|---|
| `coronas-aneto` | 5,3 km · +1408 m · máx. 67 % | 7,7 km · +1593/−189 m · máx. 73 % |
| `bujaruelo-brecha` | 8,7 km · +1462 m · máx. 55 % | 8,8 km · +1469 m · máx. 52 % |
| `ordesa-perdido` | 14,9 km · +2032 m · máx. 97 % | 18,9 km · +2248/−247 m · máx. 93 % |

Las dos rutas principales de `bujaruelo-brecha` pasan **a 0 m del Puerto de Bujaruelo / Port de Boucharo**, el collado de la frontera (`node/668991342`): cruzan al lado francés y llegan a la Brecha, que también está sobre la frontera. Es el único cruce medido (RF-304); ningún par tiene el origen y el destino en países distintos.

## 3. Por qué GraphHopper

1. **Control del perfil.** El *custom model* permite reglas por dificultad SAC (cada nivel con su peso), tipo de vía (incluidas las carreteras sin clasificar, secundarias y terciarias), pendiente y áreas, y se puede enviar por petición. Valhalla tiene unas 16 opciones de peatón documentadas (`walkway_factor`, `sidewalk_factor`, `alley_factor`, `driveway_factor`, `service_factor`, `use_tracks`, `use_hills`, `max_hiking_difficulty`…), pero **no pendiente máxima, ni pesos por nivel SAC (solo un máximo), ni forma de penalizar carreteras `unclassified` o `secondary`**. Para rescate, decidir qué se penaliza es la parte central del producto.
2. **Rutas principales más directas.** En dos de los tres pares, las de Valhalla son un 27–45 % más largas, con más subida y bajadas que no hacen falta. Matiz: la ruta directa existe también en Valhalla (su segunda ruta mide 5,27 km en `coronas-aneto` y 16,29 km en `ordesa-perdido`), pero con su `use_hills: 0,5` por defecto no es la principal. No es una carencia del motor, es su perfil sin afinar; no sé si un perfil con menos cuestas es peor para un rescatista.
3. **Menos llamadas por ruta.** GraphHopper devuelve el tipo de vía por tramo en la propia respuesta (`details`); Valhalla necesita una segunda llamada (`trace_attributes`) por cada ruta.
4. **Lado francés** (par extra): Valhalla falla el criterio 2; GraphHopper no.
5. **Memoria sirviendo dentro del tope**, aunque mayor que la de Valhalla (≈1,2 GiB frente a ≈0,7 GiB). Doc 04 §11.1 estimaba 1–2 GB para el motor: se confirma.

A favor de Valhalla: menos memoria sirviendo, un perfil que por defecto ya evita cuestas, ajuste a caminos y exclusión de áreas igual de funcionales, y una imagen oficial lista para usar. Su perfil está menos afinado que el de GraphHopper (hecho a mano), así que la comparación no es entre perfiles igual de trabajados.

## 4. Condiciones para H3 (lo que esta prueba deja como trabajo, no como resuelto)

1. **El motor debe usar el mismo DEM que OnWay.** Con Skadi, GraphHopper ve el fondo del cañón de Ordesa 220 m más alto y juzga mal las pendientes. Hay que convertir GLO-30 a un formato que GraphHopper lea (proveedor `hgt` o equivalente) o escribir un proveedor de altitud, y **repetir el criterio 3 sobre los tres pares, con el umbral literal del plan**.
2. **Estrategia de alternativas en el servidor.** La búsqueda nativa no devolvió nada en `ordesa-perdido`; `proposeRoutes` (bloquear 200 m en medio de la ruta principal y volver a preguntar) lo resuelve. Es lógica nuestra, con sus pruebas, detrás de `RoutingProvider`.
3. **Pesos del perfil.** `graphhopper/mountain.json` es una primera pasada razonada (SAC ≥ 6 prohibido, 5 ×0,3, 4 ×0,6; carreteras ×0,5). Antes de darlos por buenos, que los revise alguien que conozca esas rutas (el criterio de qué es «mejor» no lo puede dar una medición).
4. **Memoria y arranque.** `-Xmx2g` en un contenedor de ≈3 GB; la carga llegó a 1907 MiB. El grafo puede construirse fuera del servidor y copiarse. Arranque en frío ≈32 s con las teselas ya bajadas.
5. **Mantenimiento del extracto.** El grafo se regenera de una instantánea de Geofabrik; las instantáneas fechadas no se conservan indefinidamente (el script de la prueba puede dejar de funcionar con la `261031`). Falta decidir cada cuánto se regenera y quién lo lanza (H3/H7).
6. **El contrato de `RoutingProvider`** (plan §3): entrada = origen, destino, puntos intermedios (aquí solo se probaron dos puntos), zonas a evitar, perfil; salida = alternativas con geometría, distancia, tiempo y tipo de vía por tramo. GraphHopper cubre todo eso con `details=road_class,track_type,hike_rating`. El desnivel y la altitud **no** se toman del motor (su suma sin filtrar infla la subida y la bajada; README, T5).

## 5. Lo que no se ha medido ni se ha cumplido del todo

- **Criterio 3 (pendiente).** Solo se cumple en una sonda, `bujaruelo-goriz`, que se eligió **después** de ver que los tres pares no discriminaban. El umbral aplicado (la pendiente máxima medida baja a ≤ 0,7 × la inicial; `cases/slope-probe.json`, `maxSlopeRatio`) lo fijé en T5 sin que figurara en el plan; el literal del plan (no pasar del límite salvo si no hay otra salida, y avisar) no se cumple ni se evalúa. Demuestra que el mecanismo funciona, no que mejore las rutas del usuario.
- **Criterio 1, `ordesa-perdido`:** solo con la estrategia de bloqueo; la búsqueda propia de GraphHopper no da una segunda ruta.
- **Frontera (RF-304):** solo `bujaruelo-brecha` toca la frontera. Ningún par tiene origen y destino en países distintos; la demostración de H3 pide «un origen a cada lado».
- Solo cuatro pares (tres del usuario y uno francés), todos del Pirineo central; ninguna comparación con rutas reales recorridas.
- Puntos intermedios obligatorios (RF-501): no se probaron.
- El criterio 7 se probó con dibujos hechos a partir de la propia ruta del motor (el caso favorable).
- Carga simultánea de peticiones, actualización del extracto y una versión nueva del motor.
- Qué ruta prefiere un rescatista: la medición dice qué cumple, no qué es mejor.
- Un clon limpio completo (descarga de ~1,3 GB, reconstrucción de los grafos desde cero) no se repitió de principio a fin.

## 6. Decisiones del usuario (2026-11-01)

1. **GraphHopper como motor de H3:** aceptada.
2. **El par francés:** se queda como caso de regresión de H3 (`cases/extra-france.json`).
3. **El DEM del motor:** primera tarea de H3.
4. **Valhalla:** se conservan su adaptador, su perfil y sus resultados en la rama como plan B.
5. **Quién y cuándo revisa los pesos del perfil (condición 3):** **sin decidir**; anotado como pendiente en `docs/estado.md`, antes de validar H3.
