# AGENTS.md — OnWay

Punto de entrada para agentes de código. **No duplica nada**: la fuente de verdad es:

1. `CLAUDE.md` — resumen operativo, reglas inviolables, comandos y convenciones.
2. `docs/constitution.md` — principios innegociables.
3. `docs/01`–`06` — qué y cómo; `docs/07-plan-de-implementacion.md` — hitos H0–H9 y definición de terminado.
4. `docs/estado.md` — en qué hito estamos y el siguiente paso; `docs/historial.md` — decisiones tomadas por el camino.

## Antes de tocar nada
- Lee `docs/estado.md` y la sección del hito en curso del doc 07.
- Si algo contradice los documentos, o falta una decisión: para y pregunta.
- Dependencia nueva, cambio de stack o de esquema ya aplicado: pregunta antes.

## Elegir la vía (skill `sdd`)
La ceremonia es proporcional al cambio. En caso de duda, la vía más ligera, y se sube si el cambio crece:
- `/quick` — trivial: texto, estilo, botón, bug obvio, renombrado. Sin plan.
- `/feature` — pequeño: un ajuste con su prueba, dentro de un módulo, sin operaciones nuevas.
- `/spike` — prueba de concepto desechable en `spikes/`, con su informe en `specs/spikes/`.
- `/sdd-plan` → `/sdd-implement` → `/sdd-validate` — hito o issue con alcance. Siempre si toca `packages/contracts`, `db/`, permisos, sesión, datos personales o un invariante (INV-xx).

En la vía de hito, cada hito vive en `specs/Hn-nombre/` con `plan.md` y `tasks.md` (máx. 10 tareas con «Hecho cuando:»); el *qué* ya está en los documentos y no se reescribe. **Una sola aprobación** (plan y tareas juntos); después se implementa en orden sin parar entre tareas y se valida una vez, al final, con la sección 4 del doc 07. `/sdd-status` y `/sdd-change` para el estado y los cambios de alcance.

Commits y ramas: skill `sdd`, sección 4.

## Verificación
Dos niveles (rápida por tarea, completa al cerrar el hito): sección «Verificación» de `CLAUDE.md`.

`docs/estado.md` tiene un máximo de 30 líneas. El historial va a `docs/historial.md`.
