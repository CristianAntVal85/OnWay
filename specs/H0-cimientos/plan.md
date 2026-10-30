# H0 · Cimientos y acceso — Plan

Estado: **aprobado por el usuario (2026-10-30)** (2026-10-30) · Rama: `hito/H0-cimientos` · Fuente: doc 07 §3 (H0) y §4.

Las cuatro preguntas del plan están **resueltas por el usuario (2026-10-30)**: perfiles de demo incompletos, una sola organización en la semilla (la B solo en pruebas), dependencias aprobadas y rechazo por rol en la web.

## 1. Alcance

| Tipo | Identificadores |
|---|---|
| Requisitos | RF-101 (sin registro ni recuperar contraseña; permiso de ubicación → RF-708, H1), RF-102, RF-103, RF-702 |
| Invariantes | INV-01, INV-25 (a través del API) |
| Riesgos | R-10 (datos ficticios) |
| Operaciones (`x-milestone: H0`) | `getHealth`, `login`, `logout`, `getMe`, `getOrganization` |
| Base de datos | Migraciones 0001–0009 aplicadas sin cambios; funciones `auth_find_user`, `auth_record_attempt`, `admin_set_account_status` (solo en pruebas) |
| Vistas | Boceto 1 (solo inicio de sesión), espera de aprobación (doc 02 §3.1), barra por rol (doc 02 §2) |
| Contrato | Decisiones AC-02, AC-04, AC-05, AC-06, AC-16 del doc 06; errores de §4.1 y §4.3 |
| Seguridad | Doc 04 §6.2 y §10 (Argon2id, sesión en base de datos, cookie, CSRF); doc 05 §6.1–6.2 |

**Fuera:** registro, recuperar y cambiar contraseña, `updateMe`, perfiles y formulario de alta (H5); límite de peticiones por IP (`RATE_LIMITED`, H5); inicio informativo RF-701 y ubicación RF-708 (H1); worker y pg-boss (H3); HTTPS, cabeceras de seguridad y README público (H7). El bloqueo por intentos **sí** entra: lo aplica `auth_record_attempt` y `login` ya declara `ACCOUNT_LOCKED`.

## 2. Qué cambia, por carpeta

| Carpeta | Cambio |
|---|---|
| raíz | `tsconfig.base.json`, scripts `typecheck`/`test`/`build` recursivos, `compose.yml` mínimo que hace `include` de `infra/compose.yml`, `.env.example` solo con nombres de variables, `.github/workflows/ci.yml`, `engines.node >=24.7`. `pnpm-workspace.yaml` ya incluye `apps/*` y `packages/*` |
| `packages/contracts` | Sin cambios de esquema. Se añaden: `build` (tsc → `dist/`, `exports` hacia `dist` para Node), script `gen:client` (cliente tipado generado **desde el registro `ENDPOINTS`**, salida en `gen/`, ignorada por git como `openapi.json`) y su prueba; nota de `getHealth` (D-H0-12) con regeneración de OpenAPI y doc 06 |
| `packages/i18n` | Nuevo, mínimo: textos es/fr de acceso, navegación, estados (carga, vacío, error), espera, «sin acceso» y **un texto por cada código de `ERROR_HTTP`**. Sin dependencias |
| `packages/geo` | Nuevo, solo esqueleto (configuración e `index.ts` sin lógica) y la prueba de la regla de dependencias (no importa `apps/*`, React ni NestJS). Las funciones llegan en H1–H2 |
| `apps/api` | Nuevo. NestJS (Express). Módulos: `database` (pool `onway_app`, contexto de transacción), `identity` (login, logout, me, organización, sesiones, guards), `health`, `common` (filtro de errores, `requestId`, validación desde el registro, decorador de operación), puerto `Clock`. CLI `migrate` y `seed`. Pruebas en `test/` (unitarias, `test/db/`, `test/api/`) |
| `apps/web` | Nuevo. React + Vite + TanStack Query + react-i18next + enrutador . Vistas: acceso, espera, marco con barra por rol, Inicio provisional (nombre de la organización vía `getOrganization`), páginas «llega en un hito posterior» para los enlaces de la barra, «sin acceso», sesión caducada → acceso conservando destino. Componentes de estado de carga, vacío y error. Selector de idioma local y cerrar sesión |
| `db/` | **Ninguna migración nueva.** Se añade `db/migrations/meta/_journal.json` (lista 0002–0009 para el migrador de Drizzle). `db/tests/*.sql` no se tocan; `run.sh` y `run-postgis.sh` siguen funcionando |
| `infra/` | `compose.yml` (servicios `secrets`, `db`, `migrate`, `seed`, `api`, `web`), `db/init/` (arranque de superusuario: 0001, roles con `LOGIN`, propietario del esquema y de la base), `Caddyfile` local (sirve la web y hace de proxy de `/api`), Dockerfiles de api y web |
| `data/seed` | `demo.json` con los datos ficticios y `README.md` con las cuentas de demostración y el aviso de datos ficticios (R-10). Contenido según D-H0-18 y D-H0-19 |
| `specs/H0-cimientos` | Este plan y `tasks.md` |

## 3. Puertos implicados

- **`Clock`**: caducidad de sesión y `retryAfterSeconds` de `ACCOUNT_LOCKED`. Reloj del sistema; reloj fijo en pruebas.
- Ninguno más se implementa en H0 (ver D-H0-12 para `getHealth`).

## 4. Decisiones (con alternativa descartada)

| Id | Decisión | Descartado y por qué |
|---|---|---|
| D-H0-01 | **Driver `pg` (node-postgres) con `drizzle-orm/node-postgres`** . Es el mismo driver que usará pg-boss en H3. Esquema Drizzle en TypeScript solo de las tablas que usa H0, con una prueba que lo compara con `information_schema` | `postgres.js`: segundo driver cuando llegue pg-boss |
| D-H0-02 | **Contexto por petición con `AsyncLocalStorage`**: un interceptor abre `db.transaction`, ejecuta `set_config('app.org_id'|'app.user_id'|'app.role', …, true)` y guarda la transacción en el almacén; los repositorios solo obtienen la conexión de ahí. Antes de la sesión solo existe `withAnonymous()`, limitado a funciones `SECURITY DEFINER` y a `sessions` (sin RLS). La conexión es siempre `onway_app` | Proveedores `Scope.REQUEST` de NestJS: contagian el ámbito a todo el árbol y son más lentos. Filtrar solo en código: contradice AD-07 |
| D-H0-03 | **Resolver la sesión sin migración nueva**: `sessions` (hash SHA-256) → `user_id` → fijar `app.user_id` → leer el correo propio (`users_select`) → `auth_find_user` da organización, rol y estado. En cada petición, así una cuenta desactivada pierde el acceso al instante | Función nueva `auth_session_context` en 0010: más limpia, pero cambia el doc 05 sin necesidad en H0 |
| D-H0-04 | **Migrador de Drizzle (`migrate()` de drizzle-orm) como `onway_owner`** sobre `db/migrations/` con un `meta/_journal.json` que lista 0002–0009. **0001 la ejecuta el superusuario** en el arranque del contenedor `db` (`docker-entrypoint-initdb.d`), igual que `run-postgis.sh`. El mismo migrador en compose, Testcontainers y CI. Cumple DB-01 (SQL a mano, gestionado por Drizzle) sin editar ningún `.sql` | Regenerar con `drizzle-kit generate --custom`: renumera y duplica migraciones ya aplicadas. Script propio con `psql`: se aparta de DB-01 y del doc 04 §3 |
| D-H0-05 | **Pruebas**: Vitest en `apps/*`, `packages/i18n` y `packages/geo`; `packages/contracts` sigue con `node:test` (74 pruebas intactas). API contra **PostGIS real con Testcontainers** (`postgis/postgis:16-3.4`), arrancando la app Nest en un puerto libre y llamando con `fetch` nativo. Las 118 pruebas SQL se ejecutan desde `apps/api/test/db/` con un envoltorio Vitest que aplica las migraciones con el migrador de D-H0-04 y lanza `db/tests/*.sql` (doc 05 §11) | Migrar las de contratos a Vitest: cambio sin valor. `supertest`: dependencia no prevista |
| D-H0-06 | **Validación y rutas desde el registro**: un decorador `@Operation('<id>')` toma de `ENDPOINTS` método, ruta, roles y esquemas; una tubería propia valida con Zod y devuelve `VALIDATION_FAILED` con `issues`. Prueba AC-02: las rutas montadas son exactamente las operaciones `H0` del registro | `nestjs-zod`: duplica lo que ya dan los contratos y su formato de error no es el del doc 06 §4 |
| D-H0-07 | **Sesión**: token aleatorio de 32 bytes en cookie `onway_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api`), guardado como SHA-256 en `sessions.id`; caducidad de 12 h (configurable). Sin cookie → `UNAUTHENTICATED`; caducada → `SESSION_EXPIRED`. Cookie leída de la cabecera sin librería | `cookie-parser`: dependencia para diez líneas. JWT: no revocable, contradice doc 04 §10 |
| D-H0-08 | **CSRF sin estado**: `csrfToken = HMAC-SHA256(secreto, token de sesión)`, entregado en `login` y `getMe`, exigido en `X-CSRF-Token` en todo lo que no es `GET` salvo `login` (aún no hay sesión; `SameSite=Strict` lo cubre). Comparación en tiempo constante | Columna CSRF en `sessions`: migración nueva. Doble cookie: menos robusto |
| D-H0-09 | **Login**: `auth_find_user` → Argon2id (con un hash ficticio si el correo no existe, para igualar tiempos) → `auth_record_attempt`. `ACCOUNT_DISABLED` y `ACCOUNT_REJECTED` solo tras contraseña correcta; si no, `INVALID_CREDENTIALS` (doc 06 §4.3). `locked_until` futuro → `ACCOUNT_LOCKED` con `retryAfterSeconds`. Pendiente → 200 con `nextStep = awaiting-approval` | Revelar el estado antes de la contraseña: filtra qué cuentas existen |
| D-H0-10 | **Argon2id con `crypto.argon2` de Node ≥ 24.7** (m = 19 MiB, t = 2, p = 1), sin dependencia  | `@node-rs/argon2`: binario nativo; queda como alternativa si la API de Node no sirve |
| D-H0-11 | **Guards**: sesión → estado de cuenta (`pending` solo `getMe`/`logout`, resto `ACCOUNT_PENDING`; `disabled` → `ACCOUNT_DISABLED`) → rol según `roles` del registro → `FORBIDDEN`. RF-103 se prueba con un controlador **solo de pruebas** restringido a personal, porque ninguna operación H0 restringe por rol | Montar una operación de H1 para demostrarlo: prohibido (regla 7) |
| D-H0-12 | **Salud**: `getHealth` comprueba `SELECT 1` con `withAnonymous()`; `routingEngine` y `weatherProvider` = `false` mientras no exista su adaptador, y no degradan `status` hasta H1/H3. Se anota en `notes` del registro | `degraded` permanente en H0: el comprobador de salud dejaría de ser una señal útil |
| D-H0-13 | **Errores**: filtro global que traduce excepciones de dominio y de validación al formato único, con estado tomado de `ERROR_HTTP` y `requestId` (cabecera `X-Request-Id`); un error de base no previsto → `INTERNAL` sin detalles. «Otra organización» se resuelve como recurso no encontrado → `NOT_FOUND` (AC-06). Prueba: todo error del API valida contra `ErrorResponse` | Estados HTTP escritos a mano en cada controlador |
| D-H0-14 | **Cliente generado desde el registro** (doc 06 §1: del registro salen OpenAPI, cliente y tablas). `fetch` con `credentials: 'include'`, cabecera CSRF automática en lo que no es `GET`, errores como `ApiError` con `code` tipado. Se genera en `gen/` antes de `typecheck`/`build`/`dev` de la web y no se versiona | `openapi-typescript` + `openapi-fetch`: dos dependencias para lo que el registro ya da tipado. Versionar el generado: rompe la convención actual (`openapi.json` y `gen/` ignorados) |
| D-H0-15 | **Paquetes internos compilados con `tsc` a `dist/`** para la API en Node; Vite los consume desde fuente | Ejecutar la API con `tsx` en producción. Empaquetador para la API: dependencia extra |
| D-H0-16 | **`docker compose up` en un solo paso**: `compose.yml` raíz con `include: infra/compose.yml`. Orden: `secrets` (genera las contraseñas de `onway_owner` y `onway_app` y el secreto CSRF en un volumen, solo la primera vez) → `db` (`postgis/postgis:16-3.4`, init de superusuario) → `migrate` → `seed` → `api` → `web` (Caddy sirve la build de Vite en `http://localhost:8080` y hace de proxy de `/api`: mismo origen). Cada paso espera al anterior (`service_completed_successfully` / `healthy`) | Contraseñas por defecto en `compose.yml`: credenciales en el repositorio. Exigir copiar `.env` antes: rompe «clonar y `docker compose up`» |
| D-H0-17 | **Semilla en TypeScript** (CLI `seed` de `apps/api`) que lee `data/seed/demo.json`, calcula los hashes Argon2id al cargar y escribe como `onway_owner` (doc 05 §10), de forma idempotente (no hace nada si la organización ya existe). Contraseña de demostración única y ficticia, escrita en `data/seed/README.md` | SQL con hashes precalculados: se desalinea de los parámetros de hash y no servirá en H5, cuando haya que cifrar al sembrar |
| D-H0-18 | **Semilla H0**: **una sola organización** (1 administrador, 2 coordinadores —uno con idioma `fr`—, 6 rescatistas, 4 equipos con localidades distintas y rescatistas en 0, 1 y 2 equipos, 1 cuenta pendiente con solicitud), como pide el doc 07. Correos en `example.org`, nombres inventados. Cuentas rechazada, desactivada y bloqueada solo como datos de prueba. **Decidido por el usuario (2026-10-30):** otras organizaciones no participan en la app (D-08), así que la demo no lleva una segunda. La organización B existe **solo como fixture de las pruebas** (API y E2E), creada por una función de pruebas como `onway_owner`, para comprobar INV-01 y INV-25 | Sembrar una segunda organización en la demo: confunde el producto (D-08); el aislamiento se prueba igual con el fixture
| D-H0-19 | **Rescatistas con perfil `incomplete`**: `getMe` devuelve `nextStep = complete-profile`; en H0 la web les muestra su marco (Misiones, Mi perfil) con una página «Completa tu perfil: llega en un hito posterior». El formulario obligatorio llega en H5 | Sembrar perfiles completos: exige cifrar documento y dirección (AES-256-GCM, claves), que es trabajo de H5 |
| D-H0-20 | **Barra por rol según RF-702** (doc 01 manda sobre doc 02 §2 para el rescatista): personal = Inicio, Misiones, Crear misión, Rutas, Equipos (+ Administración el administrador); rescatista = Misiones, Mi perfil; todos = Cuenta (idioma, cerrar sesión). Rol → enlaces y rol → rutas permitidas es una función pura probada con Vitest; la interfaz, con Playwright. Abrir la dirección de otro rol muestra «sin acceso» | Ocultar enlaces sin proteger la ruta: se entraría tecleando la dirección |
| D-H0-21 | **Idioma**: inicial = `user.locale`; el cambio en Cuenta se guarda en el navegador (persistirlo en servidor es `updateMe`, H5) | Montar `updateMe` ahora: es de H5 |
| D-H0-22 | **Versiones** (estables vigentes al implementar, fijadas en el lockfile): Node 24 LTS (≥ 24.7), pnpm 9.12, TypeScript 5.x, NestJS 11, React 19, Vite 7, TanStack Query 5, react-i18next + i18next actuales, drizzle-orm actual, pg 8, Vitest 3, Testcontainers 11, Playwright 1.x, Caddy 2, `postgis/postgis:16-3.4` | Rangos abiertos sin lockfile |
| D-H0-23 | **CI (GitHub Actions)** en cada push: instalación con lockfile congelado, formato , `typecheck` y `test` de todos los paquetes, generación de OpenAPI, doc 06 y cliente, pruebas de base y de API con Testcontainers, construcción de imágenes, `docker compose up --wait` + Playwright, `pnpm audit --prod` (doc 04 §10) | Solo pruebas unitarias en CI: no cumpliría la salida de H0 |

## 5. Dependencias

**Previstas en los documentos** (doc 04 §3 y §12): NestJS, Zod, Drizzle ORM, React, Vite, TanStack Query, react-i18next, Vitest, Testcontainers, Playwright, GitHub Actions, Caddy, Docker Compose. Se entienden incluidas sus piezas obligatorias: `@nestjs/core|common|platform-express`, `reflect-metadata`, `rxjs`, `i18next`, `@vitejs/plugin-react`, `@testcontainers/postgresql`, `@types/*`.

**Aprobadas por el usuario (2026-10-30), no previstas en los documentos:**
1. `pg` (driver de Drizzle; pg-boss lo usará igualmente).
2. Enrutador de la web: `react-router` (modo librería).
3. Formato y estilo en CI (doc 04 §11.3 pide «formato»): `prettier`, y `eslint` + `typescript-eslint`.
4. `@node-rs/argon2`: **no aprobada**; solo si `crypto.argon2` de Node no sirve, y entonces se pregunta.

No se añade librería de componentes (Radix) en H0: acceso y barra con HTML nativo accesible.

## 6. Riesgos del hito

| Riesgo | Mitigación |
|---|---|
| Drizzle con RLS: una consulta fuera del envoltorio vería cero filas o fallaría en silencio | El pool solo se expone por `withContext`/`withAnonymous`; prueba «sin contexto no se ve nada» desde el API; prueba de que `onway_app` no es superusuario, ni `BYPASSRLS`, ni propietario de tablas |
| Migrador de Drizzle sobre SQL a mano (doc 05 §12, «sin probar») | Va en la primera tarea de base de datos; si `migrate()` no acepta los archivos tal cual, se para y se pregunta antes de tocar DB-01 |
| `crypto.argon2` es reciente en Node | Prueba de ida y vuelta y de formato PHC; alternativa en la lista de aprobación |
| Cookie `Secure` en `http://localhost` | Chromium y Firefox la aceptan en `localhost`; la E2E se ejecuta en Chromium. HTTPS real en H7 |
| Numeración futura con `drizzle-kit generate --custom` y un diario que empieza en 0002 | Fuera de H0; se anota en el doc 05 para la primera migración 0010 |
| `main` sin primer commit | Comprobar en T1 antes del primer push; si la rama no parte de `main`, parar y avisar |

## 7. Verificación

**Pruebas por invariante (PostGIS real, a través del API):**
- **INV-01**: con dos organizaciones en el contenedor, la sesión de B obtiene solo su organización en `getOrganization` y `getMe`; dentro del contexto real de B, las lecturas de `memberships`, `users`, `teams`, `team_members` y `rescuer_profiles` de A devuelven cero filas y una escritura con `organization_id` de A falla; sin contexto no se ve ninguna fila.
- **INV-25**: cuenta pendiente → `login` 200 con `awaiting-approval`, `getMe` 200, `getOrganization` 403 `ACCOUNT_PENDING` y cero filas visibles con su contexto; rechazada → `login` 403 `ACCOUNT_REJECTED`; desactivada → `login` 403 `ACCOUNT_DISABLED`; desactivar con `admin_set_account_status` a quien tiene sesión → su siguiente `getMe` 401.
- Además: RF-101 (contraseña errónea y correo inexistente dan el mismo `INVALID_CREDENTIALS`; 5 fallos → 423 `ACCOUNT_LOCKED` con `retryAfterSeconds`), RF-102 (el rol sale de la membresía; en H0 no hay vía para cambiarlo), RF-103 (controlador de prueba: rescatista → 403 `FORBIDDEN`), CSRF (`logout` sin cabecera → 403 `CSRF_FAILED`), AC-02 (rutas montadas = operaciones H0), formato de error y respuestas validadas contra sus esquemas Zod (AC-16).

**Demostración como prueba E2E (Playwright, contra `docker compose up`):** iniciar sesión como administrador, coordinador y rescatista y ver tres barras distintas; el rescatista abre `/admin` y ve «sin acceso»; el administrador de B solo ve su organización; la cuenta pendiente solo ve la espera y puede cerrar sesión; credenciales erróneas muestran el mensaje genérico; cambio a francés; proyecto en vista móvil y recorrido del acceso solo con teclado.

**Comandos (se anotan en `CLAUDE.md` cuando existan):**
```
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm -r test                               # contratos (node:test) + Vitest del resto
pnpm --filter @onway/contracts gen:openapi && pnpm --filter @onway/contracts gen:doc gen/ && pnpm --filter @onway/contracts gen:client
pnpm --filter @onway/api test:db           # 118 pruebas SQL sobre PostGIS (Testcontainers)
pnpm --filter @onway/api test:api          # INV-01, INV-25, RF-101/102/103, CSRF, AC-02
db/tests/run-postgis.sh                    # sigue disponible
docker compose up --wait                   # http://localhost:8080
pnpm --filter @onway/web e2e               # demostración de H0
```

**Salida (doc 07):** 118 pruebas de esquema y las de contrato (74 + las del generador) en verde, INV-01 e INV-25 por el API, CI en verde y los 12 criterios del doc 07 §4.

## 8. Documentos que habrá que actualizar

| Documento | Cambio | Registro de cambios |
|---|---|---|
| `docs/07` §3 H0 | Datos de demostración: una organización, con cuenta pendiente; rescatistas con perfil incompleto hasta H5. Aclarar que el aislamiento se demuestra con una organización creada por las pruebas | 0.2 |
| `docs/05` DB-01, §9, §11, §12 | 0001 por superusuario en el arranque; 0002–0009 con el migrador de Drizzle y su diario; pruebas en `apps/api/test/db/` sobre los SQL de `db/tests/`; PostGIS y migrador verificados | 0.4 |
| `docs/04` §3 | Driver `pg`, enrutador, formato/estilo y Argon2 de Node, si se aprueban  | 0.6 |
| `docs/06` | Nota de `getHealth` (D-H0-12), regenerada desde el registro | 0.4 |
| `CLAUDE.md` | Comandos nuevos y recuentos de pruebas | — |
| `docs/estado.md` | Al cerrar cada tarea | — |
