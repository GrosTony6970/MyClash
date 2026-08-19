---
name: myclash-plan-review
description: Convergent, axis-driven review of a plan before implementation in this repo — repeated passes over six MyClash-specific axes until a pass yields zero BLOCKER and zero MAJOR, with every finding cited in code. Use when reviewing a plan, a slice brief or an implementation strategy, when asked "review this plan" or "is this plan ready", and before leaving plan mode on any non-trivial slice.
---

# MyClash plan review

A plan fails here in ways a generic review never looks for: a test that holds nothing, a gate
registered in three of its four places, a table shipped without an RLS policy. This skill runs
review passes over six axes chosen for those failures, and repeats until the plan stops yielding
serious findings.

Read [AXES.md](AXES.md) before the first pass — it holds the probe questions and where to look for
each axis.

## The one rule: cite it, or it is not a finding

Every finding names a file and line, a gate, a migration number or a rule in `CLAUDE.md` / `docs/`.
Open the code and confirm the claim before writing it down. A concern you cannot cite is **not** a
finding: it goes under the table as an open question, in the reviewer's own words.

This is what keeps the loop honest. It is stronger than an instruction not to invent findings,
because it fails closed — the reviewer has to produce evidence, not restraint.

## The pass loop

Each pass addresses **all six axes**. An axis with nothing to report gets its own row saying `clean`
— never omit it. An axis that cannot apply to this plan's surface is declared `n/a` **once, in pass
1, with the reason**, and is then dropped from later tables. That preserves the never-omit rule
without printing five identical rows every pass.

Order findings most severe first. Emit one table per pass:

```
Pass 2

| axis         | severity | issue                                                | proposed fix                                 |
| ------------ | -------- | ---------------------------------------------------- | -------------------------------------------- |
| verification | MAJOR    | the gate test asserts the exit code only; deleting    | assert the reported violation text, and prove |
|              |          | the rule body keeps it green (check-x.test.mjs:41)    | the seeded break turns it red                 |
| security     | clean    |                                                      |                                              |
| migration    | n/a      | pass 1: no schema change                             |                                              |
```

Severity, in this repo's terms:

- **BLOCKER** — as written it breaks a hard rule in `CLAUDE.md`, reds `main` for the other sessions,
  or ships a claim that cannot be demonstrated.
- **MAJOR** — the plan needs reworking mid-slice, or a stated acceptance criterion has no way to be
  proved.
- **MINOR** — real, absorbable while implementing.
- **NIT** — wording, ordering, naming.

## Stop rule

Stop when a full pass yields zero BLOCKER and zero MAJOR. End that pass with the literal line:

```
CONVERGED — <n> passes, <k> MINOR/NIT remaining
```

Unresolved open questions do not block convergence. When any remain, use `CONVERGED with open
questions` and list them under the line.

After **four** passes with BLOCKER or MAJOR still open, stop and report instead:

```
NOT CONVERGED — 4 passes, <n> BLOCKER, <m> MAJOR outstanding
```

followed by the outstanding findings. Never soften a severity to reach convergence, and never
manufacture a finding to justify another pass. Under-reporting and over-reporting are both failures
of this skill.

## Applying fixes between passes

Accepted fixes are edited into the plan before the next pass starts, so each pass reviews the
amended plan rather than the original. In plan mode the plan file is the only writable file — that
is enough. A finding the operator declines stays in the table, marked `accepted-as-is`, and does not
block convergence.

## Escalation

For a plan that spans many files, dispatch the `plan-reviewer` agent for one cold-context pass and
fold its findings into the axis table — it starts without this conversation's assumptions, which is
the point. Architecture and trade-off calls go to `principal-engineer`, per the routing table in
`CLAUDE.md`.
