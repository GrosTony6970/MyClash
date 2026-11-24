# MCP slice 1 — sign-in and the empty door: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person adds `https://api.${DOMAIN}/api/v1/mcp` to Claude, presses Connect, signs in to
MyClash, presses Approve, and Claude can call one tool, `whoami`. A Claude token opens that door and
no other.

**Architecture:** GoTrue's OAuth 2.1 server (already in `v2.195.0`) issues the tokens; Claude
registers itself by DCR. Our public app hosts the consent page; it talks only to our API, which calls
GoTrue's consent endpoints server-side with the person's login and enforces the Claude-only redirect
list. The API serves the RFC 9728 metadata and a stateless MCP endpoint behind its own door guard.
AuthGuard refuses a token carrying `client_id` everywhere else.

**Tech Stack:** NestJS 11 on Fastify, `@modelcontextprotocol/sdk` 1.32.2 (v1 line, already in the
lockfile), Next.js (web-public), Traefik labels, GoTrue env, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-mcp-server-design.md` (rulings 963–966, calls A–F).

**Branch:** `feat/mcp-server` in worktree `.claude/worktrees/mcp-server` (ruling 956's model: never
switch the shared folder; push with `git push -u origin feat/mcp-server`; a draft PR to `main`
carries CI; the operator merges).

## Global Constraints

- MCP URL: `https://api.${DOMAIN}/api/v1/mcp`. Authorization server (= `GOTRUE_JWT_ISSUER`):
  `${SUPABASE_URL}/auth/v1` → prod `https://app.${DOMAIN}/auth/v1`, dev `https://api.myclash.localhost/auth/v1`.
- Resource metadata URL: `https://api.${DOMAIN}/.well-known/oauth-protected-resource/api/v1/mcp`.
- Allowed redirect URIs, exactly: `https://claude.ai/api/mcp/auth_callback`,
  `https://claude.com/api/mcp/auth_callback`, `http://localhost:<port>/callback`,
  `http://127.0.0.1:<port>/callback` (`<port>` = 1–65535, path exactly `/callback`, no query).
- Advertised scopes: `email profile offline_access` — never `openid` (HS256 signing).
- Anthropic egress range exempt from the OAuth jail: `160.79.104.0/21`.
- A connector token = a login JWT with a non-empty `client_id` claim. It is refused (403) on every
  route without the connector-door mark, in **both** AuthGuard modes.
- The MCP door accepts only `Authorization: Bearer` with a connector token; a cookie never counts.
- Every user-facing string en+fr (`publicApp.oauthConsent.*`, `publicApp.connectedApps.*`).
  Tool names/descriptions are English (call F).
- New npm dependency: `@modelcontextprotocol/sdk` **exactly `1.32.2`** (the lockfile version — no
  new download, no release-age exclusion). After install: `git diff pnpm-workspace.yaml` must be empty.
- `whoami` returns names, never raw ids (no UUID in tool output). It lists the person's Events and
  roles there; their organisations wait for slice 3 (no existing read lists a person's
  organisations; the organiser tools need one anyway) — a narrowing of the spec's slice-1 item 7.
- Every MCP POST in tests sends `Accept: application/json, text/event-stream` and
  `Content-Type: application/json` — the SDK's transport refuses a request without both.

## Review Focus

1. **A connector token on GoTrue itself.** On 2.195, a Claude token can call `PUT /auth/v1/user`
   (email/password change); GoTrue 2.198 restricts it. Our wall cannot reach GoTrue. Not fixed in
   this slice — raised to the operator at hand-off (bump to ≥2.198 once 14 days old, i.e. after
   2026-11-30). Task 7 adds an e2e check that records today's behaviour.
2. **Auto-approve returns a redirect with no details.** A second Connect from the same client gets
   `{redirect_url}` straight from GoTrue. The API must still check that URL against the list (Task 4
   test `refuses an auto-approved redirect outside the list`).
3. **Setting `GOTRUE_JWT_ISSUER` changes `iss` on every login token**, not only Claude's. Nothing in
   the API checks `iss`; realtime and PostgREST do not either. Task 7's e2e signs in through the
   normal password door after the change and loads `/me` (test `a normal login still works`).
4. **A browser sends the cookie to the MCP door** (cross-site POST from a page the person visits).
   Bearer only (Task 3 test `refuses a cookie-only request`).
5. **The consent page reached signed out, or with a bad/expired `authorization_id`.** Signed out →
   login, then back to the same URL; bad id → a plain "this request expired, start again from
   Claude" (Task 5 tests).

---

### Task 1: The connector-token wall in AuthGuard

**Files:**

- Modify: `apps/api/src/modules/supabase/supabase.service.ts:11-73` (`SupabaseAuthUser` gains
  `clientId?: string`; `verifyAccessTokenLocally` reads a non-empty string `client_id` claim)
- Modify: `apps/api/src/common/auth/identity.ts` (`RequestWithIdentity.connectorClientId`, getter)
- Create: `apps/api/src/common/auth/connector-door.ts`
- Modify: `apps/api/src/common/auth/auth.guard.ts:76-156`
- Test: `apps/api/src/common/auth/auth.guard.test.ts`, `apps/api/src/modules/supabase/supabase.service.test.ts` (or the file that tests `verifyAccessTokenLocally` today)

**Interfaces:**

- Produces: `SupabaseAuthUser.clientId?: string`;
  `export const CONNECTOR_DOOR_KEY = 'auth:connector-door'`;
  `export const ConnectorDoor = (): CustomDecorator => SetMetadata(CONNECTOR_DOOR_KEY, true)`;
  `getConnectorClientId(req: FastifyRequest): string | null` (in `identity.ts`);
  AuthGuard throws `ForbiddenException('connector_token_outside_mcp')`.

- [ ] **Step 1: Write the failing tests** — in `auth.guard.test.ts` (sign tokens with the test
      secret the file already uses):
  - `refuses a connector token on an unmarked route, in shadow mode` → `canActivate` rejects with
    `ForbiddenException`, message `connector_token_outside_mcp`.
  - same, `in enforce mode`.
  - `lets a connector token through a ConnectorDoor route` → resolves `true`;
    `getIdentity(req)` is `{kind:'claimed', userId: sub, …}`; `getConnectorClientId(req)` = the claim.
  - `a login without client_id carries no connector client` → `getConnectorClientId(req)` is `null`.
  - `an empty client_id claim is no connector` → `null`, route allowed.
    In the supabase test: `verifyAccessTokenLocally keeps the client_id claim` → `clientId` equals it.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/common/auth/auth.guard.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement.** `resolveClaimed` attaches `connectorClientId` (wrapper only, like
      `staffSession`). In `canActivate`, right after `attach`, before the anonymous/@Public branch: when
      a connector client is present and the handler/class lacks `CONNECTOR_DOOR_KEY`, throw — regardless
      of mode. The comment says why: `getAuthUser` paths re-read the raw Bearer and would accept it.
- [ ] **Step 4: Run** the two test files → PASS; then the whole `src/common/auth` folder → PASS.
- [ ] **Step 5: Prove the wall can go red:** delete the throw, re-run, see the two refusal tests
      fail, `git restore` the file, re-run green.
- [ ] **Step 6: Commit** `feat(auth): a Claude connector token opens no door but its own`.

### Task 2: The door's addresses and the resource metadata

**Files:**

- Create: `apps/api/src/modules/mcp/mcp-urls.ts`, `apps/api/src/modules/mcp/mcp-urls.test.ts`
- Create: `apps/api/src/modules/mcp/protected-resource.controller.ts` (+ `.test.ts`)
- Create: `apps/api/src/modules/mcp/mcp.module.ts`; register in `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/global-prefix.ts:28` (exclusion + its reason in the doc comment)

**Interfaces:**

- Produces: `mcpUrls(env: { DOMAIN: string; SUPABASE_URL: string }): McpUrls` with
  `interface McpUrls { resource: string; resourceMetadata: string; authorizationServer: string }`;
  `PROTECTED_RESOURCE_PATHS = ['.well-known/oauth-protected-resource/api/v1/mcp', '.well-known/oauth-protected-resource'] as const`;
  `MCP_SCOPES = ['email', 'profile', 'offline_access'] as const`.

- [ ] **Step 1: Failing tests.** `mcp-urls.test.ts`: `DOMAIN=myclash.fr, SUPABASE_URL=https://app.myclash.fr/`
      → `resource` `https://api.myclash.fr/api/v1/mcp`, `resourceMetadata`
      `https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp`, `authorizationServer`
      `https://app.myclash.fr/auth/v1` (trailing slash trimmed); dev values give
      `https://api.myclash.localhost/auth/v1`. Controller HTTP test (pattern: `ops-agent.http.test.ts`,
      `configureHttpApp` + the real prefix exclusion): both paths answer 200, no login, JSON
      `{ resource, authorization_servers: [authorizationServer], scopes_supported: [...MCP_SCOPES], bearer_methods_supported: ['header'] }`;
      `/api/v1/.well-known/...` is 404.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/mcp` → FAIL.
- [ ] **Step 3: Implement.** Controller is `@Public()`, `@ApiExcludeController()`, one `@Get` per path
      reading `mcpUrls` from `ConfigService`. Add both paths to `API_GLOBAL_PREFIX_EXCLUDE`; the comment
      says they are served on `api.${DOMAIN}` only, which is the host Claude asks (the `myclash-api`
      router sends the whole host to the API).
- [ ] **Step 4: Run** → PASS. Add both `GET` paths to `EXPECTED_PUBLIC` in
      `common/auth/public-routes.test.ts` under a `// ── MCP connector discovery ──` heading; run it → PASS.
- [ ] **Step 5: Commit** `feat(mcp): the door's addresses, published for Claude to find`.

### Task 3: The MCP door — guard, endpoint, `whoami`, throttle

**Files:**

- Modify: `apps/api/package.json` (`"@modelcontextprotocol/sdk": "1.32.2"`), `pnpm-lock.yaml`
- Create: `apps/api/src/modules/mcp/mcp-door.guard.ts` (+ `.test.ts`)
- Create: `apps/api/src/modules/mcp/mcp-door.decorator.ts`
- Create: `apps/api/src/modules/mcp/mcp.controller.ts` (+ `mcp.http.test.ts`)
- Create: `apps/api/src/modules/mcp/mcp-server.ts` (builds one `McpServer` per request, registers tools)
- Create: `apps/api/src/modules/mcp/tools/whoami.ts` (+ `.test.ts`)
- Create: `apps/api/src/common/throttling/throttle-mcp.ts`; modify `throttle-profiles.ts`,
  `throttler-options.ts` (+ `throttler-options.test.ts`)
- Modify: `apps/api/src/common/testing/route-authz-scan.ts:41,256` (verdict `'mcp-door'`),
  `common/auth/route-authz.test.ts` (kinds list + `opens the MCP door on exactly the MCP routes`),
  `common/auth/public-routes.test.ts` (`MCP_DOOR_POSTS`, `closes every mcp-door route with the MCP guard`)

**Interfaces:**

- Consumes: Task 1 `ConnectorDoor`, `getConnectorClientId`, `getIdentity`; Task 2 `mcpUrls`.
- Produces: `McpDoor(): ClassDecorator` = `applyDecorators(Public(), ConnectorDoor(), UseGuards(McpDoorGuard), SkipThrottle({ global: true }), ThrottleMcp(), ApiExcludeController())`;
  `McpDoorGuard.canActivate` → `true`, or writes the 401 itself;
  `buildMcpServer(caller: McpCaller, deps: McpToolDeps): McpServer` with
  `interface McpCaller { userId: string; email: string | null; clientId: string }`,
  `interface McpToolDeps { meEvents: MeEventsService }` (later slices add fields);
  `whoami(caller, deps): Promise<WhoAmI>` with
  `interface WhoAmI { email: string | null; events: { name: string; slug: string; startDate: string | null; roles: ('fighter' | 'referee' | 'instructor' | 'workshop participant')[] }[] }`;
  `MCP_THROTTLER = 'mcp'`, `MCP_THROTTLE = { limit: 120, ttl: 60_000 }` per account.

- [ ] **Step 1: Install.** `pnpm --filter @myclash/api add @modelcontextprotocol/sdk@1.32.2 --save-exact`;
      `git diff pnpm-workspace.yaml` → empty (else revert per `reference_pnpm_release_age_silent_exclude`).
- [ ] **Step 2: Failing guard tests** (`mcp-door.guard.test.ts`):
  - `answers 401 with the resource-metadata challenge when no Bearer is sent` → status 401, header
    `WWW-Authenticate` = `Bearer resource_metadata="https://api.myclash.fr/.well-known/oauth-protected-resource/api/v1/mcp", scope="email profile offline_access"`.
  - `refuses a cookie-only request` (valid connector token in `sb-access-token`, no header) → same 401.
  - `refuses a browser login sent as Bearer (no client_id)` → 401 with `error="invalid_token"` in the challenge.
  - `refuses an expired connector token` → 401 `invalid_token`.
  - `lets a connector Bearer through` → `true`.
- [ ] **Step 3: Failing tool test** (`whoami.test.ts`, `MeEventsService` double):
      `maps each Event to its name, slug and role words` — `listMyEvents` is called with
      `{ userId, staff: null }`; roles `{isCompetitor:true,isReferee:true}` → `['fighter','referee']`;
      output JSON contains no `id` key at any depth.
- [ ] **Step 4: Failing HTTP test** (`mcp.http.test.ts`, real `configureHttpApp`, guard overridden to
      set a caller as `ops-agent.http.test.ts` does): POST `initialize` → 200 with `serverInfo.name`
      `myclash`; POST `tools/list` → exactly `['whoami']`; POST `tools/call whoami` → its result;
      `GET` and `DELETE` → 405 with `Allow: POST`.
- [ ] **Step 5: Run** `pnpm --filter @myclash/api exec vitest run src/modules/mcp src/common/throttling` → FAIL.
- [ ] **Step 6: Implement.** Guard: `presentedLogin` must come from the header (`authorization`
      present, Bearer); identity `claimed` and `getConnectorClientId` non-null; otherwise write the 401 via
      `reply.header(...).code(401).send({ error })` and return `false`. Controller: `@McpDoor()
@Controller('mcp')`; `@Post()` takes `@Req()`/`@Res()`, calls `reply.hijack()`, then a fresh
      `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` and
      `buildMcpServer(...)`, `server.connect(transport)`, `transport.handleRequest(req.raw, reply.raw, req.body)`,
      and closes both on `reply.raw` `close`. `@Get()`/`@Delete()` answer 405. Throttle files mirror
      `throttle-fightbook-ask.ts` (account-keyed, own bucket, skips unmarked routes). Scanner: `McpDoor`
      checked before `Public`, like `AgentDoor`.
- [ ] **Step 7: Run** the step-5 command, then `src/common/auth` → PASS.
- [ ] **Step 8: Prove reds:** remove the header-only check → `refuses a cookie-only request` fails;
      remove the `client_id` check → `refuses a browser login` fails; `git restore` each.
- [ ] **Step 9: Image boots.** `pnpm infra:review` → green (new third-party dep under apps/api).
      Build the api image and boot both roles (`node apps/api/dist/main.js` and `--worker` in the
      container), read `docker logs`, not `docker ps` (`reference_docker_workspace_node_modules_copy`).
- [ ] **Step 10: Commit** `feat(mcp): the door, its guard, and whoami`.

### Task 4: The consent API (server-side GoTrue calls + the Claude-only list)

**Files:**

- Create: `apps/api/src/modules/mcp/claude-callbacks.ts` (+ `.test.ts`)
- Create: `apps/api/src/modules/mcp/oauth-consent.service.ts` (+ `.test.ts`)
- Create: `apps/api/src/modules/mcp/oauth-consent.controller.ts`, `dto.ts` (Zod)
- Regenerate: `packages/api-client/src/generated/schema.ts` (the repo's OpenAPI emit script)

**Interfaces:**

- Produces: `isClaudeCallback(uri: string): boolean`;
  `describeCallback(uri: string): 'claude' | 'this-computer' | null`;
  `GET /api/v1/oauth-consent/:authorizationId` →
  `ConsentView = { kind: 'ask'; clientName: string; callback: 'claude' | 'this-computer'; scopes: string[] } | { kind: 'refused'; reason: 'not-claude'; redirectHost: string } | { kind: 'go'; redirectUrl: string } | { kind: 'expired' }`;
  `POST /api/v1/oauth-consent/:authorizationId` body `{ action: 'approve' | 'deny' }` →
  `{ redirectUrl: string }` or 403 `not_claude` or 410-style `{ kind:'expired' }` (404 from GoTrue → `expired`).

- [ ] **Step 1: Failing tests.** `claude-callbacks.test.ts`: true for the four forms in Global
      Constraints (ports 1, 53682, 65535); false for `https://claude.ai/api/mcp/auth_callback?x=1`,
      `https://evil.claude.ai/api/mcp/auth_callback`, `http://localhost:0/callback`,
      `http://localhost:8080/callback/x`, `https://localhost:8080/callback`, `http://192.168.1.2:80/callback`.
      `oauth-consent.service.test.ts` (fetch stubbed; assert URL `${SUPABASE_AUTH_INTERNAL_URL}/oauth/authorizations/<id>`,
      headers `apikey` + `Authorization: Bearer <person's token>`, and **no `Origin` header**):
  - `asks for a Claude client` → `{kind:'ask', clientName, callback:'claude'}`.
  - `refuses a client outside the list` → `{kind:'refused', reason:'not-claude', redirectHost:'evil.example'}`.
  - `refuses an auto-approved redirect outside the list` (GoTrue answers `{redirect_url:'https://evil.example/cb?code=x'}`) → `refused`.
  - `passes an auto-approved Claude redirect` → `{kind:'go', redirectUrl}`.
  - `approve re-reads the details first and denies a client outside the list` → GoTrue receives
    `POST …/consent {"action":"deny"}`, service throws `ForbiddenException('not_claude')`.
  - `approve on a Claude client posts approve and returns the redirect`.
  - `GoTrue 404 reads as expired`.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/mcp` → FAIL.
- [ ] **Step 3: Implement.** Controller uses `requireRequestUserId` (a claimed browser login; a
      connector token never reaches it — Task 1) and the person's raw token (`AuthService.extractToken`
      pattern). Timeout `GOTRUE_TIMEOUT_MS`. Zod DTO for the body.
- [ ] **Step 4: Run** → PASS. Emit OpenAPI and regenerate the client; run the OpenAPI drift gate.
- [ ] **Step 5: Prove the red:** make `isClaudeCallback` return `true` → the three refusal tests fail; `git restore`.
- [ ] **Step 6: Commit** `feat(mcp): the consent API asks GoTrue, and lets only Claude through`.

### Task 5: The consent page and the privacy line

**Files:**

- Create: `apps/web-public/app/oauth/consent/page.tsx`, `layout.ts`, `consent-requests.ts` (+ `consent-requests.test.ts`), `ConsentCard.tsx` (+ `ConsentCard.test.tsx`)
- Modify: `packages/i18n/src/messages/{en,fr}/publicApp.ts` (`oauthConsent.*`, `titles.oauthConsent`)
- Modify: `apps/web-marketing/src/pages/privacypolicy.astro`, `apps/web-marketing/src/pages/en/privacypolicy.astro` (one paragraph: AI connectors)

**Interfaces:**

- Consumes: Task 4 routes and `ConsentView`.
- Produces: `fetchConsent(id): Promise<ConsentView | { kind:'network' }>`; `answerConsent(id, action): Promise<{ redirectUrl } | { kind:'refused' | 'expired' | 'network' }>`.

- [ ] **Step 1: Failing tests** (`ConsentCard.test.tsx`, pattern from `JoinEventPanel.test.tsx`):
  - `ask` view shows the client name, "Claude" as where you go back, the privacy notice text
    (`oauthConsent.privacy`), Approve and Deny buttons.
  - `refused` view shows `oauthConsent.refused` with the host and **no Approve button**.
  - `expired` view shows `oauthConsent.expired` and no buttons.
  - Approve click calls `answerConsent(id,'approve')` then `window.location.assign(redirectUrl)`.
    `consent-requests.test.ts`: a `/me` answer of `anonymous` → the page sends to
    `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3D<id>` (via `loginHref`).
- [ ] **Step 2: Run** `pnpm --filter web-public exec vitest run app/oauth` → FAIL.
- [ ] **Step 3: Implement** on the `me/claim-confirm` pattern (`useI18n`, `useSearchParams`,
      `apiRequest(getPublicApiUrl(), …)`, `<Suspense>`). Copy, en (fr mirrors it):
  - `title`: "Connect {client} to your MyClash account"
  - `back`: "After you approve, you go back to {where}." (`where` = "Claude" / "Claude Code on this computer")
  - `privacy`: "Claude will see what you can see in MyClash, including other people's names and results, and send it to Anthropic to answer you. You can disconnect at any time from Account › Security."
  - `refused`: "MyClash only connects to Claude. This request would send your account to {host}, so it was refused."
  - `expired`: "This request has expired. Start again from Claude."
- [ ] **Step 4: Run** the step-2 command, then the i18n sweep directly (`pnpm --filter @myclash/i18n test`, turbo caches it) → PASS.
- [ ] **Step 5: Commit** `feat(web-public): the consent page, with the privacy notice`.

### Task 6: Connected apps (list and disconnect)

**Files:**

- Create: `apps/api/src/modules/mcp/connected-apps.service.ts`, `connected-apps.controller.ts` (+ tests)
- Create: `apps/web-public/app/me/security/ConnectedAppsSection.tsx` (+ test); modify `page.tsx`, `security-requests.ts`
- Modify: i18n `publicApp.connectedApps.*` en+fr; regenerate the API client

**Interfaces:**

- Produces: `GET /api/v1/me/connected-apps` → `{ apps: { clientId: string; name: string; grantedAt: string }[] }`
  (from GoTrue `GET /user/oauth/grants` with the person's token);
  `DELETE /api/v1/me/connected-apps/:clientId` → 204 (GoTrue `DELETE /user/oauth/grants?client_id=`).
  `clientId` is the only id kept, as a button key — never rendered.

- [ ] **Step 1: Failing tests.** Service: asserts the GoTrue URL, Bearer token, and maps
      `{client:{id,name},granted_at}`; a GoTrue 404 on delete → 204 (already gone). Section: lists names
      with a "granted on" date, Disconnect calls DELETE and removes the row; empty → `connectedApps.none`.
- [ ] **Step 2: Run** API + web-public tests → FAIL.
- [ ] **Step 3: Implement.** The section says that a disconnect stops Claude within the hour (access
      tokens live until `exp`). Copy en: `title` "Connected apps", `none` "No app is connected to your
      account.", `granted` "Connected on {date}", `disconnect` "Disconnect", `lag` "Claude may keep access for up to an hour after you disconnect."
- [ ] **Step 4: Run** → PASS; i18n sweep directly.
- [ ] **Step 5: Commit** `feat(me): see and disconnect the apps connected to your account`.

### Task 7: Turn it on — GoTrue env, the edge, the jail, and the e2e

**Files:**

- Modify: `infra/docker-compose.prod.yml` (supabase-auth env :230-277; Traefik labels near :840-868; traefik jail labels :112-158)
- Modify: `infra/docker-compose.dev.yml:148-190`, `infra/scripts/lib/traefik-env.sh:68-75`
- Modify: `scripts/check-infra-review.mjs` (`publicRouters`, `geoblockRouters`, `fail2banRouters`, new pins) (+ its test)
- Create: `tests/e2e/48-mcp-connector.spec.ts`

- [ ] **Step 1: Failing infra:review pins** (extend its test the way the signup refusal is pinned):
      prod and dev GoTrue env has `GOTRUE_OAUTH_SERVER_ENABLED: 'true'`,
      `GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION: 'true'`,
      `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH: /oauth/consent`, `GOTRUE_OAUTH_SERVER_DEFAULT_SCOPE: email`,
      `GOTRUE_JWT_ISSUER: https://app.${DOMAIN}/auth/v1` (dev `https://api.myclash.localhost/auth/v1`);
      router `myclash-auth-discovery` (`Host(app.${DOMAIN}) && Path(/.well-known/oauth-authorization-server/auth/v1)`,
      replace-path middleware to `/.well-known/oauth-authorization-server`, `${MW_GEO_PUBLIC}`, security headers);
      router `myclash-auth-oauth` (`PathPrefix(/auth/v1/oauth/)`, priority 30, `${MW_F2B_OAUTH}` + strip);
      jail `myclash-fail2ban-oauth` = the auth jail's numbers, `allowlist.ip` = `${TRAEFIK_BAN_ALLOWLIST}` plus `160.79.104.0/21`.
- [ ] **Step 2: Run** `pnpm infra:review` → FAIL on each pin.
- [ ] **Step 3: Implement** the compose/labels/`traefik-env.sh` (`MW_F2B_OAUTH`, emptied by
      `TRAEFIK_PLUGINS=off` like the others). No `.env.example` key: all values are literal or derived.
- [ ] **Step 4: Run** `pnpm infra:review` and `node --test scripts/check-edge-plugins.test.mjs` → PASS.
- [ ] **Step 5: Write the e2e** `48-mcp-connector.spec.ts` (skips unless `FIGHTER_LOGINS` has A; runs
      against `publicBase`), one `test.describe.serial`:
  1. `a normal login still works` — fighter A signs in by password, `/api/v1/me` is `claimed`.
  2. `discovery answers` — `GET {api}/.well-known/oauth-protected-resource/api/v1/mcp` has the
     resource; `GET {app}/.well-known/oauth-authorization-server/auth/v1` has `registration_endpoint`.
  3. `Claude Code's flow` — DCR with `redirect_uris:['http://127.0.0.1:53682/callback']`,
     `token_endpoint_auth_method:'none'`; open `/authorize` (S256 challenge) in A's context; on the
     consent page press Approve; capture the code from the `127.0.0.1` navigation (`page.route` it);
     exchange at `/oauth/token` with the verifier; POST `initialize`, `tools/list` (= `['whoami']`),
     `tools/call whoami` (A's email).
  4. `the token opens no other door` — the access token on `GET /api/v1/me/events` → 403.
  5. `a stranger's client is refused` — DCR with `https://evil.example/cb`; the consent page shows
     the refusal and no Approve button.
  6. `GoTrue's own /user with a connector token` — record the status of `GET {app}/auth/v1/user`
     (expect 200 on 2.195; the test asserts the value and names Review Focus 1 in its message).
  7. `disconnect` — `/me/security` lists the client; Disconnect; a refresh at `/oauth/token` now fails.
- [ ] **Step 6: Commit** `feat(infra): GoTrue's OAuth server on, its discovery route and jail; the connector e2e`.

### Task 8: Docs and the closing commit

**Files:**

- Modify: `docs/ARCHITECTURE.md` (new §27 "MCP connector": the door, the wall, consent, URLs, the jail)
- Modify: `docs/ENGINEERING_LESSONS.md` (auth section: the two login checks — guard vs `getAuthUser` — and why the wall throws in both modes)
- Delete: this plan (`docs/superpowers/plans/2026-11-24-mcp-slice1-sign-in.md`); the spec stays in `specs/` until slice 4.

- [ ] **Step 1:** Write the sections; run `pnpm format:check` (or the repo's docs gate) → green.
- [ ] **Step 2:** The full `myclash-gates` chain → green.
- [ ] **Step 3: Commit** `docs(mcp): slice 1 in ARCHITECTURE; plan closed`; `git fetch`, rebase on
      `origin/main`, push the branch, open the draft PR to `main`.

## Operator-only, after the push

- Redeploy (the 5-flag routine) so GoTrue reads the new env and Traefik the new routers.
- Run `tests/e2e/48-mcp-connector.spec.ts` against production.
- Add the connector in claude.ai on a phone: Settings › Connectors › Add custom connector →
  `https://api.myclash.fr/api/v1/mcp`; Connect; ask "who am I on MyClash?".
- Decide Review Focus 1 (GoTrue ≥2.198).
