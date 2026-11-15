---
description: Spike · prueba de concepto acotada para despejar un riesgo (uso - /spike aemet-proveedor)
model: claude-sonnet-5-5
---
Spike: $ARGUMENTS

Vía de spike de la skill sdd.
1. Dime en tres líneas qué pregunta responde y cuál es la prueba mínima.
2. Trabaja en `spikes/$1/`. Código desechable: sin pruebas ni arquitectura. Solo datos ficticios y sin secretos.
3. Si un paso necesita que yo haga algo a mano, dímelo con el comando exacto y espera.
4. Escribe `specs/spikes/$1.md`: qué se probó, qué pasó (con salidas reales), qué se decide y qué queda abierto.
5. Actualiza `docs/estado.md`.

No reutilices el código del spike en `apps/` o `packages/`, y no toques la pila `onway` del usuario.
