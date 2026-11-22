# E2E de OnWay (Playwright)

Qué crea, qué deja y qué necesita cada demostración. Los comandos están en `CLAUDE.md` («Comandos»).

## Correr en local sin tocar la pila de desarrollo

Para correr el E2E en local sin tocar la pila de desarrollo, como proyecto aparte y en otro puerto: `COMPOSE_FILE=compose.yml:infra/compose.e2e.yml COMPOSE_PROJECT_NAME=onway-e2e ONWAY_HTTP_PORT=18080 docker compose up --build --wait -d` y, con las mismas variables y `E2E_BASE_URL=http://localhost:18080`, `pnpm --filter @onway/web e2e` (el apoyo `support/stack.ts` entra en la base por `docker compose exec` y por eso necesita `COMPOSE_PROJECT_NAME`).

## Qué hace cada demostración

El E2E necesita Chromium la primera vez (`pnpm --filter @onway/web exec playwright install chromium`) y casi deja la pila como estaba: crea y retira una organización B ficticia en la base de la pila para probar el aislamiento (la demostración lleva una sola organización).

La demostración de H1 crea en cada ejecución cuatro misiones «E2E …» (dos por proyecto) y las deja **cerradas** (el registro de auditoría es de solo añadir, así que no se pueden borrar; `docker compose down -v` las borra con la pila); si una ejecución se interrumpe, la siguiente (o el cierre) cierra las que queden abiertas.

La demostración de H3 genera rutas con el GraphHopper real sobre la red inventada y, al terminar, cierra las misiones «E2E …» y archiva sus rutas (la biblioteca queda como estaba); `h3-engine-down.spec.ts` para y arranca el motor, y corre al final.

La demostración de H4 (`h4-demo.spec.ts`, el MVP) cierra sus misiones «E2E …» y archiva sus rutas al terminar, con el sello de su ejecución.

La demostración de `H5-acceso` (`h5-acceso-demo.spec.ts`: alta con el código de invitación, aprobación por el administrador, regenerar el código, recuperar la contraseña con el enlace que sale del registro del `api`; en es y fr, la parte en francés solo con teclado) crea por ejecución y formato dos cuentas «E2E …» (`e2e-<d|m>-<sello>-ana|bea@example.org`): no se pueden borrar (la auditoría es de solo añadir), así que al terminar la primera queda **aprobada y desactivada** (cuenta y membresía, sin sesiones) y la segunda **rechazada** desde la bandeja; si una ejecución se interrumpe, `global-setup.ts` y `global-teardown.ts` (`retireE2eAccounts`) dejan así las que queden (las pendientes, rechazadas). Nunca toca `pendiente@example.org` ni las cuentas de la semilla, y deja el código de invitación **regenerado** (el de la pila cambia en cada ejecución; el E2E lo lee siempre de la pantalla de Administración).

Como los límites de los endpoints públicos del `api` son en memoria y por IP, `global-setup.ts` **reinicia el servicio `api`** (`docker compose restart api` con el mismo `COMPOSE_FILE`/`COMPOSE_PROJECT_NAME` que el resto del apoyo) y espera a `/api/v1/health`: cada ejecución gasta como mucho 8 registros, 4 «olvidé mi contraseña» y 6 restablecimientos (límites 10 por 10 min, 5/h y 10/h).

El móvil de esta demostración es el proyecto `mobile-access`, que espera al de escritorio: el código de invitación es de toda la organización y regenerarlo con los dos formatos a la vez rompería el registro del otro.

La demostración de `H5-perfil` (`h5-perfil-demo.spec.ts`, escritorio y 375 px: alta obligatoria, DNI con la letra mal y DNI ya registrado, perfil completo, «Mostrar» y «Ocultar», idioma guardado en la cuenta y cambio de contraseña que cierra la otra sesión) crea por ejecución y formato **una cuenta de rescatista** `e2e-<d|m>-<sello>-perfil@example.org` («E2E …»), ya aprobada y con el perfil incompleto, directamente en la base (`createApprovedRescuer`): el registro y la aprobación por la web ya los enseña `h5-acceso-demo.spec.ts`, y repetirlos aquí chocaría con la regeneración del código de invitación de aquella y con el límite de registros por IP. La deja con el perfil completo (un DNI inventado distinto en cada ejecución, generado a partir del sello, nunca los `00000001R` a `00000005M` de la semilla), el idioma en español y una contraseña nueva, y al terminar **desactivada** y sin sesiones (`retireE2eAccounts`). Usa el DNI de `rescatista1` solo para ver «ya registrado»: no lo cambia.

La demostración de `H5-habilidades` (`h5-habilidades-demo.spec.ts`, escritorio y 375 px: añade un curso con un PDF y una habilidad, abre el certificado en una pestaña nueva, edita el curso y cambia el certificado por un PNG, elimina la habilidad, y una pasada solo con teclado y en francés) crea por ejecución y formato **una cuenta de rescatista** `e2e-<d|m>-<sello>-habil@example.org` («E2E …»), aprobada con `createApprovedRescuer` y con el perfil completado por la API (un DNI inventado por ejecución). El PDF y el PNG los genera la propia prueba. Deja en la cuenta un curso (con un certificado PNG; el PDF anterior queda retirado con `deleted_at`) y otra entrada en francés sin certificado; la cuenta queda **desactivada** y sin sesiones (`retireE2eAccounts`). El administrador (`admin@example.org`) pide el enlace del certificado por API y la prueba lee `audit_log` (`auditRowsAbout`): queda **una fila `certificate_opened` por ejecución y formato** (su apertura; las del propio rescatista no dejan ninguna). Esas filas, y los archivos subidos, no se pueden borrar (auditoría de solo añadir).

La demostración de `UI-rediseno` (`ui-rediseno-demo.spec.ts`: tema oscuro por defecto, selector de Cuenta, anchos de 375 a 2560 px, alto del mapa de Crear misión y mapa de carreteras que sigue al tema) solo lee la semilla: no crea ni retira nada.

La demostración de la issue #17 (`route-delete-demo.spec.ts`, escritorio y 375 px): crea rutas «E2E …», **elimina de verdad** las que archiva y deja una última archivada dentro de una misión «E2E …» cerrada (que no se puede eliminar, RN-14); la lista de archivadas se filtra por el sello de la ejecución con `q`.

La demostración del nombre de las rutas y desvincular (`rutas-nombre-demo.spec.ts`, escritorio y 375 px, con el motor real sobre la red inventada): crea una misión «E2E …» con un origen, genera rutas con el nombre propuesto (las llama como el origen), renombra dos, quita una de la misión desde «Usada en», la archiva y **la elimina de verdad**, y cierra la misión. Deja la misión cerrada con el resto de sus rutas, archivadas al final por `archiveLeftoverE2eRoutes`. `h3-engine-down.spec.ts` rellena ahora el nombre antes de generar (es obligatorio).

La demostración de pintar ruta y continuar a mano (`pintar-ruta-demo.spec.ts`, escritorio y 375 px, con el motor real sobre la red inventada): crea una misión «E2E …» con un origen, pinta desde ella una ruta del origen al objetivo (queda en la misión), genera rutas y continúa una a mano desde su fila (deja su versión 2 en borrador, sin fijar en la misión) y cierra la misión. Deja la misión cerrada con sus rutas, archivadas al final por `archiveLeftoverE2eRoutes`. `h3-demo.spec.ts` marca ahora la casilla de unir por los caminos, que viene desmarcada.

La demostración de `UI-simplificacion` (`ui-simplificacion-demo.spec.ts`, escritorio y 375 px): capa del mapa desde su icono, Crear misión sin textos de ayuda, detalle de ruta con «Exportar ▾» (descarga un GPX) y «Más ⋯», detalle de una misión con «⋯» por ruta y como mucho una acción principal por vista; solo lee la semilla.

La demostración de la issue #18 (`weather-simple-demo.spec.ts`): la tarjeta del tiempo de Inicio (tres tramos del día, temperatura y viento, ≤ 423 px) y la vista `/weather`; solo lee la semilla.

**`providers-stub` genera las fechas del pronóstico desde hoy** (plantilla de Caddy en `openmeteo-forecast.json`, fuera de Prettier): el servidor descarta las horas ya pasadas, así que fechas fijas dejarían el tiempo por horas vacío.

Se apunta a otra dirección con `E2E_BASE_URL`.
