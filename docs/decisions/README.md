# Architecture Decision Records (ADRs)

Decisions worth preserving with their context. One file per decision, named `ADR-NNN-short-title.md`.

## Format

```markdown
# ADR-NNN — <Short title>

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNN

## Context

What problem are we solving? What are the constraints?

## Decision

What did we decide? Be specific.

## Consequences

What does this make easy? What does this make hard? What are we now committed to?

## Alternatives considered

What did we look at and reject? Why?
```

## Pre-seeded list (from `docs/OWNER_TASKS.md` Appendix A)

These are decisions made during planning that should be captured as ADRs once the project starts:

- ADR-001: License — AGPL-3.0
- ADR-002: App name — MyClash
- ADR-003: Hosting region — EU (OVH VPS)
- ADR-004: Domain — myclash.fr
- ADR-005: Object storage at v1 — Supabase Storage
- ADR-006: No paid sponsorship/branding on the platform at v1
- ADR-007: Funding model — donations only at v1
- ADR-008: Identity model — guest sessions + claimed accounts (no Google OAuth at v1)
- ADR-009: Versioning — SemVer
- ADR-010: Default visibility for personal data — follows the physical reality of the venue

The agent should backfill these as PR-sized tasks once the repo is bootstrapped.
