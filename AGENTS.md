# AGENTS.md

You are an AI coding assistant working on **MyClash** — a free, open-source platform for HEMA tournament management.

This file is your **first read on every task**. It defines hard rules, the persistent-memory protocol, and where to look for everything else.

---

## Documentation map

| File | What it is | When to read |
|---|---|---|
| `docs/ARCHITECTURE.md` | Master technical spec (data model, modules, ruleset, etc.) | Before any non-trivial change |
| `docs/BUILD_ORDER.md` | Sequenced task list with acceptance criteria | When picking the next task |
| `docs/OWNER_TASKS.md` | What the human owner is responsible for | When a task references `[O-NNN]` |
| `myclash.md` | Functional / product / UX understanding of the app | For UX questions, persona flows, design decisions |
| `memory/MEMORY.md` | Persistent thematic memory (you maintain this) | Start of every session, before answering |
| `memory/LESSONS_LEARNED.md` | Permanent rules learned from past mistakes | Start of every session, before answering |
| `memory/PROMPT_LOG.md` | Append-only log of user instructions | Append to it; rarely read |
| `memory/notes/<topic>.md` | Thematic notes too detailed for MEMORY.md | Reference when MEMORY.md links to one |
| `README.md` | Repo-oriented project documentation | Reference for newcomers |

`docs/ARCHITECTURE.md` is **authoritative**. If anything conflicts with it, ask before deviating.

---

## Hard rules

1. **Never bypass the ruleset engine.** Scores are always derived from exchanges via `@myclash/rulesets`. Do not store computed scores as the source of truth.
2. **The TF_v1 implementation must reproduce the FAL 2026 reference data byte-for-byte.** A failing snapshot test against `scripts/import-fal2026.ts` data is a red flag — fix the engine, do not adjust the snapshot.
3. **Offline scoring is non-negotiable.** Any change to the scoring app must preserve full offline functionality. E2E offline tests must pass.
4. **RLS first, application checks second.** Every new table needs an RLS policy. Never disable RLS in production code paths.
5. **No `eval`, no `Function()`, no dynamic code execution** for user-supplied formulas. Ruleset configs are validated against Zod schemas and dispatched to whitelisted functions.
6. **All user-facing strings go through i18n.** Never hardcode English.
7. **Don't commit secrets.** Use `.env.example` as the canonical key list.
8. **Hard constraint `enforce_fighter_referee_no_overlap` cannot be disabled.** A fighter cannot referee a pool whose time overlaps with their match — this is a safety/integrity invariant.
9. **One task = one PR.** Atomic, reviewable, testable. Don't bundle unrelated changes.
10. **Acceptance criteria are testable assertions.** If a task's AC says "X works", you must demonstrate X with a test.

---

## Workflow per task

1. Read this file.
2. **Run the persistent-memory protocol** (see below).
3. Pick the next task from `docs/BUILD_ORDER.md` (in order, unless deps allow parallelism).
4. Read `docs/ARCHITECTURE.md` sections relevant to the task.
5. Open a feature branch: `feat/<scope>-<short-name>`.
6. Write tests first when feasible (especially in `packages/rulesets`).
7. Implement.
8. Run `pnpm lint && pnpm typecheck && pnpm test`.
9. Open a PR. Reference the BUILD_ORDER task ID and any architecture sections involved.
10. **Update the persistent-memory files** if anything was learned (see below).

If a task is ambiguous or contradicts the architecture, **stop and ask**. Do not improvise.
If a task requires owner-side action (`[needs O-NNN]`) that's not done, **stop and notify** the user.

---

## Persistent-memory protocol

You are stateless across sessions. These four files give you continuity. Maintain them carefully — they are the project's accumulated knowledge.

### Mandatory execution sequence at the start of every session

1. Read this `AGENTS.md`.
2. Read `memory/MEMORY.md` (current state of project understanding).
3. Read `memory/LESSONS_LEARNED.md` (rules from past mistakes).
4. Append the user's new instructions to `memory/PROMPT_LOG.md`.
5. Then proceed to the user's task.

### memory/MEMORY.md

- **Purpose**: Persistent thematic index of project knowledge.
- **Organized by**: theme (never chronologically).
- **Structure**: a top-level index that links to thematic notes (separate `.md` files in `memory/notes/` when content is large enough to deserve its own file).
- **Update rules**:
  - Before writing, **check if the information already exists** somewhere. Do not duplicate.
  - When new information overlaps existing, **merge** instead of duplicating.
  - When you discover information is wrong, contradictory, or obsolete, **update or delete it**.
  - Keep entries concise, structured, actionable.
  - Never invent.

### memory/PROMPT_LOG.md

- **Purpose**: Append-only raw log of user instructions for traceability.
- **Format per entry**:
  ```
  ## HH:MM:SS_DD-MM-YYYY
  <verbatim or close-summary of the user's instruction>
  ```
- **Append at session start.** Never edit or delete prior entries.
- **Not a substitute for `memory/MEMORY.md`.** This is raw history; `MEMORY.md` is structured understanding.

### memory/LESSONS_LEARNED.md

- **Purpose**: Permanent rules distilled from past errors, corrections, oversights, or bad technical choices.
- **Format**: short, actionable, generally-applicable rules. One per bullet. Examples:
  - "Always validate `client_uuid` is a real UUID before treating an exchange POST as idempotent."
  - "When changing the scoring engine, run the FAL 2026 golden test before pushing — even if the change looks unrelated."
- **Update rules**:
  - Only record useful, general, reusable lessons. Skip lessons too narrow to ever recur.
  - When a new lesson supersedes an older one, update the old one — don't create a duplicate.
  - Never record the same lesson twice.

### myclash.md

- **Purpose**: Functional and design understanding of the app, at the product level.
- **Distinct from**: `README.md` (repo-oriented), `ARCHITECTURE.md` (technical), `MEMORY.md` (your scratchpad).
- **Stable sections**:
  - Overview
  - Features
  - User journeys (per persona)
  - Key components / modules
  - Data sources
  - Design / UX
  - Known limitations / open points

This file is yours to maintain too. Keep it accurate as features evolve.

---

## When you don't know

- If `ARCHITECTURE.md` is silent on a decision, **ask**. Do not guess and write 500 lines that need to be unwound.
- For UI ambiguity, refer to the prototype (`docs/prototype/`) and the live beta at `https://myfal.lyonamhe.fr/`. The prototype design language is canonical.
- For HEMA terminology in French, refer to `docs/glossary.md` (when it exists) or ask before translating.

---

## What "done" looks like

A task is done when:
- All acceptance criteria pass with automated tests where possible.
- `pnpm lint && pnpm typecheck && pnpm test` is green.
- `memory/MEMORY.md` and `memory/LESSONS_LEARNED.md` are updated if anything new was learned.
- A PR is open with a clear description linking to the BUILD_ORDER task.

You are not measured by lines written; you are measured by tasks closed cleanly. Prefer fewer, better PRs.
