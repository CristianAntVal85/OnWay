#!/usr/bin/env bash
# Samples the memory of a container every second until it is stopped (Ctrl-C) or SECONDS_MAX passes,
# and prints the peak in MiB. `docker stats` reports the working set (page cache excluded).
# Usage: peak-memory.sh <container> [seconds]
set -euo pipefail
container="${1:?container name}"
limit="${2:-600}"
peak=0
end=$((SECONDS + limit))
trap 'echo "peak ${peak} MiB"; exit 0' INT TERM
while [ "$SECONDS" -lt "$end" ]; do
  raw="$(docker stats --no-stream --format '{{.MemUsage}}' "$container" 2>/dev/null | cut -d/ -f1 | tr -d ' ')" || raw=""
  case "$raw" in
    *GiB) mib="$(echo "${raw%GiB} * 1024" | bc -l)" ;;
    *MiB) mib="${raw%MiB}" ;;
    *KiB) mib="0" ;;
    *) mib="" ;;
  esac
  if [ -n "$mib" ]; then peak="$(echo "if ($mib > $peak) $mib else $peak" | bc -l | cut -d. -f1)"; fi
done
echo "peak ${peak} MiB"
