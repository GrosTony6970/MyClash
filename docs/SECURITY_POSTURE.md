# MyClash Security Posture

Last reviewed: 2026-05-12.

This document records the production-review security posture for MyClash. It is intentionally operational: each section points to the code, CI gate, or owner task that proves the control.

## Application Layer

- All API traffic is served by NestJS/Fastify from `apps/api`.
- Global validation is configured in `apps/api/src/main.ts` with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true`.
- CORS is an explicit allowlist built by `buildCorsOrigins()`:
  - `https://${DOMAIN}`
  - `https://app.${DOMAIN}`
  - `https://admin.${DOMAIN}`
  - `https://staff.${DOMAIN}`
  - localhost ports 3001, 3002, and 3003 for development only
- Wildcard CORS is not used.
- Swagger/OpenAPI is disabled when `NODE_ENV=production`.
- Throttling is globally enabled through `ThrottlerModule` and `ThrottlerGuard`. Three throttlers are registered (`apps/api/src/common/throttling/throttler-options.ts`): `global` (120 req/min per client IP, overridden per route via `@Throttle` — auth actions drop to 10/hour), `auth-email` (10 login attempts/hour per email address, on routes marked `@ThrottleByEmail`), and `staff-pin` (on routes marked `@ThrottleByStaffAccount`, keyed on event + username rather than `req.ip`, because an entire venue shares one NAT'd address). IPs in `THROTTLE_IP_WHITELIST` skip them. See ARCHITECTURE.md §14.3 for the full table.
- The throttler store is in-memory, so counters are per API container and reset on redeploy. There is no account lockout — login is protected by the throttlers above plus Supabase GoTrue's own internal limits.
- Traefik adds a **Fail2Ban** backstop at the edge, deliberately looser than the app throttler and aimed only at the two surfaces the throttler cannot reach: `/auth/v1/*` (proxied straight to GoTrue, so `ThrottlerGuard` is never in that path) and staff PIN login, where the app-side `staff-pin` throttler is keyed on the account rather than the IP, so the jail is the volumetric layer behind it. It counts 401/429 responses — 20/10m on auth, 60/10m on the scoring PIN, where an entire venue shares one NAT'd IP. Its allowlist is derived from `THROTTLE_IP_WHITELIST`, so both layers honour one trusted-IP list. Ban state is in-memory and per-Traefik-process. See INFRASTRUCTURE_REVIEW.md § "Edge plugins".
- Traefik also applies **GeoBlock**: a country allow-list (FR + neighbours) on admin surfaces that fails closed, and a block-list on public surfaces that fails open so a geo-IP API outage cannot dark the site.
- Authentication is global. `AuthGuard` (`apps/api/src/common/auth/`) runs on every request and rejects
  callers with no identity unless the route is marked `@Public()`, so forgetting a guard fails closed.
  It resolves all four identity types (claimed / guest / staff / anonymous) locally, with no GoTrue
  round-trip; the bounded trade-off is that a revoked token stays accepted until it expires (<=1h,
  `GOTRUE_JWT_EXP`). Authorization stays in the service layer behind `assertOrgRole`.
- The public surface is pinned by `apps/api/src/common/auth/public-routes.test.ts`, which reflects the
  real decorator metadata (not a hand-written list) and bans DELETE/PUT/PATCH from it. Exposing a route
  to the internet is therefore a reviewed diff.
- `apps/api/src/common/routes/frontend-route-contract.test.ts` asserts every `/api/v1` path the frontends
  call resolves to a real route.
- NOTE: `AUTH_GUARD_MODE` defaults to `shadow`, where AuthGuard logs the 401 it WOULD have thrown and
  lets the request through. Until it is flipped to `enforce`, the guard is observing, not protecting.
- Retired: `pnpm security:routes` maintained a hand-written map of controller -> posture. It never read a
  guard, so it could not detect that its own labels were false (7 were), and it sat red for its entire
  life. The two tests above replace it by checking behaviour instead of a declaration.

## Cookie And CSRF Posture

Cookie-backed sessions:

| Cookie             | Purpose                     | Flags                                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------ |
| `sb-access-token`  | Supabase auth access token  | `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production |
| `sb-refresh-token` | Supabase auth refresh token | `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production |
| `mc_guest`         | Event guest session JWT     | `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production |
| `mc_staff`         | Event staff session JWT     | `httpOnly`, `sameSite=lax`, `path=/`, `secure` in production |

Clear-cookie calls use matching `path`, `sameSite`, and production `secure` posture. The shared cookie helpers are tested in `apps/api/src/security/http-security.test.ts`.

CSRF posture for v1:

- API CORS allows only known MyClash origins and localhost development origins.
- Cookies use `sameSite=lax`, which blocks cross-site subresource POSTs while preserving normal top-level navigation flows.
- Mutations are additionally protected by application authorization: Supabase user sessions, event guest sessions, staff sessions, org-role checks, or super-admin checks.
- Remaining hardening: add a dedicated CSRF header/token requirement for high-risk cookie-backed mutation endpoints before broad spectator-facing cookie features are enabled.

## Auth And Supabase

- Supabase Auth handles claimed-user identity, refresh tokens, and session lifetime.
- Server-side Supabase access is isolated in `SupabaseService` and uses `SUPABASE_SERVICE_ROLE_KEY` only inside the API/server scripts.
- Frontend packages must only use `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_API_URL`.
- `pnpm security:client-secrets` scans frontend source for server-only secret env keys.
- Guest and staff JWTs use separate secrets from Supabase JWTs. Existing tests confirm guest tokens cannot be verified with the Supabase secret; staff tests cover separate staff-token validation.
- Logout/revoke flows clear the local cookie. Supabase refresh-token revocation depends on Supabase Auth session semantics and should be verified against the production Supabase project during final sign-off.
- MFA is not a Phase 2 production blocker for first deploy; it is a roadmap item for organizer/super-admin accounts.

## Secrets And Rotation

`.env.example`, `scripts/ensure-prod-env.mjs`, Docker Compose production config, and deploy scripts are the source of truth for required production secrets.

Rotation procedure:

1. Generate the replacement secret in the canonical provider or with a cryptographically strong local generator.
2. Update the production `.env` on the VPS with file mode `600`.
3. Redeploy the affected service.
4. Revoke the old provider secret where applicable.
5. Run smoke tests for the affected flow.

Rotation targets:

| Secret                      | Rotation owner | Notes                                                       |
| --------------------------- | -------------- | ----------------------------------------------------------- |
| `SUPABASE_JWT_SECRET`       | Owner          | Rotate with Supabase JWT keys; expect auth/session impact.  |
| `SUPABASE_SERVICE_ROLE_KEY` | Owner          | Server-only; redeploy API and ops scripts.                  |
| `MYCLASH_GUEST_JWT_SECRET`  | Owner          | Invalidates active guest sessions after rotation.           |
| `MYCLASH_STAFF_JWT_SECRET`  | Owner          | Invalidates active staff sessions after rotation.           |
| `COOKIE_SECRET`             | Owner          | Rotate with care; signed cookies may be invalidated.        |
| `VAPID_PRIVATE_KEY`         | Owner          | Requires push subscription validation after deploy.         |
| `AI_KEY_SECRET`             | Owner          | Re-encrypt stored BYOK keys before retiring the old secret. |
| SMTP/Resend keys            | Owner          | Rotate in provider dashboard and production env.            |
| `OPS_RUNNER_SECRET`         | Owner          | Rotate with deployment automation consumers.                |

Gitleaks runs in CI as the automated secret-scan gate.

## Data Layer And RLS

- RLS is the primary authorization boundary for Supabase-exposed tables; NestJS service-role checks are defense in depth for all API writes.
- Logic tests in `packages/db/test/rls.test.ts` cover cross-tenant denial, super-admin/platform AI access, org-admin AI settings/usage access, broadcast recipient access, tournament-query history ownership, and recent service-role-only tables.
- Service-role-only tables are represented in tests as rejecting `anon` and `authenticated` writes.
- Live Supabase/Postgres RLS verification is deferred to Phase 4 or final production sign-off because local live integration may not be available in every development environment.
- RLS does not apply to views or functions. Views must set `security_invoker = on` and `SECURITY DEFINER` functions must be revoked from `anon` and `authenticated` **by name** — `REVOKE ... FROM public` does not remove the image's default grants. Both are enforced offline by `pnpm db:review`.

### Supabase Linter Warnings We Accept

The Studio linter's ERROR-level findings were fixed in migration 0184. The remaining WARNs are
deliberate, recorded here so they are not re-litigated at every Studio visit.

**`function_search_path_mutable` (21 functions) — accepted.** All 21 are `SECURITY INVOKER`, where
a mutable `search_path` grants no escalation: the function already runs with the caller's own
rights. Shadowing is impossible regardless, because `anon`/`authenticated` hold only `USAGE` on
`public` (`infra/db/init/supabase-postgrest.sh`), never `CREATE`, and PG15+ removed `PUBLIC`'s
default CREATE on the schema. The one function that genuinely needed pinning —
`admin_runtime_db_stats`, the only `SECURITY DEFINER` read — already has it.

Pinning the rest would cost measurable performance: PostgreSQL will not inline an SQL function
carrying a `SET` clause (a non-null `proconfig` disqualifies it in `inline_function`). Ten of the 21
are RLS helpers (`is_org_member`, `event_org_id`, `has_org_role`, `is_super_admin`, …) evaluated
per row across 276 policy clauses in 29 migrations, and `immutable_unaccent` is baked into four GIN
index expressions. If this is ever revisited, use the repo's existing
`SET search_path = public, pg_catalog` form (0156/0180/0182) and **not** `SET search_path = ''`,
which would break the unqualified `similarity()` calls in `lookup_persons`, `find_club_by_name` and
`lookup_global_persons`.

**`extension_in_public` (`pg_trgm`, `unaccent`) — accepted.** Relocating them breaks
`immutable_unaccent`, which hardcodes `public.unaccent` as both the function and the dictionary
argument (0001), the four GIN indexes built on that expression, and the three functions calling
bare `similarity()`. The lint targets multi-tenant hosted hygiene; this is a single-tenant
self-hosted database where the blast radius far exceeds the benefit.

## Supply Chain And Containers

- CI runs `pnpm audit --audit-level high`.
- Dependabot is enabled for npm, GitHub Actions, and Docker.
- Gitleaks scans committed secrets.
- Trivy scans production images for high/critical vulnerabilities.
- Production Dockerfiles are multi-stage and run as non-root users.
- Known issue: app Dockerfiles currently use `node:22-alpine` style base tags through `ARG NODE_VERSION=22`. Pinning by digest is recommended before final production sign-off if the review requires zero mutable-base exceptions.

## Phase 2 Verification Commands

```bash
pnpm security:client-secrets
pnpm --filter @myclash/api test -- src/security src/modules/auth src/modules/staff src/modules/persons src/modules/admin
pnpm --filter @myclash/db test
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm audit --audit-level high
pnpm test:e2e
pnpm format:check
```
