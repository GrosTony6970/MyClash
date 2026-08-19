# Superpowers plans & specs

This folder holds the **plan + design-spec pairs** produced by the Superpowers
`brainstorming → writing-plans` workflow during the 2026-05 → 2026-07 AI-agent
build sprints. Each feature typically has an implementation plan (`…md`) and a
matching design spec (`…-design.md`).

**A plan lives here only while it is unexecuted.** Once the work ships it moves
to `archive/`, gains a `Status` header saying what landed, and loses the
"implement this plan task-by-task" instruction — an unmoved plan reads as open
work and an agent will act on it. Four plans and two specs sat in `plans/` and
`specs/` after shipping, with 197 unchecked boxes between them; that is the
failure this rule exists to prevent.

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

- [`archive/plans/`](archive/plans/) — 13 implementation plans
- [`archive/specs/`](archive/specs/) — 14 design specs
