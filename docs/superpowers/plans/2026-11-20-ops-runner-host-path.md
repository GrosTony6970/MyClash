# The ops runner sees the repo at the host's own path — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** a `docker compose` command run from inside the ops runner resolves every bind mount to
the same host path as the same command run on the host, wherever the repo lives.

**Architecture:** the ops runner mounts the repo at the host's own absolute path, works there, and
is told that path in `MYCLASH_ROOT_DIR`. Nothing stores the path: `lib/compose.sh` exports
`MYCLASH_ROOT_DIR="$ROOT_DIR"` (the folder the script runs from) on every compose call, and the
compose file requires it (`${MYCLASH_ROOT_DIR:?…}`), so a caller that forgets it fails loudly
instead of mounting a wrong path. Moving the repo then needs one `start.sh` from the new folder.
And the restore's restart becomes `up -d --no-recreate`: it only stopped containers, so it starts
them again and never re-creates one, the runner it runs in least of all, whatever else differs.

**Tech stack:** Docker Compose v5, bash, Node 26 (`node:test`).

**Spec:** `docs/superpowers/specs/2026-11-18-ops-agent-design.md` §3 (the ops runner) and §7.
This is a bug fix of the ops-agent track, found during the slice 4b restore check (below). No
ruling decides the shape; the operator chose "root fix, before slice 5" (2026-11-20) and asked
that the path follow the repo if it moves.

## The incident (2026-11-20 08:57-09:01 UTC)

The operator restored a backup from the console (Backups → Restore from local). The runner runs
`restore.sh`. The restore replaced the database and the files, revoked the stale agent keys, then
ran its last step, `docker compose up -d` (`restore.sh:420`, `RESTART`). Inside the runner the repo
is at `/srv/myclash` (`docker-compose.prod.yml:924,929,939`); on the VPS it is at
`/home/tonio/MyClash`. Compose resolves the relative bind sources (`./data/traefik`, `./db/init/…`,
`../data/system-versions.json`, `../`) against `/srv/myclash/infra` and hands them to the Docker
daemon, which reads them as HOST paths. So `db`, `traefik`, `ops-runner` and `web-marketing` looked
changed and were re-created; re-creating `ops-runner` killed the runner, the restore and Compose
mid-way. `db` and `traefik` stayed "Created", the site was down 3½ minutes, and Docker created an
empty `/srv/myclash/data/system-versions.json/` directory on the host as root. The operator removed
two half-made containers and ran `start.sh`. From the host the same `up -d` kept `traefik` and
`ops-runner`: for those two the path is the only difference (the app services also differ by
`GIT_COMMIT`, Task 2). The setup script suggests `/srv/myclash`
(`vps-bootstrap.sh:65`), where the paths match by luck; since `b784d80b8` (2026-10-30) every
whole-database console restore on this VPS ends this way. The key seed's `run --rm api` from inside
the runner (`ops-agent-seed.sh:25`) mounts the same wrong manifest path (harmless, same class).

## Global constraints

- Hard rule 9: one concern, one commit. The compose change, its four callers and its tests land
  together: CI breaks between them otherwise.
- Every compose caller of `infra/docker-compose.prod.yml`, with `MYCLASH_ROOT_DIR` after the change:
  - `infra/scripts/*.sh` → `mc_compose_init` (`lib/compose.sh`; `scripts/compose-lib.test.mjs`
    holds every script to it);
  - the runner's own `COMPOSE_FLAGS` calls (`server.mjs:113-118`, `container-actions.mjs`,
    `container-logs.mjs`) → the runner process's env, set by compose;
  - `scripts/check-api-boot.sh`, `check-realtime-socket.sh`, `check-service-db-users.sh` → their
    own `cd` to the repo root;
  - `.github/workflows/ci.yml` job `deploy-migrations`, steps "Build production image" and "Run the
    deploy migrations twice" → step `env`.
- Measured (Compose v5.6.1, local, 2026-11-20): a missing `${X:?}` on ONE service fails EVERY
  command (`config`, `up -d <other>`, `ps`, `logs`, `restart`, `stop`, `start`, `exec`,
  `run --no-deps`, `down`). The comment at `restore.sh:345-347` says the opposite; it is corrected.
- `docker-compose.dev.yml` keeps `/srv/myclash` (Windows paths cannot be a Linux mount target).
  Named, not fixed: Compose run from the dev runner has the same mismatch.
- Named, not fixed: `restore.sh` does not call `mc_ensure_system_versions_manifest` before it
  creates a container (the seed's `run --rm api`); it matters only for a restore before any
  deploy, which has no built images to start anyway.
- Never `/srv/myclash` as a silent fallback: `server.mjs:43` loses `?? '/srv/myclash'` and exits at
  boot without `MYCLASH_ROOT_DIR`, as it does without `OPS_RUNNER_SECRET` (`server.mjs:129-132`).

## Review focus

Measured for this plan (Compose v5.6.1, local): `up -d --no-recreate` after a settings change
starts the SAME container (same id, old settings); a plain `up -d` re-creates it.

1. A deploy after this change re-creates `ops-runner` once (its mount moved). `deploy.sh` waits for
   a runner job before (`mc_wait_for_ops_jobs`), so no job dies. Expected, not a defect.
2. A raw `docker compose …` typed on the VPS without the scripts now fails with the message of
   the `:?`. The message must name the fix (run it through `infra/scripts/`).
3. `docker exec myclash-ops-runner node infra/ops-runner/ops-lock-probe.mjs`
   (`ops-jobs-wait.sh:42`) is relative to `working_dir`: it keeps working with the new one.
4. Inside the runner `restore.sh` computes `ROOT_DIR` from its own location
   (`restore.sh:20-23`) = the host path, so its export matches the runner's env byte for byte.
5. The host card's disk mountpoint (`df -P ROOT_DIR`) will read the host path instead of
   `/srv/myclash`; display only (test fixtures hold their own literals).

---

### Task 1: The runner mounts and works at the host's path

**Files:**

- Modify: `infra/docker-compose.prod.yml:924,929,939` (ops-runner `working_dir`, `environment`,
  `volumes`)
- Modify: `infra/scripts/lib/compose.sh` (`mc_compose_init`; header comment "Sets:")
- Modify: `infra/ops-runner/server.mjs:43` and the boot check at `:129-132`
- Modify: `scripts/check-api-boot.sh:22`, `scripts/check-realtime-socket.sh:20`,
  `scripts/check-service-db-users.sh:20` (export after the `cd`)
- Modify: `.github/workflows/ci.yml:647-657` (two steps' `env`)
- Modify: `infra/scripts/restore.sh:345-347` (comment), `:420` and `:428` (`--no-recreate`)
- Modify: the raw compose recipes (Step 10b list)
- Modify: `scripts/check-infra-review.mjs:810-820` (the ops-runner branch, the restore pin)
- Test: `scripts/compose-lib.test.mjs`
- Docs: `docs/ARCHITECTURE.md` §17.4 (one paragraph), `docs/ENGINEERING_LESSONS.md` "Cross-platform
  & deployment" (one bullet)

**Interfaces:**

- Produces: the env var `MYCLASH_ROOT_DIR` = the repo's absolute host path, exported by
  `mc_compose_init`, required by the compose file, read by the runner as its `ROOT_DIR`.

- [ ] **Step 1: Write the failing lib test** in `scripts/compose-lib.test.mjs`:
      `test('mc_compose_init exports MYCLASH_ROOT_DIR as the root the script runs from')` — source
      the lib with `ROOT_DIR=<tmp root>` (`rootWith('DOMAIN=example.test\nTLS_CERTS=staging\n')`),
      call `mc_compose_init`, then `bash -c 'printf %s "$MYCLASH_ROOT_DIR"'` in a child shell (so
      the value must be EXPORTED, not only set); assert it equals the tmp root (forward slashes).
      A second case with `TLS_CERTS=production` asserts the same (the export is not inside the
      `staging)` branch). Use a run helper of its own; `run()` prints a fixed last four lines.

- [ ] **Step 2: Run it, see it red**
      Run: `node --test scripts/compose-lib.test.mjs`
      Expected: the two new tests FAIL (empty value); the others pass.

- [ ] **Step 3: Export it** — in `mc_compose_init`, before the `case`:
      `export MYCLASH_ROOT_DIR="$ROOT_DIR"`, with a two-line comment: Compose reads it from the
      invoking shell; the compose file mounts the repo into the ops runner at this path.

- [ ] **Step 4: Run it, see it green** (same command; all pass).

- [ ] **Step 5: Write the failing infra-review rule** in `scripts/check-infra-review.mjs`, ops-runner
      branch: the service text must contain, each exactly once,
      `working_dir: ${MYCLASH_ROOT_DIR:?` + the message,
      `MYCLASH_ROOT_DIR: ${MYCLASH_ROOT_DIR:?` + the message, and
      `- ../:${MYCLASH_ROOT_DIR:?` + the message; and must not contain `/srv/myclash`. Error text:
      "ops-runner must mount the repo at the host's own path (MYCLASH_ROOT_DIR), work there and be
      told it: Compose run inside it hands bind paths to the host's Docker daemon (incident
      2026-11-20)." Keep the message one constant shared by the three checks.
      Two more rules in the same place: (i) `.env.example` has no `MYCLASH_ROOT_DIR` line (a
      `.env` load after `mc_compose_init`, `deploy.sh:490`, `status.sh:256`, would empty the export:
      the `GIT_COMMIT` trap); (ii) `restore.sh` sets both `RESTART` arrays with `up -d
--no-recreate` (a restore only stopped containers; re-creating one, the runner above all,
      ends the restore — whatever the cause: a path, an edited `.env`, another Compose version).

- [ ] **Step 6: Run it, see it red**
      Run: `pnpm infra:review`
      Expected: FAIL naming the ops-runner rule and the restore rule.

- [ ] **Step 7: Change the compose file and the restore** — ops-runner: `working_dir`,
      `environment.MYCLASH_ROOT_DIR` and the repo volume's target all become
      `${MYCLASH_ROOT_DIR:?set by infra/scripts/lib/compose.sh - run compose through infra/scripts}`
      (one message, three places; no colon followed by a space in it: YAML reads that pair in a
      plain scalar as a mapping and the file stops parsing); the volume stays `../:<that>`. Update the comment at
      `:739` ("the ops-runner's `../:/srv/myclash`") to the new form. `restore.sh:420` becomes
      `RESTART=("${COMPOSE[@]}" up -d --no-recreate)`, `:428`
      `RESTART=("${COMPOSE[@]}" up -d --no-recreate --no-deps supabase-storage)`, each with a
      one-line comment (why: the runner runs this script; see the incident).

- [ ] **Step 8: Run infra:review, see it green.** Then prove the file parses and the guard fires,
      from PowerShell (Git Bash rewrites a `/…` env value into a Windows path):
      `$env:MYCLASH_ROOT_DIR='/srv/check'; docker compose --env-file .env.example -f infra/docker-compose.prod.yml config --quiet`
      → exit 0; `Remove-Item Env:MYCLASH_ROOT_DIR` then the same → exit 1 printing the message.
      (A local "target === source" check cannot hold on Windows: Compose resolves `../` to
      `F:\…`; the live check of Task 3 proves the mount.)

- [ ] **Step 9: The runner requires it** — `server.mjs:43` becomes
      `const ROOT_DIR = process.env.MYCLASH_ROOT_DIR;` followed AT ONCE (before `:74`, the first
      use) by a check that prints `MYCLASH_ROOT_DIR is required` and exits 1 when it is missing.
      `node --test infra/ops-runner/*.test.mjs` stays green (the tests pass their own roots).

- [ ] **Step 10: The CI callers** — each of the three `scripts/check-*.sh` gets
      `export MYCLASH_ROOT_DIR="$PWD"` on the line after its `cd` (comment: the compose file
      requires it; see `infra/scripts/lib/compose.sh`). In `ci.yml`, the steps "Build production
      image" and "Run the deploy migrations twice" get a block-form `env:` with
      `MYCLASH_ROOT_DIR: ${{ github.workspace }}` (not a `{ … }` flow mapping: its braces clash
      with `${{ }}`). `bash -n` each script;
      `pnpm infra:review` and the shellcheck job's file list unchanged.

- [ ] **Step 10b: The raw recipes** — every printed or documented `docker compose … -f
infra/docker-compose.prod.yml` gets `MYCLASH_ROOT_DIR="$PWD"` in front (run from the repo
      root): `deploy.sh:108` (help), `:717` (also gains `--env-file .env`), `:775` (printed in an
      incident); `infra/scripts/README.md:84`; `docs/ARCHITECTURE.md:4477-4479` (and its
      `cd /srv/myclash` becomes `cd <repo>`); `docs/INFRASTRUCTURE_REVIEW.md:270`;
      `docs/ENGINEERING_LESSONS.md:462`; the usage comments `docker-compose.prod.yml:7` and
      `docker-compose.staging-certs.yml:6`. `.env.example:373` is about `GIT_COMMIT`, left as is.
      Then `grep -rn "docker compose.*docker-compose.prod.yml"` over `infra/ docs/ scripts/
.github/` and check every hit either sets the variable or runs inside a script that did.

- [ ] **Step 11: Correct `restore.sh:345-347`** — the comment says `${X:?}` is checked only on
      `config`/`up`; replace with: Compose (v5) refuses every command when a required key is
      missing, so this check runs first, while nothing is stopped yet. Comment only.

- [ ] **Step 12: Docs** — ARCHITECTURE §17.4: one paragraph (the runner sees the repo at the host's
      path, `MYCLASH_ROOT_DIR` from `lib/compose.sh`, why, the incident; moving the repo = one
      `start.sh` from the new folder). ENGINEERING_LESSONS "Cross-platform & deployment": a container
      that runs `docker compose` through the host's socket must see the repo at the host's path;
      relative bind sources are resolved in the client's filesystem and read in the daemon's.

- [ ] **Step 13: Falsify** each new test: (a) delete the `export` line → the lib tests red, same
      collected count; (b) put `/srv/myclash` back as the volume target → `infra:review` red;
      (c) drop `--no-recreate` from `restore.sh:420` → `infra:review` red. Prove
      each break landed with grep; restore from a backup copy taken before the break, then `cmp`.

- [ ] **Step 14: Gates** — `gates.sh <root> <logdir> none` (31 gates), then commit:
      `fix(ops-runner): the runner sees the repo at the host's own path, so a restore never re-creates it`
      (explicit paths; `git fetch` and `git log --oneline -1` first).

### Task 2: A restart keeps the deployed commit

Found in the plan review (2026-11-20): every app service takes `GIT_COMMIT: ${GIT_COMMIT:-unknown}`
(`docker-compose.prod.yml:700,1006,1071,1163,1221,1311`), a shell-only value that only `deploy.sh:564`
and `rollback.sh:181` export. `start.sh` and `restore.sh` do not, so their `up -d` re-creates
`api`, `worker` and the four web apps saying "unknown". Live since the 09:01 `start.sh`:
`staff.myclash.fr/login` serves `sw.js?v=unknown`, so every tablet keeps its old offline cache in
silence (`deploy.sh:910-920`). Without this task, Task 3's check "no container re-created" fails.

**Files:**

- Modify: `infra/scripts/lib/compose.sh` (`mc_compose_init`)
- Test: `scripts/compose-lib.test.mjs`
- Modify: `scripts/check-infra-review.mjs` only if a pin there reads `mc_compose_init`'s body
  (grep `compose.sh` in it first)

**Interfaces:**

- Consumes: `.last-deploy.json` at `$ROOT_DIR` (`deploy.sh:936`, key `deployedCommit`; deleted by
  `destroy.sh --full`, rewritten by the next deploy).
- Produces: `GIT_COMMIT` exported by `mc_compose_init` when the caller's is empty or unset.
  `deploy.sh:564` and `rollback.sh:181` set their own later and win.

- [ ] **Step 1: Failing tests** in `scripts/compose-lib.test.mjs`:
      (a) `test('mc_compose_init exports the deployed commit from .last-deploy.json')` — root with
      `.last-deploy.json` = `{"deployedCommit":"abc1234def"}`, `GIT_COMMIT` unset → a child shell
      prints `abc1234def`; (b) `GIT_COMMIT=` (empty, as `.env.example` ships it) → same;
      (c) `GIT_COMMIT=feedbeef` set by the caller → stays `feedbeef`; (d) no `.last-deploy.json` →
      `GIT_COMMIT` stays empty and the output holds a warning naming `.last-deploy.json`.
- [ ] **Step 2:** `node --test scripts/compose-lib.test.mjs` → (a), (b), (d) red; (c) green.
- [ ] **Step 3: Implement** in `mc_compose_init`: when `${GIT_COMMIT:-}` is empty, read
      `deployedCommit` from `$ROOT_DIR/.last-deploy.json` with `node -e` (the runner image has no
      `jq`; `system-versions.sh:38` reads JSON the same way) and export it; when the file or the key
      is missing, `warn` once ("containers created now will report the commit as unknown").
      Comment: why (the pad's offline cache follows the commit), and that deploy/rollback override.
- [ ] **Step 4:** the lib tests green; `bash -n` on every `infra/scripts/*.sh`.
- [ ] **Step 5: Falsify** — delete the export line → (a)/(b) red, same collected count; restore,
      `cmp`.
- [ ] **Step 6: Gates** (`gates.sh … none`), commit:
      `fix(infra): a restart or a restore keeps the deployed commit, so the pad's offline cache follows it`.

Built differently (2026-11-20): the source is the deploy manifest through the existing owner
`mc_manifest_deployed_commit` (`lib/system-versions.sh:33`), the commit the API reports, not a
second reader of `.last-deploy.json`. No warning when none is recorded: `deploy.sh` would print it
after every wipe although it exports its own commit later; the lib then leaves `GIT_COMMIT` as the
caller had it. `redeploy.sh` was named here by mistake: it exports the checkout's HEAD
(`redeploy.sh:146-148`).

### Task 3 (after push and CI): deploy and live check, with the operator

- [ ] The operator's routine (wipe + deploy, 5 flags), after `sudo rm -r /srv/myclash` if the
      stray folder is still there.
- [ ] The operator: console → Run backup, then Restore from local of that backup (whole database).
      Over SSH before and after: `docker ps -a --format '{{.Names}} {{.CreatedAt}}'` — no container
      re-created (every CreatedAt unchanged), all 17 up; `ls /srv` shows no `myclash`; and
      `curl -s https://staff.myclash.fr/login | grep -o 'sw\.js?v=[a-z0-9]*'` names the deployed
      commit, not `unknown`.
- [ ] The operator pastes the `agent:` lines of the restore's log (the reseed's at the end).
- [ ] Closing commit: spec slice 4b "Left for later" gets the restore check done; this plan
      deleted; memory note; handoff.
