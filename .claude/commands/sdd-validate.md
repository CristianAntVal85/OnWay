---
description: SDD · Valida un hito contra la definición de terminado (uso - /sdd-validate H5-perfil)
model: claude-sonnet-5-5
---
NO arregles nada. Usa la skill sdd. Valida el hito $1:
1. Mira `git diff --stat main...` y decide qué revisores aplican según la sección 5 de la skill. Dime cuáles lanzas y por qué.
2. Levanta una vez la pila de revisión compartida (`onway-review`, puerto 18081; sección 5 de la skill).
3. Lanza primero `reviewer` con la dirección de la pila: él ejecuta la verificación completa y la demostración del hito. No la ejecutes tú en este hilo.
4. Si la verificación no falla, lanza en paralelo los especializados que apliquen, con la dirección de la pila y el apartado «Comprobado» del `reviewer`. Reúne los veredictos.
5. Retira la pila con `down -v`.

Termina con VEREDICTO: APROBADO o CAMBIOS NECESARIOS, con los hallazgos por gravedad. Si está aprobado, indica los pasos de cierre: push de la rama, pull request, `docs/estado.md` y la fila «Tal como se construyó» del doc 07.
