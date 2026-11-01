# PoC · Prueba técnica del motor de rutas — Tareas

Estado: **aprobadas por el usuario (2026-11-01)** · Plan aprobado el 2026-11-01 (`plan.md`); **orden cambiado por el usuario el mismo día (P7): T1, T2, T4, T5, y después se decide T3 (Valhalla) antes de T6** · Rama `poc/motor-rutas` · 7 tareas, en orden de dependencia. Un commit y un push por tarea, solo con todo en verde (`pnpm lint`, `pnpm format:check` y `pnpm typecheck` no deben romperse). Mensaje: `<tipo>(PoC): Tn <resumen en inglés>` + `Co-Authored-By`. Archivos añadidos por nombre. **Antes de bajar nada por encima de unos GB o de lanzar una imagen que no esté comprobada, aviso.**

- [x] **T1. Datos y casos.** Plan §0 P2 y P3, §4 y §6.
- Licencias de GraphHopper, Valhalla y `osmium-tool` comprobadas en sus fuentes oficiales y anotadas (fecha y enlace) en `poc/motor-rutas/README.md`; versiones fijadas (la imagen de `osmium` por huella; las de GraphHopper y Valhalla se fijan por huella en T2 y T3, que son quienes las usan). Extracto OSM de los Pirineos (España y Francia) descargado por regiones y recortado una sola vez con un script (`poc/motor-rutas/scripts/`), con su fecha y suma de comprobación; `.data/` en `.gitignore`. Las coordenadas exactas de los 3 pares (Refugio de Coronas → Aneto, Parking de Bujaruelo → Brecha de Rolando, Parking de Ordesa → Monte Perdido) tomadas de OSM, y comprobado si el par 2 pasa por Francia. `cases/*.json` con los 3 pares y los umbrales del plan §4.
- Hecho cuando: un clon limpio ejecuta el script y deja el mismo extracto (misma suma); `cases/` valida contra un esquema sencillo comprobado por `run-cases.mjs --check`; licencias anotadas; `pnpm lint`, `format:check` y `typecheck` en verde.
- Cierre: commit `chore(PoC): T1 add Pyrenees extract script, licences and test cases` + push a `poc/motor-rutas` (incluye `plan.md` y `tasks.md`).

- [x] **T2. GraphHopper.** Criterios 1, 2 y 4 (primera pasada) y D-PoC-03.
- `poc/motor-rutas/compose.yml` con GraphHopper y su tope de memoria; grafo construido con el extracto; perfil de montaña en un *custom model* con cada peso comentado (por qué ese valor); alternativas activadas; primera consulta de los 3 pares con distancia, tiempo y tipo de vía por tramo.
- Hecho cuando: `docker compose -f poc/motor-rutas/compose.yml up --wait graphhopper` arranca desde cero, responde a los 3 pares con ≥ 1 ruta y se ve su composición; memoria de carga anotada; sin tocar `compose.yml` de la raíz.
- Cierre: commit `feat(PoC): T2 add GraphHopper with a mountain profile` + push.

- [x] **T3. Valhalla (condicional, P7; el usuario decidió hacerla aunque GraphHopper cumplía).** Mismos criterios que T2.
- Servicio de Valhalla en el mismo compose con su tope de memoria; teselas construidas con el extracto; costing peatonal ajustado a montaña (opciones de pendiente, pistas y dificultad, nombres comprobados en la documentación de la versión fijada); primera consulta de los 3 pares con alternativas.
- Hecho cuando: `up --wait valhalla` arranca desde cero y responde a los 3 pares; memoria de carga anotada.
- Cierre: commit `feat(PoC): T3 add Valhalla with a mountain profile` + push.

- [x] **T4. Corredor de casos.** Criterios 1, 2, 4, 5 y 8.
- `run-cases.mjs` (Node 24, sin dependencias nuevas): lee `cases/`, pide a cada motor, calcula solapamiento entre alternativas, composición (`road`/`track`/`path`) desde el inicio del sendero, tiempo (10 repeticiones tras calentar, p95) y pico de memoria del contenedor; escribe un JSON en `results/`.
- Hecho cuando: un solo comando produce la tabla criterio × motor × par (hoy solo GraphHopper: Valhalla es condicional, P7); el cálculo del solapamiento y de la composición tiene pruebas con casos sintéticos (Vitest en `poc/` o `node --test`, sin entrar en el CI).
- Cierre: commit `feat(PoC): T4 add case runner with overlap, mix, timing and memory` + push.

- [x] **T5. Pendientes, zonas a evitar y ajuste a caminos.** Criterios 3, 6 y 7 y D-PoC-01.
- Pendiente máxima de cada ruta medida con **nuestra** medición (`packages/geo` y `ElevationProvider` sobre el DEM local), sin la altitud del motor; caso con dos valores del límite de pendiente; caso de polígono a evitar sobre la ruta principal; caso de polilínea tosca (±30 m) para ajustar a los caminos (map matching).
- Hecho cuando: el corredor evalúa los tres criterios en los dos motores; se anota cuáles no soporta un motor; sin código nuevo en `apps/` ni en `packages/` (solo se importa lo que exista).
- Cierre: commit `feat(PoC): T5 add slope, avoid-area and snap cases` + push.

- [x] **T6. Comparación y corte.** (propuesta escrita en `results/veredicto.md`; la elección del motor es del usuario) Plan §0 P5 y P3.
- Tabla completa con los 8 criterios; motor elegido con su razón, o parada. Si el lado francés queda sin medir (plan P3), decisión sobre añadir un par extra (por ejemplo Gavarnie → Vignemale).
- Hecho cuando: hay veredicto por criterio y por motor en `results/`; si ninguno cumple, **paro y te consulto** antes de seguir (no se empieza pgRouting).
- Cierre: commit `test(PoC): T6 compare engines and choose one` + push.

- [ ] **T7. Informe y documentos.** Plan §2.
- Doc 04 §7.5 «Resultado de la prueba técnica» (motor, pesos del perfil, cifras, memoria, licencias), §7.3 (criterios 6–8 y los 3 pares) y §11.1 (memoria medida) con su registro de cambios; doc 07 §6 (prueba resuelta) y «Antes de empezar» de H3; doc 01 R-01; lo que `RoutingProvider` necesita (plan §3); `docs/estado.md`; los casos quedan como regresión para H3.
- Hecho cuando: `pnpm format:check` y los documentos coinciden entre sí; validación con el `reviewer` contra los criterios del plan §4 (máx. 2 vueltas) y, tras tu aprobación, PR `poc/motor-rutas` → `main` con commit de fusión (lo fusionas tú).
- Cierre: commit `docs(PoC): T7 record the engine decision and update documents` + push.
