# H5-acceso · Registro, recuperar contraseña y aprobación de solicitudes — Plan

Estado: **aprobado por el usuario (2026-11-05)**, con las decisiones P1–P5 aceptadas · Origen: issue #9 · Rama: `hito/H5-acceso` (desde `main` en `fc74d6f`).

**Es un cambio de alcance, no un hito nuevo.** Adelanta de H5 solo el *acceso* y deja el resto de H5 (perfil, habilidades, equipos, usuarios) donde estaba. El doc 07 (§ «Un hito por vez», línea 245) ya prevé partir H5 «en registro y aprobación y perfil y equipos», por demostración y no por capa. Aquí se hace ese corte, con la recuperación de contraseña dentro del primer trozo.

## 0. Decisiones para el usuario

Las dos grandes ya están tomadas (alcance: adelantar solo el acceso; registro: como está en el diseño, con código de invitación y aprobación). Quedan estas; cada una lleva mi recomendación y la alternativa descartada. Si apruebas el plan, quedan aceptadas.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| P1 | **Cómo sale el correo de recuperar contraseña.** El doc 07 (H5) dice «Mailpit en local»; tú pides «consola en desarrollo, Resend después» | **`ConsoleMailer`**: el enlace sale por el registro del `api` (una línea JSON con destinatario y enlace). Sin dependencia nueva ni servicio nuevo. Resend queda para H7 (doc 07: «Fuera: enviar correo real a terceros», Q-28). El doc 04 ya admite «registro en consola o Mailpit» | **Mailpit** (servicio nuevo en `compose.yml` + `nodemailer`, dependencia nueva que pide tu aprobación, regla 12): una bandeja visible en el navegador. Más fiel al doc 07 y más cómodo de probar a mano, pero más superficie para un puerto que se va a reemplazar |
| P2 | **Qué hace la web tras registrarse.** La issue deja elegir «redirigir al login o iniciar sesión automáticamente» | **Pantalla de confirmación «solicitud recibida»** con enlace al login. Una cuenta pendiente SÍ puede iniciar sesión y verá la pantalla de espera (ya existe, doc 02 §3.1); no se abre sesión sola (RN-25: el registro nunca concede acceso) | Iniciar sesión sola tras registrarse: lleva a la pantalla de espera igualmente, pero crea una sesión sin que la persona haya probado nada y complica el «correo ya registrado no revela de quién es» |
| P3 | **«Evitar correos ya registrados» (issue).** Se muestra un error de correo duplicado | **No se revela.** Correo ya registrado y código inválido dan el mismo `REGISTRATION_FAILED` con el mismo texto (doc 02 §3.1, doc 06). La issue pide «validar»: se valida formato y contraseña en el cliente y en el servidor; la unicidad, sin avisar | Avisar «correo ya registrado»: cómodo, pero permite averiguar qué correos tienen cuenta |
| P4 | **Límite de peticiones en los tres endpoints públicos** (`register`, `forgotPassword`, `resetPassword`). El doc 07 lo cita en la salida de H5 (bloqueo por intentos y límite de peticiones); hoy solo existe el bloqueo por cuenta del login | **Un limitador pequeño por IP y por operación, en memoria**, con `RATE_LIMITED` y `retryAfterSeconds` (patrón de `UserRateLimiter` de H1). Sin él, el registro público llena `users` y `forgotPassword` envía correos a quien sea | Dejarlo para H7: el riesgo es nulo en una demostración local, pero el registro público queda abierto desde su primer día |
| P5 | **Cuántos enlaces de «nombre»:** la issue pide «nombre de usuario» | **Nombre visible** (`displayName`, ya en `RegisterRequest`). OnWay inicia sesión con el correo; no hay nombre de usuario (D-28, INV-31). El alias sigue siendo B-02/Q-36 | Añadir un nombre de usuario aparte: cambia el modelo y el login, y entra en terreno de Q-36 |

Además, **sin necesitar respuesta** (diseño, con alternativa en §4): D-A1 a D-A6.

## 1. Alcance

- **Requisitos:** RF-104 (registro con código de invitación), RF-106 (aprobar o rechazar, también en bloque), RF-101 (el login gana sus enlaces), Q-33 (recuperar contraseña por correo; ya cerrada) y Q-34 (la solicitud solo lleva correo y nombre; ya cerrada). Boceto 1 (registro) y la parte «Solicitudes de alta» y «Código de invitación» del boceto 13.
- **Reglas e invariantes:** RN-25 (el registro nunca concede rol; solo el administrador concede coordinador); **INV-25** (cuenta pendiente, rechazada o desactivada no accede a datos), **INV-29** (solo un administrador asigna coordinador o administrador), INV-01 (aislamiento: solo solicita y decide dentro de su organización) y las comprobaciones de recuperación de contraseña de la migración 0009 (un solo uso, caducidad de 1 h, máx. 3 por hora y cuenta, cierra todas las sesiones).
- **Operaciones (7, todas con `x-milestone: H5` y sin cambiarlo):** `register`, `forgotPassword`, `resetPassword`, `listSignupRequests`, `decideSignupRequests`, `getInviteCode`, `rotateInviteCode`. Con las 51 montadas hasta H4 serían **58**.
- **Se queda en H5 (no se toca):** `changePassword`, `updateMe`, `listUsers`, `getUser`, `updateUser`, perfil y habilidades (`getMyProfile`… `getCertificateLink`), equipos (`listTeams`… `removeTeamMember`), RF-801, 805 completo, 806, 807, 808, 813 completo (la lista de usuarios y los datos sensibles de la vista de administración). Tras aprobarse, la persona llega a la pantalla «Completa tu perfil» que ya existe como página provisional.
- **Fuera:** correo real a terceros y dominio propio (Q-28, H7); `changePassword` (cambio desde la cuenta); alias de personas (B-02).

## 2. Qué cambia, por carpeta

**`packages/contracts`.** Los esquemas ya existen (`auth.ts`, `admin.ts`) y no deberían cambiar. Se comprueba contra el comportamiento real: `RegisterResponse` (`202 {status:'received'}`), `ResetPasswordRequest` (token de ≥ 20 caracteres), `DecideSignupRequest` (rol obligatorio al aprobar, ninguno al rechazar). Si aparece una diferencia, se corrige aquí primero (regla 7) y se regeneran OpenAPI y doc 06. Las notas de `register`, `forgotPassword` y `resetPassword` se completan con el limitador (P4) y con el formato del enlace. `milestones.ts` no cambia.

**`apps/api`.**
- `src/common/operation.ts`: `CURRENT_MILESTONE` pasa de `'H4'` a `'H5'`. Es la consecuencia mecánica de adelantar operaciones de H5; sigue sin poder montarse nada que no tenga controlador, y la prueba AC-02 enumera las operaciones montadas, así que solo entran las 7.
- `src/mail/` (nuevo): puerto `Mailer` (`send({ to, kind, locale, link })`) y `ConsoleMailer`. Configuración: `MAILER=console` (único valor admitido ahora; otro valor impide arrancar, no se degrada en silencio) y `PUBLIC_BASE_URL` para construir el enlace.
- `src/identity/`: `register` (hash Argon2id y `auth_register`; mismo error si el código no vale o el correo existe), `forgotPassword` (siempre 202; token aleatorio de 32 bytes, solo su hash a la base, `auth_request_password_reset`; envío por el puerto) y `resetPassword` (`auth_consume_password_reset`).
- `src/admin/` (nuevo): las cuatro operaciones de administración. `decideSignupRequests` recorre la selección dentro de **una sola transacción** llamando a `admin_decide_signup` por cada persona, con el resultado por elemento (`BulkResult`).
- Limitador por IP (P4), en `src/common/` junto a los existentes.
- **Sin migración SQL:** `auth_register`, `admin_decide_signup`, `auth_request_password_reset`, `auth_consume_password_reset` y las políticas `org_select`/`org_update`/`signup_admin` ya están en 0008 y 0009. Si al implementar falta algo, será una 0013 aditiva y se anota.

**`apps/web`.**
- Login: enlaces «Crear una cuenta» y «He olvidado mi contraseña».
- Vistas públicas nuevas: `/register`, `/forgot-password`, `/reset-password`. El token viaja en el **fragmento** (`/reset-password#token=…`), que el navegador no envía al servidor (no queda en el registro de Caddy ni en `Referer`).
- `/admin` deja de ser la página provisional: «Solicitudes de alta» (bandeja con casillas, filtro por estado, aprobar eligiendo rol, rechazar, en bloque) y «Código de invitación» (ver, copiar, regenerar con confirmación). La lista de usuarios y los datos sensibles siguen para H5.
- `packages/i18n`: textos es/fr de todo lo anterior, incluidos los errores. Cada vista con carga, vacío y error, 375 px y teclado.

**`infra` y `data/seed`.** `compose.yml` y la superposición E2E fijan `MAILER=console` y `PUBLIC_BASE_URL`. La semilla ya tiene `pendiente@example.org`; se comprueba que tenga su solicitud pendiente para que la bandeja no salga vacía en la demostración. `smoke.sh` añade: el login muestra los enlaces, `getInviteCode` responde al administrador, y `register` con código inválido da `REGISTRATION_FAILED`.

## 3. Puertos implicados

`Mailer` (nuevo, `ConsoleMailer`; Resend en H7) y `Clock` (caducidad del token, ya existente). Ningún otro puerto.

## 4. Decisiones con alternativa descartada

| # | Decisión | Alternativa descartada |
|---|---|---|
| D-A1 | `CURRENT_MILESTONE = 'H5'` y las 7 operaciones conservan `x-milestone: H5` | Reetiquetarlas con un valor nuevo (p. ej. `H5a`): rompe `MILESTONES` y la lista del doc 06 por un cambio puramente de nombre |
| D-A2 | El token se guarda solo como hash SHA-256; el enlace lleva el token en claro en el fragmento; caduca a 1 h y se consume una vez (ya lo hace la función SQL) | Token firmado sin estado: no se puede revocar ni limitar a un uso |
| D-A3 | `forgotPassword` responde 202 igual exista o no el correo, y no distingue por tiempo (la consulta y el envío se hacen siempre tras responder o con el mismo coste) | Responder antes en el caso «no existe»: revela qué correos tienen cuenta por la latencia |
| D-A4 | La aprobación por lote es **atómica**: si falla una persona, el lote entero se deshace y la respuesta lo dice | Lote parcial con resultado por elemento: deja la bandeja a medias y es más difícil de probar |
| D-A5 | `rotateInviteCode` invalida el anterior en el acto (una sola columna `invite_code`) | Dos códigos vivos durante un periodo de gracia: no hay tabla para ello |
| D-A6 | El código de invitación solo lo ve el administrador (`getInviteCode`); nunca sale en listados ni en el historial | Mostrarlo al coordinador: INV-29 / D-25 reservan la gestión de altas al administrador |

## 5. Riesgos

- **Registro público abierto** (alto si faltara P4): llenado de `users` y correos a terceros. Mitigación: limitador (P4), `REGISTRATION_FAILED` único, el registro solo crea una cuenta *pendiente* sin sesión ni datos (INV-25).
- **Tokens en los registros** del `api` con `ConsoleMailer`: en desarrollo es lo buscado; en producción sería una fuga. Mitigación: `MAILER=console` solo se admite fuera de producción (el arranque falla si `NODE_ENV=production`), y el despliegue de H7 trae Resend.
- **Enumeración de cuentas** por mensajes o por tiempo en `register` y `forgotPassword`. Mitigación: respuestas idénticas (P3, D-A3) y prueba que compara cuerpo y estado.
- **IP detrás de Caddy:** el limitador necesita la IP real del cliente (`X-Forwarded-For`). Mitigación: se confía solo en el salto de Caddy y se prueba con y sin cabecera.
- **Seguridad de la contraseña nueva:** reutiliza el esquema `Password` de H0 (mínimos del doc 06 §5); se verifica que no se acepta una más débil por la vía de recuperación.
- **E2E que lee un correo del registro:** frágil si el formato de la línea cambia. Mitigación: formato fijo y documentado, y el apoyo `support/stack.ts` lo lee con un solo punto de acceso.

## 6. Verificación

Pruebas primero, contra base real (PostGIS con Testcontainers, `test:api`):
- **RN-25 / INV-25:** `register` nunca devuelve sesión ni rol; la persona queda pendiente y el login la lleva a la espera; una rechazada no accede.
- **INV-29:** un coordinador recibe 403 en `decideSignupRequests`; solo el administrador concede `coordinator`; aprobar sin rol y rechazar con rol dan `VALIDATION_FAILED`.
- **INV-01:** solicitudes y código de otra organización: 404; un código de otra organización no registra en esta.
- **Recuperación:** un solo uso, caducidad (con `Clock` fijo), tope de 3 por hora, correo inexistente con la misma respuesta, cierra todas las sesiones y quita el bloqueo, token mal formado y token usado dan el mismo `INVALID_RESET_TOKEN`.
- **Código de invitación:** rotarlo invalida el anterior; el registro con el viejo da `REGISTRATION_FAILED`.
- **Limitador (P4)** y **AC-02** (58 operaciones montadas, las demás de H5 siguen sin montarse y responden 404).

Web (Vitest, es y fr): las tres vistas públicas (validación, error, éxito), enlaces del login, bandeja con selección en bloque y la acción de regenerar con confirmación.

**Demostración como prueba extremo a extremo** (`h5a-demo.spec.ts`, escritorio y 375 px; es y fr): una persona nueva abre el login, entra en «Crear una cuenta», se registra con el código que el administrador ve en «Administración» y lee «solicitud recibida»; entra y ve la espera; el administrador la ve en la bandeja y la aprueba como rescatista; ella entra y llega a «Completa tu perfil». Aparte: «He olvidado mi contraseña» → el enlace sale por el registro del `api` → nueva contraseña → entra con ella y la antigua ya no sirve. Solo con teclado en la parte en francés.

Comandos: `pnpm lint`, `format:check`, `typecheck`, `test`, `build`; `pnpm --filter @onway/api test:api`; `gen:openapi` y `gen:doc` sin diferencias; `pnpm --filter @onway/web e2e` en la pila `onway-e2e` (puerto 18080); `infra/scripts/smoke.sh`; y la comprobación del clon limpio como en H4.

## 7. Documentos que había que actualizar

Los cuatro primeros se editaron al aprobar el plan (2026-11-05): 07 v0.8, 04 v1.2, 02 v1.0 y 06 v1.5. `CLAUDE.md` y `docs/estado.md` se actualizan con cada tarea y en T10; los textos de 04 («cómo se implementará») pasan a pasado al construirlo.

| Documento | Cambio | Registro de cambios |
|---|---|---|
| **07** (plan) | H5 se parte por demostración: el acceso (este plan) y el resto; la salida de H5-acceso y las 7 operaciones. Aclarar que «Mailpit en local» pasa a consola (P1) | v0.8 |
| **04** (arquitectura) | Fila `Mailer` y apartado de cómo se implementará: `MAILER`, `PUBLIC_BASE_URL`, el limitador, el token en el fragmento; despliegue de H7 con Resend | v1.2 |
| **02** (vistas) | §3.1: la vista de recuperación y la de «solicitud recibida»; §3.10: la bandeja y el código de invitación ya existen (el resto, H5) | v1.0 |
| **06** (contratos) | Notas de `register`, `forgotPassword`, `resetPassword`; operaciones montadas (58) | v1.5 |
| `CLAUDE.md` y `docs/estado.md` | Recuentos, variables nuevas, estado del cambio | — |
| 01, 03, 05 | **Sin cambios** (RF-104/106, RN-25, INV-25/29 y la migración 0009 ya dicen esto) | — |

## 8. ¿Contradice algo de los documentos 01–06?

**No contradice ninguna decisión de fondo.** La issue, tal como estaba escrita (registro libre, nombre de usuario, posible sesión automática), sí chocaba con RF-104, D-25, RN-25, INV-25 y doc 02 §3.1; al elegir «como está en el diseño» deja de hacerlo. Las únicas diferencias con los documentos son de *plan*, no de diseño:

- **Doc 07:** el alcance de H5 se parte en dos (previsto en su propia línea 245) y la nota «Mailpit en local» pasa a consola (P1); hay que editarlo y anotarlo en su registro.
- **Doc 04:** la fila `Mailer` admite «consola o Mailpit», así que no se contradice; se amplía con lo implementado.
- Regla `CLAUDE.md` «no se monta una operación fuera del hito en curso»: este cambio **es** la aprobación explícita que pide la constitución (punto 2) para adelantar trabajo de un hito posterior, limitada a las 7 operaciones.

## 9. Tareas (el detalle, en `tasks.md`)

T1 contrato y notas, `CURRENT_MILESTONE` y AC-02 · T2 puerto `Mailer`, `ConsoleMailer` y configuración · T3 `register` y limitador · T4 `forgotPassword` y `resetPassword` · T5 administración: solicitudes y código de invitación · T6 web: enlaces y vistas públicas · T7 web: administración · T8 compose, semilla, `smoke.sh` y apoyo del E2E · T9 demostración E2E · T10 documentos, estado y clon limpio. Diez tareas, en orden de dependencia.
