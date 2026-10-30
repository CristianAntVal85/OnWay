# OnWay — Estado del proyecto

Memoria entre sesiones. Máximo ~50 líneas: resume o elimina lo que ya no aporte. Última actualización: 2026-10-30.

## Dónde estamos
- **Hito en curso:** H0 · Cimientos y acceso. Plan y 10 tareas aprobados (`specs/H0-cimientos/`), rama `hito/H0-cimientos`. Tareas hechas: 2 de 10 (T1 monorepo y paquetes compartidos; T2 migraciones con Drizzle y pruebas del esquema desde el API).
- Documentos 01–07 en borrador, coherentes. Repositorio: https://github.com/CristianAntVal85/OnWay.git (sin primer commit todavía).
- Existe: `packages/contracts` (Zod, 95 operaciones, 83 pruebas: 74 de contrato + 9 del cliente generado), `packages/i18n` (es/fr, 8 pruebas), `packages/geo` (esqueleto + regla de dependencias, 3 pruebas), `db/` (migraciones 0001–0009), `tsconfig.base.json`, Prettier.
- T2: `apps/api` (solo base de datos: `src/db/migrate.ts`, CLI `migrate`, pruebas en `test/`), `db/migrations/meta/_journal.json` (0002–0009) e `infra/db/init/10-onway-roles.sh` (0001 y roles como superusuario). NestJS llega en T4.
- No existe aún: NestJS en `apps/api`, `apps/web`, `infra/compose.yml`, `data/seed`, CI.
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
