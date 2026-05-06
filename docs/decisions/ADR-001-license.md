# ADR-001 — License: AGPL-3.0

**Date:** 2025-01-01
**Status:** Accepted

## Context

MyClash is a free, community-oriented platform for HEMA tournament management. The project needs a license that:

- Guarantees the software remains free and open for the HEMA community
- Prevents commercial forks from closing the source while benefiting from community contributions
- Is compatible with self-hosting (single `docker compose up`)

## Decision

AGPL-3.0 (GNU Affero General Public License v3).

AGPL extends GPL's copyleft to network use: anyone running a modified version as a service must publish their source. This closes the "SaaS loophole" that GPL leaves open.

## Consequences

- **Easy:** HEMA clubs and organisers can self-host freely; the codebase remains open permanently.
- **Hard:** Any commercial operator wrapping MyClash in a paid SaaS must open their modifications — acceptable, since the project has no commercial ambitions.
- **Committed to:** All dependencies must be AGPL-compatible. MIT/Apache/BSD dependencies are fine; GPL-only dependencies need review.

## Alternatives considered

- **MIT** — Too permissive; allows silent commercial forks with no obligation to contribute back.
- **GPL-2.0** — No network-use copyleft; a SaaS wrapper would not be required to publish changes.
- **BSL / proprietary** — Contradicts the project's free-for-all mission.
