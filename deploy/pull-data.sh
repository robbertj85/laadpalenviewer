#!/usr/bin/env bash
# Copy the live data from the server into the local repo for development:
# web data -> webapp/public/, newest history.db backup -> data-pipeline/.data/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/deploy/lib.sh"
WORKER="$(require_container worker)"

echo "==> webdata van $WORKER"
mkdir -p "$ROOT/webapp/public"
rm -rf "$ROOT/webapp/public/data"
ssh "$HOST" "docker exec '$WORKER' tar -C /srv/lpv/public -czf - ." | tar -xzf - -C "$ROOT/webapp/public"

LATEST="$(ssh "$HOST" "docker exec '$WORKER' sh -c 'ls -1 /srv/lpv/state/backups/history-*.db 2>/dev/null | tail -1'")"
if [[ -n "$LATEST" ]]; then
  echo "==> $LATEST"
  mkdir -p "$ROOT/data-pipeline/.data"
  rm -f "$ROOT/data-pipeline/.data/history.db-wal" "$ROOT/data-pipeline/.data/history.db-shm"
  ssh "$HOST" "docker exec '$WORKER' cat '$LATEST'" > "$ROOT/data-pipeline/.data/history.db"
else
  echo "nog geen history-backup op de server (eerste nightly run nog niet geweest)" >&2
fi
