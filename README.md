# OnWay

Aplicación web para equipos de rescate en montaña. Proyecto didáctico: **todos los datos son ficticios**; no usar en rescates reales.

Empieza por `CLAUDE.md` y `docs/07-plan-de-implementacion.md`.

## Probarlo en local

Con Docker (Compose v2.26 o posterior) y sin crear ningún archivo antes:

```
docker compose up --wait
```

Abre <http://localhost:8080> (solo desde tu equipo) y entra con una de las cuentas ficticias de `data/seed/README.md`. Las contraseñas de la base de datos y el secreto CSRF se generan al azar la primera vez y viven en un volumen de Docker. `docker compose down` conserva los datos; `docker compose down -v` los borra. `infra/scripts/smoke.sh` comprueba la pila en marcha.
