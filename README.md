# MyClash

> Free, open-source platform for HEMA (Historical European Martial Arts) tournament management and result publication.

**Production:** [myclash.fr](https://myclash.fr) · **License:** [AGPL-3.0](./LICENSE) · **Status:** Pre-launch development

---

## What it is

MyClash lets HEMA event organizers run their events end-to-end and publish results, while giving competitors, spectators, referees, and workshop attendees a single mobile-first experience for everything they need on event day. Around the competition it also carries Workshops, a sparring-partner finder (FightBook) and Event photos sent from the venue.

Designed around three convictions:

1. **Real HEMA events happen in spaces with bad wifi.** Offline-first scoring is the quality bar.
2. **Per-exchange data is the only honest source of truth.** Aggregate scores derive; raw exchanges persist.
3. **An Event keeps its own face.** Its logo, its hero image and the organiser's own words make a platform feel like a local event. The design language is the same everywhere.

For the full product overview, see [`myclash.md`](./myclash.md).

---

## Documentation

| Document                                                       | Audience               | Purpose                                                  |
| -------------------------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| [`myclash.md`](./myclash.md)                                   | Anyone                 | Product / functional / UX overview                       |
| [`docs/HIERARCHY.md`](./docs/HIERARCHY.md)                     | Anyone                 | Vocabulary — Event, Tournament, Pool, Match, Exchange    |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)               | Developers & AI agents | Master technical specification                           |
| [`docs/GOLDEN_PATHS.md`](./docs/GOLDEN_PATHS.md)               | Developers & QA        | End-to-end golden paths for manual and automated testing |
| [`docs/decisions/`](./docs/decisions/)                         | Developers             | Architecture Decision Records (ADRs)                     |
| [`CLAUDE.md`](./CLAUDE.md)                                     | AI coding agent        | Agent contract — hard rules, authority, workflow         |
| [`DESIGN.md`](./DESIGN.md)                                     | Developers & designers | Canonical UI design language                             |
| [`docs/ENGINEERING_LESSONS.md`](./docs/ENGINEERING_LESSONS.md) | Developers & AI agents | Per-area rules learned the hard way                      |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                         | Contributors           | CI checks, development setup, what to run before a push  |
| [`docs/SECURITY_POSTURE.md`](./docs/SECURITY_POSTURE.md)       | Developers & operators | Security posture: auth, rate limits, the database door   |
| [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md)     | Operators              | Backup and restore runbook, and what no backup covers    |
| [`infra/scripts/README.md`](./infra/scripts/README.md)         | Operators              | The deploy, rollback and backup scripts on the VPS       |
| [`tests/e2e/README.md`](./tests/e2e/README.md)                 | Developers & QA        | The end-to-end suite: how to run it, what each spec does |

---

## Quick start (developers)

```bash
# Prereqs: Node 26+, pnpm 12.16+, Docker Desktop
pnpm install
cp .env.example .env       # edit values — at minimum set POSTGRES_PASSWORD and SUPABASE_JWT_SECRET

# Start the data services (Postgres, Redis, Supabase Auth/REST/Realtime/Storage) behind Traefik.
# Traefik fronts the Supabase surface in dev exactly as it does in production — it owns the
# /auth/v1, /rest/v1, /storage/v1 and /realtime/v1 rewrites (see "Production stack" below).
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d \
  traefik db redis supabase-auth supabase-rest supabase-realtime supabase-storage
# A dev database made before each service had its own user has no password for them: `down -v` once.

pnpm dev
```

Local URLs (after `pnpm dev`):

- `http://localhost:3001` — web-public (spectator / competitor app)
- `http://localhost:3002` — web-staff (scoring pad PWA, check-in desk, gear check, photo moderation)
- `http://localhost:3003` — web-admin (organiser + super-admin)
- `http://localhost:3004` — web-marketing (the landing site)
- `http://localhost:4000` — NestJS API
- `http://localhost:4000/api/docs` — Swagger UI (dev only)

For the full Traefik-fronted dev stack with self-signed TLS at `*.myclash.localhost`, see the header comment of [`infra/docker-compose.dev.yml`](./infra/docker-compose.dev.yml).

---

## Repo structure

```
myclash/
├── apps/                # Three Next.js apps + NestJS api + Astro marketing site
│   ├── api/             # NestJS — domain logic, REST (port 4000); with --worker, the jobs
│   ├── web-public/      # Mobile-first app — public/spectator/competitor
│   ├── web-staff/       # Tablet-first PWA — offline-first scoring, check-in desk, gear, photos
│   ├── web-admin/       # Desktop-first admin app — organiser + super-admin
│   ├── web-marketing/   # Astro 7 — myclash.fr apex landing, prerendered to dist/
│   └── pictures/        # Brand images (logo, hero, banner) — not an app
├── packages/            # Shared workspaces (consumed by the apps)
│   ├── rules/           # @myclash/rules — the pure scoring core, no dependencies; the pad runs it offline
│   ├── rulesets/        # @myclash/rulesets — TF_v1 scoring engine + custom-ruleset runtime
│   ├── feature-flags/   # @myclash/feature-flags — curated toggle registry
│   ├── db/              # Numbered SQL migrations + fixtures (no ORM)
│   ├── ui/              # Shared components + theme.css, the design-token source of truth
│   ├── schedule-core/   # Shared schedule-grid geometry + block model (pure)
│   ├── time/            # Duration/date formatting, locale-aware
│   ├── types/           # Shared TS types
│   ├── api-client/      # Generated OpenAPI client
│   ├── i18n/            # EN + FR translation strings
│   └── next-i18n/       # @myclash/next-i18n — locale plumbing for the Next apps
├── infra/               # Production deploy artefacts
│   ├── docker-compose.prod.yml
│   ├── docker-compose.dev.yml
│   ├── docker-compose.staging-certs.yml
│   ├── ops-runner/      # Bearer-authed sidecar with docker.sock (backups + container lifecycle)
│   └── scripts/         # Bash scripts that run ON THE VPS
├── scripts/             # Cross-platform Node scripts (run from dev machine)
├── docs/                # Project documentation
└── tests/               # Top-level e2e + a11y + perf + drag suites
```

---

## Production stack

The production deployment is a 16-service Docker Compose stack on a single VPS, fronted by Traefik. Authoritative definition: [`infra/docker-compose.prod.yml`](./infra/docker-compose.prod.yml).

**Reverse proxy & TLS**

- `traefik` (`traefik:v3.7.10`) — terminates HTTPS via Let's Encrypt, routes by hostname to every public-facing service. Hosts: `myclash.fr` → web-marketing · `app.myclash.fr` → web-public · `admin.myclash.fr` → web-admin + API · `staff.myclash.fr` → web-staff · `api.myclash.fr` → API · `traefik.myclash.fr` → dashboard at `/dashboard/` (basic-auth gated; the bare root 302s there, since Traefik's `api@internal` serves nothing at `/`).

**Data**

- `db` (`supabase/postgres:17.6.1.160`) — primary Postgres with the Supabase init scripts (auth, realtime, postgrest roles).
- `redis` (`redis:8-alpine3.23`) — cache + BullMQ queue + pub/sub. 512 MB max, appendonly.

**Supabase surface** — each fronted directly by Traefik, in both dev and prod (no gateway in between)

- `supabase-auth` (`supabase/gotrue:v2.195.0`) — password, email magic link and Google OAuth.
- `supabase-realtime` (`supabase/realtime:v2.124.1`) — Phoenix Channels broadcasting Postgres row changes. Its browser clients are anonymous: a signed-in token is refused there (migration `0273`).
- `supabase-storage` (`supabase/storage-api:v1.68.9`) — S3-compatible object storage (fighter photos, Event assets, Workshop pictures). Event photos are not here: they have their own bucket.
- `supabase-rest` (`postgrest/postgrest:v14.16`) — PostgREST over the public schema, served at `/rest/v1`. Only the anonymous visitor reads through it, bounded by RLS; a signed-in reader goes through the API, and no web role writes (migrations `0247`, `0273`).
- `supabase-meta` (`supabase/postgres-meta:v0.96.8`) — schema/DDL API for Studio. Unrouted, on the database console's own network (`myclash-dbadmin`) with Studio, `db` and Traefik only.
- `supabase-studio` (`supabase/studio`) — operator DB console at `studio.myclash.fr`. Studio ships with no login of its own, so the router gates it twice with an IP allowlist (`TRAEFIK_STUDIO_ALLOWLIST`, derived from `THROTTLE_IP_WHITELIST` and loopback-only when that is empty) and basic auth (`STUDIO_BASIC_AUTH`, auto-generated by `deploy.sh`). Both are built-in Traefik middlewares rather than `${MW_*}` prefixes, so `TRAEFIK_PLUGINS=off` cannot strip them. It queries as the superuser and **bypasses RLS** — the one deliberate exception to the boundary described in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

**MyClash apps**

- `api` — NestJS REST on port 4000.
- `worker` — same image as `api`, started with `--worker`. Runs every BullMQ job (the ten queues: notifications, HEMA Ratings sync, the Event status ticker, the Event archive, the data-quality scan, the TLS and runtime-health monitors, data retention, photo clean-up, spar-request expiry) and the auto-lock scan, and serves `/health` alone. The `api` runs no job. Locally, `pnpm --filter @myclash/api dev` runs no job either: once its first compile is done, start the jobs in a second terminal with `PORT=4001 node apps/api/dist/main.js --worker`, and restart that process after you edit a job (it does not reload).
- `web-admin`, `web-public`, `web-staff` — Next.js per-app containers.
- `web-marketing` — Astro, prerendered and served by Caddy (`FROM caddy:2-alpine`; `check-infra-review.mjs` asserts it).

**Ops sidecar**

- `ops-runner` — a bearer-authed Node service ([`infra/ops-runner/server.mjs`](./infra/ops-runner/server.mjs)) that mounts `/var/run/docker.sock` and exposes a small HTTP surface (port 4075, docker-network only). It owns backups, schedule, restore, and `POST /containers/:service/(start|stop|restart)` lifecycle controls for the 12 allowlisted services. **The docker socket lives here, not in the API container** — so a compromise of any API code path doesn't grant Docker root. See [`docs/ARCHITECTURE.md` §17.4](./docs/ARCHITECTURE.md) for the full endpoint table + allowlist.

External services: Scaleway Object Storage (S3-compatible: one bucket for the nightly backup mirror, a separate one for Event photos, which no backup covers), Resend (transactional email), Sentry (errors + APM), Web Push (VAPID, optional), Google OAuth (optional).

---

## A note on AI use

MyClash was started by Anthony Garnier. I am a cloud architect: virtualisation, public cloud,
containers, networks, storage and systems are my daily work. Writing application code is not.

It began with [MyFAL](https://github.com/GrosTony6970/MyFAL), an app I vibe-coded for the Fosse aux
Lions 2026 tournament in Lyon. It was not perfect, but the feedback was good, and people asked how
it could work for other tournaments. MyClash is the answer to that question: one platform that fits
each organiser's and club's way of working, without changing the code for each of them.

Most of the code is written by AI — mainly Anthropic's Claude — under my direction. I decide what
gets built, I test it, and I run it on my own server. In about six months this became a stable,
feature-rich platform that I could not have built alone in my free time.

I see AI as a tool. What matters is how the tool is used. Here, that means:

- Every agent works under a written contract ([`CLAUDE.md`](./CLAUDE.md)): hard rules on scoring,
  offline use, data access and referee safety.
- Every change is tested and must pass the full CI gate chain before it lands.
- The scoring engine must reproduce the official Fosse aux Lions 2026 results, byte for byte.
- Fixes go to the root cause, not around it.

For me, AI is an accelerator and an opportunity. It lets one person turn an idea and a vision into
a real product without deep knowledge of every layer. I am trying to bring HEMA into the 21st
century with the tools we have today.

MyClash is not built alone. HEMA clubs near Lyon help with beta testing and with ideas for new
features.

MyClash is free and open source (AGPL-3.0). I build it in my free time, and I pay for the AI
subscription and the server myself. No company is behind it.

There is no service-level agreement (SLA). Each organiser is responsible for their own Event and
for what they do with the platform. We still do our best to keep MyClash up and available: an
automated ops agent checks the server every day, and alerts (errors, monitoring) reach me by email
and on my phone. The [terms of use](https://myclash.fr/en/terms) are the reference.

---

## Contributing

This project is built slice by slice, largely by AI coding agents. See [`CLAUDE.md`](./CLAUDE.md) for the contract. Human contributions are welcome — open an issue first for non-trivial changes.

---

## Acknowledgements

Inspired by [hemaScorecard](https://github.com/SeanFranklin/hemaScorecard) and [HEMA Ratings](https://hemaratings.com). Built on the operational patterns of [MyFAL](https://github.com/GrosTony6970/MyFAL) (Lyon AMHE companion app).

---

_MyClash is not affiliated with any HEMA federation, sport governing body, or commercial entity._
