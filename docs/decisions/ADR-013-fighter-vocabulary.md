# ADR-013 — Person, Global Person and Fighter: one vocabulary, a bounded rename

**Date:** 2026-08-11
**Status:** Accepted

## Context

Migration `0023_global_persons.sql:12` renamed the `fighters` table to `global_persons` and
cascaded the obvious columns (`persons.global_fighter_id` → `global_person_id` at `:37`,
`workshop_instructors`, `fighter_clubs`, `fighter_weapons` at `:56-58`). It did not rename
everything, and nothing recorded what the words were supposed to mean afterwards. In the three
months since (0023 landed 2026-05-07), four consequences compounded:

1. **Two live public API namespaces for one concept.** `apps/api/src/modules/fighters/fighters.controller.ts`
   declares both `@Controller('fighters')` and `@Controller('global-persons')`, backed by one
   `FightersService` that reads `global_persons` and never a `fighters` table. `/admin/fighters`
   likewise duplicates the canonical `/admin/global-persons`.

2. **Columns whose names denote the wrong concept.** `league_rankings.fighter_id`
   (`0015_leagues.sql:83`) and `league_tournament_results.fighter_id` (`:67`) are foreign keys to
   `global_persons(id)`. The 0023 rename cascaded the FK target and left the name.

3. **One string, two concepts.** `apps/api/src/modules/tournament-query/tournament-query.tools.ts`
   uses the wire name `fighter_id` for a `registrations.id`. A blind rename corrupts one of the two.

4. **The authoritative vocabulary doc was silent.** `docs/HIERARCHY.md` defined Organization → Event
   → Tournament → Pool → Match → Exchange and named neither Person, Global Person, Fighter, Phase,
   Venue nor Lice — so the terms agents confuse most had no definition to check against.

A five-area survey (schema, API, frontend, i18n, docs), each area adversarially verified, put the
`fighter` token in roughly 4,750 shipped lines. A direct measurement at HEAD found `fighter_id`
alone in **39 source files, 141 occurrences**, and grep cannot classify them — the same token is a
`registrations.id` in one module and a `global_persons.id` in another.

## Decision

**The vocabulary**, now written into `docs/HIERARCHY.md`, which is authoritative:

- **Global Person** — one human, across every event (`global_persons`).
- **Person** — that human at one event (`persons.event_id` required).
- **Registration** — that person entered in one tournament.
- **Fighter** — the **canonical word for the competing role**. Not an entity, not a table, not a
  synonym for Global Person. **Competitor** is its formal synonym and means exactly the same thing.
- **`global_persons.is_fighter`** — a directory-discoverability flag, not a claim about any
  tournament. It is backfilled `TRUE` for every pre-0023 row (`0023:24`), so it can be true with
  zero registrations.

**The propagation scope is rename-ambiguous-only.** Rename identifiers whose name denotes the
_wrong_ concept. Leave correct ones alone, and leave foreign vocabulary alone.

**Frozen — out of scope, deliberately:**

| Target                                                                    | Why                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/fighters/:slug` (public web)                                            | Quoted verbatim as `/fighters/jean-dupont` in the **published privacy policy**, both locales (`apps/web-marketing/src/pages/privacypolicy.astro:181`), and QR-coded onto already-printed event passes. |
| HEMA Ratings bundle (`CSV_HEADERS.fighters`, `Fighter 1`, `fighters.csv`) | Another system's schema. This ruling has no authority over hemaratings.com's words.                                                                                                                    |
| `fighter-photos` Storage bucket                                           | Baked into every stored photo URL. Object storage **survives** the wipe-and-redeploy cadence, so a rename orphans live objects.                                                                        |
| `enforce_fighter_referee_no_overlap`                                      | Already correct under the ruling, and renaming forces DROP + re-ADD of a CHECK that CLAUDE.md hard rule 8 forbids disabling.                                                                           |
| `redFighterName` / `blueFighterName` (~320 lines)                         | Competing-role identifiers. Correct as-is.                                                                                                                                                             |

**Declined: renaming the `apps/api/src/modules/fighters/` directory.** Measured at 6,360 LOC across
20 files with 9 external importers, and it invalidates all 33 path-keyed entries in
`docs/code-quality-complexity-baseline.json` at once — serialising the whole gate chain behind a
re-baseline, for **zero behaviour change**. Recorded here so it reads as a decision, not an
oversight.

## Consequences

- **Easy:** new code has one place to check what a word means. A reviewer can now say "that column
  name denotes the wrong concept" and point at a document rather than an opinion.
- **Hard:** the repo keeps visible inconsistency on purpose. `/api/v1/fighters/*` and
  `/api/v1/global-persons/*` both serve; `fighter_clubs` and friends keep names that mean
  global-person. HIERARCHY.md documents this explicitly so it reads as history, not confusion.
- **Committed to:** the public `/fighters/:slug` URL is now a promise with a legal dependency.
  Changing it means changing a published privacy policy in two locales and breaking printed passes.
- **Committed to:** any future `fighter_id` sweep must classify sites by hand. The token is
  genuinely ambiguous in this codebase, and automating it risks the corruption this ADR exists to
  prevent.

## Alternatives considered

- **Docs-only — fix the prose, touch no identifier.** Rejected: it cannot be done honestly. Three of
  the doc sites needing edits are already false at HEAD, and five of the six legacy `fighter_*`
  tables appear in **zero** markdown, so docs-only would leave them permanently invisible while
  claiming the vocabulary was settled.
- **Full rename — every `fighter` identifier that means global-person.** Rejected on measurement:
  of the ~4,750 shipped lines, roughly 702 are competing-role identifiers this ruling says are
  **already correct** (`redFighterName`/`blueFighterName` alone is ~320), and 254 are HEMA Ratings
  vocabulary across 11 files that renaming would actively break. It would spend its largest budget
  making the codebase worse, and drag ~1,594 test lines along.
- **Splitting Competitor from Fighter** — Competitor = holds a Registration, Fighter = named in a
  Match. Considered and rejected: nothing in the schema keys off "currently in a match", so the
  split would have invented a distinction the data does not carry, and would have required a
  24-string bilingual copy sweep to express a difference no query can observe.
