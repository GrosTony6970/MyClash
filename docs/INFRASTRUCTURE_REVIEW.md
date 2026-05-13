# Infrastructure Review

Phase 5 covers production containers and Traefik edge/TLS only. VPS hardening
is owner-confirmed complete and is excluded from this pass.

## Status

**Current status (2026-05-13): Pass with known issues.**

Repo-local container and edge configuration checks are automated through
`pnpm infra:review`. Live TLS evidence was attempted from this workstation, but
the current DNS target is not serving the MyClash TLS stack yet. Re-run after
the latest stack is deployed to `myclash.fr` with:

```bash
pnpm infra:edge -- --domain myclash.fr
```

## Container Inventory

Production compose defines the expected v1 services: Traefik, Postgres, Redis,
Supabase Auth, Supabase Realtime, Supabase Storage, API, ops-runner, worker,
web-public, web-marketing, web-scoring, and web-admin.

Repo-verified controls:

- Long-running services use `restart: unless-stopped`.
- Services use `json-file` log rotation with `max-size: 10m` and `max-file: 3`.
- Public app/API services run behind the private `myclash` Docker bridge and are
  exposed only through Traefik labels.
- App Dockerfiles use multi-stage builds and non-root runtime users.
- `ops-runner` remains internal-only, has no Traefik router labels, and is
  documented as the privileged backup/restore exception because it mounts the
  Docker socket.
- Resource limits are set on production services.
- Healthchecks exist for services with meaningful local readiness signals.

## Edge / TLS

Repo-verified controls:

- Traefik redirects HTTP to HTTPS on the `web` entrypoint.
- Let's Encrypt TLS resolver `letsencrypt` uses TLS challenge and ACME storage
  at `/data/acme.json`.
- `infra/scripts/deploy.sh` creates the ACME file and enforces mode `600`.
- Public routers use the `myclash-security-headers@docker` middleware.
- HSTS is enabled with `max-age=31536000; includeSubDomains`.
- HSTS preload is intentionally disabled for v1.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
  `Referrer-Policy: strict-origin-when-cross-origin` are configured at Traefik.

Live evidence to capture after deploy:

```bash
pnpm infra:edge -- --domain myclash.fr
```

This checks apex, `www`, `api`, `app`, `admin`, and `scoring` HTTP-to-HTTPS
redirects, TLS certificate expiry, HSTS headers, and `https://api.myclash.fr/health`.

Observed on 2026-05-13 before deploy: `pnpm infra:edge -- --domain myclash.fr`
failed because apex/`www` resolve to an OVH parking-style host and app/API
subdomains refuse HTTPS connections. This is not a repo-local configuration
failure, but it keeps Phase 5 at "Pass with known issues" until the deployed
stack is probed successfully.

## Known Issues

- Third-party images and Dockerfile bases are still tag-pinned but not
  digest-pinned. Registry access is needed to resolve and maintain digests.
  Current mitigation: Dependabot Docker updates plus CI Trivy high/critical
  image scanning. Owner target: pin by digest before final production sign-off
  if zero supply-chain exceptions are required.
- Live TLS evidence is not repo-local. It must be recorded from the deployed
  `myclash.fr` stack with `pnpm infra:edge -- --domain myclash.fr`.
- Current live DNS/edge check fails before deploy: apex/`www` do not yet serve
  the MyClash Traefik TLS configuration, and subdomains refuse port 443.

## Commands

```bash
pnpm infra:review
pnpm infra:edge -- --domain myclash.fr
docker compose --env-file .env -f infra/docker-compose.prod.yml config
```
