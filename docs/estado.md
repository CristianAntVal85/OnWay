# OnWay — Estado del proyecto

Memoria entre sesiones. Máximo ~50 líneas: resume o elimina lo que ya no aporte. Última actualización: 2026-10-30.

## Dónde estamos
- **Hito en curso:** H0 · Cimientos y acceso. Plan y 10 tareas aprobados (`specs/H0-cimientos/`), rama `hito/H0-cimientos`. Tareas hechas: 4 de 10 (T1 monorepo y paquetes compartidos; T2 migraciones con Drizzle y pruebas del esquema desde el API; T3 integración continua; T4 esqueleto del API).
- Documentos 01–07 en borrador, coherentes. Repositorio: https://github.com/CristianAntVal85/OnWay.git (sin primer commit todavía).
- Existe: `packages/contracts` (Zod, 95 operaciones, 83 pruebas: 74 de contrato + 9 del cliente generado), `packages/i18n` (es/fr, 8 pruebas), `packages/geo` (esqueleto + regla de dependencias, 3 pruebas), `db/` (migraciones 0001–0009), `tsconfig.base.json`, Prettier.
- T2: `apps/api` (base de datos en T2: `src/db/migrate.ts`, CLI `migrate`, pruebas en `test/`), `db/migrations/meta/_journal.json` (0002–0009) e `infra/db/init/10-onway-roles.sh` (0001 y roles como superusuario). 
- No existe aún: `apps/web`, `infra/compose.yml`, `data/seed`. CI existe desde T3 (trabajo `api` desde T4; imágenes y E2E llegan en T9 y T10).
- T3: `.github/workflows/ci.yml` con los trabajos `verify` (instalación congelada, `format:check`, `typecheck`, `test`, `gen:openapi`, `gen:doc`, `gen:client`, `test:db`), `audit` (`pnpm audit --prod`) y, desde T4, `api` (`test:api`). Actions oficiales fijadas por commit. Sin ESLint: el plan solo exige formato. Resultado en GitHub: ver el último `gh run list`.
- T4: `apps/api` es ya una aplicación NestJS (Express 5) con `getHealth` como única operación montada. `src/db/` (`DatabaseService`: `withContext`, `withAnonymous`, `current()` sobre `AsyncLocalStorage`, pool `onway_app` y negativa a arrancar con un rol que salte RLS; `schema.ts` Drizzle de 7 tablas), `src/common/` (`@Operation(id)` toma método, ruta, estado y roles de `ENDPOINTS` y se niega a montar operaciones de hitos posteriores; guard de roles, interceptor que valida con Zod y abre la transacción, filtro único de errores, `X-Request-Id`), `src/health/`, `src/clock/` (puerto `Clock`). Aún sin sesión: la guarda exige `request.principal`, que fijará T5. Contrato: nota de `getHealth` en el registro, OpenAPI y doc 06 (v0.4).
- Comandos T4: `pnpm --filter @onway/api test:api` (37 pruebas sobre PostGIS en Testcontainers, una base compartida por `globalSetup`), `pnpm --filter @onway/api test` (15 unitarias), `pnpm --filter @onway/api start` (requiere `DB_APP_PASSWORD_FILE`, `DB_HOST|PORT|NAME`, `PORT`).
- `pnpm audit --prod` marcó `multer` 2.4.0 (dependencia de `@nestjs/platform-express` 11.2.8, la última 11.x; la 12 es otra versión mayor): se fija `pnpm.overrides.multer = ^2.5.0` en el `package.json` raíz. Quitar el override cuando salga una 11.x que ya la traiga.
- Comandos T2: `pnpm --filter @onway/api test:db` (migra con el migrador de Drizzle sobre PostGIS en Testcontainers y ejecuta las 118 pruebas SQL; necesita Docker), `pnpm --filter @onway/api migrate` (lee `DB_OWNER_PASSWORD_FILE`, `DB_HOST|PORT|NAME`). `db/tests/run-postgis.sh` sigue dando 118/118.
- Comandos nuevos (T1): `pnpm -r typecheck|test|build`, `pnpm format:check`, `pnpm --filter @onway/contracts gen:client` (cliente en `gen/`, no versionado). Los paquetes se consumen con la condición de exportación `source` (Vite, `tsc`, Vitest) o desde `dist/` (Node).

## Verificado (2026-10-30, primera ejecución con dependencias reales)
- `pnpm install` OK (pnpm 9.12 vía corepack, Node 24, zod 4.6.7).
- Contratos: typecheck limpio y 74/74 pruebas.
- Esquema sobre **PostGIS real** (`postgis/postgis:16-3.4`, `db/tests/run-postgis.sh`): migraciones 0001–0009 aplican en base vacía y 118/118 pruebas pasan. Es la primera tarea de H0 del doc 07, ya cumplida.

## Arreglos hechos al instalar las dependencias reales
- `packages/contracts/tsconfig.json` tenía un `typeRoots` fijo a una ruta del entorno anterior: eliminado.
- Zod 4.6 no permite `.partial()` sobre objetos con refinamientos: `SkillFields` (objeto base) + `SkillInput` (con `superRefine`); el endpoint de actualización usa `SkillFields.partial()`. **Pendiente de decidir en H5:** la actualización parcial de una habilidad no aplica hoy las reglas cruzadas (solo un curso lleva certificado; caducidad ≥ emisión) — validarlas en el servidor al combinar con el valor guardado.
- Pruebas del esquema: la siembra usaba marcadores de texto para la geometría; ahora usa WKT válido (sigue funcionando con el sustituto sin PostGIS). La comprobación de RLS excluye `spatial_ref_sys` (tabla de PostGIS).

## Decisiones de organización (2026-10-30)
- SDD **ligero**: por hito, `specs/Hn-nombre/plan.md` + `tasks.md`; no hay spec por hito porque el qué ya está en los docs 01–06 (ver `AGENTS.md` y skill `sdd`).
- Git: rama `hito/Hn-nombre` desde `main`; un commit y un push por tarea con todo en verde (autorizado por el usuario; regla en la skill `sdd`); `main` solo recibe hitos validados.
- `docs/constitution.md`, `AGENTS.md` y `.claude/` reescritos desde OnCourse (Angular, `backend/`, fases) a OnWay.

## Siguiente
1. `/sdd-plan H0-cimientos` → plan, tareas, aprobación.
2. Lanzar durante H1 la prueba técnica del motor de rutas (R-01, GraphHopper) para llegar a H3 con la decisión tomada.
