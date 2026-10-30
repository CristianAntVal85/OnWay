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
| `rescatista1@example.org` … `rescatista6@example.org` | rescatista | es | completar perfil (perfil incompleto, sin documento ni dirección) |
| `pendiente@example.org` | cuenta pendiente de aprobación | es | pantalla de espera |

Equipos: Valle de Tena (Biescas), Ribagorza (Benasque), Ordesa (Torla) y Alto Gállego (Sabiñánigo). Los rescatistas están en 0 (`rescatista1`), 1 y 2 equipos (`rescatista4` y `rescatista5`).

## Misiones (H1)

Tres misiones inventadas en el Pirineo central, una por estado, todas con «ficticio» en el nombre. Las crea el comando `seed` como las crearía la aplicación (misma altitud calculada por el servidor, mismas filas de historial: `mission_created`, `point_added`, `mission_activated`, `mission_closed`). No llevan participaciones (llegan con H6). Se crean si no existen por nombre, así que una pila sembrada antes de H1 las recibe en el siguiente `up`.

| Misión | Estado | Responsable | Puntos |
|---|---|---|---|
| Simulacro ficticio · Circo de Piedrafita | planificación | `coordinador@example.org` | solo objetivo |
| Simulacro ficticio · Valle de Ordesa | activa | `coordinador@example.org` | origen, intermedio y reunión |
| Simulacro ficticio · Maladeta | cerrada | `coordinatrice@example.org` | solo objetivo |

Las altitudes no están en `demo.json`: las da el `ElevationProvider` configurado (con el DEM de Copernicus de `geodata`, las reales; en el E2E, las del DEM sintético). Si ningún origen cubre un punto, la misión se omite con un aviso y se crea en una ejecución posterior.

## DEM sintético (`dem/`)

`dem/` guarda cuatro teselas GeoTIFF de 1° x 1° (N42/N43 x W001/E000) con un **terreno inventado**, no datos reales, con el mismo nombre y formato (float32, WGS84, `PixelIsPoint`) que las de Copernicus GLO-30 pero a 0,01° de paso (40 kB cada una). Las usan `infra/compose.e2e.yml` (E2E y CI: sin descargas) y las pruebas. Se generan con `pnpm --filter @onway/api synthetic-dem` (escribe en `data/seed/dem`) y una prueba comprueba que lo versionado es exactamente lo que genera el script.

La organización B que usan las pruebas de aislamiento **no** forma parte de la demostración: la crean las propias pruebas (el fixture de `test:api` y la preparación del E2E, que la retira al terminar).

## Cómo cargarlos

```
pnpm --filter @onway/api seed   # necesita DB_OWNER_PASSWORD_FILE y DB_HOST|PORT|NAME, como migrate
```

Con `docker compose up` lo hace el servicio `seed`, después de `migrate`; si la organización ya existe, no cambia nada. `SEED_FILE` apunta a otro archivo con el mismo formato.
