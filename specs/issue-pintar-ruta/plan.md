# issue-pintar-ruta · Pintar una ruta a mano y continuar a mano una ruta generada — Plan

Estado: **APROBADO por el usuario el 2026-11-21** · Origen: petición del usuario del 2026-11-21 (sin número de issue todavía) · Rama: `hito/issue-pintar-ruta`, desde `main` (`358c46a`).

**Qué pasa hoy.** El motor genera bien, pero la red de caminos no tiene todos los senderos reales: a veces la ruta da un rodeo o se queda corta porque el sendero bueno no está en los datos. Lo que ya existe no basta:
- **Dibujar** (`/routes/draw`, RF-505) solo se abre desde la biblioteca. Cada toque en el mapa añade un punto **siempre**: no se puede mover el mapa tocando sin añadir puntos. La casilla «unir los puntos siguiendo los caminos» viene **marcada**, justo lo contrario de lo que hace falta cuando el sendero no está en la red.
- **Desde la misión** no se puede dibujar. El doc 02 §4.3 B lo prevé («Generar, importar o dibujar»), pero H4 solo construyó generar e importar.
- **Combinar** una ruta generada con un tramo a mano no existe. Editar la versión generada obliga a borrar vértices uno a uno (además, el editor la simplifica a 150), y la ruta entera queda «sin clasificar».

**Qué pide el usuario:**
1. Una opción **«Pintar ruta»** que se queda activada: cada toque añade un punto consecutivo, hasta desactivarla.
2. Que el servidor una esos puntos y dé **distancia y desnivel**.
3. **Combinar**: en una ruta generada, elegir hasta dónde vale lo del motor (un punto que no es el objetivo) y, desde ahí, empalmar el tramo pintado a mano.

**Decisiones del usuario (2026-11-21):**
- (1) el tramo a mano va **en línea recta** entre los puntos marcados;
- (2) la ruta combinada es una **versión nueva** de la generada, no una ruta derivada;
- (3) este cambio va **antes que el resto de H5**.

**No es un hito de v1 ni revierte ninguna regla.** Como la issue anterior (nombre de las rutas), es un cambio de alcance pedido por el usuario. Las versiones siguen siendo inmutables: continuar crea la versión siguiente (regla 4, INV-04). El servidor sigue calculando altitud, métricas y tramos (regla 6).

## 1. Alcance

- **Requisitos:**
  - RF-505: modo «Pintar ruta» y «Continuar a mano».
  - RF-503: composición del tramo a mano.
  - RF-513 y doc 02 §4.3 B: dibujar desde la misión.
  - RF-516: continuar crea versión nueva.
  - RN-10 y regla 6: sin cambios, se respetan.
- **Invariantes tocados**, cada uno con su prueba contra base real:
  - INV-04: la versión de partida queda intacta;
  - INV-16: continuar deja auditoría;
  - INV-01: aislamiento;
  - INV-11: una misión cerrada no recibe la ruta dibujada; `assertCanLink` ya lo hace y solo se prueba.
- **Operaciones nuevas:** ninguna. Quedan 98 en el registro y 60 montadas.
- **Operaciones que cambian (1):** `createRouteVersion`.
  - El cuerpo admite `continueFrom: { cutPoint: LatLon, points: LatLon[] }` **en lugar de** `geometry`; tiene que venir exactamente uno de los dos.
  - Con `continueFrom`, el servidor conserva la versión base desde el inicio hasta el punto de corte (proyectado sobre la línea, con sus tramos y tipos de vía), une en línea recta los puntos a mano y mide el conjunto.
  - Errores nuevos para esta operación, todos del catálogo: `VALIDATION_FAILED` (corte a más de 200 m de la línea, o en el primer vértice) y `OUTSIDE_COVERAGE` (ya existía).
- **Se usan sin cambios:**
  - `createRoute` con `source: 'drawn'` y `addToMission` (H4, ya montado);
  - `getRoute`, `getRouteVersion`, `getMission` y `listMissionRoutes`.
- **Fuera:**
  - unir el tramo a mano por los caminos (decisión 1);
  - pegar a mano un tramo **en medio** de una ruta (solo se continúa desde el corte hasta el final);
  - cortar por el principio;
  - fijar automáticamente en la misión la versión nueva (D-P6);
  - dibujar a mano alzada (trazo continuo con el dedo);
  - RF-515 «Adaptar», que recalcula el tramo final **con el motor**: sigue en H9 (segunda entrega);
  - cambiar la composición de las rutas dibujadas enteras en línea recta, que siguen «sin clasificar» (D-P5);
  - cambios en la base de datos.

## 2. Contexto para el implementador

Texto mínimo de cada identificador. No hace falta abrir los docs 01 a 06.

- **RF-505 (Must) Edición manual de una ruta** por el coordinador: arrastrar el trazado, añadir puntos de paso, recalcular el tramo afectado. Guardar crea una **versión nueva** en *Borrador* (RF-516) y nunca modifica la anterior.
- **RF-503 (Should) Composición de la ruta:** porcentaje del recorrido por carretera, pista, sendero o tramo sin camino.
  - Una ruta generada, o dibujada con «unir los puntos siguiendo los caminos», lleva la composición que mide el servidor sobre los tramos del motor.
  - Una ruta importada, dibujada en línea recta o editada a mano se muestra como «sin clasificar».
  - **Este cambio añade:** al continuar a mano, la parte conservada mantiene sus tipos de vía y el tramo a mano cuenta como **sin camino** (`offtrail`, «Sin camino» en la interfaz).
- **RF-513 / doc 02 §4.3 B:** «Crear una ruta nueva para esta misión: generar, importar o dibujar, con los puntos rellenados con el objetivo y un origen de la misión… Al terminar, la ruta queda en la biblioteca y se añade a la misión con su versión 1 fijada.» Hoy está construido para generar e importar; dibujar falta.
- **RF-516 / RN-12 / INV-04:** «Toda edición crea una versión nueva. Las versiones anteriores se conservan y no se modifican.»
- **RF-518:** si una ruta de una misión tiene una versión **validada** más reciente que la fijada, la misión lo avisa y el coordinador decide si la actualiza (`updateMissionRoute`). La versión fijada nunca cambia sola.
- **RN-10 / regla 6:** el servidor calcula elevación, métricas y tramos y nunca se fía del cliente. Con `continueFrom`, la parte conservada se lee **de la versión guardada**, no del cliente. El cliente solo manda el punto de corte y los puntos a mano.
- **Regla 9:** nada de geometría en componentes de React. El corte, la proyección y la distancia van en `packages/geo`, que usan la web (vista previa) y el servidor (lo que vale).
- **INV-01 / regla 1:** otra organización responde 404. **Regla 2:** solo `MISSION_WRITERS` (coordinador). **INV-11:** una misión cerrada no admite escrituras.
- **INV-16:** todo cambio en rutas deja auditoría. `route_version_created` ya existe; su `detail` gana `continued: true` y `keptDistanceM`.
- **Tipos de vía** (`packages/contracts/src/enums.ts`): `RoadType = road | track | path | offtrail | unknown`. `offtrail` es «Sin camino» y `unknown` es «Sin clasificar» (`packages/i18n`, `roadTypes`).
- **Cómo mide hoy el servidor** (`apps/api/src/routes/route-measurement.ts`): `measure(vertices, stretches?)`.
  - `stretches` son `{ fromIndex, toIndex, roadType }` sobre los **vértices de entrada**; `labelIntervals` y `groupIntervals` (`packages/geo/src/segments.ts`) los llevan a la línea preparada.
  - Sin `stretches`, la ruta es un único tramo `unknown`.
  - Los tramos guardados (`route_segments`, con `position` y `geom`) son trozos consecutivos de la geometría de la versión que comparten el vértice de unión. Es el `segmentLines` de `measure`.
- **Editor actual** (`apps/web/src/pages/route-editor-page.tsx`, modos `draw` y `edit`):
  - `MapView` recibe `onPick` (cada toque añade un punto con `append`) y `editor` (arrastrar, insertar, seleccionar y borrar);
  - reducer `editReducer` en `src/map/edit.ts`;
  - lista de coordenadas editable con teclado;
  - `MAX_EDIT_VERTICES = 150`, `MAX_SNAP_POINTS = 50`.
- **Convenciones:**
  - `strictObject`; errores solo de `ERROR_HTTP`;
  - textos por `packages/i18n` (es y fr);
  - cada vista con carga, vacío y error, móvil a 375 px y teclado;
  - `UI-simplificacion`: una acción principal por vista y el resto en «Más ⋯», sin textos de ayuda bajo los campos (D-S3).

## 3. Decisiones (con la alternativa descartada)

- **D-P1. «Pintar ruta» es un interruptor del editor.** Es un botón con `aria-pressed` y el icono del lápiz, junto al mapa.
  - Activado, cada toque en el mapa añade un punto al final. Desactivado, tocar el mapa no añade nada: el mapa se mueve y se amplía como siempre.
  - Arrastrar e insertar vértices, deshacer, borrar y la lista de coordenadas funcionan con el interruptor en cualquier posición.
  - Al **dibujar** empieza activado; al **editar**, desactivado (lo normal es retocar).
  - Con teclado: el interruptor se alcanza con Tab y se activa con Espacio o Enter. Los puntos se pueden escribir en la lista de coordenadas.
  - *Descartado:* mantener pulsado para añadir. No se descubre y choca con el arrastre del mapa en móvil.
- **D-P2. Al dibujar, la casilla «unir los puntos siguiendo los caminos» viene desmarcada.** La casilla se queda tal cual.
  - Motivo: dibujar a mano se usa precisamente cuando el camino no está en la red (decisión 1).
  - *Descartado:* quitar la casilla. Unir por los caminos sigue siendo útil para trazar rápido por pistas conocidas.
- **D-P3. Dibujar desde la misión.**
  - La sección «Rutas de la misión», en su «Más ⋯» y junto a «Generar rutas», gana **«Pintar ruta»**, que abre `/routes/draw?mission=<id>`. Solo aparece con la misión abierta y con origen (RN-08, como generar).
  - El editor lee la misión:
    - selector de origen si hay varios;
    - el primer punto es el **origen elegido** (cambiar de origen mueve ese primer punto);
    - el objetivo se ve en el mapa;
    - el botón «**Terminar en el objetivo**» añade el objetivo como último punto.
  - El nombre es obligatorio y se propone el del origen, como al generar (D-N1).
  - Al guardar, `createRoute` con `addToMission: { missionId, originPointId }` y vuelta a la misión con el aviso de que se ha añadido.
  - *Descartado:* un diálogo dentro de la misión. Duplicaría el editor y su accesibilidad.
- **D-P4. «Continuar a mano»** es una vista nueva del editor, `/routes/:routeId/continue?base=<versionId>[&mission=<id>]`, con dos pasos en el mismo panel:
  1. **Hasta dónde vale.**
     - Se ve la versión base.
     - Tocar la línea elige el corte, proyectado sobre ella. También hay un campo numérico accesible, «Conservar los primeros N km», que mueve el corte.
     - La parte conservada se pinta con el color de la ruta y lo que se descarta, atenuado.
     - Se muestran los km conservados.
  2. **Tramo a mano.**
     - Con «Pintar ruta» activado, cada toque añade un punto después del corte.
     - Hay deshacer, borrar punto y lista de coordenadas.
     - Desde una misión, también «Terminar en el objetivo».

  Al guardar se llama a `createRouteVersion` con `continueFrom` y se va al detalle de la ruta en la versión nueva.

  Entradas:
  - en el detalle de la ruta, «Más ⋯ → **Continuar a mano**» (solo con la ruta activa y quien escribe);
  - en el «⋯» de la fila de la misión, la misma acción, con `?mission=`.

  *Descartado:* resolverlo dentro de «Editar ruta». El editor simplifica a 150 vértices y no conserva la composición.
- **D-P5. Composición.**
  - Al continuar, la parte conservada guarda los tipos de vía de la versión base, recortados en el corte, y el tramo a mano es `offtrail` («Sin camino»). Así `offTrailShare` y la barra de tipos de vía avisan al coordinador de cuánto va fuera de la red.
  - Las rutas dibujadas enteras en línea recta siguen siendo `unknown` (RF-503 sin cambios).
  - *Descartado:* marcar también como `offtrail` las dibujadas enteras. Un trazado a mano puede seguir una pista que la red sí tiene, y cambiar RF-503 no se ha pedido.
- **D-P6. La versión nueva no se fija sola en la misión.**
  - Queda en *Borrador*. Si se continuó desde una misión, al volver el aviso dice: «Versión N guardada como borrador. Valídala para poder fijarla en la misión.»
  - Fijarla es el flujo ya existente: el aviso RF-518 y `updateMissionRoute`.
  - *Descartado:* fijar el borrador al momento. En una misión activa, el rescatista dejaría de ver la versión validada que tenía (solo ve validadas y fijadas, regla 4).
- **D-P7. Corte y proyección, en `packages/geo`:**
  - `projectOnLine(line, point) → { index, point, distanceM, offsetM }`: el vértice más cercano de la línea preparada, que está densificada a ≤ 30 m, así que el error es ≤ 15 m;
  - `pointAtDistance(line, distanceM)`;
  - `cutAt(line, index)`.

  El servidor rechaza el corte si `offsetM > 200` o si `index === 0` (`VALIDATION_FAILED`, `path: continueFrom.cutPoint`). La web usa las mismas funciones para la vista previa.

  *Descartado:* proyectar sobre el segmento con interpolación. Añade un vértice que no está en la versión base y complica recortar los tramos, y con vértices cada ≤ 30 m no se nota.
- **D-P8. Límites.**
  - `continueFrom.points`: de 1 a 200 puntos; la línea resultante pasa por `measure`, con sus límites.
  - La versión base puede ser cualquier versión de la ruta, borrador o validada (`baseVersionId`, como hoy).
  - Con la ruta archivada, `INVALID_STATE_TRANSITION`, como hoy.

## 4. Qué cambia, por carpeta

**`packages/geo`**
- `src/geometry.ts`, o un archivo nuevo `src/cut.ts` exportado en `src/index.ts`: `projectOnLine`, `pointAtDistance` y `cutAt` (D-P7).
- Pruebas: `test/geometry.test.ts` o `test/cut.test.ts`.

**`packages/contracts`**
- `src/routes.ts`: `CreateVersionRequest`.
  - `geometry` pasa a opcional.
  - Nuevo campo opcional `continueFrom: z.strictObject({ cutPoint: LatLon, points: z.array(LatLon).min(1).max(200) })`.
  - `superRefine`: exactamente uno de los dos; con `continueFrom` no se admite `calculationJobId`.
- `src/endpoints.ts`, nota de `createRouteVersion`: «Con `continueFrom` el servidor conserva la versión base hasta el punto de corte (proyectado; a más de 200 m o en el inicio, VALIDATION_FAILED), con sus tipos de vía, y une en línea recta los puntos a mano, que cuentan como sin camino (offtrail).»
- `test/behavior.test.ts`. Se regeneran `openapi.json` y el doc 06 (`gen:openapi`, `gen:doc`; la fila se copia a mano en el doc 06).

**`apps/api`** (`src/routes/`)
- `route-writes.service.ts`, en `createVersion`, cuando hay `body.continueFrom`:
  1. Se lee la geometría de la versión base y sus `route_segments` ordenados por `position`, de la organización.
  2. `projectOnLine` da el corte; se rechaza si queda lejos o en el inicio.
  3. Los vértices son `base[0..index]` más los `points`.
  4. Los `stretches` son los tramos de la base, con índices reconstruidos por el número de vértices de cada `geom` y recortados en `index`, más `{ fromIndex: index, toIndex: last, roadType: 'offtrail' }`.
  5. `measurement.measure(vertices, stretches)`.
  6. Se crea la versión con `provenance: 'edited'` y `manuallyModified: true`, y la auditoría `route_version_created` con `detail` más `continued: true` y `keptDistanceM`.

  Puede salir un método privado `continuedLine(orgId, versionId, continueFrom)`.
- `routes.controller.ts`: sin cambios; el cuerpo lo valida el contrato.
- Pruebas: `test/api/routes-writes.test.ts` (o un archivo nuevo, `test/api/routes-continue.test.ts`) y `test/unit/` si sale lógica pura en el servicio.

**`apps/web`**
- `src/pages/route-editor-page.tsx`:
  - interruptor «Pintar ruta» (D-P1), con `onPick` solo cuando está activado;
  - `snap` desmarcado por defecto (D-P2);
  - con `?mission=`: lectura de la misión, origen, objetivo, «Terminar en el objetivo», nombre propuesto, `addToMission` y vuelta a la misión (D-P3).

  Si el archivo crece mucho, el panel de la misión va a `src/library/` (componente nuevo).
- Nuevo modo `continue` (D-P4): `RouteEditorPage mode="continue"` o una página propia `src/pages/route-continue-page.tsx`, a criterio del implementador. Debe compartir el interruptor y la lista de coordenadas, sin duplicar el reducer.
- `src/app/routes.tsx` y `src/nav/navigation.ts`: la ruta `/routes/:routeId/continue`, con permiso `MISSION_WRITERS`.
- `src/pages/route-detail-page.tsx`: «Más ⋯ → Continuar a mano».
- `src/missions/mission-routes-section.tsx`:
  - «Más ⋯ → Pintar ruta» en la sección;
  - «Continuar a mano» en el «⋯» de cada fila (`?mission=`).
- `src/map/`, si hace falta: pintar la parte descartada atenuada, con un tono existente de `route-layers.ts`, sin colores nuevos fuera de `tokens.css`.
- Pruebas: `test/route-editor.test.tsx`, `test/mission-routes.test.tsx`, `test/route-detail.test.tsx` y un archivo nuevo, `test/route-continue.test.tsx`.

**`packages/i18n`** (`src/es.ts`, `fr.ts`, `types.ts`): textos de pintar, terminar en el objetivo, continuar a mano, km conservados, corte lejos de la ruta y aviso de borrador sin fijar.

**`apps/web/e2e`**: nuevo `pintar-ruta-demo.spec.ts`, en escritorio y a 375 px (francés con teclado), sobre la red inventada.

**Sin cambios:** `db/`, `data/seed`, `infra/`.

## 5. Puertos implicados

- `ElevationProvider`: mide la línea combinada, como siempre.
- `RoutingProvider`: no se usa al continuar (decisión 1). Al dibujar desde la misión, solo si se marca «unir por los caminos».

## 6. Riesgos

- **Reconstruir los índices de los tramos guardados.** Se supone que las `geom` de `route_segments` son trozos consecutivos de la geometría de la versión que comparten un vértice. Si en alguna versión no es así (por ejemplo, importadas antiguas con un solo tramo `unknown`), el resultado tiene que seguir siendo correcto: un tramo `unknown` hasta el corte. Hay que probarlo con una versión generada (varios tramos) y con una dibujada (uno solo).
- **`prepareLine` vuelve a densificar** la parte conservada, que ya está preparada. No debe moverla: hay que comprobar que la distancia conservada coincide con la medida de la versión base hasta el corte, con 1 m de tolerancia.
- **Toques accidentales en móvil.** El interruptor lo evita. A 375 px el botón debe verse sin desplazarse por la página.
- **Vista previa frente a resultado.** La web solo pinta la vista previa; lo que manda es la versión guardada, que mide el servidor.

## 7. Verificación

- **Por tarea:** `pnpm check <paquetes>`. Si la tarea toca un INV, también `pnpm --filter @onway/api test:api <archivo>`.
- **Pruebas contra base real (`test:api`):**
  - INV-04: la versión base, con su geometría, métricas y tramos, queda idéntica;
  - INV-16: una línea `route_version_created` con `continued: true`;
  - INV-01: 404 para otra organización;
  - regla 2: 403 para el administrador y el rescatista;
  - ruta archivada: 409;
  - corte a más de 200 m y corte en el inicio: 400;
  - composición: los tipos de la base hasta el corte más `offtrail`;
  - regla 6: el cliente no puede mandar la geometría a la vez;
  - INV-11: dibujar desde una misión cerrada con `addToMission` responde `MISSION_CLOSED` y no deja ruta (ya existe; se repite en el E2E).
- **Demostración** (`pintar-ruta-demo.spec.ts`):
  1. Desde una misión: «Pintar ruta» empieza en el origen, el interruptor activado añade puntos y desactivado no, «Terminar en el objetivo», guardar, y la ruta aparece en la misión.
  2. Se genera una ruta desde la misión y luego, desde su fila, «Continuar a mano»: corte en «Conservar los primeros N km», tres puntos, «Terminar en el objetivo», guardar. Queda la versión 2 en borrador con «Sin camino» en la composición y la versión 1 intacta.
  3. En francés y solo con teclado: el interruptor y el campo de km.
  4. A 375 px, sin desbordes.
- **Completa al cerrar:** la de `CLAUDE.md` («Verificación completa») y el E2E con `CI=1` en `onway-e2e`.

## 8. Documentos que hay que actualizar

- **Doc 01** (registro de cambios):
  - RF-505: modo «Pintar ruta» y «Continuar a mano», que conserva hasta un corte y sigue en línea recta;
  - RF-503: la parte conservada mantiene su composición y el tramo a mano es «sin camino»;
  - RF-513: dibujar desde la misión.
- **Doc 02** (registro):
  - §3.5: «Pintar ruta» en la sección de rutas y «Continuar a mano» en la fila;
  - §3.6: editor con interruptor, casilla desmarcada y vista «Continuar a mano»;
  - §3.6, detalle de la ruta: «Más ⋯» gana «Continuar a mano»;
  - §4.3 B: dibujar construido, con su «Tal como se construyó» al final.
- **Doc 03**, si procede: §16, que la auditoría de versión creada anote «continuada a mano». Sin estados ni invariantes nuevos.
- **Doc 06** (registro, v1.12): nota y cuerpo de `createRouteVersion`. Se regenera.
- **Doc 07**: subsección nueva tras «Issue · Nombre de las rutas…», con Demostración, Alcance, Operaciones (0 nuevas, 1 cambia), Salida y Fuera, y la fila «Tal como se construyó» al cerrar. Más su registro (§8).
- `docs/estado.md` y `docs/historial.md`, al cerrar.
