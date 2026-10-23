# Shared helpers for the deploy/ scripts. Source, don't run.
HOST="${DEPLOY_HOST:-hetzner}"   # from ~/.ssh/config

# Coolify names containers <service>-<custom_internal_name>: the resource has
# "consistent container names" on with internal name "laadpalenviewer", so
# these are static: web-laadpalenviewer, app-laadpalenviewer, worker-laadpalenviewer.
lpv_container() {
  echo "$1-laadpalenviewer"
}

require_container() {
  local name
  name="$(lpv_container "$1")"
  if [[ "$(ssh "$HOST" "docker inspect -f '{{.State.Running}}' '$name' 2>/dev/null")" != "true" ]]; then
    echo "container '$name' draait niet op $HOST (Coolify-resource al gedeployed?)" >&2
    exit 1
  fi
  echo "$name"
}
