# PoC · Prueba técnica del motor de rutas — Plan

Estado: **aprobado por el usuario (2026-11-01)**, con las recomendaciones de P1–P6 aceptadas y los pares de P3 sustituidos por los que indicó el usuario · Rama: `poc/motor-rutas` (creada desde `main` con H2 fusionado, commit de fusión 7da5717) · Fuente: doc 04 §7 (motor de rutas, §7.3 la prueba), doc 07 H3 («Antes de empezar»: prueba técnica cerrada) y §6 (qué bloquea qué), doc 01 R-01, R-02, R-12 y R-14 · No es un hito de v1: no tiene operaciones, contrato, migraciones ni cambios en `apps/`. Es una medición aislada que **desbloquea H3**.

## 0. Decisiones para el usuario

Huecos que los documentos no cierran. Cada una lleva mi recomendación (la primera) y la alternativa descartada.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| P1 | **¿Se mide también R-06 (AEMET)?** El estado y el doc 03 §9 (cautela 1) piden contrastar Open-Meteo con los valores de cimas de AEMET «durante unas semanas». No es «unos pocos días» y **no bloquea H3**: Open-Meteo ya está en producción desde H1 | **No: R-01 aquí y R-06 aparte**, en otra rama pequeña y sin prisa. Esta prueba se queda en lo que bloquea H3 | Meterlo todo en `poc/motor-rutas`: el PoC se alarga semanas y retrasa H3 por algo que no lo necesita |
| P2 | **Herramientas y datos nuevos** (regla 12 de la constitución: dependencia nueva = aprobación explícita). Hacen falta las imágenes de Docker de **GraphHopper** y **Valhalla**, la herramienta de recorte de OSM (`osmium-tool`) y un extracto OSM (`.pbf`, ODbL) de los Pirineos de Geofabrik | Aprobarlas **solo para el PoC**: viven en `poc/motor-rutas/` con su propio compose, **fuera** de `compose.yml`, del workspace de pnpm y del CI; imágenes con versión y huella fijadas; licencias (GraphHopper y Valhalla) comprobadas en T1 antes de usarlas. Nada de esto entra en la pila hasta que H3 se planifique con el motor elegido | Instalarlas en la máquina sin contenedor: menos reproducible y ensucia el equipo |
| P3 | **Los «3 pares reales de los Pirineos»** frente a la regla 10 (cero datos reales). Los pares son coordenadas de **lugares públicos** (cimas, refugios, inicios de sendero), no datos de personas ni tracks de terceros | Aceptar: las coordenadas las fijamos nosotros a partir de OSM; **no se importa ningún track público con autor** (como en H2, P2). **Pares fijados por el usuario (2026-11-01), con las coordenadas exactas tomadas de OSM en T1:** **1** Refugio de Coronas → Aneto; **2** Parking de Bujaruelo → Brecha de Rolando; **3** Parking de Ordesa → Monte Perdido. **Ojo:** el doc 04 §7.3 pide «uno a cada lado de la frontera y uno que la cruce» y estos tres salen del lado español; la frontera solo entra en juego en el par 2 (la Brecha está sobre ella y el camino desde Bujaruelo puede pasar por el lado francés: se comprueba en T1). El lado francés de OSM (R-02, RF-304) queda poco medido; si en T6 hace falta, se añade un par francés o transfronterizo (por ejemplo Gavarnie → Vignemale) como caso extra, sin cambiar el resto | Pares inventados sobre mapa real: no miden nada fiable en senderos concretos |
| P4 | **Criterios de aceptación.** El doc 04 §7.3 fija 5, pero H3 necesita además tres capacidades que la demostración del doc 07 exige: **zonas a evitar** (RF-507), **ajustar un dibujo a los caminos** (`snapRoute`) y **composición por tipo de vía** (RF-503) | Añadir los tres como criterios 6, 7 y 8 y **anotarlo en el registro de cambios del doc 04**. Los umbrales de §4 son propuestos y quedan fijados al aprobar | Medir solo los 5 originales: el motor podría ganar y luego no poder hacer `snapRoute` ni evitar zonas |
| P5 | **Qué hacemos si ninguno de los dos cumple.** El doc 04 §7.3 admite pgRouting «solo si ambos fallan» y el doc 07 (riesgo de H3) admite entregar el MVP solo con H2 | **Plazo cerrado**: si tras T6 ninguno cumple, **paro y te lo cuento** con el informe; no empiezo pgRouting (construir el grafo a mano es otro proyecto). Decides tú entre pgRouting, relajar criterios o seguir con H2 | Probar pgRouting dentro del PoC sin parar: alarga una prueba de «unos días» sin que lo hayas decidido |
| P6 | **Qué se fusiona a `main`.** Un PoC no es un hito, y `main` solo recibe hitos validados | **Un PR de `poc/motor-rutas` → `main`, con commit de fusión y sin squash, que fusionas tú**: lleva el informe, los pesos del perfil y los casos de regresión, que H3 necesita. No lleva datos pesados (ignorados) ni nada en `apps/` | Dejar la rama sin fusionar: H3 saldría de `main` sin los casos ni el perfil |
| P7 | **Orden de las tareas.** El plan comparaba los dos motores con las mismas pruebas | **Decisión del usuario (2026-11-01): T4 y T5 se hacen primero solo con GraphHopper y luego se decide si Valhalla (T3) hace falta.** Si GraphHopper cumple los 8 criterios (umbrales absolutos, no relativos), el informe dice «GraphHopper cumple; Valhalla no se probó»; si falla alguno, T3 se hace con esa carencia como objetivo | Hacer T3 antes: comparación directa de memoria y tiempo, a costa de horas que quizá no hagan falta |

## 1. Alcance

| Tipo | Identificadores |
|---|---|
| Riesgos | **R-01** (calidad del motor), **R-12/R-14** (memoria del servidor de 8 GB), R-02 (calidad de datos de OSM a cada lado de la frontera) |
| Requisitos que condiciona | RF-501 (varias alternativas, D-04), RF-304 (frontera sin cortes), RF-503 (composición), RF-507 (zonas a evitar); `snapRoute` (dibujar a mano y que se pegue a los caminos, demostración de H3) |
| Operaciones | **Ninguna.** `generateRoutes`, `snapRoute`, `getJob` y las de zonas a evitar son de H3 (`x-milestone: H3`) |
| Invariantes | Ninguna tocada. INV-14 es de H3 |
| Salida | El informe del doc 04 §7.3: **motor elegido**, **pesos del perfil de montaña** y **casos guardados como pruebas automáticas** (doc 07, H3 «Antes de empezar») |

## 2. Qué cambia, por carpeta

| Carpeta | Cambio |
|---|---|
| `poc/motor-rutas/` (nueva) | `compose.yml` propio (GraphHopper y Valhalla, cada uno con tope de memoria), `README.md` (cómo reproducir), perfiles de montaña de cada motor, `cases/*.json` (los 3 pares y los casos de zona a evitar y de ajuste), `run-cases.mjs` (Node 24, sin dependencias: pide al motor, mide y escribe un JSON de resultados), `results/` con los resultados que se conservan |
| `.gitignore` | `poc/motor-rutas/.data/` (el `.pbf`, los grafos y las teselas de elevación): cientos de MB y ODbL, no se versionan |
| `docs/` | Doc 04 §7: nueva §7.6 «Resultado de la prueba técnica» (motor, pesos, cifras), criterios 6–8 y los 3 pares elegidos por el usuario en §7.3 (sustituyen a «uno a cada lado de la frontera y uno que la cruce») y entrada en su registro; §11.1 con la memoria medida. Doc 07: §6 («Prueba técnica del motor» → resuelta) y «Antes de empezar» de H3. Doc 01: estado de R-01. `docs/estado.md` |
| `apps/`, `packages/`, `db/`, `infra/`, `data/seed` | **Sin cambios** |

## 3. Puertos implicados

`RoutingProvider` (doc 04 §3) **no se implementa**. La prueba deja escrito en el informe lo que el puerto necesita para H3: entrada (orígenes, destino, puntos intermedios, polígonos a evitar, perfil) y salida (alternativas con geometría, distancia, tiempo y **tipo de vía y firme por tramo**). La implementación es de H3.

## 4. Cómo se mide

Mismos datos y mismas preguntas para los dos motores: **un extracto OSM de los Pirineos (España y Francia) recortado una sola vez**, los 3 pares de P3 y las mismas métricas. Los umbrales son propuestos (P4) y se fijan al aprobar el plan.

| # | Criterio (doc 04 §7.3, 1–5; 6–8 añadidos por P4) | Cómo se comprueba | Umbral propuesto |
|---|---|---|---|
| 1 | Al menos 2 alternativas razonablemente distintas por par (D-04: pueden compartir tramos) | Solapamiento de longitud de cada alternativa con la principal | ≥ 2 por par, y la segunda comparte **≤ 70 %** de su longitud con la primera |
| 2 | Prefiere senderos y pistas marcados frente a carretera cuando el destino está en montaña | Composición (`road`/`track`/`path`) desde el inicio del sendero hasta el destino | **≥ 90 %** de esa parte en `track`/`path`; la carretera, solo hasta el inicio del sendero |
| 3 | Evita pendientes extremas configurables | Mismo par con dos valores del límite: la ruta cambia. Pendiente máxima medida con **nuestra** medición (`packages/geo` + `ElevationProvider`, ventana de 60 m, doc 04 §7.4), no con la del motor | Con el límite bajo, la pendiente máxima medida baja y no pasa del límite salvo si no hay otra salida (y entonces avisa) |
| 4 | Calcula en pocos segundos con el extracto cargado | Tiempo de respuesta tras calentar, 10 repeticiones por par | **p95 ≤ 5 s** |
| 5 | Funciona dentro del presupuesto de memoria (doc 04 §11.1: el motor, 1–2 GB estimados) | Pico de memoria del contenedor durante la carga y durante las consultas | **≤ 2 GB** de pico en consulta; se anota también el de carga |
| 6 | Zonas a evitar (RF-507) | Un polígono sobre la ruta principal: la nueva ruta no lo cruza | 0 cruces, o `NO_ROUTE_POSSIBLE` limpio si no hay salida |
| 7 | Ajustar un dibujo a los caminos (`snapRoute`) | Una polilínea tosca (a ±30 m de un sendero) se pega al sendero | La ruta ajustada queda a ≤ 10 m de la red y conserva el orden de los puntos |
| 8 | Composición por tipo de vía (RF-503) | El motor devuelve el tipo de vía y el firme por tramo, mapeables a `road`/`track`/`path` | Suma 100 % de la longitud, sin «desconocido» salvo tramos justificados |

## 5. Decisiones de diseño (sin necesitar respuesta)

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-PoC-01 | Las **pendientes se juzgan con nuestra medición**, no con la del motor. El motor puede usar otra fuente de altitud para su grafo (SRTM, teselas públicas); lo que se evalúa es lo que el producto mostraría (regla 6 y R-07) | Fiarse de la altitud que devuelva el motor: dos fuentes que pueden discrepar |
| D-PoC-02 | **Mismo extracto, mismos pares, misma máquina** y cada motor con su tope de memoria; se anotan versiones, huellas de imagen y fecha del extracto | Comparar con configuraciones distintas: no es una medición |
| D-PoC-03 | El perfil de montaña se ajusta **a mano y se documenta cada peso** (GraphHopper: *custom model*; Valhalla: costing peatonal con sus opciones de pendiente, pistas y dificultad). Los nombres exactos de las opciones se comprueban en la documentación de la versión fijada | Perfil por defecto de cada motor: no mide el caso de montaña |
| D-PoC-04 | Los **casos quedan como JSON ejecutable** (`cases/`) con la respuesta esperada en términos de criterios, no de geometrías exactas: así sirven de regresión aunque se actualice el extracto | Guardar las rutas devueltas como «correctas»: se rompen con cada actualización de OSM |
| D-PoC-05 | Sin datos personales ni de terceros: solo coordenadas de topónimos públicos; los extractos y grafos fuera del repositorio | Versionar el `.pbf`: pesado y ODbL |

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Descargas grandes** (extractos de España y Francia de Geofabrik; tamaño a verificar) | Descargar por **región** (Aragón, Cataluña, Navarra, Nueva Aquitania, Occitania) y recortar con `osmium` al cuadro de los Pirineos; avisar antes de bajar nada por encima de unos GB |
| **Memoria**: el equipo de desarrollo tiene 15 GB, el servidor previsto 8 | Cada motor en su contenedor con `mem_limit`; el criterio 5 se mide con ese tope, no con la memoria libre |
| **Datos de OSM desiguales entre países** (R-02) | Solo el par 2 roza la frontera; se anota en el informe qué cobertura queda sin medir y, si T6 lo pide, se añade un par francés (P3) |
| **Los dos motores fallan** | P5: paro y consulto; plan B documentado en el doc 07 (MVP con H2) |
| **Plazo**: «unos pocos días» (doc 04) | Tareas pequeñas y un corte duro tras T6 |
| **Licencias** | Se comprueban en T1 antes de usar nada y se anotan en el doc 04 (hoy figuran «a verificar») |

## 7. Verificación

- El **criterio de salida** no son pruebas de `apps/` sino el informe y los casos: `node poc/motor-rutas/run-cases.mjs` contra cada motor levantado con `docker compose -f poc/motor-rutas/compose.yml up --wait`, con una tabla criterio × motor × par, repetible desde un clon limpio (los datos se bajan con un script).
- Lo existente no debe romperse: `pnpm lint`, `pnpm format:check` y `pnpm typecheck` en verde (`poc/` fuera del workspace; si Prettier toca sus JSON o Markdown, se ajustan). El CI no cambia.
- Sin vista de interfaz ni E2E: no hay UI. La visualización de rutas, si hace falta, se hace sobre el mapa existente con una ruta cargada a mano, sin tocar código.

## 8. Tareas previstas (borrador; se detallan en `tasks.md` tras la aprobación)

1. **T1 · Datos y casos:** licencias de GraphHopper, Valhalla y `osmium`; extracto de los Pirineos recortado; los 3 pares con coordenadas de OSM; `cases/*.json`; `.gitignore`.
2. **T2 · GraphHopper:** compose, grafo del extracto, perfil de montaña y primera consulta.
3. **T3 · Valhalla:** compose, teselas del extracto, perfil de montaña y primera consulta.
4. **T4 · Corredor de casos:** `run-cases.mjs` con alternativas, composición, tiempo y memoria (criterios 1, 2, 4, 5, 8).
5. **T5 · Pendientes, zonas a evitar y ajuste a caminos** con nuestra medición (criterios 3, 6, 7).
6. **T6 · Comparación y corte:** tabla completa, motor elegido o parada (P5).
7. **T7 · Informe y documentos:** doc 04 §7.6, §7.3 y §11.1; doc 07 §6 y H3; doc 01 R-01; `docs/estado.md`; casos como regresión.

Un commit y un push por tarea, igual que en los hitos. Al terminar: validación con el `reviewer` contra los criterios de §4 y el PR de P6.
