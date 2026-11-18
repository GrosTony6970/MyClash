# CLAUDE.md

You are working on **MyClash** — a free, open-source platform for HEMA event management.
This file is the agent contract. It holds the rules that cannot be inferred from the code.

---

## Hard rules

1. **Never bypass the ruleset engine.** Scores are always derived from exchanges via
   `@myclash/rulesets`. Do not store computed scores as the source of truth. The scoring pad shows
   a provisional score offline from the same core (`@myclash/rules`, its `/pad` door); the server
   derives the score that counts.
2. **TF_v1 must reproduce the FAL 2026 reference data byte-for-byte.** A failing golden test
   (`packages/rulesets/test/tf_v1.fal2026.test.ts`, fixture
   `packages/rulesets/test/fixtures/fal2026.json`) means the engine is wrong — fix the engine,
   never the snapshot.
3. **Offline scoring is non-negotiable.** Any change to the scoring app must preserve full offline
   functionality, and the offline tests must pass: `tests/e2e/06-offline-sync.spec.ts`,
   `tests/e2e/08-offline-custom-ruleset.spec.ts`, `tests/e2e/40-offline-bout.spec.ts` and
   `tests/a11y/pad-offline-drill.spec.ts`.
4. **RLS on, on every table; signed-in users go through the API.** Every new table enables RLS.
   Add a read rule only where the public (`anon`) may read the rows — RLS on with no rule is a
   closed table, on purpose. No web role writes, and a signed-in token reads nothing through the
   database. A rule that calls a new helper function needs `grant execute … to anon`. Never
   disable RLS in a production code path. Without RLS a table is world-readable — PostgREST
   exposes `public` as `anon`.
5. **No `eval`, no `Function()`, no dynamic code execution** for user-supplied formulas. Ruleset
   configs are validated against Zod schemas and either dispatched to whitelisted functions or
   evaluated as a Zod-validated AST (`FormulaNode`) by our own `evaluateFormula` — a closed
   recursive interpreter over a fixed variable domain. Authoring a formula is allowed; _executing_
   input is not. Never reintroduce a string that gets compiled.
6. **All user-facing strings go through i18n**, in both `en` and `fr`. Never hardcode English.
7. **Don't commit secrets, and never commit real rosters or personal data** — the repo is public
   (AGPL). `.env.example` is the canonical key list.
8. **Nobody referees while they are somewhere else.** No one may be assigned to referee while they
   fight, referee elsewhere, or teach a Workshop at an overlapping time, or outside the availability
   they declared. These rules have no setting and no override. Refereeing one's own Pool at another
   time, and refereeing while a Pool one fights in is running, are separate soft rules that can be
   switched off. Safety and integrity invariant — see
   `docs/decisions/ADR-016-referee-rules-one-checker.md`.
9. **One slice = one commit**, scoped to a single concern. Don't bundle unrelated changes.
10. **Acceptance criteria are testable assertions.** If a task says "X works", demonstrate X with
    a test.

---

## Where authority lives

- `docs/HIERARCHY.md` — **Vocabulary**: Event / Tournament / Workshop / Pool / Match / Exchange.
  Read before writing code or docs that use these terms.
- `docs/ARCHITECTURE.md` — **Technical design**: data model, modules, rulesets. Read the relevant
  sections before any non-trivial change.
- `DESIGN.md` — **UI**, the "Tournament Manual" language. Per-surface deltas in `docs/design/`,
  known gaps in `docs/design/known-deviations.md`, token values in `packages/ui/src/theme.css`
  (gated by `pnpm quality:design-drift`). The rendered contract is `/admin/design-system`.
- `myclash.md` — **Product / UX**: what the app does and feels like, per persona.

`docs/ENGINEERING_LESSONS.md` collects hard-won rules per area (auth, Docker, testing, scheduling,
deployment). Read the relevant section before working in that area.

Two more places hold decisions, below the four files above. A code comment that says "ruling 492"
names one of the operator's numbered rulings: the register is `docs/notes/quick-wins-2026-10-08.md`
(and `docs/notes/workshops-rulings.md` for the Workshops work). A feature's design is its spec in
`docs/superpowers/` — `specs/` while it is not built, `archive/specs/` once it shipped; an archived
spec explains why, and `ARCHITECTURE.md` says what the code does now. The slice's closing commit
moves its spec to `archive/specs/` and deletes its plan.

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

**Trust the caller, not the annotation.** A comment, docstring, decorator or hand-kept list is not
evidence that a safety check holds. Read the guard that runs. `@ApiBearerAuth()` enforces nothing.

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

- **The operator wipes and redeploys the whole stack every few commits.** There is no
  backwards-compatibility tax on internal contracts — schema changes, renames and prop reshaping
  all land cleanly. Prefer root-cause and class-of-bug fixes over patches.
- **Several agent sessions commit to this repo concurrently.** Check `git log --oneline -1` before
  staging, `git fetch` before pushing, and stage explicit paths — never `git add -A`. Never run a
  bare `git stash pop`: the stash list holds other sessions' lint-staged backups, and a bare pop
  takes theirs.
- **A finished session commits and pushes to `main` without asking**, once the `myclash-gates`
  chain is green. A red gate gets fixed, or reported to the operator, before the push.
- **Write every script and every commit message to a file with the Write tool, then run it**
  (`node file.mjs`, `git commit -F file`); change files with Write or Edit. The `no-heredoc` hook
  refuses heredocs, `python -` / `node -` stdin scripts and bare `cat >`, because through a heredoc
  a backslash arrives collapsed: an anchor stops matching with no error, and `\b` lands as a
  backspace byte in a regex that then never matches.
- If a task needs something only the operator can do — a DNS record, a third-party account, a
  decision about the real event — **stop and notify** rather than improvising around it.
- **Hand a session over with the `myclash-handover` skill**: when asked for a handover, and before
  ending a session that leaves work uncommitted.
- **`pnpm dev` runs no job.** Work on a job (a notification, a clean-up, a monitor) needs the
  worker beside it: `PORT=4001 node apps/api/dist/main.js --worker`, restarted after each edit.

---

## Verification

**`pnpm lint && pnpm typecheck && pnpm test` is not the check.** CI's Lint job runs twenty-eight
further steps, and shared packages must be built in the right order or a local pass means nothing.

Use the **`myclash-gates` skill** — it holds the Lint job's ordered chain from
`.github/workflows/ci.yml` plus the build-ordering traps. Run it before every push. Coverage and
the E2E suite are separate CI jobs and go red on their own; the skill does not cover them.

A task is done when its acceptance criteria pass (hard rule 10) and the gate chain is green.

**A test must be able to go red.** A test that guards a fix fails without it: remove the fix, watch
the test go red, then restore with `git restore` — a scripted reverse find-and-replace can put the
old text back in the wrong places. The Supabase mocks ignore `.select()` columns and `.rpc()`
arguments, so assert the select string and the arguments themselves.

---

## Reporting back

Three messages are written for a reader who has not just read the code: **what was done** when a task
finishes, **a question** put to the operator, and **a bug you found**. Give one line of context
before the finding, use Simplified Technical English (one idea per sentence, active voice, everyday
words), and use the nouns from `docs/HIERARCHY.md` rather than table, class or service names. File
and line references still belong there — after the plain sentence, not instead of it.

Ask questions in ELI5 style, with a concrete story before the ruling.

---

## Subagent routing

Delegate without being asked when the work matches a row below. Prefer a skill when one covers the
area — skills load in context and know this repo's conventions; an agent starts cold and is worth it
when the task needs an independent pass over many files.

| Work                                                    | Delegate to                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Reviewing a finished slice before commit                | `code-architecture-reviewer`                                                                  |
| Reviewing a plan before implementation                  | `myclash-plan-review` skill; `plan-reviewer` agent for a cold pass on a large multi-file plan |
| Architecture or trade-off calls on a non-trivial change | `principal-engineer`                                                                          |
| Planning a multi-file refactor                          | `refactor-planner`                                                                            |

Not a fit here — don't route to an agent for these: the NestJS API (use the `nestjs-best-practices`
skill; no NestJS agent exists) and gate failures (`myclash-gates`).
