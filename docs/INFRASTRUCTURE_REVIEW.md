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
Supabase Auth, Supabase Realtime, Supabase Storage, Supabase REST (PostgREST),
API, ops-runner, worker, web-public, web-marketing, web-scoring, and web-admin.

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
- Public routers use the `myclash-security-headers@file` middleware, defined in
  the Traefik file provider (`infra/config/traefik/middlewares.yml`).
- HSTS is enabled with `max-age=31536000; includeSubDomains`.
- HSTS preload is intentionally disabled for v1.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
  `Referrer-Policy: strict-origin-when-cross-origin` are configured at Traefik.

### Edge plugins: GeoBlock + Fail2Ban

Both are declared in Traefik's **static** config (`--experimental.plugins.*` on the
traefik service; `experimental.plugins` in `infra/traefik/traefik.dev.yml` for dev)
and are fetched from GitHub at container start, so a fresh deploy comes up with
them already installed. The download is cached in `./data/traefik/plugins`.

**GeoBlock** runs as two instances with deliberately opposite failure modes,
because it resolves each uncached IP against `get.geojs.io`:

| Instance                  | Mode       | Countries          | On lookup failure      |
| ------------------------- | ---------- | ------------------ | ---------------------- |
| `myclash-geoblock-admin`  | allow-list | FR + neighbours    | **deny** (fail closed) |
| `myclash-geoblock-public` | block-list | CN, RU, KP, IR, BY | **allow** (fail open)  |

Failing closed on the public site would turn a third-party API outage into a full
site outage, so `allowUnknownCountries: true` there is load-bearing and pinned by
`check-infra-review.mjs`.

**Fail2Ban** guards only the surfaces the application does not already rate-limit
(see `ARCHITECTURE.md` §14.3 for the app-level throttler):

| Instance                 | Routers                   | Threshold                       | Why                                                                          |
| ------------------------ | ------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `myclash-fail2ban-auth`  | `myclash-auth`, dashboard | 20 × (401\|429) / 10m → 30m ban | `/auth/v1/*` proxies straight to GoTrue, bypassing `ThrottlerGuard` entirely |
| `myclash-fail2ban-staff` | `myclash-scoring-api`     | 60 × (401\|429) / 10m → 15m ban | Staff PIN login has no `@Throttle` override; a venue shares one NAT'd IP     |

Thresholds are set by **how many humans sit behind one public IP**, not by how
strict they could be — this is a volumetric backstop, not the primary auth
control. `myclash-admin-api` is excluded on purpose: expired sliding sessions emit
parallel 401 bursts indistinguishable from an attack by status code alone.

The ban allowlist is derived from `THROTTLE_IP_WHITELIST` by
`infra/scripts/lib/traefik-env.sh`, so the app throttler and the edge share one
trusted-IP list rather than two that drift. The IP itself never enters this repo.

**Availability over enforcement.** `AbortOnPluginFailure` is left at its default
(`false`), so a failed plugin fetch never stops Traefik. But a router referencing a
middleware whose plugin did not load fails to build and serves 404 — so the deploy
scripts print a warning (`mc_warn_if_plugins_failed`) and recovery is one flag:

```bash
TRAEFIK_PLUGINS=off ./infra/scripts/start.sh   # detaches both plugins; site serves unprotected
```

**Two plugins, on purpose.** Every Yaegi plugin is interpreted on the request path of each
router that references it, inside a container capped at `mem_limit: 256m` / `cpus: 0.5`, and
a plugin that fails to load 404s its routers rather than degrading. A third one therefore
needs to earn its place. An edge HTTP cache (the Souin plugin) was evaluated on that basis
and rejected — see [ADR-011](./decisions/ADR-011-no-edge-http-cache.md) before proposing one
again. The short version: the public site is deliberately `no-store` because it serves live
match data, and the SSR surfaces emit no `Vary` headers while varying by cookie, so a shared
cache would leak across locales and sessions.

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
