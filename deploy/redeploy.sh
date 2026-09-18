#!/usr/bin/env bash
# Redeploy the Plane fork on this server.
#
#   ./redeploy.sh             pull origin/main, rebuild ONLY what changed, restart
#   ./redeploy.sh --dry-run   show what would happen, change nothing
#   ./redeploy.sh web api     force a rebuild of specific services
#   ./redeploy.sh --rollback  return to the commit from before the last deploy
#
# Never edit code directly on this box: `git reset --hard` below will erase it.
# Your .env files and docker-compose.override.yml are untracked, so they survive.
set -euo pipefail
cd /opt/plane
STATE=/opt/plane.lastdeploy
DRY=0; ROLLBACK=0; FORCE=""

for a in "${@:-}"; do
  case "$a" in
    "")          ;;
    --dry-run)   DRY=1 ;;
    --rollback)  ROLLBACK=1 ;;
    -*)          echo "unknown flag: $a"; exit 1 ;;
    *)           FORCE="$FORCE $a" ;;
  esac
done

log(){ printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }

OLD=$(git rev-parse HEAD)

if [ "$ROLLBACK" = "1" ]; then
  [ -f "$STATE" ] || { echo "no previous deploy recorded"; exit 1; }
  TARGET=$(cat "$STATE")
else
  log "fetching origin/main"
  git fetch origin main --quiet
  TARGET=$(git rev-parse origin/main)
fi

if [ "$OLD" = "$TARGET" ] && [ -z "${FORCE// /}" ]; then
  log "already at ${OLD:0:9} - nothing to deploy"; exit 0
fi

log "commits ${OLD:0:9} -> ${TARGET:0:9}"
git --no-pager log --oneline "$OLD".."$TARGET" 2>/dev/null | sed 's/^/    /' | head -20 || true

CHANGED=$(git diff --name-only "$OLD" "$TARGET" || true)
log "changed files"; echo "$CHANGED" | sed 's/^/    /' | head -25

# --- map each changed path to the services that must be rebuilt ---
svcs=""
add(){ case " $svcs " in *" $1 "*) ;; *) svcs="$svcs $1";; esac; }
while read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    apps/api/*)   add api; add worker; add beat-worker; add migrator ;;
    apps/web/*)   add web ;;
    apps/space/*) add space ;;
    apps/admin/*) add admin ;;
    apps/live/*)  add live ;;
    apps/proxy/*) add proxy ;;
    # shared frontend packages feed every SPA and the live server
    packages/*|pnpm-lock.yaml|package.json|pnpm-workspace.yaml|turbo.json)
                  add web; add space; add admin; add live ;;
  esac
done <<EOF
$CHANGED
EOF

[ -n "${FORCE// /}" ] && svcs="$FORCE"
svcs=$(echo $svcs | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')

log "services to rebuild:${svcs:+ $svcs}${svcs:- none}"
if [ "$DRY" = "1" ]; then log "dry run - nothing was changed"; exit 0; fi
if [ -z "${svcs// /}" ]; then log "no service affected; updating source only"; fi

echo "$OLD" > "$STATE"
log "checking out ${TARGET:0:9}"
git reset --hard "$TARGET" --quiet

# build one service at a time: this box is 2 vCPU / 7.6 GB
for s in $svcs; do
  log "building $s"
  docker compose build "$s"
done

# migrations run before the app services come back
case " $svcs " in
  *" migrator "*)
    log "running migrations"
    docker compose up -d --force-recreate migrator
    for i in $(seq 1 120); do
      case "$(docker compose ps -a migrator --format '{{.Status}}')" in Exited*) break;; esac
      sleep 5
    done
    docker compose logs migrator --tail 12
    ;;
esac

RESTART=$(echo "$svcs" | tr ' ' '\n' | grep -v '^migrator$' | grep -v '^$' | tr '\n' ' ' || true)
if [ -n "${RESTART// /}" ]; then
  log "restarting:$RESTART"
  docker compose up -d --force-recreate $RESTART
fi

log "status"
docker compose ps --format "table {{.Service}}\t{{.Status}}"

log "health"
H="--resolve task-management.geotech3d.com:443:127.0.0.1"
for p in / /api/instances/ /god-mode/ /spaces/ /live/health; do
  printf "    %-18s %s\n" "$p" "$(curl -s -m 20 $H -o /dev/null -w '%{http_code}' https://task-management.geotech3d.com$p || echo ERR)"
done

log "done. if something broke:  ./redeploy.sh --rollback"
