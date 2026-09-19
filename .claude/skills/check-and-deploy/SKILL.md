---
name: check-and-deploy
description: >-
  Ship the current work to the Geotech3D production server end-to-end: run
  pre-flight checks, commit and push to main, then SSH-deploy via redeploy.sh.
  Use this whenever the user says "check and deploy", "شيك اند ديبلوي",
  "deploy to production", "ship it", "push and deploy", "نزّل التعديلات عالسيرفر",
  or otherwise asks to release the current changes to the live box — even if
  they only say "deploy". Because this pushes to main and rebuilds the box that
  ~20 internal users depend on, always confirm the plan before the push+deploy
  step; never skip the confirmation.
---

# Check and deploy

This skill takes the current working tree from local → GitHub `main` → the live
production box, safely. The whole point is that one command handles everything,
but a production deploy affects real users, so there is exactly **one human
checkpoint** right before anything irreversible happens. Everything before that
checkpoint is read-only or local; everything after is the actual release.

## The box you are deploying to

- Server: `ssh geotech3d-server` (alias in `~/.ssh/config`, Ireland EC2).
- App lives at `/opt/plane`, tracks `origin/main`, deployed with
  `/opt/plane/redeploy.sh` (fetches main, rebuilds only changed services one at
  a time, runs migrations, health-checks). See [[geotech3d-aws-deployment]].
- It is a small box (2 vCPU / 7.6 GB) shared with other company apps — do not
  touch the AWS control plane, only work inside the box. See
  [[geotech3d-ask-before-company-impact]].
- Site: `https://task-management.geotech3d.com`.

## Workflow

Run these in order. Stop and surface the problem to the user the moment a check
fails — do not push broken code.

### 1. See what's going out

```bash
git status
git diff --stat
```

Summarize for the user what has changed. If the working tree is clean **and**
`git log origin/main..HEAD` is empty, there is nothing to deploy — tell the user
and stop (or offer a forced redeploy of the current commit if they want).

### 2. Pre-flight checks

Only run the checks relevant to what changed — this repo is large and full-repo
checks are slow and noisy (`check:format`/`check:types` fail on ~121 pre-existing
files, so scope to your own files). See [[plane-custom-fork-conventions]].

**Always, if any file changed:**

- Formatting on this Windows machine: the editor writes CRLF but the repo wants
  LF. Run `pnpm exec oxfmt <your changed .ts/.tsx files>` from the relevant
  package dir so the commit doesn't fail formatting. Re-`git add` after.

**If anything under `packages/i18n/**`changed** (this is the highest-value check
— the fork has TWO locale trees that must stay byte-identical, and it's the one
thing CI gates on`main`-adjacent branches):

```bash
pnpm --filter @plane/i18n run generate:types
pnpm --filter @plane/i18n run check:sync
```

Both must pass. If `check:sync` fails, keys are missing from one of the two
trees (`packages/i18n/src/locales/**` runtime + `packages/i18n/locales/**`
mirror) or from some of the 20 locales — fix before continuing.

**If backend code under `apps/api/**`changed**, validate migrations (pytest in
CI uses`--nomigrations`, so this is checked separately):

```bash
docker compose -f docker-compose-test.yml run --rm api-tests \
  python manage.py makemigrations --check --dry-run --skip-checks
```

A non-zero exit means a model change needs a migration — generate it first.

**If frontend TS/TSX changed**, the pre-commit hook (`lint-staged` →
`oxlint --deny-warnings` on staged files) will gate lint automatically on
commit. Don't run a full-repo lint; just be ready for the hook to reject a file
that has warnings.

### 3. Commit

Only if there are uncommitted changes. Stage the intended files, write a
conventional-commit message describing the change, and commit. End the message
with the attribution line:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

If the pre-commit hook rejects a file for pre-existing oxlint warnings on lines
you didn't touch, tell the user — do not blanket-disable the hook.

### 4. Confirmation checkpoint — REQUIRED

Before pushing or deploying, show the user a short summary and get an explicit
go-ahead. This is the shared-state / company-impact gate; do not skip it.

Present:

- The commit(s) that will land on `main` (`git log origin/main..HEAD --oneline`).
- Which services `redeploy.sh` will rebuild, inferred from changed paths:
  - `apps/api/**` → api + worker + beat-worker + migrator
  - `apps/{web,space,admin,live,proxy}/**` → that service
  - `packages/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`,
    `turbo.json` → web + space + admin + live (shared frontend packages)
- That this rebuilds the live box ~20 people use, and that migrations (if any)
  run against the production database.

Wait for a clear "yes" / "نعم" / "go". If unsure, run the dry run first
(step 5 with `--dry-run`) and show the plan.

### 5. Push and deploy

```bash
git push origin main
ssh geotech3d-server "cd /opt/plane && ./redeploy.sh"
```

Useful variants:

- `ssh geotech3d-server "cd /opt/plane && ./redeploy.sh --dry-run"` — show the
  rebuild plan, change nothing. Good for the "not sure" case.
- `ssh geotech3d-server "cd /opt/plane && ./redeploy.sh web api"` — force
  specific services.

### 6. Verify and report

`redeploy.sh` prints container status and a health check of every route at the
end. Report it to the user. Two known gotchas from [[geotech3d-aws-deployment]]:

- The health check runs **immediately** after `up -d`, so `space` and `live`
  routinely show `502` there while still booting. If only those show 502,
  re-check a minute later before treating it as a failure:
  ```bash
  ssh geotech3d-server 'for p in / /api/instances/ /god-mode/ /spaces/ /live/health; do printf "%-18s %s\n" "$p" "$(curl -s -m 20 --resolve task-management.geotech3d.com:443:127.0.0.1 -o /dev/null -w "%{http_code}" https://task-management.geotech3d.com$p)"; done'
  ```
  Healthy = `/` `/api/instances/` `/god-mode/` `/spaces/` → 200, `/live/health`
  → 200.
- `redeploy.sh` does **not** auto-rollback. If the deploy broke something, the
  fix is to run the rollback yourself:
  ```bash
  ssh geotech3d-server "cd /opt/plane && ./redeploy.sh --rollback"
  ```
  Offer this if the health check shows a persistent failure.

## Rules

- Never edit code directly on the server — `redeploy.sh` runs `git reset --hard`
  and will erase it. All changes go through `main`.
- Never run `docker compose down -v` on the box — it destroys the data volumes.
- The `.env` files and `docker-compose.override.yml` on the box are untracked and
  must survive; deploys don't touch them.
- Do not touch DNS, the AWS console, or port-80 security-group rules as part of a
  deploy. See [[geotech3d-ask-before-company-impact]].
