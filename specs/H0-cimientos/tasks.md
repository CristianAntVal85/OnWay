# H0 · Cimientos y acceso — Tareas

Plan: `specs/H0-cimientos/plan.md` · Rama: `hito/H0-cimientos` · Primer push: `git push -u origin hito/H0-cimientos`.
Cada cierre: solo con todo en verde, archivos añadidos por nombre, marca de la tarea y `docs/estado.md` en el mismo commit, línea `Co-Authored-By` vigente. Dependencias fuera de los documentos aprobadas por el usuario (2026-10-30): `pg`, `react-router`, `prettier`, `eslint`, `typescript-eslint`. `@node-rs/argon2` no está aprobada.

- [x] **T1. Monorepo y paquetes compartidos.** RF-702 (textos de la barra), doc 06 AC-05 (texto por `code`), D-H0-05, D-H0-14, D-H0-15, D-H0-22; formato
  `tsconfig.base.json`, scripts recursivos, `engines.node >=24.7`; `packages/i18n` (es/fr: acceso, espera, navegación, estados, «sin acceso», un texto por cada código de `ERROR_HTTP`); `packages/geo` (esqueleto + prueba de dependencias); `packages/contracts`: `build` a `dist/`, `exports` y `gen:client` (cliente tipado desde `ENDPOINTS`, en `gen/`).
- Hecho cuando: `pnpm -r typecheck` y `pnpm -r test` en verde; las 74 pruebas de contrato siguen pasando y las nuevas comprueban que el cliente expone exactamente las operaciones del registro, añade `X-CSRF-Token` fuera de `GET` y convierte el cuerpo de error en `ApiError`; las pruebas de i18n fallan si es y fr no tienen las mismas claves o si falta un `ErrorCode`; la de `geo` falla si importa `apps/*`, React o NestJS.
- Cierre: commit `chore(H0): T1 set up monorepo, i18n, geo and generated client` + push a la rama del hito.

- [x] **T2. Migraciones con Drizzle y pruebas del esquema desde el API.** Migraciones 0001–0009, doc 05 §6.2, §9, §11; D-H0-04, D-H0-05; driver `pg`
  `apps/api` con lo mínimo de base de datos: CLI `migrate` (drizzle-orm `migrate()` como `onway_owner`), `db/migrations/meta/_journal.json` (0002–0009), `infra/db/init/` (0001 y roles con `LOGIN` como superusuario, contraseñas leídas de archivo); envoltorio Vitest + Testcontainers (`postgis/postgis:16-3.4`) que aplica todo y ejecuta `db/tests/seed_and_tests.sql` y `run_tests.sql`. Ningún `.sql` existente se edita.
- Hecho cuando: `pnpm --filter @onway/api test:db` informa 118 PASS y 0 FAIL sobre PostGIS real; una prueba comprueba que `onway_app` no es superusuario, ni `BYPASSRLS`, ni propietario de ninguna tabla; aplicar `migrate` dos veces no hace nada la segunda; `db/tests/run-postgis.sh` sigue dando 118/118.
- Cierre: commit `test(H0): T2 apply migrations with drizzle and run schema tests on postgis` + push a la rama del hito.

- [x] **T3. Integración continua.** Salida de H0 («CI en verde»), doc 04 §10 y §11.3; D-H0-23
  `.github/workflows/ci.yml`: instalación congelada, formato, `typecheck`, `test`, `gen:openapi`, `gen:doc`, `gen:client`, `test:db`, `pnpm audit --prod`. Los trabajos de API, imágenes y E2E se añaden en T4, T9 y T10.
- Hecho cuando: el push de esta tarea a `hito/H0-cimientos` deja el flujo en verde en GitHub Actions con las 118 pruebas de esquema y las de contrato ejecutadas en el registro del trabajo.
- Cierre: commit `chore(H0): T3 add ci workflow` + push a la rama del hito.

- [x] **T4. Esqueleto del API: contexto de transacción, errores y salud.** `getHealth`; INV-01 (base), RF-103 (base); AC-02, AC-05, AC-16; puerto `Clock`; D-H0-01, 02, 06, 12, 13
  NestJS (Express) con módulos `database` (`withContext` y `withAnonymous` sobre `AsyncLocalStorage`, conexión `onway_app`), `common` (`@Operation` desde el registro, tubería de validación Zod, filtro de errores desde `ERROR_HTTP`, `requestId`) y `health`; esquema Drizzle de las tablas de H0; `Clock`. Añadir el trabajo `test:api` al CI.
- Hecho cuando: `pnpm --filter @onway/api test:api` en verde sobre PostGIS real con: rutas montadas = solo las operaciones H0 implementadas hasta ahora y todas del registro (AC-02); `GET /api/v1/health` 200 y valida contra su esquema; un cuerpo inválido da 400 `VALIDATION_FAILED` con `issues`; todo error valida contra `ErrorResponse` y lleva `requestId`; sin contexto una consulta de `memberships` devuelve 0 filas; el esquema Drizzle coincide con `information_schema`.
- Cierre: commit `feat(H0): T4 add api skeleton with transaction context, errors and health` + push a la rama del hito.

- [x] **T5. Sesión, CSRF y guards.** `login`, `logout`, `getMe`; RF-101, RF-102, RF-103; INV-25; AC-04; doc 06 §4.3; D-H0-03, 07, 08, 09, 10, 11
  Argon2id (`crypto.argon2` o alternativa), sesión en `sessions` con cookie, CSRF por HMAC, guards de sesión, estado de cuenta y rol, bloqueo por intentos con `auth_record_attempt`.
- Hecho cuando: `test:api` en verde con, contra PostGIS real: credenciales erróneas y correo inexistente → mismo 401 `INVALID_CREDENTIALS`; 5 fallos → 423 `ACCOUNT_LOCKED` con `retryAfterSeconds` (reloj fijo); cookie con `HttpOnly`, `Secure`, `SameSite=Strict`; `getMe` sin cookie → 401 `UNAUTHENTICATED`, caducada → 401 `SESSION_EXPIRED`; `logout` sin `X-CSRF-Token` → 403 `CSRF_FAILED` y con él → 204 y la sesión deja de valer; **INV-25**: pendiente → `login` 200 `awaiting-approval` y `getMe` 200; rechazada → 403 `ACCOUNT_REJECTED`; desactivada → 403 `ACCOUNT_DISABLED`; desactivada con sesión abierta (`admin_set_account_status`) → siguiente `getMe` 401; **RF-103**: controlador solo de pruebas para personal → rescatista 403 `FORBIDDEN`; `nextStep` correcto para administrador, coordinador y rescatista.
- Cierre: commit `feat(H0): T5 add session login, logout, me with csrf and guards` + push a la rama del hito.

- [x] **T6. Organización y aislamiento a través del API.** `getOrganization`; RF-102; INV-01, INV-25
- Hecho cuando: `test:api` en verde con dos organizaciones creadas en el contenedor (la B, por el fixture de pruebas): **INV-01**: la sesión de B recibe solo su organización en `getOrganization` y `getMe`; en el contexto real de B, `memberships`, `users`, `teams`, `team_members` y `rescuer_profiles` de A devuelven 0 filas y una inserción con `organization_id` de A falla; **INV-25**: la cuenta pendiente recibe 403 `ACCOUNT_PENDING` en `getOrganization` y su contexto no ve ninguna fila; la respuesta valida contra `OrgInfo` y no incluye el código de invitación; rutas montadas = las 5 operaciones H0 exactas.
- Cierre: commit `feat(H0): T6 add get organization with isolation tests` + push a la rama del hito.

- [x] **T7. Datos de demostración ficticios.** R-10; doc 05 §10 (subconjunto H0); D-H0-17, D-H0-18, D-H0-19
  `data/seed/demo.json`, `data/seed/README.md` (cuentas, contraseña ficticia, aviso de datos ficticios) y CLI `seed` como `onway_owner`, idempotente.
- Hecho cuando: una prueba sobre una base migrada en Testcontainers ejecuta `seed` dos veces y comprueba los recuentos acordados (organizaciones, administradores, coordinadores, rescatistas, equipos y pertenencias en 0, 1 y 2 equipos, cuenta pendiente) sin duplicados; con el API, el administrador, los dos coordinadores, los seis rescatistas y la cuenta pendiente inician sesión con el rol y el `nextStep` esperados, y la prueba crea la organización B con el fixture y comprueba que su administrador inicia sesión (B no forma parte de `demo.json`, D-H0-18); ningún correo fuera de `example.org`.
- Cierre: commit `feat(H0): T7 add fictitious demo seed` + push a la rama del hito.

- [x] **T8. Web: acceso, espera y marco por rol.** RF-101, RF-702, RF-103 (en interfaz), INV-25 (en interfaz); boceto 1 (solo inicio de sesión); doc 02 §2, §3.1, §8 (sesión caducada, cuenta pendiente); D-H0-19, 20, 21; enrutador
  React + Vite + TanStack Query + react-i18next con el cliente generado; vistas de acceso, espera, marco con barra por rol, Inicio provisional con `getOrganization`, «llega en un hito posterior», «sin acceso», Cuenta (idioma local, cerrar sesión); componentes de carga, vacío y error; proxy de Vite a la API en desarrollo.
- Hecho cuando: `pnpm --filter @onway/web typecheck`, `test` y `build` en verde; las pruebas de la configuración de navegación comprueban los enlaces de cada rol (RF-702) y que cada ruta rechaza los roles no permitidos; ningún texto fijo en componentes (todo por `packages/i18n`); comprobado a mano con la API local en vista móvil y solo con teclado (anotado en `docs/estado.md`).
- Cierre: commit `feat(H0): T8 add web login, waiting screen and role-based shell` + push a la rama del hito.

- [x] **T9. Todo con `docker compose up`.** Doc 04 §11.2; doc 07 §4 criterio 1; D-H0-16
  `compose.yml` raíz con `include`, `infra/compose.yml` (`secrets`, `db`, `migrate`, `seed`, `api`, `web`), Dockerfiles de api y web, `infra/Caddyfile` local, `.env.example` sin valores. Construcción de imágenes en CI.
- Hecho cuando: en un clon limpio, `docker compose up --wait` termina con todos los servicios sanos sin copiar ningún archivo antes; `http://localhost:8080` muestra el acceso y se entra con las cuentas de `data/seed/README.md`; `curl http://localhost:8080/api/v1/health` da 200; `docker compose down && docker compose up --wait` conserva los datos y no vuelve a sembrar; `git grep` no encuentra contraseñas ni secretos en el repositorio; el trabajo de imágenes del CI en verde.
- Cierre: commit `chore(H0): T9 run the whole stack with docker compose` + push a la rama del hito.

- [x] **T10. Demostración E2E y documentos al día.** Demostración de H0 (doc 07 §3); doc 07 §4 criterios 1, 8, 11, 12
  Playwright contra el stack de compose (Chromium, escritorio y móvil); trabajo E2E en CI; actualizar `CLAUDE.md` (comandos y recuentos), docs 04, 05, 06 y 07 con sus registros de cambios según el plan §8, y `docs/estado.md`.
- Hecho cuando: `pnpm --filter @onway/web e2e` en verde local y en CI cubriendo: tres barras distintas (administrador, coordinador, rescatista); el rescatista abre `/admin` y ve «sin acceso»; un administrador de una organización B, creada por el fixture de pruebas, solo ve su organización; la cuenta pendiente solo ve la espera y cierra sesión; credenciales erróneas → mensaje genérico; cambio a francés; acceso completado solo con teclado; vista móvil sin desbordes. Todo el flujo de CI en verde en la rama.
- Cierre: commit `test(H0): T10 add end-to-end demo test and update docs` + push a la rama del hito.
