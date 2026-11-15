#!/usr/bin/env bash
# Quick check (skill sdd, section 3): lint, then typecheck and unit tests of the touched packages.
# Usage: pnpm check [package-name-or-dir ...]   e.g. pnpm check @onway/web ./packages/geo
# Without arguments it takes the packages with uncommitted changes.
set -euo pipefail
cd "$(dirname "$0")/.."

pkgs=("$@")
if [ ${#pkgs[@]} -eq 0 ]; then
  while IFS= read -r dir; do
    [ -f "$dir/package.json" ] && pkgs+=("./$dir")
  done < <({ git diff --name-only HEAD; git ls-files --others --exclude-standard; } |
    grep -oE '^(apps|packages)/[^/]+' | sort -u)
fi

pnpm lint

if [ ${#pkgs[@]} -eq 0 ]; then
  echo "check: no package touched, lint only"
  exit 0
fi

# Typecheck also covers the packages that depend on the touched ones; tests only the touched ones.
typecheck=() tests=()
for p in "${pkgs[@]}"; do
  if [[ $p == ./* ]]; then typecheck+=(--filter "...{$p}"); else typecheck+=(--filter "...$p"); fi
  tests+=(--filter "$p")
done

pnpm "${typecheck[@]}" typecheck
pnpm "${tests[@]}" test
echo "check: ok (${pkgs[*]})"
