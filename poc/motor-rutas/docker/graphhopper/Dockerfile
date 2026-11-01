# GraphHopper 11.1 (Apache-2.0): official release jar (SHA-256 checked by Docker) on the Temurin JRE image.
FROM eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ADD --chmod=644 --checksum=sha256:8462f758d9ea49edaded557cec5c687a0a24f004ec371cd4daaeb0534824ea33 \
    https://github.com/graphhopper/graphhopper/releases/download/11.1/graphhopper-web-11.1.jar /app/graphhopper-web.jar
ENTRYPOINT ["java"]
