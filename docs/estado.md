# OnWay — Estado del proyecto

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/historial.md`. Sin recuentos de pruebas: se obtienen ejecutándolas. Repositorio: https://github.com/CristianAntVal85/OnWay.git

Última actualización: 2026-11-22

## Dónde estamos
- En `main`: MVP (H0 a H4), `H5-acceso`, `UI-rediseno`, issues #17 y #18 (PR #21), `UI-simplificacion` con el fondo topográfico (PR #23, #24, #25 y #27), nombre de las rutas y desvincular (PR #26) pintar ruta y continuar a mano (PR #29), todo validado por sus revisores, y tres ajustes de interfaz (PR #31: nombre de ruta de la misión a su detalle con vuelta, historial plegado, sin botón «Tiempo» en Mis misiones; doc 02 v1.8).
- Sin pull requests abiertas. Rama en curso: `hito/H5-perfil`.
- El CI de GitHub Actions no arranca por la facturación de la cuenta: la verificación completa se hace en local.

## Siguiente paso
- El resto de H5, partido en tres (decisión del usuario, 2026-11-22): `H5-perfil` (perfil, datos sensibles cifrados, `updateMe`, `changePassword`), luego `H5-habilidades` (habilidades y certificados) y `H5-equipos` (usuarios y equipos). Ahora: `/sdd-plan H5-perfil`.

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
