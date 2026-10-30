# @onway/contracts

Fuente de verdad del API de OnWay (documento 06): esquemas Zod, registro de endpoints, pruebas y generadores.

```
pnpm typecheck     # tsc --noEmit (estricto)
pnpm test          # 83 pruebas (node:test + tsx): contrato y cliente generado, sin base de datos
pnpm build         # gen:client + tsc → dist/ (lo que consume Node)
pnpm gen:openapi   # openapi.json desde el registro
pnpm gen:doc gen/  # tablas Markdown del documento 06
pnpm gen:client    # gen/client.ts: cliente tipado (ApiClient) desde el registro
```

- `src/endpoints.ts` es el registro: ruta, roles, entrada, respuesta y errores de cada operación.
- Los listados del rescatista (`/my/...`) tienen tipos propios; las pruebas impiden que un listado exponga datos personales.
- `test/registry.test.ts` lee `db/migrations/*.sql` y exige que los enums coincidan.
- Quien cambie un esquema regenera el OpenAPI y las tablas del documento 06 en el mismo cambio.
