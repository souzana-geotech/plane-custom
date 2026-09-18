# Deployment

Production runs on a single EC2 host, Docker Compose, behind a host-level Caddy.

## Layout on the server

| Path                                     | What                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `/opt/plane`                             | this repo, full clone, tracking `origin/main`                           |
| `/opt/plane/.env`                        | infra + proxy config (untracked)                                        |
| `/opt/plane/apps/api/.env`               | api / worker / beat-worker / migrator (untracked)                       |
| `/opt/plane/apps/live/.env`              | live server (untracked)                                                 |
| `/opt/plane/docker-compose.override.yml` | deployment-specific overrides (untracked)                               |
| `/opt/plane.secrets`                     | generated secrets, outside the repo so `reset --hard` cannot touch them |
| `/etc/caddy/Caddyfile`                   | host reverse proxy, terminates TLS                                      |

Data lives in named Docker volumes (`plane_pgdata`, `plane_uploads`,
`plane_redisdata`, `plane_rabbitmq_data`) and is untouched by code deploys.
Only `docker compose down -v` would destroy it — never run that.

## Deploying

```bash
ssh <host> "cd /opt/plane && ./redeploy.sh"
```

`redeploy.sh` fetches `origin/main`, diffs against the deployed commit, rebuilds
only the affected services (one at a time — the box is small), runs migrations to
completion before restarting app services, then health-checks every route.

```bash
./redeploy.sh --dry-run    # show the plan, change nothing
./redeploy.sh web api      # force specific services
./redeploy.sh --rollback   # return to the previously deployed commit
```

Never edit code directly on the server: `redeploy.sh` runs `git reset --hard`.

## Overrides that production depends on

`docker-compose.override.yml` carries three fixes the root compose still needs:

1. `plane-minio` repointed to `quay.io/minio/minio` — `minio/minio` no longer
   exists on Docker Hub.
2. `proxy` given `SITE_ADDRESS` and the `CERT_*` / `TRUSTED_PROXIES` vars. Without
   `SITE_ADDRESS` the Caddyfile emits a keyless block and the proxy crash-loops.
3. `live` given an `env_file` — the root compose declares none, so it silently
   falls back to localhost defaults and collaborative editing breaks.

## TLS

Caddy issues and renews the certificate automatically via ACME HTTP-01, which
requires **inbound port 80 open to `0.0.0.0/0`**. Restricting port 80 by source IP
breaks renewal roughly every 60 days, with a `Timeout during connect` error, even
though the site still looks reachable from inside the office.
