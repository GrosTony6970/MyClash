# Ops agent slice 4 — repairs on the door — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude's key can restart or start one listed container, run a backup and renew the
certificates, each with an audit row under Claude's account; the door says whether an Event is
live; the morning run repairs on a matching symptom, holds back during a live Event, a deploy or an
on-purpose stop, and pushes when a repair fails.

**Architecture:** The door (`apps/api/src/modules/ops-agent/`) gains one read and three actions.
Each action calls the admin service that already owns it; those services move onto the API's one
road to the ops runner (`OpsRunnerClient`), so a "busy" refusal reaches the caller as a 409. The
ops runner runs container actions and renewal under its ops lock, refuses them while a deploy
runs, answers a busy backup with 409, answers a renewal before it restarts Traefik, and caps its
log reads. `door.mjs` gains `act`; the skill gains its repair rules. Restore and rollback re-run
the key seed.

**Tech Stack:** NestJS 11 + Fastify, Supabase JS (service role), Node ESM ops runner, bash infra
scripts, `node:test` for `scripts/*.test.mjs` and `infra/ops-runner/*.test.mjs`, Vitest for the API.

**Spec:** `docs/superpowers/specs/2026-11-18-ops-agent-design.md` (§2 "Actions", "When Claude may
repair", §4 "Named race", rulings 864, 876-887).

## Rulings this slice carries (operator, 2026-11-19; ask none again)

- **882** An Event is live when ANY sign holds: its status is `running`; a bout of it is in play
  (`running` or `paused`); today, in the Event's own timezone, falls between its start and end
  dates. Every sign counts for an Event that is not over (`draft`, `published`, `running`); none
  counts for a `completed` or `archived` one.
- **883** Test Events (`event_kind = 'test'`) never count as live. Club Events do.
- **884** The disk prune (build cache + unused images) is its own slice, "4b", after slice 4.
- **885** (M1) After a restore or a rollback that put a database back, the scripts run the key seed
  again: only the key whose hash matches `OPS_AGENT_KEY` in `.env` stays live; an empty value
  revokes every key. A console revoke alone lasts until the next restore, and the script says so.
- **886** Every ops runner job blocks a container action or a renewal: a backup, a restore, an
  upload, a delete, another container action, a renewal. The console's buttons too (one runner
  route serves both). The design's §4 "Named race" assumed the lock; it was missing
  (`server.mjs:229-235`, `:834-849`).
- **887** Claude leaves an on-purpose stop alone: it starts only a container that crashed (an exit
  code other than 0 and 143); a container stopped on purpose is a note. Claude does nothing while a
  deploy holds `.deploy.lock`, nor in the 15 minutes after the last deploy.

## Decisions taken in recon (the operator may override)

- **D2** `POST /operations/backup` answers 409 `ops_busy` when the lock is held. Today it answers
  202 and the operation fails a moment later (`operation-runner.mjs:43-57`); the backups screen
  reads that failure by polling (`backups/page.tsx:205-224`). The restore route keeps its 202.
- **D3** `AdminSystemActionsService` stops calling the runner itself and uses `OpsRunnerClient`
  (two roads today; the second flattens a 409 into a scrubbed 503,
  `system-actions.service.ts:155-170`).
- **D4** A backup started from the console now writes an audit row too (`system.backup.run`): the
  audit belongs to the service both callers use.
- **D5** "Dead" (ruling 864) = the container is not `running`, or Docker's healthcheck says
  `unhealthy`. "Degraded" = the container runs and is not `unhealthy`, but a health read names its
  part `critical` or `unavailable`. Only `redis` maps from a health metric to a restartable
  container; `database`, `disk` and `photoStorage` have no repair on the door.
- **D6** A failed repair is a problem, so it takes slice 3's existing push line. No new push text.
- **D7** The platform's read-only switch keeps refusing the door's actions: `ReadOnlyInterceptor`
  lets a non-GET through for a super admin only (`read-only.interceptor.ts:49-64`), and the key is
  none. The run reads `503 read_only_mode` as "held back: the platform is read-only". The symptom
  stays a problem. The admin lockdown does not touch `/ops-agent/` (`lockdown.interceptor.ts:11`).
- **D8** A worker action can take up to 295 s on the API side (`system-actions.service.ts:88-94`)
  and sends no byte meanwhile. `door.mjs` gives a container action a 300 s request timeout, not the
  reads' 60 s. A cut connection is not a failed repair: the after-read still runs and decides.
- **D9** A renewal restarts Traefik, which carries the request that asked for it: Traefik's 10 s
  grace (no override in the repo) drops the answer. The runner takes the lock, answers
  `{ ok: true, scheduled: true, … }`, restarts Traefik 3 s later and then releases the lock. The
  console's success text says the restart is coming, not done. The result is judged by the `tls`
  read after.

## Global Constraints

- Every action writes one audit row; its actor is the agent key's `user_id` (design §2).
- Never reachable with the key: restore, delete a backup, **stop** a container, accounts, roles,
  passwords, lockdown/read-only switches, backup download, any roster or person list (design §2).
- The door answers no stdout, stderr, log tail or error text from an action: an allow-list per
  answer, like `maskBackups`.
- The restartable list stays ONE list on each side: `RESTARTABLE_SERVICES` (runner) mirrored by
  `RESTARTABLE_COMPONENTS` (API), held equal by a test. The door derives its list from the API's.
- A 5xx whose code the run must read is an `OperationalUnavailableException` with a code
  (ruling 876's shape).
- Strings in `en` and `fr` (hard rule 6). No `node -` / heredoc for our own scripts.
- A new write route is filed in `archived-lock-ledger.ts`; new door routes regenerate the client
  (`pnpm openapi:emit && pnpm openapi:client`).
- A test file over 400 lines fails `quality:complexity`: split it (`scripts/ops-skill.test.mjs` is
  335 lines today).
- Every new DB read asserts its select string and its filters (the doubles ignore both).

## Review Focus

1. **A club Event, or a bout in play in a `draft` Event** → live (Task 5).
2. **A bout left `paused` in an Event that is `completed` or `archived`** → does not count
   (`isOver`); one left paused in a `published` Event does count. This is the safe direction
   (Task 5).
3. **The live read fails** (the database is down) → 503 `EVENTS_UNREADABLE`. The skill treats an
   unknown answer as live (Tasks 5, 7).
4. **Two runs act at once** (an alert and a later deploy run): the second action meets the lock →
   409 `ops_busy` → `door.mjs` prints `409 ops_busy`, the skill does not retry (Tasks 2, 4, 7).
   `CODE_WORD` is uppercase-only today (`door.mjs:47`): widen it to `[A-Za-z0-9_]`.
5. **A restore through the console** runs `restore.sh` inside the ops runner container (`.env`
   via the `../:/srv/myclash` mount, `node` and Compose in the image). The seed must run there and
   must never turn a restore that worked into a failed one (Task 1).

---

### Task 1: The key seed runs after a restore or a rollback (ruling 885, M1)

**Files:**

- Create: `infra/scripts/lib/ops-agent-seed.sh`
- Modify: `infra/scripts/deploy.sh:778-799`, `infra/scripts/restore.sh` (after `ok "Restarted"`,
  `:461`), `infra/scripts/rollback.sh` (sources at the top; call after `ok "Stack started"`,
  `:178`), `infra/ops-runner/restore-script-run.test.mjs:86-89, 169, 213, 311`
- Test: `scripts/ops-agent-seed-lib.test.mjs`

**Interfaces:**

- Produces: `mc_seed_ops_agent` (bash). Needs `COMPOSE` (from `mc_compose_init`) in scope. It
  sources `lib/database-url.sh` in a subshell itself, so a missing `POSTGRES_PASSWORD` is a `warn`,
  never an exit of its caller (`:?` at `database-url.sh:10` is not caught by `|| true`). Prints the
  same `ok`/`warn` lines deploy prints today. Returns 0 always.

- [ ] **Step 1: Write the failing test** `scripts/ops-agent-seed-lib.test.mjs` (node:test, reads the
      sources as text, the style of `scripts/compose-lib.test.mjs`):
  - `deploy.sh`, `restore.sh` and `rollback.sh` each source `lib/ops-agent-seed.sh` and call
    `mc_seed_ops_agent`; none of them still names `bootstrap-ops-agent.mjs`.
  - In `restore.sh` the call comes after `ok "Restarted"`, inside a branch that runs only when
    `STORAGE_ONLY` is not 1.
  - In `rollback.sh` the `source` line comes before `git reset --hard` (`:159` resets the tree: a
    lib sourced after it is read from the old commit, where it may not exist), and the call comes
    after `ok "Stack started"` under `[[ "$BACKUP_FILE" != "none" && -f "$BACKUP_FILE" ]]`
    (`:117`).
  - Both print, with `warn`, this exact line: "agent: a key revoked on the console after this
    backup was taken is live again if OPS_AGENT_KEY still holds it. To turn the agent off for good,
    empty OPS_AGENT_KEY in .env and run deploy.sh."
  - A run of `mc_seed_ops_agent` under `set -Eeuo pipefail` with no `POSTGRES_PASSWORD` and a
    stub `COMPOSE` (`bash -c`, the way `compose-lib.test.mjs` runs its lib) exits 0 and prints a
    `warn`.
- [ ] **Step 2: Run** `node --test scripts/ops-agent-seed-lib.test.mjs` → FAIL (no lib file).
- [ ] **Step 3: Implement** — move deploy's block (`hdr` + `run --rm … bootstrap-ops-agent.mjs` +
      the `case`) into `mc_seed_ops_agent`; deploy calls it. Restore and rollback call it, then
      print the line. When the seed's state is `failed` after a restore, the `warn` also says that
      the login service may still be starting and that the next `deploy.sh` seeds the key again
      (the revoke of other keys runs before any GoTrue call, `bootstrap-ops-agent.mjs:86`).
      `restore-script-run.test.mjs`: the sandbox `.env` gets `POSTGRES_PASSWORD`; the three "last
      Docker call is `up -d`" assertions become "`up -d` comes before the seed's `run`"; one new
      case: `--storage-only` makes no seed call. Register the lib where `compose-lib.test.mjs` /
      `infra:review` list the libs.
- [ ] **Step 4: Run** `node --test scripts/ops-agent-seed-lib.test.mjs infra/ops-runner/restore-script-run.test.mjs`
      → PASS; `pnpm infra:review` → PASS.
- [ ] **Step 5: Falsify** — move restore's call above the restore; move rollback's `source` below
      `git reset`; drop the subshell. Each red, same collected count, restored.
- [ ] **Step 6: Commit** `fix(ops-agent): a restore or a rollback seeds the agent key again (ruling 885)`.

### Task 2: The ops runner — actions under the locks, a busy backup is a 409, renewal answers first

**Files:**

- Create: `infra/ops-runner/container-actions.mjs`, `infra/ops-runner/container-actions.test.mjs`
- Modify: `infra/ops-runner/server.mjs:109-128, 188-203, 229-236, 780-849`,
  `infra/ops-runner/operation-runner.mjs`, `infra/ops-runner/operation-runner.test.mjs`,
  `scripts/check-infra-review.mjs` (the four pins at `:1149`, `:1178-1188`, `:1208-1218` move
  file; the compose-arguments text pin follows the new parameter name)

**Interfaces:**

- Produces: `RESTARTABLE_SERVICES` (moved, same 12 names), `WORKER_ACTION_TIMEOUT_MS` (moved, same
  value and line text), `createContainerActions({ run, withLock, deployRunning, schedule, composeFlags })`
  → `{ runContainerAction(service, action), runCertRenewal() }`.
  - `withLock(kind, fn)` is `withOpsLock(ROOT_DIR, { kind, onReclaim }, fn)`; kinds `container`
    and `renew-certs` (ruling 886).
  - `deployRunning(): Promise<boolean>`: `.deploy.lock` exists under the root AND
    `flock -n <file> true` exits non-zero. Never creates the file (a root-owned lock file would stop
    the next deploy from opening it). While true, both actions throw a refusal
    `409 deploy_running` (ruling 887).
  - `runContainerAction` answers as today. `runCertRenewal` takes the lock, answers
    `{ ok: true, scheduled: true, service: 'traefik', action: 'renew-certs', exitCode: null, timedOut: false }`,
    then `schedule(3_000, …)` restarts Traefik and releases the lock (D9).
- Produces: `startOrRefuse(runner, kind, createCommand, body?)` in `operation-runner.mjs`: awaits
  `started`; `'busy'` → throws `OpsLockBusyError`; otherwise returns the operation (D2).

- [ ] **Step 1: Write the failing tests.**
  - `container-actions.test.mjs`:
    - with a `withLock` that throws `OpsLockBusyError`, `runContainerAction('worker','restart')`
      rejects with `statusCode 409, code 'ops_busy'` and `run` is never called; same for
      `runCertRenewal()`;
    - with `deployRunning` true → `409 deploy_running`, no lock taken, `run` never called;
    - with a passing `withLock`, the action runs inside it (`withLock` called with `'container'`),
      and the compose args are today's (`['compose', ...flags, 'restart', '-t', '270', 'worker']`);
    - `runCertRenewal()` resolves `scheduled: true` before `run` is called; the scheduled step
      runs `['compose', ...flags, 'restart', 'traefik']` and the lock is released after it, also
      when it fails;
    - `db`, `api`, `traefik`, `ops-runner` → `{ ok: false, error: 'service_not_allowed' }` with
      no lock taken;
    - parity: `RESTARTABLE_SERVICES` equals the values of the API's `RESTARTABLE_COMPONENTS`
      (import the TS file through tsx, as `container-logs.test.mjs` does).
  - `deployRunning`: a real temp file held by `flock` in a child → true; the file present and free
    → false; absent → false and still absent afterwards.
  - `operation-runner.test.mjs`: `startOrRefuse` with the lock held → rejects `OpsLockBusyError`;
    free → resolves the operation, status `running`.
- [ ] **Step 2: Run** `node --test infra/ops-runner/container-actions.test.mjs infra/ops-runner/operation-runner.test.mjs`
      → FAIL. (`flock` tests: skip with a stated reason where `flock` is absent, e.g. Windows; CI
      runs them on Linux.)
- [ ] **Step 3: Implement** — move `runContainerAction`, `runCertRenewal`, the two lists and the
      timeouts out of `server.mjs` (it cannot be imported: it listens at the top); validation stays
      before the locks. `server.mjs` routes call the module; the backup route sends
      `202 { operation: await startOrRefuse(...) }`; a thrown refusal reaches `sendError` as today
      (409 + code). Point the infra:review pins at the new file.
- [ ] **Step 4: Run** the tests → PASS; `pnpm infra:review` → PASS.
- [ ] **Step 5: Falsify** each guard: remove the `withLock` wrap; drop the `deployRunning` check;
      answer the renewal after the restart; replace `startOrRefuse` with the old
      `startOperation(...).operation`. Red each time, same count, restore.
- [ ] **Step 6: Commit** `fix(ops-runner): container actions and renewal take the ops lock and wait for a deploy (rulings 886, 887)`.

### Task 3: The ops runner — one log read at a time, its capture capped (carried item)

**Files:**

- Create: `infra/ops-runner/spawn-capture.mjs`, `infra/ops-runner/spawn-capture.test.mjs`
- Modify: `infra/ops-runner/server.mjs:851-881`, `infra/ops-runner/container-logs.mjs:78-96, 123-151`,
  `infra/ops-runner/container-logs.test.mjs`

**Interfaces:**

- Produces: `spawnCaptureWithTimeout(command, args, timeoutMs, { maxChars } = {})` — moved from
  `server.mjs`; with `maxChars`, stdout keeps only its LAST `maxChars` characters as it grows, and
  the result carries `capped: true` when anything was dropped.
- Produces: `LOG_CAPTURE_MAX_CHARS = 4_194_304` and the refusal `409 log_read_busy` in
  `container-logs.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - `spawn-capture.test.mjs`: `process.execPath` with a script file printing 10,000 `x` then `END`,
    `maxChars: 100` → `stdout.length <= 100`, it ends with `END`, `capped: true`. Race the test's
    own timer (a broken cap must not hang the run).
  - `container-logs.test.mjs`: two `readContainerLog` calls at once with a `run` that waits on a
    promise → the second rejects `statusCode 409, code 'log_read_busy'`; after the first settles
    (also when it throws) a third call runs. `run` receives `{ maxChars: LOG_CAPTURE_MAX_CHARS }`.
    A capped capture whose first line is `…@example.com +33 6 12 34 56 78` (cut inside) → that
    line is not in the answer (the module's rule: a cut never keeps half a secret,
    `container-logs.mjs:5-7`).
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** — a module-level `inFlight` flag around the compose call in
      `readContainerLog`, released in `finally`; `compose()` passes the cap; `boundLogLines` drops
      the first line when `capped`. `readContainers` is not gated.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Falsify** the flag, the cap and the first-line drop, one at a time. Restore.
- [ ] **Step 6: Commit** `fix(ops-runner): one log read at a time, and its capture is capped`.

### Task 4: The API — one road to the runner, a busy action is a 409, a backup is audited (D2-D4, D9)

**Files:**

- Modify: `apps/api/src/modules/admin/ops-runner-client.ts`,
  `apps/api/src/modules/admin/system-actions.service.ts`,
  `apps/api/src/modules/admin/backups.service.ts:87-89`,
  `apps/api/src/modules/admin/backups.controller.ts:79-80`,
  `apps/api/src/modules/admin/admin.module.ts:151, 196-204` (inject `SupabaseService` into the
  backups factory; export `AdminSystemActionsService`),
  `apps/api/src/common/operational-exception.ts:9` (the comment quotes the old text),
  `apps/web-admin/app/admin/system-versions/page.tsx:138-145`,
  `apps/web-admin/app/admin/system-versions/TlsCertificatesCard.tsx:141-160`,
  `apps/web-admin/app/admin/backups/page.tsx:237-245`,
  `packages/i18n/src/messages/{en,fr}/admin.ts`
- Test: `system-actions.service.test.ts`, `backups.service.test.ts`, the console tests beside the
  three pages (create one where none exists)

**Interfaces:**

- Produces: `OpsRunnerClient.request<T>(route, init, timeoutMs = OPS_RUNNER_TIMEOUT_MS)`;
  `get<T>(route, timeoutMs?)`, `post<T>(route, body, timeoutMs?)`. Not-configured text:
  `This action requires the ops runner.` Per-call budgets: a worker action 295,000 ms
  (`WORKER_ACTION_WAIT_MS`), any other container action and the renewal 35,000 ms
  (`DEFAULT_OPS_TIMEOUT_MS`), disk 35,000 ms, host 8,000 ms (`HOST_INFO_TIMEOUT_MS`).
- Produces: `AdminBackupsService.triggerBackup(actorUserId: string)` writes
  `{ action: 'system.backup.run', entityType: 'system_backup', entityId: <operation id>, payload: { status } }`.
- Unchanged signatures: `runComponentAction(componentKey, action, actorUserId)`,
  `renewCertificates(actorUserId)`, `getDiskUsage()`, `getHostFacts()`.
- Produces, from `system-actions.service.ts`: `RESTARTABLE_SERVICES` as a non-empty `as const`
  tuple equal to the values of `RESTARTABLE_COMPONENTS`, and
  `componentKeyForService(service: string): string | undefined`.

- [ ] **Step 1: Write the failing tests.**
  - `system-actions.service.test.ts`: runner answers 409 `{ error, code: 'ops_busy' }` →
    `runComponentAction` rejects `ConflictException` whose body has `code: 'ops_busy'`, and no
    audit row is written; same with `deploy_running`; same for `renewCertificates`. Each call's
    budget above reaches `request` (assert the argument). Not configured → the message
    `This action requires the ops runner.`
  - `backups.service.test.ts`: `triggerBackup('u1')` → one `audit_log` insert with
    `actor_user_id: 'u1'`, `action: 'system.backup.run'`; a 409 → `ConflictException`, no audit.
  - Console: a 409 `ops_busy` on Restart, on Renew and on Run backup → the toast shows the i18n
    text, never the runner's English; `deploy_running` likewise; a renewal answer
    `scheduled: true` → the new `renewSuccess` text.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api vitest run src/modules/admin/system-actions.service.test.ts src/modules/admin/backups.service.test.ts`
      → FAIL.
- [ ] **Step 3: Implement.** Keep the line `const WORKER_ACTION_WAIT_MS = 295_000;` verbatim
      (infra:review pins it). The backups page's `runBackup` words a refusal through
      `backupRefusal(refusalOf(res), …)` first, as restore does (`backups/page.tsx:280`). The
      System Versions page and the TLS card word `ops_busy` and `deploy_running` the same way. The
      TLS card re-reads the status 15 s after a renewal, not 4 s. Texts:
  - en `admin.systemVersions.actions.opsBusy`: "Another operation is running on the server (a
    backup, a restore, an upload, a delete, a container action or a certificate renewal). Try again
    when it ends."
  - fr: "Une autre opération est en cours sur le serveur (une sauvegarde, une restauration, un
    envoi, une suppression, une action sur un conteneur ou un renouvellement de certificat).
    Réessayez quand elle est finie."
  - en `admin.systemVersions.actions.deployRunning`: "A deploy is running on the server. Try again
    when it ends." fr: "Un déploiement est en cours sur le serveur. Réessayez quand il est fini."
  - `admin.backups.opsBusy` (en/fr) gains "a container action or a certificate renewal" the same
    way.
  - `admin.systemVersions.tls.actions.renewSuccess` en: "Traefik restarts in a few seconds; the
    renewal is re-attempted then." fr: "Traefik redémarre dans quelques secondes ; le
    renouvellement est alors retenté."
- [ ] **Step 4: Run** the tests, `pnpm --filter @myclash/web-admin test`,
      `pnpm --filter @myclash/i18n test` (directly, not through turbo) → PASS.
- [ ] **Step 5: Falsify** the status relay (map 409 back to 503), the audit insert and the console
      wording. Restore.
- [ ] **Step 6: Commit** `fix(admin): container actions and renewal take the one road to the ops runner; a busy one is a 409`.

### Task 5: The door — "is an Event live" (rulings 882, 883)

**Files:**

- Create: `apps/api/src/modules/ops-agent/agent-events-live.service.ts` (+ `.test.ts`),
  `apps/api/src/modules/ops-agent/dto/agent-events-live.dto.ts`
- Modify: `apps/api/src/modules/matches/start-count.ts:41` (export `IN_PLAY`),
  `packages/types/src/event-kind.ts` (new predicate), `ops-agent.controller.ts`,
  `ops-agent.module.ts`

**Interfaces:**

- Produces: `holdsBackRepairs(kind: EventKind): boolean` in `event-kind.ts` = `kind !== 'test'`,
  with a docstring naming ruling 883 (the file keeps one predicate per purpose; it is applied to
  `asEventKind(row.event_kind)`).
- Produces: `AgentEventsLiveService.read(now = new Date()): Promise<AgentEventsLiveDto>`;
  `AgentEventsLiveDto = { generatedAt: string; live: boolean; events: Array<{ id: string; name: string; status: string; signs: Array<'status' | 'bout' | 'dates'> }> }`.
  Route `GET /ops-agent/events/live` (method `eventsLive`).
- Produces: `EVENTS_UNREADABLE_CODE = 'EVENTS_UNREADABLE'`.

- [ ] **Step 1: Write the failing tests** (`agent-events-live.service.test.ts`), asserting the select
      strings and filters on the Supabase double:
  - events read: `select('id, name, status, start_date, end_date, timezone, event_kind')`,
    `.in('status', ['draft', 'published', 'running'])`; no `event_kind` filter in SQL.
  - `running` Event → `signs: ['status']`, `live: true`.
  - `draft` club Event whose dates hold today → `signs: ['dates']`.
  - `published` Event, `now` = 2026-11-21T23:30:00Z, timezone `Europe/Paris`, dates
    2026-11-22..2026-11-22 → `signs: ['dates']` (it is already the 22nd in Paris). Same `now` with
    dates 2026-11-21..2026-11-21 → not live.
  - bouts: `matches` `select('phase_id')` `.in('status', IN_PLAY)` → `phases`
    `select('id, tournament_id')` `.in('id', …)` → `tournaments` `select('id, event_id')`
    `.in('id', …)` → `events` (the events select above) `.in('id', …)`; each select and each `in`
    asserted. A bout of a `draft` standard Event → `signs: ['bout']`; of a `completed` Event →
    nothing; of a `test` Event → nothing. No bout in play → no further read.
  - a `test` Event with status `running` → not listed, `live: false`.
  - any read errors → throws `OperationalUnavailableException` with `code: 'EVENTS_UNREADABLE'`.
  - an Event with two signs lists both, once.
  - `event-kind` test: `holdsBackRepairs` is false for `test` only.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Today in the Event's zone:
      `zonedDay(now.toISOString(), canonicalZone(tz) ?? DEFAULT_EVENT_TIMEZONE)` from
      `@myclash/time`, compared as `YYYY-MM-DD` strings. "Over" is `isOver`
      (`common/live-status.ts`). The answer holds no roster, no person. Route on the controller
      with `@Get('events/live')`.
- [ ] **Step 4: Run** → PASS (rebuild `@myclash/types` first: the API reads its `dist/`).
- [ ] **Step 5: Falsify** the kind predicate, the `isOver` filter, the zone (use UTC), and the
      error code. Restore each.
- [ ] **Step 6: Commit** `feat(ops-agent): the door says whether an Event is live (rulings 882, 883)`.

### Task 6: The door — the three actions, under Claude's own account

**Files:**

- Modify: `apps/api/src/modules/ops-agent/agent-key.guard.ts` (+ test),
  `ops-agent.controller.ts` (+ test), `mask.ts` (+ test), `dto/` (new `agent-actions.dto.ts`),
  `apps/api/src/common/throttling/throttle-profiles.ts`,
  `apps/api/src/common/auth/route-authz.test.ts:48-55`,
  `apps/api/src/common/auth/public-routes.test.ts:193-199, 239, 345, 357-362`,
  `apps/api/src/common/interceptors/read-only.interceptor.test.ts`,
  `apps/api/src/common/testing/archived-lock-ledger.ts`, `ops-agent.http.test.ts`,
  `agent-door.wall.test.ts:4` (docstring), `packages/api-client` (regenerated)

**Interfaces:**

- Consumes: Task 4's `RESTARTABLE_SERVICES`, `componentKeyForService`, `triggerBackup(actor)`,
  `runComponentAction`, `renewCertificates`.
- Produces: the guard selects `'id, user_id, revoked_at, last_used_at'` and sets
  `request.agentUserId`; a param decorator `@AgentActor()` returns it.
- Produces routes (each `@Throttle(AGENT_ACTION_THROTTLE)`,
  `AGENT_ACTION_THROTTLE = { global: { limit: 10, ttl: 600_000 } }`):
  - `POST /ops-agent/containers/:service/:action` (method `containerAction`), a Zod DTO like
    `dto/agent-logs.dto.ts` (`createZodDto`, `.strict()`): `service: z.enum(RESTARTABLE_SERVICES)`,
    `action: z.enum(['restart', 'start'])` →
    `AgentActionResultDto = { ok: boolean; service: string; action: string; exitCode: number | null; timedOut: boolean; scheduled: boolean }`.
  - `POST /ops-agent/backups` (method `runBackup`) →
    `{ operation: { id: string; kind: string; status: string; startedAt: string } }`.
  - `POST /ops-agent/tls/renew` (method `renewCertificates`) → `AgentActionResultDto` with
    `service: 'traefik'`, `action: 'renew-certs'`, `scheduled: true`.
  - `maskActionResult`, `maskBackupStarted` in `mask.ts` build each answer field by field.

- [ ] **Step 1: Write the failing tests.**
  - guard (real guard over a Supabase double): the select string above; `request.agentUserId`
    equals the row's `user_id`.
  - controller test: each action passes `request.agentUserId` as the actor
    (`('worker', 'restart', 'agent-user')` → `runComponentAction('worker', 'restart', 'agent-user')`
    through `componentKeyForService`; `runBackup` → `triggerBackup('agent-user')`).
  - `ops-agent.http.test.ts` (through `configureHttpApp`): `stop` → 400; `db`, `api`, `traefik`,
    `ops-runner`, `../worker` → 400; `restart worker` → 200 whose answer has exactly the six keys
    (no `stdout`, `stderr`); a runner 409 → 409 with `code: 'ops_busy'`; `runBackup`'s answer has
    no `logTail`.
  - `read-only.interceptor.test.ts` (D7; the HTTP test's app has no global interceptor): with the
    flag on, `POST /api/v1/ops-agent/containers/worker/restart` with no user → refused with
    `code: 'read_only_mode'`, the handler never called.
  - `route-authz.test.ts`: the agent-door list = the seven reads + `containerAction`,
    `runBackup`, `renewCertificates`, `eventsLive`.
  - `public-routes.test.ts`: the door filter (`:345`) becomes every verb under `/ops-agent/` (M3);
    the snapshot gains the four lines; the public-POST check (`:357-362`) exempts the door's POSTs
    by name in a list of their own, with a comment that `AgentKeyGuard` refuses every caller but
    the key.
  - `archived-lock-ledger.ts`: the three `POST ops-agent/…` lines under platform administration.
  - The docstrings that count "seven" door routes (`ops-agent.controller.ts:30`,
    `agent-door.wall.test.ts:4`) say what the door holds now.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api vitest run src/modules/ops-agent src/common/auth src/common/interceptors`
      → FAIL.
- [ ] **Step 3: Implement.** Bind `@Param() params: AgentContainerActionParamDto` (never
      `@Param('x') x: string`, which is not validated). Then `pnpm openapi:emit && pnpm openapi:client`.
- [ ] **Step 4: Run** the API suite in full (`pnpm --filter @myclash/api test`: the archived-lock
      test runs only there; the boot test proves the module exports) → PASS.
- [ ] **Step 5: Falsify** the `stop` refusal (add `stop` to the DTO list), the actor (pass a fixed
      id), the mask (spread the result), the M3 filter (back to `GET`). Restore each.
- [ ] **Step 6: Commit** `feat(ops-agent): the door restarts or starts a listed container, runs a backup, renews certificates`.

### Task 7: `door.mjs act` and the skill's repair rules (D5-D9, ruling 887)

**Files:**

- Modify: `.claude/skills/myclash-ops/door.mjs`, `.claude/skills/myclash-ops/SKILL.md`
- Create: `scripts/ops-skill-act.test.mjs` (keeps `ops-skill.test.mjs` under 400 lines)
- Modify: `scripts/ops-skill.test.mjs:54-63` (the route parity reads `@Get` and `@Post`)

**Interfaces:**

- Consumes: Task 5's and Task 6's routes.
- Produces: `DOOR_ROUTES` = every controller route as `VERB path` (`GET backups` and
  `POST backups` are two routes); the parity test holds it. The round reads `events/live` after
  `containers` (file `events-live.json`).
- Produces: `node door.mjs act restart <service> <dir>`, `act start <service> <dir>`,
  `act backup <dir>`, `act renew-certs <dir>`. Each prints `<status> act <what>` (the
  `describeOutcome` rules; `CODE_WORD` becomes `/^[A-Za-z0-9_]{1,64}$/`), saves
  `<dir>/act-<what>.json`, then one `after …` line and `end <how>`:
  - container: reads `containers` every 10 s up to 120 s; it ends when two reads at least 30 s
    apart both show the service `running` and its health neither `starting` nor `unhealthy` →
    `after <state> <health|none>`; at 120 s it prints what it last saw;
  - backup: reads `backups` every 15 s up to 8 min until `runningOperation` is no longer the
    started id → `after <lastBackup.status>` or `after still-running`;
  - renewal: reads `tls` once after 30 s → `after <host>:<daysUntilExpiry>` per certificate.
  - A refusal (`409 …`, `503 read_only_mode`, 400) prints its line and `end refused-<code>`, with
    no after-read. A container action cut by its timeout or the network prints `unreachable …`,
    then still runs its after-read (D8).
  - A service that does not match `/^[a-z][a-z-]{0,40}$/` is a usage error (exit 2) before any
    call. A container action's request times out at 300 s (D8); every other request keeps 60 s.

- [ ] **Step 1: Write the failing tests** (`ops-skill-act.test.mjs`, with an injected `request`
      and clock like `runRound`):
  - the four `act` forms build `POST /api/v1/ops-agent/…` with the key;
  - `409 ops_busy` prints `409 ops_busy` and `end refused-ops_busy` with no after-read; the same
    for `409 deploy_running` and `503 read_only_mode`;
  - a container `running healthy` on the 3rd and 6th polls prints `after running healthy`; one
    `running none` once then `restarting` is not accepted; one still `exited` at 120 s prints
    `after exited none`;
  - a container action that ends `unreachable ETIMEDOUT` still polls and prints its `after` line;
  - the backup poll stops on a new id;
  - a bad service name exits 2 with no request;
  - `act restart worker` builds its request with `timeout: 300_000`, a read with `60_000`;
  - parity: `DOOR_ROUTES` equals the controller's `@Get`/`@Post` routes as `VERB path`.
- [ ] **Step 2: Run** `node --test scripts/ops-skill-act.test.mjs scripts/ops-skill.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `door.mjs`. Then `SKILL.md`:
  - §1: "You change nothing" becomes "You change nothing but the repairs of §7, through
    `door.mjs act`." Keep every other rule.
  - New §7 "Repairs" (watched SSH becomes §8), a table:

    | Symptom                                                                                 | Action              | While an Event is live |
    | --------------------------------------------------------------------------------------- | ------------------- | ---------------------- |
    | A restartable container's `state` is `exited` or `created`, exit code not 0 and not 143 | `act start`         | yes                    |
    | Its `state` is any other non-`running` value, or its `health` is `unhealthy`            | `act restart`       | yes                    |
    | `runtime-health.redis` is `critical` or `unavailable`, its container looks fine         | `act restart redis` | no: problem, push      |
    | `backups.lastBackup.status` is `failed`, or no backup for 8 days                        | `act backup`        | no: note               |
    | A certificate's `daysUntilExpiry` is below `tls.minDays`                                | `act renew-certs`   | no: problem, push      |

    Restartable = the 12 names of the door's container route. `api`, `db`, `traefik` and
    `ops-runner` are never acted on. An Event is live when `events-live.json` says `live: true`,
    or when that read failed (an unknown answer is live).

  - Hold back entirely (ruling 887): a container `exited` with code 0 or 143 was stopped on
    purpose: a note, no action. When `versions` shows a deploy that finished less than 15 minutes
    before the run started, act on nothing: each symptom is a problem "held back: a deploy just
    ran". A `409 deploy_running` is the same.
  - Rules: one attempt per component per run; never retry after any answer; `409 ops_busy` means
    someone else is acting: report it, do not retry; `503 read_only_mode` means the operator froze
    the platform: act no more this run, report it (D7). A repair whose `after` line is not
    `running healthy` / `running none` / `success` / days ≥ `minDays` is a failed repair: a
    problem.
  - §4: a failed repair and a symptom held back (live Event, deploy, read-only, busy) are problems.
    An on-purpose stop is a note.
  - §5 "Done by Claude": each action, its `act` line and its `after` line; or "Nothing".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Falsify** the busy stop, the two-reads rule, the cut-connection after-read and the
      name check. Restore.
- [ ] **Step 6: Commit** `feat(ops-agent): the skill repairs on a matching symptom and holds back when it must`.

### Task 8: Review, gates, deploy, live check, close

- [ ] **Step 1:** `gates.sh` (whole chain; DB replay `none`: no migration) → all PASS.
- [ ] **Step 2:** A fresh whole-slice review on the most capable model; one fix pass, each fix red →
      green; gates again; push; CI green.
- [ ] **Step 3:** The operator's deploy routine (runner, API, scripts changed).
- [ ] **Step 4: Live check** with the throwaway routine (enable, run, read the log, disable):
  - `events/live` answers 200 `live: false` on the empty stack;
  - `act restart web-marketing` → 200, `after running healthy`; the console's audit log shows one
    `system.component.restart` row by "Claude (ops agent)";
  - `act restart worker` answers within 300 s through the cloud proxy and Traefik (D8: UNVERIFIED
    until this run);
  - `act renew-certs` → 200 `scheduled: true`, then the `after` line reads every host (D9);
  - `act` with `stop` → 400;
  - the operator runs `docker kill myclash-web-marketing` on the VPS (exit 137, a crash). A run of
    the real skill (the throwaway's prompt = the G9 prompt) starts it and mails "Done by Claude".
    Then the operator stops it on the console (exit 0): the next run leaves it and writes a note.
- [ ] **Step 4b (operator's choice):** a restore from the console, then the seed's lines in the
      restore's log (Review Focus 5). The platform holds test data only, but a restore replaces it.
- [ ] **Step 5:** Docs commit: ARCHITECTURE §17.8 (the actions, the live read, the locks), the
      spec's "Slice 4 rulings" (882-887 + D2-D9 named), §4 "Named race" corrected, slice 4 "Done";
      the prune listed as slice "4b" (ruling 884; slices 5-8 keep their numbers); this plan
      deleted.
- [ ] **Step 6:** Memory note `project_ops_agent_slice4_*.md`, MEMORY.md line, handoff.
