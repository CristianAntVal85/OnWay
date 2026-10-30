# AGENTS.md — OnWay

Punto de entrada para agentes de código. **No duplica nada**: la fuente de verdad es:

1. `CLAUDE.md` — resumen operativo, reglas inviolables, comandos y convenciones.
2. `docs/constitution.md` — principios innegociables.
3. `docs/01`–`06` — qué y cómo; `docs/07-plan-de-implementacion.md` — hitos H0–H9 y definición de terminado.
4. `docs/estado.md` — en qué hito estamos y qué decisiones se tomaron por el camino.

## Antes de tocar nada
- Lee `docs/estado.md` y la sección del hito en curso del doc 07.
- Si algo contradice los documentos, o falta una decisión: para y pregunta.
- Dependencia nueva, cambio de stack o de esquema ya aplicado: pregunta antes.

## Flujo por hito (SDD ligero)
Cada hito vive en `specs/Hn-nombre/` con solo dos archivos; el *qué* ya está en los documentos y no se reescribe:
- `plan.md` — alcance (identificadores), archivos a crear o tocar, decisiones con alternativa descartada, verificación.
- `tasks.md` — máx. 10 tareas, cada una con sus identificadores y «Hecho cuando:».

Cada tarea acaba con un commit y un push a la rama `hito/Hn-nombre`, solo con todo en verde (detalle en la skill `sdd`).

Fases: **plan → tareas → implementación (una tarea por vez) → validación con la sección 4 del doc 07**. No se pasa de fase sin aprobación. Skill `sdd` y comandos `/sdd-*` (`/sdd-plan`, `/sdd-tasks`, `/sdd-implement`, `/sdd-validate`, `/sdd-status`, `/sdd-change`). Para cambios pequeños, `/feature`.

## Verificación
- Contratos: `pnpm --filter @onway/contracts typecheck` y `test`.
- Esquema: `db/tests/run-postgis.sh` (PostGIS real, requiere Docker).
- Al añadirse `apps/*`: sus comandos se anotan en `CLAUDE.md`.
