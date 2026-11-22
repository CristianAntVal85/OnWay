# OnWay — Estado del proyecto

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/historial.md`. Sin recuentos de pruebas: se obtienen ejecutándolas. Repositorio: https://github.com/CristianAntVal85/OnWay.git

Última actualización: 2026-11-22

## Dónde estamos
- En `main`: MVP (H0 a H4), `H5-acceso`, `UI-rediseno`, issues #17 y #18 (PR #21), `UI-simplificacion` con el fondo topográfico (PR #23, #24, #25 y #27), nombre de las rutas y desvincular (PR #26) pintar ruta y continuar a mano (PR #29), todo validado por sus revisores, y tres ajustes de interfaz (PR #31: nombre de ruta de la misión a su detalle con vuelta, historial plegado, sin botón «Tiempo» en Mis misiones; doc 02 v1.8).
- `H5-perfil` y `H5-habilidades` fusionados (PR #32 y #33). `H5-usuarios` (lista, ficha, cambiar rol, desactivar con reasignación de misiones y reactivar; migración 0014) validado por sus cuatro revisores tras una vuelta de correcciones (`specs/H5-usuarios/`); pull request abierta desde `hito/H5-usuarios`.
- El CI de GitHub Actions no arranca por la facturación de la cuenta: la verificación completa se hace en local.

## Siguiente paso
- Fusionar la pull request de `H5-usuarios` y `docker compose up --build` en la pila `onway` (aplica la migración 0014).
- Luego `/sdd-plan H5-equipos`: 7 operaciones con `listRescuers`, D-34, el alias (Q-36, B-02) y el selector de RF-805.

## Pendiente del usuario
- Ver el pintado real del mapa de carreteras en oscuro y en claro con la pila `onway` reconstruida.
- Ver `forced-colors` en Windows real.
- Revisar los pesos del perfil de montaña (H3, `specs/H3-generacion-rutas/revision-pesos.md`).
- Decisiones abiertas (a) a (k): están en `docs/historial.md`.
- Bajos sin corregir de `H5-perfil` (`specs/H5-perfil/tasks.md`) y de `H5-habilidades` (límite de 50 sin bloqueo, `files_insert` sin comprobar el rol, `skills_guard` sin mirar `deleted_at`, certificados huérfanos, clave del enlace por proceso, un certificado en dos entradas, lectura del personal; `specs/H5-habilidades/tasks.md`) y de `H5-usuarios` (smoke con paginación de archivadas, carrera al degradar un coordinador, cerrojo de `LAST_ADMIN`, tamaños táctiles; `specs/H5-usuarios/tasks.md`).

## Hechos que conviene recordar
- Tras cambiar de rama o fusionar: `docker compose up --build` en la pila `onway`.
- Claves de datos sensibles en el volumen `secrets`: si se pierden, se pierden documento y dirección (`infra/README.md`). Perfil incompleto de la semilla: `rescatista6`.
- En la pila `onway` la misión de semilla «Valle de Ordesa» está cerrada a mano: el smoke falla ahí (estado de la pila).
- E2E sin tocar la pila de desarrollo: proyecto `onway-e2e`, puerto 18080. Si acumula rutas archivadas, recrear con `down -v`.
- Una sola organización en la demostración; no validar a mano la «Variante de la Pradera».
- Una ruta archivada que quedó en una misión cerrada no se puede eliminar (D-I6).
- Pruebas intermitentes: `test/unit/hgt.test.ts` (límite 5 s) y `h2-demo.spec.ts:352` (móvil).
