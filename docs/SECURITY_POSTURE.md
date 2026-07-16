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
  - `https://scoring.${DOMAIN}`
  - localhost ports 3001, 3002, and 3003 for development only
- Wildcard CORS is not used.
- Swagger/OpenAPI is disabled when `NODE_ENV=production`.
- Throttling is globally enabled through `ThrottlerModule` and `ThrottlerGuard`. Two throttlers are registered: `global` (120 req/min per client IP, overridden per route via `@Throttle` — auth actions drop to 10/hour) and `auth-email` (10 login attempts/hour per email address, on routes marked `@ThrottleByEmail`). IPs in `THROTTLE_IP_WHITELIST` skip both. See ARCHITECTURE.md §14.3 for the full table.
- The throttler store is in-memory, so counters are per API container and reset on redeploy; Traefik applies no rate limiting of its own. There is no account lockout — login is protected by the two throttlers above plus Supabase GoTrue's own internal limits.
- `pnpm security:routes` inventories every NestJS controller as public, authenticated, guest, staff, organizer, org-admin, super-admin, or mixed. CI fails when a new controller is not classified.

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

## Supply Chain And Containers

- CI runs `pnpm audit --audit-level high`.
- Dependabot is enabled for npm, GitHub Actions, and Docker.
- Gitleaks scans committed secrets.
- Trivy scans production images for high/critical vulnerabilities.
- Production Dockerfiles are multi-stage and run as non-root users.
- Known issue: app Dockerfiles currently use `node:22-alpine` style base tags through `ARG NODE_VERSION=22`. Pinning by digest is recommended before final production sign-off if the review requires zero mutable-base exceptions.

## Phase 2 Verification Commands

```bash
pnpm security:routes
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
