# ADR-009 — Versioning: SemVer

**Date:** 2025-01-01
**Status:** Accepted

## Context

The project needs a versioning scheme for:

- The platform as a whole (for release notes and deploy tags)
- Shared packages (`@myclash/*`) within the monorepo
- API versioning (`/api/v1/...`)

## Decision

**Semantic Versioning (SemVer 2.0.0)** for all public-facing versions.

- `MAJOR` — breaking API or data-model change requiring migration action from operators
- `MINOR` — new feature, backward-compatible
- `PATCH` — bug fix, backward-compatible

Current version: `0.x.x` until the first public production release, after which `1.0.0` is tagged.

API URL versioning (`/api/v1/`) is independent of the package version — the URL version increments only on breaking API contract changes.

## Consequences

- **Easy:** Standard tooling (changesets, semantic-release) can automate version bumps and changelogs.
- **Hard:** In a monorepo, package versions can drift from the platform version — managed via Turborepo changesets.
- **Committed to:** Every production deploy is tagged. `CHANGELOG.md` maintained from that point.

## Alternatives considered

- **CalVer (date-based)** — Easier to read for non-technical stakeholders but loses the "breaking change" signal.
- **No versioning** — Unacceptable for a self-hosted tool where operators need to know when to run migrations.
