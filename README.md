# MyClash

> Free, open-source platform for HEMA (Historical European Martial Arts) tournament management and result publication.

**Production:** [myclash.fr](https://myclash.fr)  ·  **License:** [AGPL-3.0](./LICENSE)  ·  **Status:** Pre-launch development

---

## What it is

MyClash lets HEMA tournament organizers run their events end-to-end and publish results, while giving competitors, spectators, referees, and workshop attendees a single mobile-first experience for everything they need on event day.

Designed around three convictions:

1. **Real HEMA tournaments happen in spaces with bad wifi.** Offline-first scoring is the quality bar.
2. **Per-exchange data is the only honest source of truth.** Aggregate scores derive; raw exchanges persist.
3. **Per-tournament theming makes platforms feel like local events.** A platform doesn't have to feel like a platform.

For the full product overview, see [`myclash.md`](./myclash.md).

---

## Documentation

| Document | Audience | Purpose |
|---|---|---|
| [`myclash.md`](./myclash.md) | Anyone | Product / functional / UX overview |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Developers & AI agents | Master technical specification |
| [`docs/BUILD_ORDER.md`](./docs/BUILD_ORDER.md) | AI coding agent | Sequenced task list with acceptance criteria |
| [`docs/OWNER_TASKS.md`](./docs/OWNER_TASKS.md) | Project owner | Operational checklist (domains, hosting, legal, beta event) |
| [`docs/PRE_DEPLOY_CHECKLIST.md`](./docs/PRE_DEPLOY_CHECKLIST.md) | Project owner | Flat ordered checklist for first production deploy |
| [`AGENTS.md`](./AGENTS.md) | AI coding agent | Coder rules + persistent-memory protocol |
| [`memory/MEMORY.md`](./memory/MEMORY.md) | AI coding agent | Persistent project memory (thematic) |

---

## Quick start (developers)

```bash
# Prereqs: Node 20+, pnpm 9+, Docker Desktop
pnpm install
cp .env.example .env       # edit values
docker compose -f infra/docker-compose.dev.yml up -d
pnpm dev
```

Local URLs (after `pnpm dev`):
- `http://localhost:3000` — public PWA
- `http://localhost:3001` — admin SPA
- `http://localhost:3002` — scoring PWA
- `http://localhost:4000` — NestJS API

---

## Repo structure

```
myclash/
├── apps/                # Three Next.js apps + NestJS api
│   ├── api/             # NestJS — domain logic, REST + WebSocket
│   ├── web-public/      # Mobile-first PWA (public/spectator/competitor)
│   ├── web-scoring/     # Tablet-first PWA (offline-first scoring)
│   └── web-admin/       # Desktop-first admin app
├── packages/            # Shared workspaces
│   ├── rulesets/        # @myclash/rulesets — TF_v1, etc.
│   ├── db/              # Drizzle schema + migrations
│   ├── ui/              # Shared shadcn/ui components
│   ├── design-tokens/   # Cinzel + Inter, color palette, spacing
│   ├── types/           # Shared TS types
│   ├── api-client/      # Generated OpenAPI client
│   └── i18n/            # Shared translation strings
├── infra/               # Production deploy artefacts
│   ├── docker-compose.prod.yml
│   ├── docker-compose.staging-certs.yml
│   ├── docker-compose.dev.yml
│   └── scripts/         # Bash scripts that run ON THE VPS
├── scripts/             # Cross-platform Node scripts (run from dev machine)
├── docs/                # Project documentation
├── memory/              # AI agent persistent memory
└── tests/               # Top-level e2e + a11y suites
```

---

## Contributing

This project follows a strict build-order workflow driven by an AI coding agent. See [`AGENTS.md`](./AGENTS.md) for the contract. Human contributions are welcome — open an issue first for non-trivial changes.

---

## Acknowledgements

Inspired by [hemaScorecard](https://github.com/SeanFranklin/hemaScorecard) and [HEMA Ratings](https://hemaratings.com). Built on the operational patterns of [MyFAL](https://github.com/GrosTony6970/MyFAL) (Lyon AMHE companion app).

---

*MyClash is not affiliated with any HEMA federation, sport governing body, or commercial entity.*
