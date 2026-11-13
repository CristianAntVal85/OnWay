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
| Lo aplazado para después del MVP (se pasa a *issues*) | `docs/backlog-post-mvp.md` |
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
docker compose down                         # para; conserva datos y descargas (con -v los borra, también las contraseñas generadas y los ~843 MB de geodata)
infra/scripts/smoke.sh                      # salud, acceso, login/getMe/logout de 4 cuentas, altitud del servidor, entorno (tiempo, luz y luna), acceso de H5 (código de invitación del administrador, `register` con código inválido, `forgotPassword` 202, bandeja) y roles de la base (sin superusuario ni BYPASSRLS)
COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --wait   # pila de pruebas: sin descargas (DEM sintético) y proveedores falsos (providers-stub)
pnpm --filter @onway/web exec playwright test -c e2e <archivo>   # una sola demostración (p. ej. `h5-acceso-demo.spec.ts`); sin archivo, todas (como `e2e`, que antes compila `@onway/i18n`)
pnpm --filter @onway/web e2e                # 110 pruebas de Playwright (Chromium; 64 de escritorio, 45 de móvil 375 px —39 del proyecto `mobile` y 6 de `mobile-access`— y 1 con el motor parado: las 21 de H0 más una de los enlaces del acceso de H5-acceso, la demostración de H1, la de H2, la de H3, la de H4 —el MVP— y la de `H5-acceso` en los dos formatos, más la del rediseño `UI-rediseno`, 11 pruebas solo de escritorio) contra la pila levantada (con la superposición, como en el CI)

pnpm install                                # pnpm 9.12 vía corepack, Node >= 24.7
pnpm lint                                  # ESLint plano en la raíz; incluye la regla de límites del mapa (apps/web/src fuera de src/map/)
pnpm format:check | typecheck | test | build   # recursivos sobre todo el monorepo
pnpm --filter @onway/contracts gen:openapi  # openapi.json
pnpm --filter @onway/contracts gen:doc gen/ # tablas del documento 06
pnpm --filter @onway/contracts gen:client   # cliente tipado en gen/ (no versionado)
pnpm --filter @onway/api test:db            # 34 pruebas de Vitest sobre PostGIS: las 194 comprobaciones SQL del esquema + 8 de la política 0010 + 6 de la 0011 + 6 de la 0012 + 9 de lo que lee y no escribe el rescatista en las rutas de la misión (Testcontainers, necesita Docker)
pnpm --filter @onway/api test:api           # 486 pruebas del API sobre PostGIS (Testcontainers); el trabajo con pg-boss real incluido
pnpm --filter @onway/api test:routing       # 10 pruebas contra el GraphHopper REAL sobre la red inventada: necesita la pila de pruebas con `routing` levantado (puerto 18989, `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --build --wait routing`)
infra/scripts/routing-regression.sh         # regresión REAL del motor (extracto de los Pirineos y DEM de verdad, ~1,3 GB la primera vez; proyecto `onway-regression`): los casos de poc/motor-rutas/cases; también el workflow manual `routing-regression`
pnpm --filter @onway/api migrate | seed     # necesitan DB_OWNER_PASSWORD_FILE y DB_HOST|PORT|NAME (seed: ELEVATION_DEM_DIR para la altitud de las misiones)
pnpm --filter @onway/api synthetic-dem      # regenera data/seed/dem (terreno inventado del E2E)
pnpm --filter @onway/api synthetic-network  # regenera data/seed/network.osm (red de caminos inventada del E2E y el CI)
pnpm --filter @onway/api build-hgt          # convierte el DEM de OnWay (GLO-30) al formato de altitud del motor de rutas (lo hace `routing-data`)
pnpm --filter @onway/api start              # DB_APP_PASSWORD_FILE, CSRF_SECRET_FILE, DB_*, PORT, TRUSTED_PROXIES (quién puede decir la IP del cliente con X-Forwarded-For; por defecto los rangos privados: solo Caddy llega a la API) (el worker de trabajos: `node dist/src/worker.js`, servicio `worker`)
pnpm --filter @onway/web dev                # Vite con proxy de /api a API_URL (3000)
db/tests/run-postgis.sh                     # las 194 pruebas del esquema con un PostGIS en Docker, sin Node
```

`FILES_DIR` (`/files` en la imagen) es la carpeta de los archivos subidos; en compose es el volumen `files` (`down -v` lo borra con la pila). Recuentos de `pnpm -r test`: contratos 89 (80 de contrato y 9 del cliente generado), i18n 8, geo 127, api unitarias 202, web 788. El E2E necesita Chromium la primera vez (`pnpm --filter @onway/web exec playwright install chromium`) y casi deja la pila como estaba: crea y retira una organización B ficticia en la base de la pila para probar el aislamiento (la demostración lleva una sola organización). La demostración de H1 crea en cada ejecución cuatro misiones «E2E …» (dos por proyecto) y las deja **cerradas** (el registro de auditoría es de solo añadir, así que no se pueden borrar; `docker compose down -v` las borra con la pila); si una ejecución se interrumpe, la siguiente (o el cierre) cierra las que queden abiertas. La demostración de H3 genera rutas con el GraphHopper real sobre la red inventada y, al terminar, cierra las misiones «E2E …» y archiva sus rutas (la biblioteca queda como estaba); `h3-engine-down.spec.ts` para y arranca el motor, y corre al final. La demostración de H4 (`h4-demo.spec.ts`, el MVP) cierra sus misiones «E2E …» y archiva sus rutas al terminar, con el sello de su ejecución. La demostración de `H5-acceso` (`h5-acceso-demo.spec.ts`: alta con el código de invitación, aprobación por el administrador, regenerar el código, recuperar la contraseña con el enlace que sale del registro del `api`; en es y fr, la parte en francés solo con teclado) crea por ejecución y formato dos cuentas «E2E …» (`e2e-<d|m>-<sello>-ana|bea@example.org`): no se pueden borrar (la auditoría es de solo añadir), así que al terminar la primera queda **aprobada y desactivada** (cuenta y membresía, sin sesiones) y la segunda **rechazada** desde la bandeja; si una ejecución se interrumpe, `global-setup.ts` y `global-teardown.ts` (`retireE2eAccounts`) dejan así las que queden (las pendientes, rechazadas). Nunca toca `pendiente@example.org` ni las cuentas de la semilla, y deja el código de invitación **regenerado** (el de la pila cambia en cada ejecución; el E2E lo lee siempre de la pantalla de Administración). Como los límites de los endpoints públicos del `api` son en memoria y por IP, `global-setup.ts` **reinicia el servicio `api`** (`docker compose restart api` con el mismo `COMPOSE_FILE`/`COMPOSE_PROJECT_NAME` que el resto del apoyo) y espera a `/api/v1/health`: cada ejecución gasta como mucho 8 registros, 4 «olvidé mi contraseña» y 6 restablecimientos (límites 10 por 10 min, 5/h y 10/h). El móvil de esta demostración es el proyecto `mobile-access`, que espera al de escritorio: el código de invitación es de toda la organización y regenerarlo con los dos formatos a la vez rompería el registro del otro. La demostración de `UI-rediseno` (`ui-rediseno-demo.spec.ts`: tema oscuro por defecto, selector de Cuenta, anchos de 375 a 2560 px, alto del mapa de Crear misión y mapa de carreteras que sigue al tema) solo lee la semilla: no crea ni retira nada. Se apunta a otra dirección con `E2E_BASE_URL`. **Para correr el E2E en local sin tocar la pila de desarrollo**, como proyecto aparte y en otro puerto: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables y `E2E_BASE_URL=http://localhost:18080`, `pnpm --filter @onway/web e2e` (el apoyo `support/stack.ts` entra en la base por `docker compose exec` y por eso necesita `COMPOSE_PROJECT_NAME`).

**Correo** (H5-acceso): el puerto `Mailer` tiene un solo adaptador, `ConsoleMailer`, que escribe en el registro del `api` una línea JSON `{"event":"mail","kind","to","locale","link"}` (con el enlace `PUBLIC_BASE_URL/reset-password#token=…`; `docker compose logs api`). Variables `MAILER` (solo `console`), `MAILER_ALLOW_CONSOLE` (con `NODE_ENV=production` hay que ponerla a `true`) y `PUBLIC_BASE_URL` (origen de los enlaces, sin barra final). **Con `NODE_ENV=production` las tres son obligatorias** (sin ellas el `api` y el `worker` no arrancan, con un mensaje claro); fuera de producción tienen valores de desarrollo. `infra/compose.yml` las fija para `api` y `worker`: `MAILER=console`, `MAILER_ALLOW_CONSOLE=true` y `PUBLIC_BASE_URL=http://localhost:${ONWAY_HTTP_PORT:-8080}` (`ONWAY_PUBLIC_URL` del `.env` la sustituye); la superposición E2E las hereda (18080 en el E2E). `MAILER_ALLOW_CONSOLE` es un interruptor de la pila local, E2E y CI: el despliegue de H7 NO lo fija (usará Resend). El apoyo del E2E (`apps/web/e2e/support/stack.ts`, analizador puro en `mail-log.ts`) lee el último enlace enviado a un correo (`lastPasswordResetMail`, con `since` opcional) y el código de invitación vigente (`currentInviteCode`). Los tres endpoints públicos (`register`, `forgotPassword`, `resetPassword`) tienen límite por IP y operación, en memoria del `api`: 10 por 10 min, 5 por hora y 10 por hora, con `RATE_LIMITED` y `retryAfterSeconds` (el humo gasta una de `forgotPassword`; `docker compose restart api` vacía la cuenta). `TRUSTED_PROXIES` decide de quién se cree `X-Forwarded-For` (por defecto los rangos privados, porque a la API solo llega Caddy). Lo que ocurre con la solicitud de alta: la cuenta queda *pendiente* (puede iniciar sesión y ve la espera) hasta que el administrador la decide en `/admin`; el código de invitación (16 caracteres en grupos de 4) lo ve y regenera solo el administrador, y regenerarlo invalida el anterior en el acto. `forgotPassword` responde 202 igual exista o no el correo y no espera al `Mailer`.

`docker compose up` no necesita `.env`: el servicio `secrets` genera las contraseñas y el secreto CSRF la primera vez, en un volumen.

**`geodata`** (H1) es un servicio de un solo uso con su volumen (`onway_geodata`): la primera vez descarga el DEM Copernicus GLO-30 de los Pirineos (12 teselas, 466 MB), un extracto PMTiles del mapa base (403 MB) y las fuentes y sprites de su estilo (14 MB); ~90 s con buena conexión, nada la segunda vez. Si una descarga falla, la pila arranca igual y se degrada. Fuentes, licencias y atribuciones: `docs/04` §9.0. Nada de esto se descarga en CI ni en el E2E (superposición `infra/compose.e2e.yml`: DEM sintético de `data/seed/dem` y `providers-stub` con respuestas fijas de Nominatim y Open-Meteo). La búsqueda de direcciones usa el Nominatim público, al que la aplicación se identifica con la página del proyecto (`NOMINATIM_CONTACT` en `.env` la sustituye). El mapa (H1-T6): el extracto y sus fuentes los sirve Caddy en `/tiles/`; satélite y topográfico los piden directamente al navegador los WMTS de IGN España y Francia (únicos anfitriones de terceros, en `apps/web/src/map/ign.ts` y en la CSP de `infra/Caddyfile`; el resto del navegador solo habla con el propio origen). **Motor de rutas y trabajos** (H3): `routing-data` (un solo uso, imagen Debian con osmium) baja de Geofabrik las siete regiones de los Pirineos (~1,3 GB, MD5 comprobado), las recorta a lon −1,9…3,3 / lat 42,0…43,2 (`--strategy simple`: sin nodos fuera del DEM) y convierte el DEM de OnWay al formato del motor (`build-hgt`, 12 teselas × ~43 s); `routing` es GraphHopper 11.1 con el perfil de `infra/routing/mountain.json`, grafo en el volumen `routing-graph`, sin salida a Internet, y `worker` es la misma imagen de la API con `src/worker.ts` (cola pg-boss, salud en :3001). Sin red de caminos el motor queda en reposo sano y la API responde `ROUTING_UNAVAILABLE`; tras bajarla hay que reiniciar `routing` (`docker compose restart routing`). La superposición E2E usa la red inventada `data/seed/network.osm`, sin descargas (el motor arranca en ~3 s). Cambiar `mountain.json` pide revisar los pesos con `specs/H3-generacion-rutas/revision-pesos.md` y repetir la regresión real. Los recuentos y el estado al día los anota `docs/estado.md`.

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

Lee `docs/estado.md` al empezar. Se construye **por hitos pequeños** (H0–H9 de v1; el MVP es H0–H4). Cada hito acaba en algo demostrable. Antes de empezar uno, lee su sección en `docs/07-plan-de-implementacion.md`: alcance (identificadores), demostración, criterio de salida y la definición de terminado de la sección 4. Las operaciones de cada hito son las que llevan `x-milestone` con su valor en el OpenAPI. No se adelanta trabajo de hitos posteriores.
