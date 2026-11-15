---
description: Vía de cambio pequeño · un ajuste con su prueba, sin operaciones nuevas (uso - /feature ordena la lista de rutas archivadas por fecha)
model: claude-sonnet-5-5
---
Cambio pequeño: $ARGUMENTS

Vía de cambio pequeño de la skill sdd, en este hilo y sin subagentes:
1. Dime en tres líneas: qué cambia, en qué archivos y cómo se comprueba. Sigue sin esperar aprobación, salvo que haya una decisión que me corresponda o que el cambio contradiga un documento; en ese caso pregunta solo eso.
2. Escribe la prueba primero o junto al cambio.
3. Ejecuta la comprobación rápida (`pnpm check`, sección 3 de la skill).
4. Commit según la sección 4 de la skill.
5. Resume el resultado. Actualiza `docs/estado.md` solo si cambia el siguiente paso.

Si el cambio necesita una operación nueva o toca `packages/contracts`, `db/`, permisos, sesión, datos personales o un invariante, para y propón `/sdd-plan`.
