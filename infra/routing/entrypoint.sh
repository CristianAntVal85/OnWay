#!/bin/sh
# Arranque del motor de rutas (H3). Si no hay red de caminos, la pila sigue: el motor queda en reposo y la API responde
# ROUTING_UNAVAILABLE (doc 04 §11.4). El grafo y la caché de altitud viven en una carpeta cuyo nombre depende de la red y
# de las teselas de altitud: si cambian, se reconstruyen solos y se borran las anteriores.
set -eu

OSM="${ROUTING_OSM_FILE:-/data/network/pyrenees.osm.pbf}"
HGT_DIR="${ROUTING_HGT_DIR:-/data/hgt}"

if [ ! -s "$OSM" ]; then
  echo "routing: no road network at $OSM; waiting, the app will answer ROUTING_UNAVAILABLE" >&2
  touch /tmp/degraded
  trap 'exit 0' TERM INT
  sleep 2147483647 &
  wait
fi

HGT_KEY="$(find "$HGT_DIR" -name '*.hgt.gz' -printf '%T@ %s\n' 2>/dev/null | sort | md5sum | cut -c1-8)"
KEY="$(stat -c '%Y-%s' "$OSM")-$HGT_KEY"
GRAPH="/graph/$KEY"
find /graph -mindepth 1 -maxdepth 1 ! -name "$KEY" -exec rm -rf {} +
mkdir -p "$GRAPH/elevation"
# GraphHopper only downloads a tile that is not in its cache: ours are copied there, so it never reaches the Internet.
for tile in "$HGT_DIR"/*.hgt.gz; do
  [ -e "$tile" ] && cp -n "$tile" "$GRAPH/elevation/"
done

echo "routing: network $OSM, graph $GRAPH"
exec java -Xmx"${ROUTING_HEAP:-2g}" \
  -Ddw.graphhopper.datareader.file="$OSM" \
  -Ddw.graphhopper.graph.location="$GRAPH/cache" \
  -Ddw.graphhopper.graph.elevation.cache_dir="$GRAPH/elevation" \
  -jar /app/graphhopper-web.jar server /app/conf/config.yml
