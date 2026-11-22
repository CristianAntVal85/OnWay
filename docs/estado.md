# OnWay — Estado del proyecto

Memoria entre sesiones. **Máximo 30 líneas, una idea por línea.** Lo que ya no sirva para decidir el siguiente paso se mueve a `docs/historial.md`. Sin recuentos de pruebas: se obtienen ejecutándolas. Repositorio: https://github.com/CristianAntVal85/OnWay.git

Última actualización: 2026-11-22

## Dónde estamos
- En `main`: MVP (H0 a H4), `H5-acceso`, `UI-rediseno`, issues #17 y #18, `UI-simplificacion`, nombre de las rutas y desvincular, pintar ruta y continuar a mano, tres ajustes de interfaz (PR #31), `H5-perfil` y `H5-habilidades` (PR #32 y #33) y `H5-usuarios` (migración 0014).
- `H5-equipos` (equipos, `listRescuers`, D-34, el alias Q-36 con la migración 0015, el selector de equipo de la ruta RF-805 y el alias del responsable para el rescatista) validado por sus cuatro revisores tras una vuelta (`specs/H5-equipos/`); pull request abierta desde `hito/H5-equipos`. Con él, H5 queda completo.
- El CI de GitHub Actions no arranca por la facturación de la cuenta: la verificación completa se hace en local.

## Siguiente paso
- Fusionar la pull request de `H5-equipos` y `docker compose up --build` en la pila `onway` (aplica la 0015).
- Después `/sdd-plan H6`: voluntariado, cierre con asistencia, historial y privacidad (doc 07 §3, H6: 16 operaciones; `listParticipations`, `offerToMission`, `readUserSensitive`, `listAuditLog`…). Ahí se decide dónde se enseña el alias en las listas del personal y de voluntarios (backlog B-02).

## Pendiente del usuario
- Ver el pintado real del mapa de carreteras en oscuro y en claro con la pila `onway` reconstruida.
- Ver `forced-colors` en Windows real.
- Revisar los pesos del perfil de montaña (H3, `specs/H3-generacion-rutas/revision-pesos.md`).
- Decisiones abiertas (a) a (k): están en `docs/historial.md`.
- Bajos sin corregir de `H5-perfil` (`specs/H5-perfil/tasks.md`) y de `H5-habilidades` (límite de 50 sin bloqueo, `files_insert` sin comprobar el rol, `skills_guard` sin mirar `deleted_at`, certificados huérfanos, clave del enlace por proceso, un certificado en dos entradas, lectura del personal; `specs/H5-habilidades/tasks.md`) de `H5-usuarios` (smoke con paginación de archivadas, carrera al degradar un coordinador, cerrojo de `LAST_ADMIN`, tamaños táctiles; `specs/H5-usuarios/tasks.md`) y de `H5-equipos` (selector cortado a 375 px, tope de 200 equipos en el selector, alias de la semilla sin cerrojo; `specs/H5-equipos/tasks.md`).

## Hechos que conviene recordar
- Tras cambiar de rama o fusionar: `docker compose up --build` en la pila `onway`.
- Claves de datos sensibles en el volumen `secrets`: si se pierden, se pierden documento y dirección (`infra/README.md`). Perfil incompleto de la semilla: `rescatista6`.
- En la pila `onway` la misión de semilla «Valle de Ordesa» está cerrada a mano: el smoke falla ahí (estado de la pila).
- E2E sin tocar la pila de desarrollo: proyecto `onway-e2e`, puerto 18080. Si acumula rutas archivadas, recrear con `down -v`.
- Una sola organización en la demostración; no validar a mano la «Variante de la Pradera».
- Una ruta archivada que quedó en una misión cerrada no se puede eliminar (D-I6).
- Pruebas intermitentes: `test/unit/hgt.test.ts` (límite 5 s) y `h2-demo.spec.ts:352` (móvil).
