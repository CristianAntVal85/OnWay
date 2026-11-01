#!/bin/sh
# Servicio `routing-data` (H3, un solo uso): deja en /routing la red de caminos y las teselas de altitud del motor.
#  - Altitud: teselas HGT escritas desde el DEM de OnWay (D-H3-02), con `build-hgt`.
#  - Red: los extractos regionales de Geofabrik (instantánea fijada, MD5 comprobado) recortados a los Pirineos; o, con
#    ROUTING_NETWORK_FILE, un archivo OSM ya hecho (la red inventada del E2E).
# Nunca falla la pila: si algo no sale, deja /routing/status.json con el motivo y termina bien (el motor queda en reposo).
set -u

OUT=/routing
SNAPSHOT="${ROUTING_SNAPSHOT:-261031}"
BBOX="${ROUTING_BBOX:--1.9,42.0,3.3,43.2}" # oeste,sur,este,norte; el sur es 42,0 porque el DEM de OnWay empieza ahí
REGIONS="europe/spain/navarra europe/spain/aragon europe/spain/cataluna europe/andorra europe/france/aquitaine europe/france/midi-pyrenees europe/france/languedoc-roussillon"
mkdir -p "$OUT/network" "$OUT/hgt" "$OUT/work"

status() { printf '{"ok":%s,"note":"%s"}\n' "$1" "$2" > "$OUT/status.json"; }
degrade() { echo "routing-data: $1" >&2; status false "$1"; exit 0; }

echo "routing-data: elevation tiles"
node dist/src/cli/build-hgt.js "$OUT/hgt" || degrade "build-hgt failed: the engine will not start"

if [ -n "${ROUTING_NETWORK_FILE:-}" ]; then
  cp "$ROUTING_NETWORK_FILE" "$OUT/network/$(basename "$ROUTING_NETWORK_FILE")" || degrade "cannot copy $ROUTING_NETWORK_FILE"
  status true "network copied from $ROUTING_NETWORK_FILE"
  exit 0
fi

MARK="$SNAPSHOT|$BBOX|$REGIONS|simple"
if [ -s "$OUT/network/pyrenees.osm.pbf" ] && [ "$(cat "$OUT/network/.source" 2>/dev/null)" = "$MARK" ]; then
  echo "routing-data: network up to date"
  status true "network up to date"
  exit 0
fi

echo "routing-data: downloading the OpenStreetMap regions of Geofabrik (snapshot $SNAPSHOT, about 1.3 GB)"
inputs=""
for region in $REGIONS; do
  name="$(basename "$region")"
  file="$OUT/work/$name.osm.pbf"
  url="https://download.geofabrik.de/$region-$SNAPSHOT.osm.pbf"
  curl -fsS -o /dev/null -I "$url" || url="https://download.geofabrik.de/$region-latest.osm.pbf"   # snapshot withdrawn: the latest one
  expected="$(curl -fsS "$url.md5" | cut -d' ' -f1)" || degrade "cannot read the MD5 of $name"
  if [ ! -s "$file" ] || [ "$(md5sum "$file" | cut -d' ' -f1)" != "$expected" ]; then
    curl -fsS -o "$file.part" "$url" || degrade "cannot download $name"
    mv "$file.part" "$file"
  fi
  [ "$(md5sum "$file" | cut -d' ' -f1)" = "$expected" ] || degrade "bad MD5 for $name"
  inputs="$inputs $file"
done

echo "routing-data: cutting the network"
# Only roads, barriers and turn restrictions: filtering before cutting keeps long ways (ferries, borders) from stretching the box.
osmium merge --overwrite -o "$OUT/work/merged.osm.pbf" $inputs || degrade "osmium merge failed"
osmium tags-filter --overwrite -o "$OUT/work/network.osm.pbf" "$OUT/work/merged.osm.pbf" w/highway n/barrier r/type=restriction || degrade "osmium tags-filter failed"
# `simple` (not `complete_ways`): a way that crosses the box keeps only its nodes inside it. With `complete_ways` the extract held
# nodes down to latitude 41,9, where OnWay has no elevation tile, and the engine tried to download one and stopped.
osmium extract --overwrite --bbox "$BBOX" --strategy simple --output-format pbf -o "$OUT/network/pyrenees.osm.pbf.part" "$OUT/work/network.osm.pbf" || degrade "osmium extract failed"
mv "$OUT/network/pyrenees.osm.pbf.part" "$OUT/network/pyrenees.osm.pbf"
printf '%s' "$MARK" > "$OUT/network/.source"
rm -rf "$OUT/work"
status true "network ready"
echo "routing-data: done"
exit 0
