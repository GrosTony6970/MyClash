# Observability Review

Status: Pass with known issues
Phase scope fixed: 2026-05-13 — **content maintained since; `git log` is the authority on freshness.**

Phase 6 uses Sentry Cloud for error tracking, external uptime monitoring for public endpoints, and API-first structured JSON request logs. The repository wiring is complete; production sign-off still needs owner-supplied Sentry DSNs, external uptime checks, and staging smoke-test evidence.

## Sentry

Configured services:

- API: `SENTRY_DSN_API`
- Admin app: `NEXT_PUBLIC_SENTRY_DSN_ADMIN`
- Public app: `NEXT_PUBLIC_SENTRY_DSN_PUBLIC`
- Scoring app: `NEXT_PUBLIC_SENTRY_DSN_SCORING`

Shared metadata:

- `SENTRY_ENVIRONMENT`, default `production`
- `SENTRY_RELEASE`, falling back to `GIT_COMMIT` where supported
- `SENTRY_TRACES_SAMPLE_RATE`, default `0.05`

Tracing is on at 1-in-20 rather than off. With Prometheus deliberately not
adopted (below), Sentry performance is the only source of per-route latency,
slow-query spans and frontend web-vitals — the Runtime Health card samples the
machine every 5 minutes, not individual requests. 5% keeps event-day volume and
Sentry quota modest while still surfacing a route that regresses.

Two notes for anyone changing it:

- `ensure-prod-env.mjs` fills these keys only when **absent**. An explicit `0`
  is a real value, not a sample, so an existing production `.env` keeps its `0`
  until someone edits it by hand. Changing `.env.example` alone changes nothing.
- The `docker-compose.prod.yml` fallbacks stay `:-0`. They fire only when the
  key is missing entirely, and defaulting an outbound-data setting to _off_ when
  unconfigured is the right fail-safe. `.env` is the single owner of the rate.

Empty DSNs disable capture safely. API 5xx responses, unhandled rejections, and uncaught exceptions are sent to Sentry when configured. Next.js apps initialize the Sentry SDK for browser and server runtime capture.

Known issue: frontend source-map upload is not enabled until the owner creates Sentry projects and provides the upload token/project metadata outside git.

## Uptime And Metrics

External uptime checks must be configured by the owner for:

- `https://myclash.fr/`
- `https://api.myclash.fr/health`
- `https://app.myclash.fr/`
- `https://admin.myclash.fr/`
- `https://staff.myclash.fr/`

Expected alert routing: owner phone/email through Better Stack, UptimeRobot, or equivalent. Phase 6 intentionally does not add Prometheus, Grafana, or node_exporter.

VPS-local evidence remains:

- `infra/scripts/status.sh` for container health, disk usage, versions, and backup status.
- Docker healthchecks from `infra/docker-compose.prod.yml`.
- Existing backup/restore evidence from Phase 4.

## Logs

API request logs are JSON lines with:

- `service`
- `event`
- `requestId`
- `method`
- `path`
- `statusCode`
- `durationMs`
- optional safe `actorId`

PII rules:

- Do not log request bodies.
- Do not log raw emails, cookies, authorization headers, tokens, API keys, DSNs, or password-like fields.
- Auth, upload/import/export, AI, backup/archive, and tournament query routes are treated as sensitive and omit headers entirely.
- Technical logs can include route names and operational IDs.

Retention:

- Docker `json-file` logs rotate at `10m`, `3` files per container.
- Human-searchable long-term log aggregation is owner-side optional for v1; Sentry is the primary error investigation tool.

## Incident Runbooks

DB down:

1. Run `infra/scripts/status.sh`.
2. Check `db`, `api`, and `worker` container health.
3. If data corruption is suspected, stop writes and follow `docs/DATABASE_REVIEW.md` restore/PITR procedure.

Traefik certificate failure:

1. Run `pnpm infra:edge -- --domain myclash.fr`.
2. Inspect Traefik logs and ACME storage permissions.
3. Confirm DNS A/AAAA records point to the VPS.

Disk full:

1. Run `infra/scripts/status.sh` and `docker system df`.
2. Prune old images only after confirming the current deployment image is retained.
3. Verify backups and Postgres remain healthy after freeing space.

Rollback:

1. Use the deployment rollback script documented in `README.md`/ops docs.
2. Confirm API `/health`, public app, admin, and scoring after rollback.
3. Record the incident in the incident log.

OAuth/email outage:

1. Check Supabase Auth, SMTP/Resend status, and configured env keys.
2. Keep existing logged-in sessions active; avoid clearing cookies.
3. Post organizer-facing status update if login or transactional email is degraded.

## RTO/RPO

| Data class                   |                RTO target |               RPO target | Evidence                                              |
| ---------------------------- | ------------------------: | -----------------------: | ----------------------------------------------------- |
| Postgres tournament data     |                   4 hours | 24 hours, PITR preferred | Phase 4 restore drill plus production PITR owner task |
| Supabase storage uploads     |                   8 hours |                 24 hours | Backup archive and restore procedure                  |
| Scoring offline device queue | Event-day manual recovery |   Best effort until sync | Offline-first scoring design and device retry         |
| Logs and Sentry events       |                  24 hours |              Best effort | Sentry Cloud retention and Docker rotation            |

## Owner Evidence Checklist

- [ ] Create Sentry projects for API, admin, public, and scoring.
- [ ] Put DSNs into production `.env`; do not commit them.
- [ ] Force a staging API 500 and confirm it lands in Sentry with release/environment.
- [ ] Force a staging frontend error in each Next app and confirm it lands in the right Sentry project.
- [ ] Configure uptime checks for the five public endpoints.
- [ ] Configure a disk-space alert or external VPS monitor.
- [ ] Review incident runbooks and escalation contact.

## Verification

Repository checks:

- `pnpm observability:review`
- API redaction/logger/Sentry unit tests
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm format:check`
