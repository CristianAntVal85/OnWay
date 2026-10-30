# OnWay — Documento 06: Contratos de API

**Versión:** 0.5 · **Estado:** borrador para revisión · **Fecha:** 30 de octubre de 2026
**Depende de:** 01 (requisitos), 02 (vistas y permisos), 03 (dominio), 04 (arquitectura), 05 (datos)
**Código que lo acompaña:** `packages/contracts/` (esquemas Zod, registro de endpoints, pruebas y generadores)

---

## 1. Cómo leer este documento

El contrato **es código**: esquemas Zod en `packages/contracts/src/` y un registro de endpoints (`endpoints.ts`) que dice, para cada operación, ruta, roles, entrada, respuesta y errores. De ese registro se generan el OpenAPI, el cliente tipado de la web y **las tablas de las secciones 6 y 7 de este documento**. Si el código y este texto discrepan, manda el código; las tablas no se escriben a mano para que no puedan discrepar.

Qué se ha verificado y qué no está en la sección 11.

## 2. Decisiones de diseño

| Id | Decisión | Por qué |
|---|---|---|
| AC-01 | **REST sobre JSON**, prefijo `/api/v1`. La versión va en la ruta | Es lo que genera bien OpenAPI y el cliente tipado (AD-09). Un cambio incompatible crearía `/api/v2` sin romper una app móvil ya publicada |
| AC-02 | **Un registro único de endpoints** en `packages/contracts`. El controlador de NestJS declara el mismo esquema; una prueba de contrato comprueba que ruta, método y roles coinciden | Evita que web, API y documentación digan cosas distintas |
| AC-03 | **Dos familias de respuesta: personal y rescatista.** Todo lo del rescatista vive bajo `/my/...` y tiene sus propios tipos, sin reutilizar los del coordinador | La privacidad pasa a ser estructural: el tipo `MyMissionDetail` **no tiene** el campo `participants`, así que no puede filtrarse por descuido. Pruebas lo comprueban (§9) |
| AC-04 | **Sesión por cookie** (`onway_session`, `HttpOnly`, `Secure`, `SameSite=Strict`) y cabecera `X-CSRF-Token` en toda petición que no sea `GET`. El token se entrega en `login` y `me` | Doc. 04 §10. Para móvil se añadirá un endpoint de tokens sin tocar permisos; no está en v1 |
| AC-05 | **Un único formato de error** `{ error: { code, message, requestId, details? } }`. La web decide el texto por `code` (i18n), nunca por `message` | Dos idiomas (es/fr) y mensajes que cambian sin romper la interfaz |
| AC-06 | **Otra organización responde 404, no 403** | No se revela que existe un recurso ajeno |
| AC-07 | **Paginación por `page` y `pageSize`** (máx. 200) con `total`. Las bandejas añaden contadores por pestaña | Las organizaciones son pequeñas (cientos, no millones); paginar por posición permite «Seleccionar los 134 resultados» |
| AC-08 | **Acciones en bloque con selección explícita:** `ids`, o `filter` + `exceptIds`. «Quitar» exige `expectedCount` | Es la bandeja de correo del doc. 02 §3.7. Si entre tanto alguien retiró su oferta, la cifra no coincide y no se aplica nada (`STALE_RESOURCE`) |
| AC-09 | **Los cambios de estado son verbos**, no `PATCH status`: `activate`, `close`, `reopen`, `validate`, `archive`, `offer` | Cada transición tiene sus propias reglas y su propio cuerpo (cerrar lleva la lista de asistencia). El cliente no puede fijar un estado a mano |
| AC-10 | **El servidor calcula siempre altitudes, métricas y tramos.** El cliente envía solo geometría (y la altitud que traiga se ignora) | RN-07 y RN-10. Una ruta importada con métricas falsas no puede entrar |
| AC-11 | **Candidato → guardar.** Dibujar (`snap`), importar (`import/preview`) y adaptar devuelven un *candidato* sin guardar nada; para guardarlo se envía su geometría a `POST /routes`, `…/versions` o `…/derive` | El servidor no guarda estados intermedios. Descartar un candidato es no hacer nada |
| AC-12 | **Cálculos largos: `202` + `jobId` + sondeo** de `GET /jobs/{id}` cada 1–2 s | Generar alternativas tarda; la interfaz no se bloquea (RF-501) |
| AC-13 | **Archivos: se suben antes y se referencian por id.** Un certificado se abre con un enlace firmado de pocos minutos | El archivo nunca viaja dentro de un JSON y nunca tiene URL permanente |
| AC-14 | **Toda lectura que deja huella de auditoría es `POST`** (`readUserSensitive`, `getCertificateLink`) | Una caché o un rastreador no pueden repetirla sin que se note, y es evidente en el código que tiene efecto |
| AC-15 | **El servidor dice qué se puede hacer:** `actions` en la misión, `canOffer` y `offerBlockedReason` para el rescatista | La web pinta botones; la decisión sigue siendo del servidor (RF-103) y el móvil heredará la misma lógica |
| AC-16 | **Estricto en ambos sentidos.** Un campo desconocido en una petición se rechaza; un campo no declarado en una respuesta no existe | Prueba automática. Es lo que impide que «un campo de más» saque un dato personal |
| AC-17 | **Coordenadas como `{ lat, lon }`** y líneas como GeoJSON `[lon, lat, altitud]` | Evita el error clásico de invertir el orden en los puntos sueltos |
| AC-18 | **Sin `DELETE` de misiones ni de rutas** | RN-14: se archivan. El borrado de datos personales tiene su propio camino (`DELETE /my/profile`) |

## 3. Convenciones

- **Identificadores:** UUID. **Fechas y horas:** ISO 8601 con zona (`2026-10-29T10:00:00Z`). **Fechas sin hora:** `2026-10-29`.
- **Texto:** UTF-8, con espacios recortados al validar. Los límites de longitud son los del esquema SQL.
- **Idioma de los errores:** `message` va en inglés y es para registros. La interfaz usa `code`.
- **Paginación:** `?page=1&pageSize=25`. Respuesta `{ items, page, pageSize, total }`.
- **Selección en bloque:** `{ "mode": "ids", "ids": [...] }` o `{ "mode": "filter", "filter": {...}, "exceptIds": [...] }`.
- **Límites de tasa:** inicio de sesión y registro por IP y por cuenta (el bloqueo de 15 min tras 5 fallos lo aplica la base de datos); geocodificación 1 petición/s en servidor; el resto, un tope general por usuario. Al excederlo, `429 RATE_LIMITED` con `retryAfterSeconds`.
- **`Cache-Control: no-store`** en todo lo que lleve datos personales (`/my/profile/sensitive`, `/admin/users/{id}/sensitive`, `/my/data-export`).
- **Orden de rutas:** `/routes/snap`, `/routes/generate`, `/routes/near` e `/routes/import/preview` se declaran **antes** que `/routes/{routeId}` (una prueba lo vigila).

## 4. Errores

Todos los errores usan la misma forma. `details` solo existe para los códigos que lo tipan (§4.2).

```json
{ "error": { "code": "ATTENDANCE_INCOMPLETE", "message": "…", "requestId": "01J…", "details": { "missingParticipationIds": ["…"] } } }
```

### 4.1 Códigos y estado HTTP

| HTTP | Código |
|---|---|
| 400 | `VALIDATION_FAILED` |
| 401 | `UNAUTHENTICATED` `INVALID_CREDENTIALS` `SESSION_EXPIRED` |
| 403 | `FORBIDDEN` `CSRF_FAILED` `ACCOUNT_PENDING` `ACCOUNT_REJECTED` `ACCOUNT_DISABLED` `PROFILE_INCOMPLETE` |
| 404 | `NOT_FOUND` |
| 409 | `MISSION_CLOSED` `MISSION_NOT_ACTIVE` `INVALID_STATE_TRANSITION` `STALE_RESOURCE` `DUPLICATE_NAME` `ALREADY_OFFERED` `VERSION_IMMUTABLE` `ROUTE_IN_USE` `ROUTE_ALREADY_IN_MISSION` `COORDINATOR_HAS_MISSIONS` `LAST_ADMIN` `DOCUMENT_ALREADY_REGISTERED` `CONFIRMATION_REQUIRED` |
| 413 | `FILE_TOO_LARGE` |
| 415 | `UNSUPPORTED_FILE_TYPE` |
| 422 | `REGISTRATION_FAILED` `INVALID_RESET_TOKEN` `INVALID_DOCUMENT` `INVALID_FILE_CONTENT` `ATTENDANCE_INCOMPLETE` `MISSION_HAS_NO_ORIGIN` `OUTSIDE_COVERAGE` `NO_ROUTE_POSSIBLE` |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` |
| 502 | `UPSTREAM_UNAVAILABLE` |
| 503 | `ROUTING_UNAVAILABLE` |


Errores **transversales** que no se repiten en cada fila de la tabla de endpoints: `INTERNAL`, `RATE_LIMITED`; en todo lo que exige sesión, `UNAUTHENTICATED`, `SESSION_EXPIRED`, `FORBIDDEN`, `ACCOUNT_DISABLED` y (salvo `logout`/`me`) `ACCOUNT_PENDING`; en todo lo que no es `GET`, `CSRF_FAILED`; en lo que tiene entrada, `VALIDATION_FAILED`; en lo que tiene parámetros de ruta, `NOT_FOUND`.

### 4.2 Detalles tipados

| Código | `details` |
|---|---|
| `VALIDATION_FAILED` | `issues[]` con `path` (`origins.0.lat`), `code` y `message` |
| `ACCOUNT_LOCKED`, `RATE_LIMITED` | `retryAfterSeconds` |
| `COORDINATOR_HAS_MISSIONS` | `missionIds[]`: hay que reasignarlas antes de desactivar (RN-11) |
| `ROUTE_IN_USE` | `missions[]` con id y nombre: se explica en cuáles se usa (doc. 02 §8) |
| `CONFIRMATION_REQUIRED` | `warning: "no_validated_route"`: activar sin ruta validada avisa y se repite con `confirmWithoutValidatedRoute: true` |
| `ATTENDANCE_INCOMPLETE` | `missingParticipationIds[]`: aceptados que faltan en la lista de cierre |
| `PROFILE_INCOMPLETE` | `missing[]`: `fullName`, `phone`, `document`, `address` |
| `STALE_RESOURCE` | `currentUpdatedAt` (edición simultánea, Q-10) |

### 4.3 Qué errores no revelan nada

- `INVALID_CREDENTIALS` es el mismo para correo inexistente y contraseña errónea.
- `REGISTRATION_FAILED` es el mismo para código de invitación inválido y correo ya registrado.
- `DOCUMENT_ALREADY_REGISTERED` no dice de quién es el documento (INV-24).
- Un recurso de otra organización, o una misión en planificación pedida por un rescatista, responde `NOT_FOUND`.
- `POST /auth/password/forgot` responde siempre 202. `INVALID_RESET_TOKEN` es el mismo para token inexistente, usado o caducado.

## 5. Decisión: solicitudes de alta (Q-34, confirmada)

Al contrastar el boceto 13 con el modelo de datos apareció una incoherencia: la lista de solicitudes enseñaba **«Equipo indicado»** y **«Datos completos»**, y RF-106 decía que cada solicitud indica si los datos del perfil están completos. Pero el registro solo recoge correo, nombre, contraseña y código de invitación, y el perfil se crea **al aprobar** (`admin_decide_signup`) y lo rellena la persona en su primer acceso. En el momento de la solicitud no existe ni equipo ni perfil que mirar.

**Decisión (confirmada por el propietario):** `SignupRequestItem` lleva `userId`, `email`, `displayName`, `status` y `requestedAt`. Se retiran las dos columnas del boceto y se reformula RF-106: *«el administrador ve la solicitud con el correo y el nombre indicados y la aprueba eligiendo el rol»*. Los equipos los asigna el coordinador o el administrador después, como ya dice doc. 02 §3.8.

Alternativa descartada: pedir equipo y datos en el registro. Alarga el formulario para quien aún no está aprobado, recoge datos personales de personas que quizá se rechacen y mezcla dos pasos que el doc. 02 mantiene separados.

## 6. Endpoints

El registro tiene **95 operaciones**, cada una asignada a un **hito de construcción** (H0–H9, documento 07): 93 de primera entrega y 2 de segunda (`listNearRoutes` en H8 y `adaptRoute` en H9; el contrato existe y el servidor responde `501` hasta entonces). El hito aparece junto al nombre de cada operación y en el OpenAPI como `x-milestone`; una prueba exige que todas tengan hito y que ninguna dependa de otra de un hito posterior.

| Hito | H0 | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Operaciones | 5 | 18 | 12 | 6 | 9 | 26 | 17 | 0 | 1 | 1 |

Roles: *Rescatista*, *Coordinador*, *Admin*; *Pendiente* es una cuenta con sesión pero sin aprobar. En entrada, `campo?` es opcional. **Q-14:** hoy las operaciones que escriben sobre misiones y rutas solo admiten *Coordinador*; si se decide que el administrador también trabaja con misiones, se añade `admin` en una sola constante (`MISSION_WRITERS`) y el resto sigue igual.

### Sistema

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `getHealth` · **H0**<br>Estado del servicio y de sus dependencias | `GET /health` | Público | — | 200: status, checks | — |

**Nota sobre `getHealth` (H0).** Responde siempre 200: si una dependencia falla, `status` pasa a `degraded` y `checks` dice cuál. En H0 solo se comprueba la base de datos (`SELECT 1` sin contexto de usuario, como `onway_app`). `routingEngine` y `weatherProvider` valen `false` mientras no exista el adaptador de su puerto (`RoutingProvider`, `WeatherProvider`) y **no degradan `status`** hasta entonces: un `degraded` permanente dejaría de ser una señal útil para el comprobador externo. La nota está también en el `description` de la operación del OpenAPI.

### Acceso

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `register` · **H5**<br>Solicitar el alta con código de invitación *(auditado)* | `POST /auth/register` | Público | cuerpo: email, password, passwordConfirm, displayName, inviteCode, locale? | 202: status | `REGISTRATION_FAILED` |
| `login` · **H0**<br>Iniciar sesión (cookie de sesión + token CSRF) | `POST /auth/login` | Público | cuerpo: email, password | 200: user, csrfToken | `INVALID_CREDENTIALS` `ACCOUNT_LOCKED` `ACCOUNT_DISABLED` `ACCOUNT_REJECTED` |
| `logout` · **H0**<br>Cerrar sesión | `POST /auth/logout` | Todos con sesión | — | 204 | — |
| `getMe` · **H0**<br>Usuario de la sesión actual y a dónde debe ir la web | `GET /auth/me` | Todos con sesión | — | 200: user, csrfToken | `SESSION_EXPIRED` |
| `updateMe` · **H5**<br>Cambiar nombre visible o idioma | `PATCH /auth/me` | Rescatista, Coordinador, Admin | cuerpo: displayName?, locale? | 200: user, csrfToken | — |
| `changePassword` · **H5**<br>Cambiar la contraseña (cierra las demás sesiones) | `POST /auth/password/change` | Rescatista, Coordinador, Admin | cuerpo: currentPassword, newPassword | 204 | `INVALID_CREDENTIALS` |
| `forgotPassword` · **H5**<br>Pedir enlace para restablecer contraseña | `POST /auth/password/forgot` | Público | cuerpo: email | 202: ok | — |
| `resetPassword` · **H5**<br>Restablecer la contraseña con el token recibido *(auditado)* | `POST /auth/password/reset` | Público | cuerpo: token, newPassword | 204 | `INVALID_RESET_TOKEN` |

### Organización

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `getOrganization` · **H0**<br>Datos y configuración de mi organización | `GET /org` | Rescatista, Coordinador, Admin | — | 200: id, name, country, config | — |
| `listCoordinators` · **H1**<br>Coordinadores activos (selector «Coordinador responsable») | `GET /org/coordinators` | Coordinador, Admin | — | 200: items | — |

### Geo

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `geocode` · **H1**<br>Buscar una dirección (solo al pulsar buscar) | `GET /geo/geocode` | Coordinador, Admin | consulta: q | 200: items | `UPSTREAM_UNAVAILABLE` |
| `getElevation` · **H1**<br>Altitud de un punto | `GET /geo/elevation` | Coordinador, Admin | consulta: lat, lon | 200: lat, lon, elevationM | `OUTSIDE_COVERAGE` |

### Inicio

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `getEnvironment` · **H1**<br>Tiempo, luz y luna para la ubicación del dispositivo o el objetivo de una misión | `GET /environment` | Rescatista, Coordinador, Admin | consulta: lat?, lon?, missionId?, days? | 200: basis, missionId, location, weather, sun, moon, bulletins | `OUTSIDE_COVERAGE` |

### Misiones

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `listMissions` · **H1**<br>Lista de misiones con pestañas por estado | `GET /missions` | Coordinador, Admin | consulta: page?, pageSize?, status?, q?, coordinatorId? | 200: items, page, pageSize, total | — |
| `createMission` · **H1**<br>Crear misión (nace En planificación) *(auditado)* | `POST /missions` | Coordinador | cuerpo: name, coordinatorId?, target, description?, teamIds?, rescuerIds?, origins?, routes? | 201: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | `DUPLICATE_NAME` |
| `getMission` · **H1**<br>Detalle de misión (centro de trabajo) | `GET /missions/{missionId}` | Coordinador, Admin | ruta: missionId | 200: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | — |
| `updateMission` · **H1**<br>Editar datos de la misión *(auditado)* | `PATCH /missions/{missionId}` | Coordinador | ruta: missionId<br>cuerpo: name?, description?, coordinatorId?, target?, expectedUpdatedAt? | 200: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | `MISSION_CLOSED` `DUPLICATE_NAME` `STALE_RESOURCE` |
| `duplicateMission` · **H1**<br>Duplicar misión (puntos y, si se pide, rutas; sin participantes) *(auditado)* | `POST /missions/{missionId}/duplicate` | Coordinador | ruta: missionId<br>cuerpo: name, includeRoutes? | 201: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | `DUPLICATE_NAME` |
| `activateMission` · **H1**<br>Activar misión (abre el voluntariado) *(auditado)* | `POST /missions/{missionId}/activate` | Coordinador | ruta: missionId<br>cuerpo: confirmWithoutValidatedRoute? | 200: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | `INVALID_STATE_TRANSITION` `CONFIRMATION_REQUIRED` |
| `closeMission` · **H1**<br>Cerrar misión confirmando quién participó *(auditado)* | `POST /missions/{missionId}/close` | Coordinador | ruta: missionId<br>cuerpo: attendance | 200: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | `INVALID_STATE_TRANSITION` `ATTENDANCE_INCOMPLETE` |
| `reopenMission` · **H1**<br>Reabrir una misión cerrada como Activa *(auditado)* | `POST /missions/{missionId}/reopen` | Coordinador | ruta: missionId | 200: id, name, status, coordinator, target, origins, routes, participants, createdAt, … | `INVALID_STATE_TRANSITION` `DUPLICATE_NAME` |
| `listMissionHistory` · **H1**<br>Historial de cambios de la misión | `GET /missions/{missionId}/history` | Coordinador, Admin | ruta: missionId<br>consulta: page?, pageSize? | 200: items, page, pageSize, total | — |
| `listAttendanceCandidates` · **H6**<br>Aceptados para el diálogo «¿Quién participó?» | `GET /missions/{missionId}/attendance-candidates` | Coordinador | ruta: missionId | 200: items | — |

### Puntos

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `createMissionPoint` · **H1**<br>Añadir origen, punto intermedio o de reunión *(auditado)* | `POST /missions/{missionId}/points` | Coordinador | ruta: missionId<br>cuerpo: kind, name, note?, lat, lon | 201: id, kind, name, note, lat, lon, elevationM, position | `MISSION_CLOSED` |
| `importMissionPoints` · **H2**<br>Importar puntos desde un GPX/KML ya subido *(auditado)* | `POST /missions/{missionId}/points/import` | Coordinador | ruta: missionId<br>cuerpo: fileId, kind | 201: items | `MISSION_CLOSED` `INVALID_FILE_CONTENT` |
| `updateMissionPoint` · **H1**<br>Editar un punto *(auditado)* | `PATCH /missions/{missionId}/points/{pointId}` | Coordinador | ruta: missionId, pointId<br>cuerpo: kind?, name?, note?, lat?, lon?, position? | 200: id, kind, name, note, lat, lon, elevationM, position | `MISSION_CLOSED` |
| `deleteMissionPoint` · **H1**<br>Borrar un punto (no si una ruta de la misión sale de él) *(auditado)* | `DELETE /missions/{missionId}/points/{pointId}` | Coordinador | ruta: missionId, pointId | 204 | `MISSION_CLOSED` |

### Participantes

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `addMissionTeams` · **H6**<br>Asignar equipos: sus miembros entran como Aceptados *(auditado)* | `POST /missions/{missionId}/teams` | Coordinador | ruta: missionId<br>cuerpo: teamIds | 200: added, alreadyPresent | `MISSION_CLOSED` |
| `removeMissionTeam` · **H6**<br>Quitar la asignación de un equipo (no quita a sus miembros ya aceptados) *(auditado)* | `DELETE /missions/{missionId}/teams/{teamId}` | Coordinador | ruta: missionId, teamId | 204 | `MISSION_CLOSED` |
| `listParticipations` · **H6**<br>Bandeja de voluntarios y participantes (solo nombre, equipo y localidad) | `GET /missions/{missionId}/participations` | Coordinador, Admin | ruta: missionId<br>consulta: page?, pageSize?, status?, teamId?, locality?, q? | 200: items, page, pageSize, total, counts | — |
| `getParticipationCard` · **H6**<br>Ficha del voluntario | `GET /missions/{missionId}/participations/{participationId}` | Coordinador, Admin | ruta: missionId, participationId | 200: participation, skills, contact | — |
| `addParticipants` · **H6**<br>Añadir rescatistas sueltos como Aceptados *(auditado)* | `POST /missions/{missionId}/participations` | Coordinador | ruta: missionId<br>cuerpo: userIds | 200: added, alreadyPresent | `MISSION_CLOSED` |
| `bulkParticipations` · **H6**<br>Aceptar, rechazar, reconsiderar o quitar en bloque *(auditado)* | `POST /missions/{missionId}/participations/bulk` | Coordinador | ruta: missionId<br>cuerpo: action, selection, expectedCount? | 200: affected, skipped | `MISSION_CLOSED` `STALE_RESOURCE` |

### Perfil

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `getCertificateLink` · **H5**<br>Enlace firmado de corta vida para abrir un certificado *(auditado)* | `POST /skills/{skillId}/certificate-link` | Rescatista, Coordinador, Admin | ruta: skillId | 200: url, expiresAt | — |
| `getMyProfile` · **H5**<br>Mi perfil (documento y dirección enmascarados) | `GET /my/profile` | Rescatista | — | 200: status, fullName, email, phone, document, addressSummary, skills, teams, missingFields, … | — |
| `updateMyProfile` · **H5**<br>Rellenar el alta o corregir mis datos *(auditado)* | `PATCH /my/profile` | Rescatista | cuerpo: fullName?, phone?, document?, address? | 200: status, fullName, email, phone, document, addressSummary, skills, teams, missingFields, … | `INVALID_DOCUMENT` `DOCUMENT_ALREADY_REGISTERED` |
| `getMySensitive` · **H5**<br>Ver mi documento y dirección sin enmascarar | `GET /my/profile/sensitive` | Rescatista | — | 200: document, address | — |
| `deleteMyData` · **H6**<br>Eliminar mis datos (el historial queda anonimizado) *(auditado)* | `DELETE /my/profile` | Rescatista | cuerpo: password, confirm | 204 | `INVALID_CREDENTIALS` |
| `exportMyData` · **H6**<br>Descargar mis datos (JSON) | `GET /my/data-export` | Rescatista | — | 200 archivo | — |
| `listMySkills` · **H5**<br>Mis cursos y habilidades | `GET /my/skills` | Rescatista | — | 200: items | — |
| `createMySkill` · **H5**<br>Añadir curso o habilidad | `POST /my/skills` | Rescatista | cuerpo: name, kind, issuer?, issuedOn?, expiresOn?, certificateFileId? | 201: id, name, kind, issuer, issuedOn, expiresOn, hasCertificate | — |
| `updateMySkill` · **H5**<br>Editar curso o habilidad | `PATCH /my/skills/{skillId}` | Rescatista | ruta: skillId<br>cuerpo: name?, kind?, issuer?, issuedOn?, expiresOn?, certificateFileId? | 200: id, name, kind, issuer, issuedOn, expiresOn, hasCertificate | — |
| `deleteMySkill` · **H5**<br>Eliminar curso o habilidad | `DELETE /my/skills/{skillId}` | Rescatista | ruta: skillId | 204 | — |
| `listMyHistory` · **H6**<br>Mi historial de misiones (solo las confirmadas al cerrar) | `GET /my/history` | Rescatista | consulta: page?, pageSize? | 200: items, page, pageSize, total | — |
| `listMyAccessLog` · **H6**<br>Quién ha accedido a mis datos sensibles y certificados | `GET /my/access-log` | Rescatista | consulta: page?, pageSize? | 200: items, page, pageSize, total | — |

### Archivos

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `uploadFile` · **H2**<br>Subir un certificado (PDF/JPG/PNG) o un GPX/KML | `POST /files` | Rescatista, Coordinador, Admin | formulario: purpose + file | 201: id, purpose, contentType, sizeBytes, createdAt | `FILE_TOO_LARGE` `UNSUPPORTED_FILE_TYPE` `INVALID_FILE_CONTENT` |

### Equipos

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `listTeams` · **H5**<br>Equipos de la organización | `GET /teams` | Coordinador, Admin | consulta: page?, pageSize?, status?, q? | 200: items, page, pageSize, total | — |
| `createTeam` · **H5**<br>Crear equipo (nombre y localidad obligatorios) *(auditado)* | `POST /teams` | Coordinador, Admin | cuerpo: name, locality | 201: id, name, locality, status, memberCount, members, createdAt | `DUPLICATE_NAME` |
| `getTeam` · **H5**<br>Detalle de equipo con sus miembros (solo nombres) | `GET /teams/{teamId}` | Coordinador, Admin | ruta: teamId | 200: id, name, locality, status, memberCount, members, createdAt | — |
| `updateTeam` · **H5**<br>Editar o archivar un equipo *(auditado)* | `PATCH /teams/{teamId}` | Coordinador, Admin | ruta: teamId<br>cuerpo: name?, locality?, status? | 200: id, name, locality, status, memberCount, members, createdAt | `DUPLICATE_NAME` |
| `addTeamMembers` · **H5**<br>Añadir miembros *(auditado)* | `POST /teams/{teamId}/members` | Coordinador, Admin | ruta: teamId<br>cuerpo: userIds | 200: id, name, locality, status, memberCount, members, createdAt | — |
| `removeTeamMember` · **H5**<br>Quitar un miembro *(auditado)* | `DELETE /teams/{teamId}/members/{userId}` | Coordinador, Admin | ruta: teamId, userId | 204 | — |
| `listRescuers` · **H6**<br>Selector de rescatistas con perfil completo | `GET /rescuers` | Coordinador, Admin | consulta: page?, pageSize?, q?, teamId?, profileComplete? | 200: items, page, pageSize, total | — |

### Rutas

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `listRoutes` · **H2**<br>Biblioteca: rutas del área visible, con filtros | `GET /routes` | Coordinador, Admin | consulta: page?, pageSize?, bbox?, q?, status?, versionStatus?, minDistanceM?, maxDistanceM?, minAscentM?, … | 200: items, page, pageSize, total | — |
| `createRoute` · **H2**<br>Crear ruta importada o dibujada (versión 1 en Borrador) *(auditado)* | `POST /routes` | Coordinador | cuerpo: source?, name?, fileId?, note?, addToMission?, geometry? | 201: routeId, versionId, versionNumber, missionRouteId | `INVALID_FILE_CONTENT` `MISSION_HAS_NO_ORIGIN` `MISSION_CLOSED` |
| `snapRoute` · **H3**<br>Unir puntos siguiendo caminos (vista previa, no guarda) | `POST /routes/snap` | Coordinador, Admin | cuerpo: points | 200: geometry, metrics, roadMix, offTrailShare | `NO_ROUTE_POSSIBLE` `OUTSIDE_COVERAGE` `ROUTING_UNAVAILABLE` |
| `previewRouteImport` · **H2**<br>Vista previa de un GPX/KML subido (no guarda) | `POST /routes/import/preview` | Coordinador, Admin | cuerpo: fileId | 200: trackName, candidate, waypointCount, warnings | `INVALID_FILE_CONTENT` |
| `generateRoutes` · **H3**<br>Generar alternativas en segundo plano *(auditado)* | `POST /routes/generate` | Coordinador | cuerpo: from, to, via?, avoidZoneIds?, alternatives?, namePrefix?, addToMission? | 202: jobId | `MISSION_HAS_NO_ORIGIN` `MISSION_CLOSED` `ROUTING_UNAVAILABLE` |
| `listNearRoutes` · **H8** (2.ª entrega)<br>Rutas que pasan cerca de un punto | `GET /routes/near` | Coordinador, Admin | consulta: lat, lon, radiusM?, limit? | 200: items | — |
| `getRoute` · **H2**<br>Detalle de ruta: versiones, derivadas, uso | `GET /routes/{routeId}` | Coordinador, Admin | ruta: routeId | 200: id, name, status, versions, derivedFrom, derivatives, usedIn, createdAt, updatedAt | — |
| `archiveRoute` · **H2**<br>Archivar ruta (no si está en una misión no cerrada) *(auditado)* | `POST /routes/{routeId}/archive` | Coordinador | ruta: routeId | 200: id, name, status, versions, derivedFrom, derivatives, usedIn, createdAt, updatedAt | `ROUTE_IN_USE` |
| `getRouteVersion` · **H2**<br>Versión con trazado, tramos y perfil de elevación | `GET /routes/{routeId}/versions/{versionId}` | Coordinador, Admin | ruta: routeId, versionId | 200: id, number, status, provenance, manuallyModified, metrics, roadMix, note, createdBy, … | — |
| `createRouteVersion` · **H2**<br>Editar: crea una versión nueva en Borrador *(auditado)* | `POST /routes/{routeId}/versions` | Coordinador | ruta: routeId<br>cuerpo: baseVersionId, geometry, note?, calculationJobId? | 201: routeId, versionId, versionNumber, missionRouteId | `MISSION_CLOSED` |
| `deriveRoute` · **H2**<br>Guardar como nueva ruta derivada *(auditado)* | `POST /routes/{routeId}/derive` | Coordinador | ruta: routeId<br>cuerpo: name, fromVersionId, geometry?, note?, calculationJobId?, addToMission? | 201: routeId, versionId, versionNumber, missionRouteId | — |
| `validateRouteVersion` · **H2**<br>Validar una versión (la hace inmutable y visible a rescatistas) *(auditado)* | `POST /routes/{routeId}/versions/{versionId}/validate` | Coordinador | ruta: routeId, versionId<br>cuerpo: acknowledged | 200: id, number, status, provenance, manuallyModified, metrics, roadMix, note, createdBy, … | `VERSION_IMMUTABLE` |
| `adaptRoute` · **H9** (2.ª entrega)<br>Adaptar: conservar hasta un corte y recalcular el resto *(auditado)* | `POST /routes/{routeId}/adapt` | Coordinador | ruta: routeId<br>cuerpo: versionId, cutPoint, newEnd, avoidZoneIds? | 202: jobId | — |
| `exportRoute` · **H2**<br>Descargar una versión como GPX o KML | `GET /routes/{routeId}/export` | Coordinador, Admin | ruta: routeId<br>consulta: versionId?, format? | 200 archivo | — |
| `getJob` · **H3**<br>Progreso y resultado de un cálculo | `GET /jobs/{jobId}` | Coordinador, Admin | ruta: jobId | 200: id?, status?, progress?, errorCode?, createdAt?, finishedAt?, kind?, result? | — |
| `listAvoidZones` · **H3**<br>Zonas a evitar de la organización o de una misión | `GET /avoid-zones` | Coordinador, Admin | consulta: missionId? | 200: items | — |
| `createAvoidZone` · **H3**<br>Dibujar una zona a evitar *(auditado)* | `POST /avoid-zones` | Coordinador | cuerpo: missionId?, geometry, reason? | 201: id, missionId, geometry, reason, createdAt | — |
| `deleteAvoidZone` · **H3**<br>Borrar una zona a evitar *(auditado)* | `DELETE /avoid-zones/{zoneId}` | Coordinador | ruta: zoneId | 204 | — |

### Rutas de la misión

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `listMissionRoutes` · **H4**<br>Tabla comparativa de rutas de la misión | `GET /missions/{missionId}/routes` | Coordinador, Admin | ruta: missionId | 200: items | — |
| `addMissionRoutes` · **H4**<br>Añadir rutas de la biblioteca fijando versión *(auditado)* | `POST /missions/{missionId}/routes` | Coordinador | ruta: missionId<br>cuerpo: items | 201: items | `MISSION_CLOSED` `ROUTE_ALREADY_IN_MISSION` |
| `updateMissionRoute` · **H4**<br>Cambiar versión fijada, marcar no disponible, origen, equipo o nota *(auditado)* | `PATCH /missions/{missionId}/routes/{missionRouteId}` | Coordinador | ruta: missionId, missionRouteId<br>cuerpo: pinnedVersionId?, status?, originPointId?, teamId?, note? | 200: id, routeId, name, status, pinned, newerValidatedVersion, validationIsStale, origin, team, … | `MISSION_CLOSED` |
| `removeMissionRoute` · **H4**<br>Quitar una ruta de la misión (la ruta sigue en la biblioteca) *(auditado)* | `DELETE /missions/{missionId}/routes/{missionRouteId}` | Coordinador | ruta: missionId, missionRouteId | 204 | `MISSION_CLOSED` |
| `getMissionRouteGeometry` · **H4**<br>Trazado, tramos y perfil de la versión fijada | `GET /missions/{missionId}/routes/{missionRouteId}/geometry` | Coordinador, Admin | ruta: missionId, missionRouteId | 200: missionRouteId, versionNumber, geometry, segments, elevationProfile | — |
| `exportMissionRoutes` · **H4**<br>Exportar las rutas de la misión en un solo GPX/KML | `GET /missions/{missionId}/routes/export` | Coordinador, Admin | ruta: missionId<br>consulta: format?, ids? | 200 archivo | — |

### Rescatista

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `listMyMissions` · **H1**<br>Misiones activas y cerradas, con el estado de mi oferta | `GET /my/missions` | Rescatista | consulta: page?, pageSize?, status?, q? | 200: items, page, pageSize, total | — |
| `getMyMission` · **H1**<br>Detalle de misión en solo lectura | `GET /my/missions/{missionId}` | Rescatista | ruta: missionId | 200: id, name, description, status, target, coordinatorName, points, myParticipation, canOffer, … | — |
| `offerToMission` · **H6**<br>Me ofrezco como voluntario *(auditado)* | `POST /my/missions/{missionId}/offer` | Rescatista | ruta: missionId | 201: status, offeredAt, decidedAt | `PROFILE_INCOMPLETE` `MISSION_NOT_ACTIVE` `ALREADY_OFFERED` |
| `withdrawOffer` · **H6**<br>Retirar mi oferta *(auditado)* | `DELETE /my/missions/{missionId}/offer` | Rescatista | ruta: missionId | 200: status, offeredAt, decidedAt | `MISSION_NOT_ACTIVE` `INVALID_STATE_TRANSITION` |
| `listMyMissionRoutes` · **H4**<br>Rutas validadas de la misión | `GET /my/missions/{missionId}/routes` | Rescatista | ruta: missionId | 200: items | — |
| `getMyMissionRouteGeometry` · **H4**<br>Trazado y perfil de una ruta validada | `GET /my/missions/{missionId}/routes/{missionRouteId}/geometry` | Rescatista | ruta: missionId, missionRouteId | 200: missionRouteId, versionNumber, geometry, segments, elevationProfile | — |
| `exportMyMissionRoutes` · **H4**<br>Exportar rutas validadas (solo de misiones activas) | `GET /my/missions/{missionId}/routes/export` | Rescatista | ruta: missionId<br>consulta: format?, ids? | 200 archivo | `MISSION_NOT_ACTIVE` |

### Administración

| Operación | Petición | Quién | Entrada | Respuesta | Errores propios |
|---|---|---|---|---|---|
| `listSignupRequests` · **H5**<br>Solicitudes de alta (bandeja) | `GET /admin/signup-requests` | Admin | consulta: page?, pageSize?, status?, q? | 200: items, page, pageSize, total | — |
| `decideSignupRequests` · **H5**<br>Aprobar (con rol) o rechazar, también en bloque *(auditado)* | `POST /admin/signup-requests/decide` | Admin | cuerpo: action, role?, selection | 200: affected, skipped | — |
| `listUsers` · **H5**<br>Usuarios de la organización | `GET /admin/users` | Admin | consulta: page?, pageSize?, q?, role?, accountStatus? | 200: items, page, pageSize, total | — |
| `getUser` · **H5**<br>Ficha de usuario (contacto y habilidades, sin documento ni dirección) | `GET /admin/users/{userId}` | Admin | ruta: userId | 200: userId, displayName, email, role, accountStatus, lastLoginAt, profileStatus, hasMissionsAsResponsible, phone, … | — |
| `updateUser` · **H5**<br>Cambiar rol, desactivar o reactivar *(auditado)* | `PATCH /admin/users/{userId}` | Admin | ruta: userId<br>cuerpo: role?, accountStatus?, reassignMissionsTo? | 200: userId, displayName, email, role, accountStatus, lastLoginAt, profileStatus, hasMissionsAsResponsible, phone, … | `COORDINATOR_HAS_MISSIONS` `LAST_ADMIN` |
| `readUserSensitive` · **H6**<br>Leer documento y dirección (auditado) *(auditado)* | `POST /admin/users/{userId}/sensitive` | Admin | ruta: userId | 200: userId, document, address | — |
| `listUserHistory` · **H6**<br>Historial de misiones de un rescatista | `GET /admin/users/{userId}/history` | Admin | ruta: userId<br>consulta: page?, pageSize? | 200: items, page, pageSize, total | — |
| `listAuditLog` · **H6**<br>Registro de accesos y cambios de cuenta | `GET /admin/audit-log` | Admin | consulta: page?, pageSize?, userId?, action?, from?, to?, onlyAccessToPersonalData? | 200: items, page, pageSize, total | — |
| `getInviteCode` · **H5**<br>Ver el código de invitación | `GET /admin/invite-code` | Admin | — | 200: code, rotatedAt | — |
| `rotateInviteCode` · **H5**<br>Regenerar el código de invitación *(auditado)* | `POST /admin/invite-code/rotate` | Admin | cuerpo:  | 200: code, rotatedAt | — |



## 7. Qué campos devuelve cada lista

Estas tablas son las que hacen cumplir RN-18 y RN-21. Lo que no aparece aquí **no existe** en la respuesta (AC-16).

#### Lista de misiones (personal)

`GET /missions` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `name` | texto |  |
| `status` | planning \| active \| closed |  |
| `coordinator` | objeto \| null |  |
| `coordinator.id` | uuid |  |
| `coordinator.displayName` | texto |  |
| `target` | objeto |  |
| `target.lat` | número | ≥-90, ≤90 |
| `target.lon` | número | ≥-180, ≤180 |
| `target.elevationM` | número | ≥-500, ≤9000 |
| `target.label` | texto \| null |  |
| `target.country` | texto \| null |  |
| `target.source` | coordinates \| map \| address |  |
| `origins` | lista de objeto |  |
| `origins[].id` | uuid |  |
| `origins[].name` | texto |  |
| `routes` | objeto |  |
| `routes.validated` | entero |  |
| `routes.total` | entero |  |
| `participants` | objeto |  |
| `participants.accepted` | entero |  |
| `participants.pending` | entero |  |
| `createdAt` | fecha-hora |  |
| `updatedAt` | fecha-hora |  |

#### Detalle de misión (personal)

`GET /missions/{missionId}` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `name` | texto |  |
| `status` | planning \| active \| closed |  |
| `coordinator` | objeto \| null |  |
| `coordinator.id` | uuid |  |
| `coordinator.displayName` | texto |  |
| `target` | objeto |  |
| `target.lat` | número | ≥-90, ≤90 |
| `target.lon` | número | ≥-180, ≤180 |
| `target.elevationM` | número | ≥-500, ≤9000 |
| `target.label` | texto \| null |  |
| `target.country` | texto \| null |  |
| `target.source` | coordinates \| map \| address |  |
| `origins` | lista de objeto |  |
| `origins[].id` | uuid |  |
| `origins[].name` | texto |  |
| `routes` | objeto |  |
| `routes.validated` | entero |  |
| `routes.total` | entero |  |
| `participants` | objeto |  |
| `participants.accepted` | entero |  |
| `participants.pending` | entero |  |
| `createdAt` | fecha-hora |  |
| `updatedAt` | fecha-hora |  |
| `description` | texto \| null |  |
| `activatedAt` | fecha-hora \| null |  |
| `closedAt` | fecha-hora \| null |  |
| `points` | lista de objeto |  |
| `points[].id` | uuid |  |
| `points[].kind` | origin \| waypoint \| rendezvous |  |
| `points[].name` | texto |  |
| `points[].note` | texto \| null |  |
| `points[].lat` | número | ≥-90, ≤90 |
| `points[].lon` | número | ≥-180, ≤180 |
| `points[].elevationM` | número | ≥-500, ≤9000 |
| `points[].position` | entero |  |
| `teams` | lista de objeto |  |
| `teams[].id` | uuid |  |
| `teams[].name` | texto |  |
| `teams[].locality` | texto |  |
| `readiness` | objeto |  |
| `readiness.targetDefined` | booleano |  |
| `readiness.hasOrigins` | booleano |  |
| `readiness.hasParticipants` | booleano |  |
| `readiness.hasValidatedRoute` | booleano |  |
| `routesWithNewerValidatedVersion` | entero | ≥0 |
| `actions` | objeto |  |
| `actions.edit` | booleano |  |
| `actions.activate` | booleano |  |
| `actions.close` | booleano |  |
| `actions.reopen` | booleano |  |
| `actions.duplicate` | booleano |  |
| `actions.manageParticipants` | booleano |  |
| `actions.manageRoutes` | booleano |  |

#### Bandeja de voluntarios y participantes

`GET /missions/{missionId}/participations` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `userId` | uuid |  |
| `displayName` | texto |  |
| `teams` | lista de objeto |  |
| `teams[].id` | uuid |  |
| `teams[].name` | texto |  |
| `teams[].locality` | texto |  |
| `status` | pending \| accepted \| not_selected |  |
| `origin` | volunteer \| team \| coordinator |  |
| `offeredAt` | fecha-hora \| null |  |
| `decidedAt` | fecha-hora \| null |  |

#### Ficha del voluntario

`GET /missions/{missionId}/participations/{participationId}` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `participation` | objeto |  |
| `participation.id` | uuid |  |
| `participation.userId` | uuid |  |
| `participation.displayName` | texto |  |
| `participation.teams` | lista de objeto |  |
| `participation.status` | pending \| accepted \| not_selected |  |
| `participation.origin` | volunteer \| team \| coordinator |  |
| `participation.offeredAt` | fecha-hora \| null |  |
| `participation.decidedAt` | fecha-hora \| null |  |
| `skills` | lista de objeto |  |
| `skills[].id` | uuid |  |
| `skills[].name` | texto |  |
| `skills[].kind` | course \| skill |  |
| `skills[].issuer` | texto \| null |  |
| `skills[].issuedOn` | fecha \| null |  |
| `skills[].expiresOn` | fecha \| null |  |
| `skills[].hasCertificate` | booleano |  |
| `contact` | objeto \| null |  |
| `contact.phone` | texto |  |
| `contact.email` | texto |  |

#### Selector de rescatistas

`GET /rescuers` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `userId` | uuid |  |
| `displayName` | texto |  |
| `teams` | lista de objeto |  |
| `teams[].id` | uuid |  |
| `teams[].name` | texto |  |
| `teams[].locality` | texto |  |

#### Lista de equipos

`GET /teams` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `name` | texto |  |
| `locality` | texto |  |
| `status` | active \| archived |  |
| `memberCount` | entero | ≥0 |

#### Biblioteca de rutas

`GET /routes` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `name` | texto |  |
| `status` | active \| archived |  |
| `latestVersion` | objeto |  |
| `latestVersion.id` | uuid |  |
| `latestVersion.number` | entero | ≥1 |
| `latestVersion.status` | draft \| validated |  |
| `latestVersion.metrics` | objeto |  |
| `latestValidated` | objeto \| null |  |
| `latestValidated.versionId` | uuid |  |
| `latestValidated.number` | entero | ≥1 |
| `latestValidated.validatedAt` | fecha-hora |  |
| `latestValidated.isStale` | booleano |  |
| `usedInMissions` | entero | ≥0 |
| `derivedFromRouteId` | uuid \| null |  |
| `previewGeometry` | objeto |  |
| `previewGeometry.type` | "LineString" |  |
| `previewGeometry.coordinates` | lista de [número, número] |  |
| `updatedAt` | fecha-hora |  |

#### Rutas de la misión (coordinador)

`GET /missions/{missionId}/routes` · Coordinador, Admin

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `routeId` | uuid |  |
| `name` | texto |  |
| `status` | added \| unavailable |  |
| `pinned` | objeto |  |
| `pinned.versionId` | uuid |  |
| `pinned.number` | entero | ≥1 |
| `pinned.status` | draft \| validated |  |
| `pinned.validatedAt` | fecha-hora \| null |  |
| `pinned.metrics` | objeto |  |
| `pinned.roadMix` | lista de objeto |  |
| `newerValidatedVersion` | objeto \| null |  |
| `newerValidatedVersion.versionId` | uuid |  |
| `newerValidatedVersion.number` | entero |  |
| `validationIsStale` | booleano |  |
| `origin` | objeto \| null |  |
| `origin.id` | uuid |  |
| `origin.name` | texto |  |
| `team` | objeto \| null |  |
| `team.id` | uuid |  |
| `team.name` | texto |  |
| `team.locality` | texto |  |
| `note` | texto \| null |  |
| `previewGeometry` | objeto |  |
| `previewGeometry.type` | "LineString" |  |
| `previewGeometry.coordinates` | lista de [número, número] |  |
| `addedAt` | fecha-hora |  |

#### Mis misiones (rescatista)

`GET /my/missions` · Rescatista

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `name` | texto |  |
| `status` | active \| closed |  |
| `target` | objeto |  |
| `target.lat` | número | ≥-90, ≤90 |
| `target.lon` | número | ≥-180, ≤180 |
| `target.elevationM` | número | ≥-500, ≤9000 |
| `target.label` | texto \| null |  |
| `target.country` | texto \| null |  |
| `target.source` | coordinates \| map \| address |  |
| `coordinatorName` | texto \| null |  |
| `validatedRoutes` | entero | ≥0 |
| `myParticipation` | objeto \| null |  |
| `myParticipation.status` | pending \| accepted \| not_selected \| withdrawn \| removed |  |
| `myParticipation.offeredAt` | fecha-hora \| null |  |
| `myParticipation.decidedAt` | fecha-hora \| null |  |

#### Detalle de misión (rescatista)

`GET /my/missions/{missionId}` · Rescatista

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `name` | texto |  |
| `description` | texto \| null |  |
| `status` | active \| closed |  |
| `target` | objeto |  |
| `target.lat` | número | ≥-90, ≤90 |
| `target.lon` | número | ≥-180, ≤180 |
| `target.elevationM` | número | ≥-500, ≤9000 |
| `target.label` | texto \| null |  |
| `target.country` | texto \| null |  |
| `target.source` | coordinates \| map \| address |  |
| `coordinatorName` | texto \| null |  |
| `points` | lista de objeto |  |
| `points[].id` | uuid |  |
| `points[].kind` | origin \| waypoint \| rendezvous |  |
| `points[].name` | texto |  |
| `points[].note` | texto \| null |  |
| `points[].lat` | número | ≥-90, ≤90 |
| `points[].lon` | número | ≥-180, ≤180 |
| `points[].elevationM` | número | ≥-500, ≤9000 |
| `points[].position` | entero |  |
| `myParticipation` | objeto \| null |  |
| `myParticipation.status` | pending \| accepted \| not_selected \| withdrawn \| removed |  |
| `myParticipation.offeredAt` | fecha-hora \| null |  |
| `myParticipation.decidedAt` | fecha-hora \| null |  |
| `canOffer` | booleano |  |
| `canWithdraw` | booleano |  |
| `offerBlockedReason` | profile_incomplete \| mission_not_active \| already_offered \| null |  |

#### Rutas de la misión (rescatista)

`GET /my/missions/{missionId}/routes` · Rescatista

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid |  |
| `routeId` | uuid |  |
| `name` | texto |  |
| `status` | added \| unavailable |  |
| `versionNumber` | entero | ≥1 |
| `validatedAt` | fecha-hora |  |
| `metrics` | objeto |  |
| `metrics.distanceM` | número | ≥0 |
| `metrics.ascentM` | número | ≥0 |
| `metrics.descentM` | número | ≥0 |
| `metrics.minElevationM` | número |  |
| `metrics.maxElevationM` | número |  |
| `metrics.maxSlopePct` | número | ≥0 |
| `roadMix` | lista de objeto |  |
| `roadMix[].roadType` | road \| track \| path \| offtrail |  |
| `roadMix[].distanceM` | número | ≥0 |
| `origin` | objeto \| null |  |
| `origin.id` | uuid |  |
| `origin.name` | texto |  |
| `team` | objeto \| null |  |
| `team.id` | uuid |  |
| `team.name` | texto |  |
| `team.locality` | texto |  |
| `previewGeometry` | objeto |  |
| `previewGeometry.type` | "LineString" |  |
| `previewGeometry.coordinates` | lista de [número, número] |  |

#### Mi perfil

`GET /my/profile` · Rescatista

| Campo | Tipo | Notas |
|---|---|---|
| `status` | incomplete \| complete \| deleted |  |
| `fullName` | texto |  |
| `email` | texto |  |
| `phone` | texto \| null |  |
| `document` | objeto \| null |  |
| `document.type` | dni \| nie \| passport \| other |  |
| `document.masked` | texto |  |
| `addressSummary` | texto \| null |  |
| `skills` | lista de objeto |  |
| `skills[].id` | uuid |  |
| `skills[].name` | texto |  |
| `skills[].kind` | course \| skill |  |
| `skills[].issuer` | texto \| null |  |
| `skills[].issuedOn` | fecha \| null |  |
| `skills[].expiresOn` | fecha \| null |  |
| `skills[].hasCertificate` | booleano |  |
| `teams` | lista de objeto |  |
| `teams[].id` | uuid |  |
| `teams[].name` | texto |  |
| `teams[].locality` | texto |  |
| `missingFields` | lista de fullName \| phone \| document \| address |  |
| `completedAt` | fecha-hora \| null |  |

#### Solicitudes de alta

`GET /admin/signup-requests` · Admin

| Campo | Tipo | Notas |
|---|---|---|
| `userId` | uuid |  |
| `email` | texto |  |
| `displayName` | texto |  |
| `status` | pending \| approved \| rejected |  |
| `requestedAt` | fecha-hora |  |

#### Usuarios (administrador)

`GET /admin/users` · Admin

| Campo | Tipo | Notas |
|---|---|---|
| `userId` | uuid |  |
| `displayName` | texto |  |
| `email` | texto |  |
| `role` | coordinator \| rescuer \| admin |  |
| `accountStatus` | pending \| active \| rejected \| disabled |  |
| `lastLoginAt` | fecha-hora \| null |  |
| `profileStatus` | incomplete \| complete \| deleted \| null |  |
| `hasMissionsAsResponsible` | entero | ≥0 |



### 7.1 Quién ve cada dato personal y por qué endpoint

| Dato | Rescatista (el suyo) | Coordinador | Admin |
|---|---|---|---|
| Nombre, equipos, localidad del equipo | `getMyProfile` | Bandeja, selector, ficha | Todos los de arriba y `getUser` |
| Cursos y habilidades | `getMyProfile` | Ficha del voluntario | `getUser` |
| Certificado | `getCertificateLink` (propio) | `getCertificateLink`, solo de quien tiene participación *Pendiente* o *Aceptada* en sus misiones; **auditado** | `getCertificateLink`; **auditado** |
| Teléfono y correo | `getMyProfile` | **Solo** en la ficha, y solo con participación *Pendiente* o *Aceptada* (INV-28) | `getUser`, `listSignupRequests`, `listUsers` |
| Historial de misiones | `listMyHistory` | **Ninguno** | `listUserHistory` |
| Documento y dirección | `getMySensitive` (sin enmascarar, a petición); `getMyProfile` los enseña enmascarados | **Ninguno** | `readUserSensitive`; **auditado** |
| Quién accedió a mis datos | `listMyAccessLog` | — | `listAuditLog` |

## 8. Flujos clave

### 8.1 Generar rutas desde una misión

```mermaid
sequenceDiagram
    participant W as Web
    participant A as API
    participant Q as Cola (pg-boss)
    participant K as Worker
    W->>A: POST /routes/generate {from, to, via, alternatives, addToMission}
    A->>A: valida, la misión debe tener origen (RN-08)
    A->>Q: encola trabajo
    A-->>W: 202 {jobId}
    loop cada 1–2 s
        W->>A: GET /jobs/{jobId}
        A-->>W: {status, progress}
    end
    K->>K: motor de rutas, altitudes, métricas, tramos
    K->>A: guarda rutas en Borrador y las añade a la misión
    W->>A: GET /jobs/{jobId}
    A-->>W: {status: completed, result: {routeIds}}
    W->>A: GET /missions/{id}/routes
```

Si el trabajo falla, `status = failed` y `errorCode` es `NO_ROUTE_POSSIBLE`, `OUTSIDE_COVERAGE`, `ROUTING_UNAVAILABLE` o `INTERNAL`; la web propone ajustar puntos o zonas (doc. 02 §3.6). El resultado de un trabajo se guarda en `calculation_jobs.result` (columna añadida en la migración 0005 al escribir este documento).

### 8.2 Cerrar una misión confirmando quién participó

```mermaid
sequenceDiagram
    participant W as Web
    participant A as API
    W->>A: GET /missions/{id}/attendance-candidates
    A-->>W: aceptados con su equipo
    Note over W: todos marcados por defecto, el coordinador desmarca
    W->>A: POST /missions/{id}/close {attendance: [{participationId, participated}]}
    alt falta algún aceptado
        A-->>W: 422 ATTENDANCE_INCOMPLETE {missingParticipationIds}
    else correcto
        A->>A: una transacción: estado cerrada + participated de todos
        A-->>W: 200 MissionDetail
    end
```

Con cero aceptados se envía `attendance: []` y el diálogo no se muestra. Cancelar el diálogo no llama a la API.

### 8.3 Dónde lleva el inicio de sesión

```mermaid
flowchart TD
    L["POST /auth/login"] --> S{"accountStatus"}
    S -- "pending" --> W["nextStep = awaiting-approval<br/>solo /auth/me y /auth/logout"]
    S -- "rejected" --> R["403 ACCOUNT_REJECTED"]
    S -- "disabled" --> D["403 ACCOUNT_DISABLED"]
    S -- "active" --> P{"rol y perfil"}
    P -- "rescatista, perfil incompleto" --> C["nextStep = complete-profile"]
    P -- "resto" --> H["nextStep = home"]
```

### 8.4 Bandeja de voluntarios

1. `GET …/participations?status=pending` abre la pestaña con `counts` para las tres pestañas.
2. La casilla de cabecera selecciona los de la página (`ids`). «Seleccionar los 134 resultados» cambia a `filter` + `exceptIds`.
3. `POST …/participations/bulk {action: "accept", selection}` devuelve `{affected, skipped[]}`; las filas que ya no admiten la transición (retiró su oferta) vienen en `skipped` con motivo, y la web avisa.
4. «Quitar» pide confirmación con el número de afectados y lo envía como `expectedCount`.
5. Tocar un nombre llama a `GET …/participations/{id}` (la ficha). Es una consulta individual, no un listado.

## 9. Pruebas de contrato

Se ejecutan con `pnpm --filter @onway/contracts test` (74 pruebas, sin base de datos). Qué garantizan:

| Prueba | Qué impide |
|---|---|
| **Paridad con SQL** | Que un enum de Zod difiera de un `CREATE TYPE … AS ENUM` de `db/migrations`; igualan también tipos de archivo, tamaño máximo y patrón de teléfono |
| **Sin datos personales en listados** | Que `phone`, `email`, `document*`, `address*`, `history` aparezcan en bandeja, selector, equipos, misiones, rutas o listas del rescatista |
| **Ficha del voluntario** | Que lleve documento, dirección o historial; solo se admiten teléfono y correo |
| **Rutas del rescatista** | Que lleven notas internas, borradores, quién validó o la versión más nueva |
| **Roles por ruta** | Que algo bajo `/my/` se abra a otro rol, algo bajo `/admin/` a otro que no sea admin, o que una escritura sobre misiones o rutas se abra a rescatista, pendiente o público |
| **Cuentas pendientes y públicas** | Que un pendiente llame a algo más que `logout` y `me`, o que haya endpoints públicos fuera de la lista (`login`, `register`, `health`, recuperación) |
| **Sin borrado de misiones ni rutas** | RN-14 |
| **Estrictos** | Que un objeto de petición o de respuesta acepte campos desconocidos |
| **Coherencia del registro** | ids y rutas únicos, `{parámetros}` declarados, estados HTTP coherentes con el cuerpo, rutas estáticas no tapadas por rutas con parámetro, todos los esquemas convertibles a OpenAPI |
| **Reglas de entrada** | DNI y NIE con letra de control, objetivo en las tres formas con rangos, cierre sin repetidos, «quitar» con `expectedCount`, aprobar con rol, coordenadas en texto de consulta, bbox, polígono cerrado, etc. |

Una prueba **encontró un fallo real** mientras se escribía el contrato: las coordenadas de las consultas (`?lat=42.5`) llegan como texto y el esquema las rechazaba. Corregido con `QueryLat`/`QueryLon`.

## 10. Enlace con la base de datos (documento 05)

| Operación | Mecanismo en la base de datos |
|---|---|
| `register` | `auth_register(...)` |
| `login` | `auth_find_user` y `auth_record_attempt` (bloqueo tras 5 fallos, 15 min) |
| `forgotPassword` | `auth_request_password_reset`: devuelve a quién escribir o ninguna fila; guarda solo el hash del token; máx. 3 por hora y cuenta |
| `resetPassword` | `auth_consume_password_reset`: un solo uso, cierra todas las sesiones, quita el bloqueo, audita |
| `decideSignupRequests` | `admin_decide_signup(user, aprobar, rol)` por cada usuario, en una transacción |
| `updateUser` | `admin_set_account_status` y actualización de `memberships.role`; `LAST_ADMIN` y `COORDINATOR_HAS_MISSIONS` se comprueban en el servicio antes |
| `readUserSensitive` | `read_rescuer_sensitive(perfil)`: audita en la misma transacción (INV-19) |
| `deleteMyData` | `delete_own_rescuer_data()`; el worker borra después los archivos de las claves devueltas |
| `getCertificateLink` | El servicio comprueba rol y relación (INV-28), escribe en `audit_log` (INV-26) y firma el enlace |
| `closeMission` | Una transacción: estado, `closed_at`, `participated` de todos los aceptados; la protegen el `CHECK` y el disparador de INV-27 |
| `offerToMission` | Insertar en `participations`; el disparador `participations_guard` rechaza el perfil incompleto (INV-20) y la misión no activa |
| `validateRouteVersion` | Cambio de estado de la versión; el disparador la hace inmutable (INV-04) y se actualiza `latest_validated_version_id` |
| `listParticipations` | La consulta de «Lista de voluntarios» del documento 05 §8; el contacto nunca se une. Índice `participations (mission_id, status, offered_at DESC)` |
| `listMissionHistory` | `audit_log` por `entity_type = 'mission'` y `entity_id`; **convención:** toda acción de una misión (participaciones, rutas, puntos) se registra con ese par y el detalle propio en `detail` |

### 10.1 Cambios que este contrato pidió a la base de datos

- `calculation_jobs.result jsonb` (migración 0005): resultado del trabajo (`routeIds` o candidato de adaptación).
- `organizations.validation_max_age_days integer NOT NULL DEFAULT 90` (migración 0002): el «N días» de RF-519, configurable por organización (Q-35, confirmado: 90).
- **Migración 0009** `password_resets` y sus dos funciones (Q-33, §10.2). La tabla no da permisos a `onway_app`: solo se toca por las funciones.
- Las pruebas de la base de datos pasan de 97 a **118**, todas en verde.

### 10.2 Recuperar contraseña (Q-33, resuelta)

**Decisión:** correo transaccional detrás de un puerto `Mailer` (como `FileStorage` y `RoutingProvider`), con **Resend** como primera implementación (plan gratuito: 3 000 correos al mes y 100 al día, muy por encima de lo que necesita una organización). Si cambia el proveedor o se prefiere SMTP propio, se cambia una implementación y no el contrato. En desarrollo y pruebas, un `Mailer` que escribe en consola (o Mailpit).

Flujo:

1. `POST /auth/password/forgot {email}` → el API genera 32 bytes aleatorios, guarda su SHA-256 con `auth_request_password_reset` y, si la función devuelve una fila, envía el enlace `https://<dominio>/restablecer?token=…`. Responde 202 siempre, con o sin fila.
2. La persona abre el enlace y envía `POST /auth/password/reset {token, newPassword}`. Token válido: contraseña nueva (Argon2id), todas las sesiones cerradas, bloqueo por intentos retirado. Token inexistente, usado o caducado: `422 INVALID_RESET_TOKEN`.
3. El token caduca a la hora y es de un solo uso. Al usar uno, los demás pendientes de esa persona quedan anulados.

Dependencias sin resolver: Resend exige **verificar un dominio** para enviar a cualquier destinatario (Q-28, dominio aún sin comprar); hasta entonces solo envía al propietario de la cuenta, suficiente para desarrollar. Y el correo necesita su plantilla en es y fr (`packages/i18n`).

### 10.3 Lo que el contrato no cubre

- **Cálculo real de rutas** (`snap`, `generate`, `adapt`), geocodificación y altitud: el contrato fija la forma, no el motor. Siguen sujetos al motor de rutas (candidato GraphHopper tras el puerto `RoutingProvider`, doc. 04).

## 11. Qué está verificado y qué no

**Verificado:** los esquemas compilan con TypeScript estricto (`noUncheckedIndexedAccess`) y pasan las 83 pruebas (74 de contrato y 9 del cliente generado); el OpenAPI generado (95 operaciones, 78 rutas) tiene ids únicos, todas las `$ref` resuelven y los parámetros de ruta coinciden; los enums coinciden con las migraciones; las migraciones pasan las 118 pruebas sobre PostGIS real. En H0 las 5 operaciones del hito (`getHealth`, `login`, `logout`, `getMe`, `getOrganization`) están montadas en `apps/api` y sus respuestas se validan contra estos esquemas en `test:api`; la prueba E2E de H0 recorre `login`, `getMe`, `getOrganization` y `logout` contra `docker compose up`.

**No verificado:**
- El OpenAPI no se ha pasado por un validador oficial (no hay acceso a internet desde el entorno de trabajo; solo comprobaciones propias).
- ~~Se probó con Zod 4 instalado localmente.~~ Confirmado con `pnpm install` desde el registro de npm: Zod 4.6.7 se comporta igual.
- `nestjs-zod` no se usa: la API valida con un interceptor propio sobre los mismos esquemas (H0). El generador del cliente (`gen:client`) sí está integrado y lo consume la web.
- Nada de lo geoespacial (candidatos, perfiles de elevación, bbox contra PostGIS) se ha ejecutado contra datos reales: son formas de datos. Llega con H1 y H3.
- Las tablas generadas de `gen:doc` coinciden con este documento salvo dos filas que se mantienen a mano (`createRoute` y `getJob`, cuyo cuerpo y respuesta el generador no sabe describir por ser uniones) y los nombres de tipo traducidos (`texto` por `string`).

## 12. Preguntas y suposiciones

| Id | Pregunta o suposición | Estado |
|---|---|---|
| Q-33 | Recuperar contraseña por correo transaccional (Resend tras el puerto `Mailer`) | **Resuelta** (§10.2). Falta el dominio (Q-28) para enviar a terceros |
| Q-34 | Solicitudes de alta sin «equipo indicado» ni «datos completos» (§5) | **Confirmada** |
| Q-35 | N días de la validación antigua (RF-519): 90 por organización | **Confirmada** |
| Q-14 | Si el administrador escribe sobre misiones y rutas | Abierta; está aislada en `MISSION_WRITERS` |
| Q-12 | Quién gestiona equipos: administrador y coordinador | Propuesta; aislada en `TEAM_MANAGERS` |
| Q-10 | Edición simultánea: `expectedUpdatedAt` opcional en `updateMission` | Propuesta |
| S-01 | Tras un rechazo, el rescatista no puede ofrecerse otra vez; solo el coordinador puede reconsiderar. Tras retirar su oferta, sí | Suposición coherente con el ciclo de vida del doc. 02 §5 |
| S-02 | Quitar un equipo de una misión no quita a sus miembros ya aceptados | Suposición |
| S-03 | Los rescatistas exportan rutas solo de misiones activas aunque vean las cerradas | Doc. 02 §6 |
| S-04 | Duplicar una misión copia puntos y, si se pide, rutas con su versión fijada; nunca participantes | Suposición |
| S-05 | Las organizaciones las crea el superadministrador por una orden de consola (`pnpm cli org:create`), no por la API de v1 (RF-105) | Suposición |

## 13. Registro de cambios

| Versión | Fecha | Cambio |
|---|---|---|
| 0.5 | 2026-10-30 | Cierre de H0: sección 11 al día (83 pruebas del paquete, Zod 4.6.7 desde npm, operaciones de H0 montadas y probadas, E2E, `nestjs-zod` no usado). OpenAPI y tablas regeneradas sin cambios de esquema |
| 0.4 | 2026-10-30 | Nota de `getHealth` (H0): solo comprueba la base de datos; `routingEngine` y `weatherProvider` son `false` sin degradar `status` hasta que exista su adaptador. Se escribe en el registro de endpoints y de ahí al OpenAPI (decisión D-H0-12). Sin cambios de esquema |
| 0.3 | 2026-10-30 | Cada operación tiene hito de construcción (H0–H9, documento 07) en `src/milestones.ts`, con 3 pruebas nuevas (74 en total) y `x-milestone` en el OpenAPI |
| 0.2 | 2026-10-29 | Q-33, Q-34 y Q-35 resueltas. Recuperar contraseña entra en el contrato (95 operaciones en el OpenAPI, 93 de primera entrega) con la migración 0009 y 21 pruebas nuevas de base de datos (118 en total). Error `INVALID_RESET_TOKEN` y acción de auditoría `password_reset` |
| 0.1 | 2026-10-29 | Primera versión: 18 decisiones, 95 endpoints (91 de primera entrega, 2 de segunda, 2 pendientes), 70 pruebas de contrato, OpenAPI generado. Añadidos `calculation_jobs.result` y `organizations.validation_max_age_days` a la base de datos. Resuelta la incoherencia del boceto 13 (Q-34) |
