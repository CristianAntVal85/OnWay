# H4 · Rutas en la misión y vista del rescatista — Plan

Estado: **aprobado por el usuario (2026-11-01)**, con las decisiones P1–P6 aceptadas · Rama: `hito/H4-rutas-en-la-mision` (desde `main` con H3 y el arreglo del mapa fusionados: PR #5 `ab1658c` y PR #6 `d2e6d14`) · Fuente: `docs/07` §3 (H4) y §4, `docs/01` (RF-508, 513, 518, 601–604, 805; RN-13, RN-14), `docs/02` (§3.5, §4.3, §4.4, §6, §7, §8; bocetos 6, 11 y 14), `docs/03` (INV-03, 05, 06, 07, 13), `docs/05`, `docs/06`.

**Cierra el MVP** (H0–H4). Tras este hito decides si sigues con H5 o corriges rumbo (doc 07).

## 0. Decisiones para el usuario

Lo que los documentos no cierran. Cada una lleva mi recomendación (la primera) y la alternativa descartada. Si apruebas el plan, quedan aceptadas.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| P1 | **Semilla.** El rescatista de la demostración (móvil, `docker compose up`) necesita ver rutas, y la misión activa «Valle de Ordesa» no tiene ninguna | **Sembrar 4 rutas en esa misión** con las rutas de H2: una validada y visible; una validada marcada *no disponible*; una cuya versión fijada es un borrador (el rescatista no la ve); y «Senda del Circo» con la versión 2 fijada y la 3 validada (aviso de versión nueva). No cambia las 6 rutas ni las 3 misiones de la semilla: solo añade filas de `mission_routes` y su historial. El E2E de H1 del rescatista usa su propia misión, no esta | No sembrar y que el E2E cree todo por la API (como en H3, C7): la semilla queda igual, pero quien levante la pila no ve nada en la vista del rescatista |
| P2 | **Qué exporta cada rol.** El contrato dice «todas las exportables» sin definir | **Rescatista:** solo versiones *validadas y fijadas* de rutas *no marcadas como no disponibles* (una ruta que se avisa de no usar no se descarga). **Coordinador:** todas las de la misión en su versión fijada, borradores incluidos y no disponibles excluidas salvo que las pida por `ids`. GPX por defecto, KML opcional (RF-511) | Que el rescatista pueda descargar también las no disponibles: contradice el motivo de RF-508 |
| P3 | **RF-805 (equipo por ruta), «parcial hasta H5».** Elegir un equipo exige listar equipos, y `listTeams` es de H5 | **API completa** (`teamId` al añadir y al actualizar, validado contra la organización, 404 si es de otra) y la interfaz **muestra** el equipo y su localidad si lo hay; el **selector** llega con `listTeams` en H5. Una ruta puede tener ya equipo si viene de la semilla | Cargar los equipos desde otra operación: adelanta trabajo de H5 (constitución, regla 2) |
| P4 | **RF-604, compartir la ubicación del objetivo** «como enlace o coordenadas copiables» | **Coordenadas copiables** (botón con confirmación para lector de pantalla) y un **enlace `geo:lat,lon`**, que los móviles abren con la aplicación de mapas que tengan. Sin ningún servicio de terceros | Enlace a un mapa web de un tercero: es un anfitrión más y la aplicación solo habla con IGN y consigo misma (D-H1-08) |
| P5 | **El aviso de activar sin ruta validada** (H1) cuenta hoy las rutas validadas, también las *no disponibles* | **No cuentan** las marcadas como no disponibles: una misión cuya única ruta validada no se debe usar sigue avisando. Cambio de una consulta de H1 con su prueba | Dejarlo como está: la misión parecería lista sin una ruta utilizable |
| P6 | **Añadir una ruta archivada a una misión** | Se rechaza con `INVALID_STATE_TRANSITION` (409, el código de H2 para «ruta archivada», D-H2-08) y se añade a la lista de errores de `addMissionRoutes` y `updateMissionRoute` en el contrato. Para usarla hay que derivarla | Código nuevo `ROUTE_ARCHIVED`: un código más para el mismo caso |

Además, **sin necesitar respuesta** (diseño, con alternativa en §4): D-H4-01 a D-H4-08.

## 1. Alcance

- **Requisitos:** RF-513 (añadir ruta a una misión, tres caminos), RF-508 (no disponible), RF-518 (aviso de versión nueva; nunca cambia sola), RF-601 y 602 (completos: rutas validadas fijadas, métricas, mapa), RF-603 (exportar), RF-604 (compartir la ubicación), RF-805 (parcial: P3). Apoyan: RF-502, 504, 506, 519 (comparar, perfil, validar con aviso y antigüedad, ya construidos en H2, ahora dentro de la misión). Bocetos 6, 11 y 14 completos.
- **Reglas e invariantes:** RN-13 (la versión fijada no cambia sola), RN-14 (una ruta usada no se borra), RN-03 (el rescatista solo ve lo validado); **INV-03, 05, 06, 07, 13**; INV-01 y 16 (todo cambio audita) por contacto.
- **Operaciones (9, `x-milestone: H4`):** `listMissionRoutes`, `addMissionRoutes`, `updateMissionRoute`, `removeMissionRoute`, `getMissionRouteGeometry`, `exportMissionRoutes`, `listMyMissionRoutes`, `getMyMissionRouteGeometry`, `exportMyMissionRoutes`. Con ellas, **51 operaciones montadas** (42 + 9) y `CURRENT_MILESTONE = 'H4'`.
- **Fuera (doc 07):** alta de usuarios, perfiles, voluntariado y equipos (H5); búsqueda por punto y adaptar (H8, H9); curvas de nivel (H9). **Tampoco** el selector de equipo (P3) ni dibujar desde la misión con `?mission=` (RF-513 pide tres caminos: biblioteca, generar e importar; dibujar sigue siendo desde la biblioteca).

## 2. Qué cambia, por carpeta

| Carpeta | Cambio |
|---|---|
| `packages/contracts` | Los esquemas de las 9 operaciones **ya existen** (`MissionRouteStaff`, `MissionRouteRescuer`, `MissionRouteGeometry`…): se revisan contra lo que se construye. `INVALID_STATE_TRANSITION` en `addMissionRoutes` y `updateMissionRoute` (P6); `NOT_FOUND` explícito donde se pide una versión o equipo ajeno. OpenAPI y doc 06 regenerados |
| `apps/api` | Módulo `src/mission-routes/`: lecturas (tabla del coordinador con `newerValidatedVersion` y `validationIsStale`; filas del rescatista), escrituras (añadir en lote atómico, cambiar versión fijada / estado / origen / equipo / nota, quitar), geometría con perfil y tramos de la versión **fijada**, exportación (reutiliza `RouteExports`). Consulta de «rutas validadas» de la activación (P5). Auditoría: `route_added`, `route_removed`, `route_version_changed`, `route_marked_unavailable`, `route_reactivated`, `route_version_validated` (ya están en `MissionHistoryAction`). `CURRENT_MILESTONE = 'H4'` |
| `apps/web` | **Coordinador:** sección «Rutas de la misión» en el detalle (tabla comparativa, selección para superponer en el mapa con perfil, aviso de versión nueva con «Actualizar a la versión N», marca de validación antigua, marcar no disponible / reactivar, quitar, validar con el aviso de RF-506, exportar) y diálogo **Añadir ruta** (elegir de la biblioteca con búsqueda y filtros de estado; enlaces a *Generar* y a *Importar* con `?mission=`; versión, origen y nota). **Rescatista:** rutas validadas en su vista (tarjetas con métricas y composición, mapa, perfil, señal de *no disponible*, descargar GPX/KML) y **compartir ubicación** (P4). 375 px y teclado. Componentes de H2 reutilizados (perfil, comparación, composición) |
| `packages/geo` | Sin cambios previstos (la geometría ya vive allí o en el servidor) |
| `packages/i18n` | Textos es/fr de las dos vistas, los avisos y los errores |
| `db/` | **Sin migración nueva**: las tablas, las claves foráneas compuestas (INV-06, INV-13), los disparadores (INV-07, INV-11, origen de tipo origen) y las políticas del rescatista (`mroutes_rescuer`, `versions_rescuer`) existen desde 0005–0008 y 0011. Se comprueban, no se tocan |
| `infra/` | Sin cambios |
| `data/seed` | P1: 4 rutas en la misión «Valle de Ordesa» (activa) con su historial, por el mismo camino que las crea la aplicación |

## 3. Puertos implicados

Ninguno nuevo. `FileStorage` no interviene; `ElevationProvider` y `RoutingProvider` **no** se llaman: H4 solo lee y fija versiones ya medidas (regla 6: nada se recalcula ni se acepta del cliente). La exportación reutiliza los escritores GPX/KML de `packages/geo`.

## 4. Decisiones (con alternativa descartada)

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-H4-01 | **La versión por defecto al añadir** es la última *validada*; si la ruta no tiene ninguna, la última (borrador), como permite RF-513. Se avisa en la tabla de que el rescatista no la ve | Exigir validada: contradice RF-513 y el flujo «genero, añado, valido» |
| D-H4-02 | **La versión fijada nunca cambia sola** (RN-13). Validar, editar o derivar una ruta no toca `pinned_version_id`; solo `updateMissionRoute` con `pinnedVersionId`. La versión debe ser de **esa** ruta (INV-06 lo impide en la base; el servidor responde 404) | Avanzar la fijada al validar: rompe D-19 |
| D-H4-03 | **`newerValidatedVersion`** = la versión validada de mayor número que la fijada, si es mayor. **`validationIsStale`** = la validación de la versión fijada supera `validation_max_age_days` de la organización (RF-519, ya en H2) | Calcularlo en la web: la lógica de rutas no va en componentes (regla 9) |
| D-H4-04 | **El rescatista lee con dos defensas**: la seguridad por filas (`mroutes_rescuer`, `versions_rescuer`) y un filtro explícito en cada consulta (versión validada **y** fijada, misión visible para él). Un rescatista nunca recibe borradores ni versiones no fijadas (INV-05). Misión en planificación → 404; cerrada → lectura sí, exportar no (`MISSION_NOT_ACTIVE`, según el contrato) | Confiar solo en la política o solo en el filtro |
| D-H4-05 | **Añadir en lote es atómico**: si una de las hasta 20 rutas falla (duplicada, ajena, archivada), no se añade ninguna y la respuesta dice cuál. Una sola fila de historial por ruta, en la misma transacción (INV-16) | Parcial: deja la misión a medias |
| D-H4-06 | **Una ruta quitada de la misión sigue en la biblioteca** y, si ya no está en ninguna misión abierta, puede archivarse (INV-07); quitar y reactivar quedan en el historial | Borrar la ruta: prohibido (RN-14) |
| D-H4-07 | **Geometría de la lista** con `previewGeometry` simplificada (como en la biblioteca) y la completa, tramos y perfil solo al seleccionar una (`getMissionRouteGeometry`), para no mandar 1 000 vértices × N rutas | Todo en la lista: respuestas pesadas en móvil |
| D-H4-08 | **Validar desde la misión** reutiliza `validateRouteVersion` (H2) con el aviso de RF-506; la fila cambia sin recargar. No hay operación nueva | Validar solo desde la biblioteca: obliga a salir de la misión |

## 5. Riesgos del hito

| Riesgo | Mitigación |
|---|---|
| **Filtración al rescatista** (borrador, versión no fijada, nota interna, quién validó) | Esquema propio sin esos campos (`MissionRouteRescuer`), doble defensa (D-H4-04) y una prueba por cada caso, también contra la base como `onway_app` con rol de rescatista |
| **R-08**: una validación antigua se reutiliza sin darse cuenta | Marca de antigüedad en las dos vistas (RF-519) y aviso al activar |
| **Carrera**: dos coordinadores cambian la versión fijada a la vez (Q-10 abierta) | La última escritura gana y queda en el historial con quién y qué versión; no se añade bloqueo (alternativa: `If-Match`, para H5+) |
| **Rendimiento** de la tabla con muchas rutas | Límite de 20 por lote, geometría simplificada en la lista y completa bajo demanda (D-H4-07) |
| **Móvil**: el rescatista abre la misión desde la montaña con mala cobertura | Respuestas pequeñas, estados de carga y error claros; el modo sin conexión es de v2 (D-05). Descarga del GPX de una sola pulsación |
| **El E2E del MVP es largo** (la historia completa en dos roles y dos formatos) | Un solo archivo, serial, con limpieza acotada por su sello (lo aprendido en H3) |

## 6. Verificación

**Pruebas por invariante (`test:api`, base real):**
- **INV-13:** añadir dos veces la misma ruta → `ROUTE_ALREADY_IN_MISSION`; un lote con una repetida no añade ninguna.
- **INV-06:** fijar una versión de otra ruta → 404, y la clave foránea compuesta lo impide aunque se salte el servidor (prueba SQL).
- **INV-07:** una ruta en una misión abierta no se archiva (`ROUTE_IN_USE`); al quitarla, o con la misión cerrada, sí.
- **INV-05 y RN-03:** el rescatista no ve la ruta si la versión fijada es borrador; ve la **fijada** (no la última) aunque haya otra validada más nueva; la ruta *no disponible* sale señalada; la geometría de una ruta no visible es 404; la exportación no lleva borradores ni no disponibles. Con SQL directo como rescatista, las políticas devuelven lo mismo.
- **INV-03 y Q-14:** escribir rutas en la misión exige ser coordinador: el administrador las lee y recibe 403 al escribir, y la base de datos lo repite (migración 0011, también como `onway_app` con rol de administrador).
- **RN-13:** validar, editar o derivar no cambia la fijada; aparece `newerValidatedVersion`.
- **INV-01:** misión, ruta, versión, origen o equipo de otra organización → 404 en las 9 operaciones. **INV-11:** misión cerrada → `MISSION_CLOSED` en las escrituras.
- **INV-16:** cada escritura deja su fila en el historial, en la misma transacción; el historial no lleva datos personales.
- **P5:** el aviso de activación no cuenta las no disponibles.
- AC-02 compara las rutas montadas con las 51 exactas.

**Demostración como prueba E2E** (`apps/web/e2e/h4-demo.spec.ts`, Playwright contra `docker compose` con la superposición E2E, escritorio y 375 px; la historia completa del doc 07):
1. **Coordinador:** crea la misión, genera rutas (motor sobre la red inventada), valida una, las añade fijando la versión, las compara (tabla y perfil superpuestos), marca una *no disponible*, activa (**la app avisa si no hay ninguna validada** y pide confirmar).
2. **Rescatista, 375 px, solo con teclado y en francés:** abre la misión, ve solo las validadas fijadas (la *no disponible*, señalada), el mapa y las métricas, comparte la ubicación y **descarga el GPX** (se comprueba su contenido: sin borradores, sin autor).
3. **Versión nueva:** el coordinador edita la ruta y valida la versión 2; la misión sigue con la fijada, aparece el aviso y el rescatista sigue viendo la versión fijada; el coordinador actualiza y el rescatista ve la nueva.
4. Otra organización recibe 404; el rescatista no ve nada en planificación.

**Comandos:** los de `CLAUDE.md` (`pnpm lint`, `format:check`, `typecheck`, `test`, `test:api`, `test:db`, `test:routing`, `pnpm --filter @onway/web e2e`), más `gen:openapi` y `gen:doc` sin diferencias, y `smoke.sh` con la semilla nueva.

## 7. Documentos que habrá que actualizar

| Documento | Cambio | Registro |
|---|---|---|
| `docs/estado.md` | Fusión de H3 (PR #5) y del arreglo del mapa (PR #6); H4 en curso | — |
| `docs/01` | RF-508, 513, 518, 601–604 y 805 construidos (RF-805 parcial) | 1.3 |
| `docs/02` §3.5, §4.3, §4.4, §7, §8 | Sección «Rutas de la misión», diálogo Añadir ruta, vista del rescatista, compartir ubicación, casos límite (borrador fijado, archivada, versión nueva, no disponible) | 0.9 |
| `docs/03` | Estados de la ruta en la misión tal como se construyeron | 0.8 |
| `docs/05` §10 | Semilla de H4 (P1); sin migración | 1.0 |
| `docs/06` §6, §10, §11 | 9 operaciones montadas, errores, auditoría de la ruta en la misión, qué exporta cada rol (P2) | 1.3 |
| `docs/07` §3 (H4) | H4 «tal como se construyó» | 0.7 |
| `CLAUDE.md`, `data/seed/README.md` | Recuentos, la misión sembrada con rutas | — |

## 8. Tareas previstas (borrador; se detallan en `tasks.md` tras la aprobación)

1. **T1 · Contrato y lecturas del coordinador.** Revisar esquemas y errores, regenerar OpenAPI y doc 06; `listMissionRoutes` y `getMissionRouteGeometry`; `CURRENT_MILESTONE = 'H4'`. Pruebas: 404 entre organizaciones, `newerValidatedVersion`, `validationIsStale`, vista previa.
2. **T2 · Escrituras: añadir, actualizar, quitar.** `addMissionRoutes` (atómico), `updateMissionRoute`, `removeMissionRoute`; auditoría. Pruebas: INV-13, INV-06, INV-07, INV-11, RN-13, P5 y P6.
3. **T3 · Lecturas y exportación del rescatista.** `listMyMissionRoutes`, `getMyMissionRouteGeometry`, `exportMyMissionRoutes`; `exportMissionRoutes` (P2). Pruebas: INV-05, RN-03, políticas como rescatista contra la base.
4. **T4 · Web del coordinador I: sección «Rutas de la misión».** Tabla comparativa, selección con mapa y perfil, avisos de versión nueva y antigüedad, no disponible, quitar, exportar.
5. **T5 · Web del coordinador II: diálogo «Añadir ruta» y validar.** Biblioteca con búsqueda, `?mission=` en *Importar*, validar con aviso, actualizar la versión fijada.
6. **T6 · Web del rescatista.** Rutas validadas, mapa, perfil, señal de no disponible, descarga, compartir ubicación; 375 px, teclado y francés.
7. **T7 · Semilla (P1) y revisión de interfaz.** Las 4 rutas en «Valle de Ordesa», `smoke.sh`, y revisión con Chrome DevTools en móvil.
8. **T8 · Demostración E2E del MVP.** `h4-demo.spec.ts` en escritorio y 375 px; estabilidad con `CI=1` varias veces.
9. **T9 · Documentos y cierre.** Docs 01–07, `CLAUDE.md`, `data/seed/README.md`, `docs/estado.md` con la tabla de los 12 criterios, recuentos finales y clon limpio con `smoke.sh`.

Cada tarea se cierra con su commit `<tipo>(H4): Tn <resumen>` y su push. Tras T9, validación con el `reviewer` (los 12 criterios de la sección 4 del doc 07 más la historia completa) y PR hacia `main`, que fusionas tú sin squash.

## 9. Cambios durante la construcción (desviaciones respecto a este plan)

| # | Qué cambió | Por qué | Dónde queda anotado |
|---|---|---|---|
| C1 | La T2 también implementa `addToMission` en `createRoute` (importar y dibujar) y `deriveRoute`, que el plan daba por hecho | Se descubrió en la T1: desde H2 esas dos operaciones lo rechazan con «arrives with H4»; sin ello el diálogo «Añadir ruta → Importar» (T5) y RF-513 no funcionan | `tasks.md` T2, `docs/estado.md` |
| C2 | `MissionRouteRescuer` gana `validationIsStale` (booleano calculado por el servidor con el `Clock` y `validation_max_age_days`) | El plan (§5, R-08) pide la marca de validación antigua en las dos vistas, y T6 no puede calcularla en la web (regla 9: nada de lógica de rutas en componentes). Cambio aditivo del contrato | `packages/contracts/src/routes.ts`, doc 06 (campos del rescatista), `docs/estado.md` |
| C3 | El equipo de una ruta llega `null` al rescatista que no es miembro de él | La política `teams_select` solo deja a un rescatista leer los equipos de los que es miembro. No se añade la migración 0013 (el plan manda consultar antes); el contrato lo anota. **Pendiente de decisión del usuario:** una función `SECURITY DEFINER` que devuelva solo nombre y localidad del equipo de la ruta, o dejarlo | `endpoints.ts` (notas de `listMyMissionRoutes`), `docs/estado.md` |
