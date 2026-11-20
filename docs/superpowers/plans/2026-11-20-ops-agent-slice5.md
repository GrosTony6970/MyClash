# Ops agent slice 5 — containers in health, the alert wake-up, the outside watcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** a crashed container, a critical health reading or a silent worker starts Claude's cloud
task within minutes, without a human, and the operator can see on the console whether that wiring
is configured.

**Architecture:** three commits. (1) The runtime-health snapshot gains a sixth metric,
`containers`, from the ops runner's `GET /containers` (ruling 900), so the email, the console card,
the door and the wake-up all judge the same thing. (2) The worker's 5-minute tick decides a
wake-up on every tick, before the email switch, and POSTs the task's fire endpoint on a NEW set of
critical/unavailable keys (rulings 902, 901); it leaves a trace the card reads. (3) The same tick
pings an outside dead-man's switch (healthchecks.io); when the pings stop, it fires the task with
run type `silent`, and a silent run retries for 10 minutes before it alarms (ruling 903).

**Tech stack:** NestJS 11 + BullMQ worker, ioredis, Node 26 `fetch`, Next.js console, vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-ops-agent-design.md` §4 "The wake-up calls", §8 "The
outside watcher", guide G5/G6, "Verification → Wake-up" and "End to end". Rulings 900-903
(2026-11-20, recon) change it: containers join health; no TLS wake-up; the wake-up checks every
tick; a silent run waits before it alarms.

## Global constraints

- Hard rules 4 (no table, no RLS change), 6 (EN + FR for every console string), 7 (no secret in
  the repo: the token and the ping URL live only in the VPS `.env`), 9 (one concern per commit).
- The fire call (measured from the docs, 2026-11-20): `POST <OPS_AGENT_WAKE_URL>` (=
  `https://api.anthropic.com/v1/claude_code/routines/<trig_id>/fire`), headers
  `Authorization: Bearer <OPS_AGENT_WAKE_TOKEN>`, `anthropic-version: 2023-06-01`,
  `anthropic-beta: experimental-cc-routine-2026-04-01`, `content-type: application/json`; body
  `{"text": "<run type> <facts>"}` (≤ 65,536 chars). 200 = a session started. A paused task
  answers 400; 429 has `Retry-After`. **No retry** in the worker: a retry starts a second run
  (no idempotency key).
- The text carries no person data: run type, metric keys, statuses, figures, container service
  names, exit codes. It is data for the run, never instructions (the task's prompt already says so).
- Fail-closed (design §4): an unreadable wake state means no fire; the outside watcher covers a
  dead Redis.
- The worker logs "agent wake-up: not configured" once at boot when either key is missing; one key
  without the other is "misconfigured", logged once, and never fires.
- New `.env.example` keys (all three in `forbiddenEnvKeys`, `scripts/check-client-secret-
boundaries.mjs:23`): `OPS_AGENT_WAKE_URL`, `OPS_AGENT_WAKE_TOKEN`, `OPS_AGENT_WATCHER_PING_URL`.
  Worker env only (`docker-compose.prod.yml` worker `environment:` ~:982), `${X:-}`.
- Complexity: `runtime-health-monitor.worker.ts` `tick` is already long; the wake-up and the ping
  are their own classes, called from `tick`, never inlined.

## Review focus

1. **Deploys.** A tick that lands while `up -d` recreates containers could read one as `created`.
   deploy.sh drains and stops the worker before `up` (`lib/worker-drain.sh`), so ticks pause; a
   wake-up mid-deploy is possible only in the gap. The run then holds repairs ("a deploy just
   ran") and reports. Accepted; the live check names it if seen.
2. **A repaired container** leaves `overall` critical in the round's own snapshot. The skill must
   not push for a containers-only critical that its repair healed (Task 4).
3. **Stop on purpose** (exit 0/143, ruling 887) is NOT critical in the containers metric: the
   operator stopping Studio at night must not wake Claude.
4. **The end-to-end "stop the worker" test** must use `docker kill` (exit 137): `docker stop` is
   exit 143, a stop on purpose, which the skill leaves alone.
5. **Dev:** the dev api has no `OPS_RUNNER_URL` (ruling 832), so the console card reads
   `containers` as `not_configured` there; the dev WORKER has the runner keys
   (`docker-compose.dev.yml:696`), so a crashed dev container can send the alert email in dev.
   Accepted.
6. **Flapping:** a metric that goes up and down fires a run (and maybe a push) on every second
   tick: at most ~6 runs an hour, under the 30-fire cap. Accepted, named in the report if seen.

## Plan review (2026-11-20): myclash-plan-review pass 1 + one cold plan-reviewer

Folded below: the silent wait is a `door.mjs wait-up` command, not repeated rounds (the skill
forbids a second round, `SKILL.md:28,66`); the containers read goes through
`AdminSystemActionsService` (disk's road; its runner client is private,
`system-actions.service.ts:109`) and moves the row parser out of `agent-logs.service.ts:43-52`
(one owner); the tick re-checks `isStopping` after the collect (`worker.ts:99`, ruling 830); the
wake-up de-dups per dead service; the console's trace read gets its own time-bounded provider;
Task 4 moves to commit 1; plus the minors (fire timeout, API-process boot log, missing
containers, the constructor order, the OpenAPI client, the card's file split, pins).

---

### Task 1 (commit 1): containers in runtime health — ruling 900

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health/containers-collector.ts` (+ test; the route
  `/containers` is asserted HERE, on a spy of `AdminSystemActionsService.getContainers`)
- Modify: `apps/api/src/modules/admin/system-actions.service.ts` — `getContainers()` and
  `opsAvailable()` (disk's road, `:211-212`); the row parser `container()` moves here from
  `apps/api/src/modules/ops-agent/agent-logs.service.ts:43-52`, which then calls it (one owner)
- Create: an `EXPECTED_SERVICES` list beside `agent-log-services.ts` (= `AGENT_LOG_SERVICES` +
  `db`, `supabase-meta`, the skill's "expected services", `SKILL.md:84`): a missing one is a
  problem (`state: 'missing'`)
- Modify (moved here from Task 4, because this commit makes `overall` critical): SKILL.md §4 —
  `runtime-health.containers` critical is the same symptom as the `containers[]` rows; after a
  repair that healed every named service, that containers-only critical is not a problem;
  `unavailable` (runner down) stays one; a test line in `scripts/ops-skill.test.mjs`
- Create: the card's containers tile in its own file (`ContainersTile.tsx` + `container-rows.ts`):
  `RuntimeHealthCard.tsx` is 565 lines and baselined (`code-quality-complexity-baseline.json:108`)
- Run: `pnpm openapi:emit && pnpm openapi:client` (the Swagger summaries change the client)
- Modify: `apps/api/src/modules/admin/dto/runtime-health.dto.ts:7-73` (`ContainersMetric`, field
  `containers` on `RuntimeHealthResponseDto`)
- Modify: `apps/api/src/modules/admin/runtime-health.service.ts:19-94` (collector, `mapContainers`,
  `worstStatus` minus `not_configured`)
- Modify: `apps/api/src/modules/admin/admin.module.ts:166-194` (build the collector from the
  `OpsRunnerClient` it already injects for disk)
- Modify: `apps/api/src/workers/runtime-health-monitor.worker.ts:45,172` (`METRIC_KEYS`, the email
  details line names the bad services)
- Modify: `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx:20-55,263-375` (type
  mirror + one tile), a row helper `container-rows.ts` (+ test, like `photo-storage-rows.ts`)
- Modify: i18n `packages/i18n/src/messages/{en,fr}/admin.ts` `admin.systemVersions.runtimeHealth.
containers.*`; the Swagger summaries `runtime-health.controller.ts:31`,
  `ops-agent.controller.ts:73`
- Modify: the full-DTO fixtures `runtime-health-samples.service.test.ts:51-83`,
  `runtime-health.service.test.ts:10-33`, `runtime-health.redis-bound.test.ts:79-95`,
  `runtime-health-monitor.worker.test.ts:47`

**Interfaces:**

- Produces: `deadContainers(rows: ContainerRow[]): ContainerProblem[]` (pure; one owner of "dead",
  the same rule as SKILL.md §7): a row is a problem when `health === 'unhealthy'`, or `state` is
  neither `running`, `exited` nor `created`, or `state` is `exited`/`created` with an `exitCode`
  that is a number other than 0 and 143. `exitCode: null` on a stopped row is NOT a problem
  (unknown, the skill notes it). `ContainersMetric` =
  `{ status: 'healthy' | 'critical', running: number, total: number, problems: ContainerProblem[] }`
  | `{ status: 'not_configured' }` | `Unavailable`. `ContainerProblem` =
  `{ service, state, exitCode: number | null, health: string | null }`.
- Collector: `collectContainers(): Promise<ContainersReading>` — `configured: false` when
  `OpsRunnerClient.available()` is false; else `ops.get('/containers')` (15 s default). A thrown
  read maps to `unavailable` (the runner down is critical-tier, as for disk).

- [ ] **Step 1: Failing tests** — `containers-collector.test.ts`: `deadContainers` over rows:
      running healthy → []; running unhealthy → 1; exited 137 → 1; exited 0 → []; exited 143 → [];
      created 1 → 1; restarting → 1; exited null → []. `runtime-health.service.test.ts`: a
      collector answering one dead row → `containers.status` and `overall` both `critical`;
      `available()` false → `not_configured` and `overall` ignores it; the
      collector throwing → `unavailable`. Assert the runner route string (`/containers`).
      `runtime-health-monitor.worker.test.ts`: a snapshot with `containers` critical → the email
      body names the service (`containers: critical (web-public exited 1)`).
- [ ] **Step 2:** run them red (`pnpm --filter @myclash/api exec vitest run <files>`).
- [ ] **Step 3:** implement; extend the four fixtures; card tile (healthy: "All N running";
      critical: one row per problem "web-public — exited (1)" / "— unhealthy";
      `not_configured`: "Not read in this environment"); EN + FR strings.
- [ ] **Step 4:** green; `pnpm --filter @myclash/i18n build`, web-admin typecheck + its tests.
- [ ] **Step 5: Falsify** — (a) treat 143 as a problem → the exit-143 test red; (b) drop
      `containers` from `worstStatus` → the overall test red. Same collected count, restore, `cmp`.
- [ ] **Step 6:** commit `feat(runtime-health): a crashed or unhealthy container is critical (ruling 900)`.

### Task 2 (commit 2): the alert wake-up — rulings 901, 902

**Files:**

- Create: `apps/api/src/workers/ops-agent-wake.ts` (+ `.test.ts`)
- Modify: `apps/api/src/workers/runtime-health-monitor.worker.ts` (`tick` order), its test
- Modify: `apps/api/src/workers/workers.module.ts:137-179` (provide `OpsAgentWake`)
- Modify: `apps/api/src/modules/admin/runtime-health.controller.ts` + `dto/runtime-health.dto.ts`
  (an `agentWake` trace on the console's runtime-health answer, read from Redis), the card, i18n
- Modify: `.env.example`, `infra/docker-compose.prod.yml` worker env,
  `scripts/check-client-secret-boundaries.mjs:23`
- Modify: `.claude/skills/myclash-ops/SKILL.md` §2 (run type `alert`), §5 (subject), §4 (Task 4)

**Interfaces:**

- `class OpsAgentWake { constructor(deps: { env, logger, fetchFn?, redis?, processRole }) ; state(): 'configured'
| 'not_configured' | 'misconfigured' ; async onSnapshot(keys: string[], text: string, now: number):
Promise<'fired' | 'same-set' | 'cleared' | 'skipped' | 'failed'> }`. Redis keys:
  `ops-agent:wake-state` = `{ lastKeys: string[] }` (de-dup, its own key — design §4, never the
  email's `runtime-health:alert-state`); `ops-agent:wake-trace` = `{ state, checkedAt, lastFiredAt,
lastStatus: number | null, lastKeys }` (what the card reads).
- The fire POST has `AbortSignal.timeout(15_000)`; a timeout is `failed` (keys stored). The boot
  "not configured" line is logged only when `processRole` is `worker` (WorkersModule is also in
  the API's AppModule, `app.module.ts:127`).
- Rule: keys = metrics at `critical` or `unavailable` (the email's `keysAtLeast(…,'critical')`),
  with `containers` split into one key per problem service (`containers:web-public`), so a second
  dead container fires again while the first is still down.
  Empty → clear the state (re-arm), no fire. Non-empty and NOT the same set as `lastKeys` → fire
  once, then store `lastKeys` (stored even when the POST failed: no retry storm; the failure is in
  the trace and the worker log). Same set → nothing. Redis `get` throws → `skipped`, no fire
  (fail-closed), trace not written.
- Text: `alert <key>=<status>[ <figure>] …`, containers as `containers=critical(web-public exited 1)`.
- `tick(now)`: (1) `isStopping` → return; (2) compute "email check due" (today's rule) BEFORE
  any collect; (3) collect the snapshot ONCE when the wake-up is configured or the check is due;
  (4) `isStopping` AGAIN → return (a draining worker reads `queues` as `no_consumer`, ruling 830:
  without this every deploy drain would fire a run); (5) `wake.onSnapshot`; (6) the email path
  exactly as today, from the same snapshot, only when due.
- The console's trace read: a provider `OpsAgentTraceReader` (its own Redis read, time-bounded
  like `runtime-health.redis-bound.test.ts`, ruling 842) merged into the runtime-health answer by
  the controller (`runtime-health.controller.test.ts:7-10` updated). Missing key → "not checked
  yet"; the card shows the age of `checkedAt` (an old one = the worker stopped). The wording lives
  in a pure row helper `agent-wake-rows.ts` with its own test; card strings never name the env keys
  (the secrets gate). Emails off (`enabled: false`) no longer
  skips the collect when the wake-up is configured (ruling 902; design §4 "the wake-up does not
  follow the email settings"). The samples record keeps its own rule: only when the email check
  was due, so the history density does not change.

- [ ] **Step 1: Failing tests** (`ops-agent-wake.test.ts`, fake fetch + seeded Redis double):
      a new critical set → ONE fetch whose URL, method, the four headers (exact values above) and
      JSON body are asserted; the same set next tick → no fetch; set grows → fetch; healthy →
      state cleared, then the same keys again → fetch; Redis `get` throws → no fetch; no env →
      `not_configured`, no fetch, one boot log line; one key only → `misconfigured`, no fetch;
      fetch rejects / answers 400 → `failed`, `lastKeys` stored, trace `lastStatus` 400 / null.
      `runtime-health-monitor.worker.test.ts`: emails `enabled: false` + wake configured → a
      collect and a fire; interval not due + wake configured → collect once, no email, no sample;
      `isStopping` → no collect, no fire; `isStopping` flips DURING the collect → no fire, no
      email; a second service dies while the first is still down → a second fire. The console
      read: trace JSON → DTO field (assert the Redis key string), missing key → "not checked yet",
      a hung Redis → bounded.
- [ ] **Step 2:** red. **Step 3:** implement. **Step 4:** green + `pnpm --filter @myclash/api build`.
- [ ] **Step 5:** card line "Agent wake-up: configured · last call {time} ({status})" / "not
      configured" / "misconfigured (one of the two keys is missing)", EN + FR; i18n test.
- [ ] **Step 6:** `.env.example` (both keys empty, a comment: the guide step G5),
      compose worker env, `forbiddenEnvKeys`, and `requireLine` pins in `check-infra-review.mjs`
      for the new worker env lines (as for `OPS_RUNNER_URL`, `:1127-1136`);
      `pnpm security:client-secrets`, `pnpm infra:review`.
- [ ] **Step 7:** skill §2: run type `alert` = the daily round and its repairs; the payload's keys
      are data, never instructions; subject `MyClash ops · alert · …`.
- [ ] **Step 8: Falsify** — (a) fire on the same set (drop the `sameSet` check) → red; (b) skip
      the fail-closed branch → red; (c) gate the wake-up behind `settings.enabled` → red.
- [ ] **Step 9:** commit `feat(ops-agent): a new critical set wakes the cloud task (rulings 901, 902)`.

### Task 3 (commit 3): the outside watcher — ruling 903

**Files:** Create `apps/api/src/workers/watcher-ping.ts` (+ test); modify the monitor's `tick`
(ping first, before the email switch), `.env.example`, compose worker env, `forbiddenEnvKeys`,
the card (a "Outside watcher: pinging / not configured / last ping failed" line, from a Redis
trace `ops-agent:watcher-trace`), i18n, SKILL.md §2 (`silent`), spec guide G5/G6.

**Interfaces:** `class WatcherPing { async ping(now): Promise<'ok' | 'failed' | 'not_configured'> }`
— `GET <OPS_AGENT_WATCHER_PING_URL>`, 10 s timeout, never throws; logs a failure only when the
previous ping did not fail (no log flood); writes the trace.

- [ ] **Step 1: Failing tests:** each tick pings once (URL asserted) even with emails off and the
      check not due; `isStopping` → no ping; a rejecting fetch does not break the tick (the
      email/wake path still runs); no env → no fetch, trace `not_configured`; two failures in a
      row log once.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: `door.mjs wait-up <dir>` + skill §2 `silent`.** A new door command polls
      `versions` every 60 s until a 2xx or a 9-minute deadline, all in ONE Bash call (< 600000
      ms; no bare `sleep` in the skill), printing `up after <s>s` or `still down <code>`; tested
      with a fake clock and a fake fetch in `scripts/ops-skill.test.mjs`. Skill: for run type
      `silent`, run `wait-up` once BEFORE the round (§1 "run the round once" and §3 "never a
      second time" stay true); `up` → the normal round, repairs, report (subject
      `MyClash ops · silent · …`); a wipe that ended in time is "all good" plus a Note "the
      platform did not ping for a while" (no push, ruling 903); `still down` → the round (it ends
      unreachable) → report + push. Pin the new lines in `scripts/ops-skill.test.mjs:326-344`.
- [ ] **Step 6:** spec guide G5 (task API trigger → token → VPS `.env` `OPS_AGENT_WAKE_URL`,
      `OPS_AGENT_WAKE_TOKEN` → `start.sh`; check: the card says "configured") and G6
      (healthchecks.io: account, a check Period 5 min Grace 10 min, a Webhook integration with only
      "Execute when a check goes down": POST, the fire URL, headers `Authorization: Bearer <token>`,
      `anthropic-version: 2023-06-01`, `content-type: application/json`, body
      `{"text": "silent $NAME went $STATUS at $NOW"}`; the ping URL → `.env`
      `OPS_AGENT_WATCHER_PING_URL` → `start.sh`; check: the card says "pinging").
- [ ] **Step 7: Falsify** — ping only when the email check is due → the every-tick test red.
- [ ] **Step 8:** commit `feat(ops-agent): the worker pings an outside watcher; a silent run waits before it alarms (ruling 903)`.

### Task 4: moved into Task 1 (the skill's containers rule ships with the metric)

### Task 5: gates, review, push, deploy, guide, live check (with the operator)

- [ ] `gates.sh … none` (31) after each commit; one fresh whole-slice review (most capable model);
      one fix pass, each fix red→green; gates; push; CI + CodeQL.
- [ ] The operator: wipe + deploy (5 flags). Then G5 one step at a time (read the routine docs
      right before), then G6 (read healthchecks.io's current screens right before). Claude checks
      each on the card and over SSH (`docker logs myclash-worker` for the boot line).
- [ ] End to end: (1) `docker kill myclash-web-marketing` → within 5 min an `alert` run starts
      (list_runs on the real task) → it starts the container → email "alert · all good" (healed),
      no push; (2) `docker kill myclash-worker` → no ping for 15 min → healthchecks.io fires a
      `silent` run → it starts the worker → email; (3) an incident off the list (spec "End to
      end") → email plus push: `docker kill myclash-api` (api is not restartable) → the alert
      reads the door down → report + push; the operator starts it again with `start.sh`;
      (4) a morning run still "all good".
- [ ] Closing commit: spec rulings 900-903 + slice 5 Done + the deviations (TLS wake-up dropped,
      three keys), ARCHITECTURE §17.8, this plan deleted; memory note; handoff.
