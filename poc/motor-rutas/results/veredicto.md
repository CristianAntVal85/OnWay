# Prueba técnica del motor de rutas — Veredicto (T6)

Estado: **propuesta, pendiente de decisión del usuario** · Fecha de las mediciones: 2026-11-01 · Plan: `specs/PoC-motor-rutas/plan.md` (§4 criterios, P5 corte, P7 orden) · Datos: `results/graphhopper.json`, `results/valhalla.json`, `results/extra-france-*.json` · Cómo repetirlo: `poc/motor-rutas/README.md`.

## 1. Propuesta

**Motor para H3: GraphHopper 11.1.** Valhalla 3.9.1 queda como plan B documentado (adaptador, perfil y resultados se conservan en esta rama; no se integra en la aplicación).

**P5 (corte): no se activa.** Los dos motores cumplen los 8 criterios sobre los tres pares del usuario; no hace falta pgRouting ni relajar criterios.

## 2. Veredicto por criterio y por motor

Tres pares del usuario (`coronas-aneto`, `bujaruelo-brecha`, `ordesa-perdido`) y la sonda de pendiente. Umbrales del plan §4.

| # | Criterio | GraphHopper 11.1 | Valhalla 3.9.1 |
|---|---|---|---|
| 1 | ≥ 2 alternativas, la segunda comparte ≤ 70 % | **Cumple.** Nativa en 2 pares; en `ordesa-perdido` solo con bloqueo (compartido 43 %, 2 %, 24 %) | **Cumple**, siempre con bloqueo: sus `alternates` no dieron ninguna ruta distinta (compartido 63 %, 40 %, 24 %) |
| 2 | ≥ 90 % en pista o sendero | **Cumple** (100 %, 100 %, 99 %) | **Cumple** (100 %, 100 %, 99 %) |
| 3 | Límite de pendiente configurable | **Cumple en la sonda** `bujaruelo-goriz`: pendiente máxima medida 97,8 % → 44,9 % con límite de 25 %. En los tres pares apenas cambia | **Cumple en la sonda**, sin límite de pendiente: solo `use_hills` 1 → 0 (71,1 % → 45,5 %) |
| 4 | p95 ≤ 5 s | **Cumple** (10–50 ms) | **Cumple** (36–86 ms) |
| 5 | Memoria ≤ 2 GB sirviendo | **Cumple** (787–1136 MiB con `-Xmx2g`). Carga: 1907 MiB | **Cumple** (688–695 MiB). Carga: 2569 MiB (8 hilos) |
| 6 | Zona a evitar | **Cumple**: evitada, rodeos +14,2 / +1,9 / +4,0 km | **Cumple**: evitada; rodeos −2,5 / +1,2 / −2,7 km (su ruta principal no era la más corta) |
| 7 | Ajuste a la red de un dibujo burdo | **Cumple** (98–100 % sobre la red, orden conservado) | **Cumple** (99–100 %, orden conservado) |
| 8 | Composición sin «desconocido» | **Cumple** (0 %) | **Cumple** (0 %) |

### Par extra del lado francés (`cases/extra-france.json`, Gavarnie → Vignemale; no forma parte de la aceptación)

| Criterio | GraphHopper | Valhalla |
|---|---|---|
| 1 | Cumple (nativa + bloqueo, compartido 61 %) | Cumple (nativa + bloqueo, 29 %) |
| 2 · pista o sendero | **Cumple** (97,2 %; 2,8 % carretera) | **Falla** (69,5 %; **30,5 % carretera** en la ruta principal, frente a un 45 % de sendero) |
| 4 · p95 | Cumple (108 ms) | Cumple (325 ms) |
| 6, 7, 8 | Cumple | Cumple |

El inicio de ese par es un aparcamiento del pueblo, no el inicio del sendero, así que el criterio 2 no se aplica del todo bien. Aun así enseña la diferencia: el perfil de a pie de Valhalla camina por la carretera del valle de Ossoue, y solo dispone de `use_tracks` para evitarlo; GraphHopper la penaliza con una regla propia. Con OSM del lado francés, los dos encontraron rutas completas sin tramos desconocidos.

### Rutas principales, medidas con la medición de OnWay (no con la del motor)

| Par | GraphHopper | Valhalla |
|---|---|---|
| `coronas-aneto` | 5,3 km · +1408 m · máx. 67 % | 7,7 km · +1593/−189 m · máx. 73 % |
| `bujaruelo-brecha` | 8,7 km · +1462 m · máx. 55 % | 8,8 km · +1469 m · máx. 52 % |
| `ordesa-perdido` | 14,9 km · +2032 m · máx. 97 % | 18,9 km · +2248/−247 m · máx. 93 % |

## 3. Por qué GraphHopper

1. **Control del perfil.** El *custom model* permite reglas por dificultad SAC, tipo de vía, pendiente y áreas, y se puede enviar por petición. Valhalla solo expone `max_hiking_difficulty`, `use_tracks`, `use_hills` y `step_penalty`, sin pendiente máxima. Para rescate, decidir qué se penaliza es la parte central del producto.
2. **Rutas más directas.** En dos de los tres pares, las principales de Valhalla son un 27–45 % más largas, con más subida y bajadas que no hacen falta. No sé si eso es peor para un rescatista (un perfil menos cuestas puede interesar) pero no es lo que se pidió: el criterio 2 y RF-501 hablan de rutas viables, no de las más suaves.
3. **Menos llamadas por ruta.** GraphHopper devuelve el tipo de vía por tramo en la propia respuesta (`details`); Valhalla necesita una segunda llamada (`trace_attributes`) por cada ruta.
4. **Hallazgo en el lado francés** (par extra): Valhalla falla el criterio 2; GraphHopper no.
5. **Memoria sirviendo dentro del tope**, aunque mayor que la de Valhalla (≈1 GB frente a ≈0,7 GB). Doc 04 §11.1 estimaba 1–2 GB para el motor: se confirma.

A favor de Valhalla, que conviene tener presente: menos memoria sirviendo, un perfil que por defecto ya evita cuestas, ajuste a caminos y exclusión de áreas igual de funcionales, y una imagen oficial lista para usar.

## 4. Condiciones para H3 (lo que esta prueba deja como trabajo, no como resuelto)

1. **El motor debe usar el mismo DEM que OnWay.** Con Skadi, GraphHopper ve el fondo del cañón de Ordesa 220 m más alto y juzga mal las pendientes; el criterio 3 solo se cumplió en una sonda elegida a posteriori. Hay que convertir GLO-30 a un formato que GraphHopper lea (proveedor `hgt` o equivalente) o escribir un proveedor de altitud, y repetir el criterio 3 sobre los tres pares.
2. **Estrategia de alternativas en el servidor.** La búsqueda nativa no devolvió nada en `ordesa-perdido`; `proposeRoutes` (bloquear 200 m en medio de la ruta principal y volver a preguntar) lo resuelve. Es lógica nuestra, con sus pruebas, detrás de `RoutingProvider`.
3. **Pesos del perfil.** `graphhopper/mountain.json` es una primera pasada razonada (SAC ≥ 6 prohibido, 5 ×0,3, 4 ×0,6; carreteras ×0,5). Antes de darlos por buenos, que los revise alguien que conozca esas rutas (el criterio de qué es «mejor» no lo puede dar una medición).
4. **Memoria y arranque.** `-Xmx2g` en un contenedor de ≈3 GB; la carga llegó a 1907 MiB. El grafo puede construirse fuera del servidor y copiarse. Arranque en frío ≈32 s con las teselas ya bajadas.
5. **Mantenimiento del extracto.** El grafo se regenera de la instantánea de Geofabrik; falta decidir cada cuánto y quién lo lanza (H3/H7).
6. **El contrato de `RoutingProvider`** (plan §3): entrada = origen, destino, puntos intermedios (aquí solo se probaron dos puntos), zonas a evitar, perfil; salida = alternativas con geometría, distancia, tiempo y tipo de vía por tramo. GraphHopper cubre todo eso con `details=road_class,track_type,hike_rating`. El desnivel y la altitud **no** se toman del motor (su suma sin filtrar infla la subida y la bajada; README, T5).

## 5. Lo que no se ha medido

- Solo cuatro pares (tres del usuario más uno francés), todos del Pirineo central; ninguna comparación con rutas reales recorridas.
- Puntos intermedios obligatorios (RF-501): no se probaron.
- El criterio 7 se probó con dibujos hechos a partir de la propia ruta del motor (el caso favorable).
- Carga simultánea de peticiones, actualización del extracto y una versión nueva del motor.
- Qué ruta prefiere un rescatista: la medición dice qué cumple, no qué es mejor.
- La sonda de pendiente se eligió después de ver que los tres pares no discriminaban; demuestra el mecanismo, no que mejore tus rutas.

## 6. Decisiones que pido al usuario

1. **¿GraphHopper como motor de H3?** (propuesta) o Valhalla.
2. **El par francés**: lo he medido como caso extra, sin tocar los tres pares que fijaste. ¿Se queda como caso de regresión de H3 (`cases/extra-france.json`)? Recomiendo que sí.
3. **El DEM del motor** (condición 1): ¿lo tratamos como primera tarea de H3? Recomiendo que sí, porque condiciona la calidad de las rutas.
4. **Valhalla**: ¿se conservan su adaptador, su perfil y sus resultados en la rama como plan B? Recomiendo que sí (cuestan poco y documentan la alternativa).
5. **Revisión de los pesos** por una persona que conozca esas rutas (condición 3): ¿cuándo y quién?
