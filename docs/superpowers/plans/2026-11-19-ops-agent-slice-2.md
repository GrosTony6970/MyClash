# Ops agent, slice 2: container state and log reads on the door — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ops agent's key can read the state of every container and the last lines of one
container's log (all lines, or the warn/error lines only), with emails, phone numbers, IP addresses
and link secrets scrubbed — and no API log line writes a person's email or a database's words about
a person's row in the first place.

**Architecture:** The API's own loggers are fixed at the root first (ruling 867, the design's §2
"the logger is fixed, not the scrub widened"). The ops-runner gains two reads (`GET /containers`,
`GET /logs/:service`) in a new module `container-logs.mjs`; `server.mjs` only routes to it. The door
gains two routes that call the runner through `OpsRunnerClient` (the API's one road to the runner)
and pass every log line through one scrub, `scrubForAgent`, built on the existing `redactText`.

**Tech Stack:** NestJS 12 + nestjs-zod DTOs + vitest (API); plain Node ESM + `node:test` (ops-runner,
run by `pnpm test:scripts`); `docker compose ps|logs` inside the ops-runner image.

**Spec:** `docs/superpowers/specs/2026-11-18-ops-agent-design.md` (§2 Reads and "Masking of free
text", §3, slice 2; Verification "Masking" and "Refusals"). ARCHITECTURE §17.8 says what slice 1
built.

## Rulings this plan carries (operator, 2026-11-19)

- **867** A log line that writes a person's email writes the masked form `maskEmail(x)`
  (`j***@e***`, `apps/api/src/common/audit-log.ts:90`) — masked email only, every line, no id swap.
- **868** On the agent's log read an IPv4 address keeps its first half: `82.66.103.92` →
  `82.66.x.x`. IPv6 keeps its first two groups: `2a01:e0a:1:2::5` → `2a01:e0a:x`. The operator's
  own logs and `status.sh` are unchanged.
- **869** The log read's list is every compose service except `db` and `supabase-meta`: 14
  services, `supabase-studio` included. (First ruled "the design as written", 15; revised the same
  day on the cold review's evidence: postgres-meta v0.96.8 logs a failed query's Postgres error with
  its DETAIL, and "Failing row contains (…)" is the whole row, a birth date included — the reason
  the design gives for leaving out `db`.)
- **870** The five health reads keep `withheld` for error texts (`withoutErrorText` unchanged); the
  scrub applies to log lines only.

## Global Constraints

- The door's routes are `GET` only and carry `@AgentDoor()` on the controller (spec §1, §2).
- "The log read has its own list: every service except `db`" (spec §2), and except `supabase-meta`
  (ruling 869). The restart list
  (`RESTARTABLE_SERVICES`) is not touched and not reused for logs.
- "`GET` the last N lines of one listed container's log, with a hard cap on N and on bytes" (spec
  §3). Caps (left to the builder by the spec, fixed here): `lines` default 100, max 500; each line
  cut to 2,000 characters; the whole answer at most 256 KiB of line text (oldest lines dropped
  first); the errors-only read scans the last 2,000 raw lines.
- The warn/error filter is `status.sh`'s regex (`errors_only_filter`, `infra/scripts/status.sh:74-78`):
  `"level":(40|50|60)` or `error` / `warn` / `fatal`, case-insensitive. Its noise filter
  (`filter_log_noise`, `:56`) is NOT copied: it hides `"event":"http_request"` lines for a
  terminal's sake, and a request line at level 50 is exactly what the agent needs.
- The runner cuts, the API scrubs: a cut must never split a secret in half (a cut `…dupont@exam`
  no longer matches the email pattern). `boundLogLines` drops the cut line's last partial token and
  ends it with `…[cut]`.
- "The door replaces anything shaped like an email address or a phone number before it answers.
  Names can remain" (spec §2). Plus ruling 868 (IPs), and secrets in a URL (pass codes, `token`,
  `token_hash`, `code`, `access_token`, `refresh_token`, `apikey` query values), Bearer and JWT.
- No new `.env` key, no migration, no web-admin page; one console sentence changes (EN + FR).
- Complexity: 50 lines per function, 400 per file; `server.mjs` (940 lines, baselined) gains route
  lines only.

## Review Focus

1. **A timestamp mangled by the scrub.** Every log line starts with `2026-11-18T23:34:35.123Z`, pino
   lines carry `"time":1795044825752`, Traefik's carry `[18/Nov/2026:23:34:33 +0000]`. A phone or
   IPv6 pattern that eats them makes every line useless. Pinned in Task 4's tests.
2. **An email in a URL.** `x%40y.fr` (percent-encoded) and `x@y.fr` inside a quoted JSON value both
   occur (GoTrue's `actor_username`, a Referer). Pinned in Task 4.
3. **A service name that is a path trick, `db` or `supabase-meta`.** `/logs/db`, `/logs/..%2Fdb`,
   `/logs/DB`, `/logs/supabase-meta`, an empty name. Refused at the API (400) and at the runner
   (403), never reaches `docker`. Pinned in Tasks 3 and 5.
4. **A container that is down or unknown to compose.** `docker compose logs` on a stopped container
   still prints its old log (exit 0); on a never-created one it prints nothing. The read answers
   200 with the lines it got (possibly none), never a 500. `ps` lists stopped containers only with
   `--all`. Pinned in Task 3.
5. **A huge line.** A Sentry baggage header made 3 KB request lines; a stack trace is one multi-KB
   line in JSON. The per-line and total caps keep the answer bounded, and a cut never leaves half
   an email behind. Pinned in Tasks 3 and 5.

---

## File structure

| File                                                                                                                                                                   | Responsibility                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/mail/mail.service.ts` (modify)                                                                                                                   | `deliver` logs `maskEmail(to)`                                                                     |
| `apps/api/src/modules/auth/auth.service.ts`, `organizations/onboarding.service.ts`, `admin/admin-organizations.service.ts`, `admin/claim-requests.service.ts` (modify) | the other email log lines → `maskEmail`                                                            |
| `apps/api/src/common/log-lines-no-email.test.ts` (create)                                                                                                              | source guard: no logger call interpolates an `email` expression unmasked                           |
| `apps/api/src/modules/persons/persons.service.ts`, `persons/csv-import.service.ts`, `fighters/fighters.service.ts` (modify)                                            | import failure lines log the code, not the database's words                                        |
| `infra/ops-runner/container-logs.mjs` (create)                                                                                                                         | the log list, query parsing, the problem-line filter, the caps, the `ps` projection, the two reads |
| `infra/ops-runner/container-logs.test.mjs` (create)                                                                                                                    | its tests + parity with `status.sh` and with the API's list                                        |
| `infra/ops-runner/server.mjs` (modify)                                                                                                                                 | two route lines                                                                                    |
| `packages/types/src/sentry-data-collection.ts` (modify)                                                                                                                | export `maskPassTokens` (the pass-code rule, one owner)                                            |
| `apps/api/src/modules/ops-agent/scrub.ts` (create)                                                                                                                     | `scrubForAgent(text)`                                                                              |
| `apps/api/src/modules/ops-agent/agent-log-services.ts` (create)                                                                                                        | `AGENT_LOG_SERVICES`, no imports (the parity test loads it)                                        |
| `apps/api/src/modules/ops-agent/agent-logs.service.ts` (create)                                                                                                        | calls the runner, projects and scrubs                                                              |
| `apps/api/src/modules/ops-agent/dto/agent-logs.dto.ts` (create)                                                                                                        | query DTO + response types                                                                         |
| `apps/api/src/modules/ops-agent/ops-agent.controller.ts`, `ops-agent.module.ts` (modify)                                                                               | two routes, one provider                                                                           |
| `apps/api/src/modules/ops-agent/ops-agent.http.test.ts` (create)                                                                                                       | the controller binds the DTOs: a refused name is a 400 over HTTP                                   |
| `apps/api/src/common/auth/public-routes.test.ts`, `route-authz.test.ts` (modify)                                                                                       | 5 → 7 door routes                                                                                  |
| `packages/i18n/src/messages/{en,fr}/admin.ts` (modify)                                                                                                                 | the console's "five read-only views" sentence                                                      |
| `docs/ARCHITECTURE.md` §17.8 (modify)                                                                                                                                  | the two reads and the scrub                                                                        |

---

### Task 1: No API log line writes a person's email (ruling 867)

**Files:**

- Modify: `apps/api/src/modules/mail/mail.service.ts:186-195`
- Modify: `apps/api/src/modules/auth/auth.service.ts:285, 1590, 1622, 1650, 1656, 1727, 1732`
- Modify: `apps/api/src/modules/organizations/onboarding.service.ts:154, 160`
- Modify: `apps/api/src/modules/admin/admin-organizations.service.ts:672, 878, 890, 916`
- Modify: `apps/api/src/modules/admin/claim-requests.service.ts:303`
- Create: `apps/api/src/common/log-lines-no-email.test.ts`
- Test: `apps/api/src/modules/mail/mail.service.test.ts` (extend or create beside it)

**Interfaces:**

- Consumes: `maskEmail(value: string): string` from `apps/api/src/common/audit-log.ts`.
- Produces: nothing new.

Line numbers are from the audit at `3c64e92f0`; re-find each by its text. The full list of lines
and their quoted text is the recon report; each one interpolates `email`, `ownerEmail`,
`user.email`, `normalized` (the lowercased email) or `to`.

- [ ] **Step 1: Write the failing tests**

In `mail.service.test.ts` (spy on the service's `Logger`, a Resend double that answers
`{ error: null }` then `{ error: { name: 'validation_error', message: 'bad x@y.fr', statusCode: 422 } }`):

Build the service the way the existing `mail.service.test.ts` does (its config makes `shouldSkip`
answer false); every send takes an options object (`sendMagicLink(opts: MagicLinkEmailOptions)`,
`mail.service.ts:112`).

```ts
it('logs a sent mail with the masked address only', async () => {
  await service.sendMagicLink({ ...magicLinkOpts, to: 'jean.dupont@example.com' });
  const line = logSpy.mock.calls.flat().join(' ');
  expect(line).toContain('j***@e***');
  expect(line).not.toContain('jean.dupont@example.com');
});
it('logs a failed mail with the masked address and the error name, not its message', async () => {
  // second Resend answer above
  await expect(
    service.sendMagicLink({ ...magicLinkOpts, to: 'jean.dupont@example.com' }),
  ).rejects.toThrow();
  const line = errorSpy.mock.calls.flat().join(' ');
  expect(line).toContain('j***@e***');
  expect(line).toContain('validation_error');
  expect(line).not.toMatch(/@example\.com|x@y\.fr/);
});
```

`log-lines-no-email.test.ts`: walk `apps/api/src/**/*.ts` except `*.test.ts`; extract every call
`<x>.(log|warn|error|debug|verbose|fatal)(` with balanced parentheses (multi-line); for each
`${expr}` in it, fail when `expr` matches `/email/i` and does not start with `maskEmail(`. Report
`file:line expr`. Plus one self-check case: the extractor finds a `${user.email}` in an inline
sample string, so the guard cannot pass by finding nothing.

- [ ] **Step 2: Run, see red**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/mail src/common/log-lines-no-email.test.ts`
Expected: FAIL — the raw address in both mail tests; the guard lists the `email`-named lines.

- [ ] **Step 3: Fix every line**

Replace the raw value with `maskEmail(value)`. In `deliver`'s failure line write
`${error.name}` (and `statusCode` when present) instead of `JSON.stringify(error)`: Resend's
message can quote the address. For the same reason `deliver` throws
`Mail delivery failed: ${error.name}` (+ `statusCode`), not `error.message`: five callers write the
thrown text into their own log lines (`auth.service.ts:1656-1658`,
`admin-organizations.service.ts:890, 916`, `claim-requests.service.ts:303-305`,
`checkin/pass-email.service.ts:155`). Test: a Resend error whose `message` holds `x@y.fr` — the
thrown message lacks it. `normalized` and `to` are held by the unit tests, not by the guard (their
names do not say email); check each by hand.

- [ ] **Step 4: Run, see green**; then falsify: put the raw `to` back in `deliver`'s success line
      (Edit, grep that it landed), see the first test red with the same collected count, revert by Edit.

- [ ] **Step 5: Commit** — `fix(logs): no API log line writes a person's email, only its masked form`

### Task 2: An import failure logs the database's code, not its words

**Files:**

- Modify: `apps/api/src/modules/persons/persons.service.ts:451-452`
- Modify: `apps/api/src/modules/persons/persons.service.ts:979-982` (the global-person resolve
  line: its error can be `BadRequestException(error.message)` from a `global_persons` insert that
  carries `date_of_birth`, `global-person-resolver.service.ts:263`)
- Modify: `apps/api/src/modules/fighters/fighters.service.ts:2414-2418, 2487, 2501`
- Modify: `apps/api/src/modules/persons/csv-import.service.ts:226-227`
- Test: the three services' existing test files

**Interfaces:**

- Consumes: `databaseReason(error: { code?: string }): string`, `logReason(cause: unknown): string`
  from `apps/api/src/common/log-reason.ts`.

Why: a failed row write echoes Postgres's message, and `invalid input syntax for type date: "…"`
quotes a birth date; csv-parse's "Invalid Opening Quote … value is \"…\"" quotes a cell.

- [ ] **Step 1: Failing tests.** For each: make the write (or the parse) fail with a message that
      holds a marker (`invalid input syntax for type date: "Marker-1990"`, code `22007`; a CSV with a
      bad quote inside a cell `Marker-Name`; a resolve that throws
      `new BadRequestException('… "Marker-1990" …')`); assert the warn line contains the code in words
      (`invalid_datetime_format (22007)`; the csv error's `code`, e.g. `CSV_INVALID_OPENING_QUOTE`;
      `BadRequestException` for the resolve) and not the marker.
- [ ] **Step 2: Run, see red.**
- [ ] **Step 3: Fix.** persons row write: `databaseReason(error)`; persons resolve line:
      `logReason(resolveError)`. fighters: both call sites (`:2487`, `:2501`) pass
      `unreadable('row not saved', error)` (an `OwnWordsError` carrying the code in words) instead of
      `new Error(error.message)`, which dropped the code; `notSaved` logs `logReason(cause)` (the
      catch at `:2517` keeps passing `err`). csv-import: the error's string `code` when it has one,
      else `logReason(err)`. Change the two comments "the database's own words stay here" to say the
      line keeps the code, since the words can quote a person's value.
- [ ] **Step 4: Green; falsify one** (persons line back to `error.message`), revert.
- [ ] **Step 5: Commit** — `fix(logs): an import failure logs the database's code, not a person's value`

### Task 3: The ops-runner reads container state and one container's log

**Files:**

- Create: `infra/ops-runner/container-logs.mjs`
- Create: `infra/ops-runner/container-logs.test.mjs`
- Modify: `infra/ops-runner/server.mjs` (two routes before the `containerMatch` block; pass
  `spawnCaptureWithTimeout` and `COMPOSE_FLAGS`)

**Interfaces:**

- Produces (exports of `container-logs.mjs`):
  - `LOG_SERVICES: ReadonlySet<string>` — `traefik, redis, supabase-auth, supabase-realtime,
supabase-storage, supabase-rest, supabase-studio, api, ops-runner, worker, web-public,
web-marketing, web-staff, web-admin` (14; ruling 869: no `db`, no `supabase-meta`).
  - `LOG_EXCLUDED: ReadonlySet<string>` — `db, supabase-meta`, each with its reason in a comment.
  - `PROBLEM_LINE: RegExp` — `/"level":(40|50|60)|[Ee][Rr][Rr][Oo][Rr]|[Ww][Aa][Rr][Nn]|[Ff][Aa][Tt][Aa][Ll]/`.
  - `LOG_LINES_DEFAULT = 100`, `LOG_LINES_MAX = 500`, `LOG_LINE_MAX_CHARS = 2000`,
    `LOG_BYTES_MAX = 262144`, `LOG_ERRORS_SCAN = 2000`.
  - `parseLogQuery(url: URL): { lines: number, errorsOnly: boolean }` — throws `badRequest` (from
    `upload-store.mjs`) on a `lines` that is not a whole number in 1..500; `errors=1|true`.
  - `boundLogLines(stdout: string, { lines, errorsOnly }): { lines: string[], truncated: boolean }`
    — split, drop empty, filter by `PROBLEM_LINE` when `errorsOnly`, keep the last `lines`; a line
    over 2,000 chars is cut there, its last partial token (`/[^\s"',]*$/`) dropped, and `…[cut]`
    appended; then drop oldest until the total is ≤ 256 KiB (counted in characters);
    `truncated` when anything was cut or dropped.
  - `projectComposePs(stdout: string): Array<{ name, service, state, health, status, exitCode }>` —
    one JSON object per line (`docker compose ps --all --format json`; the runner's Compose from
    Docker's apt repo writes NDJSON, so there is no array branch); a line that is not JSON throws
    the fixed error. Fields copied by name only (`Name`, `Service`, `State`, `Health` → `null` when
    empty, `Status`, `ExitCode`), sorted by service then name (a `compose run` leftover is a row of
    its own).
  - `readContainers(run, composeFlags): Promise<{ generatedAt, containers }>`
  - `readContainerLog(run, composeFlags, service, url): Promise<{ generatedAt, service, lines, truncated }>`
    — refuses a service not in `LOG_SERVICES` with `refusal(403, 'Service not allowed.',
'service_not_allowed')` (`upload-store.mjs:22`; `sendError` relays `statusCode` and `code`); runs
    `docker compose <flags> logs --no-color --no-log-prefix --timestamps --tail <n> <service>` with
    `n = errorsOnly ? 2000 : lines`, 10 s timeout; a timeout or non-zero exit throws a plain `Error`
    with a fixed text, never stderr (the runner answers 500; the API's `opsRunnerException` turns an
    uncoded failure into 503).
  - `run` is `(command, args, timeoutMs) => Promise<{ code, stdout, stderr, timedOut }>`
    (`spawnCaptureWithTimeout`'s shape).

- [ ] **Step 1: Failing tests** (`node:test`, a fake `run` that records its argv):
  - `projectComposePs` on two real-shaped lines (one `running`/`healthy`, one `exited` with
    `ExitCode: 137`, plus extra fields `Labels`, `Command`, `Publishers`) returns only the six
    fields, `health: null` for an empty `Health`; the output's JSON has no `Labels`; a non-JSON
    line throws.
  - `readContainers` calls `run` with `['compose', ...flags, 'ps', '--all', '--format', 'json']`.
  - `readContainerLog(run, flags, 'db', url)` rejects with `statusCode` 403 and `run` was never called;
    same for `'supabase-meta'`, `'DB'`, `'../db'`, `''`, `'web-public '`.
  - `readContainerLog` for `api` with `?lines=50` calls `run` with
    `['compose', ...flags, 'logs', '--no-color', '--no-log-prefix', '--timestamps', '--tail', '50', 'api']`.
  - `?errors=1&lines=3` asks `--tail 2000` and returns the last 3 lines matching `PROBLEM_LINE`
    (input mixes `"level":30`, `"level":50`, `WARN [AuthGuard]`, a plain line).
  - `?lines=0`, `?lines=501`, `?lines=abc` throw a 400.
  - a 5,000-char line comes back at most 2,000 chars + `…[cut]` and `truncated: true`; a line whose
    2,000th char falls inside `jean.dupont@example.com` comes back with no `jean.dupont` fragment
    after the last space; 500 lines of 1,000 chars come back at most 262,144 chars in total, newest
    kept.
  - a stopped container: `run` answers `{ code: 0, stdout: '' }` → `{ lines: [], truncated: false }`.
  - `run` answers `{ timedOut: true }` → rejects; its message holds no stderr text.
  - **Parity with status.sh:** read `infra/scripts/status.sh`, assert it contains
    `PROBLEM_LINE.source` verbatim inside `errors_only_filter`.
  - **Parity with the API:** `import { AGENT_LOG_SERVICES } from '../../apps/api/src/modules/ops-agent/agent-log-services.ts'`
    (tsx is loaded by `test:scripts`; this task creates that file); assert the same members as
    `LOG_SERVICES`.
  - **Every service but the excluded:** parse the `services:` keys of
    `infra/docker-compose.prod.yml` (lines matching `^  ([a-z-]+):$` before the top-level
    `networks:` key) and assert `LOG_SERVICES ∪ LOG_EXCLUDED` equals that set, the two disjoint. A
    service added to compose later reds this test until it is sorted in or out.
- [ ] **Step 2: Run, see red.** `node --import tsx --test infra/ops-runner/container-logs.test.mjs`
- [ ] **Step 3: Implement** `container-logs.mjs` and `agent-log-services.ts`
      (`export const AGENT_LOG_SERVICES = [ …14… ] as const;` with a comment naming ruling 869 and the
      runner's mirror). Wire `server.mjs`:
      `GET /containers` → `sendJson(res, 200, await readContainers(spawnCaptureWithTimeout, COMPOSE_FLAGS))`;
      `GET /logs/<name>` (regex `^\/logs\/([^/]*)$`, the name passed raw so the refusal is the
      module's) → `readContainerLog(...)`. `readContainers` runs `docker compose <flags> ps --all --format json`
      with a 10 s timeout.
- [ ] **Step 4: Green;** `pnpm test:scripts` green. Falsify: add `db` to `LOG_SERVICES` (the
      compose-parity and refusal tests red), revert; drop `--all` (the argv test reds), revert; drop the
      partial-token step (the email-cut test reds), revert.
- [ ] **Step 5: Commit** — `feat(ops-runner): container state and one container's log, db and meta excluded`

### Task 4: One scrub for free text on the door

**Files:**

- Modify: `packages/types/src/sentry-data-collection.ts` (export `maskPassTokens`; `scrubOwnUrl` uses it)
- Create: `apps/api/src/modules/ops-agent/scrub.ts`
- Create: `apps/api/src/modules/ops-agent/scrub.test.ts`

**Interfaces:**

- Consumes: `redactText` (`apps/api/src/common/observability/redaction.ts`: Bearer, JWT, email);
  `maskPassTokens(value: string): string` (new, replaces `/event-passes/<code>` with
  `/event-passes/[token]` anywhere in a string). `PASS_TOKEN` becomes `[^/?#\s"'\\]+` after the
  prefix — today's `[^/?#]+` was built for one URL and on free text runs on to the next `/`
  (`"GET /api/v1/event-passes/CODE HTTP/2.0"` would lose ` HTTP`). A URL holds none of the added
  characters, so `scrubOwnUrl` answers as before.
- Produces: `scrubForAgent(text: string): string`; constants `REDACTED_PHONE = '[redacted-phone]'`.

Order inside `scrubForAgent`: `redactText` → user info in a URL (`(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@`
→ `$1[redacted]@`: a connection string) → percent-encoded email (`…%40…` → `[redacted-email]`)
→ secret query values (`([?&](?:token|token_hash|code|access_token|refresh_token|apikey)=)[^&\s"']+`
→ `$1[redacted]`) → `maskPassTokens` → phone → IPv4 half → IPv6 first two groups.

Phone shapes (decided here): international `+` or `00`, then 8-15 digits with optional single
separators (space, dot, dash); French national `0[1-9]` then four pairs with optional separators.
Both bounded `(?<![\w.:])` … `(?!\w)`, so a decimal (`0.00912345678`) or a digest
(`sha256:0012345678abcd`) never matches. IPv4: four dot-separated 0-255 numbers not inside a longer
dotted run. IPv6: only a form with `::` or exactly eight groups, bounded `(?<![\w:.])` …
`(?![\w:.])`, so `23:34:35` and a SQL cast `$1::uuid` never match; the mapped form
`::ffff:82.66.103.92` comes out `::ffff:82.66.x.x` (the IPv4 step runs first and the IPv6 step
leaves it).

- [ ] **Step 1: Failing tests** — one table, input → expected:
  - `sent to jean.dupont@example.com` → no `@example.com`, has `[redacted-email]`
  - `"actor_username":"a.b@club.fr"` → `"actor_username":"[redacted-email]"`
  - `GET /x?email=a.b%40club.fr` → no `club.fr` local part, has `[redacted-email]`
  - `call +33 6 12 34 56 78 or 06.12.34.56.78 or 0033612345678` → three `[redacted-phone]`
  - `"remoteAddress":"82.66.103.92"` → `"remoteAddress":"82.66.x.x"`
  - `from 2a01:e0a:1f2:3b40::5 ok` → `from 2a01:e0a:x ok`
  - `/api/v1/event-passes/AbC123xyz/qr` → `/api/v1/event-passes/[token]/qr`
  - `/auth/v1/verify?token=abc123&type=magiclink` → `token=[redacted]&type=magiclink`
  - `Authorization: Bearer eyJhbGciOi.eyJzdWIi.sig` → no `eyJ`
  - `postgres://supabase_admin:s3cret@db:5432/postgres` → `postgres://[redacted]@db:5432/postgres`
  - `"GET /api/v1/event-passes/CODE123 HTTP/2.0" 200` →
    `"GET /api/v1/event-passes/[token] HTTP/2.0" 200`
  - `{"path":"/api/v1/event-passes/[token]","statusCode":200}` → unchanged
  - `"remoteAddress":"::ffff:82.66.103.92"` → `"remoteAddress":"::ffff:82.66.x.x"`
  - **Survives unchanged** (each asserted `toBe(input)`):
    `2026-11-18T23:34:35.123456789Z`, `{"level":30,"time":1795044825752,"responseTime":2.178821001201868}`,
    `"responseTime":0.00912345678`, `sha256:0012345678abcd`, `where id = $1::uuid and d = '1'::date`,
    `[18/Nov/2026:23:34:33 +0000] "GET /rest/v1/events HTTP/2.0" 200 2 "-" "-" 50792 "myclash-rest@docker" "http://172.18.0.8:3000" 24ms`
    with only `172.18.0.8` → `172.18.x.x` changed (assert the exact expected string),
    `[Nest] 1  - 11/19/2026, 12:34:35 AM    WARN [AuthGuard] auth-shadow would-401`,
    a UUID `bc1c32e0-25b6-4a1f-9c3e-0123456789ab`, `Mapped {/health, GET} route +7ms`.
  - `scrubOwnUrl` keeps its own tests green (`packages/types`).
- [ ] **Step 2: Red.** `pnpm --filter @myclash/api exec vitest run src/modules/ops-agent/scrub.test.ts`
- [ ] **Step 3: Implement;** rebuild `@myclash/types` dist before the API test
      (`pnpm --filter @myclash/types build`).
- [ ] **Step 4: Green;** falsify each pattern once (drop the IPv4 step → its case reds; widen IPv6
      to any colon run → the timestamp case reds), revert.
- [ ] **Step 5: Commit** — `feat(ops-agent): one scrub for log text: emails, phones, half IPs, link secrets`

### Task 5: The door reads container state and logs

**Files:**

- Create: `apps/api/src/modules/ops-agent/dto/agent-logs.dto.ts`
- Create: `apps/api/src/modules/ops-agent/agent-logs.service.ts` + `.test.ts`
- Modify: `apps/api/src/modules/ops-agent/ops-agent.controller.ts` (+ `.test.ts`), `ops-agent.module.ts`
- Modify: `apps/api/src/common/auth/public-routes.test.ts:190-197, 342-346`,
  `apps/api/src/common/auth/route-authz.test.ts:48-55`

**Interfaces:**

- Consumes: `AGENT_LOG_SERVICES` (Task 3), `scrubForAgent` (Task 4), `OpsRunnerClient`
  (`apps/api/src/modules/admin/ops-runner-client.ts`; `get<T>(route)`).
- Produces:
  - `AgentLogQueryDto` (`createZodDto`): `lines` coerced int 1..500 default 100; `errors`
    `'1'|'true'|'0'|'false'` → boolean, default false.
  - `AgentLogParamDto` (`createZodDto`, `.strict()`): `{ service: z.enum(AGENT_LOG_SERVICES) }`,
    bound as `@Param() params: AgentLogParamDto` — the whole object. A bare
    `@Param('service') service: string` has metatype `String`, so `ZodOrClassValidationPipe`
    hands it to class-validator, which checks nothing (`matches.dto.ts:260-263`).
  - `AgentContainersDto = { generatedAt: string; containers: Array<{ name: string; service: string; state: string; health: string | null; status: string; exitCode: number | null }> }`
  - `AgentLogDto = { generatedAt: string; service: string; lines: string[]; truncated: boolean }`
  - `AgentLogsService.containers(): Promise<AgentContainersDto>`;
    `AgentLogsService.log(service, query): Promise<AgentLogDto>`.
  - Routes `GET /ops-agent/containers`, `GET /ops-agent/logs/:service`.

- [ ] **Step 1: Failing tests**
  - service test (fake `fetchImpl` into `new OpsRunnerClient({ opsRunnerUrl, opsRunnerSecret, fetchImpl })`):
    `log('api', { lines: 50, errors: true })` fetches exactly `${url}/logs/api?lines=50&errors=1`
    with the bearer header (assert the URL string, not only the call count); the runner's lines
    `['sent to a@b.fr, call +33 6 12 34 56 78, from 82.66.103.92']` come back
    `['sent to [redacted-email], call [redacted-phone], from 82.66.x.x']` (the spec's "a line that
    contains an email and a phone number"; a cut through an address is held by Task 3's runner
    test — no API test imports from `infra/`, since `nest build` compiles test files); an extra field
    `stderr: 'marker'` in the runner's answer is not in the result (built field by field);
    `containers()` copies only the six fields and drops an extra `Labels`.
  - controller marker test (`ops-agent.controller.test.ts:57-67`): extended to `containers()` and
    `log()`, a runner answer seeded with email, phone and IP markers; no marker in the result.
  - **HTTP test** (`ops-agent.http.test.ts`, shaped like `admin/backup-uploads.http.test.ts`:
    `configureHttpApp`, `overrideGuard(AgentKeyGuard)` — guards run before pipes, so without the
    override every answer is a 401): `GET /api/v1/ops-agent/logs/db`, `/logs/supabase-meta`,
    `/logs/DB`, `/logs/..%2Fdb`, `?lines=0`, `?lines=501`, `?lines=abc` → 400, the service double
    never called; `/logs/api?lines=50&errors=1` → 200 and the service got `('api', { lines: 50,
errors: true })`. This is what proves the controller binds the DTOs; falsify by switching the
    param to `@Param('service') service: string` (the `db` case goes 200), revert. The wall test
    scans non-test files only, so the override does not trip it.
  - `public-routes.test.ts`: add `'GET /ops-agent/containers'`, `'GET /ops-agent/logs/:service'` to
    the snapshot; the door count `5` → `7`. `route-authz.test.ts`: the door's method list gains
    `containers`, `log`; the test title says seven.
- [ ] **Step 2: Red.**
- [ ] **Step 3: Implement.** Service owns its `OpsRunnerClient` (like `AdminBackupsService`); the
      module provides it with a `useFactory: () => new AgentLogsService()` (an interface-typed
      constructor param cannot be injected — `admin.module.ts:124-141` explains). Controller doc
      comment: "seven reads"; the class comment names rulings 868-870. Refresh the comments that say
      "five reads" or "until slice 2 brings the scrub": `mask.ts` (`withoutErrorText`,
      `AgentVersionsDto`), `agent-door.wall.test.ts:4`, `agent-door.decorator.ts`, the controller —
      ruling 870 keeps `withheld`, so they now say the scrub is for log lines only.
- [ ] **Step 4: Green;** full API test run (`pnpm --filter @myclash/api test`) — the archived-lock
      ledger and route scanners only red under the full run. Regenerate the API client
      (`pnpm openapi:emit && pnpm openapi:client`; slice 1 did the same, `dbe5ab760`: "The API client
      is regenerated") and stage `packages/api-client/src/generated/schema.ts`, or
      `quality:openapi-drift` reds. Falsify: remove `scrubForAgent` from the
      service (the line test reds), revert; remove `@AgentDoor()` is already held by the wall test.
- [ ] **Step 5: Commit** — `feat(ops-agent): the door reads container state and one container's log, scrubbed`

### Task 6: Console text and ARCHITECTURE

**Files:**

- Modify: `packages/i18n/src/messages/en/admin.ts:2515`, `fr/admin.ts` (same key)
- Modify: `docs/ARCHITECTURE.md` §17.8

- [ ] **Step 1:** EN intro: "The key Claude's cloud run uses to read the platform's health,
      container states and logs. It opens read-only views and nothing else. It never sees a person's
      email, phone or date of birth, and log lines reach it with IP addresses cut in half." FR to match.
      `pnpm --filter @myclash/i18n build && pnpm --filter @myclash/i18n test`.
- [ ] **Step 2:** §17.8: "The five reads" → "The reads": add the two routes, the runner's list (14,
      no `db`, no `supabase-meta`; ruling 869), the caps and the cut, the scrub and its order (rulings
      867-868), that health reads keep `withheld` (870), that the API's loggers write `maskEmail` and
      import failures write the code.
- [ ] **Step 3:** Register rulings 867-870 in the spec's "What the operator decided" section (this
      track's register: the spec and the handoff hold 859-866), each with its story.
- [ ] **Step 4: Commit** — `docs(ops-agent): the door reads logs; the console, section 17.8 and the spec say so`

## After the tasks

0. In each task, before its commit and after `prettier --write`: re-point the complexity baseline
   for every edited file that holds a baselined function (`auth.service.ts`,
   `claim-requests.service.ts`, `admin-organizations.service.ts`, `persons.service.ts`,
   `fighters.service.ts` and any other the gate names; a new import line shifts every entry below
   it) with the targeted-merge method (per-file counts unchanged; no new long function), and stage
   the baseline in that task's commit; the identity check after the commit.
1. `gates.sh` (the full chain + DB replay; no migration in this slice, the replay job still runs).
2. A fresh whole-slice review on the most capable model; one fix pass, each fix red → green; gates.
3. Push; CI green.
4. Live check (operator runs `infra/scripts/deploy.sh`: `redeploy.sh` does not take `ops-runner`,
   `infra/scripts/redeploy.sh:55-56`): the
   throwaway routine reads `/ops-agent/containers` (at least 16 rows, `db` among them; a killed
   `compose run` can add one) and `/ops-agent/logs/api?lines=20`, `/ops-agent/logs/traefik?errors=1`;
   no `@`-address, no full IP in the answers; `/ops-agent/logs/db` and `/logs/supabase-meta` → 400.
5. Closing commit: spec slice 2 marked done with the live check; this plan deleted. Memory note,
   handoff.

## Named, not fixed (found in recon)

- Three copies of `maskEmail`: `common/audit-log.ts:90` (used here), `persons/csv-import.service.ts:254`,
  `identity/global-person-resolver.service.ts:88`.
- `OpsRunnerClient`'s "not configured" text says "Backup operations require the ops runner." — the
  agent's log read gets that sentence too.
- The API's own request line keeps the full client IP on purpose (`fastify-adapter-options.ts:41-50`,
  privacy policy §2.7), and the request log's headers carry `x-forwarded-for` on non-sensitive
  routes. Ruling 868 covers only what the agent reads.
- `phases.service.ts:1672` writes fighters' display names (names are allowed by the design).
- 4xx exception texts can name a person (`organizations.service.ts:492`) — they reach the HTTP
  reply, not the log.
- `spawnCaptureWithTimeout` decodes each stdout chunk with `String(chunk)` (`server.mjs:855`): an
  accented name split across two chunks reads as U+FFFD. Cosmetic.
- The runner's 403 `service_not_allowed` reaches the API as a 503 (`CODED_REFUSALS` has no 403,
  `ops-runner-error.ts:66`); the parity test makes that path unreachable from the door.
- The global-person resolver's own `maskEmail` keeps the whole domain (`j***@full-domain.fr`); its
  text no longer reaches a log line after Task 2.
