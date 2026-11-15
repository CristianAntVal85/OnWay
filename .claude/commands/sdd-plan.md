---
description: SDD · Plan y tareas de un hito, en un solo paso (uso - /sdd-plan H5-perfil)
model: claude-opus-5-5
---
NO escribas código. Usa la skill sdd. Lee `CLAUDE.md`, `docs/constitution.md`, `docs/estado.md` y la sección del hito $1 en `docs/07-plan-de-implementacion.md`, y abre en los docs 01–06 cada identificador que cite. Revisa el código existente afectado.

Genera `specs/$1/plan.md` y `specs/$1/tasks.md` con las plantillas de la sección 2 de la skill. En «Contexto para el implementador», cita cada requisito por su identificador y copia su texto mínimo, para que el implementador no tenga que abrir los docs 01–06. Máximo 10 tareas, cada una con sus líneas «Archivos» (rutas reales) y «Comprobación» (comando exacto); si salen más, propón partir el hito por demostración.

Si falta una decisión o hay una contradicción, para y pregunta (máximo 5 preguntas). Si no, muéstrame un resumen y espera mi aprobación del plan y las tareas juntos.
