# Superpowers plans & specs

This folder holds the **plan + design-spec pairs** produced by the Superpowers
`brainstorming → writing-plans` workflow since the 2026-05 AI-agent build
sprints. Each feature typically has an implementation plan (`…md`) and a
matching design spec (`…-design.md`).

**A plan lives here only while it is unexecuted.** Once the work ships, the plan
is deleted and git history keeps it: it is a list of steps already taken, and an
unmoved plan reads as open work that an agent will act on. The spec moves to
`archive/specs/` and gains a `Status` header saying what landed; it is kept for
the design reasoning.

This rule has been broken twice. Four plans and two specs sat in `plans/` and
`specs/` after shipping, with 197 unchecked boxes between them. Then, by
2026-11-17, 29 more shipped plans and 4 specs did (Event photos, FightBook, the
protest counter, the weapon catalog, the Google sign-in leftover). That day the
operator had every shipped plan deleted, the 13 older ones in `archive/plans/`
included.

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

Everything under [`archive/specs/`](archive/specs/) describes work that has
**shipped** — or was **superseded** by what actually shipped. Kept for provenance
only; each file carries a `Status` header recording what landed.

- [`archive/specs/`](archive/specs/) — 17 design specs

A spec that was never built is deleted too, not archived: the backup
write-quiesce lock (`2026-05-19-consistent-backups-design.md`) went on
2026-11-17.
