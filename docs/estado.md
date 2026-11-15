# OnWay — Estado del proyecto

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/historial.md`. Sin recuentos de pruebas: se obtienen ejecutándolas. Repositorio: https://github.com/CristianAntVal85/OnWay.git

Última actualización: 2026-11-14

## Dónde estamos
- MVP (H0 a H4), `H5-acceso` y `UI-rediseno` validados y fusionados en `main`.
- Issues #17 (eliminar rutas) y #18 (tarjeta del tiempo simple): implementadas y validadas, en una pull request conjunta.
- Rama: `hito/issues-17-18-rutas-y-tiempo`.

## Siguiente paso
- Fusionar la pull request conjunta. El CI no arranca por la facturación de la cuenta de GitHub: revisarla, o validar con la verificación completa en local.
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
- Backlog tras el MVP: `docs/backlog-post-mvp.md`.
