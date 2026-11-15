---
name: sdd
description: Úsala siempre que vayas a cambiar código de OnWay - elegir la vía (directa, cambio pequeño, spike o hito), planificar un hito o una issue (specs/Hn-nombre/plan.md y tasks.md), implementar tareas, verificar, hacer commits, validar contra la definición de terminado del doc 07 o cambiar el alcance. También para orquestar con los subagentes planner, implementer y reviewer.
---

# SDD con tres vías para OnWay

El *qué* de OnWay está en `docs/01`–`06` y el alcance de cada hito en `docs/07-plan-de-implementacion.md`. **No se redacta una spec nueva por hito.** La ceremonia es proporcional al cambio: elige la vía más ligera que sirva. Las reglas inviolables de `CLAUDE.md` y `docs/constitution.md` se aplican en todas.

## 1. Vías

### Directa (`/quick`)
Cambios triviales: un texto, un estilo, un botón, un bug obvio, un renombrado. Sin contrato, base de datos, permisos ni invariantes.
- En el hilo principal. Sin plan, sin subagentes, sin revisor, sin tocar los documentos 01–07.
- Cambio, comprobación rápida, commit. Informe en dos líneas.
- Los textos nuevos van por `packages/i18n` en es y fr; los colores y espacios, por los tokens existentes.
- Si cambia la maquetación, una sola comprobación en el navegador a 375 px.
- Si resulta que toca una frontera o más de unos pocos archivos, para y propón subir de vía.

### Cambio pequeño (`/feature`)
Un ajuste con comportamiento nuevo dentro de un módulo, sin operaciones nuevas.
- En el hilo principal. Tres líneas de intención (qué, dónde, cómo se comprueba) y sigue sin esperar aprobación, salvo que haya una decisión del usuario pendiente.
- Prueba primero o junto al cambio. Comprobación rápida. Commit. Sin revisor.
- `docs/estado.md` solo si cambia el siguiente paso. Un documento 01–06, solo si el cambio contradice lo que dice.

### Spike (`/spike`)
Prueba de concepto para despejar un riesgo (como la del motor de rutas). Código desechable en `spikes/`.
- Resultado: `specs/spikes/<nombre>.md` con qué se probó, qué pasó, qué se decide y qué queda abierto.
- Sin pruebas ni revisor. El código del spike no se reutiliza sin pasar por otra vía.

### Hito (`/sdd-plan` → `/sdd-implement` → `/sdd-validate`)
Hitos del doc 07 e issues con alcance: operaciones, contrato, base de datos, permisos, sesión, datos personales o invariantes.
- Un hito por vez, en `specs/Hn-nombre/` (o `specs/issue-N-nombre/`) con `plan.md` y `tasks.md`.
- **Una sola aprobación:** el usuario aprueba plan y tareas juntos. Después se implementa en orden, sin pedir permiso entre tareas salvo bloqueo.
- Validación al final, no por tarea.
- Si falta una decisión o algo contradice los documentos: para y pregunta. Si cambia una decisión, se edita el documento y se anota en su registro de cambios.

## 2. Plan y tareas

### Entradas
`CLAUDE.md`, `docs/constitution.md`, `docs/estado.md`, la sección del hito en el doc 07 y los identificadores que cita (RF, RN, INV, Q, operaciones con `x-milestone`), abiertos en los docs 01–06. No se montan operaciones de otros hitos.

### plan.md
Alcance (identificadores y operaciones) · **Contexto para el implementador** · Qué cambia, por carpeta: `apps/api`, `apps/web`, `packages/*`, `db/`, `infra/`, `data/seed` · Puertos implicados · Decisiones con alternativa descartada · Riesgos · Verificación: pruebas por INV, demostración del hito como prueba extremo a extremo, comandos exactos · Rama · Qué documentos habrá que actualizar.

**Contexto para el implementador:** cita cada requisito por su identificador y copia aquí su texto mínimo (el enunciado del RF o del INV, la firma de la operación, la regla que aplica). El implementador no debería necesitar abrir los docs 01–06.

### tasks.md
```
- [ ] **Tn. <Descripción>.** RF/INV/operaciones que cubre
- Archivos: <rutas que se crean o tocan>.
- Comprobación: <comando exacto, p. ej. `pnpm check @onway/api` y la prueba del INV>.
- Hecho cuando: <comprobación verificable>.
```
Las líneas «Archivos» y «Comprobación» las escribe quien planifica tras mirar el código: el implementador no debería tener que explorar el repositorio ni componer comandos.
Máximo 10 tareas, en orden de dependencia, cada una de unas horas. Si salen más, se parte el hito **por demostración**, no por capa técnica.

## 3. Verificación en dos niveles

- **Rápida, por tarea:** `pnpm check [paquete…]` (`lint`, `typecheck` y las pruebas unitarias de los paquetes tocados; sin argumentos, los que tienen cambios sin confirmar). Si la tarea toca un INV, también su prueba contra base real. Con cambios de maquetación, una comprobación a 375 px.
- **Completa, al cerrar el hito:** los comandos de verificación completos de `CLAUDE.md` (incluidos `test:db`, `test:api` y `db/tests/run-postgis.sh` si aplican), la demostración del hito y el E2E con `CI=1` en la pila `onway-e2e`. **Se ejecuta una sola vez por validación:** la hace el `reviewer` y su resultado se pasa a los revisores especializados, que no la repiten (solo relanzan una prueba concreta para demostrar un hallazgo).

El repaso de todos los tamaños, estados, teclado y contraste lo hace `reviewer-ui` una vez, al final.

## 4. Commits y ramas

Única fuente de estas reglas; los demás archivos las citan. Autorizado de forma permanente por el usuario (2026-10-30), con este alcance:
- **Rama por hito:** `hito/Hn-nombre`, creada desde `main`. Las vías directa y de cambio pequeño usan una rama corta `fix/…` o `feat/…` si se está en `main`, o la rama en curso si el cambio pertenece a ella. Nunca push directo a `main`.
- **Un commit por tarea**, solo con la comprobación rápida en verde. Si algo falla, no hay commit: se corrige o se para y se avisa. Incluye la marca de la tarea en `tasks.md`.
- Mensaje en inglés: `<tipo>(Hn): Tn <resumen>` (en las otras vías, `<tipo>(<ámbito>): <resumen>`), con tipo `feat|fix|test|docs|chore|refactor` y la línea `Co-Authored-By` de la atribución vigente.
- Añade los archivos por nombre: nunca `git add -A`, y jamás `.env` ni secretos.
- **Push al cerrar el hito o al abrir la pull request, y push de respaldo al acabar cada sesión de trabajo** (ampliado el 2026-11-15: el CI ya no corre en las ramas de hito, así que no cuesta nada y el trabajo no vive solo en local). No por tarea. Lo hace quien coordina, no el `implementer` (`git push -u origin <rama>` la primera vez). Sin `--force`, sin tocar historial ya publicado. Un push fallido se comunica; no se reintenta con otras opciones.
- El CI corre en la pull request y en `main`.

## 5. Revisores

Solo en la vía de hito, una vez, al final.
- `reviewer`: siempre, y **primero**: ejecuta la verificación completa. Si falla, no se lanzan los demás hasta corregir.
- `reviewer-db`: si `git diff --stat main...` toca `db/`, consultas de `apps/api`, `packages/contracts` con efecto en datos o `data/seed`.
- `reviewer-security`: si toca acceso, sesión, endpoints públicos, datos personales, registros o `infra/`.
- `reviewer-ui`: si toca `apps/web`, `packages/i18n` o estilos.

**Pila de revisión compartida.** Quien coordina la levanta una vez, antes de lanzar los revisores, y la retira al acabar:
`COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-review ONWAY_HTTP_PORT=18081 docker compose up --build --wait -d` y `down -v`. Los revisores la usan y **ninguno levanta otra** (dos a la vez con el mismo proyecto chocarían): si no reciben la dirección, lo dicen y revisan solo leyendo. Los especializados se lanzan en paralelo, después del `reviewer`, con su apartado «Comprobado». Nunca se toca el proyecto compose `onway` del usuario.

Máximo 2 vueltas de correcciones. Los hallazgos de gravedad baja no bloquean: se anotan en `docs/estado.md` o en el backlog.

## 6. Validación

Se usa la **sección 4 del doc 07** (12 criterios) como lista, más la demostración del hito. Veredicto: APROBADO o CAMBIOS NECESARIOS, con `archivo:línea` y el criterio incumplido.

## 7. Orquestación

Si el usuario pide el flujo completo, el hilo principal coordina: `planner` (plan y tareas), `implementer` (hasta 3 tareas contiguas por llamada, o el mismo agente continuado con SendMessage mientras su contexto aguante; un commit por tarea igualmente), revisores (validación), con la herramienta Agent. El subagente `coordinator` ofrece la garantía de que no se toca código directamente (su Bash es solo para `git` de lectura, el push y la pila de revisión). Los subagentes no ven la conversación: pásales la fase, la petición del usuario, las rutas de `plan.md` y `tasks.md` y el resultado de la fase anterior. Para un hito de 3 tareas o menos se puede implementar en el hilo principal y usar solo los revisores.

## 8. Estado y documentos

- `docs/estado.md`: máximo 30 líneas; se actualiza al cerrar un hito o cuando cambia el siguiente paso. El historial va a `docs/historial.md`.
- Sin recuentos de pruebas escritos a mano en ningún documento.
- Las desviaciones del plan se anotan en `specs/Hn-nombre/` y en la fila «Tal como se construyó» del doc 07.
