# osmium-tool (GPL-3.0) from the Debian package, only to cut the OSM extract for the routing PoC.
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["osmium"]
