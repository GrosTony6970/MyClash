# Infrastructure Review

Phase 5 covers production containers and Traefik edge/TLS only. VPS hardening
is owner-confirmed complete and is excluded from this pass.

## Status

**Pass with known issues.** Phase scope fixed 2026-05-13; content maintained since — `git log` is
the authority on freshness.

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
API, ops-runner, worker, web-public, web-marketing, web-staff, web-admin, plus `supabase-meta` and `supabase-studio` — neither of which carries a `profiles:` guard, so both run on every deploy and `scripts/check-infra-review.mjs` expects them.

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

| Instance                 | Routers                                                               | Threshold                            | Why                                                                          |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `myclash-fail2ban-auth`  | `myclash-auth`, `myclash-studio`, dashboard                           | 20 × (401\|403\|429) / 10m → 30m ban | `/auth/v1/*` proxies straight to GoTrue, bypassing `ThrottlerGuard` entirely |
| `myclash-fail2ban-staff` | `myclash-staff-api`, `myclash-staff-auth`, `myclash-staff-auth-admin` | 60 × (401\|403\|429) / 10m → 15m ban | A venue shares one NAT'd IP, so this is volumetric only                      |

`403` is in the list because a **disabled** staff account answers 403, not 401 —
without it, probing for which usernames exist and which have been switched off is
free. The router list and the status codes are both pinned by
`check-infra-review.mjs`.

**Four routers reach the API, and only one used to carry the jail.**
`myclash-api`, `myclash-admin-api`, `myclash-public-api` and `myclash-staff-api`
all resolve to the same container, so `POST /api/v1/staff-auth/login` answered
unjailed on `api.`, `app.` and `admin.`. `myclash-staff-auth` closes that with a
**host-less** `PathPrefix` rule at priority 40 — host-less on purpose, so a fifth
host added to the API later cannot silently reopen it. `myclash-staff-auth-admin`
is its twin at priority 50, and exists only to keep that path behind
`MW_GEO_ADMIN` on the admin host rather than inheriting the public allow-list.

Dev carries the same pair as `dev-staff-auth` / `dev-staff-auth-admin`, at the same
priorities. It had the identical hole — `dev-admin-api` serves `/api/v1` on the admin
host with no jail — and dev is where a router shape gets exercised before it reaches
the live edge, which is the same reason the plugin versions are pinned identical.
`pnpm infra:plugins -- --mode=dev` reads them out of the Traefik API by name.

The primary control on staff login is now `@ThrottleByStaffAccount` in the API
(10/h per event + username, never keyed on `req.ip`); the jail is the volumetric
backstop behind it.

Thresholds are set by **how many humans sit behind one public IP**, not by how
strict they could be — this is a volumetric backstop, not the primary auth
control. `myclash-admin-api` is excluded on purpose: expired sliding sessions emit
parallel 401 bursts indistinguishable from an attack by status code alone.
(`myclash-staff-auth-admin` does jail a path on the admin host, but only
`/api/v1/staff-auth` — not a sliding-session surface, so no 401 bursts.)

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

**Verifying the plugins are actually live.** There are two distinct failure modes and
only one of them writes to the log. `mc_warn_if_plugins_failed` greps for
`Plugins are disabled because an error has occurred`, which Traefik logs when the
GitHub **fetch** fails. A plugin that fetches and then rejects its own **config** is
silent: the middleware reports `status=disabled`, every router referencing it fails to
build and serves 404, and `docker compose config`, `pnpm infra:review` and Traefik's own
`--ping` all stay green. A missing `api` field on GeoBlock did exactly this in dev on
2026-07-29.

`mc_verify_edge_plugins` (same lib, called by `deploy.sh` / `redeploy.sh` / `start.sh`
right after `up`) closes that gap by probing the routers themselves. Run it by hand with:

```bash
pnpm infra:plugins                       # prod, over loopback+SNI — no credentials needed
pnpm infra:plugins -- --mode=dev         # dev stack, via the insecure dashboard on :8080
pnpm infra:plugins -- --deep             # per-middleware status/error from the Traefik API
```

The default pass condition is not the status code alone: Traefik's fallback 404 runs no
middleware at all, so the probe asserts the `Strict-Transport-Security` header that
`myclash-security-headers@file` adds — which distinguishes "the chain is gone" from
"the backend itself answered 404". The `traefik.${DOMAIN}` router is the **only** row
judged on 401/403 instead, because its chain is the one with no security-headers. Both
GeoBlock instances set `allowLocalRequests: true`, so the loopback probe is never
geo-denied and a 403 is unreachable everywhere else — a row judged on the status code
elsewhere reports a healthy edge as a plugin outage on every deploy.

**What the default probes cannot see.** Several routers resolve to the same API
container and all of them chain security-headers, so they answer `/api/v1/staff-auth/login`
with an identical 404-plus-HSTS. A default-mode row therefore proves the path is alive
behind _some_ built chain and nothing more: it stays green if a jail router was never
deployed, and it cannot see the host-less router serving `admin.` off the **public** geo
allow-list. `EXPECTED_ROUTERS` in `check-edge-plugins.mjs` closes that by reading
Traefik's own API — each named router must exist, be enabled, chain its geoblock and
fail2ban instances, and out-prioritise every router it has to beat. `--deep` therefore
runs on **every deploy**: `mc_verify_edge_plugins` reads `TRAEFIK_DASHBOARD_PASSWORD`
from `.env` (deploy writes it there beside its hash) and warns loudly if it is missing
rather than quietly falling back to the shallow probe.

Manual fallback, weakest to strongest, when the probe itself cannot run:

```bash
ls data/traefik/plugins/sources/github.com/     # 1. plugin source on disk
docker logs myclash-traefik 2>&1 | grep -i plugin   # 2. fetch succeeded at boot
pnpm infra:plugins -- --deep                    # 3. middlewares built and attached
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

This checks apex, `www`, `api`, `app`, `admin`, and `staff` HTTP-to-HTTPS
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
- Live DNS/edge state is not verifiable from this repository, and the note that
  used to sit here — apex/`www` not yet serving the Traefik TLS configuration —
  was written on 2026-05-13 and frozen. `myclash.fr` has since been advertised as
  production. Re-run `pnpm infra:edge` against the live domain rather than
  trusting either version of this line.

## Commands

`pnpm infra:review` scans the **repository** — compose files, Dockerfiles, Traefik labels. It does
**not** read this document, despite the shared name, so nothing here is machine-checked. The edge
and plugin probes below need the live stack.

```bash
pnpm infra:review
pnpm infra:edge -- --domain myclash.fr
pnpm infra:plugins -- --domain myclash.fr
docker compose --env-file .env -f infra/docker-compose.prod.yml config
```
