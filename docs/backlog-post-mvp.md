# OnWay — Backlog tras el MVP

Cosas que se han decidido o detectado y que **no** se hacen ahora. Al cerrar el MVP (H4) se convierten en *issues* de GitHub, una por entrada, y se van cogiendo en orden. Última actualización: 2026-11-05.

## Qué entra aquí y qué no

Entra lo que es una mejora, un ajuste o una decisión de producto que **no bloquea** el hito en curso y cuyo coste de hacerlo después es el mismo que ahora. **No** entra lo que, si se deja, obliga a rehacer trabajo ya construido (deuda técnica): eso se arregla en el hito en el que aparece o en el siguiente, con su tarea. Ante la duda, se pregunta al usuario.

Cada entrada dice qué es, por qué se aplaza, cuándo conviene retomarla y dónde está el contexto.

| ID | Título | Cuándo |
|---|---|---|
| B-01 | El rescatista ve nombre y localidad de todos los equipos | H5 (equipos) |
| B-02 | Alias de coordinadores y rescatistas (`criantval ALC`) | Decidir al planificar H5; construir después del MVP |
| B-03 | `forgotPassword` permite agotar los enlaces de recuperación de otra cuenta | Antes del despliegue (H7) |
| B-04 | `ResetPasswordRequest.token` sin longitud máxima propia | Antes del despliegue (H7) |

---

## B-01 · El rescatista ve nombre y localidad de todos los equipos

- **Decisión (usuario, 2026-11-02):** un rescatista debe poder ver el **nombre y la localidad** de su equipo **y de los demás equipos** de su organización. Registrada como D-34 en el documento 01.
- **Qué falla hoy:** la política `teams_select` (migración 0008) solo deja a un rescatista leer los equipos de los que es miembro. Por eso, en `listMyMissionRoutes`, el campo `team` de una ruta llega `null` si la persona no es del equipo asignado a esa ruta (H4-T3, desviación C3 del plan).
- **Por qué se aplaza:** hasta H5 no existe `listTeams` ni forma de crear equipos desde la interfaz, así que hoy no hay equipos que mostrar (la semilla no asigna ninguno a rutas). Construirlo ahora no se podría probar con una pantalla real.
- **Cómo se resolvería (a confirmar al planificar H5):** `teams` solo contiene nombre, localidad y estado, sin datos personales. Basta una migración **0013** que amplíe la lectura de `teams` a todos los roles de la organización (el rescatista sigue sin leer `team_members`, que es quien pertenece a qué equipo). No hace falta una función `SECURITY DEFINER`. Pruebas: el rescatista lee los equipos de su organización y ninguno de otra (INV-01), y sigue sin leer sus miembros (regla 3).
- **Cuándo:** en H5, junto a los equipos. El `planner` de H5 debe incluirlo. No cambia el contrato de H4 (`MissionRouteRescuer.team` ya existe).
- **Contexto:** `docs/01` D-34; `specs/H4-rutas-en-la-mision/plan.md` §9 C3; `db/migrations/0008_rls_grants.sql` (`teams_select`).

## B-02 · Alias de coordinadores y rescatistas

- **Idea (usuario, 2026-11-02):** cada coordinador y rescatista tendrá un **alias** corto, del estilo de cómo le apodan a veces: *Cristian Antón Valdés, Alicante* → **`criantval ALC`** (tres letras del nombre, tres del primer apellido, tres del segundo, y un código de la localidad del equipo).
- **Por qué interesa:** en las listas (voluntarios, participantes, rutas) mostraría una identificación útil para el equipo sin exponer el nombre completo (regla 3: datos personales mínimos). Podría resolver además el pendiente de que `coordinatorName` llega `null` al rescatista (`docs/estado.md`, pendiente (a)).
- **Por qué se aplaza:** es una decisión de producto que toca el modelo de datos (usuarios o perfiles), el contrato (`PersonRef` y los nombres que hoy salen en las listas) y los documentos 01, 02, 03, 05 y 06. No bloquea el MVP.
- **Preguntas abiertas (Q-36 del documento 01):**
  1. ¿Se **genera** a partir del nombre y la localidad, o lo **elige** la persona (con unicidad dentro de la organización)?
  2. ¿De dónde sale el código de localidad si la persona está en varios equipos, o en ninguno?
  3. ¿Qué colisiones se admiten (dos personas con las mismas iniciales y localidad)?
  4. ¿Qué lo ve y dónde: ¿sustituye al nombre en las listas del rescatista y el coordinador sigue viendo el nombre completo (D-22, D-24)?
  5. ¿Cómo se trata en el historial de auditoría y al eliminar los datos (RN-22, el historial queda anonimizado)?
- **Cuándo:** conviene **decidir el alcance al planificar H5**, porque H5 construye los perfiles y la lista de voluntarios, que son los sitios donde más se vería el alias. Si se decide que va después, añadirlo más tarde es aditivo (una columna y un campo del contrato), así que no genera deuda siempre que las listas de H5 no asuman que el nombre completo es lo único que se muestra.
- **Contexto:** `docs/01` Q-36, D-22, D-24; `docs/estado.md` pendiente (a).

## B-03 · Agotar los enlaces de recuperación de otra cuenta

- **Qué es (hallazgo del `reviewer` de `H5-acceso`, 2026-11-05):** la función SQL de la migración 0009 limita a 3 enlaces por hora y cuenta. Una tercera persona que conozca el correo de alguien puede pedirlos sin parar y dejarle sin enlaces durante esa hora. Hoy lo frena el tope de 5 `forgotPassword` por hora y por IP del `api`, pero con varias IP el tope por cuenta se agota igual.
- **Por qué se aplaza:** no expone datos ni permite entrar en la cuenta; es una molestia (denegación de servicio a una persona) y el diseño de la función es el de los docs 05 y 06. Con datos ficticios y sin usuarios reales no hay a quién afectar todavía.
- **Cómo se resolvería:** que los intentos que no llegan a enviar nada no cuenten contra el tope, o que el tope por cuenta cuente solo los enlaces realmente usados o enviados a una dirección distinta; migración nueva (0013 o posterior) y prueba contra base real. Revisar junto con el límite persistente por IP, que hoy es en memoria.
- **Cuándo:** antes del despliegue (H7), cuando el límite deje de ser en memoria y el correo sea real.
- **Contexto:** `db/migrations/0009_*.sql`, `apps/api/src/identity/auth.service.ts`, `specs/H5-acceso/plan.md`.

## B-04 · `ResetPasswordRequest.token` sin longitud máxima propia

- **Qué es (hallazgo del `reviewer` de `H5-acceso`, 2026-11-05):** se quitó el límite de longitud del token del contrato para que uno mal formado dé el mismo `INVALID_RESET_TOKEN` que uno inexistente (no distinguir casos). El único tope es el del cuerpo de la petición.
- **Qué falta:** confirmar que el límite del cuerpo de Express (y el de Caddy) actúa de tope y lo bastante bajo, o fijar un tope generoso (p. ej. 1024 caracteres) que dé igualmente `INVALID_RESET_TOKEN` en lugar de `VALIDATION_FAILED`. Con prueba.
- **Por qué se aplaza:** el endpoint está protegido por el límite por IP y hoy no hay exposición real.
- **Cuándo:** antes del despliegue (H7).
- **Contexto:** `packages/contracts/src/auth.ts`, docs 06 y 07 (desviación v1.7).

---

## Otros pendientes ya anotados en `docs/estado.md`

No se han movido aquí para no duplicarlos. Al cerrar el MVP se pasan a *issues*: (a) `coordinatorName` nulo para el rescatista (ligado a B-02), (c) límite por usuario de `getEnvironment` (R-09), (e) R-06 contraste con AEMET, (f) auditoría de contraste y de lector de pantalla (H7), (g) línea clara en el borde de las ortofotos francesas, (j) mover `distanceToSegment`, `nearestSegment` y `simplifyVertices` a `packages/geo`, (k) operación de «desarchivar» una ruta. (Resuelto en el arreglo de H4: borrar un origen del que sale una ruta responde 400 `VALIDATION_FAILED` con `point_in_use`.)
