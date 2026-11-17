# Superpowers plans & specs

This folder holds the **plan + design-spec pairs** produced by the Superpowers
`brainstorming → writing-plans` workflow since the 2026-05 AI-agent build
sprints. Each feature typically has an implementation plan (`…md`) and a
matching design spec (`…-design.md`).

**A plan lives here only while it is unexecuted.** Once the work ships it moves
to `archive/`, gains a `Status` header saying what landed, and loses the
"implement this plan task-by-task" instruction — an unmoved plan reads as open
work and an agent will act on it. Four plans and two specs sat in `plans/` and
`specs/` after shipping, with 197 unchecked boxes between them; that is the
failure this rule exists to prevent. It happened again: on 2026-11-17 a sweep
moved 29 shipped plans and 4 specs (Event photos, FightBook, the protest
counter, the weapon catalog, the Google sign-in leftover).

These are **historical build artifacts, not living documentation.** Nothing in
the codebase, CI, or tooling depends on them. For the current system, use
[../ARCHITECTURE.md](../ARCHITECTURE.md); for the task list, use
the git history.

## Active

- [`specs/2026-11-13-team-tournaments-design.md`](specs/2026-11-13-team-tournaments-design.md)
  — team Tournaments, agreed with the operator on 2026-11-13. **Nothing is
  built.**
- [`plans/2026-11-13-team-tournaments-slice1a.md`](plans/2026-11-13-team-tournaments-slice1a.md)
  — the plan of its first slice (foundations). Not executed.

## Archived

Everything under [`archive/`](archive/) describes work that has **shipped** — or
was **superseded** by what actually shipped. Kept for provenance only; each file
carries a `Status` header recording what landed and how it differed from the plan.

- [`archive/plans/`](archive/plans/) — 42 implementation plans
- [`archive/specs/`](archive/specs/) — 18 design specs

One archived spec was never built:
[`archive/specs/2026-05-19-consistent-backups-design.md`](archive/specs/2026-05-19-consistent-backups-design.md)
(the backup write-quiesce lock). Its header says what the backups do instead.
