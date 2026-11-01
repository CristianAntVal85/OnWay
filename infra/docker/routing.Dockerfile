# syntax=docker/dockerfile:1
# Servicio `routing` (H3): GraphHopper 11.1 (Apache-2.0), el .jar de su release con la suma SHA-256 comprobada y la imagen de
# Java fijada por huella. Contexto: la raíz del repositorio.
#   docker build -f infra/docker/routing.Dockerfile -t onway/routing .
FROM eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin routing \
 && mkdir -p /app/conf /graph \
 && chown routing /graph
WORKDIR /app
ADD --chmod=644 --checksum=sha256:8462f758d9ea49edaded557cec5c687a0a24f004ec371cd4daaeb0534824ea33 \
    https://github.com/graphhopper/graphhopper/releases/download/11.1/graphhopper-web-11.1.jar /app/graphhopper-web.jar
COPY --chmod=644 infra/routing/config.yml infra/routing/mountain.json /app/conf/
COPY --chmod=755 infra/routing/entrypoint.sh /app/entrypoint.sh
USER routing
EXPOSE 8989
ENTRYPOINT ["/app/entrypoint.sh"]
