#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILE_BIN="${TILE_BIN:-$ROOT_DIR/target/debug/tiles}"

if [[ ! -x "$TILE_BIN" ]]; then
  echo "tiles binary not found at $TILE_BIN"
  echo "Run: cargo build -p tiles-tui"
  exit 1
fi

layout_tiles() {
  local layout="$1"
  local seed_folder="${folders[0]}"
  local err
  local count
  err=$("$TILE_BIN" tile --layout "$layout" --sizing-mode adaptive --render-mode fast-preview "$seed_folder" 2>&1 >/dev/null || true)
  count=$(echo "$err" | sed -nE 's/.*requires ([0-9]+) folder.*/\1/p')
  if [[ -z "$count" ]]; then
    count=$(echo "$err" | sed -nE 's/.*exactly ([0-9]+) folders.*/\1/p')
  fi
  echo "${count:-2}"
}

discover_layouts() {
  local line
  local raw
  line=$("$TILE_BIN" tile --help 2>/dev/null | awk '/Layout code/ {print; exit}')
  if [[ -z "$line" ]]; then
    return
  fi
  raw=$(echo "$line" | sed -E 's/.*Layout code \(([^)]*)\).*/\1/')
  echo "$raw" | tr ',' '\n' | sed -E 's/^ +| +$//g'
}

discover_folders() {
  find "$ROOT_DIR/src" \
    -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' \) \
    -not -path '*/outputs/*' \
    -not -path '*/splits/*' \
    -print \
  | sed -E "s|$ROOT_DIR/src/||" \
  | sed -E 's|/[^/]+$||' \
  | sort -u
}

run_layout() {
  local layout="$1"
  local count
  count="$(layout_tiles "$layout")"
  local args=()
  for ((i=0; i<count; i++)); do
    args+=("${folders[$i]}")
  done
  echo "==> layout $layout (tiles: $count)"
  "$TILE_BIN" tile \
    --layout "$layout" \
    --sizing-mode adaptive \
    --render-mode fast-preview \
    "${args[@]}"
}

folders=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  folders+=("$line")
done < <(discover_folders)

layouts=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  layouts+=("$line")
done < <(discover_layouts)

if [[ ${#layouts[@]} -eq 0 ]]; then
  echo "No layouts found from tiles help"
  exit 1
fi

if [[ ${#folders[@]} -eq 0 ]]; then
  echo "No source folders with videos found under src/"
  exit 1
fi

for layout in "${layouts[@]}"; do
  run_layout "$layout"
done
