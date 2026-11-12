#!/bin/bash
# LibraCloud auto-deploy agent - runs on EC2 every 2 minutes (cron).
#
# Pulls the latest images from GitHub Container Registry. Docker Compose then
# recreates ONLY the containers whose image changed; every other service keeps
# running untouched. Each change is logged (and shipped to CloudWatch Logs):
#   DEPLOYED catalog: sha-1a2b3c4 -> sha-5d6e7f8
set -uo pipefail
exec 9>/var/lock/libracloud-deploy.lock
flock -n 9 || exit 0     # never run two deploys at once

cd /opt/libracloud || exit 1
source /etc/libracloud/deploy.env 2>/dev/null || true
SERVICES="auth catalog circulation notification gateway"
ts() { date -Is; }

version_of() {   # image version label of the running container
  local id
  id=$(docker compose ps -q "$1" 2>/dev/null)
  [ -n "$id" ] && docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$id" 2>/dev/null || echo "none"
}
image_of() {
  local id
  id=$(docker compose ps -q "$1" 2>/dev/null)
  [ -n "$id" ] && docker inspect --format '{{.Image}}' "$id" 2>/dev/null || echo "none"
}

# Pick up changes to the compose file itself (infrastructure change through git).
if [ -n "${REPO_RAW:-}" ] && curl -fsSL "$REPO_RAW/docker-compose.prod.yml" -o docker-compose.yml.new 2>/dev/null; then
  if ! cmp -s docker-compose.yml docker-compose.yml.new && docker compose -f docker-compose.yml.new config -q 2>/dev/null; then
    echo "$(ts) CONFIG docker-compose.yml changed - applying"
    mv docker-compose.yml.new docker-compose.yml
  else
    rm -f docker-compose.yml.new
  fi
fi

declare -A BEFORE_IMG BEFORE_VER
for s in $SERVICES; do BEFORE_IMG[$s]=$(image_of "$s"); BEFORE_VER[$s]=$(version_of "$s"); done

if ! docker compose pull -q 2>/tmp/libracloud-pull.err; then
  echo "$(ts) ERROR image pull failed: $(tr '\n' ' ' </tmp/libracloud-pull.err)"
  exit 1
fi
docker compose up -d --remove-orphans >/dev/null 2>&1

changed=0
for s in $SERVICES; do
  if [ "${BEFORE_IMG[$s]}" != "$(image_of "$s")" ]; then
    echo "$(ts) DEPLOYED $s: ${BEFORE_VER[$s]} -> $(version_of "$s")"
    changed=$((changed + 1))
  fi
done

if [ "$changed" -gt 0 ]; then
  echo "$(ts) SUMMARY $changed service(s) updated, $(( $(echo $SERVICES | wc -w) - changed )) unchanged and not restarted"
  docker image prune -f >/dev/null 2>&1
fi
