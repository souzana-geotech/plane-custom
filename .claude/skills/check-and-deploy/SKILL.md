# Check and deploy

Ship the current work to the Geotech3D production server automatically and end-to-end.

Use this skill whenever the user says:

- "check and deploy"
- "شيك اند ديبلوي"
- "deploy to production"
- "ship it"
- "push and deploy"
- "نزّل التعديلات عالسيرفر"
- "deploy"

The goal is:

**local changes → pre-flight checks → commit → push to GitHub main → SSH deploy → production health checks**

## Important behavior

This skill is fully automatic.

**Do NOT ask the user for confirmation before pushing or deploying.**

If all required checks pass, continue automatically through commit, push, deployment, and verification.

If any required check fails, STOP immediately and report the failure.

Never push or deploy code that failed a required pre-flight check.

The only human interaction should be required if:

- a required check fails
- there is an ambiguous/unexpected situation that could cause data loss or affect unrelated company systems
- the deployment itself reports a failure that requires a decision such as rollback

Normal successful deployment does NOT require confirmation.

## Production target

- SSH alias: `geotech3d-server`
- Server path: `/opt/plane`
- Deployment script: `/opt/plane/redeploy.sh`
- Production URL: `https://task-management.geotech3d.com`

The server is shared with other company applications.

Do not touch the AWS control plane.

Do not modify:

- AWS resources
- DNS
- security groups
- SMTP configuration
- unrelated company applications
- unrelated production configuration

Only deploy the current Geotech3D application through the existing deployment process.

## 1. Inspect changes

Run:

```bash
git status
git diff --stat
git diff --name-only
```

Determine exactly what is going into the deployment.

If there are no uncommitted changes AND:

```bash
git log origin/main..HEAD --oneline
```

is empty, report:

> Nothing to deploy. Working tree and main are already synchronized.

Then stop.

Do not create an empty commit.

## 2. Pre-flight checks

Run only checks relevant to the changed files.

Do not run unnecessary full-repository checks when they are known to fail because of pre-existing issues.

### Formatting

For changed `.ts` / `.tsx` files, use the repository's expected formatter if needed.

Do not reformat unrelated files.

### i18n

If anything under:

```text
packages/i18n/**
```

changed, run:

```bash
pnpm --filter @plane/i18n run generate:types
pnpm --filter @plane/i18n run check:sync
```

Both must pass.

### Backend

If `apps/api/**` changed, run the relevant backend validation.

At minimum verify migrations:

```bash
docker compose -f docker-compose-test.yml run --rm api-tests \
  python manage.py makemigrations --check --dry-run --skip-checks
```

Also run targeted tests relevant to the changed code when available.

### Frontend

If frontend TypeScript/TSX files changed, run the relevant lint/type/build checks.

Do not attempt to fix unrelated pre-existing repository-wide errors.

### Critical rule

If a check fails:

1. STOP.
2. Do NOT commit.
3. Do NOT push.
4. Do NOT deploy.
5. Report the exact failure and affected files.

## 3. Commit

If all required checks pass and there are uncommitted changes:

1. Stage only the intended changed files.
2. Create a conventional commit describing the actual change.
3. Include:

```text
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Do not include unrelated files.

If the commit hook fails:

- inspect the actual failure
- distinguish pre-existing warnings from errors caused by the current change
- do not disable hooks
- do not make unrelated cleanup changes just to force a commit
- if the failure cannot be safely resolved within the changed files, STOP and report it

## 4. Push automatically

After all checks pass and the commit succeeds:

```bash
git push origin main
```

Do not ask for confirmation.

If push fails:

- STOP.
- Do not deploy.
- Report the failure.

## 5. Deploy automatically

After a successful push:

```bash
ssh geotech3d-server "cd /opt/plane && ./redeploy.sh"
```

Do not ask for confirmation.

Do not use:

```bash
docker compose down -v
```

Never modify code directly on the server.

Never manually edit production files.

## 6. Verify production

After `redeploy.sh` completes, verify the production application.

Expected routes:

```text
/                    → 200
/api/instances/      → 200
/god-mode/           → 200
/spaces/             → 200
/live/health         → 200
```

If `space` or `live` temporarily return `502` immediately after deployment, wait briefly and re-check because these services may still be starting.

Use:

```bash
ssh geotech3d-server 'for p in / /api/instances/ /god-mode/ /spaces/ /live/health; do printf "%-18s %s\n" "$p" "$(curl -s -m 20 --resolve task-management.geotech3d.com:443:127.0.0.1 -o /dev/null -w "%{http_code}" https://task-management.geotech3d.com$p)"; done'
```

Only treat the deployment as healthy when the expected routes return the expected status codes.

## 7. Deployment failure

If the deployment or health checks fail persistently:

- STOP.
- Do not continue making unrelated changes.
- Report exactly what failed.

Because `redeploy.sh` does not automatically rollback, offer the rollback command:

```bash
ssh geotech3d-server "cd /opt/plane && ./redeploy.sh --rollback"
```

Do NOT automatically rollback unless explicitly instructed or unless an automated rollback policy is later added.

## Safety rules

- Never modify AWS resources.
- Never modify DNS.
- Never modify security groups.
- Never modify SMTP configuration.
- Never touch unrelated company applications.
- Never run `docker compose down -v`.
- Never edit production code directly.
- Never deploy if required checks fail.
- Never bypass Git hooks.
- Never force-push `main`.
- Never deploy an uncommitted working tree.
- Never include unrelated changes in the commit.

## Final report

After a successful deployment, give a concise report containing:

- Commit hash
- Commit message
- Files changed
- Services rebuilt
- Deployment result
- Production health-check results
- Production URL

Example:

> ✅ Deployed successfully  
> Commit: `abc1234`  
> Services: `web, api`  
> Health checks: all green  
> Production: `https://task-management.geotech3d.com`

If deployment fails, clearly report the failure instead of claiming success.
