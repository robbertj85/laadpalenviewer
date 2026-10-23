# Shared helpers for the deploy/ scripts. Source, don't run.
HOST="${DEPLOY_HOST:-hetzner}"   # from ~/.ssh/config

# Name of the running Coolify container for compose service $1 of this app
# (Coolify names them <service>-<resource-uuid>; find it by labels instead).
lpv_container() {
  ssh "$HOST" "docker ps --filter label=com.docker.compose.service=$1 --format '{{.Names}} {{.Label \"coolify.resourceName\"}}'" \
    | awk '$2 ~ /laadpalenviewer/ {print $1; exit}'
}

require_container() {
  local name
  name="$(lpv_container "$1")"
  if [[ -z "$name" ]]; then
    echo "geen draaiende '$1'-container van laadpalenviewer gevonden op $HOST (Coolify-resource al gedeployed?)" >&2
    exit 1
  fi
  echo "$name"
}
