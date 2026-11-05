# H5-acceso · Tareas

Plan aprobado el 2026-11-05 (`plan.md`, decisiones P1–P5 aceptadas). Rama `hito/H5-acceso`. Diez tareas en orden de dependencia, cada una de unas horas. Pruebas primero, contra base real. Una tarea por vez, con commit y push al cerrarla (archivos por nombre, nunca `git add -A`), `docs/estado.md` al día y todo en verde (`pnpm lint`, `format:check`, `typecheck`, `test`, `build` y las pruebas de lo tocado).

Operaciones del cambio (7, `x-milestone: H5` sin cambiar): `register`, `forgotPassword`, `resetPassword`, `listSignupRequests`, `decideSignupRequests`, `getInviteCode`, `rotateInviteCode`. No se monta ninguna otra de H5.

- [x] **T1. Contrato, hito en curso y AC-02.** Regla 7; las 7 operaciones.
  - Se comprueba que los esquemas de `auth.ts` y `admin.ts` encajan con lo previsto (`RegisterResponse` 202, `ResetPasswordRequest` con token de ≥ 20 caracteres, `DecideSignupRequest` con rol al aprobar) y se corrigen primero aquí si no. Se completan las notas de `register`, `forgotPassword` y `resetPassword` (límite de peticiones, formato del enlace). `CURRENT_MILESTONE` pasa a `'H5'` y la prueba AC-02 enumera las 51 montadas más estas 7 (58) y comprueba que el resto de H5 sigue sin montarse (404). *Hecho así:* en T1 siguen montadas las 51 (no se monta ninguna operación nueva); las 7 se añaden a la lista `ACCESS_BUILT` de la prueba en T3 a T5 hasta llegar a 58.
  - Hecho cuando: `pnpm --filter @onway/contracts test` y `gen:openapi` / `gen:doc` sin diferencias salvo las notas; `test:api` de `app.test.ts` en verde con 58 operaciones y las 19 restantes de H5 respondiendo 404 `NOT_FOUND`.
  - Cierre: commit `feat(H5-acceso): T1 mark the access operations as the milestone in progress` + push.

- [ ] **T2. Puerto `Mailer` y `ConsoleMailer`.** Puerto `Mailer` (doc 04); P1.
  - `apps/api/src/mail/`: el puerto, el adaptador de consola con una línea JSON fija (destinatario, tipo, idioma, enlace) y la configuración `MAILER` / `PUBLIC_BASE_URL`. Arrancar con un valor de `MAILER` distinto de `console`, o con `console` y `NODE_ENV=production`, falla con un mensaje claro. Doble para pruebas que guarda lo enviado.
  - Hecho cuando: pruebas unitarias del formato de la línea, de la construcción del enlace con el token en el fragmento y de los dos arranques que fallan; `pnpm --filter @onway/api test` en verde.
  - Cierre: commit `feat(H5-acceso): T2 add the Mailer port with a console adapter` + push.

- [ ] **T3. `register` y limitador de los endpoints públicos.** RF-104, RN-25, INV-25, INV-01; P2, P3, P4.
  - Pruebas primero: el registro crea una cuenta *pendiente* sin sesión ni rol; el login de esa cuenta lleva a la espera; un código inválido, un código de otra organización y un correo ya registrado dan el **mismo** `REGISTRATION_FAILED` (cuerpo y estado idénticos); contraseña débil o distinta de la repetida, `VALIDATION_FAILED`. Después, `register` con hash Argon2id y `auth_register`, y el limitador en memoria por IP y operación (`RATE_LIMITED` con `retryAfterSeconds`, IP del salto de Caddy).
  - Hecho cuando: `test:api` de `auth-register.test.ts` en verde (RN-25, INV-25, INV-01, enumeración, limitador con y sin cabecera `X-Forwarded-For`); una fila de auditoría `signup_requested` por registro.
  - Cierre: commit `feat(H5-acceso): T3 add registration with an invite code` + push.

- [ ] **T4. `forgotPassword` y `resetPassword`.** Q-33; migración 0009; P1, P4.
  - Pruebas primero: `forgotPassword` responde 202 con el mismo cuerpo exista o no el correo y envía un solo correo por el puerto solo si existe; tope de 3 por hora y cuenta; `resetPassword` consume el token una vez, caduca a 1 h (con `Clock` fijo), cierra todas las sesiones y quita el bloqueo por intentos; token inexistente, usado, caducado o mal formado dan el mismo `INVALID_RESET_TOKEN`; la contraseña nueva cumple el mismo esquema que la del registro. Después, la implementación con token de 32 bytes aleatorios y solo su hash SHA-256 en la base.
  - Hecho cuando: `test:api` de `auth-password-reset.test.ts` en verde; una prueba comprueba que el token en claro no aparece en ninguna tabla ni en la auditoría; el limitador también cubre estas dos operaciones.
  - Cierre: commit `feat(H5-acceso): T4 add password recovery by email link` + push.

- [ ] **T5. Administración: solicitudes de alta y código de invitación.** RF-106, RN-25, INV-29, INV-01, INV-25; D-A4 a D-A6.
  - Pruebas primero: `listSignupRequests` pagina y filtra por estado y búsqueda (sin datos personales más allá de correo y nombre, Q-34); `decideSignupRequests` aprueba con rol o rechaza, **en una sola transacción** para toda la selección, con el resultado por elemento; solo el administrador concede `coordinator` (un coordinador recibe 403, INV-29); aprobar sin rol y rechazar con rol dan `VALIDATION_FAILED`; solicitudes de otra organización, 404 (INV-01); una cuenta rechazada no accede (INV-25); `getInviteCode` solo para el administrador; `rotateInviteCode` invalida el anterior en el acto y deja una fila de auditoría sin el código.
  - Hecho cuando: `test:api` de `admin-signups.test.ts` y `admin-invite-code.test.ts` en verde; el código de invitación no aparece en ningún listado ni en el historial.
  - Cierre: commit `feat(H5-acceso): T5 add signup requests and the invite code to the admin API` + push.

- [ ] **T6. Web: enlaces del login y vistas públicas.** RF-104, Q-33; P2, P3, P5.
  - Pruebas primero (Vitest, es y fr): el login muestra «Crear una cuenta» y «He olvidado mi contraseña»; `/register` valida en el cliente (obligatorios, formato del correo, contraseña, coincidencia) y muestra el mismo error genérico del servidor; «Solicitud recibida» con enlace al login; `/forgot-password` muestra siempre la misma confirmación; `/reset-password` lee el token del fragmento, valida la contraseña, muestra el error único y lleva al login. Textos en `packages/i18n`, estados de carga y error, 375 px y teclado.
  - Hecho cuando: `pnpm --filter @onway/web test` en verde (es y fr); el test de teclado de `access.spec.ts` sigue pasando (revisar su tope de tabulaciones); revisión con Chrome DevTools a 375 px sin desbordes y objetivos de 44 px o más.
  - Cierre: commit `feat(H5-acceso): T6 add the sign up and password recovery views` + push.

- [ ] **T7. Web: Administración (solicitudes y código de invitación).** RF-106; boceto 13 (parte).
  - Pruebas primero: la ruta `/admin` deja de ser la página provisional para el administrador y sigue cerrada a los demás roles; bandeja con casillas, filtro por estado, aprobar eligiendo el rol y rechazar, en bloque; vacío, carga y error; código de invitación con ver, copiar (con el aviso de portapapeles sin HTTPS) y regenerar con confirmación y foco devuelto. Textos es y fr.
  - Hecho cuando: `pnpm --filter @onway/web test` en verde; revisión a 375 px y solo con teclado; `pnpm lint` mantiene la frontera del mapa.
  - Cierre: commit `feat(H5-acceso): T7 add the admin signup inbox and invite code view` + push.

- [ ] **T8. Compose, semilla, `smoke.sh` y apoyo del E2E.** Doc 04 §5.2; data/seed.
  - `MAILER=console` y `PUBLIC_BASE_URL` en `compose.yml` y en la superposición E2E; se comprueba que `pendiente@example.org` tiene su solicitud pendiente (si no, la semilla la crea, idempotente); `smoke.sh` añade: el administrador lee el código, `register` con código inválido da `REGISTRATION_FAILED` y `forgotPassword` responde 202; el apoyo `support/stack.ts` gana una función que lee del registro del `api` el último enlace enviado a un correo.
  - Hecho cuando: `seed.test.ts` y `test:db` en verde; `infra/scripts/smoke.sh` pasa contra la pila de pruebas (`onway-e2e`, puerto 18080); el apoyo del E2E devuelve un enlace real.
  - Cierre: commit `feat(H5-acceso): T8 wire the mailer into compose, seed and smoke` + push.

- [ ] **T9. Demostración E2E de `H5-acceso`.** Demostración del plan §6.
  - `h5-acceso-demo.spec.ts`, escritorio y 375 px, en español y en francés (la parte en francés solo con teclado): la persona nueva abre el login, entra en «Crear una cuenta», se registra con el código que el administrador ve en Administración y lee «Solicitud recibida»; entra y ve la espera; el administrador la ve en la bandeja y la aprueba como rescatista; ella entra y llega a «Completa tu perfil». Aparte: «He olvidado mi contraseña», el enlace del registro del `api`, nueva contraseña y entrar con ella (la antigua ya no sirve). La prueba limpia lo que crea (cuentas «E2E …» desactivadas o rechazadas) para no dejar la pila sucia.
  - Hecho cuando: `pnpm --filter @onway/web e2e` en la pila `onway-e2e` con `CI=1` y **tres ejecuciones seguidas** en verde; el recuento de pruebas anotado.
  - Cierre: commit `test(H5-acceso): T9 add the access demonstration` + push.

- [ ] **T10. Documentos, estado y clon limpio.** Definición de terminado (doc 07 §4), criterio 11 y 12.
  - Reescribir en pasado el apartado «cómo se implementará» del doc 04; doc 06 con las notas finales y 58 operaciones; `CLAUDE.md` (comandos, variables, recuentos) y `docs/estado.md` (qué se entregó, desviaciones, autoevaluación de los 12 criterios, pendientes); la issue #9 con el enlace al PR. Comprobar `gen:openapi` y `gen:doc` sin diferencias y, desde un clon limpio, `docker compose up --build --wait`, `smoke.sh` y una recuperación de contraseña real.
  - Hecho cuando: CI de la rama en verde con los 6 trabajos; los 12 criterios del doc 07 §4 autoevaluados con evidencia; lista para el `reviewer`.
  - Cierre: commit `docs(H5-acceso): T10 close the access milestone` + push; después `reviewer` y PR con `Fixes #9`.
