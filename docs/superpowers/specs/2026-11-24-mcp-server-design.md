# MCP server — design

Status: approved by the operator on 2026-11-24. Branch `feat/mcp-server` (worktree
`.claude/worktrees/mcp-server`, ruling 956's branch model). Built in four slices; each gets its own
plan in `docs/superpowers/plans/`.

## Why

Every MyClash user — organiser, fighter, referee, instructor — should be able to talk to MyClash
from their own Claude (claude.ai, the phone app, desktop, Claude Code). Claude reaches MyClash
through one MCP server hosted in the API on the VPS.

The two AI features MyClash has today — the organiser setup assistant (ARCHITECTURE §26.4) and the
natural-language tournament query (§26.6) — run on the organisation's own AI key and reach only
organisers. MCP lets each person bring their own Claude: the person pays, and fighters, referees and
instructors get an AI door for the first time. The ops-agent design
(`docs/superpowers/specs/2026-11-18-ops-agent-design.md`, Approaches table) rejected MCP for ops, and named
this case as the one where MCP is worth it: reaching production from the claude.ai chat or a phone.

## Goals

- One MCP endpoint: `https://api.${DOMAIN}/api/v1/mcp` (Streamable HTTP, stateless). `/api/mcp`
  cannot be reached: the edge routes only `/api/v1/*` to the API (`common/global-prefix.ts:15`).
- Sign-in with the person's existing MyClash account: in Claude, "Connect" → MyClash login →
  "Approve". Works on claude.ai web, Claude mobile, Claude desktop and Claude Code.
- Every tool runs as the signed-in person and sees exactly what that person sees in the app today.
- Read tools for all four personas (slices 2–3); organiser write tools (slice 4).
- Organiser writes are decided **per tool**: a small change applies after the person confirms in the
  chat; a big change becomes a draft the organiser approves in MyClash.

## Non-goals

- No scoring from Claude. Exchanges are entered on the scoring pad only (hard rules 1, 3).
- No ops / VPS tools. That is the ops agent, a separate door with its own key (`ops-agent` module).
- No personal API keys (approach B) and no home-grown OAuth server (approach C).
- No change to who may see what. MCP adds a door, never a permission.

## Anti-goals (a failure even if it works)

- A tool returns data the same person could not see in the app — e.g. a fighter reading another
  Event's staff data. RLS does not save us: the API reads with the service role.
- A second copy of the 13 tournament-query tools or of the assistant's actions. The in-app panel and
  MCP call the same code (operator: "keep both, share tools").
- A phishing door: someone registers an OAuth client named "MyClash" and tricks a user into
  approving it.
- A tool changes data before the person has seen what will change.

## Constraints (found in code and docs, 2026-11-24)

- **Auth server.** Self-hosted GoTrue `v2.195.0` (updated to 2.198 on 2026-11-24, see
  `docs/superpowers/archive/specs/2026-11-24-gotrue-2198-design.md`; `infra/docker-compose.prod.yml:239`) has an OAuth
  2.1 server — beta, since v2.180; v2.195 fixed `offline_access` for MCP refresh clients. Env:
  `GOTRUE_OAUTH_SERVER_ENABLED`, `GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH`,
  `GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION`. GoTrue does **not** support Client ID Metadata
  Documents, so Claude registers itself through Dynamic Client Registration (DCR), which must be on.
  Docs: <https://supabase.com/docs/guides/auth/oauth-server>,
  <https://supabase.com/docs/guides/self-hosting/self-hosted-oauth-server>.
- **Tokens.** An OAuth token is the normal Supabase session JWT plus a `client_id` claim, with
  `aud: "authenticated"`. AuthGuard already accepts `Authorization: Bearer` and verifies it locally
  (`common/auth/identity.ts:49-58`, `common/auth/auth.guard.ts:150-156`), so the caller becomes a
  `claimed` identity — no new identity kind. The local check ignores `iss`, `aud` and `client_id`
  (`modules/supabase/supabase.service.ts:48-73`). GoTrue ≥2.198 refuses OAuth tokens on writes and on the account endpoints (`PUT /user`,
  grants, `/logout`); `GET /user` still answers. Local verification is unaffected, but `getAuthUser` (which calls GoTrue `/user`) must stay off the
  MCP path.
- **Cookie-only readers.** `modules/auth/participant-identity.service.ts:50-53` (`resolvePersonId`,
  behind my-schedule) and `modules/follows/follow-identity.ts:22` read only the cookie; a Bearer
  caller is anonymous there. See ruling-call B below.
- **Exposure.** GoTrue is public at `app.${DOMAIN}/auth/v1/*` through Traefik with StripPrefix
  (`docker-compose.prod.yml:828-862`); there is no Kong. `GOTRUE_SITE_URL=https://app.${DOMAIN}`,
  so the consent page lives in the public app. Discovery must answer at
  `/.well-known/oauth-authorization-server/auth/v1` (RFC 8414 path-insertion form) on `app.`, which
  needs a Traefik route. `GOTRUE_JWT_ISSUER` must be the public `https://app.${DOMAIN}/auth/v1`.
- **Anthropic egress.** Claude's discovery, token and MCP calls come from `160.79.104.0/21`. fail2ban
  is the only rate control on `/auth/v1/*` and bans by IP: every user's token refresh arrives from
  that one range, so it must not get banned.
- **Throttle.** The global ThrottlerGuard allows 120 requests a minute per IP
  (`common/throttling/throttler-options.ts:73-75`). All MCP traffic shares Anthropic's IPs, so the
  MCP route throttles per user, not per IP.
- **Signing.** HS256 today. `openid` stays out of the advertised scopes (ID tokens fail on HS256).
- **SDK.** `@modelcontextprotocol/sdk` is not a direct API dependency (1.32.2 sits in the lockfile
  through `@google/genai` and `@mistralai/mistralai`). The v2 split packages exist
  (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/fastify` 2.0.1).
- **Claude's handshake.** An unauthenticated MCP request gets `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://api.${DOMAIN}/.well-known/oauth-protected-resource/api/v1/mcp"`.
  The protected-resource metadata (RFC 9728) has `resource` = the exact MCP URL and
  `authorization_servers = ["https://app.${DOMAIN}/auth/v1"]`. Callback URIs:
  `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`,
  `http://localhost:<port>/callback`, `http://127.0.0.1:<port>/callback`.
  Source: <https://claude.com/docs/connectors/building/authentication.md>.
- **Repo rules.** i18n en+fr for every user-facing string; the audit log is the one writer of actor
  history; hard rule 8 referee checks run in the existing assignment checker; no apply on a
  completed Event (rulings 283, 283a).

## Approaches

|                | Sign-in                                                   | Reach                             | Trade-off                                                                                    |
| -------------- | --------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| **A — chosen** | GoTrue's OAuth 2.1 server; we build the consent page      | claude.ai, mobile, desktop, Code  | A beta feature. DCR must be open, so the consent page is the anti-phishing wall.             |
| B              | A personal key made in MyClash settings, pasted in config | Claude Code / desktop config only | Cheapest (reuses the `agent_keys` shape), but no phone: most fighters and referees excluded. |
| C              | Our own OAuth server in the API                           | everywhere                        | No beta, full control; ~1,000 lines of security code we own for what GoTrue already gives.   |

The operator picked **A**. The operator also decided: keep the in-app assistant and query panel and
share their tools with MCP; writes are per tool (confirm in the chat for small changes, a draft in
the app for big ones).

## Operator rulings (2026-11-24)

- **963 — Soft rules in the chat: ask, then override.** Story: an organiser asks Claude to make
  Alice the referee of Match 12; Alice fights in a Pool that is running, so the checker answers
  Discouraged. Ruling: the MCP preview lists every soft-rule reason in plain words; if the person
  confirms in the chat, the apply passes `confirm: true`. Hard rules (rule 8) always refuse, with no
  override. This applies to the MCP door only; the in-app assistant keeps W1 ruling 3 ("the
  assistant never confirms", `organizer-ai-assistant.service.ts:411-457`).
- **964 — A privacy notice on the consent page.** Story: Bob asks Claude "who leads Pool 2?" —
  fighters' names, clubs and scores go to Anthropic, chosen by Bob, not by them. Ruling: the Approve
  page states, en+fr, that the data the person can see in MyClash — other people's names and results
  included — is sent to the AI they connect. One line saying the same is added to the privacy policy.
- **965 — Account holders only in v1.** Story: Chloé fights as a guest on the roster, with no
  account. Ruling: she creates an account and links her roster row the way she can today, then
  connects. No sign-up inside the consent flow.
- **966 — Fix the query-access bug while sharing the tools.** `assertAccess`
  (`tournament-query.service.ts:266-293`) gives the `organizers_head_judges` and
  `organizers_head_judges_coaches` policies no branch, so head judges and coaches are always refused.
  Ruling: the shared access check grants them as the policy names say, in both the in-app panel and
  MCP, tested both ways (slice 3).

## Calls made by Claude (the operator may overrule)

- **A. A Claude token opens the MCP door only.** AuthGuard refuses any token carrying a `client_id`
  claim on every route except `/api/v1/mcp` and its metadata. Without this, a connector token is a
  full login on ~573 routes, scoring and deletes included. The MCP route in turn requires
  `client_id`: a plain browser login sent as Bearer is refused there. Both directions tested.
- **B. MCP passes the person in; it does not re-read the login.** MCP tools resolve the person from
  the `claimed` identity and pass the person id to services. `resolvePersonId` and
  `follow-identity` stay as they are (cookie + GoTrue `/user`), so browser users see no change in
  revocation timing. Connector tokens follow AuthGuard's local check — revocation lags up to the JWT
  expiry (~1 h), the same as every Bearer caller today.
- **C. Redirect allowlist on the consent page.** The page refuses — no Approve button, a plain
  reason — when the redirect URI is not one of the Claude callback URIs above. This is the
  anti-phishing wall; another AI client later is one list entry.
- **D. MCP skips the organisation's AI key and the per-hour LLM limit** for the query tools. Both
  guard the organisation's AI spend, and MCP spends none of it. The per-user MCP throttle applies.
- **E. Confirm-in-chat uses a preview → apply pair**, not MCP elicitation (client support is uneven).
- **F. Tool descriptions are machine-facing English**, not i18n. The consent page and every MyClash
  page are i18n.

## Design

### Slice 1 — sign-in and the empty door

1. **GoTrue config** (prod and dev compose, `.env.example`): OAuth server on, DCR on,
   `AUTHORIZATION_PATH=/oauth/consent`, `GOTRUE_JWT_ISSUER=https://app.${DOMAIN}/auth/v1`.
2. **Edge.** A Traefik route on `app.${DOMAIN}` for `/.well-known/oauth-authorization-server/auth/v1`
   → GoTrue's `/.well-known/oauth-authorization-server`. fail2ban ignores `160.79.104.0/21` on the
   OAuth and token paths; the change is tested against a burst.
3. **Consent page** at `app.${DOMAIN}/oauth/consent?authorization_id=…` in the public app: signed-in
   check (else login, then back), `getAuthorizationDetails`, the client name and the **redirect host
   in plain words**, the privacy notice (964), the redirect allowlist (call C), Approve / Deny. en+fr.
   Plus the one-line privacy-policy addition.
4. **Door wall** (call A): AuthGuard refuses `client_id` tokens outside the MCP route; the MCP route
   requires `client_id`.
5. **MCP endpoint** in a new `apps/api/src/modules/mcp/` module: `POST|GET|DELETE /api/v1/mcp`,
   stateless (a new server per request), `@SkipThrottle()` plus a per-user throttle. No or invalid
   token → the 401 challenge. The handler takes the `claimed` identity from `getIdentity(req)` — one
   owner, no second JWT verifier. A cookie session does **not** satisfy MCP (Bearer only), so a
   browser cannot be driven into it cross-site.
6. **Protected-resource metadata** at
   `https://api.${DOMAIN}/.well-known/oauth-protected-resource/api/v1/mcp` (and the origin-root
   form). Needs a `global-prefix.ts` exclusion and an edge route for `/.well-known/*` on `api.`.
7. **One tool, `whoami`**: the person's display name and the roles they hold (organisations, Events
   where they fight, referee or teach). It proves the whole chain.

### Slice 2 — "my" read tools (fighter, referee, instructor, everyone)

Each wraps a service an existing `/me` route already calls. The tool passes the person from the
identity (call B), never a raw id from the model.

- `my_events` / `my_upcoming` → `me/events`, `me/upcoming`.
- `my_schedule(event)` → my-schedule: Matches, referee slots and Workshops, privacy-filtered.
- `my_fight_history` / `my_stats` → `me/dashboard`, the FightBook reads, `me/referee-stats`.
- `my_workshops` → `me/instructor-workshops`, `me/workshop-history`.
- `event_public_info(event)` → the public Event and Tournament reads through `readableEvent` /
  `canReadTournament` (Pool standings, bracket, schedule) — exactly what the public app shows.
- Events are named by slug or picked from `my_events`; the model never needs a UUID, and tool output
  carries names, not raw ids.

### Slice 3 — organiser reads (shared tournament-query tools)

- Move the 13 tools' definitions, `execute` and an **actor-aware** access check out of
  `TournamentQueryService` (today `getTournamentContext` and `assertAccess` are private,
  `tournament-query.service.ts:224,266`) into one shared owner. The in-app panel and MCP both call it.
- MCP honours the per-Tournament access policy (`tournament_query_settings`); the shared check fixes
  the head-judge and coach branches (966). MCP skips the AI-key and LLM-limit checks (call D).
- `event_status(event)` for staff (Pools behind, check-ins missing) only if an existing read covers
  it; otherwise it stays out of v1.

### Slice 4 — organiser writes

- **Small, confirm-in-chat** — v1: assign or swap a referee on a Match. Path: the route's
  `MatchesService.setRefereeRoleAssignment` (`matches.service.ts:411-455`, replaces atomically), not
  the assistant's insert-only `assignReferee`. Rule 8 is enforced by the existing checker. Two tools
  (call E): `preview_<x>` returns a plain-words summary, **every soft-rule reason when Discouraged**,
  and a short-lived confirmation token bound to the person and the exact payload, `confirm` included;
  `apply_<x>(token)` applies it (963). Tool annotations mark apply as destructive so Claude asks. The
  route writes no audit row, so the MCP tool writes one.
- **Big, draft-in-app** — create a Tournament, generate Pools, generate a bracket, schedule Matches:
  one tool creates an `organizer_ai_assistant_drafts` row through the existing
  `createDraftFromAction` path and returns a link to the assistant page, where the organiser reviews
  and presses Apply.
- Every write is audit-logged with the person as actor and the source "MCP (client name)".
- No apply on a completed Event. `EventReadOnlyGuard` locks the route, not the service, so the tool
  must reach the same lock — the builder verifies where it holds.

## Left to the builder

- SDK line (v1 `@modelcontextprotocol/sdk` or the v2 split packages) and Fastify mounting
  (`reply.hijack()` or a raw route).
- Per-user throttle numbers; the exact fail2ban jail change.
- Tool names and output shapes (structured JSON plus a short text summary).
- Whether a "Connected apps" list / revoke page is possible on GoTrue 2.195 (if yes, slice 1;
  otherwise noted).

## Verification

- **Slice 1:** an integration test drives a scripted OAuth client (DCR → authorize → consent approve
  → token, PKCE S256) against the dev stack, then calls `tools/list` and `whoami`. Unit tests: the
  401 challenge header; a cookie-only request refused on MCP; a disallowed redirect host shows no
  Approve; a `client_id` token refused on a normal route (a scoring route) and accepted on MCP; a
  token without `client_id` refused on MCP. Each guard test goes red with its guard removed. Manual:
  the connector added in claude.ai (phone) and in Claude Code (`claude mcp add --transport http`).
- **Slice 2:** per tool, a fighter sees their own schedule and gets nothing for another person's.
- **Slice 3:** the in-app panel's tests stay green after the move; a non-organiser gets the policy
  refusal through MCP; head judges and coaches get in under their policies (966).
- **Slice 4:** preview → apply happy path; a forged, expired or other-person token refused; a rule-8
  conflict refused through MCP exactly as through the route; a completed Event refused; the audit
  row written.
- **Every slice:** the `myclash-gates` chain green; `pnpm db:migrations:replay` if a migration lands.
