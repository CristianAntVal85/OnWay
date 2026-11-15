---
description: SDD · Implementa tareas de un plan aprobado (uso - /sdd-implement H5-perfil T3, o sin tarea para seguir en orden)
model: claude-sonnet-5-5
---
Implementa las tareas de `specs/$1/tasks.md` siguiendo `specs/$1/plan.md`, `CLAUDE.md`, `docs/constitution.md` y la skill sdd. Si indico una tarea ($2), solo esa; si no, continúa en orden desde la primera pendiente.

Por cada tarea:
1. Pruebas primero: una por cada INV-xx tocado, contra base real. Contrato primero si cambia el API.
2. Implementa lo mínimo que cumple el «Hecho cuando».
3. Ejecuta la línea «Comprobación» de la tarea (comprobación rápida, sección 3 de la skill: `pnpm check <paquetes>`). Si falla, corrige; no hay commit en rojo.
4. Marca la tarea y haz el commit (sección 4 de la skill). Sin push.

Sigue con la siguiente sin pedirme permiso. Para solo si el plan es incorrecto o imposible, si falta una decisión mía o si necesitas que haga algo a mano. Al terminar o al parar, haz el push de respaldo de la rama (sección 4 de la skill) y resume: tareas hechas e identificadores que cubren, verificaciones y decisiones que el plan no cubría.
