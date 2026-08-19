# Superpowers plans & specs

This folder holds the **plan + design-spec pairs** produced by the Superpowers
`brainstorming → writing-plans` workflow during the 2026-05 / 2026-06 AI-agent
build sprints. Each feature typically has an implementation plan (`…md`) and a
matching design spec (`…-design.md`).

These are **historical build artifacts, not living documentation.** Nothing in
the codebase, CI, or tooling depends on them. For the current system, use
[../ARCHITECTURE.md](../ARCHITECTURE.md); for the task list, use
the git history.

## Active

- [`specs/2026-05-19-consistent-backups-design.md`](specs/2026-05-19-consistent-backups-design.md)
  — forward-looking design for the backup write-quiesce lock. **Not yet
  implemented**, and still referenced by
  [../DISASTER_RECOVERY.md](../DISASTER_RECOVERY.md) as the planned mitigation
  for DB↔storage skew. Keep in place until the feature ships.

## Archived

Everything under [`archive/`](archive/) describes work that has **shipped** — or
was **superseded** by what actually shipped. Kept for provenance only; each file
carries a `Status` header recording what landed and how it differed from the plan.

- [`archive/plans/`](archive/plans/) — 9 implementation plans
- [`archive/specs/`](archive/specs/) — 12 design specs
