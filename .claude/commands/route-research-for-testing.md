---
description: Map edited API routes & smoke-test them
argument-hint: '[/extra/path …]'
allowed-tools: Bash(git:*), Bash(cat:*), Bash(awk:*), Bash(grep:*), Bash(sort:*), Bash(xargs:*), Bash(sed:*)
model: inherit
---

## Context

Controllers changed against `main` (auto-generated):

!git diff --name-only main...HEAD -- apps/api/src | grep controller | sort -u; git diff --name-only -- apps/api/src | grep controller | sort -u

User-specified additional routes: `$ARGUMENTS`

## Your task

Follow the numbered steps **exactly**:

1. Combine the auto-detected controllers with `$ARGUMENTS` and dedupe. Resolve each route's full
   path as `API_GLOBAL_PREFIX` + the `@Controller('…')` prefix + the method decorator's path —
   `apps/api/src/main.ts:71` applies the global prefix with an `exclude` list, so check
   `API_GLOBAL_PREFIX_EXCLUDE` before assuming a route is prefixed. (`/health` and friends answer
   **only** on `api.${DOMAIN}`, not under the prefix.)

2. For each final route, output a JSON record with the path, method, guard/role requirements, and
   valid + invalid payload examples. Read the guards rather than guessing: a global `AuthGuard`
   means every route needs identity unless it carries `@Public()`, and `@PlatformRole('…')` on a
   GET is a **silent no-op** because `PlatformRoleGuard` defaults by verb.

3. Smoke-test them yourself against the local stack — do not dispatch a subagent.
   - `/api/v1` on `http://localhost:4000`; Swagger at `/api/docs`.
   - Auth is **httpOnly cookies**, not a bearer header: sign in and reuse the jar (`curl -c`/`-b`).
   - The global `ValidationPipe` runs `whitelist` + `forbidNonWhitelisted`, so an unexpected
     property is a 400 rather than a silent drop.
   - Bodies of status >= 500 are scrubbed, so read the API logs for those.
   - For flows needing realistic data, drive `tests/e2e/` rather than hand-rolling fixtures.

4. Report per route: exists/registered, happy path, validation failures, authorization refusals
   (wrong role, wrong org, anonymous), the persisted effect, and the response shape.
