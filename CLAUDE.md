# CLAUDE.md

You are working on **MyClash** — a free, open-source platform for HEMA event management.
This file is the agent contract. It holds the rules that cannot be inferred from the code.

---

## Hard rules

1. **Never bypass the ruleset engine.** Scores are always derived from exchanges via
   `@myclash/rulesets`. Do not store computed scores as the source of truth.
2. **TF_v1 must reproduce the FAL 2026 reference data byte-for-byte.** A failing golden test
   (`packages/rulesets/test/tf_v1.fal2026.test.ts`, fixture
   `packages/rulesets/test/fixtures/fal2026.json`) means the engine is wrong — fix the engine,
   never the snapshot.
3. **Offline scoring is non-negotiable.** Any change to the scoring app must preserve full offline
   functionality, and the offline E2E tests must pass.
4. **RLS first, application checks second.** Every new table needs an RLS policy. Never disable RLS
   in a production code path. Without RLS a table is world-readable — PostgREST exposes `public`
   as `anon`.
5. **No `eval`, no `Function()`, no dynamic code execution** for user-supplied formulas. Ruleset
   configs are validated against Zod schemas and either dispatched to whitelisted functions or
   evaluated as a Zod-validated AST (`FormulaNode`) by our own `evaluateFormula` — a closed
   recursive interpreter over a fixed variable domain. Authoring a formula is allowed; _executing_
   input is not. Never reintroduce a string that gets compiled.
6. **All user-facing strings go through i18n**, in both `en` and `fr`. Never hardcode English.
7. **Don't commit secrets, and never commit real rosters or personal data** — the repo is public
   (AGPL). `.env.example` is the canonical key list.
8. **`enforce_fighter_referee_no_overlap` cannot be disabled.** A fighter may not referee a pool
   overlapping their own match. Safety and integrity invariant.
9. **One slice = one commit**, scoped to a single concern. Don't bundle unrelated changes.
10. **Acceptance criteria are testable assertions.** If a task says "X works", demonstrate X with
    a test.

---

## Where authority lives

| File                   | Authoritative for                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/HIERARCHY.md`    | **Vocabulary** — Event / Tournament / Workshop / Pool / Match / Exchange. Read before writing code or docs that use these terms.                                                                                                                                       |
| `docs/ARCHITECTURE.md` | **Technical design** — data model, modules, rulesets. Read the relevant sections before any non-trivial change.                                                                                                                                                        |
| `DESIGN.md`            | **UI** — the "Tournament Manual" language. Per-surface deltas in `docs/design/`, known gaps in `docs/design/known-deviations.md`, token values in `packages/ui/src/theme.css` (gated by `pnpm quality:design-drift`). The rendered contract is `/admin/design-system`. |
| `myclash.md`           | **Product / UX** — what the app does and feels like, per persona.                                                                                                                                                                                                      |

`docs/ENGINEERING_LESSONS.md` collects hard-won rules per area (auth, Docker, testing, scheduling,
deployment). Read the relevant section before working in that area.

If something conflicts with `HIERARCHY.md` or `ARCHITECTURE.md`, ask before deviating. If
`ARCHITECTURE.md` is silent on a decision, ask — don't guess and write 500 lines that need
unwinding.

---

## Writing code

**Say what you assumed.** Put the assumption in the reply, not in your head. Two readings of a task
means you present both and ask — never pick one silently. If a simpler approach exists than the one
asked for, say so and push back once; then build what the operator decides.

**Minimum code that solves the problem.** Every line is debt. No feature nobody asked for, no
abstraction for a single caller, no configurability nobody requested — propose those and let the
operator choose. If 200 lines could be 50, write the 50. Minimal is not golfed: one dense
unreadable line is worse than four clear ones, and a simple solution still gets its explanation.

**Surgical edits.** Every changed line traces to the request. Don't improve adjacent code, don't
reformat, don't refactor what the task didn't touch. Unrelated dead code gets named in your report,
not deleted. Orphans your own change created — now-unused imports, variables, functions — are yours
to remove in the same commit. This bounds **what you touch**, not **how deep the fix goes**: a
root-cause fix is still the right fix, and its own blast radius is not "adjacent code". Match the
surrounding code — except in UI, where `docs/design/known-deviations.md` opens by warning that the
pattern you are about to copy may be the one being removed. Read it before copying.

**Every branch must be able to fire, and firing must leave a trace.** A resolution chain is the
design when it resolves an ordinary case: staffing falls through to a hard-coded floor, locale runs
cookie → `Accept-Language` → default, push falls back to email. A branch that **cannot** fire, or
fires in silence, is the bug. `var(--event-primary, #c0392b)` had no producer anywhere in the repo,
so the "fallback" was the only path that ever ran and shipped as the real accent for months
(`docs/design/known-deviations.md`, D2). `t('k') || 'fallback'` is the same shape — `t()` returns a
truthy `[k]`, so the `||` never fires and a French organiser gets English.

**One owner per behaviour.** Rewrite the existing component before adding a second one. A second
copy diverges silently, and a docstring claiming to be "the only copy" is usually the one that is
wrong.

**Name the race.** Two writers, an optimistic update and the server's answer, a realtime refetch
landing mid-drag — say which one you are handling and how. `write-tracker.ts` and
`realtime-refetch-gate.ts` exist because the schedule board has both.

**Finish.** No placeholders, no stubs, no "wire this up later". `pnpm quality:todos` catches a bare
marker; nothing catches a function that type-checks and does nothing.

---

## Workflow

Work is slice-based and paced by the operator, who runs a live test event and reports issues. Work
lands directly on `main`; there is no branch-per-task or PR ritual. The git history is the build
record; there is no task queue to pick from.

- **Conventional Commits are enforced** by commitlint through the `commit-msg` hook
  (`feat(scope): …`, `fix(scope): …`). A commit message in any other shape is rejected.
- **The operator wipes and redeploys the whole stack every few commits.** There is no
  backwards-compatibility tax on internal contracts — schema changes, renames and prop reshaping
  all land cleanly. Prefer root-cause and class-of-bug fixes over patches.
- **Several agent sessions commit to this repo concurrently.** Check `git log --oneline -1` before
  staging, `git fetch` before pushing, and stage explicit paths — never `git add -A`.
- If a task is ambiguous or contradicts the architecture, **stop and ask**. If it needs something
  only the operator can do — a DNS record, a third-party account, a decision about the real event —
  **stop and notify** rather than improvising around it.

---

## Verification

**`pnpm lint && pnpm typecheck && pnpm test` is not the check.** CI's Lint job runs twenty-eight
further steps, and shared packages must be built in the right order or a local pass means nothing.

Use the **`myclash-gates` skill** — it holds the Lint job's ordered chain from
`.github/workflows/ci.yml` plus the build-ordering traps. Run it before every push. Coverage and
the E2E suite are separate CI jobs and go red on their own; the skill does not cover them.

A task is done when its acceptance criteria pass with automated tests where possible and the gate
chain is green. You are measured by tasks closed cleanly, not lines written.

---

## Reporting back

Three messages are written for a reader who has not just read the code: **what was done** when a task
finishes, **a question** put to the operator, and **a bug you found**. Give one line of context
before the finding, use Simplified Technical English (one idea per sentence, active voice, everyday
words), and use the nouns from `docs/HIERARCHY.md` rather than table, class or service names. File
and line references still belong there — after the plain sentence, not instead of it.

---

## BMad planning toolkit

BMad (planning/PRD/architecture toolkit, v6.9.0) is **not installed in this repo** — it lives in
the user's home dir. When running any `bmad-*` skill from this project, resolve its path variables
against the home install (don't assume `_bmad/` is in the repo):

- `{project-root}` → `C:\Users\Tony` (the parent of `_bmad`)
- `{skill-root}` → `C:\Users\Tony\.claude\skills\<skill-name>`
- Scripts → `uv run C:/Users/Tony/_bmad/scripts/<script>.py` (e.g. `memlog.py`;
  `resolve_config.py` needs `--project-root C:/Users/Tony`)
- Central config → `C:\Users\Tony\_bmad\bmm\config.yaml` (project_name `MyClash`, English)
- Planning output → `C:\Users\Tony\_bmad-output\planning-artifacts\` (PRDs under `.../prds/`)

`resolve_customization.py` auto-discovers this by walking up from the skill dir until it finds
`_bmad/` or `.git/`, so it lands on `C:\Users\Tony` on its own — but the home-dir location is
non-obvious, so check here first.

---

## Subagent routing

Delegate without being asked when the work matches a row below. Prefer a skill when one covers the
area — skills load in context and know this repo's conventions; an agent starts cold and is worth it
when the task needs an independent pass over many files.

| Work                                                                         | Delegate to                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Reviewing a finished slice before commit                                     | `code-architecture-reviewer`                                                                            |
| Reviewing a plan before implementation                                       | `myclash-plan-review` skill; `plan-reviewer` agent for a cold pass on a large multi-file plan           |
| Architecture or trade-off calls on a non-trivial change                      | `principal-engineer`                                                                                    |
| Planning a multi-file refactor                                               | `refactor-planner`                                                                                      |
| Advanced TypeScript type-system work (`packages/types`, generics, inference) | `voltagent-lang:typescript-pro`                                                                         |
| App Router / RSC boundary work in `apps/web-*`                               | `voltagent-lang:nextjs-developer` — targets Next 14, this repo is 16; cross-check `next-best-practices` |
| React render/perf work in `packages/ui`                                      | `voltagent-lang:react-specialist` — targets React 18, this repo is 19                                   |
| Postgres query and index optimisation                                        | `sql-pro` skill first; `voltagent-lang:sql-pro` for a deep pass                                         |

Not a fit here — don't route to an agent for these: the NestJS API (use the `nestjs-best-practices`
skill; no NestJS agent exists), gate failures (`myclash-gates`), and the `voltagent-meta:*`
orchestration agents.
