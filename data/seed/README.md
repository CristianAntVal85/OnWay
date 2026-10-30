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

La organización B que usan las pruebas de aislamiento **no** forma parte de la demostración: la crean las propias pruebas (el fixture de `test:api` y la preparación del E2E, que la retira al terminar).

## Cómo cargarlos

```
pnpm --filter @onway/api seed   # necesita DB_OWNER_PASSWORD_FILE y DB_HOST|PORT|NAME, como migrate
```

Con `docker compose up` lo hace el servicio `seed`, después de `migrate`; si la organización ya existe, no cambia nada. `SEED_FILE` apunta a otro archivo con el mismo formato.
