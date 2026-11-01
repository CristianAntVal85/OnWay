#!/usr/bin/env bash
# Downloads the regional OpenStreetMap extracts of a fixed Geofabrik snapshot, checks their MD5 and cuts the
# Pyrenees box into .data/pyrenees.osm.pbf. Same snapshot + same osmium = same extract (the SHA-256 is written next to it).
# Data: © OpenStreetMap contributors, ODbL. Nothing here is versioned: .data/ is ignored.
set -euo pipefail

SNAPSHOT="261031"
BBOX="-1.9,41.9,3.3,43.2" # west,south,east,north
REGIONS=(
  europe/spain/navarra europe/spain/aragon europe/spain/cataluna europe/andorra
  europe/france/aquitaine europe/france/midi-pyrenees europe/france/languedoc-roussillon
)

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data="$here/.data"
mkdir -p "$data/regions"

docker build -q -t onway-poc-osmium "$here/docker/osmium" >/dev/null
osmium() { docker run --rm -u "$(id -u):$(id -g)" -v "$data:/data" onway-poc-osmium "$@"; }

inputs=()
for region in "${REGIONS[@]}"; do
  name="$(basename "$region")"
  file="$data/regions/$name-$SNAPSHOT.osm.pbf"
  url="https://download.geofabrik.de/$region-$SNAPSHOT.osm.pbf"
  expected="$(curl -fsS "$url.md5" | cut -d' ' -f1)"
  if [ ! -f "$file" ] || [ "$(md5sum "$file" | cut -d' ' -f1)" != "$expected" ]; then
    echo "downloading $name"
    curl -fsS -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  [ "$(md5sum "$file" | cut -d' ' -f1)" = "$expected" ] || { echo "bad MD5 for $name" >&2; exit 1; }
  inputs+=("/data/regions/$name-$SNAPSHOT.osm.pbf")
done

# Routing only needs the road network, barriers and turn restrictions. Filtering first keeps `complete_ways` from
# dragging in long ways (ferries, boundaries) that stretch the box far beyond the Pyrenees.
osmium merge --overwrite -o /data/merged.osm.pbf "${inputs[@]}"
osmium tags-filter --overwrite -o /data/network.osm.pbf /data/merged.osm.pbf w/highway n/barrier r/type=restriction
osmium extract --overwrite --bbox "$BBOX" --strategy complete_ways -o /data/pyrenees.osm.pbf /data/network.osm.pbf
rm -f "$data/merged.osm.pbf" "$data/network.osm.pbf"
(cd "$data" && sha256sum pyrenees.osm.pbf | tee pyrenees.sha256)
osmium fileinfo -e /data/pyrenees.osm.pbf | grep "Bounding box: \|Number of"
