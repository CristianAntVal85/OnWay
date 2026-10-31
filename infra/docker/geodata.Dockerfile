# syntax=docker/dockerfile:1
# Servicio `geodata` (un solo uso): rellena el volumen `geodata` con el DEM Copernicus GLO-30 y el extracto PMTiles de los
# Pirineos (H1, P2). Contexto: la raíz del repositorio.
#   docker build -f infra/docker/geodata.Dockerfile -t onway/geodata .

ARG NODE_IMAGE=node:24.22.2-alpine3.24

# La herramienta oficial `pmtiles` (protomaps/go-pmtiles) con la suma de comprobación publicada en su release v1.31.2
# (campo `digest` del activo en la API de GitHub). Si no coincide, la imagen no se construye.
FROM ${NODE_IMAGE} AS pmtiles
ARG TARGETARCH
ARG PMTILES_VERSION=1.31.2
ARG PMTILES_SHA256_AMD64=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f
ARG PMTILES_SHA256_ARM64=f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) arch=x86_64; sum="${PMTILES_SHA256_AMD64}" ;; \
      arm64) arch=arm64;  sum="${PMTILES_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    wget -q -O /tmp/pmtiles.tar.gz "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${arch}.tar.gz"; \
    echo "${sum}  /tmp/pmtiles.tar.gz" | sha256sum -c -; \
    mkdir /out; tar -xzf /tmp/pmtiles.tar.gz -C /out pmtiles

FROM ${NODE_IMAGE} AS runtime
COPY --from=pmtiles /out/pmtiles /usr/local/bin/pmtiles
WORKDIR /app
COPY infra/geodata/geodata.mjs infra/geodata/manifest.json ./
ENV GEODATA_DIR=/geodata GEODATA_MANIFEST=/app/manifest.json PMTILES_BIN=/usr/local/bin/pmtiles
CMD ["node", "/app/geodata.mjs"]
