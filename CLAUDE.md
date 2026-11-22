# OnWay

Aplicación web para equipos de rescate en montaña. Un **coordinador** prepara *misiones* (objetivo, orígenes, puntos intermedios y de reunión) y la app propone **varias rutas** hasta el objetivo por carreteras, pistas y senderos. Un **rescatista** consulta en solo lectura las rutas validadas y se ofrece como voluntario. Un **administrador** gestiona usuarios y datos sensibles. v1 es web; la arquitectura debe servir después a iOS y Android. Proyecto didáctico y de portfolio: **solo datos ficticios**, sin usuarios reales, presupuesto de 10–20 €/mes.

Lee la fuente de verdad antes de decidir nada: este archivo es un índice, no copia los documentos.

## Elegir la vía

| Cambio | Comando |
|---|---|
| Trivial: texto, estilo, botón, bug obvio, renombrado | `/quick` |
| Pequeño: un ajuste con su prueba, dentro de un módulo | `/feature` |
| Experimento o prueba de concepto | `/spike` |
| Hito o issue con alcance: operaciones, contrato, base de datos, permisos | `/sdd-plan` |

En caso de duda, elige la vía más ligera y sube si el cambio crece. Sube siempre a `/sdd-plan` si toca `packages/contracts`, `db/`, permisos, sesión, datos personales o un invariante (INV-xx).

Las reglas inviolables de este archivo se aplican en todas las vías.

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
| Estado actual y siguiente paso (máximo 30 líneas) | `docs/estado.md` |
| Historial y decisiones por el camino | `docs/historial.md` |
| Lo aplazado para después del MVP (se pasa a *issues*) | `docs/backlog-post-mvp.md` |
| Qué crea y deja cada demostración del E2E | `apps/web/e2e/README.md` |
| Detalle de correo, datos geográficos y motor de rutas en local | `infra/README.md` |
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
infra/           compose.yml, Caddyfile, motor de rutas (servicios `routing` y `routing-data`, `infra/routing/`) y regresión real (`scripts/routing-regression.sh`)
db/              Migraciones SQL escritas a mano + pruebas del esquema
data/seed        Datos de demostración ficticios (incluida la red de caminos inventada `network.osm` del E2E y el CI)
poc/             Pruebas técnicas aisladas (motor de rutas, doc 04 §7.6): fuera del workspace, de compose.yml y del CI; ver poc/motor-rutas/README.md
```

PostgreSQL 16 + PostGIS, Drizzle (SQL propio para lo espacial), pg-boss para trabajos largos, Argon2id, sesión por cookie + CSRF, Caddy. Lo externo va detrás de puertos: `FileStorage`, `GeocodingProvider`, `WeatherProvider`, `ElevationProvider`, `RoutingProvider`, `Mailer`, `Clock`.

## Comandos

```
docker compose up --wait                    # todo en local (tras cambiar de rama o fusionar, con `--build`: si no, `web` sirve la hoja anterior, issue #8): http://localhost:8080 (cuentas en data/seed/README.md). La primera vez `geodata` descarga ~843 MB y `routing-data` ~1,3 GB (red de caminos de Geofabrik) y convierte el relieve (~10 min)
docker compose down                         # para; conserva datos y descargas (con -v los borra, también las contraseñas y las claves de los datos sensibles generadas y los ~843 MB de geodata)
infra/scripts/smoke.sh                      # salud, acceso, login/getMe/logout de 5 cuentas (rescatista6 con el perfil incompleto), perfil enmascarado de rescatista1 y 403 del coordinador en sus datos sensibles, habilidades de rescatista1 y apertura de su certificado (200 `application/pdf`), altitud del servidor, entorno (tiempo, luz y luna), acceso de H5 (código de invitación del administrador, `register` con código inválido, `forgotPassword` 202, bandeja), lista y ficha de usuarios del administrador (403 al coordinador, sin documento ni dirección) y roles de la base (sin superusuario ni BYPASSRLS)
COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --wait   # pila de pruebas: sin descargas (DEM sintético) y proveedores falsos (providers-stub)
pnpm --filter @onway/web exec playwright test -c e2e <archivo>   # una sola demostración (p. ej. `h5-acceso-demo.spec.ts`); sin archivo, todas (como `e2e`, que antes compila `@onway/i18n`)
pnpm --filter @onway/web e2e                # todas las pruebas de Playwright (Chromium; escritorio, móvil 375 px y una con el motor parado) contra la pila levantada (con la superposición, como en el CI)

pnpm install                                # pnpm 9.12 vía corepack, Node >= 24.7
pnpm check [paquete…]                       # comprobación rápida: lint + typecheck (con dependientes) + unitarias de los paquetes tocados (sin argumentos, los que tienen cambios sin confirmar)
pnpm lint                                  # ESLint plano en la raíz; incluye la regla de límites del mapa (apps/web/src fuera de src/map/)
pnpm format:check | typecheck | test | build   # recursivos sobre todo el monorepo
pnpm --filter @onway/contracts gen:openapi  # openapi.json
pnpm --filter @onway/contracts gen:doc gen/ # tablas del documento 06
pnpm --filter @onway/contracts gen:client   # cliente tipado en gen/ (no versionado)
pnpm --filter @onway/api test:db            # pruebas de Vitest sobre PostGIS: las comprobaciones SQL del esquema, las políticas 0010 a 0012, lo que lee y no escribe el rescatista en las rutas de la misión, lo que borra la 0013 (issue #17) y la reasignación de misiones de la 0014 (Testcontainers, necesita Docker)
pnpm --filter @onway/api test:api           # pruebas del API sobre PostGIS (Testcontainers); el trabajo con pg-boss real incluido
pnpm --filter @onway/api test:routing       # pruebas contra el GraphHopper REAL sobre la red inventada: necesita la pila de pruebas con `routing` levantado (puerto 18989, `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --build --wait routing`)
infra/scripts/routing-regression.sh         # regresión REAL del motor (extracto de los Pirineos y DEM de verdad, ~1,3 GB la primera vez; proyecto `onway-regression`): los casos de poc/motor-rutas/cases; también el workflow manual `routing-regression`
pnpm --filter @onway/api migrate | seed     # necesitan DB_OWNER_PASSWORD_FILE y DB_HOST|PORT|NAME (seed: ELEVATION_DEM_DIR para la altitud de las misiones y SENSITIVE_KEY_FILE y DOCUMENT_HASH_KEY_FILE para cifrar los perfiles)
pnpm --filter @onway/api synthetic-dem      # regenera data/seed/dem (terreno inventado del E2E)
pnpm --filter @onway/api synthetic-network  # regenera data/seed/network.osm (red de caminos inventada del E2E y el CI)
pnpm --filter @onway/api build-hgt          # convierte el DEM de OnWay (GLO-30) al formato de altitud del motor de rutas (lo hace `routing-data`)
pnpm --filter @onway/api start              # DB_APP_PASSWORD_FILE, CSRF_SECRET_FILE, SENSITIVE_KEY_FILE, DOCUMENT_HASH_KEY_FILE, DB_*, PORT, TRUSTED_PROXIES (quién puede decir la IP del cliente con X-Forwarded-For; por defecto los rangos privados: solo Caddy llega a la API) (el worker de trabajos: `node dist/src/worker.js`, servicio `worker`)
pnpm --filter @onway/web dev                # Vite con proxy de /api a API_URL (3000)
db/tests/run-postgis.sh                     # las pruebas del esquema con un PostGIS en Docker, sin Node
```

`FILES_DIR` (`/files` en la imagen) es la carpeta de los archivos subidos; en compose es el volumen `files` (`down -v` lo borra con la pila).

**E2E:** necesita Chromium la primera vez (`pnpm --filter @onway/web exec playwright install chromium`). Crea datos «E2E …» que no se pueden borrar (la auditoría es de solo añadir) y los deja cerrados, archivados o desactivados; reinicia el servicio `api` y regenera el código de invitación. Qué crea y deja cada demostración: `apps/web/e2e/README.md`. **Para correr el E2E en local sin tocar la pila de desarrollo**, como proyecto aparte y en otro puerto: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables y `E2E_BASE_URL=http://localhost:18080`, `pnpm --filter @onway/web e2e` (el apoyo `support/stack.ts` entra en la base por `docker compose exec` y por eso necesita `COMPOSE_PROJECT_NAME`).

**Correo** (H5-acceso): un solo adaptador, `ConsoleMailer`, que escribe en el registro del `api` una línea JSON con el enlace (`docker compose logs api`). Con `NODE_ENV=production` son obligatorias `MAILER`, `MAILER_ALLOW_CONSOLE` y `PUBLIC_BASE_URL`. Los endpoints públicos (`register`, `forgotPassword`, `resetPassword`) tienen límite por IP en memoria del `api` (`docker compose restart api` lo vacía). Detalle: `infra/README.md`.

`docker compose up` no necesita `.env`: el servicio `secrets` genera las contraseñas, el secreto CSRF y las claves de los datos sensibles (cifrado y huella del documento, H5-perfil) la primera vez, en un volumen. Si se pierden esas claves, se pierden documento y dirección de los perfiles: `secrets` y `db-data` van juntos (`infra/README.md`).

**Datos y motor de rutas:** `geodata` (H1) descarga la primera vez el DEM, el mapa base y sus fuentes; `routing-data` y `routing` (H3) preparan y sirven GraphHopper 11.1 con el perfil `infra/routing/mountain.json`; `worker` es la imagen de la API con la cola pg-boss. Si una descarga falla, la pila arranca y se degrada; sin red de caminos la API responde `ROUTING_UNAVAILABLE` (tras bajarla, `docker compose restart routing`). La superposición E2E (`infra/compose.e2e.yml`) no descarga nada: DEM sintético, red inventada y `providers-stub`. Únicos anfitriones de terceros en el navegador: los WMTS de IGN España y Francia (`apps/web/src/map/ign.ts` y la CSP de `infra/Caddyfile`). Cambiar `mountain.json` pide revisar los pesos con `specs/H3-generacion-rutas/revision-pesos.md` y repetir la regresión real. Detalle, fuentes y tamaños: `infra/README.md`. El estado al día lo anota `docs/estado.md`.

## Verificación

- **Rápida (cada tarea y vías `/quick` y `/feature`):** `pnpm check` (`lint`, `typecheck` y pruebas unitarias de los paquetes tocados; `scripts/check.sh`). Si la tarea toca un INV, también su prueba contra base real (`test:db` o `test:api`).
- **Completa (al cerrar un hito):** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm --filter @onway/api test:db`, `pnpm --filter @onway/api test:api`, `db/tests/run-postgis.sh` y el E2E con `CI=1` en la pila `onway-e2e` (puerto 18080; órdenes en «Comandos»).

## Reglas inviolables

1. **Aislamiento por organización.** Cada petición abre su transacción fijando `app.org_id`, `app.user_id` y `app.role`; la seguridad por filas de la base de datos es la defensa real, el filtro de la aplicación es la segunda. Un recurso de otra organización responde **404**, nunca 403. La aplicación no usa superusuario ni `BYPASSRLS`.
2. **Los permisos los decide el servidor.** El rescatista nunca escribe en misiones, rutas ni equipos; solo se ofrece y retira su oferta. Una cuenta pendiente, rechazada o desactivada no accede a datos.
3. **Datos personales mínimos.** Ningún listado devuelve datos personales. Nombre, contacto y datos sensibles (documento, dirección) son **tres entidades separadas**. Documento y dirección van cifrados y solo salen por la función auditada. La ubicación del dispositivo no se guarda.
4. **Las versiones de ruta son inmutables.** Editar crea una versión nueva; la misión fija una versión; un rescatista solo ve versiones **validadas y fijadas**. Las rutas se archivan; solo una ruta **archivada y sin misión** se elimina del todo (`deleteRoute`, desde la lista de archivadas, con confirmación; issue #17).
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

Lee `docs/estado.md` al empezar y elige la vía (arriba; detalle en la skill `sdd`). Commits y ramas: skill `sdd`, sección 4. `docs/estado.md` tiene un máximo de 30 líneas. El historial va a `docs/historial.md`.

Se construye **por hitos pequeños** (H0–H9 de v1; el MVP es H0–H4). Cada hito acaba en algo demostrable. Antes de empezar uno, lee su sección en `docs/07-plan-de-implementacion.md`: alcance (identificadores), demostración, criterio de salida y la definición de terminado de la sección 4. Las operaciones de cada hito son las que llevan `x-milestone` con su valor en el OpenAPI. No se adelanta trabajo de hitos posteriores.
