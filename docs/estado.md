# OnWay — Estado del proyecto

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/historial.md`. Sin recuentos de pruebas: se obtienen ejecutándolas. Repositorio: https://github.com/CristianAntVal85/OnWay.git

Última actualización: 2026-11-21

## Dónde estamos
- MVP (H0 a H4), `H5-acceso` y `UI-rediseno` validados y fusionados en `main`.
- Issues #17 y #18: implementadas y validadas, en una pull request conjunta.
- `UI-simplificacion` (menos botones, menús, boceto de `docs/boteto-interface/`, fondo topográfico): validado por `reviewer` y `reviewer-ui` el 2026-11-21 y fusionado en `main` (PR #23, #24 y #27).
- Nombre de las rutas y desvincular (`specs/issue-rutas-nombre-y-desvincular/`): T1 a T8 hechas en `hito/issue-rutas-nombre`; validado por los cuatro revisores el 2026-11-21; PR #26 abierta.

## Siguiente paso
- Fusionar la PR #26 (nombre de las rutas y desvincular).
- Fusionar la pull request de las issues #17 y #18 (el CI no arranca por la facturación de GitHub).
- Después: el resto de H5 (perfil, habilidades, equipos, usuarios, `changePassword`, `updateMe`) con `/sdd-plan`.

## Pendiente del usuario
- Ver el pintado real del mapa de carreteras en oscuro y en claro con la pila `onway` reconstruida.
- Ver `forced-colors` en Windows real.
- Revisar los pesos del perfil de montaña (H3, `specs/H3-generacion-rutas/revision-pesos.md`).
- Decisiones abiertas (a) a (k): están en `docs/historial.md`.

## Hechos que conviene recordar
- Tras cambiar de rama o fusionar: `docker compose up --build` en la pila `onway`.
- E2E sin tocar la pila de desarrollo: proyecto `onway-e2e`, puerto 18080. Si acumula rutas archivadas, recrear con `down -v`.
- Una sola organización en la demostración; no validar a mano la «Variante de la Pradera».
- Una ruta archivada que quedó en una misión cerrada no se puede eliminar (D-I6).
- Pruebas intermitentes: `test/unit/hgt.test.ts` (límite 5 s) y `h2-demo.spec.ts:352` (móvil).
