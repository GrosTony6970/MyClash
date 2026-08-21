# ADR-015 — The referee workspace does not call every scheduled unit a pool

**Date:** 2026-08-21
**Status:** Accepted

## Context

The referee assignment board schedules four kinds of unit, not one.
`AssignmentBoardPool.kind` is `'pool' | 'swiss' | 'bracket' | 'finals'`
(`apps/api/src/modules/referees/assignment-board.service.ts`), and nothing on the Assignments tab
filters by it: `allBoardPools` is `[...board.pools, ...board.unscheduledPools]` and every downstream
projection carries all four through.

The card labels were already correct — a bracket card renders `LSW-B-QF-M1` and a Swiss card
`LSW-S3`, both via the shared `formatRoundCode` — so the mislabelling was invisible from a
screenshot of an event whose cards happened to be pools. The **prose around** those cards was not
correct. Twenty strings said "pool" for something that may be a bracket match, a finals card, or a
Swiss round on one piste.

That included every rule in the assignment health panel. All six — own pool, two roles,
officiate-vs-fight, double-booked, availability, capacity — are enforced identically across the four
kinds, so a fighter refereeing their own bracket match was blocked by a rule captioned "Own pool",
and a referee double-booked on a Swiss round was warned by a rule about "two pools".

The obvious fix is an umbrella noun. `docs/HIERARCHY.md` is authoritative for vocabulary and locks
**Pool**, **Bracket** and **Swiss round** as three separate terms, so minting a fourth word above
them is a change to the project's ubiquitous language, not a copy edit.

## Decision

**Rewrite the wrong strings to avoid the noun, and mint no umbrella term.**

The repo had already solved this once: `blockedReasons.duplicate_role_same_pool` reads _"Already
assigned another role here"_. That idiom generalises — "Competing here", "Everyone qualified is
fighting elsewhere at the same time", "A referee cannot officiate twice at overlapping times".

Where a noun is unavoidable, reuse the phrase already shipped in both locales at
`rules.ownPool.description`: **"the pool or match"** / _"la poule ou le match"_.

**The five strings whose referent really is always a pool keep the word** — the pools tab's own
timeline heading, its slot-card heading, its empty state, and the "← Pools" back link. Being
unit-neutral where the surface is pool-specific would be a different inaccuracy.

Key names and `{pool}` / `{poolName}` placeholders are internal and unchanged.

## Consequences

- **Easy:** the workspace stops asserting something false about three quarters of what it shows,
  and `HIERARCHY.md` keeps three terms rather than gaining a fourth that only one surface uses.
- **Hard:** "the pool or match" is imprecise for a Swiss unit, which is a whole round on one piste
  rather than a single match. This ADR knowingly ships that imprecision rather than invent a word,
  because the alternative changes the ubiquitous language for a copy fix.
- **Hard:** one component now takes its heading from its caller. `PoolTimelineGrid` is mounted
  twice, and the two mounts show different things — the pools tab passes a `kind === 'pool'`
  filtered list, the workspace passes everything — so a single hardcoded heading could not be true
  for both.
- **Committed to:** any new string on this surface has to ask which kinds it will be shown for.
  Nothing gates it. The i18n lint reads JSX only, and no gate compares a string's wording against
  the data behind it.

## Alternatives considered

- **Introduce "unit" as an umbrella term** (`HIERARCHY.md` entry, "this unit", "two units").
  Rejected: it is engineering jargon no organiser says aloud, and it buys consistency in exactly
  one workspace at the cost of a fourth competing word in the project's vocabulary.
- **Use "fight" / "combat".** Rejected: accurate for a bracket or finals card, wrong for a Pool or
  a Swiss round, which are many fights each.
- **Sweep the whole referees namespace mechanically.** Rejected: roughly thirty strings there
  mention a pool and most of them genuinely mean one. A blanket swap would trade one inaccuracy for
  another, so each string was classified against where it renders and what filters reach it.
- **Rename the cards too.** Not needed — they were already correct. The finding that started this
  was that "every card says Pool N", and reading the producer showed it does not.
