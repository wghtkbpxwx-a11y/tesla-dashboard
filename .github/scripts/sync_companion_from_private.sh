#!/usr/bin/env bash
# Copy allow-listed Tesla web companion files from the private iOS repo.
# Usage:
#   COMPANION_SRC=~/path/to/companion ./.github/scripts/sync_companion_from_private.sh
#
# Expected layout:
#   $COMPANION_SRC/web/tesla/index.html
#   $COMPANION_SRC/web/tesla/styles.css
#   $COMPANION_SRC/web/tesla/app.js
#   $COMPANION_SRC/web/tesla/sync.js
#   $COMPANION_SRC/web/tesla/data/venues.json

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${COMPANION_SRC:-}"
BRANCH="${COMPANION_BRANCH:-recover/grok-sims-1.31.4}"
DEST="$ROOT/companion"

if [[ -z "$SRC" ]]; then
  echo "Set COMPANION_SRC to a local clone of wghtkbpxwx-a11y/companion" >&2
  echo "Example: COMPANION_SRC=../companion $0" >&2
  exit 1
fi

TESLA_DIR="$SRC/web/tesla"
if [[ ! -d "$TESLA_DIR" ]]; then
  echo "Missing $TESLA_DIR — checkout branch $BRANCH first" >&2
  exit 1
fi

mkdir -p "$DEST/data"
for f in index.html styles.css app.js sync.js README.md; do
  if [[ -f "$TESLA_DIR/$f" ]]; then
    cp "$TESLA_DIR/$f" "$DEST/$f"
    echo "copied $f"
  fi
done
if [[ -f "$TESLA_DIR/data/venues.json" ]]; then
  cp "$TESLA_DIR/data/venues.json" "$DEST/data/venues.json"
  echo "copied data/venues.json"
fi

echo "Done. Review diff, run node --check on app.js/sync.js, commit."
