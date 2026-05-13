# Pre-Production Code Review Plan

A staged review for shipping the platform from staging to production. Each phase has a clear scope, skill mapping, and exit criteria. Anything mechanically checkable is enforced as a CI gate (Phase 1) so human review time goes to judgment calls — RLS logic, auth coverage, query plans, error UX.

## Phase 0 — Pre-Review Baseline

**Owner: tech lead. Skill: manual. Time-box: 1h.**

Before reviewers start, lock the inputs.

- README reflects current install/run/deploy steps
- Architecture diagram up to date (services, data flow, trust boundaries)
- ADRs current — any decision made in the last sprint is captured
- **Golden paths defined in writing** (e.g., "register → create competition → score a fight → export results"). These feed Phase 8 and Phase 10.
- Exit criteria and sign-off model agreed (see end of doc)
- Review tag/branch frozen — no merges into the reviewed commit

---

## Phase 1 — CI Gates Green

**Skill: manual verification. The automated half of the checklist.**

These don't need a human review pass — they need to be _required status checks_ on the review branch. Reviewer simply confirms the CI run is green.

- `tsc --noEmit` across all packages
- `pnpm lint` clean — no suppressed warnings
- i18n `no-literal-string` rule passing
- Unit + integration tests passing, coverage at or above floor (define: e.g. 70% lines on `apps/api`, 60% on `apps/web`)
- `pnpm audit` — no high/critical
- Secret scan (gitleaks or trufflehog) clean
- Container image scan (Trivy) — no high/critical in production images
- Playwright + axe suite green (Phase 8 detail lives here too)

If any of the above currently runs only locally, the action item is **move it into CI** before review.

**Current remediation status (2026-05-12):**

- CI now includes required jobs for dependency audit, coverage, Playwright/Axe, Gitleaks secret scan, and Trivy scans of the production app images.
- `pnpm lint` is configured to fail on warnings for the API and the three active web apps. The current local lint gate exits cleanly.
- `pnpm audit --audit-level high` exits cleanly after framework/dependency upgrades; remaining advisories are moderate severity.
- `pnpm coverage` is wired through Turborepo. API coverage enforces 70% thresholds on exercised implementation files with Nest structural files excluded; web-scoring enforces 60% thresholds on the tested offline implementation. A later review should decide whether Phase 1 must expand this to every source file before production sign-off.
- `pnpm test:e2e` now starts and tears down the three Next apps through `scripts/run-e2e.mjs`; local Playwright/Axe exits normally after all 7 tests pass.
- `apps/web-public/scripts/perf-build.mjs` always rebuilds `.next` for perf budget checks so stale manifests cannot create false bundle failures.

---

## Phase 2 — Security Audit

**Skill: `/security-review`.**

**Current status (2026-05-12): Pass with known issues.** Local code review found no unresolved blocker after the Phase 2 remediation pass. The security posture is documented in [`docs/SECURITY_POSTURE.md`](./SECURITY_POSTURE.md), and CI now includes controller-classification and frontend secret-boundary checks. Known issues that remain before final production sign-off:

- Live Supabase/Postgres RLS verification still needs to run against the production-like database during Phase 4/final review.
- MFA is documented as roadmap for organizer and super-admin accounts.
- App Docker base images are still mutable `node:22-alpine` style tags; pin by digest before final sign-off if zero supply-chain exceptions are required.
- GitHub required status checks must be confirmed in repository settings after the CI run is green.

### Application-layer

- Every NestJS route has an auth guard or is explicitly marked public (no implicit public)
- All DTOs use `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true`
- CORS locked to known origins; no `*` in production
- Rate limiting on auth endpoints (login, register, password reset)
- Cookie flags: `httpOnly`, `secure`, `sameSite` (lax or strict per flow)
- CSRF posture documented for cookie-based flows

### Auth specifics (Supabase)

- JWT expiry + refresh policy explicit
- Password policy (min length, complexity if any)
- Account lockout / brute-force protection on auth endpoints
- MFA available or roadmap'd
- Session revocation works (logout invalidates refresh token)

### Secrets

- No hardcoded values anywhere (`grep` pass + secret scanner CI gate)
- `.env.example` complete and matches production keys
- Secret rotation procedure documented (who, how, frequency)
- VPS `.env` access restricted; file mode 600, owner appropriate

### Data layer

- RLS policies on every user-data table
- **RLS deny tests** — automated tests that confirm user A cannot read/write user B's rows
- Service-role key never reaches client-side code

### Supply chain

- Dependabot or Renovate enabled with auto-PR
- Image base pinned by digest (not just tag)
- Containers run as non-root user
- Multi-stage Docker builds — no build deps in production image

---

## Phase 3 — Code Quality

**Skill: `/code-review`.**

**Current status (2026-05-12): Pass with known issues.** Phase 3 now has enforceable gates for TODO/FIXME references, API documentation metadata, complexity baseline drift, and shared/API explicit `any` leaks. The API has a documented global error envelope and process-level unhandled rejection / uncaught exception logging. Remaining complexity hotspots are accepted for v1 in `docs/CODE_QUALITY_REVIEW.md` and guarded by `docs/code-quality-complexity-baseline.json`.

CI already enforces typecheck/lint. Human review focuses on:

- Dead code, TODO/FIXME audit (each TODO has a ticket or is removed)
- Consistent API error shape across all endpoints (one error contract, not three)
- No unhandled promise rejections (`unhandled-rejection` listener present, logging path verified)
- Complexity hotspots reviewed (functions > 50 lines, files > 400 lines flagged for review)
- Public APIs documented (NestJS controllers have OpenAPI annotations or equivalent)
- No `any` leaks in shared types between packages

---

## Phase 4 — Database

**Skill: `/supabase-postgres-best-practices`.**

**Current status (2026-05-12): Pass with known issues.** Repo-local Phase 4 gates now cover migration/RLS review, synthetic performance fixture drift, and DB RLS logic tests. Rollback is explicitly PITR/restore rather than down migrations; live PITR proof, timed restore drill, and production `pg_stat_statements` top-N evidence remain owner-side staging/VPS evidence before final sign-off. See `docs/DATABASE_REVIEW.md`.

- Migrations apply cleanly on a fresh DB
- **Migration rollback path verified** — either down migrations exist and work, or PITR is the documented rollback strategy with tested restore
- Indexes on foreign keys and search columns, validated with `EXPLAIN ANALYZE` on realistic data volume
- RLS policies verified per table (Phase 2 covers the deny tests)
- `pg_stat_statements` enabled — top-N slow queries reviewed at least once
- Connection pooling configured (PgBouncer or Supabase pooler) with sizing rationale documented
- Backup strategy:
  - PITR enabled
  - Off-site copy or geo-redundant
  - Retention policy explicit (e.g. 7 daily / 4 weekly)
  - **Restore drill performed** with measured restore time vs. documented RTO

---

## Phase 5 — Infrastructure & Deployment

**Manual (script + config review).**

**Current status (2026-05-13): Pass with known issues.** This Phase 5 pass is
limited to production containers plus Traefik edge/TLS because VPS hardening is
owner-confirmed done. Repo-local checks are enforced by `pnpm infra:review` and
CI. Live TLS evidence still needs to be captured after deploy with
`pnpm infra:edge -- --domain myclash.fr`. See
[`docs/INFRASTRUCTURE_REVIEW.md`](./INFRASTRUCTURE_REVIEW.md).
The 2026-05-13 live probe failed against the current DNS target because the
MyClash Traefik TLS stack is not serving the domain yet.

### Containers

- `restart: unless-stopped` on long-running services
- Health checks on every service that has a meaningful readiness signal
- Non-root user in container
- Image base pinned by digest
- Resource limits set (`mem_limit`, `cpus`) — at least sane defaults

### Edge / TLS

- Traefik TLS resolver configured
- `acme.json` permissions `600`
- HTTP → HTTPS redirect verified
- HSTS header present in production

### VPS hardening

Owner-confirmed done; excluded from the 2026-05-13 Phase 5 remediation pass.

- Firewall: only 80, 443, 22 open
- SSH: key-only auth, root login disabled
- `fail2ban` active (already in your stack — confirm jails for sshd and any exposed app endpoints)
- `unattended-upgrades` enabled for security patches
- UFW status reviewed

### Deployment scripts

- `deploy.sh` and `rollback.sh` tested on staging within the last week
- Rollback covers DB migration scenario, not just app rollback
- `.env` on VPS audited: all keys present, no placeholders, file mode 600

---

## Phase 6 — Observability & Operations

**Status: Pass with known issues (repo wiring complete; owner evidence pending).**

Evidence:

- `docs/OBSERVABILITY_REVIEW.md` records Sentry Cloud setup, uptime checks, log retention, PII rules, incident runbooks, and RTO/RPO targets.
- API has Sentry initialization, 5xx exception capture, process failure capture, and redacted JSON request logging.
- Admin, public, and scoring Next apps have Sentry SDK initialization and per-app DSN variables.
- `.env.example`, production compose, Docker build args, and `scripts/ensure-prod-env.mjs` include Sentry/release/environment configuration.
- `pnpm observability:review` is wired into CI after infrastructure review gates.

Known issues before final production sign-off:

- Owner must provide Sentry DSNs and configure Sentry projects.
- Owner must configure external uptime checks for apex, API health, app, admin, and scoring.
- Staging smoke tests must prove API and frontend errors land in Sentry with release/environment.
- Frontend source-map upload remains owner-side Sentry project/token setup.

**Manual. New phase — was missing from v1.**

You cannot run a production service blind. This is the single biggest gap in most pre-prod reviews.

### Logging

- Structured JSON logs from API and web
- PII scrubbing in place (no emails, no tokens, no full request bodies for auth routes)
- Log retention defined; logs reach a place a human can search them

### Error tracking

- Sentry (or equivalent) wired into both NestJS and Next.js
- Source maps uploaded for the frontend
- **End-to-end smoke test:** force an error in staging, confirm it lands in Sentry with a usable stack trace and breadcrumbs

### Uptime & metrics

- External uptime probe on the production URL (Uptime Kuma, Better Stack, or similar)
- Basic system metrics on the VPS (node_exporter + a dashboard, or `glances`/`netdata`)
- Disk space alert configured — VPSes die from full disks more than from anything else

### Operational readiness

- Runbook for the top 3–5 expected incidents (DB down, Traefik cert renewal failure, disk full, deploy rollback, OAuth provider outage)
- On-call / escalation path documented even if it's just "ping me on Signal"
- RTO and RPO documented per data class
- Incident log template ready

---

## Phase 7 — Performance

**Skill: `/supabase-postgres-best-practices` (queries) + `/code-review` (bundle).**

### Backend

- N+1 detection: documented method (e.g. query log review on a representative session, or `nestjs-query-logger` enabled in staging)
- Connection pool sizing rationale recorded
- Hot endpoints have a target p95 latency

### Frontend

- Next.js bundle size budget per app (e.g. < 200KB JS for the marketing pages, < 500KB for the scoring app)
- Web Vitals targets: LCP < 2.5s, INP < 200ms, CLS < 0.1 — measured on a representative page

### Load

- Lightweight load test against the most-hit endpoint (k6 or Artillery), e.g. 50 concurrent users for 5 minutes — confirms rate limits, pool sizing, and that nothing falls over

### Caching

- Cache strategy reviewed (CDN, Next.js ISR/SSG choices, API response caching where applicable)

---

## Phase 8 — Accessibility & UX

**Skill: `/accessibility`.**

- Playwright + axe tests pass (already in CI per Phase 1)
- Mobile 375px golden paths verified manually
- **Keyboard-only navigation pass** on each golden path
- **Screen reader pass** (NVDA on Windows or VoiceOver on macOS) on the most critical flow
- Color contrast verified on key surfaces (axe catches some but not all)
- Focus management on route changes and modals
- Error and loading states complete on every async action

axe alone catches ~30–40% of WCAG issues. The manual passes are not optional.

---

## Phase 9 — Compliance & Privacy

**Manual. Specific to EU-hosted user data — relevant for HEMA competitors across the EU.**

- Cookie consent present where required (analytics, non-essential cookies)
- Privacy policy and terms of service linked and current
- Data retention policy documented (how long do you keep user accounts, scores, fight videos?)
- User data export flow works (GDPR Article 15)
- User data delete flow works (GDPR Article 17) — including cascading deletes / anonymization
- PII inventory: what personal data exists where, who has access
- Sub-processor list (Supabase, Sentry, etc.) reflected in the privacy policy

---

## Phase 10 — Functional Smoke Test

**Manual on staging VPS.**

- Run each pre-defined golden path from Phase 0 end-to-end
- Verify across: desktop Chrome, mobile Safari, mobile Chrome
- Each result recorded: pass / pass with note / fail
- Failures classified as blocker or known-issue per exit criteria below

---

## Skill → Phase Map

| Skill                               | Phases         |
| ----------------------------------- | -------------- |
| CI verification                     | 1              |
| `/security-review`                  | 2              |
| `/code-review`                      | 3, 7 (bundle)  |
| `/supabase-postgres-best-practices` | 4, 7 (queries) |
| `/accessibility`                    | 8              |
| Manual                              | 0, 5, 6, 9, 10 |

---

## Exit Criteria

Each phase exits with one of three states:

- **Pass** — all items satisfied
- **Pass with known issues** — non-blockers logged with ticket numbers and target fix dates
- **Blocker** — production deploy paused until resolved

Default blocker classification:

- Any item in Phase 2 (Security)
- Any RLS deny test failing (Phase 4)
- Restore drill failing or RTO breached (Phase 4)
- Error tracking not landing errors end-to-end (Phase 6)
- Any failed golden path in Phase 10

Sign-off:

- Tech lead signs off Phases 0–5, 7
- Whoever owns ops signs off Phase 6
- Tech lead + designer sign off Phase 8
- Tech lead + product/legal contact sign off Phase 9
- Tech lead signs off Phase 10 and overall

---

## Notes

- Phases 1–9 can run in parallel where dependencies allow. Phase 10 is always last.
- A phase failing review does not necessarily block other phases starting — only the final ship.
- Re-run Phase 1 (CI) and Phase 10 (smoke) after every fix that touches the codebase.
