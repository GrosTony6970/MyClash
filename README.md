# MyClash

> Free, open-source platform for HEMA (Historical European Martial Arts) tournament management and result publication.

**Production:** [myclash.fr](https://myclash.fr) · **License:** [AGPL-3.0](./LICENSE) · **Status:** Pre-launch development

---

## What it is

MyClash lets HEMA event organizers run their events end-to-end and publish results, while giving competitors, spectators, referees, and workshop attendees a single mobile-first experience for everything they need on event day.

Designed around three convictions:

1. **Real HEMA events happen in spaces with bad wifi.** Offline-first scoring is the quality bar.
2. **Per-exchange data is the only honest source of truth.** Aggregate scores derive; raw exchanges persist.
3. **Per-event theming makes platforms feel like local events.** A platform doesn't have to feel like a platform.

For the full product overview, see [`myclash.md`](./myclash.md).

---

## Documentation

| Document                                                                     | Audience               | Purpose                                                     |
| ---------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| [`myclash.md`](./myclash.md)                                                 | Anyone                 | Product / functional / UX overview                          |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)                             | Developers & AI agents | Master technical specification                              |
| [`docs/BUILD_ORDER.md`](./docs/BUILD_ORDER.md)                               | AI coding agent        | Sequenced task list with acceptance criteria                |
| [`docs/GOLDEN_PATHS.md`](./docs/GOLDEN_PATHS.md)                             | Developers & QA        | End-to-end golden paths for manual and automated testing    |
| [`docs/decisions/`](./docs/decisions/)                                       | Developers             | Architecture Decision Records (ADRs)                        |
| [`docs/OWNER_TASKS.md`](./docs/OWNER_TASKS.md)                               | Project owner          | Operational checklist (domains, hosting, legal, beta event) |
| [`docs/PRE_DEPLOY_CHECKLIST.md`](./docs/PRE_DEPLOY_CHECKLIST.md)             | Project owner          | Flat ordered checklist for first production deploy          |
| [`docs/pre-production-review-plan.md`](./docs/pre-production-review-plan.md) | Tech lead              | Staged review plan before production ship                   |
| [`AGENTS.md`](./AGENTS.md)                                                   | AI coding agent        | Coder rules + persistent-memory protocol                    |
| [`memory/MEMORY.md`](./memory/MEMORY.md)                                     | AI coding agent        | Persistent project memory (thematic)                        |

---

## Quick start (developers)

```bash
# Prereqs: Node 26+, pnpm 10.27+, Docker Desktop
pnpm install
cp .env.example .env       # edit values — at minimum set POSTGRES_PASSWORD and SUPABASE_JWT_SECRET

# Start the data services (Postgres, Redis, Supabase Auth/REST/Realtime/Storage) behind Traefik.
# Traefik fronts the Supabase surface in dev exactly as it does in production — it owns the
# /auth/v1, /rest/v1, /storage/v1 and /realtime/v1 rewrites (see "Production stack" below).
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d \
  traefik db redis supabase-auth supabase-rest supabase-realtime supabase-storage

pnpm dev
```

Local URLs (after `pnpm dev`):

- `http://localhost:3001` — web-public (spectator / competitor PWA)
- `http://localhost:3002` — web-scoring (scorekeeper PWA)
- `http://localhost:3003` — web-admin (organiser + super-admin)
- `http://localhost:4000` — NestJS API
- `http://localhost:4000/api/docs` — Swagger UI (dev only)

For the full Traefik-fronted dev stack with self-signed TLS at `*.myclash.localhost`, see the header comment of [`infra/docker-compose.dev.yml`](./infra/docker-compose.dev.yml).

---

## Repo structure

```
myclash/
├── apps/                # Four Next.js apps + NestJS api + static marketing site
│   ├── api/             # NestJS — domain logic, REST + WebSocket (port 4000)
│   ├── web-public/      # Mobile-first PWA — public/spectator/competitor
│   ├── web-scoring/     # Tablet-first PWA — offline-first scoring
│   ├── web-admin/       # Desktop-first admin app — organiser + super-admin
│   └── web-marketing/   # Static HTML — myclash.fr apex landing (no build step)
├── packages/            # Shared workspaces (consumed by the apps)
│   ├── rulesets/        # @myclash/rulesets — TF_v1 scoring engine + custom-ruleset runtime
│   ├── feature-flags/   # @myclash/feature-flags — curated toggle registry
│   ├── db/              # Drizzle schema + migrations
│   ├── ui/              # Shared shadcn/ui components (Tournament Manual aesthetic)
│   ├── design-tokens/   # Fonts, color palette, spacing
│   ├── types/           # Shared TS types
│   ├── api-client/      # Generated OpenAPI client
│   └── i18n/            # EN + FR translation strings
├── infra/               # Production deploy artefacts
│   ├── docker-compose.prod.yml
│   ├── docker-compose.dev.yml
│   ├── docker-compose.staging-certs.yml
│   ├── ops-runner/      # Bearer-authed sidecar with docker.sock (backups + container lifecycle)
│   └── scripts/         # Bash scripts that run ON THE VPS
├── scripts/             # Cross-platform Node scripts (run from dev machine)
├── docs/                # Project documentation
├── memory/              # AI agent persistent memory
└── tests/               # Top-level e2e + a11y suites
```

---

## Production stack

The production deployment is a 14-service Docker Compose stack on a single VPS, fronted by Traefik. Authoritative definition: [`infra/docker-compose.prod.yml`](./infra/docker-compose.prod.yml).

**Reverse proxy & TLS**

- `traefik` (`traefik:v3.7.1`) — terminates HTTPS via Let's Encrypt, routes by hostname to every public-facing service. Hosts: `myclash.fr` → web-marketing · `app.myclash.fr` → web-public · `admin.myclash.fr` → web-admin + API · `scoring.myclash.fr` → web-scoring · `api.myclash.fr` → API · `traefik.myclash.fr` → dashboard at `/dashboard/` (basic-auth gated; the bare root 302s there, since Traefik's `api@internal` serves nothing at `/`).

**Data**

- `db` (`supabase/postgres:17.6.1.121`) — primary Postgres with the Supabase init scripts (auth, realtime, postgrest roles).
- `redis` (`redis:8-alpine3.23`) — cache + BullMQ queue + pub/sub. 512 MB max, appendonly.

**Supabase surface** — each fronted directly by Traefik (no Kong in prod)

- `supabase-auth` (`supabase/gotrue:v2.189.0`) — email magic link + Google OAuth.
- `supabase-realtime` (`supabase/realtime:v2.94.1`) — Phoenix Channels broadcasting Postgres row changes.
- `supabase-storage` (`supabase/storage-api:v1.58.19`) — S3-compatible object storage (photos, club logos).
- `supabase-rest` (`postgrest/postgrest:v12.2.3`) — PostgREST over the public schema, served at `/rest/v1`.

**MyClash apps**

- `api` — NestJS REST + WebSocket gateway on port 4000.
- `worker` — same image as `api`, started with `--worker`. BullMQ consumer for stats, exports, Ratings sync.
- `web-admin`, `web-public`, `web-scoring` — Next.js per-app containers.
- `web-marketing` — static HTML on nginx.

**Ops sidecar**

- `ops-runner` — a bearer-authed Node service ([`infra/ops-runner/server.mjs`](./infra/ops-runner/server.mjs)) that mounts `/var/run/docker.sock` and exposes a small HTTP surface (port 4075, docker-network only). It owns backups, schedule, restore, and `POST /containers/:service/(start|stop|restart)` lifecycle controls for the 10 allowlisted services. **The docker socket lives here, not in the API container** — so a compromise of any API code path doesn't grant Docker root. See [`docs/ARCHITECTURE.md` §17.4](./docs/ARCHITECTURE.md) for the full endpoint table + allowlist.

External services: Scaleway Object Storage (S3-compatible, for the nightly backup mirror), Resend (transactional email), Sentry (errors + APM), Web Push (VAPID, optional), Google OAuth (optional).

---

## Contributing

This project follows a strict build-order workflow driven by an AI coding agent. See [`AGENTS.md`](./AGENTS.md) for the contract. Human contributions are welcome — open an issue first for non-trivial changes.

---

## Acknowledgements

Inspired by [hemaScorecard](https://github.com/SeanFranklin/hemaScorecard) and [HEMA Ratings](https://hemaratings.com). Built on the operational patterns of [MyFAL](https://github.com/GrosTony6970/MyFAL) (Lyon AMHE companion app).

---

_MyClash is not affiliated with any HEMA federation, sport governing body, or commercial entity._
