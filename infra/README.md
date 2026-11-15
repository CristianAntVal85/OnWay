# Infraestructura local de OnWay

Detalle de los servicios de `compose.yml`. Los comandos están en `CLAUDE.md` («Comandos»).

## Correo (`Mailer`)

**Correo** (H5-acceso): el puerto `Mailer` tiene un solo adaptador, `ConsoleMailer`, que escribe en el registro del `api` una línea JSON `{"event":"mail","kind","to","locale","link"}` (con el enlace `PUBLIC_BASE_URL/reset-password#token=…`; `docker compose logs api`).

Variables `MAILER` (solo `console`), `MAILER_ALLOW_CONSOLE` (con `NODE_ENV=production` hay que ponerla a `true`) y `PUBLIC_BASE_URL` (origen de los enlaces, sin barra final). **Con `NODE_ENV=production` las tres son obligatorias** (sin ellas el `api` y el `worker` no arrancan, con un mensaje claro); fuera de producción tienen valores de desarrollo. `infra/compose.yml` las fija para `api` y `worker`: `MAILER=console`, `MAILER_ALLOW_CONSOLE=true` y `PUBLIC_BASE_URL=http://localhost:${ONWAY_HTTP_PORT:-8080}` (`ONWAY_PUBLIC_URL` del `.env` la sustituye); la superposición E2E las hereda (18080 en el E2E). `MAILER_ALLOW_CONSOLE` es un interruptor de la pila local, E2E y CI: el despliegue de H7 NO lo fija (usará Resend).

El apoyo del E2E (`apps/web/e2e/support/stack.ts`, analizador puro en `mail-log.ts`) lee el último enlace enviado a un correo (`lastPasswordResetMail`, con `since` opcional) y el código de invitación vigente (`currentInviteCode`).

Los tres endpoints públicos (`register`, `forgotPassword`, `resetPassword`) tienen límite por IP y operación, en memoria del `api`: 10 por 10 min, 5 por hora y 10 por hora, con `RATE_LIMITED` y `retryAfterSeconds` (el humo gasta una de `forgotPassword`; `docker compose restart api` vacía la cuenta).

`TRUSTED_PROXIES` decide de quién se cree `X-Forwarded-For` (por defecto los rangos privados, porque a la API solo llega Caddy).

Lo que ocurre con la solicitud de alta: la cuenta queda *pendiente* (puede iniciar sesión y ve la espera) hasta que el administrador la decide en `/admin`; el código de invitación (16 caracteres en grupos de 4) lo ve y regenera solo el administrador, y regenerarlo invalida el anterior en el acto. `forgotPassword` responde 202 igual exista o no el correo y no espera al `Mailer`.

## Datos geográficos (`geodata`)

**`geodata`** (H1) es un servicio de un solo uso con su volumen (`onway_geodata`): la primera vez descarga el DEM Copernicus GLO-30 de los Pirineos (12 teselas, 466 MB), un extracto PMTiles del mapa base (403 MB) y las fuentes y sprites de su estilo (14 MB); ~90 s con buena conexión, nada la segunda vez. Si una descarga falla, la pila arranca igual y se degrada. Fuentes, licencias y atribuciones: `docs/04` §9.0.

Nada de esto se descarga en CI ni en el E2E (superposición `infra/compose.e2e.yml`: DEM sintético de `data/seed/dem` y `providers-stub` con respuestas fijas de Nominatim y Open-Meteo).

La búsqueda de direcciones usa el Nominatim público, al que la aplicación se identifica con la página del proyecto (`NOMINATIM_CONTACT` en `.env` la sustituye).

El mapa (H1-T6): el extracto y sus fuentes los sirve Caddy en `/tiles/`; satélite y topográfico los piden directamente al navegador los WMTS de IGN España y Francia (únicos anfitriones de terceros, en `apps/web/src/map/ign.ts` y en la CSP de `infra/Caddyfile`; el resto del navegador solo habla con el propio origen).

## Motor de rutas y trabajos (`routing-data`, `routing`, `worker`)

**Motor de rutas y trabajos** (H3): `routing-data` (un solo uso, imagen Debian con osmium) baja de Geofabrik las siete regiones de los Pirineos (~1,3 GB, MD5 comprobado), las recorta a lon −1,9…3,3 / lat 42,0…43,2 (`--strategy simple`: sin nodos fuera del DEM) y convierte el DEM de OnWay al formato del motor (`build-hgt`, 12 teselas × ~43 s); `routing` es GraphHopper 11.1 con el perfil de `infra/routing/mountain.json`, grafo en el volumen `routing-graph`, sin salida a Internet, y `worker` es la misma imagen de la API con `src/worker.ts` (cola pg-boss, salud en :3001).

Sin red de caminos el motor queda en reposo sano y la API responde `ROUTING_UNAVAILABLE`; tras bajarla hay que reiniciar `routing` (`docker compose restart routing`).

La superposición E2E usa la red inventada `data/seed/network.osm`, sin descargas (el motor arranca en ~3 s).

Cambiar `mountain.json` pide revisar los pesos con `specs/H3-generacion-rutas/revision-pesos.md` y repetir la regresión real.
