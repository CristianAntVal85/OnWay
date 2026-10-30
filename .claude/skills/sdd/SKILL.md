---
name: sdd
description: Úsala siempre que trabajes un hito de OnWay con el flujo SDD ligero - planificar (specs/Hn-nombre/plan.md y tasks.md), implementar tareas, validar contra la definición de terminado del doc 07, o cambiar el alcance de un hito. También para orquestar con los subagentes planner/implementer/reviewer.
---

# SDD ligero para OnWay

El *qué* de OnWay ya está escrito en `docs/01`–`06` y el alcance de cada hito en `docs/07-plan-de-implementacion.md`. **No se redacta una spec nueva por hito**: se planifica a partir de esos documentos.

## Flujo
Plan → Tareas → Implementación → Validación → Cambio.

- Nunca pases a la siguiente fase sin aprobación explícita del usuario.
- Un hito por vez, en `specs/Hn-nombre/` (p. ej. `specs/H0-cimientos/`) con `plan.md` y `tasks.md`.
- Si falta una decisión o algo contradice los documentos: para y pregunta. Si cambia una decisión, se edita el documento y se anota en su registro de cambios.
- Al terminar cada fase, actualiza `docs/estado.md`.

## Entradas obligatorias
`CLAUDE.md`, `docs/constitution.md`, `docs/estado.md`, la sección del hito en el doc 07 y los identificadores (RF, RN, INV, Q, operaciones con `x-milestone`) que cita, abiertos en los docs 01–06. No se montan operaciones de otros hitos.

## plan.md
Alcance (identificadores y operaciones) · Qué cambia, por carpeta: `apps/api`, `apps/web`, `packages/*`, `db/`, `infra/`, `data/seed` · Puertos implicados · Decisiones con alternativa descartada · Riesgos del hito · Verificación: pruebas por INV, demostración del hito como prueba extremo a extremo, comandos exactos · Qué documentos habrá que actualizar.

## tasks.md
```
- [ ] **Tn. <Descripción>.** RF/INV/operaciones que cubre
- Hecho cuando: <comprobación verificable>.
- Cierre: commit `<tipo>(Hn): Tn <resumen en inglés>` + push a la rama del hito.
```
Máximo 10 tareas, en orden de dependencia, cada una de unas horas. Si salen más, se parte el hito **por demostración**, no por capa técnica.

## Implementación
Una tarea por vez, pruebas primero (una por cada INV tocado, contra base real). Ejecuta los comandos de verificación de `CLAUDE.md`; con cambios de interfaz, revisa también en vista móvil. Marca la tarea, haz el cierre (commit y push) y para.

### Cierre de cada tarea: commit y push
Autorizado de forma permanente por el usuario (2026-10-30), solo con este alcance:
- **Rama por hito:** `hito/Hn-nombre`, creada desde `main` al empezar el hito. Nunca se hace push directo a `main`; se fusiona al validar el hito.
- **Solo con todo en verde:** pruebas y typecheck/build de lo tocado. Si algo falla, no hay commit: se corrige o se para y se avisa.
- **Un commit por tarea**, con la marca de la tarea en `tasks.md` y `docs/estado.md` incluidos. Mensaje en inglés: `<tipo>(Hn): Tn <resumen>` con tipo `feat|fix|test|docs|chore|refactor`, y la línea `Co-Authored-By` de la atribución vigente.
- Añade los archivos por nombre: nunca `git add -A`, y jamás `.env` ni secretos.
- Push a la rama del hito (`git push -u origin <rama>` la primera vez). Sin `--force`, sin tocar historial ya publicado.
- Un push fallido se comunica; no se reintenta con otras opciones.

## Validación
Se usa la **sección 4 del doc 07** (12 criterios) como lista, más la demostración del hito. Veredicto: APROBADO o CAMBIOS NECESARIOS, con `archivo:línea` y el criterio incumplido.

## Orquestación
Si el usuario pide el flujo completo, el hilo principal solo coordina: `planner` (plan y tareas), `implementer` (una tarea por llamada), `reviewer` (validación), con la herramienta Agent. El subagente `coordinator` ofrece la garantía técnica de que no se toca código directamente. Los subagentes no ven la conversación: pásales fase, petición del usuario, rutas a leer y el resultado de la fase anterior. Máximo 2 vueltas de correcciones.
