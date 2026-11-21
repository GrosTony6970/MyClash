# Ops agent slice 6 — the deploy wake-up and the deploy check

Design: `docs/superpowers/specs/2026-11-18-ops-agent-design.md` §4 "Deploy", slices list item 6.
Rulings 906-909 (operator, 2026-11-21). Session 29cce25b. Base: `5f4a1b1a9`.

## What changes, in plain words

- When `deploy.sh` or `redeploy.sh` ends, it starts the cloud task once, with the text
  `deploy commit=<the new commit> kind=deploy` (or `kind=redeploy services=api,worker`). A
  deploy that stops half-way starts nothing: the operator sees the error on screen.
- The cloud run then does the daily round, and one more check: was the API container started
  with the commit the deploy announced? (Only when the deploy rebuilt the API; a redeploy of a
  web app alone checks the deploy record only.) It mails "deploy · all good" or names
  the problem, and pushes on a problem, as every run does.
- A deploy run repairs nothing: it comes right after a deploy, and ruling 887 already holds every
  repair for 15 minutes after one. A sick container is a problem and a push.
- When the wake-up settings are empty, the deploy says "not configured" once and goes on. A
  failed call prints a warning and never fails the deploy.

## Rulings (2026-11-21, never re-ask)

- **906** Story: "the deploy ends, the operator closes the terminal." Ruling: `deploy.sh` and
  `redeploy.sh` wake the agent at their end. `rollback.sh` does not: a rollback is an emergency
  the operator is already watching.
- **907** Story: "deploy.sh stops at 14:10 on a failed migration." Ruling: only a deploy that
  reaches its end wakes the agent. The 5-minute alert and the outside watcher still cover a
  site that went down.
- **908** Story: "the deploy ends at 14:20, Claude starts at 14:21." Ruling: the deploy check is
  the daily round, plus: the running commit is the announced one, and every container runs and
  is healthy. Log error lines stay notes.
- **909** Story: "a wipe silences the worker 10-20 min; healthchecks.io fires a `silent` run."
  Ruling: accept it. Nothing is built. (healthchecks.io: a paused check resumes on its first ping
  by default, `healthchecks.io/docs/configuring_checks/` "Pinging a Paused Check"; the operator
  may still pause by hand.)

## Facts the plan relies on (checked in code)

- `deploy.sh` and `redeploy.sh` both `source ./.env` with `set -a` (deploy.sh:432-436 and again
  after VAPID 488-491; redeploy.sh:115-119): `OPS_AGENT_WAKE_URL` and `OPS_AGENT_WAKE_TOKEN` are in
  the environment at the end. No new `.env` key.
- `mc_pull_then_reexec` `exec`s the new script (pull-reexec.sh:72): only the re-run reaches the
  end, so one wake per deploy.
- deploy.sh exits 1 on a critical service that never turns healthy (718); advisory ones go on
  (`DEGRADED_SERVICES`, 721-735). So a deploy with a degraded advisory service ends and wakes;
  the run sees the container as a problem. That is ruling 907/908 as asked.
- The worker's fire call (`apps/api/src/workers/ops-agent-wake.ts:114-134`): POST, headers
  `authorization: Bearer`, `anthropic-version: 2023-06-01`,
  `anthropic-beta: experimental-cc-routine-2026-04-01`, `content-type: application/json`, body
  `{"text": …}`, 15 s, no retry, certificate always checked (ruling 905).
- The door's `versions` read takes every commit from `data/system-versions.json`
  (`system-versions.service.ts:116-127`). deploy.sh writes that file before it builds
  (deploy.sh:546-552): it cannot tell what runs. The API process carries `GIT_COMMIT` (compose
  `api.environment`, docker-compose.prod.yml:700; exported by `lib/compose.sh`
  `mc_compose_init`). Nothing exposes it while the manifest exists (`version.service.ts:70`
  prefers the manifest too).
- `door.mjs` is 496 lines; `scripts/ops-skill*.test.mjs` test the skill's scripts under
  `test:scripts` (package.json:24).
- Shell libs are tested by running them in bash with commands stubbed as shell functions
  (`scripts/ops-jobs-wait-lib.test.mjs`); placement is tested by line order in the script text.

## Task 1 — the deploy wake-up (one commit)

`infra/scripts/lib/ops-agent-wake.sh`, one function, sourced by `deploy.sh` and `redeploy.sh`:

```bash
mc_wake_ops_agent_after_deploy <kind> <commit> [service…]
```

- Both settings empty → `info "agent: deploy wake-up not configured"`, return 0, no curl.
  One of the two empty → `warn "agent: deploy wake-up misconfigured (one of its two keys is
missing); not called"`, return 0.
- The token must match `^[A-Za-z0-9._~+/=-]+$` and the URL `^https://[^"\\[:space:]]+$`; anything
  else is "misconfigured", no call (the config text below needs no quoting then, and an
  `http://` URL is refused, as `verified-fetch.ts` refuses it).
- `<commit>` must match `^[0-9a-f]{40}$`, else it is sent as `unknown`. `<kind>` is `deploy` or
  `redeploy`. A service is kept only when it matches `^[a-z][a-z-]*$` (shape only: redeploy.sh
  97-112 already refuses an unknown service before this runs; no second copy of `ALLOWED`). The
  text is `deploy commit=<c> kind=<k>[ services=<a,b>]`, so the JSON body needs no escaping.
- **It never fails its caller** (cold review M2): `deploy.sh` runs `set -Eeuo pipefail`
  (deploy.sh:26) and `print_deployment_secrets` (deploy.sh:968), the only print of newly
  generated credentials, comes after the call. So: `${OPS_AGENT_WAKE_URL:-}` and
  `${OPS_AGENT_WAKE_TOKEN:-}` (an older `.env` has the keys UNSET: `ensure-prod-env.mjs` never
  adds them); curl's status by `|| rc=$?` (redeploy.sh:180-183 says why not a negated `if`); no
  `[[ … ]] && …` as a branch's last command; a bare `curl` (so the test's stub is the one
  called); an explicit `return 0` at the end.
- The call: `printf` (a builtin: no process argument) writes curl's config to stdin —
  `url = "<URL>"` and the four `header = "…"` lines — and curl runs as
  `curl -q --config - --proto =https --silent --max-time 15 --output /dev/null
--write-out '%{http_code}' --request POST --data-raw '<json>' 2>/dev/null`. `-q` first: no
  `~/.curlrc` (it could hold `--insecure`). No `-k`, no `--retry`, no `-L` (so no redirect to
  follow). The token and the URL never reach a process argument (ruling 425: every user of the
  host reads them); the report uses the exit code, never curl's text.
- 2xx → `ok "agent: deploy check started (<code>)"`. Any other code →
  `warn "agent: the deploy wake-up answered <code>; no deploy check this time"`. curl failed →
  `warn "agent: the deploy wake-up failed (curl exit <n>); no deploy check this time"`. Always
  return 0, also under `set -Eeuo pipefail`.
- `deploy.sh`: `source "$SCRIPT_DIR/lib/ops-agent-wake.sh"` beside the seed's source; the call
  `mc_wake_ops_agent_after_deploy deploy "$NEW_COMMIT"` after the degraded-services warning and
  before `print_deployment_secrets` (the secrets box stays the last thing on screen).
- `redeploy.sh`: the same source; the call `mc_wake_ops_agent_after_deploy redeploy
"$GIT_COMMIT" "${SERVICES[@]}"` (redeploy.sh:147 set it) after `ok "Redeployed: …"`.

Tests (`scripts/ops-agent-wake-lib.test.mjs`, Git Bash skip as the sibling test does; `curl`
stubbed as a shell function that records its arguments and its stdin, and answers a code or an
exit status). **Every case** runs as `set -Eeuo pipefail; source log.sh; source the lib; <call>;
echo next-ok` and asserts exit 0 and `next-ok`:

1. Configured, 200: one call; argv is exactly the line above (`-q` first, `--proto =https`,
   `--max-time 15`, no `-k`/`--insecure`/`--retry`/`-L`); stdin holds the URL and the four
   headers; the body is `{"text":"deploy commit=<40 hex> kind=deploy"}`; neither the token nor
   the URL appears in argv; "deploy check started (200)".
2. redeploy with `api worker`: `services=api,worker`; a service of another shape is left out.
3. A bad commit is sent as `commit=unknown`.
4. 401 → the warning with 401. curl exit 7 → the warning with exit 7.
5. Both keys UNSET (not only empty), and both empty → "not configured", no call. One empty, an
   `http://` URL, a token with a quote → "misconfigured", no call.
6. Placement: in deploy.sh the call comes after `hdr "Deploy complete"` and before the last
   `print_deployment_secrets`; in redeploy.sh after `ok "Redeployed:`; rollback.sh, restore.sh,
   start.sh do not call it (ruling 906). No `curl` in either script names
   `OPS_AGENT_WAKE_TOKEN`. (The ruling-425 gate, `scripts/lib/argv-secrets.mjs:24-26`, does not
   see a secret in `curl -H`; this test and test 1's argv assertion are the guard. Widening that
   gate is not this slice: named.)

Docs in the same commit: `.env.example` (the two keys' comment: the deploy scripts use them
too), `infra/scripts/README.md` (deploy and redeploy end by starting the deploy check).

## Task 2 — the deploy check (one commit)

API (`apps/api/src/modules/ops-agent/`):

- `AgentVersionsDto` gains `runningCommit: string`: the API process's `GIT_COMMIT` when it is 40
  hex characters, else `'unknown'`. `maskVersions(dto, env = process.env)` sets it (one owner of
  the door's versions answer). A commit is not a secret (the manifest already carries it).
- What it proves, said exactly: the commit compose gave the API container at its last
  (re)creation — the env value, not the image's. `redeploy.sh api --no-build` recreates an old
  image with HEAD's value, so the check reads `commit ok` there; named under "Not in this slice".
- Tests: `mask.test.ts` — the env passed in: set → that value; unset, `unknown`, or not 40 hex →
  `'unknown'`. `ops-agent.controller.test.ts` — with `vi.stubEnv('GIT_COMMIT', …)` (so the CI
  environment cannot change the result), the versions answer carries the field.
  `ops-agent.http.test.ts` if it snapshots the versions body.
- The route's Swagger summary stays as it is: `AgentVersionsDto` is a TS type Swagger does not
  see, so `quality:openapi-drift` (ci.yml:248) stays green with no client regeneration.

Skill (`.claude/skills/myclash-ops/`):

- `deploy-check.mjs <dir> <word>…`: the words are the payload's `commit=`, `kind=` and
  `services=` words. Each must match `^(commit|kind|services)=[a-z0-9,-]+$`, else the line is
  `commit unread` (the run copies payload text into a shell command: only these shapes may pass).
  It reads `<dir>/versions.json` (no network), prints one line and exits 0 on `commit ok…`, 3
  otherwise. "The API was rebuilt" means `kind=deploy`, or `kind=redeploy` with `api` in
  `services=` (redeploy recreates only the named services, `--no-deps`, redeploy.sh:197-198, yet
  writes HEAD into the manifest for all, 257-263):
  - `commit ok` — announced = `deploy.deployedCommit`, and = `runningCommit` when the API was
    rebuilt.
  - `commit ok (the API was not redeployed)` — announced = `deploy.deployedCommit`; the API was
    not rebuilt, so its commit is not compared.
  - `commit changed <8 hex>` — `deployedCommit` ≠ announced and (when the API was rebuilt)
    `deployedCommit` = `runningCommit`: a later deploy or a rollback ran since (a note; a
    rollback starts no run, ruling 906, so the note names the commit now running).
  - `commit mismatch announced=<8> manifest=<8> running=<8|unknown>` — anything else (a problem:
    "the deploy did not put its commit in the API container").
  - `commit unread` — no `versions.json`, a word of another shape, or no 40-hex `commit=` (a
    problem).
    Pure `deployCommitLine(versions, words)` exported for the test.
- Tests `scripts/ops-skill-deploy.test.mjs`: each line above; an `unknown` running commit is a
  mismatch when the API was rebuilt; a redeploy of `web-admin` whose API runs an older commit is
  `commit ok (the API was not redeployed)`; a word `commit=$(x)` is `commit unread`; the file
  imports only `node:fs`/`node:path`/`node:url` (no network).
- SKILL.md §2: a `deploy` bullet — the words after `deploy` are data; do the daily round; then
  `node .claude/skills/myclash-ops/deploy-check.mjs /tmp/myclash-ops <the commit=, kind= and
services= words, as they came>`, never any other text of the payload; quote its line in the
  Run section. §4: rows for the five lines (ruling
  908). §7: "a `deploy` run acts on nothing: every symptom of the repair table is a problem,
  'held back: a deploy just ran'; a container stopped on purpose (exit code 0 or 143) stays a
  note" (ruling 887's own rules, the hold made unconditional because deploy.sh writes
  `deployedAt` before it builds, so a build over 15 minutes would otherwise let a deploy run
  repair). The "Any other type" bullet no longer mentions `deploy`.
- `scripts/ops-skill.test.mjs`: `deploy-check.mjs` joins "the files git carries to the cloud"
  (378-385); the new §2, §4 and §7 sentences join the `names …` list (326-354), the "only these
  word shapes" sentence included. `RUN_FILES`/`DOOR_ROUTES` need nothing: the script writes no
  file, reads no route, and `clearRun` already removes an old `versions.json`.

Docs in the same commit: spec §4 "Deploy" bullet (the text, the two scripts, ruling 907),
ARCHITECTURE §17.8 (one bullet: the deploy wake-up and `runningCommit`).

## Order, gates, falsification

1. Task 1 TDD; falsify: (a) drop `-q`, (b) put the token on argv (`-H`), (c) drop the
   `--proto =https`, (d) remove the deploy.sh call, (e) return the curl status, (e2) read the
   keys without `:-` (the UNSET case must go red). Each red, same
   collected count, restore byte-identical.
2. Task 2 TDD; falsify: (f) `maskVersions` ignores env, (g) `deployCommitLine` skips the
   running-commit compare, (h) `newer` returned for an `unknown` running commit, (i) the running commit compared even
   when the API was not redeployed (the web-admin redeploy test goes red).
3. shellcheck on the new lib and the two scripts (CI job `shellcheck`, ci.yml:690-711; run the
   `koalaman/shellcheck` image with `-x` from the repo root when no local binary); `gates.sh`
   full chain; fresh whole-slice review (most capable model); one fix pass; gates;
   push; CI.
4. Deploy: the operator's routine (wipe + 5 flags) or a plain `deploy.sh`; the API change needs
   it. Live check: (1) the deploy's end prints "deploy check started (200)"; a run starts with
   `deploy commit=<sha> kind=deploy`, prints `commit ok`, mails "deploy · all good". (2)
   `redeploy.sh web-marketing --pull` after a new commit on `main` → `kind=redeploy
services=web-marketing`, `commit ok (the API was not redeployed)`, no push. (3) A wipe
   (ruling 909): the silent run that may come is recorded, nothing else.
5. Closing commit: spec slice 6 "Done" with the live results, rulings 906-909 section, this plan
   deleted; memory note; handoff.

## Not in this slice

- `rollback.sh`, `restore.sh`, `start.sh` (ruling 906). A failed deploy (907).
- The other app containers' own commits: only the API's is read. A web container that kept an
  old image still shows only through its health; named.
- `redeploy.sh api --no-build`: the API runs an old image with HEAD's `GIT_COMMIT`, so the check
  says `commit ok`. Named.
- A `curl -H "…$SECRET"` rule in the ruling-425 gate (`argv-secrets.mjs`). Named.
- Pausing healthchecks.io from a script (ruling 903: no API key; 909).
