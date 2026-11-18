# Ops agent, slice 1 — the agent key and the door's health reads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

Revision 2 (2026-11-18): `myclash-plan-review` converged on revision 1 in two passes; a cold
`plan-reviewer` pass then found 1 BLOCKER and 3 MAJOR, all folded in here (secret-boundary gate,
door = `@Public()` + guard, the seed's `revoked` state, an off switch that needs no GoTrue).

**Goal:** Claude's cloud run can read the platform's health over HTTPS with a key that opens five
read-only routes and nothing else; a super admin sees and revokes that key on the console.

**Architecture:** A deploy step seeds one agent account and the sha256 of one key from the VPS
`.env`. The door decorator is `@Public()` plus a dedicated guard that checks the key; the global
AuthGuard does not change. On every other route the key is a login that does not verify — what a
stranger with an expired login sends. The five reads call the existing admin services and copy out
only fields that carry no person and no free text.

**Tech Stack:** NestJS 11 on Fastify, supabase-js (service role), Postgres migrations, Vitest,
`node --test` (root scripts), Next.js (web-admin), `@myclash/ui`, `@myclash/i18n`.

**Spec:** `docs/superpowers/specs/2026-11-18-ops-agent-design.md` (sections 1, 2 "Reads", the
operator guide G4 and G8, and Verification).

## Global Constraints

- RLS on every new table; no policy (a closed table); no GRANT (0247/0273 default privileges).
- Every user-facing string in `en` and `fr`; no raw id shown in the UI.
- No real person data in tests, fixtures or commits (public AGPL repo).
- Key format: `mca_` + `randomBytes(32).toString('base64url')` (43 chars) — regex
  `^mca_[A-Za-z0-9_-]{43}$`. Stored only as `createHash('sha256').update(raw).digest('hex')`.
- The agent account holds no platform role and no organisation membership; it has no password and
  is banned in GoTrue (`ban_duration: '876000h'`), re-applied on every deploy.
- The seed never un-revokes a key.
- The door reads only the `Authorization: Bearer` header, never a cookie.
- `OPS_AGENT_KEY` is a server secret: listed in `forbiddenEnvKeys`
  (`scripts/check-client-secret-boundaries.mjs:23`), so its name never appears under `apps/web-*`,
  tests included. The console names it only through `packages/i18n` messages.
- Files ≤ 400 lines, functions ≤ 50 (complexity gate). After an edit, `pnpm quality:complexity`; a
  baselined function that moved lines is re-pointed with the `myclash-gates` procedure.
- Every falsification step ("remove X, watch red, `git restore`") proves the break landed:
  `git diff --stat` shows the change, and the red run collects as many tests as the green one.
- Scripts and commit messages are written to a file with Write, then run (`git commit -F`). Stage
  explicit paths; never `git add -A`. Before the push: the `myclash-gates` chain, green.

## Decision this plan takes inside the spec's latitude

The spec (section 1) describes "a fifth identity kind `agent`" and leaves "whether the guard
resolves the key itself or a dedicated guard on the agent controller does" to the builder. This
plan takes **a dedicated guard, no fifth kind, no change to AuthGuard**. Reasons from the recon:
eleven places branch on `identity.kind` (e.g. `fightbook-caller.ts:30-34` answers 403 "A personal
account is required" to any non-claimed kind; `request-logging.middleware.ts:21-33` stops
compiling), and every other reader of the bearer sends it to the local HS256 check or to GoTrue,
both of which reject an `mca_` value (`supabase.service.ts:48-72`, `platform-role.guard.ts:86-87`,
`request-user.ts:40,58`, `lockdown.interceptor.ts:88`, `read-only.interceptor.ts:76`,
`throttle-by-account.ts:43`). So the key is accepted in one file. Task 3 proves that structure
instead of calling 755 routes.

## Review Focus

1. **A key sent to an ordinary route** → answered as an expired login (401 where the route checks
   `carriesEndedLogin`, the stranger's answer elsewhere), never as signed in. Test: Task 3.
2. **A super admin's browser cookie sent to the door** → 401; the door reads only the header.
   Test: Task 2.
3. **The key changed in the VPS `.env` and redeployed** → the old key stops working, the new one
   works, in one statement. Test: Task 6.
4. **The key emptied in the VPS `.env` and redeployed, even with GoTrue down** → every live key is
   revoked; deploy prints "agent: not configured". Test: Task 6.
5. **A key revoked on the console, then a redeploy with the same value** → the key stays revoked
   and deploy says so ("agent: key revoked — set a new OPS_AGENT_KEY"), never "key active".
   Test: Task 6. Revoke clicked twice → the second answers 404, one audit row. Test: Task 5.

---

### Task 1: The `agent_keys` table

**Files:**

- Create: `packages/db/migrations/0277_agent_keys.sql` (number re-checked at write time)
- Modify: `apps/api/src/modules/privacy/subject-export.excluded.ts:27-32` (credential group)

**Interfaces:**

- Produces: table `public.agent_keys (id uuid pk default gen_random_uuid(), user_id uuid not null
references auth.users(id) on delete cascade, label text not null, token_hash text not null
unique, created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at
timestamptz)`, index `agent_keys_user_id_idx on agent_keys(user_id)`, RLS enabled, no policy.
  The table holds agent keys only; nothing else ever writes it.

- [ ] **Step 1: Baseline.** `pnpm --filter @myclash/api exec vitest run
src/modules/privacy/subject-export.coverage.test.ts` → PASS.
- [ ] **Step 2: Write the migration.** First `git fetch` and `ls packages/db/migrations | tail -1`;
      the number is max+1 at that moment. House shape of `0276_match_protests.sql`: header ending in
      "Security posture: one new table, RLS on, no policy (service role only), no function, no grant";
      `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ENABLE ROW LEVEL
SECURITY;`, comment `-- No policies: only the service_role (BYPASSRLS) may read/write.`
- [ ] **Step 3: Run the coverage test.** Expected: FAIL naming `agent_keys` (it has `user_id`).
- [ ] **Step 4: Add `'agent_keys'` to `SUBJECT_EXPORT_EXCLUDED_TABLES`** in the credential group,
      beside `admin_user_temp_passwords`: "a machine key's hash; holds no fact about a person".
- [ ] **Step 5: Verify.** `pnpm db:review` → no new finding; `pnpm db:migrations:replay`
      (disposable `DATABASE_URL`) → applies; the coverage test → PASS.
- [ ] **Step 6: Commit** `feat(db): a table for the ops agent's key, closed to every web role`.

### Task 2: The key and the door's guard

**Files:**

- Create: `apps/api/src/modules/ops-agent/agent-key.ts`, `agent-key.guard.ts`
- Test: `apps/api/src/modules/ops-agent/agent-key.test.ts`, `agent-key.guard.test.ts`

**Interfaces:**

- Produces: `AGENT_KEY_PATTERN: RegExp`; `isAgentKey(value: string): boolean`;
  `hashAgentKey(raw: string): string` (sha256 hex); `AgentKeyGuard implements CanActivate`
  (deps: `SupabaseService` only). Slice 1 needs no actor on the request; slice 4's actions add one.
- Consumes: Task 1's table.

- [ ] **Step 1: Write the failing tests.**
  - `agent-key.test.ts`: `isAgentKey` true for `'mca_' + 'a'.repeat(43)`; false for a JWT
    (`'eyJ…'`), for 42 and 44 trailing chars, for a value with a space, for `''`.
    `hashAgentKey('mca_x')` equals `createHash('sha256').update('mca_x').digest('hex')`.
  - `agent-key.guard.test.ts` (seeded supabase double; record calls):
    - no `Authorization` header → `UnauthorizedException`; no table read.
    - only the `sb-access-token` cookie holding a valid-shape key → 401; no table read.
    - `Bearer eyJ…` → 401; no table read.
    - valid shape, no row → 401. Row with `revoked_at` set → 401.
    - live row → `true`; the read used `.from('agent_keys')`, select string
      `'id, revoked_at, last_used_at'` and `.eq('token_hash', hashAgentKey(key))` (assert the
      strings: the double ignores projections).
    - `last_used_at` null or older than 5 minutes → one `.update({ last_used_at })` by `id`;
      newer → no update.
    - the read errors → 401 (fail closed) and the error is logged.
- [ ] **Step 2: Run them.** `pnpm --filter @myclash/api exec vitest run src/modules/ops-agent`
      → FAIL (modules missing).
- [ ] **Step 3: Implement.** The `last_used_at` update does not delay the decision; its error is
      logged, never thrown. Race, named in a comment: two requests may both write `last_used_at`;
      last writer wins, which is harmless.
- [ ] **Step 4: Run them** → PASS. Falsify: delete the `revoked_at` check → the revoked-row test
      goes red → `git restore`.
- [ ] **Step 5: Commit** `feat(api): the ops agent's key is checked by one guard, from the header only`.

### Task 3: The door decorator, the scanner, and the wall

**Files:**

- Create: `apps/api/src/modules/ops-agent/agent-door.decorator.ts`,
  `apps/api/src/modules/ops-agent/agent-door.wall.test.ts`
- Modify: `apps/api/src/common/testing/route-authz-scan.ts:40` (`RouteVerdict`) and `:247-261`
  (`verdictOf`)
- Test: `apps/api/src/common/auth/route-authz.test.ts` (the `RULE` table, line 178),
  `apps/api/src/common/auth/auth.guard.test.ts` (one pin)

**Interfaces:**

- Produces: `AgentDoor(): ClassDecorator` =
  `applyDecorators(Public(), UseGuards(AgentKeyGuard))`; scanner verdict `'agent-door'`, decided
  by a class or method decorator named `AgentDoor`, checked before `'public'`.
- Consumes: `AgentKeyGuard` (Task 2), `Public` (`common/auth/public.decorator.ts`).

- [ ] **Step 1: Write the tests.**
  - `RULE` table: a class decorated `@AgentDoor()` gives `'agent-door'`, also when a method carries
    `@Public()`. (Red first: the verdict does not exist.)
  - `agent-door.wall.test.ts` (sources via the scanner's `readSources`), red first because the
    decorator file does not exist yet: in non-test sources, `AgentKeyGuard` appears only in
    `agent-key.guard.ts`, `agent-door.decorator.ts` and the module's `providers`;
    `hashAgentKey` is called only in the guard; `.from('agent_keys')` appears only in the guard and
    `agent-keys.service.ts` (Task 5); `agent-door.decorator.ts` contains both `Public()` and
    `UseGuards(AgentKeyGuard)`.
  - `auth.guard.test.ts`, enforce mode: a plain handler with `Authorization: Bearer mca_…` throws
    401 and the attached identity is `anonymous`. This is a pin (it passes today and must keep
    passing), not a red-first test.
- [ ] **Step 2: Run them.** The `RULE` row and the wall test → FAIL; the pin → PASS.
- [ ] **Step 3: Implement** the decorator and the verdict.
- [ ] **Step 4: Run them** → PASS; the whole route-authz test → `UNDECIDED=0` still holds.
      Falsify twice: (a) remove `UseGuards(AgentKeyGuard)` from the decorator → the wall test goes
      red; (b) add an `AgentKeyGuard` import to any other API file → the wall test goes red.
      `git restore` after each.
- [ ] **Step 5: Commit** `feat(api): the agent door is one decorator, and nothing else accepts its key`.

### Task 4: The five reads

**Files:**

- Create: `apps/api/src/modules/ops-agent/ops-agent.module.ts`, `ops-agent.controller.ts`,
  `mask.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts` exports (add `AdminSystemVersionsService`,
  `AdminHostInfoService`, `AdminBackupsService`); `apps/api/src/app.module.ts` imports;
  `apps/api/src/common/auth/public-routes.test.ts` (`EXPECTED_PUBLIC`, line 50);
  `apps/api/src/common/auth/route-authz.test.ts` (kind list, line 43);
  `packages/api-client/src/generated/schema.ts` (regenerated)
- Test: `apps/api/src/modules/ops-agent/mask.test.ts`, `ops-agent.controller.test.ts`

**Interfaces:**

- Produces: `@Controller('ops-agent') @AgentDoor() @Throttle(ADMIN_READ_THROTTLE)
@ApiTags('ops-agent')`, methods (each with `@ApiOperation({ summary })`):
  `runtimeHealth` `GET runtime-health` → `AdminRuntimeHealthService.collect()`;
  `host` `GET host` → `AdminHostInfoService.collect()`;
  `versions` `GET versions` → `maskVersions(await getSystemVersions())`;
  `backups` `GET backups` → `maskBackups(await AdminBackupsService.getStatus())`;
  `tls` `GET tls` → `AdminTlsStatusService.probeAll()`.
  `maskVersions(dto: SystemVersionsResponseDto): AgentVersionsDto` — drops `deploy.deployedBy`
  and the `deployedBy` component of the `deploy` group (`system-versions.service.ts:125,147`).
  `maskBackups(dto: BackupStatusDto): AgentBackupStatusDto` — **built field by field** from the
  typed fields of `dto/admin-backups.dto.ts:46-76`, leaving out `runningOperation.logTail`,
  `lastBackup.error` and `runningOperation.error` (free text from a shell; the ops runner's JSON
  arrives untyped, `backups.service.ts:58`). Slice 2's scrub may bring the errors back.
  Not on the door: alert settings (they list recipient email addresses).
- Consumes: `AgentDoor` (Task 3).

- [ ] **Step 1: Write the failing tests.**
  - `mask.test.ts`: a versions fixture whose `deploy.deployedBy` **and** `deploy`-group component
    both carry `'marker-login-7f3'` → the masked JSON contains neither the marker nor `deployedBy`;
    every other field and component survives. A backups fixture with `logTail: ['marker-line']`,
    both `error` fields `'marker-error'`, and an unknown extra key `extra: 'marker-extra'` → the
    result contains none of the three markers; the kept fields equal the input's;
    `runningOperation: null` passes through as null.
  - `ops-agent.controller.test.ts`: each method calls its service once and returns the masked or
    plain value.
  - `public-routes.test.ts`: the five door routes join `EXPECTED_PUBLIC`, and a new test asserts
    every `EXPECTED_PUBLIC` route under `ops-agent` carries `AgentKeyGuard` in `GUARDS_METADATA`
    (so a bare `@Public()` there goes red).
  - `route-authz.test.ts`: `'agent-door'` joins the kind list at line 43; a test pins the
    handlers whose verdict is `'agent-door'` to exactly the scanner keys
    `src/modules/ops-agent/ops-agent.controller.ts#OpsAgentController.{runtimeHealth,host,versions,backups,tls}`
    (keys are `file#Class.method`, `route-authz-scan.ts:279`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the module (imports `AdminModule`; provides `AgentKeyGuard`), the
      controller, `mask.ts`; register `OpsAgentModule` in `app.module.ts`.
- [ ] **Step 4: Run them** → PASS. Falsify each mask deletion separately (the `deploy.deployedBy`
      one, then the component one), and replace the field-by-field copy with a spread → `mask.test.ts`
      goes red each time; `git restore` after each.
- [ ] **Step 5: Regenerate the client and boot.** `pnpm --filter @myclash/api build &&
pnpm openapi:client`; `pnpm quality:openapi-drift` → PASS; `pnpm quality:api-docs` → PASS;
      `createApplicationContext(AppModule, { preview: true })` resolves (no new module cycle).
- [ ] **Step 6: Commit** `feat(api): the agent door reads health, host, versions, backups and certificates, with no person in them`.

### Task 5: List and revoke the key (admin API)

**Files:**

- Create: `apps/api/src/modules/ops-agent/admin-agent-keys.controller.ts`,
  `agent-keys.service.ts`
- Modify: `ops-agent.module.ts`; `apps/api/src/modules/admin/guards/platform-role-coverage.test.ts`
  (`CONTROLLERS`, line 69, **and** `EXPECTED`, line 113)
- Test: `apps/api/src/modules/ops-agent/agent-keys.service.test.ts`

**Interfaces:**

- Produces: `@UseGuards(PlatformRoleGuard) @Controller('admin/agent-keys') @ApiTags('admin')`:
  `list` `GET /` with `@PlatformRole('super_admin')` → `AgentKeyRow[]`, newest first;
  `revoke` `POST /:id/revoke` (non-GET defaults to super admin) → `AgentKeyRow`.
  `AgentKeyRow = { id: string; label: string; createdAt: string; lastUsedAt: string | null;
revokedAt: string | null }`. `AgentKeysService.list(): Promise<AgentKeyRow[]>`;
  `AgentKeysService.revoke(id: string, actorUserId: string): Promise<AgentKeyRow>`.
- Consumes: `insertAuditLog` (`common/audit-log.ts:152`), `getActorId` (`common/auth/actor.ts`).

- [ ] **Step 1: Write the failing tests.**
  - `list` selects `'id, label, created_at, last_used_at, revoked_at'` (asserted) ordered by
    `created_at` descending; it never selects `token_hash` or `user_id`.
  - `revoke` on a live row: one update `revoked_at = now` filtered by `id` **and**
    `revoked_at is null`; one audit row `{ actorUserId, action: 'agent_key.revoke',
entityType: 'agent_key', entityId: id }`.
  - `revoke` on a revoked or unknown id: `NotFoundException`; no audit row.
  - coverage: the controller joins `CONTROLLERS`; `EXPECTED` gains
    `['GET /admin/agent-keys', 'super_admin']`, `['POST /admin/agent-keys/:id/revoke', 'super_admin']`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, with `@ApiOperation({ summary })` per route. Race, named in a
      comment: two revokes at once — the `revoked_at is null` filter lets one update the row; the
      other gets 404.
- [ ] **Step 4: Run them** and the coverage test → PASS. Regenerate the client as in Task 4.
- [ ] **Step 5: Commit** `feat(api): a super admin lists and revokes the ops agent's key`.

### Task 6: The deploy seed

**Files:**

- Create: `scripts/bootstrap-ops-agent.mjs`, `scripts/bootstrap-ops-agent.test.mjs`
- Modify: `infra/scripts/deploy.sh` (a block after line 783), `apps/api/Dockerfile:151-154`
  (COPY line), `.env.example` (new optional block),
  `scripts/check-client-secret-boundaries.mjs:23` (`forbiddenEnvKeys` + `OPS_AGENT_KEY`),
  `infra/scripts/README.md` (one line)

**Interfaces:**

- Produces: `bootstrapOpsAgent({ env, gotrue, runSql }) → Promise<{ state: 'not-configured' |
'created' | 'existing' | 'revoked' | 'failed', revokedOthers: number, error?: string }>`, the
  injectable shape of `scripts/bootstrap-super-admin.mjs`. Env: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `OPS_AGENT_KEY` (optional; unset and `''` mean the
  same), `DOMAIN`. Account email `ops-agent@${DOMAIN}`, display name `Claude (ops agent)`, key
  label `Claude ops agent`.

- [ ] **Step 1: Write the failing tests** (`node --test`, as `bootstrap-super-admin.test.mjs`):
  - `OPS_AGENT_KEY` unset or `''` → state `not-configured`; exactly one SQL statement,
    `UPDATE agent_keys SET revoked_at = now() WHERE revoked_at IS NULL`; **no GoTrue call**, so a
    GoTrue double that throws changes nothing.
  - a key that fails the pattern → state `failed`; no SQL, no GoTrue call.
  - first run → GoTrue `POST /admin/users` with `email_confirm: true`, no `password`,
    `user_metadata.display_name`; then `PUT /admin/users/:id` with `ban_duration: '876000h'`; then
    one SQL statement (a CTE) that revokes the account's other live keys (`token_hash <> $2 AND
revoked_at IS NULL`) and inserts the hash with `ON CONFLICT (token_hash) DO NOTHING`; its
    parameters carry the sha256, never the raw key; state `created`.
  - the same key again → no create, the ban `PUT` sent again; state `existing`; no statement sets
    `revoked_at` to NULL (assert over every statement).
  - the stored row for that hash has `revoked_at` set → state `revoked`.
  - a new key → `revokedOthers` counts the old live key; the new hash is inserted.
  - GoTrue unreachable with a key set → state `failed`; no SQL write.
  - the printed JSON never contains the raw key.
- [ ] **Step 2: Run them.** `node --test scripts/bootstrap-ops-agent.test.mjs` → FAIL.
- [ ] **Step 3: Implement** by copying the GoTrue client and `pg` access shape of
      `bootstrap-super-admin.mjs` (lines 34-72); hash with `node:crypto`. After the CTE, read
      `revoked_at` for the hash to tell `existing` from `revoked`. The ban `PUT` on every run also
      settles whether create accepts `ban_duration` (it need not), and undoes a ban lifted from the
      Users console (`admin-users.service.ts:885-890`).
- [ ] **Step 4: Wire it.**
  - `deploy.sh`: a block in the super-admin block's style, `"${COMPOSE[@]}" run --rm
-e SUPABASE_URL="http://supabase-auth:9999" -e DATABASE_URL -e OPS_AGENT_KEY -e DOMAIN api
node /app/scripts/bootstrap-ops-agent.mjs`, the key passed by name only (ruling 425). It prints
    one of `agent: not configured`, `agent: key active (created)`, `agent: key active`,
    `agent: key revoked — set a new OPS_AGENT_KEY in .env`, or a warning on `failed`; a failure
    warns and never aborts the deploy.
  - Dockerfile COPY line; `forbiddenEnvKeys` gains `OPS_AGENT_KEY`.
  - `.env.example`: block `# ── Ops agent ───`, comment `# Optional — leave empty to keep the ops
agent off. Generate: node -e "console.log('mca_'+require('crypto').randomBytes(32).toString('base64url'))"`,
    then `OPS_AGENT_KEY=`. Not in `HUMAN_REQUIRED`, no generator in `ensure-prod-env.mjs`: an empty
    value stays empty.
- [ ] **Step 5: Verify.** The tests → PASS; `pnpm security:client-secrets` → PASS;
      `node scripts/check-observability-review.mjs` → PASS (it reads `.env.example`);
      `shellcheck -x infra/scripts/*.sh infra/scripts/lib/*.sh` on a clean checkout → clean;
      `pnpm infra:review` → PASS. Falsify: turn `DO NOTHING` into `DO UPDATE SET revoked_at = NULL` →
      the "never un-revokes" test goes red → `git restore`.
- [ ] **Step 6: Commit** `feat(deploy): the deploy seeds the ops agent's key from .env, and an empty value revokes it`.

### Task 7: The console screen

**Files:**

- Create: `apps/web-admin/app/admin/agent-keys/page.tsx`, `AgentKeysPanel.tsx`,
  `AgentKeysPanel.test.tsx`
- Modify: `apps/web-admin/src/components/admin-nav.ts` (Platform health, after Backups),
  `apps/web-admin/src/components/admin-nav.test.ts` (`RESERVED`, line 11, **and**
  `EVERY_ENTRY`, line 21), `packages/i18n/src/messages/en/admin.ts`,
  `packages/i18n/src/messages/fr/admin.ts`

**Interfaces:**

- Consumes: `GET /api/v1/admin/agent-keys`, `POST /api/v1/admin/agent-keys/:id/revoke` (Task 5),
  through `apiRequest` as `apps/web-admin/app/admin/users/useAdminUsers.ts`.
- Produces: nav item `{ href: '/admin/agent-keys', minRole: 'super_admin', labelKey:
'admin.shell.nav.agentKeys', icon: 'aiKeys' }`; keys under `admin.agentKeys.*`.

- [ ] **Step 1: Write the failing test** (pattern of `AccountsTable.roles.test.tsx`): one live and
      one revoked row render label, created date, last used ("never" when null) and status; no id text
      appears; only the live row has a Revoke button; confirming the `ConfirmDialog` sends
      `POST …/agent-keys/<id>/revoke` and refreshes; an empty list renders
      `t('admin.agentKeys.notConfigured')` — asserted through `t()`, never the literal key name.
- [ ] **Step 2: Run it.** Rebuild `@myclash/api-client` first (its schema was regenerated; the app
      reads its `dist`), then `pnpm --filter @myclash/web-admin exec vitest run app/admin/agent-keys`
      → FAIL.
- [ ] **Step 3: Implement** with `AdminPageHeader`, `DataTable*`, `ConfirmDialog` from
      `@myclash/ui`, as `AccountsPanel.tsx`. The page says, in both languages: revoking stops the key
      at once; a revoked key never comes back; to give the agent a new key, put a new value for
      `OPS_AGENT_KEY` in the VPS `.env` and deploy; to turn the agent off, empty it and deploy. That
      text lives only in the i18n messages.
- [ ] **Step 4: Run** the panel test, `admin-nav.test.ts`, `pnpm --filter @myclash/i18n test`
      (`t-key-references`, both ways) and `pnpm security:client-secrets` → PASS.
- [ ] **Step 5: Commit** `feat(admin): the console shows the ops agent's key and revokes it`.

### Task 8: Record it, gate it, push it, and the operator's step G4

**Files:**

- Modify: `docs/ARCHITECTURE.md` §17 (an "Ops agent door" subsection: the key, the one guard, the
  five reads, the seed and its states), `docs/superpowers/specs/2026-11-18-ops-agent-design.md`
  (slice 1 status; the "dedicated guard, no fifth kind" decision; guide row G4)

- [ ] **Step 1: Write the docs.** `pnpm quality:docs-drift` → PASS.
- [ ] **Step 2: Run the `myclash-gates` chain.** All green; a red gate is fixed or reported before
      the push.
- [ ] **Step 3: Commit** `docs: the ops agent door, recorded where the code is described`;
      `git log --oneline -1`, `git fetch`, push to `main`.
- [ ] **Step 4: Guide the operator through G4**, one step at a time, after the operator's
      redeploy: generate the key on the VPS with the `.env.example` command; set `OPS_AGENT_KEY` in the
      VPS `.env`; deploy; the deploy prints `agent: key active (created)`; add the same value to the
      "MyClash ops" cloud environment as the variable `OPS_AGENT_KEY` (a plain setting, per the spec's
      "What that costs").
- [ ] **Step 5: Live check.** Update the throwaway routine `trig_016FNfhEmgCbkfowUvVg8sDf` to call
      the five door routes with the staging-root bundle and `Authorization: Bearer $OPS_AGENT_KEY`, and
      `/api/v1/admin/system/runtime-health` with the same key; run it. Expected: five 200s, the admin
      route 401, the console's "last used" = just now. Disable the routine again. From the operator's
      PC, a password sign-in for `ops-agent@${DOMAIN}` is refused.

## Open questions left to the builder (none blocks)

- The agent account appears in the console's Users list and account counts as "Claude (ops
  agent)". Accepted for slice 1; hiding it would be a new rule nobody asked for.
