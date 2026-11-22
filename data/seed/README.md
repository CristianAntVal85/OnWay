# Datos de demostración

> **DATOS FICTICIOS.** Personas, correos y equipos inventados para demostraciones y pruebas (R-10). **No usar con datos reales ni en rescates reales.** OnWay es un proyecto didáctico y de portfolio: no sustituye a un sistema real de rescate.

`demo.json` lo carga el comando `seed` de `apps/api` como `onway_owner` (nunca por la API). La contraseña se convierte en un hash Argon2id al sembrar; en el repositorio no hay ningún hash. Es idempotente: si la organización ya existe, no cambia nada.

## Contraseña de demostración

Todas las cuentas comparten una única contraseña, pública y ficticia:

```
OnWay-demo-ficticia-2026
```

## Cuentas

Una sola organización («Servicio de Rescate Valle Demo»). Todos los correos son de `example.org`.

| Correo | Rol | Idioma | Al iniciar sesión |
|---|---|---|---|
| `admin@example.org` | administrador | es | inicio |
| `coordinador@example.org` | coordinador | es | inicio |
| `coordinatrice@example.org` | coordinador | fr | inicio |
| `rescatista1@example.org` … `rescatista5@example.org` | rescatista | es | Mis misiones (perfil completo con datos inventados, H5-perfil) |
| `rescatista6@example.org` | rescatista | es | completar perfil (perfil incompleto, sin teléfono, documento ni dirección) |
| `pendiente@example.org` | cuenta pendiente de aprobación | es | pantalla de espera |

**Perfiles (H5-perfil).** Los de `rescatista1` a `rescatista5` vienen completos: teléfono de la serie `+34 600 000 101` a `105`, DNI de numeración evidentemente inventada (`00000001R` a `00000005M`, con su letra de control válida) y una dirección inventada en un pueblo del Pirineo. El comando `seed` los cifra con las mismas claves que la API (volumen `secrets`, `sensitive/key` y `fingerprint/key`), así que en `demo.json` solo hay texto en claro inventado y en la base solo bytes cifrados. Una pila sembrada antes de H5 los recibe en el siguiente `up`; un perfil que alguien ya rellenó no se toca. `rescatista6` se queda incompleto para enseñar el alta obligatoria. Como el documento no se puede repetir en la organización (INV-24), **no uses esos DNI al rellenar otro perfil**: darán «Documento ya registrado».

Equipos: Valle de Tena (Biescas), Ribagorza (Benasque), Ordesa (Torla) y Alto Gállego (Sabiñánigo). Los rescatistas están en 0 (`rescatista1`), 1 y 2 equipos (`rescatista4` y `rescatista5`).

## Misiones (H1)

Tres misiones inventadas en el Pirineo central, una por estado, todas con «ficticio» en el nombre. Las crea el comando `seed` como las crearía la aplicación (misma altitud calculada por el servidor, mismas filas de historial: `mission_created`, `point_added`, `mission_activated`, `mission_closed`). No llevan participaciones (llegan con H6). Se crean si no existen por nombre, así que una pila sembrada antes de H1 las recibe en el siguiente `up`.

| Misión | Estado | Responsable | Puntos |
|---|---|---|---|
| Simulacro ficticio · Circo de Piedrafita | planificación | `coordinador@example.org` | solo objetivo |
| Simulacro ficticio · Valle de Ordesa | activa | `coordinador@example.org` | origen, intermedio y reunión |
| Simulacro ficticio · Maladeta | cerrada | `coordinatrice@example.org` | solo objetivo |

Las altitudes no están en `demo.json`: las da el `ElevationProvider` configurado (con el DEM de Copernicus de `geodata`, las reales; en el E2E, las del DEM sintético). Si ningún origen cubre un punto, la misión se omite con un aviso y se crea en una ejecución posterior.

## Rutas (H2)

Seis rutas inventadas en el Pirineo central, todas con «ficticia» en el nombre, cada versión a partir de un GPX **inventado** de `gpx/` (nunca el recorrido de una persona ni de un servicio). El comando `seed` las crea como las dejaría la aplicación tras unas semanas de trabajo: misma altitud y mismas métricas que calcula el servidor al importar (la altitud y las métricas del archivo no se usan), mismas filas de historial (`route_created`, `route_version_created`, `route_version_validated`, `route_derived`, `route_archived`). Se crean si no existen por nombre.

| Ruta | Qué enseña |
|---|---|
| Pradera a la Brecha (ficticia) | una versión, validada |
| Senda del Circo (ficticia) | tres versiones, todas validadas |
| Collado con borrador nuevo (ficticia) | una validada y un borrador más nuevo |
| Variante de la Pradera (ficticia) | copia derivada de la primera, en borrador |
| Camino antiguo (ficticia) | archivada |
| Pista con validación antigua (ficticia) | validada hace 120 días: la biblioteca avisa de que ha caducado (límite de la organización: 90) |

`gpx/ejemplo-importar.gpx` no se siembra: es el archivo para probar **Importar ruta** a mano y en el E2E. Lleva una altitud falsa de 999 m en todos los puntos y dos puntos con nombre; el servidor ignora la altitud (RN-10) y la vista previa lo avisa. Las rutas generadas por el motor no se siembran: las produce *Generar rutas* (ver más abajo).

## Rutas en la misión (H4)

La misión activa «Simulacro ficticio · Valle de Ordesa» lleva **cuatro rutas de la biblioteca**, para que quien levante la pila vea algo en la vista del rescatista y en la sección «Rutas de la misión» del coordinador. Las pone el comando `seed` como las dejaría la aplicación (`addMissionRoutes` y `updateMissionRoute`: mismas filas de `mission_routes` y mismas líneas del historial, `route_added` y `route_marked_unavailable`), sin cambiar las 3 misiones ni las 6 rutas: no crea versiones ni cambia estados. Es idempotente por misión y ruta (una pila sembrada antes de H4 las recibe en el siguiente `up`). Ninguna lleva origen ni equipo.

| Ruta | Versión fijada | Qué enseña | ¿La ve el rescatista? |
|---|---|---|---|
| Pradera a la Brecha (ficticia) | 1, validada | una ruta validada y visible | Sí |
| Senda del Circo (ficticia) | **2**, validada (existe la 3, también validada) | el aviso «hay una versión 3 validada más reciente»: la misión no se actualiza sola | Sí, en la versión 2 |
| Collado con borrador nuevo (ficticia) | 1, validada | marcada **no disponible** en la misión | Sí, señalada y sin descarga |
| Variante de la Pradera (ficticia) | 1, **borrador** | una versión fijada que el rescatista no puede ver (INV-05) | No |

Así, el coordinador ve las 4 y el rescatista 3 (una de ellas señalada como no disponible). `infra/scripts/smoke.sh` lo comprueba. Para que la demostración siga siendo esta, **no valides a mano la «Variante de la Pradera»**: una versión validada ya no se puede deshacer (es inmutable) y la pila dejaría de ser la sembrada; si lo haces, `docker compose down -v` la devuelve a su estado.

## Red de caminos inventada (`network.osm`, H3)

Una cuadrícula de 19 meridianos (lon −0,10 … 0,08) por 9 paralelos (lat 42,62 … 42,70) cada 0,01°, en OSM XML sobre el terreno sintético: el paralelo del sur es una carretera, los meridianos de los bordes son pistas y el resto, senderos (SAC `hiking` en los paralelos, `mountain_hiking` en los meridianos). El meridiano lon −0,02 es la «frontera» inventada de la demostración; su paso es un nodo con nombre. La genera `pnpm --filter @onway/api synthetic-network` (es determinista; el CI y las pruebas la comparan con el archivo). **No es ningún dato real**: el motor de rutas (GraphHopper) la lee como leería un extracto de OpenStreetMap, y por eso el CI y el E2E prueban el motor de verdad sin descargar nada. Con la superposición `infra/compose.e2e.yml` el servicio `routing-data` la usa en vez de bajar la red de los Pirineos; con `docker compose up` a secas se baja la real (~1,3 GB, la primera vez).

**La misión de dos orígenes de la demostración de H3 no está en la semilla**: la crea el E2E por la API (`apps/web/e2e/h3-demo.spec.ts`: un origen a cada lado de la frontera inventada y el objetivo sobre ella) y la deja cerrada con sus rutas archivadas. Así los recuentos de la semilla (3 misiones, 6 rutas) no cambian y no dependen de que el motor esté en marcha. Para verla a mano, crea una misión con un origen en (42,63; −0,07) y otro en (42,63; 0,04), objetivo en (42,69; −0,02), y pulsa *Generar rutas* en su detalle.

## DEM sintético (`dem/`)

`dem/` guarda cuatro teselas GeoTIFF de 1° x 1° (N42/N43 x W001/E000) con un **terreno inventado**, no datos reales, con el mismo nombre y formato (float32, WGS84, `PixelIsPoint`) que las de Copernicus GLO-30 pero a 0,01° de paso (40 kB cada una). Las usan `infra/compose.e2e.yml` (E2E y CI: sin descargas) y las pruebas. Se generan con `pnpm --filter @onway/api synthetic-dem` (escribe en `data/seed/dem`) y una prueba comprueba que lo versionado es exactamente lo que genera el script.

La organización B que usan las pruebas de aislamiento **no** forma parte de la demostración: la crean las propias pruebas (el fixture de `test:api` y la preparación del E2E, que la retira al terminar).

## Cómo cargarlos

```
pnpm --filter @onway/api seed   # necesita DB_OWNER_PASSWORD_FILE y DB_HOST|PORT|NAME, como migrate
```

Con `docker compose up` lo hace el servicio `seed`, después de `migrate`; si la organización ya existe, no cambia nada. `SEED_FILE` apunta a otro archivo con el mismo formato.
