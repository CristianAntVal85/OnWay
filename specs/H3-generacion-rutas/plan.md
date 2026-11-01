# H3 · Generación automática de rutas — Plan

Estado: **aprobado por el usuario (2026-11-01)**, con las recomendaciones de P1–P6 aceptadas · Rama: `hito/H3-generacion-rutas` (creada desde `main` con la prueba técnica fusionada, commit de fusión d71cc5a) · Fuente: doc 07 §3 (H3), §4 y §6; doc 04 §7.6 (resultado de la prueba técnica) y `poc/motor-rutas/results/veredicto.md` · Tareas: `specs/H3-generacion-rutas/tasks.md`.

## 0. Decisiones para el usuario

Huecos que los documentos no cierran o que cambian el alcance. Cada una lleva mi recomendación (la primera) y la alternativa descartada.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| P1 | **Cola de trabajos.** El doc 04 (AD-08) fija **pg-boss** sobre la propia PostgreSQL. Es una **dependencia npm nueva** (regla 12 de la constitución) y crea su propio esquema `pgboss`; la `api` como `onway_app` no puede crear esquemas, así que lo crearía el migrador (rol `onway_owner`) y se darían permisos a `onway_app` | Aprobar **pg-boss** tal como está en el stack: reintentos, expiración (un trabajo cuyo *worker* muere vuelve a la cola) y un esquema que mantiene la librería. Su API y sus requisitos de permisos se verifican en la primera tarea que lo usa | Cola propia sobre `calculation_jobs` con `SELECT … FOR UPDATE SKIP LOCKED`: sin dependencia ni esquema nuevo, pero hay que escribir a mano reintentos, expiración y limpieza |
| P2 | **Qué red de caminos usan el CI y el E2E.** Los datos reales de OSM son 1,3 GB de descarga: no caben en cada ejecución del CI | **Una red OSM inventada** (`data/seed/network.osm`, sobre el terreno sintético que ya usa el E2E) con el **GraphHopper real**: tan ficticia como el resto de la semilla (regla 10), pequeña, sin ODbL, y prueba el motor de verdad (zonas a evitar, ajuste a caminos, alternativas). El CI gana una imagen de Java y ~1–2 min | Motor *stub* con respuestas fijas (como `providers-stub`): rápido, pero «dibujar una zona y que la ruta la esquive» solo probaría el cableado, no el motor |
| P3 | **Regresión con los casos reales del PoC** (los tres pares y el francés). Exigen el extracto de los Pirineos (1,3 GB de descarga) | Un comando local (`pnpm routing:regression` o equivalente) y un **workflow manual** (`workflow_dispatch`) que descarga el extracto con caché; **no** en cada push. El CI de cada push usa la red inventada (P2) | En cada push con caché de Actions: más cobertura, pero el primer run baja 1,3 GB y el CI pasa de minutos a bastante más |
| P4 | **Datos reales en `docker compose up`.** El motor necesita el extracto de los Pirineos para la demostración real (una misión con un origen a cada lado de la frontera) | `geodata` descarga también los extractos regionales de Geofabrik (~1,3 GB, además de los 843 MB actuales) y el motor construye el grafo la primera vez (~1 min). Si la descarga falla, la pila arranca y «Generar» responde `ROUTING_UNAVAILABLE` (el resto de la app sigue, doc 04 §11.4) | Motor opcional en un perfil de compose, sin datos por defecto: la primera arrancada es más ligera, pero la demostración de H3 exige activarlo a mano |
| P5 | **`addToMission` en `generateRoutes`.** El contrato dice que, si se genera desde una misión, las rutas resultantes **se añaden a ella** (doc 02 §4.3-B); el resto de operaciones con `addToMission` (`createRoute`, `deriveRoute`) siguen rechazadas hasta H4 (D-H2-09) | El trabajo **las añade** a `mission_routes` con la versión 1 (Borrador) fijada, sin más: fijar, validar, no disponible y la vista del rescatista son de H4. INV-14 (origen obligatorio) y `MISSION_CLOSED` se comprueban al lanzar | Solo validar (INV-14) y no añadir hasta H4: coherente con D-H2-09, pero el campo quedaría a medias y «generar desde la misión» no dejaría las rutas en la misión |
| P6 | **Quién revisa los pesos del perfil de montaña** (`mountain.json`), pendiente desde la prueba técnica | Que **tú, o quien conozca esas rutas, mires en el mapa las rutas de la demostración** (las del PoC y las de la semilla) antes de validar H3; la última tarea deja una hoja de revisión con cada peso y por qué | Un revisor externo antes de empezar: más seguro, pero bloquea el hito |

Además, **sin necesitar respuesta** (diseño, con alternativa en §4): el motor recibe el mismo DEM que OnWay (D-H3-02), la estrategia de alternativas vive en el servidor (D-H3-03), los segmentos salen de los detalles del motor (D-H3-04), el *worker* es el mismo código con otra entrada (D-H3-01) y las zonas a evitar viven en la organización con misión opcional (Q-05, ya resuelta en la migración 0005; D-H3-09).

## 1. Alcance

| Tipo | Identificadores |
|---|---|
| Requisitos | **RF-501** (generar), **RF-503** (composición por tipo de vía, ya no «sin clasificar» en lo generado), **RF-507** (zonas a evitar), **RF-304** (rutas a través de la frontera); RF-502 por contacto (métricas de lo generado) |
| Reglas de negocio | **RN-08** (generar desde una misión exige objetivo y al menos un origen), RN-10 (métricas siempre del servidor), RN-05 (auditoría) |
| Invariantes | **INV-14**. Tocadas y por tanto con prueba: INV-01 (por id en `getJob`, zonas y rutas generadas), INV-16 (cada escritura audita), INV-15 (la altitud del motor no llega a las métricas), INV-17 (unidades) |
| Riesgos | **R-01** (calidad del motor), **R-12** (memoria), perfil de montaña (pesos sin revisar), R-02 (calidad de OSM a cada lado de la frontera) |
| Operaciones (`x-milestone: H3`, 6) | `generateRoutes`, `snapRoute`, `getJob`, `listAvoidZones`, `createAvoidZone`, `deleteAvoidZone`. Ninguna operación nueva: el contrato ya las trae en `packages/contracts` |
| Base de datos | Tablas que se usan por primera vez: `calculation_jobs` (0005) y `avoid_zones` (0005). Políticas ya existentes (`jobs_staff`, `zones_staff`; solo el coordinador escribe, 0011). Posible migración **0013** solo para los permisos del esquema de la cola (P1) |
| Vistas | Flujo **Nueva ruta → A) Generar** (doc 02 §3.6) con zonas a evitar y progreso; botón «Generar rutas» en el detalle de la misión (desactivado sin origen, RN-08); **C) Dibujar a mano** ahora «se une siguiendo caminos» (doc 02); composición real (carretera, pista, sendero) en detalle, lista y comparación |
| Fuera | Campo a través (v2.2), adaptar el tramo final (H9), añadir rutas de la biblioteca a la misión (H4), puntos intermedios con ajuste fino más allá de lo que admite el contrato (`via` ≤ 10) |

## 2. Qué cambia, por carpeta

| Carpeta | Cambio |
|---|---|
| `apps/api` | `src/routing/`: puerto **`RoutingProvider`** (token como `ElevationProvider`), adaptador GraphHopper (`route`, alternativas con la estrategia de bloqueo, zonas a evitar, `match`), doble en memoria. `src/jobs/`: cola (pg-boss, P1), repositorio de `calculation_jobs`, `getJob`. `src/worker.ts` + `src/worker/` (segundo punto de entrada; manejador de «generar»). `src/routes/`: `generateRoutes`, `snapRoute`, composición real en `RouteMeasurement`. `src/avoid-zones/`: 3 operaciones. `src/cli/`: **`build-hgt`** (convierte GLO-30 al formato de teselas que lee el motor, D-H3-02). `CURRENT_MILESTONE = 'H3'` |
| `apps/web` | Página **Generar** (formulario, zonas a evitar dibujadas en el mapa, progreso, resultados comparables), acción en el detalle de la misión, **dibujar a mano con ajuste a caminos**, composición en detalle/lista/comparación. Todo el dibujo y la geometría en `src/map/`. i18n `generate`, `avoidZones` (es y fr) |
| `packages/contracts` | Sin operaciones nuevas. Posibles retoques: texto de `notes`, y si hiciera falta un campo de aviso en `Job.result` (se decide al implementar y se regenera OpenAPI y doc 06 en el mismo cambio) |
| `packages/geo` | Reparto de la composición por tramos sobre la línea ya preparada (D-H3-04); puede acoger `nearestSegment`/`simplifyVertices` que hoy están en `apps/web/src/map/edit.ts` (pendiente (j) del reviewer de H2), si se decide moverlos |
| `packages/i18n` | Textos de generación, errores del trabajo (`NO_ROUTE_POSSIBLE`, `OUTSIDE_COVERAGE`, `ROUTING_UNAVAILABLE`, `MISSION_HAS_NO_ORIGIN`) y zonas a evitar |
| `db/` | Pruebas de las políticas existentes para el *worker* (contexto de organización en un proceso sin petición); migración 0013 solo si P1 la exige |
| `infra/` | Servicios **`routing`** (GraphHopper 11.1 con el `.jar` verificado, imagen de Java fijada por huella, `mountain.json` versionado en `infra/routing/`, límite de memoria) y **`worker`** (imagen de la `api`, sin puerto publicado, con comprobación de salud); servicio de un solo uso **`routing-data`** (`build-hgt` + grafo); `geodata` con los extractos de Geofabrik (P4); superposición E2E con la red inventada (P2); `smoke.sh` con la salud del motor y del *worker* |
| `data/seed` | `network.osm` inventada sobre el DEM sintético; misión de demostración con **dos orígenes, uno a cada lado de una «frontera» inventada** (en el E2E) y, con datos reales, la misión de la prueba técnica (Coronas/Bujaruelo/Ordesa); README con el aviso de que la red es inventada |
| `.github/workflows` | El trabajo `stack`/`e2e` levanta también `routing` y `worker`; workflow manual de regresión real (P3) |
| `poc/motor-rutas` | Se queda como referencia: los casos y el corredor siguen siendo la regresión (se importan, no se copian) |

## 3. Puertos implicados

- **`RoutingProvider`** (nuevo, doc 04 §3): entrada = origen, destino, puntos intermedios, zonas a evitar, número de alternativas, perfil; salida = alternativas con geometría, distancia, tiempo del motor (no se muestra, D-03) y **tipo de vía por tramo**. Implementación GraphHopper; doble en memoria para las pruebas del trabajo; errores traducidos a `NO_ROUTE_POSSIBLE`, `OUTSIDE_COVERAGE` y `ROUTING_UNAVAILABLE`.
- **`ElevationProvider`** (existente, H1/H2): lo usa `RouteMeasurement` para medir lo que devuelve el motor; **la altitud, el desnivel y las pendientes del motor no se guardan nunca** (regla 6, INV-15).
- **`Clock`**, **`FileStorage`**: sin cambios.
- **Cola** (pg-boss, P1): detrás de una interfaz propia (`JobQueue`) para poder cambiarla sin tocar el dominio.

## 4. Decisiones (con alternativa descartada)

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-H3-01 | El **worker es el mismo código** que la `api` con otra entrada (`src/worker.ts`), como dice AD-05; un servicio de compose aparte, sin puerto publicado, con comprobación de salud | Un paquete separado: duplica configuración y módulos |
| D-H3-02 | **El motor recibe el DEM de OnWay.** `build-hgt` (en `apps/api`, usando `DemElevationProvider`) escribe teselas de 1° × 1° de 3601 × 3601 muestras en el formato de la caché Skadi de GraphHopper, de modo que este no descarga nada y ve exactamente la altitud que mide OnWay. **Se verifica en T1**: con el DEM propio la altitud del aparcamiento de Ordesa debe acercarse a los 1314 m de OnWay (no a los 1535 m de Skadi) y el criterio 3 se repite sobre los tres pares con el umbral literal del plan | Dejar que GraphHopper use Skadi: el fondo de los cañones sube unos 220 m y juzga mal las pendientes (README del PoC, T5). Escribir un proveedor de altitud en Java: otro lenguaje y otro artefacto |
| D-H3-03 | **La estrategia de alternativas vive en el servidor** (`proposeRoutes` del PoC, ya probada): la búsqueda propia de GraphHopper y, si da menos de las pedidas, bloquear 200 m en medio de la ruta principal y volver a preguntar, aceptando un rodeo si comparte ≤ 70 % con lo ya guardado | Confiar solo en las alternativas del motor: `ordesa-perdido` no daba ninguna |
| D-H3-04 | **Los segmentos salen de los detalles del motor** (`road_class`), repartidos por distancia acumulada sobre la línea **ya preparada** por `prepareLine`, y las métricas por tramo se calculan sobre esa línea con la altitud propia. Un tipo de vía que el motor no mapea queda como `unknown` y se cuenta en la prueba (criterio 8 del PoC) | Pedir un segundo cálculo al motor por tramo (Valhalla necesitaba `trace_attributes`): más llamadas y más puntos de fallo |
| D-H3-05 | **Dos niveles de prueba.** (1) `test:api` con el doble en memoria: lógica del trabajo, INV-14, permisos, aislamiento, reinicio del *worker*, errores. (2) Una suite contra el **motor real** con la red inventada (adaptador, zonas, ajuste, alternativas, casos del PoC adaptados), que corre en el CI en un trabajo propio | Todo contra el motor real: lento y frágil. Todo contra el doble: no probaría el motor |
| D-H3-06 | **`generateRoutes` es idempotente por trabajo**: `route_versions.calculation_job_id` (FK ya existente) permite saber si un reintento ya creó las rutas; el segundo intento devuelve las mismas | Borrar y recrear: viola «las rutas no se borran» |
| D-H3-07 | **Reintentos solo ante fallos del motor** (`ROUTING_UNAVAILABLE`, `INTERNAL`): 2 reintentos con espera creciente; `NO_ROUTE_POSSIBLE` y `OUTSIDE_COVERAGE` son definitivos y se muestran con un mensaje útil | Reintentar siempre: un destino imposible no mejora esperando |
| D-H3-08 | **`snapRoute` es síncrona** (vista previa, no guarda): hasta 50 puntos, una llamada de ajuste (`match`) y la medición propia; responde 422/503 con el mismo formato de error | Convertirla en trabajo: la edición a mano pide respuesta inmediata |
| D-H3-09 | **Zonas a evitar** (Q-05, ya resuelta en la 0005): viven en la organización con misión opcional, las ven y escriben coordinadores (el administrador solo lee, 0011), el rescatista no las ve. Un polígono ≤ 20 por trabajo (contrato). Borrar es real (no hay historial que proteger) y se audita | Zonas dentro de la misión solo: no sirven desde la biblioteca |
| D-H3-10 | **Si la misión se cierra mientras el trabajo corre**, las rutas se guardan en la biblioteca y no se añaden a la misión (la política de `mission_routes` lo impide); el trabajo termina `completed` y el resultado lo refleja con `routeIds` | Fallar el trabajo: se perdería un cálculo válido |

## 5. Riesgos del hito

| Riesgo | Mitigación |
|---|---|
| **El DEM propio no encaja con el motor** (formato, interpolación, huecos): sin él, las pendientes del criterio 3 siguen siendo dudosas | T1 es un *spike* con criterio de salida medible; si no se logra, **paro y consulto** antes de seguir |
| **Memoria**: motor (~1,2 GB sirviendo, 1,9 GB al cargar) + API + *worker* + PostgreSQL dentro de 8 GB (R-12) | T10 mide la pila completa con `docker stats`; límites por servicio; el grafo se puede construir fuera y copiarse |
| **Descarga de 1,3 GB** en la primera arrancada real (P4) | Degradación: si falla, `ROUTING_UNAVAILABLE` y el resto sigue; se documenta el tiempo y el espacio |
| **Pesos del perfil sin revisar** (P6) | Hoja de revisión en T10; el aviso de RF-506 («es una propuesta») ya existe |
| **El motor devuelve rutas por carretera de coche en el lado francés** (R-02; Valhalla lo hacía, GraphHopper no en el par de prueba) | Caso francés como regresión del PoC; el perfil penaliza carreteras ×0,5 y se revisa (P6) |
| **pg-boss y los permisos** (P1): el esquema lo crea el migrador y puede chocar con `onway_app` sin DDL | Verificación temprana en T6; si no encaja, se pregunta (alternativa de P1) |
| **CI más lento** (imagen de Java, grafo, suite del motor) | Trabajo propio para la suite del motor; la caché de Docker del jar; criterio de aceptación: el CI sigue por debajo de lo razonable (se mide en T2) |
| **Datos de OSM (ODbL) en la pila real**: atribución y licencia | Atribución en la interfaz (ya la pide el mapa base) y nota en `data/seed/README.md`; la red del CI es inventada |
| **Cambio de contrato oculto** (p. ej. un campo de aviso en el resultado del trabajo) | Contrato primero: se edita `packages/contracts`, se regenera OpenAPI y doc 06 en el mismo cambio |

## 6. Verificación

**Pruebas por invariante (contra base real, `test:api`)**, sobre PostGIS con el doble en memoria del motor:

- **INV-14**: `generateRoutes` con `addToMission` a una misión sin origen responde `MISSION_HAS_NO_ORIGIN` y no crea trabajo ni rutas; con origen y objetivo, 202 con `jobId`. En una misión cerrada, `MISSION_CLOSED`.
- **Trabajo**: de `pending` a `running` y a `completed` con `progress` creciente; cada alternativa es una **ruta nueva en Borrador, versión 1**, `provenance = generated`, con `calculation_job_id`, métricas del servidor y composición; las del motor nunca llegan a la base (se inyecta un motor que devuelve altitudes falsas de 999 m, como en INV-15 de H2).
- **Errores**: `NO_ROUTE_POSSIBLE`, `OUTSIDE_COVERAGE`, `ROUTING_UNAVAILABLE` (motor caído) y `INTERNAL`; el trabajo termina `failed` con su `errorCode`; la API sigue respondiendo y las rutas existentes siguen consultándose con el motor caído (doc 04 §11.4).
- **Supervivencia**: se detiene el *worker* a mitad de un trabajo y se arranca otro; el trabajo termina **sin duplicar rutas** (D-H3-06).
- **INV-01 por id**: un coordinador de la organización B recibe 404 en `getJob`, en `deleteAvoidZone` y en una zona o misión ajena; los `avoidZoneIds` de otra organización dan 404, no se ignoran.
- **INV-16**: `generateRoutes`, `createAvoidZone` y `deleteAvoidZone` dejan una fila de auditoría cada una; el trabajo que crea rutas audita la creación de cada ruta.
- **Permisos**: el administrador lee zonas y trabajos y recibe 403 en cada escritura; el rescatista recibe 403 en todo.
- **Zonas**: `createAvoidZone` rechaza polígonos inválidos o fuera de cobertura; `listAvoidZones` filtra por misión; un polígono con auto-intersección es `VALIDATION_FAILED`.
- **Además**: AC-02 (montadas = H0 + H1 + H2 + H3), toda respuesta validada contra su esquema y todo error contra `ErrorResponse`.

**Suite contra el motor real (red inventada, CI propio):** alternativas ≥ 2 por par, preferencia por sendero, zona a evitar esquivada o `NO_ROUTE_POSSIBLE` limpio, ajuste de un dibujo burdo a la red con el orden conservado, composición sin «desconocido», y la altitud del motor sin efecto sobre las métricas guardadas. Adaptación de los casos del PoC (`poc/motor-rutas/cases/`) a la red inventada.

**Regresión real (P3, manual):** los tres pares y el francés con el extracto de los Pirineos, con los umbrales del PoC y **el criterio 3 con el umbral literal del plan del PoC** (la pendiente máxima medida no pasa del límite salvo si no hay otra salida, y entonces avisa).

**Demostración como prueba E2E (Playwright, contra `docker compose` con la superposición E2E, escritorio y 375 px):** el coordinador abre una misión con **dos orígenes, uno a cada lado de una frontera inventada**, pulsa *Generar*, ve el progreso, recibe varias alternativas por origen con distancia, desnivel y composición, las compara y guarda una; dibuja una zona a evitar y regenera: la ruta la esquiva (o el mensaje de que no hay salida); dibuja una ruta a mano y se pega a la red; sin origen el botón está desactivado con la explicación; con el motor parado aparece el mensaje de `ROUTING_UNAVAILABLE` y el resto de la app sigue. Teclado completo y francés. La demostración con datos reales (Coronas, Bujaruelo, Ordesa) se hace a mano y se documenta.

**Comandos (los de `CLAUDE.md`; los recuentos finales los anota cada tarea en `docs/estado.md`):**
```
pnpm install --frozen-lockfile
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @onway/contracts gen:openapi && pnpm --filter @onway/contracts gen:doc gen/ && pnpm --filter @onway/contracts gen:client
git diff --exit-code docs/06-contratos-de-api.md
pnpm --filter @onway/api test:db
pnpm --filter @onway/api test:api
pnpm --filter @onway/api test:routing                                          # contra el motor real con la red inventada (nuevo)
db/tests/run-postgis.sh
docker compose up --wait && infra/scripts/smoke.sh                             # datos reales; incluye la salud del motor y del worker
COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --wait && pnpm --filter @onway/web e2e
```

**Recuentos de partida (cierre de H2) para comparar:** contratos 89, i18n 8, geo 116, api unitarias 132, web 270, `test:api` 274, `test:db` 25 de Vitest (194 SQL), E2E 63. Ninguno baja.

**Salida (doc 07):** INV-14 con prueba; los casos de la prueba técnica pasan como regresión; un trabajo sobrevive a un reinicio del *worker*; `MISSION_HAS_NO_ORIGIN`, `NO_ROUTE_POSSIBLE`, `OUTSIDE_COVERAGE` y `ROUTING_UNAVAILABLE` se muestran con un mensaje útil; con el motor caído el resto de la app sigue; memoria dentro de los 8 GB (R-12).

## 7. Documentos que habrá que actualizar

| Documento | Cambio | Registro de cambios |
|---|---|---|
| `docs/estado.md` | Fusión del PoC (PR #4, `d71cc5a`) y H3 en curso (primer commit de la rama); al cerrar cada tarea, recuentos y decisiones | — |
| `docs/01` | RF-501/503/507/304 construidos; Q-05 cerrada con su valor por defecto; R-01 y R-12 con lo medido en el hito | 1.2 |
| `docs/02` §3.6, §4.3, §8 | Generar con zonas y progreso; dibujar a mano con ajuste a caminos; composición real; misión sin origen; motor caído | 0.8 |
| `docs/03` §8.2 | Estados del trabajo tal como se construyeron (`pending/running/completed/failed`) y motivos del fallo | 0.7 |
| `docs/04` §3, §5, §7.6, §11, §12 | `RoutingProvider` y su adaptador; cola y *worker*; servicios `routing`, `routing-data` y `worker`; DEM del motor (D-H3-02); memoria medida de la pila; suite `test:routing` | 1.1 |
| `docs/05` §3.3, §10 | `calculation_jobs` y `avoid_zones` en uso; permisos de la cola (0013 si P1); rutas de demostración de H3 (2 en H3) | 0.9 |
| `docs/06` §6, §10, §11 | Las 6 operaciones montadas, errores y notas; Q-05 | 1.2 |
| `docs/07` §3 (H3) y §6 | H3 tal como se construyó; pesos revisados o pendientes (P6) | 0.6 |
| `CLAUDE.md` | Comandos (`test:routing`, servicios), estructura, recuentos | — |
| `data/seed/README.md` | Red inventada y misión de dos orígenes | — |

## 8. Tareas previstas (borrador; se detallan en `tasks.md` tras la aprobación)

1. **T1 · DEM del motor (primera tarea decidida en la prueba técnica).** `build-hgt`, verificación de la altitud con GraphHopper y criterio 3 sobre los tres pares con el umbral literal. *Spike con criterio de salida medible; si falla, paro y consulto.*
2. **T2 · Servicio `routing` y datos.** Imagen y perfil versionados en `infra/routing/`, `routing-data`, `geodata` con los extractos, red inventada, superposición E2E, salud y límites de memoria.
3. **T3 · Puerto `RoutingProvider` y adaptador GraphHopper.** Alternativas con bloqueo, zonas, ajuste, errores; doble en memoria; suite `test:routing` con los casos del PoC adaptados.
4. **T4 · Zonas a evitar.** Las 3 operaciones, auditoría, permisos y aislamiento.
5. **T5 · `snapRoute` y composición real.** Síncrona, con medición propia; segmentos desde los detalles del motor (D-H3-04).
6. **T6 · Cola, *worker* y `getJob`.** pg-boss (P1), segundo punto de entrada, servicio `worker`, salud, permisos de la cola.
7. **T7 · `generateRoutes`.** INV-14, `MISSION_CLOSED`, rutas en Borrador versión 1 con composición, `addToMission` (P5), progreso, errores, idempotencia y supervivencia al reinicio.
8. **T8 · Web: Generar.** Formulario, zonas en el mapa, progreso, resultados y comparación; acción en la misión.
9. **T9 · Web: dibujar a mano con ajuste a caminos y composición** en detalle, lista y comparación; francés y teclado.
10. **T10 · Semilla, demostración E2E, regresión real y documentos.** Misión de dos orígenes, E2E en escritorio y móvil, regresión de los casos reales (manual), memoria de la pila, hoja de revisión de pesos (P6) y documentos.

Un commit y un push por tarea, igual que en H2. Al terminar: validación con el `reviewer` contra los 12 criterios del doc 07 §4 y la demostración (máx. 2 vueltas) y PR `hito/H3-generacion-rutas` → `main` con commit de fusión (lo fusionas tú).

## 9. Cambios durante la construcción (desviaciones respecto a este plan)

| # | Qué cambió | Por qué | Dónde queda anotado |
|---|---|---|---|
| C1 | «Ajustar a los caminos» une los puntos en orden con una ruta del motor y no usa `/match` | `/match` pide trazas densas y falla con puntos dispersos; el doc 02 dice «los une siguiendo caminos» | doc 04 §5.2 |
| C2 | `createRoute` gana el campo `snapToPaths` (2 a 50 puntos de control) | Guardar la ruta dibujada con su composición sin que el cliente mande una línea ya calculada (regla 6) | doc 06 v1.2 |
| C3 | El límite de pendiente no se expone en `generateRoutes` | El motor guarda `max_slope` en 5 bits y satura en el 31 %: con un límite ≤ 30 % los tres pares no tienen ruta (el «no hay otra salida» del criterio 3) | doc 04 §7.6 |
| C4 | `MISSION_CLOSED` (zonas) y `NOT_FOUND` (`generateRoutes`) añadidos al contrato | Los casos existían y no estaban en la tabla de errores | doc 06 v1.2 |
| C5 | El motor de pruebas se publica en `127.0.0.1:18989` y el servicio `routing` se une a la red `edge`, **solo** en la superposición E2E; la regresión real usa `infra/compose.regression.yml` (18990) | `test:routing` y el corredor de la prueba técnica necesitan hablar con él desde el equipo; la pila normal sigue sin puertos del motor | `CLAUDE.md`, doc 04 §12 |
| C6 | Recorte de la red con `osmium extract --strategy simple --output-format pbf` | Con datos reales (no con la red inventada) `complete_ways` dejaba nodos bajo la latitud 42,0, sin teselas de altitud, y el motor se caía; `.part` impedía a osmium reconocer el formato | doc 04 §7.6 |
| C7 | La misión de dos orígenes **no va en la semilla**: la crea el E2E por la API | La semilla (3 misiones, 6 rutas) no debe depender del motor ni cambiar sus recuentos; para verla a mano, `data/seed/README.md` | `data/seed/README.md`, doc 05 §10 |
| C8 | El E2E exige de 2 a 3 alternativas por origen, no exactamente 3, y cierra las misiones «E2E …» y archiva sus rutas al terminar | El motor pone el tope según la red (el plan pedía «al menos 2 por par»); sin la limpieza, las rutas generadas llenaban la biblioteca que ve la demostración de H2 | `CLAUDE.md` |
| C9 | **Abierto:** el rodeo por bloqueo no tiene tope de longitud (solo el reparto máximo del 70 %); el par francés da una segunda alternativa del doble de longitud | Se vio al medir la regresión real; decidirlo exige criterio de dominio | `revision-pesos.md` |
