# Ops agent slice 4b — the disk prune, and slice 4's four minors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude's morning run (and the operator, from the console) can free disk space by emptying
Docker's build cache and removing dangling images; and slice 4's four named-not-fixed flaws are
closed.

**Architecture:** The ops runner gets `POST /disk/prune` beside its container actions (same ops lock,
same refusal during a deploy). The API's `AdminSystemActionsService.pruneDisk` is the one caller of
it: the console's Host card button and the agent door's `POST disk/prune` both go through it, and it
writes the audit row. The skill gets one repair row (disk `warning` or worse → `act prune`). Deploy,
redeploy and rollback wait for a running ops-runner job before they touch the stack.

**Tech Stack:** Node 26 ESM (`infra/ops-runner`, `.claude/skills/myclash-ops`), NestJS + Zod DTOs
(`apps/api`), Next.js client component (`apps/web-admin`), bash (`infra/scripts`), `node:test` and
vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-ops-agent-design.md` (§2 actions, §3 runner, §4 Named
race, slice 4b; rulings 884, 886, 887) plus rulings 895-898 below.

## Rulings this plan builds (operator, 2026-11-20; ask none again)

- **895** The run prunes when `runtime-health.disk.status` is `warning` or `critical` (80% by
  default), not only `critical`. The operator accepted that each prune makes the next deploy a cold
  build.
- **896** The prune runs while an Event is live too: it stops no container, and a full disk stops
  the scoring.
- **897** The console's system screen gets a "Free disk space" button too.
- **898** Fold in slice 4's four minors, each its own commit: the deploy-lock probe race, the stale
  round files, the dead `?? params.service`, and the deploy waiting for the ops lock.
- Not a new ruling, recorded so nobody "fixes" it: with the read-only switch on, the door's prune
  answers `503 read_only_mode` like every other door action
  (`read-only.interceptor.ts:20-26`); only a super admin on the console can prune then.

## My calls (check them)

1. **Dangling images only, not every unused image** (`docker image prune --force`, no `--all`).
   The design says "unused images". But `alpine:3` is the helper image of `backup.sh:106` and
   `restore.sh:83`, and no container uses it between runs: `--all` would delete it, and the next
   restore would need Docker Hub at the worst moment. What deploys leave behind is the old build of
   each image, which a rebuild untags: dangling. The build cache goes whole (`builder prune --all`),
   as the design says.
2. **The deploy waits; it does not take the ops lock.** The ops lock is a JSON file stamped with
   the runner's process id (`ops-lock.mjs`); the runner reclaims a stamp from any other process as
   stale, so a lock written by `deploy.sh` would be taken over at once. So the runner gets
   `GET /ops-lock` (its own in-memory view: held or not), and the three scripts that take
   `.deploy.lock` ask it through `docker exec`, before they move the checkout, and wait, at most
   10 minutes, while a job holds it. A runner that does not answer (stopped, or an old image without the route) does not
   block: nothing live can hold the lock then, and the deploy says so.
3. **The prune answers synchronously**, like a container action, under one budget below the
   API's wait (pinned by `infra:review`). Not a 202 operation: the operation runner writes backup
   history, and a prune is not a backup.
4. **The freed space is measured, not parsed:** free bytes of the runner's root (`statfs`) before
   and after, the same filesystem the disk health metric reads (`df ROOT_DIR`).

## Global Constraints

- Every user-facing string in `en` and `fr` (hard rule 6). No `t('k') || 'fallback'`.
- Never volumes. Never `docker system prune`. No compose flags on the prune: it acts on the host's
  Docker, as `destroy.sh --prune-cache` does (`destroy.sh:168`).
- A new door POST is filed in `public-routes.test.ts` (both lists), `archived-lock-ledger.ts`,
  `route-authz.test.ts`, `door.mjs` `DOOR_ROUTES`, and the OpenAPI client
  (`pnpm openapi:emit && pnpm openapi:client`). A new admin POST also in
  `platform-role-coverage.test.ts` as `super_admin`.
- Every fix is seen red first, then falsified (break lands, red, same collected count, restore).
- Test files stay under 400 lines; functions under 50 lines (`quality:complexity`).
- The runner's flock tests skip on Windows: run them in
  `docker run --rm -v <repo>:/w -w /w node:26-bookworm-slim node --test infra/ops-runner/container-actions.test.mjs`.
- Commit headers ≤ 100 characters; one task = one commit; stage explicit paths.

## Review Focus

1. **A prune during a deploy's build** would delete the cache the build is using: refused 409
   `deploy_running` (Task 4 test).
2. **A prune while a backup runs**: refused 409 `ops_busy`, never run beside it (Task 4 test).
3. **One step fails or times out**: the other still runs, `ok` is false, the console shows the
   reason and the skill counts a failed repair (Tasks 4, 6, 7 tests).
4. **The prune frees nothing** (the disk is full of data, not images): `freedBytes` 0, the
   after-read still `warning`, the run pushes; it does not try again (Task 7 test + skill text).
5. **A deploy starts while a worker restart is running** (up to 285 s): the deploy waits for it
   instead of recreating the runner under it (Task 8 test).

---

### Task 1: The door's container action loses its dead fallback

**Files:**

- Modify: `apps/api/src/modules/admin/system-actions.service.ts:61-64`
- Modify: `apps/api/src/modules/ops-agent/ops-agent.controller.ts:132-133`
- Test: `apps/api/src/modules/admin/system-actions.service.test.ts`

**Interfaces:** Produces `componentKeyForService(service: string): string`. It throws
`Error('<service> is not a restartable service')` for a service off the list.

- [ ] **Step 1: Write the failing test** `componentKeyForService names the key of a listed service, and throws for any other`.
      It asserts `componentKeyForService('supabase-rest') === 'postgrest'`, and that `'api'` and `''` throw
      `/not a restartable service/`. Change the existing assertion
      `componentKeyForService('db')).toBeUndefined()` (`system-actions.service.test.ts:253`) to the
      throw.
- [ ] **Step 2: Run it.** `pnpm --filter @myclash/api exec vitest run src/modules/admin/system-actions.service.test.ts`.
      Expected: FAIL (the function returns `undefined`).
- [ ] **Step 3: Implement.** The function throws on a miss. The controller line becomes
      `const key = componentKeyForService(params.service);`. Delete the comment that explains the `??`.
- [ ] **Step 4: Run it again**, plus `ops-agent.controller.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(api): the door's container action has no fallback that cannot fire`.

### Task 2: The deploy-lock probe never creates the lock file

**Files:**

- Modify: `infra/ops-runner/container-actions.mjs:158-173` (`createDeployRunning`)
- Test: `infra/ops-runner/container-actions.test.mjs`

**Interfaces:** `createDeployRunning(lockFile: string, { spawn } = { spawn: node's spawn }): () => Promise<boolean>`.
Signature for server.mjs is unchanged.

- [ ] **Step 1: Write the failing test** `the deploy probe locks an fd it opened read-only, never the path`.
      It injects a `spawn` double and asserts:
  - the argv is `['-n', '-E', '75', '3']`, with no path in it;
  - `stdio[3]` is a number (the fd);
  - a missing file answers `false` and calls no `spawn`.

  And, in Docker: `right after the probe answers free, a deploy can take the lock`. A second
  `flock -n <path> true` succeeds at once. Keep the existing held and free tests too.

- [ ] **Step 2: Run it** in the Docker command of the Global Constraints. Expected: FAIL (the argv
      holds the path).
- [ ] **Step 3: Implement.** `fs.promises.open(lockFile, 'r')`: `ENOENT` → `false`. Any other open
      error → `true` (the probe's rule: an unclear answer counts as held). Spawn `flock` on fd 3 with
      `stdio: ['ignore', 'ignore', 'ignore', handle.fd]`. Close Node's handle on the child's `spawn`
      event (and on `error`). An fd-mode lock lives as long as the open file description, so the child
      must hold its only reference: then the lock dies with `flock`, and a deploy's `flock -n 9` never
      meets it.
      Update the doc comment: the race is gone because the probe never creates the file (the path
      form of `flock(1)` uses `O_CREAT`).
- [ ] **Step 4: Run it** in Docker. Expected: PASS, the held and free tests too.
- [ ] **Step 5: Commit** `fix(ops-runner): the deploy probe locks a read-only fd, so it cannot create the lock`.

### Task 3: The round clears its old files first

**Files:**

- Modify: `.claude/skills/myclash-ops/door.mjs` (`runRound`, `main`)
- Test: `scripts/ops-skill.test.mjs`

**Interfaces:** `runRound(reads, { request, save, drop, note, deadline, now })`. `drop(name)`
deletes `<dir>/<name>.json` if it exists. `main` passes
``(name) => rm(path.join(dir, `${name}.json`), { force: true })``.

- [ ] **Step 1: Write the failing test** `a round drops every read's old file before it reads`.
      `drop` records the names it gets. A round that stops at `door-down` on its first read has still
      dropped all of `reads`, before the first `request`.
- [ ] **Step 2: Run it.** `node --test scripts/ops-skill.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Drop every read's file at the start of `runRound`, one after another.
      `main` also empties `act.txt` when it starts a round (`door.mjs:338-339` empties `round.txt`
      only). A run's repairs all come after its round, so a folder that outlived the last run cannot
      report that run's repairs as this run's.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(ops-skill): a round deletes the last round's files, so no old answer is read`.

### Task 4: The runner's prune

**Files:**

- Modify: `infra/ops-runner/container-actions.mjs` (new `runDiskPrune`, consts)
- Modify: `infra/ops-runner/server.mjs` (route `POST /disk/prune`; `freeBytes` dep)
- Modify: `scripts/check-infra-review.mjs` (pin the prune's bounds)
- Test: `infra/ops-runner/container-actions.test.mjs`

**Interfaces:**

- Deps gain `freeBytes(): Promise<number>`. server.mjs hoists one `freeBytes()` out of the upload
  sessions' closure (`server.mjs:101-104`) and passes it to both: one owner.
- `createContainerActions(deps).runDiskPrune(): Promise<DiskPruneResult>`, where `DiskPruneResult` is
  `{ ok, service: 'docker', action: 'prune', exitCode: number | null, timedOut, freedBytes, availBytes, stderr }`.
- Constants:
  - `PRUNE_STEP_TIMEOUT_MS = 140_000` for each step;
  - the steps, in order: `['builder', 'prune', '--all', '--force']`, then `['image', 'prune', '--force']`;
  - the lock kind is `'prune'`.

- [ ] **Step 0: Prove the CLI can do it.** The runner ships `docker-ce-cli` without the buildx
      plugin (`infra/ops-runner/Dockerfile:17-24`). There, `docker builder prune` is the CLI's own
      command, which calls the daemon's build-cache prune API. Build the runner image locally and run
      `docker run --rm --entrypoint docker <image> builder prune --help`. Expected: the usage text,
      with `--all` and `--force`. Never run a real prune on the operator's PC: other sessions share its
      Docker. The real effect is proven in the live check (Task 9).
- [ ] **Step 1: Write the failing tests:**
  - `a prune empties the build cache, then removes dangling images, under the lock`: asserts both
    argv lists exactly, in order, inside `withLock('prune', …)`, and that no argv holds `--volumes`,
    `system` or `-a` for `image`;
  - `a prune reports the space it freed`: `freeBytes` 10 then 25 → `freedBytes: 15`, `availBytes: 25`;
    10 then 8 → `freedBytes: 0`;
  - `a failed step does not stop the other`: the first step exits 1 → the second still runs,
    `ok: false`, `exitCode: 1`;
  - a step times out → `timedOut: true`, `ok: false`;
  - `a prune is refused while a deploy runs`: 409 `deploy_running`, and no `run` call;
  - `a held ops lock refuses a prune`: the `withLock` double throws `OpsLockBusyError`, which reaches the caller.
- [ ] **Step 2: Run them** (Docker command). Expected: FAIL (`runDiskPrune` is not a function).
- [ ] **Step 3: Implement** `runDiskPrune` and the route
      `if (req.method === 'POST' && url.pathname === '/disk/prune') sendJson(res, 200, await containerActions.runDiskPrune());`.
      The result carries the last 4000 characters of both steps' stderr. Update the module's top comment
      (container actions, renewal, prune).
- [ ] **Step 4: Run the tests** in Docker. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ops-runner): POST /disk/prune empties the build cache and dangling images`.

### Task 5: The API's prune: one service method, the console's route, the door's route

**Files:**

- Modify: `apps/api/src/modules/admin/system-actions.service.ts` (`pruneDisk`, `PRUNE_WAIT_MS`, `DiskPruneResult`)
- Modify: `apps/api/src/modules/admin/host-info.controller.ts` (`POST prune`)
- Modify: `apps/api/src/modules/ops-agent/ops-agent.controller.ts` (`POST disk/prune`, the top comment: four actions)
- Modify: `apps/api/src/common/auth/public-routes.test.ts` (door list and `AGENT_DOOR_POSTS`)
- Modify: `apps/api/src/common/testing/archived-lock-ledger.ts` (both routes)
- Modify: `apps/api/src/common/auth/route-authz.test.ts:63` (method `pruneDisk`)
- Modify: `apps/api/src/modules/admin/guards/platform-role-coverage.test.ts`
  (`['POST /admin/system/host-info/prune', 'super_admin']`)
- Modify: `.claude/skills/myclash-ops/door.mjs` `DOOR_ROUTES` (`'POST disk/prune'`)
- Modify: `scripts/check-infra-review.mjs` (pin the prune's bounds)
- Regenerate: `packages/api-client/src/generated/schema.ts`
- Test: `system-actions.service.test.ts`, `ops-agent.controller.test.ts`, `ops-agent.http.test.ts`

**Interfaces:**

- `AdminSystemActionsService.pruneDisk(actorUserId: string): Promise<DiskPruneResult>`:
  - `DiskPruneResult` is `{ ok: boolean; exitCode: number | null; timedOut: boolean; freedBytes: number; availBytes: number; stderr: string }`
    (the runner always sends every field, so the console has no "Freed —");
  - it calls `this.ops.post('/disk/prune', {}, PRUNE_WAIT_MS)`, with `const PRUNE_WAIT_MS = 295_000;`;
  - its audit row: action `system.disk.prune`, entity `system_disk` / `docker`, payload `{ ok, exitCode, timedOut, freedBytes }`.
- Console: `HostInfoAdminController.prune(@Req() req)` → `POST /api/v1/admin/system/host-info/prune`.
  It is `@HttpCode(HttpStatus.OK)`, needs a super admin by the guard's default for a POST, and
  answers `DiskPruneResult`.
- Door: `OpsAgentController.pruneDisk(@AgentActor() actor)` → `POST /api/v1/ops-agent/disk/prune`.
  It is `@HttpCode(OK)` with `@Throttle(AGENT_ACTION_THROTTLE)`, and answers
  `maskActionResult(result, 'docker', 'prune')`.

- [ ] **Step 1: Write the failing tests:**
  - service: posts `/disk/prune` with `PRUNE_WAIT_MS`; writes one audit row with the exact action,
    entity and payload (assert the insert payload, not only the call); a runner 409 `ops_busy`
    reaches the caller with its code (copy the renewal's refusal test);
  - door controller: answers exactly
    `{ ok, service: 'docker', action: 'prune', exitCode, timedOut, scheduled: false }`, with no
    `stderr`, `freedBytes` or `availBytes`;
  - http: a stranger and a login token get 401 on the door route, and a non-super-admin gets 403 on
    the console route.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, then file both routes in every register of the Files list.
- [ ] **Step 3b: Pin the bounds.** In `scripts/check-infra-review.mjs`, read
      `PRUNE_STEP_TIMEOUT_MS` (runner) and `PRUNE_WAIT_MS` (API) as the worker chain does
      (`:1178-1205`). The check requires 2 × step < wait < 300 s, and has its own message: "the prune's
      runner budget must end before the API stops waiting, and the API's wait before undici's 300 s".
      Seen red first: set `PRUNE_WAIT_MS` to 270_000, then restore it.
- [ ] **Step 4: Regenerate the client:** `pnpm openapi:emit && pnpm openapi:client`.
- [ ] **Step 5: Run** the three test files, `public-routes.test.ts`, `route-authz.test.ts`,
      `platform-role-coverage.test.ts`, the archived-lock routes test,
      `node --test scripts/ops-skill-act.test.mjs` (DOOR_ROUTES parity, `:236`), and
      `pnpm infra:review`. Expected: PASS. Also add `system_disk` to the "deliberately absent" list of
      `apps/api/src/modules/entity-label/entity-label-specs.ts:236`, beside `system_tls`.
- [ ] **Step 6: Commit** `feat(api): the console and the agent door free disk space through one service`.

### Task 6: The console's "Free disk space" button

**Files:**

- Create: `apps/web-admin/app/admin/system-versions/disk-prune.ts` (pure)
- Create: `apps/web-admin/app/admin/system-versions/disk-prune.test.ts`
- Create: `apps/web-admin/app/admin/system-versions/DiskPruneButton.tsx`
- Modify: `apps/web-admin/app/admin/system-versions/HostInfoCard.tsx` (header: the button beside Refresh)
- Modify: `packages/i18n/src/messages/en/admin.ts`, `.../fr/admin.ts` (`admin.systemVersions.host.prune.*`)

**Interfaces:**

- `diskPruneOutcome(r: ApiResult<DiskPruneResult>, t): { tone: 'success' | 'error'; message: string }`
  (`disk-prune.ts`):
  - success: `prune.success` with `{ size: formatBytes(freedBytes) }`;
  - an `ops_busy` or `deploy_running` refusal: `prune.failed` with `systemActionRefusal`'s text;
  - `!result.ok`: `prune.failed` with the trimmed `stderr`, or `admin.common.dockerComposeTimedOut`,
    or `admin.common.componentActionFailed`;
  - any other failure: `failureMessage`.
- `DiskPruneButton({ onDone }: { onDone: () => void })`: the button, then a `ConfirmDialog`
  (`danger`, `busy`), then one `apiRequest` POST and a toast. `onDone` re-reads the Host card.
  Mirror `TlsCertificatesCard.tsx:134-201, 259-269`.
- Strings (en / fr):
  - `button`: "Free disk space" / "Libérer de l'espace disque";
  - `confirmTitle`: "Free disk space?" / "Libérer de l'espace disque ?";
  - `confirmDescription`: "This deletes Docker's build cache and the old images no container uses.
    No container stops. The next deploy rebuilds every image from the start, so it takes longer." /
    "Cela supprime le cache de construction de Docker et les anciennes images qu'aucun conteneur
    n'utilise. Aucun conteneur ne s'arrête. Le prochain déploiement reconstruit toutes les images
    depuis le début : il prend plus de temps.";
  - `confirm`: "Free disk space" / "Libérer de l'espace";
  - `success`: "Freed {size}." / "{size} libérés.";
  - `failed`: "Could not free disk space: {message}" / "Impossible de libérer de l'espace disque : {message}".

- [ ] **Step 1: Write the failing tests** in `disk-prune.test.ts`, one per branch above. Each
      asserts the exact key and its values (a `t` double that echoes `key|json`).
- [ ] **Step 2: Run them.** `pnpm --filter web-admin exec vitest run app/admin/system-versions/disk-prune.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement** the pure function, the component and the strings. Then rebuild
      `@myclash/i18n` (the console's tests read its `dist`).
- [ ] **Step 4: Run** the test, the i18n key sweep (`pnpm --filter @myclash/i18n test`) and the
      web-admin typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web-admin): the Host card's Free disk space button`.

### Task 7: The skill prunes on a disk symptom

**Files:**

- Modify: `.claude/skills/myclash-ops/door.mjs` (`parseAct`, `runAct`, a `pruneAfter`, the usage lines)
- Modify: `.claude/skills/myclash-ops/SKILL.md` §7
- Test: `scripts/ops-skill-act.test.mjs`

**Interfaces:**

- `parseAct(['prune', dir])` → `{ kind: 'prune', dir }`.
- `runAct` posts `disk/prune` with `CONTAINER_ACTION_TIMEOUT_MS`. A gateway 5xx with no code is read
  as "cut on the way", as for a container action.
- `pruneAfter` reads `runtime-health` once and prints `after <disk.status> <disk.usePercent>%`, or
  `after unknown`.

- [ ] **Step 1: Write the failing tests:**
  - `act prune posts disk/prune and reads the disk after`: the double answers 200, then a
    runtime-health with `disk: { status: 'healthy', usePercent: 61 }` → lines
    `200 act prune`, `after healthy 61%`, `end done`;
  - a 409 `ops_busy` → `end refused-ops_busy`, and no read after;
  - a 504 with no code → the after-read still runs;
  - a cut with no status at all (a socket hang-up) → the after-read still runs. `door.mjs:288`
    ends a non-container action `unreachable` today: the prune joins the container action's
    "cut on the way" rule (`:295`);
  - `parseAct(['prune'])` throws a usage error.
- [ ] **Step 2: Run them.** `node --test scripts/ops-skill-act.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement**, then SKILL.md §7:
  - a row: "`runtime-health.disk.status` is `warning` or `critical`" → `act prune` → "yes" while an
    Event is live (ruling 896);
  - the command `node .claude/skills/myclash-ops/door.mjs act prune /tmp/myclash-ops`;
  - Healed: "`after healthy …` for a prune";
  - a note: a prune that leaves the disk at `warning` or worse is a failed repair (the disk holds
    data, not images): a problem, push. Never prune twice in one run.

  - the live-Event bullet (`SKILL.md:171`): "act only on the rows marked "yes" (a dead container,
    or a full disk)". Without that, a literal model holds the prune back during an Event;
  - §4's `runtime-health.overall` row: a disk `warning` is a repair (§7), not only a note.

  Re-read the row the way a literal model would: `unavailable` is not a symptom.

- [ ] **Step 4: Run** both skill test files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ops-skill): the run frees disk space when the disk reads warning or worse`.

### Task 8: Deploy, redeploy and rollback wait for a running runner job

**Files:**

- Modify: `infra/ops-runner/ops-lock.mjs` (`readOpsLockState`)
- Modify: `infra/ops-runner/server.mjs` (`GET /ops-lock`)
- Create: `infra/ops-runner/ops-lock-probe.mjs`
- Create: `infra/scripts/lib/ops-jobs-wait.sh` (`mc_wait_for_ops_jobs`)
- Modify: `infra/scripts/deploy.sh`, `redeploy.sh`, `rollback.sh`
- Modify: `docs/superpowers/specs/2026-11-18-ops-agent-design.md` §4 "Named race"
- Test: `infra/ops-runner/ops-lock.test.mjs`, create `infra/ops-runner/ops-lock-probe.test.mjs`,
  create `scripts/ops-jobs-wait-lib.test.mjs`

**Interfaces:**

- `readOpsLockState(rootDir, now = Date.now()): Promise<{ held: boolean; kind: string | null; since: string | null }>`.
  `held` is true only for `inspectOpsLock`'s `held` verdict. A missing or stale file gives
  `{ held: false, kind: null, since: null }`.
- Route: `GET /ops-lock` → 200 with that object.
- `describeOpsLock({ status, body, error }): string` (`ops-lock-probe.mjs`) gives exactly one line:
  - `free`;
  - `held <kind> <since>`, with `unknown` for a null kind or since (a lock being written has
    `kind: null`, `ops-lock.mjs:91`);
  - `unknown <reason>`, where the reason is `unreachable`, `status-<n>` or `bad-answer`.

  Run as `node infra/ops-runner/ops-lock-probe.mjs` inside the runner. It GETs
  `http://localhost:4075/ops-lock` with `OPS_RUNNER_SECRET`, with a 5 s timeout, and always exits 0.
  The runner's working dir is the repo's bind mount (`docker-compose.prod.yml:924, 939`), so even
  an old runner image runs the new probe file; the old server answers 404 → `unknown status-404`.

- `mc_wait_for_ops_jobs` (needs no `COMPOSE` and no `.env`):
  - it asks every `MC_OPS_POLL_S` (default 5) for at most `MC_OPS_WAIT_S` (default 600) seconds,
    with `timeout 30 docker exec myclash-ops-runner node infra/ops-runner/ops-lock-probe.mjs`
    (`container_name` is fixed, `docker-compose.prod.yml:922`). It reads stdout only and keeps its
    last line: Docker's warnings on stderr are never the answer;
  - a failed or timed-out exec (the runner is not running: every wipe deploy) prints the info line
    "No ops-runner job to wait for: the runner is not running." and returns 0;
  - `free` returns 0 with no output;
  - `unknown …` warns "Could not ask the ops runner about its jobs (<line>); going on." and returns 0;
  - `held` prints "Waiting for the ops runner's <kind> (since <since>) to end…" once;
  - past the wait: `err` "The ops runner's <kind> still holds its lock after 10 min. Run this again when it has ended." and exit 1.

- [ ] **Step 1: Write the failing tests:**
  - `ops-lock.test.mjs`: held while `withOpsLock` runs; free after; a foreign-instance file → free;
  - `ops-lock-probe.test.mjs`: each line above from its input;
  - `ops-jobs-wait-lib.test.mjs` (Git Bash, as `ops-agent-seed-lib.test.mjs`): a fake `docker`
    first on `PATH` prints scripted lines. Cases:
    - free;
    - held then free (the wait line once, exit 0);
    - held forever with `MC_OPS_WAIT_S=1` (exit 1, the message);
    - exec fails (the info line, exit 0);
    - `unknown status-404` (the warning, exit 0);
    - a stderr warning before `free` (no output, exit 0).

    Plus a static test: each of the three scripts sources the lib and calls `mc_wait_for_ops_jobs`
    after it takes `.deploy.lock`, and before it moves the checkout (`mc_pull_then_reexec`,
    `git reset`) and before its first `"${COMPOSE[@]}"` call of any kind (rollback.sh's first is a
    `stop`, `:112`).
- [ ] **Step 2: Run them** (`node --test …`). Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In each script: right after it takes `.deploy.lock` and sets its EXIT trap. That is
    `deploy.sh:383-394`, before `hdr "Updating code from git"` (`:400`); `redeploy.sh:122`, before
    its pull (`:137`); `rollback.sh:53-58`. The checkout must not move under a running backup or
    restore: each of its `"${COMPOSE[@]}"` calls re-reads the bind-mounted compose file (the
    ruling-400 failure, new compose file with an old `.env`). And a wait that runs out then leaves
    nothing changed. deploy.sh's re-exec run asks again; its answer is immediate.
  - Each script's comment names the race: an action that started before `.deploy.lock` was taken
    would run beside the rebuild.
  - Spec §4: replace "Left open: …" with what is built.
- [ ] **Step 4: Run them**, then `pnpm infra:review` and the runner suite in Docker. Expected: PASS.
- [ ] **Step 5: Commit** `fix(infra): deploy, redeploy and rollback wait for a running ops-runner job`.

### Task 9: Gates, review, live check, closing docs

- [ ] **Step 1:** `gates.sh` (the whole `myclash-gates` chain). Re-point the complexity baseline
      only for this slice's files.
- [ ] **Step 2:** A fresh whole-slice review on the most capable model. One fix pass, each fix red
      then green. Gates again. Push. CI green.
- [ ] **Step 3:** The operator redeploys (wipe + 5 flags) — ops-runner must be rebuilt.
- [ ] **Step 4:** The live check, through the throwaway routine:
  - before and after the first prune, over watched SSH:
    `ssh myclash-ops "sudo -n -u <operator> docker system df"`. The build cache line must drop to
    0 B. That proves the runner's CLI reached the host's cache;
  - `act prune` → `200 act prune`, an `after` line, and the console audit row "system.disk.prune"
    by "Claude (ops agent)";
  - the console button → a "Freed …" toast;
  - a deploy started while a worker restart runs prints the wait line;
  - **after the first prune**, compare the free space and check that the next deploy still builds.
- [ ] **Step 5:** Closing commit:
  - the spec: a "Slice 4b rulings" block (895-898), slice 4b Done, calls 1-4 above recorded;
  - ARCHITECTURE §17.8: the prune, `/ops-lock` and the wait;
  - this plan deleted;
  - then the memory note and the handoff.

## Named, not fixed (out of this slice)

- Images pinned by version (`docker-compose.prod.yml:23-522`: Traefik, Supabase, Redis) stay tagged
  after a version bump, so the dangling-only prune keeps the old version. That is a few hundred MB
  per bump, removable by hand.

- A backup or restore started from the console, or by the night's schedule, while a deploy runs is
  not refused. Ruling 887 covers container actions and renewal only.
- The worker's 300 s request path through the cloud proxy and Traefik is still unproven. A prune
  near its 280 s budget would be the same path.
