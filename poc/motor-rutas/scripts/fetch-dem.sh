#!/usr/bin/env bash
# Downloads the two Copernicus GLO-30 tiles (AWS Open Data, no account) that cover the three PoC pairs into .data/dem/.
# They are what OnWay's own measurement reads (apps/api DemElevationProvider), so the slopes of the PoC results are
# judged exactly as the product would show them (D-PoC-01). © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
# 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved (doc 04 §9.0).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$here/.data/dem"
for tile in N42_00_E000_00 N42_00_W001_00; do
  name="Copernicus_DSM_COG_10_${tile}_DEM"
  [ -s "$here/.data/dem/$name.tif" ] && continue
  curl -fsS -o "$here/.data/dem/$name.tif.part" "https://copernicus-dem-30m.s3.amazonaws.com/$name/$name.tif"
  mv "$here/.data/dem/$name.tif.part" "$here/.data/dem/$name.tif"
done
(cd "$here/.data/dem" && sha256sum ./*.tif | tee dem.sha256)
