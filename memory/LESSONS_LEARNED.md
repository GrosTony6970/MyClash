# LESSONS_LEARNED.md

> Permanent, reusable rules distilled from past errors, corrections, oversights, and bad technical choices.
>
> **Maintenance rules:**
> - Only record useful, general, reusable lessons. Skip lessons too narrow to recur.
> - When a new lesson supersedes an older one, update the old one — don't create a duplicate.
> - Never record the same lesson twice.
> - Each lesson must be **actionable** — phrased as an instruction or a rule, not a description.
>
> See `AGENTS.md` for the protocol.

---

## Architecture & design

- Scores are always **derived** from per-exchange data via the ruleset engine, never stored as an independent source of truth. Storing computed scores invites drift; deriving them keeps stats and rankings consistent.
- When data is deeply relational (Tournament → Event → Phase → Match → Exchange + cross-cutting Fighter/Club), choose Postgres over a document store. Document stores fight relational queries and cost more per read.
- Use Supabase for what it's good at (auth, storage, realtime, the DB itself) and a dedicated backend (NestJS) for business logic. Don't cram domain code into Postgres functions.
- Three frontend apps with shared `packages/ui` is preferable to a single mega-app when one of them (the scoring app) has materially different UX constraints (offline-first PWA).

## Domain integrity

- The **TF_v1 golden test** against FAL 2026 reference data is sacred. A failing snapshot test is a red flag — fix the engine, do not adjust the snapshot.
- Voiding an exchange must never destroy the row. Set `voided=true` and recompute. Replays must be lossless.
- Hard constraints in scheduling (e.g. `enforce_fighter_referee_no_overlap`) are **not configurable**. Soft constraints are.
- Each scoring exchange carries a **client-generated UUID**. Server inserts are idempotent on this UUID. This is what makes offline-first sync safe.

## Offline & realtime

- Sports halls have hostile wifi. Anything that runs at the piste must work fully offline. Test on real tablets in real venues, not just CI.
- The scoring app must always show explicit network state (online / syncing / offline / sync_error). The scorekeeper must always know.
- Realtime broadcast piggybacks on Postgres row changes via `LISTEN/NOTIFY` (Supabase Realtime). Never broadcast as a separate publish step — that introduces "what's stored vs what's sent" inconsistency.

## Frontend & UX

- For HEMA-themed UI, the prototype design language (Cinzel + Inter, red/blue + gold, shield motifs) is canonical.
- Personas are non-exclusive: a single user can be Competitor + Referee + Workshop attendee at the same event. Onboarding must be multi-select.
- The "My Schedule" view aggregates all of a user's commitments and surfaces conflicts. It is the most-used screen of the public PWA.
- Never use `localStorage` / `sessionStorage` in artifacts running in Claude.ai (these APIs aren't supported there). For real production code, use IndexedDB for offline state.

## Build process

- One task = one PR. Bundling unrelated changes makes review impossible and rollback expensive.
- Acceptance criteria are testable assertions. If you can't write the test, the AC is wrong, not the implementation.
- Run `pnpm lint && pnpm typecheck && pnpm test` before opening every PR. CI is the second line of defense, not the first.
- When a build task references an `[O-NNN]` owner-side prerequisite that's not done, **stop and notify the user**. Do not improvise around it.

## Identity & auth

- The organizer is the source of truth for the roster. Participants never self-register; they only "find themselves" in a list and confirm. This is what makes guest sessions safe.
- Guest sessions sign with a separate JWT secret from Supabase auth. Crossing the streams creates an escalation vector — keep them strictly bounded.
- Mask emails in any endpoint a participant can hit anonymously. `j***@g***.com` is enough to recognize your own email; not enough for an attacker to harvest a roster.
- Name + club is the disambiguator for HEMA. Two "Jean Dupont" exist; "Jean Dupont · Lyon AMHE" and "Jean Dupont · Cercle PRMD" are distinct enough in 99% of cases.
- Fuzzy match with `pg_trgm` and `unaccent`. Don't try to do this client-side — accents and typos are language-specific and the index lives where the data lives.
- Capability boundaries between Guest and Claimed should be drawn at "anything that crosses devices" or "anything that edits." Casual users never need to claim; power users get a one-time magic link.
- **Migrate user-owned data atomically on claim.** Follow rows, push subscriptions, workshop enrollments, persona selections — all transfer from `guest_session_id` to `user_id` in the same transaction as the claim. Otherwise the user "loses" their state, which is terrible UX.
- **Default visibility follows the physical reality.** Anything that happens in shared physical space at the event (matches, referee slots, workshops) is public by default — the data just makes visible what's already visible IRL. Personal contact info (email, phone) is private by default. The opt-in/opt-out direction follows from "would the user be surprised to learn this is visible?"
- **Following relationships are private and one-directional.** Don't notify the followed person. Don't show "X is following you." This isn't a social network; the follow is just a personal bookmark.

## Process & communication

- Read `AGENTS.md`, `MEMORY.md`, and `LESSONS_LEARNED.md` at the start of every session, in that order.
- Append every user instruction to `PROMPT_LOG.md` at session start.
- When information becomes obsolete in `MEMORY.md`, **delete or correct it**. Stale memory is worse than no memory.
- When an architectural question is silent or ambiguous in `ARCHITECTURE.md`, **ask before guessing**. Improvising 500 lines that need to be unwound costs more than a 30-second clarification.

## Cross-platform & deployment

- The owner's local OS is Windows. Repo scripts must be cross-platform — prefer Node-based scripts (`scripts/*.ts` invoked via pnpm) over bash for anything that runs on the developer machine.
- Bash scripts are fine for things that *only* run server-side (on the OVH VPS). Place them in `infra/scripts/` and label them clearly.
- Enforce LF line endings via `.gitattributes` from day 1 — Windows checkouts will silently corrupt Docker entrypoint shell scripts otherwise.
- Migrations run **before** new code containers replace old ones, never after. Migration failure must abort the deploy and leave the previous version running.
- Take a `pg_dump` immediately before every production migration. Without this, "rolling back a bad deploy" is a marketing slogan, not a procedure.
- Don't write a deploy script from scratch when the owner already has a working one for a similar app — read it first, adapt it, document what changed and why.
- Production deploy stays manual at v1; auto-deploy is for staging only. Friction on prod is a feature, not a bug.

## MyFAL scripting conventions (reused for MyClash)

The owner's MyFAL deployment uses a polished set of bash scripts. MyClash inherits these conventions verbatim:

- **Shared `lib/log.sh`** sourced by every script — colors auto-disabled on non-TTY, helpers are `ok`/`err`/`warn`/`hdr`/`info`. One source of truth for output style.
- `set -Eeuo pipefail` on every bash script — fail fast, fail loud.
- `ROOT_DIR` resolution via `cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd` — script can be run from anywhere.
- `docker compose --env-file .env` flag is **always** explicit, never relying on default detection.
- `.env` is validated up front; missing critical variables abort with a clear message.
- Idempotent file initialization (`[[ -f X ]] || touch X`, `: > log.txt`) so re-runs don't fail.
- Health check loops use `RETRIES × DELAY` pattern with clear progress logging.
- Auto-generate VAPID keys if missing — never block the deploy on a manual setup step that can be automated.

When in doubt about a deploy/ops convention: look at the MyFAL scripts first. They're in production, they work.

---

*(New lessons added below as they are learned.)*

## NestJS + Vitest testing

- **Do not use `Test.createTestingModule()` with `useValue` mocks in Vitest** — the NestJS DI container requires `emitDecoratorMetadata` to be active at test runtime, which Vitest doesn't guarantee. `useValue` mocks silently fail to inject, leaving `this.dependency` as `undefined`. Use direct instantiation instead: `new MyService(mockDep1 as never, mockDep2 as never)`. This is simpler, faster, and avoids the DI resolution problem entirely.
- **`@Global()` modules in test modules** — even with `useFactory`, global modules can cause unexpected re-instantiation. Prefer direct instantiation for unit tests; reserve `Test.createTestingModule()` for integration tests where the full module graph is needed.

## Email & transactional messaging

- **Use Resend SDK directly in NestJS** (not SMTP) for transactional emails. The SDK is typed, gives structured error objects, and avoids SMTP connection management. GoTrue (Supabase Auth) can still use SMTP for its own internal emails (email verification, password reset) — those are separate from NestJS-sent magic links.
- **Always send bilingual emails (FR + EN)** for MyClash — the HEMA community is international and the platform is French-first but not French-only.
- **Never reveal whether an email is registered** in magic-link endpoints. Always return the same generic message regardless of whether the email exists. This prevents email enumeration attacks on the participant roster.

## Auth & cookies

- **`@fastify/cookie` must be registered via `require()` in NestJS** when using the Fastify adapter — the ESM default import (`import fastifyCookie from '@fastify/cookie'`) produces a TypeScript type mismatch with `app.register()`. Use `const fastifyCookie = require('@fastify/cookie')` and access `.default` if present.
- **`SUPABASE_URL` in Docker is `http://kong:8000`** (internal network name), not `http://localhost:8000`. In dev without Docker it's `http://localhost:8000`. Always use the env var, never hardcode.
