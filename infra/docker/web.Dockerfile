# syntax=docker/dockerfile:1
# Caddy con la web ya construida (Vite) y el proxy de /api. Contexto: la raíz del repositorio.
#   docker build -f infra/docker/web.Dockerfile -t onway/web .

ARG NODE_IMAGE=node:24.22.2-alpine3.24
ARG CADDY_IMAGE=caddy:2.11.7-alpine

FROM ${NODE_IMAGE} AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/geo/package.json packages/geo/
COPY packages/i18n/package.json packages/i18n/
RUN --mount=type=cache,id=onway-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@onway/web..."

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/i18n packages/i18n
COPY apps/web apps/web
# Genera el cliente tipado, comprueba los tipos y construye la web.
RUN pnpm --filter @onway/web build

FROM ${CADDY_IMAGE} AS runtime
COPY --from=build /repo/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
# Sin root: el puerto 8080 no es privilegiado. Caddy escribe su estado en /tmp (tmpfs en compose).
ENV XDG_DATA_HOME=/tmp/caddy-data XDG_CONFIG_HOME=/tmp/caddy-config
USER 65532:65532
EXPOSE 8080
