# syntax=docker/dockerfile:1
# Imagen de la API y de sus órdenes de un solo uso (migrate, seed). Contexto: la raíz del repositorio.
#   docker build -f infra/docker/api.Dockerfile -t onway/api .

ARG NODE_IMAGE=node:24.22.2-alpine3.24

FROM ${NODE_IMAGE} AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Primero solo los manifiestos: la instalación se reutiliza mientras no cambien las dependencias.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/geo/package.json packages/geo/
COPY packages/i18n/package.json packages/i18n/
RUN --mount=type=cache,id=onway-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@onway/api..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/geo packages/geo
COPY apps/api apps/api
RUN pnpm --filter "@onway/api..." build
# Solo dependencias de producción y lo compilado (apps/api/package.json "files": ["dist"]).
RUN pnpm --filter @onway/api deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
# Migraciones 0002-0011 (la 0001 la aplica el arranque de la base de datos como superusuario)
# y datos de demostración ficticios (R-10): sin secretos ni hashes.
COPY --chown=node:node db/migrations db/migrations
COPY --chown=node:node data/seed/demo.json data/seed/demo.json
ENV MIGRATIONS_DIR=/app/db/migrations SEED_FILE=/app/data/seed/demo.json
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
