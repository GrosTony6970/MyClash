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

## Decision log

| ADR                                                           | Title                                                       | Status   |
| ------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [ADR-001](./ADR-001-license.md)                               | License: AGPL-3.0                                           | Accepted |
| [ADR-002](./ADR-002-app-name.md)                              | App name: MyClash                                           | Accepted |
| [ADR-003](./ADR-003-hosting-region.md)                        | Hosting region: EU (OVH VPS)                                | Accepted |
| [ADR-004](./ADR-004-domain.md)                                | Domain: myclash.fr                                          | Accepted |
| [ADR-005](./ADR-005-object-storage.md)                        | Object storage at v1: Supabase Storage                      | Accepted |
| [ADR-006](./ADR-006-no-sponsorship.md)                        | No paid sponsorship/branding at v1                          | Accepted |
| [ADR-007](./ADR-007-funding-model.md)                         | Funding model: donations only at v1                         | Accepted |
| [ADR-008](./ADR-008-identity-model.md)                        | Identity model: guest sessions + claimed accounts           | Accepted |
| [ADR-009](./ADR-009-versioning.md)                            | Versioning: SemVer                                          | Accepted |
| [ADR-010](./ADR-010-personal-data-visibility.md)              | Default visibility for personal data: follows venue reality | Accepted |
| [ADR-011](./ADR-011-no-edge-http-cache.md)                    | No edge HTTP cache at v1 (Souin rejected)                   | Accepted |
| [ADR-012](./ADR-012-cookie-consent.md)                        | No cookie banner; versioned acceptance record instead       | Accepted |
| [ADR-013](./ADR-013-fighter-vocabulary.md)                    | Person / Global Person / Fighter vocabulary; bounded rename | Accepted |
| [ADR-014](./ADR-014-referee-filter-selection-model.md)        | Referee filters: day single-select, tournament multi-select | Accepted |
| [ADR-015](./ADR-015-referee-workspace-speaks-unit-neutral.md) | Referee workspace avoids "pool"; no umbrella term minted    | Accepted |
