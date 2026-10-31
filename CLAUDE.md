# OnWay

Aplicación web para equipos de rescate en montaña. Un **coordinador** prepara *misiones* (objetivo, orígenes, puntos intermedios y de reunión) y la app propone **varias rutas** hasta el objetivo por carreteras, pistas y senderos. Un **rescatista** consulta en solo lectura las rutas validadas y se ofrece como voluntario. Un **administrador** gestiona usuarios y datos sensibles. v1 es web; la arquitectura debe servir después a iOS y Android. Proyecto didáctico y de portfolio: **solo datos ficticios**, sin usuarios reales, presupuesto de 10–20 €/mes.

Lee la fuente de verdad antes de decidir nada: este archivo es un índice, no copia los documentos.

## Dónde está cada cosa

| Necesitas… | Mira |
|---|---|
| Qué se construye, requisitos (RF), reglas de negocio (RN), decisiones (D) y preguntas abiertas (Q) | `docs/01-vision-y-requisitos.md` |
| Pantallas, flujos y permisos por acción | `docs/02-flujo-coordinador-y-vistas.md` |
| Entidades, estados e invariantes (INV) | `docs/03-modelo-de-dominio.md` |
| Stack, módulos, puertos, motor de rutas, seguridad, despliegue | `docs/04-arquitectura-y-stack.md` |
| Tablas, seguridad por filas, cifrado, índices | `docs/05-modelo-de-datos.md` y `db/migrations/` |
| Contrato del API | `docs/06-contratos-de-api.md` y `packages/contracts/` |
| **En qué orden se construye y cuándo está terminado un hito** | `docs/07-plan-de-implementacion.md` |
| Estado actual y decisiones por el camino | `docs/estado.md` |
| Principios innegociables y flujo de trabajo (SDD ligero) | `docs/constitution.md`, `AGENTS.md`, `.claude/` |

Si dos documentos se contradicen, manda el de número más bajo para el *qué* (01–03) y el más alto para el *cómo* (04–06). Ante la duda real, para y pregunta.

## Estructura y stack

TypeScript en todo. Monorepo pnpm:

```
apps/api         NestJS: API http + worker (monolito modular)
apps/web         React + Vite + MapLibre
packages/contracts  Esquemas Zod = fuente de verdad del API (OpenAPI y cliente se generan de aquí)
packages/geo     Geometría pura (distancias, perfiles, GPX), sin React ni NestJS
packages/i18n    Textos es / fr
infra/           compose.yml, Caddyfile, motor de rutas
db/              Migraciones SQL escritas a mano + pruebas del esquema
data/seed        Datos de demostración ficticios
```

PostgreSQL 16 + PostGIS, Drizzle (SQL propio para lo espacial), pg-boss para trabajos largos, Argon2id, sesión por cookie + CSRF, Caddy. Lo externo va detrás de puertos: `FileStorage`, `GeocodingProvider`, `WeatherProvider`, `ElevationProvider`, `RoutingProvider`, `Mailer`, `Clock`.

## Comandos

```
docker compose up --wait                    # todo en local: http://localhost:8080 (cuentas en data/seed/README.md). La primera vez `geodata` descarga ~843 MB
docker compose down                         # para; conserva datos y descargas (con -v los borra, también las contraseñas generadas y los ~843 MB de geodata)
infra/scripts/smoke.sh                      # salud, acceso, login/getMe/logout de 4 cuentas, altitud del servidor, entorno (tiempo, luz y luna) y roles de la base (sin superusuario ni BYPASSRLS)
COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --wait   # pila de pruebas: sin descargas (DEM sintético) y proveedores falsos (providers-stub)
pnpm --filter @onway/web e2e                # 43 pruebas de Playwright (Chromium; 25 de escritorio y 18 de móvil 375 px: 21 de H0 y la demostración de H1 en los dos formatos) contra la pila levantada (con la superposición, como en el CI)

pnpm install                                # pnpm 9.12 vía corepack, Node >= 24.7
pnpm lint                                  # ESLint plano en la raíz; incluye la regla de límites del mapa (apps/web/src fuera de src/map/)
pnpm format:check | typecheck | test | build   # recursivos sobre todo el monorepo
pnpm --filter @onway/contracts gen:openapi  # openapi.json
pnpm --filter @onway/contracts gen:doc gen/ # tablas del documento 06
pnpm --filter @onway/contracts gen:client   # cliente tipado en gen/ (no versionado)
pnpm --filter @onway/api test:db            # 25 pruebas de Vitest sobre PostGIS: las 194 comprobaciones SQL del esquema + 8 de la política 0010 + 6 de la 0011 + 6 de la 0012 (Testcontainers, necesita Docker)
pnpm --filter @onway/api test:api           # 191 pruebas del API sobre PostGIS (Testcontainers)
pnpm --filter @onway/api migrate | seed     # necesitan DB_OWNER_PASSWORD_FILE y DB_HOST|PORT|NAME (seed: ELEVATION_DEM_DIR para la altitud de las misiones)
pnpm --filter @onway/api synthetic-dem      # regenera data/seed/dem (terreno inventado del E2E)
pnpm --filter @onway/api start              # DB_APP_PASSWORD_FILE, CSRF_SECRET_FILE, DB_*, PORT
pnpm --filter @onway/web dev                # Vite con proxy de /api a API_URL (3000)
db/tests/run-postgis.sh                     # las 194 pruebas del esquema con un PostGIS en Docker, sin Node
```

Recuentos de `pnpm -r test`: contratos 89 (80 de contrato y 9 del cliente generado), i18n 8, geo 116, api unitarias 105, web 201. El E2E necesita Chromium la primera vez (`pnpm --filter @onway/web exec playwright install chromium`) y casi deja la pila como estaba: crea y retira una organización B ficticia en la base de la pila para probar el aislamiento (la demostración lleva una sola organización). La demostración de H1 crea en cada ejecución cuatro misiones «E2E …» (dos por proyecto) y las deja **cerradas** (el registro de auditoría es de solo añadir, así que no se pueden borrar; `docker compose down -v` las borra con la pila); si una ejecución se interrumpe, la siguiente (o el cierre) cierra las que queden abiertas. Se apunta a otra dirección con `E2E_BASE_URL`.

`docker compose up` no necesita `.env`: el servicio `secrets` genera las contraseñas y el secreto CSRF la primera vez, en un volumen.

**`geodata`** (H1) es un servicio de un solo uso con su volumen (`onway_geodata`): la primera vez descarga el DEM Copernicus GLO-30 de los Pirineos (12 teselas, 466 MB), un extracto PMTiles del mapa base (403 MB) y las fuentes y sprites de su estilo (14 MB); ~90 s con buena conexión, nada la segunda vez. Si una descarga falla, la pila arranca igual y se degrada. Fuentes, licencias y atribuciones: `docs/04` §9.0. Nada de esto se descarga en CI ni en el E2E (superposición `infra/compose.e2e.yml`: DEM sintético de `data/seed/dem` y `providers-stub` con respuestas fijas de Nominatim y Open-Meteo). La búsqueda de direcciones usa el Nominatim público, al que la aplicación se identifica con la página del proyecto (`NOMINATIM_CONTACT` en `.env` la sustituye). El mapa (H1-T6): el extracto y sus fuentes los sirve Caddy en `/tiles/`; satélite y topográfico los piden directamente al navegador los WMTS de IGN España y Francia (únicos anfitriones de terceros, en `apps/web/src/map/ign.ts` y en la CSP de `infra/Caddyfile`; el resto del navegador solo habla con el propio origen). Los recuentos y el estado al día los anota `docs/estado.md`.

## Reglas inviolables

1. **Aislamiento por organización.** Cada petición abre su transacción fijando `app.org_id`, `app.user_id` y `app.role`; la seguridad por filas de la base de datos es la defensa real, el filtro de la aplicación es la segunda. Un recurso de otra organización responde **404**, nunca 403. La aplicación no usa superusuario ni `BYPASSRLS`.
2. **Los permisos los decide el servidor.** El rescatista nunca escribe en misiones, rutas ni equipos; solo se ofrece y retira su oferta. Una cuenta pendiente, rechazada o desactivada no accede a datos.
3. **Datos personales mínimos.** Ningún listado devuelve datos personales. Nombre, contacto y datos sensibles (documento, dirección) son **tres entidades separadas**. Documento y dirección van cifrados y solo salen por la función auditada. La ubicación del dispositivo no se guarda.
4. **Las versiones de ruta son inmutables.** Editar crea una versión nueva; la misión fija una versión; un rescatista solo ve versiones **validadas y fijadas**. Las rutas se archivan, no se borran.
5. **Una misión cerrada es de solo lectura** (salvo reabrir). Participar solo se confirma al cerrar.
6. **El servidor calcula** elevación, métricas y tramos. Nunca se fía de lo que traiga el cliente ni de un GPX.
7. **Contrato primero.** Todo cambio de API empieza en `packages/contracts` y en el mismo cambio se regeneran OpenAPI y documento 06. No se monta una operación fuera del hito en curso.
8. **Una prueba por cada invariante** (INV-xx) que toques, contra base real.
9. **Nada de lógica de rutas o geometría en componentes de React.** Vive en `packages/geo` o en el servidor (portabilidad a móvil).
10. **Cero secretos y cero datos reales** en el repositorio, las pruebas o las demostraciones.

## Convenciones

- Idioma: documentos y textos de interfaz en español; código, identificadores y commits en inglés. Interfaz con `packages/i18n` (es, fr), nunca texto fijo en componentes.
- Unidades: metros y kilómetros; altitudes en metros. Fechas en ISO 8601 con zona.
- API REST bajo `/api/v1`, errores con el formato único `{error:{code,message,requestId,details?}}` y solo códigos de `ERROR_HTTP`. Los cambios de estado son verbos (`/activate`, `/close`…). Las lecturas que dejan auditoría son `POST`.
- Esquemas Zod estrictos (`strictObject`); los tipos TypeScript se derivan de ellos.
- Migraciones SQL: aditivas, numeradas, aplicables sobre base vacía con PostGIS. No se edita una migración ya aplicada: se añade otra.
- Cada vista: estados de carga, vacío y error; usable en móvil; manejable con teclado.
- Cambiar una decisión de los documentos implica editar el documento y anotarlo en su registro de cambios.

## Cómo trabajar

Lee `docs/estado.md` al empezar. Se construye **por hitos pequeños** (H0–H9 de v1; el MVP es H0–H4). Cada hito acaba en algo demostrable. Antes de empezar uno, lee su sección en `docs/07-plan-de-implementacion.md`: alcance (identificadores), demostración, criterio de salida y la definición de terminado de la sección 4. Las operaciones de cada hito son las que llevan `x-milestone` con su valor en el OpenAPI. No se adelanta trabajo de hitos posteriores.
