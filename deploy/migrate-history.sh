#!/usr/bin/env bash
# Port the usage history that the GitHub Action committed to git into the
# server's history.db. Safe to run repeatedly (hour-level merge, never overwrites).
#
#   ./deploy/migrate-history.sh
#
# 1. fetch origin and rebuild a history DB from EVERY snapshot day-file ever
#    committed (including the ones the 30-day rollup deleted: git kept them),
# 2. copy it into the worker container's state volume,
# 3. merge it into the live DB there.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/deploy/lib.sh"
REV="${REV:-origin/main}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WORKER="$(require_container worker)"

echo "==> git fetch + history uit $REV opbouwen"
git -C "$ROOT" fetch origin
( cd "$ROOT/data-pipeline" && LPV_HISTORY_DB="$TMP/import.db" npm run --silent import-history -- --git "$ROOT" --rev "$REV" )

echo "==> uploaden naar $WORKER ($(du -h "$TMP/import.db" | cut -f1))"
REMOTE_TMP="/tmp/lpv-import-$$.db"
scp -q "$TMP/import.db" "$HOST:$REMOTE_TMP"
ssh "$HOST" "docker cp '$REMOTE_TMP' '$WORKER:/srv/lpv/state/import.db' && rm -f '$REMOTE_TMP'"

echo "==> mergen in live history.db"
ssh "$HOST" "docker exec '$WORKER' npm run --silent merge-history -- /srv/lpv/state/import.db \
  && docker exec '$WORKER' rm -f /srv/lpv/state/import.db"
echo "==> klaar"
