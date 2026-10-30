# OnWay — Estado del proyecto

Memoria entre sesiones. Máximo ~50 líneas: resume o elimina lo que ya no aporte. Última actualización: 2026-10-30.

## Dónde estamos
- **H1 · Misiones y mapa: en curso** (plan y tareas aprobados el 2026-10-30; rama `hito/H1-misiones-y-mapa`, plan en `specs/H1-misiones-y-mapa/`). **T1 hecha** (ESLint con la regla de límites del mapa: `pnpm lint` en la raíz y en el trabajo `verify` del CI; `.mcp.json` con el servidor de Chrome DevTools). Siguiente: T2 (misiones en el API).
- **H0 · Cimientos y acceso: validado (APROBADO, 2026-10-30).** Tareas 10 de 10 (T1 monorepo, T2 migraciones con Drizzle, T3 CI, T4 esqueleto del API, T5 sesión/CSRF/guards, T6 organización y aislamiento, T7 datos de demostración, T8 web, T9 `docker compose up`, T10 E2E y documentos). Validado por el `reviewer` contra los 12 criterios del doc 07 §4 (recuentos y E2E reejecutados; vistas con Chromium, no DevTools). Rama `hito/H0-cimientos`, fusionada a `main` por PR con commit de fusión. Repositorio: https://github.com/CristianAntVal85/OnWay.git
- **Siguiente:** T2 de H1 (misiones en el API: crear, leer, editar, listar e historial). La prueba técnica del motor de rutas (R-01) y el contraste con AEMET (R-06) corren en paralelo en la rama `poc/motor-rutas`.

## Recuentos reales (H0 verificados en un clon limpio; al día tras H1-T1)
Contratos 83 (74 + 9 del cliente generado), i18n 8, geo 3, api unitarias 36, web 73, `test:api` 92, `test:db` 118 sobre PostGIS, E2E 21 (14 escritorio + 7 móvil 375 px). Comandos en `CLAUDE.md`. `docker compose up --wait` en un clon limpio: ~55 s, todo sano, sin copiar archivos; `down`/`up` conserva datos y no resiembra; `pnpm audit --prod` limpio.

## Los 12 criterios del doc 07 §4 para H0
| # | Veredicto | Evidencia |
|---|---|---|
| 1 | Cumple | `docker compose up --wait` + `smoke.sh` + E2E (21) en clon limpio; la demostración está escrita como prueba (`apps/web/e2e`) |
| 2 | Cumple | Solo las 5 operaciones H0 montadas (prueba AC-02); OpenAPI y tablas del doc 06 regeneradas sin cambios de esquema. Solo `createRoute` y `getJob` (H2/H3) y los nombres de tipo traducidos difieren a mano en el doc 06 (el generador no describe uniones); anotado en doc 06 §11 |
| 3 | Cumple | INV-01 e INV-25 por el API y en el contexto real de B (`test:api`); 118 pruebas del esquema sobre PostGIS |
| 4 | Cumple con matiz | Contexto `app.*` en cada petición, RLS probada, `smoke.sh` comprueba en `pg_roles` que ningún rol onway es superusuario ni `BYPASSRLS` y que `onway_app` no posee nada. En H0 no hay recursos por id, así que el «404 de otra organización» no se puede mostrar por API todavía: se prueba como 0 filas visibles (RLS) y entra con H1 |
| 5 | Cumple (alcance H0) | Ningún listado en H0; la semilla no lleva contacto ni datos sensibles; la función auditada se prueba en las 118; contratos verdes |
| 6 | Cumple | Solo existe el puerto `Clock`; el dominio no llama a nada externo |
| 7 | Cumple | La web no contiene geometría (navegación en módulo puro, sin mapa aún); `packages/geo` con su regla de dependencias |
| 8 | Cumple | Carga/vacío/error, es y fr (prueba AST de «sin texto fijo»), E2E a 375 px sin desbordes, E2E de teclado. No se ha hecho auditoría de contraste ni lector de pantalla |
| 9 | Cumple | Solo códigos de `ERROR_HTTP`, formato único validado contra `ErrorResponse` en `test:api` |
| 10 | Cumple | Datos `@example.org`, secretos generados por el servicio `secrets`; `git grep` solo encuentra constantes ficticias de prueba |
| 11 | Cumple | Docs 04 (0.6), 05 (0.4), 06 (0.5), 07 (0.2) y `CLAUDE.md` al día con su registro; «PostGIS real» marcado resuelto |
| 12 | Cumple | La rama compila, pasa todo y arranca desde un clon limpio. Confirmado en el CI de `main` sobre el commit de fusión 0439e72: los 5 trabajos (`verify`, `api`, `audit`, `stack`, `e2e`) en verde |

## Hechos que conviene recordar
- **Una sola organización en la demostración** (D-H0-18). La B del aislamiento la crean las pruebas: el fixture en `test:api` y `apps/web/e2e/global-setup.ts` (SQL como `onway_owner` dentro del contenedor `db`, la retira al terminar).
- **Roles de la base (revisado en T10):** `onway_owner`, `onway_app` y `onway_platform` tienen `rolsuper = f` y `rolbypassrls = f`. El único objeto de `postgres` es `spatial_ref_sys` (PostGIS). El informe previo ambiguo no se reproduce: `smoke.sh` lo comprueba cada vez y la API se niega a arrancar con un rol que salte RLS.
- **API** (NestJS 11/Express 5): `withContext`/`withAnonymous` sobre `AsyncLocalStorage`; `@Operation(id)` se niega a montar operaciones de hitos posteriores; `mountEndpoint` (solo pruebas) monta endpoints sintéticos para RF-103. Argon2id con `crypto.argon2` de Node (m=19456, t=2, p=1). Sesión de 12 h, cookie `onway_session` (`HttpOnly; Secure; SameSite=Strict; Path=/api`, funciona en `http://localhost`), CSRF = HMAC con `CSRF_SECRET_FILE`. 5.º fallo → 423. Pendiente → 403 `ACCOUNT_PENDING` salvo `login`/`getMe`/`logout`.
- **Pila** (`compose.yml` + `infra/compose.yml`): `secrets` → `db` → `migrate` → `seed` → `api` → `web` (Caddy, único puerto `127.0.0.1:8080`). 0001 y los roles los aplica el arranque de la base como superusuario; 0002–0009 el migrador de Drizzle. Si borras `secrets` o `db-data`, borra también el otro (`down -v`).
- **Web:** React 19, Vite 7, TanStack Query, react-i18next, react-router 7, sin librería de UI. La barra por rol vive en `src/nav/navigation.ts`. El idioma elegido en el navegador gana al del perfil (D-H0-21): un usuario `fr` ve francés aunque el navegador esté en español.
- `pnpm.overrides.multer = ^2.5.0` (raíz) por un aviso de `pnpm audit`; quitar cuando NestJS 11.x lo traiga.
- **Pendiente para H5:** la actualización parcial de una habilidad no aplica las reglas cruzadas de `SkillInput` (Zod 4 no permite `.partial()` con refinamientos); validarlas en el servidor al combinar con lo guardado. El código de invitación se genera al azar al sembrar y no se imprime.
- La revisión visual de T8 se hizo con Chromium real (el MCP de Chrome DevTools no estaba disponible); desde T10 la repite el E2E.
- **Pendientes menores de la validación:** el `message` de los errores repite el `code` (cumple el formato; valorar textos fijos por código en el servidor); auditoría de contraste y de lector de pantalla (H1 o H7).
- **ESLint** (H1-T1): configuración plana en `eslint.config.js` (`eslint` + `typescript-eslint` recomendadas, sin reglas con tipos; `_x` = sin usar a propósito). `no-restricted-imports` en `apps/web/src/**` salvo `src/map/**`: prohíbe `maplibre-gl`, `react-map-gl` y `pmtiles` (y subrutas) y limita `@onway/geo` a `ALLOWED_GEO_IMPORTS` (vacía hasta T6; solo lectura y formato de coordenadas). Prueba: `apps/web/test/map-boundary.test.ts` (11, ejecuta ESLint de verdad). `@eslint/js` entra como dependencia de desarrollo (paquete de ESLint que da la configuración recomendada). `.mcp.json` en `.prettierignore` y con una ruta de Chrome de esta máquina (`--executable-path=/usr/bin/google-chrome`): no afecta al CI.
- **CI** (`.github/workflows/ci.yml`): `verify`, `api`, `audit`, `stack` y, desde T10, `e2e` (sube informe y trazas solo si falla). Resultado en GitHub: último `gh run list`.

## Decisiones de organización
- SDD **ligero**: por hito, `specs/Hn-nombre/plan.md` + `tasks.md`; el qué está en los docs 01–06 (ver `AGENTS.md` y skill `sdd`).
- Git: rama `hito/Hn-nombre` desde `main`; un commit y un push por tarea con todo en verde; `main` solo recibe hitos validados.
