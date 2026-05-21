# Bracket Page Redesign — Design Spec

**Date:** 2026-05-20
**Scope:** `apps/web-admin` bracket page + supporting `packages/ui` components + `apps/api` phases module
**Out of scope:** `apps/web-public` BracketView, pools-phase visual changes, deferred-reconnect telemetry

---

## 1. Goals & non-goals

### Goals

- Visual parity with the supplied mockup: horizontal lanes (Play-ins → Round of N → QF → SF → Final + medal podium), match cards with red/blue color stripes, SVG connector lines between matches.
- Full-width rendering with horizontal scroll for wide brackets; current `max-w-5xl` constraint is removed.
- Always-on bronze (3rd place) match for single-elimination — no operator toggle.
- Visual polish for double-elimination: Winners / Losers / Grand Final lanes use the same `MatchCard` + connector primitives but render no medal podium.
- TBD / pending / live / finished states clearly distinguished.
- Tournament-configured side colors honored (`scoring_config.display.sideColors.{red, blue}`) for the stripe and score-box accents.
- Operator-quality features:
  - New `seedingStrategy` config on bracket generation (`snake` implemented; `by-rating`/`random`/`by-pool-rank` accepted but throw 501 until later work).
  - Persist `grandFinalReset` to `config_json` (existing bug: it is silently dropped today).
  - Post-generation Configuration card to edit `grandFinalReset`.
  - Manual Round-1 re-seed without full regen.
- Realtime: bracket page subscribes to `matches` filtered by `phase_id`, mirroring Matches and Standings tabs.
- Reconnect logging: `useRealtimeWithFallback` emits `console.info` for SUBSCRIBED, reconnected, and disconnected states — observability with no UI noise.

### Non-goals

- web-public BracketView changes — out of scope, separate codebase.
- Visual changes to pools pages — pools layout stays at its current width.
- Deferred-reconnect telemetry sent to a server — only browser console logs.
- Algorithmic implementation of `by-rating`, `random`, `by-pool-rank` seeding strategies — accepted on the DTO, return 501 until later tasks.
- Migration to a new `matches` column — the bronze match is identified by extending the existing slot self-ref convention (see Section 7).

---

## 2. Visual anatomy of a match card

| Element          | Spec                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Card height      | `52px` (constant)                                                                        |
| Card width       | `160-180px` (responsive within column max)                                               |
| Background       | `bg-white` default; `bg-amber-50` when status ∈ {ready, running}; `bg-slate-50` when TBD |
| Border           | `border border-slate-200` default; `border-dashed border-slate-300` when TBD             |
| Corner stripes   | `3-4px` wide; rounded corners (`rounded-l rounded-r`); left=red side, right=blue side    |
| Fighter rows     | 2 rows, each `~22px` tall, vertically stacked                                            |
| Fighter name     | `text-sm font-medium text-slate-900`                                                     |
| Club abbrev pill | `text-xs bg-slate-100 px-1 py-0.5 rounded ml-2`                                          |
| Score box        | Right-aligned, `~32px` wide, `font-mono`, `bg-slate-50`; bold on completed               |
| Status pill      | Bottom-right corner, `text-[10px] uppercase tracking-wide`, color matches status         |
| Hover            | `hover:shadow-md transition-shadow`                                                      |

### TBD state

When either seat is `null` AND status is not `completed`:

- Replace fighter name with italic "TBD" in `text-slate-400`.
- No club pill.
- Score box shows `—` in `text-slate-400`.
- Card border dashed (per table above).

---

## 3. Color tokens

Tokens live in `packages/ui/src/utils/color-token.ts` (moved from `apps/web-admin/.../pools/_tabs/color-token.ts` in Task 1).

| Token                    | Accent (stripe / score border) | Pill bg         | Pill text          |
| ------------------------ | ------------------------------ | --------------- | ------------------ |
| `red`                    | `bg-red-700`                   | `bg-red-50`     | `text-red-700`     |
| `blue`                   | `bg-blue-700`                  | `bg-blue-50`    | `text-blue-700`    |
| `green`                  | `bg-emerald-700`               | `bg-emerald-50` | `text-emerald-700` |
| `amber`                  | `bg-amber-600`                 | `bg-amber-50`   | `text-amber-700`   |
| `violet`                 | `bg-violet-700`                | `bg-violet-50`  | `text-violet-700`  |
| `teal`                   | `bg-teal-700`                  | `bg-teal-50`    | `text-teal-700`    |
| `gold` (podium-only)     | `bg-amber-400`                 | `bg-amber-100`  | `text-amber-900`   |
| `silver` (podium-only)   | `bg-slate-300`                 | `bg-slate-100`  | `text-slate-700`   |
| `bronze` (podium-only)   | `bg-amber-700`                 | `bg-amber-50`   | `text-amber-800`   |
| `slate` (4th + fallback) | `bg-slate-400`                 | `bg-slate-50`   | `text-slate-600`   |

**Side defaults:** `red` and `blue`. If `scoring_config.display.sideColors.{red,blue}` is set to a known token, BracketView uses it. If it's an arbitrary hex string or unknown token, the component falls back to the default and `console.warn`s once.

---

## 4. Connector specification

Connectors render as a single absolutely-positioned `<svg>` overlay that sits behind the match cards.

| Property           | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Container          | `absolute inset-0 pointer-events-none` inside the bracket grid         |
| Winner stroke      | `#B4B2A9`, `stroke-width: 1.5`, no dash                                |
| Bronze feed stroke | `#854F0B`, `stroke-width: 1.5`, `stroke-dasharray="3,3"`               |
| Corner radius      | `r=6` on each elbow (quadratic bezier `Q`)                             |
| Anchors            | Right-edge midpoint of source card → left-edge midpoint of target card |

Implementation:

1. `BracketConnectors` accepts a `Map<matchId, HTMLElement>` of card refs.
2. On mount and every `ResizeObserver` callback, compute paths from `getBoundingClientRect()` deltas relative to the container.
3. Render one `<path>` per (parent → child) edge.
4. Bronze feed lines are drawn from each SF source card's right edge to the bronze match's left edge using the dashed amber stroke.

---

## 5. Medal podium

Only rendered when `phaseType === 'single-elim'` AND the parent passes a `podium` prop.

```
┌──────────┐
│   GOLD   │   ← center, 110% height
│ ▔▔▔▔▔▔▔ │
│ Fighter  │
│   Club   │
└──────────┘
┌──────┐ ┌──────────┐ ┌──────┐ ┌──────┐
│SILVER│ │   GOLD   │ │BRONZE│ │ 4TH  │
│      │ │  (above) │ │      │ │      │
└──────┘ └──────────┘ └──────┘ └──────┘
```

- Layout: `flex items-end justify-center gap-4`.
- Gold tile: 110% height, centered.
- Silver / bronze / 4th tiles: 90% height.
- Ribbon background: each tile gets `bg-amber-100`/`bg-slate-100`/`bg-amber-50`/`bg-slate-50` respectively.
- 4th tile renders with the muted slate token and the word "4th" subtitle.
- Each tile displays fighter name + club abbrev. Empty (`TBD`) tile when the corresponding match isn't completed.

### No-bronze fallback

If the bronze match does not exist (legacy bracket generated before this feature, or `phaseType === 'double-elim'`): hide bronze + 4th tiles. Render only gold + silver, justified center.

---

## 6. Status semantics

Driven by `matches.status` enum:

| Status                           | Stripe color            | Border | Score                | Pill            |
| -------------------------------- | ----------------------- | ------ | -------------------- | --------------- |
| `scheduled` (pending)            | `slate-300`             | solid  | `—`                  | grey "Pending"  |
| `ready`                          | `amber-500`             | solid  | `—`                  | amber "Ready"   |
| `running`                        | `amber-500` + pulse dot | solid  | partial if available | amber "Live"    |
| `completed`                      | side color (red/blue)   | solid  | bold score           | green "Final"   |
| seat-missing (any non-completed) | dashed slate            | dashed | `—`                  | grey "TBD"      |
| `forfeit`                        | slate                   | solid  | `WO`                 | grey "Walkover" |
| `disqualified`                   | slate                   | solid  | `DQ`                 | grey "DQ"       |

---

## 7. Backend additions

### 7.1 `seedingStrategy` field

Add to `apps/api/src/modules/phases/dto/phases.dto.ts:GenerateBracketDto`:

```ts
@IsOptional()
@IsIn(['snake', 'by-rating', 'random', 'by-pool-rank'])
seedingStrategy?: 'snake' | 'by-rating' | 'random' | 'by-pool-rank';
```

In `phases.service.ts:generateBracket`:

- If absent → default `'snake'`.
- If `'snake'` → use existing path (`snakeSeed` from `@myclash/rulesets`).
- If any other value → `throw new HttpException('Seeding strategy "<x>" not yet implemented', 501)`.

The chosen strategy is persisted to `config_json` regardless of whether it was implemented (informational; allows future re-seed to use the same strategy by default).

### 7.2 Persist `grandFinalReset` (bug fix)

Currently `generateBracket` reads `dto.grandFinalReset` but does not write it into `config_json`. Fix: include `grandFinalReset: dto.grandFinalReset ?? false` in the persisted config object.

### 7.3 Bronze match for single-elim

In `phases.service.ts:generateBracket` when `phaseType === 'single-elim'`:

1. After main bracket matches are inserted, insert one additional match row in the same phase.
2. Its bracket slot is identified by a self-ref label `BRONZE` (extending the existing convention at `bracket-advance.service.ts:233-248`).
3. Both seats start `NULL`.
4. Store the new match's UUID at `config_json.bronzeMatchId`.

In `bracket-advance.service.ts`:

- When an SF match completes, propagate its winner to the final (existing behavior) AND its loser to the bronze match seat — red seat if loser came from upper SF, blue seat if from lower SF.
- The `buildSelfRef(slot)` function is extended to return `BRONZE` for the bronze sentinel slot, so the existing propagation graph can address it.
- Idempotent — re-running advance does not duplicate. Compare existing seat value before writing.

### 7.4 New endpoints

| Endpoint                                  | Body                                                                 | Effect                                                        | Failure modes                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/v1/phases/:id/bracket-config` | `{ grandFinalReset?: boolean }`                                      | Merges into `config_json`.                                    | 409 if finals or bronze are `completed`; 404 if phase missing; 403 by org guard.                                            |
| `POST /api/v1/phases/:id/reseed`          | `{ strategy: 'snake' \| 'by-rating' \| 'random' \| 'by-pool-rank' }` | Re-applies seeding to R1 matches (clears R1 seats, re-seeds). | 409 if any R1 match has `status != 'scheduled'` (body includes blocking match IDs); 501 if strategy unimplemented; 404/403. |

Both endpoints reuse the existing org-membership guards on the phases controller.

---

## 8. Realtime

### 8.1 Bracket page subscription

Mirrors MatchesTab/StandingsTab. Wired in `apps/web-admin/.../bracket/page.tsx`:

```ts
useRealtimeWithFallback({
  channelName: `bracket-${tournamentId}`,
  table: 'matches',
  filter: `phase_id=eq.${bracketPhaseId}`,
  event: '*',
  onEvent: (payload) => {
    const incoming = payload.new as MatchRow | null;
    if (!incoming) return;
    setBracket((prev) => prev && mergeMatchIntoBracket(prev, incoming));
  },
  onFallbackPoll: refetchBracket,
  fallbackPollMs: 30_000,
});
```

`mergeMatchIntoBracket` walks the bracket structure and replaces the matching slot's fields in place — cheap, no full refetch. Score and status updates flow through instantly while connected.

### 8.2 Reconnect logging

Extend `useRealtimeWithFallback` with a `wasConnected` ref. On status callback:

- `SUBSCRIBED` + `wasConnected === false` → `console.info('[realtime] connected', { channel })`. Set `wasConnected = true`.
- `SUBSCRIBED` + `wasConnected === true` → `console.info('[realtime] reconnected', { channel })`.
- `CHANNEL_ERROR | TIMED_OUT | CLOSED` → `console.info('[realtime] dropped', { channel, status })`.

No UI surface — diagnostic only.

---

## 9. i18n keys (EN + FR)

All keys added to `packages/i18n/src/index.ts`.

### Podium

| Key                               | EN          | FR             |
| --------------------------------- | ----------- | -------------- |
| `organizer.bracket.podium.gold`   | "Champion"  | "Champion·ne"  |
| `organizer.bracket.podium.silver` | "Runner-up" | "Finaliste"    |
| `organizer.bracket.podium.bronze` | "Bronze"    | "Bronze"       |
| `organizer.bracket.podium.fourth` | "4th place" | "4ᵉ place"     |
| `organizer.bracket.podium.tbd`    | "TBD"       | "À déterminer" |

### Configuration card

| Key                                            | EN                                                                   | FR                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `organizer.bracket.config.title`               | "Configuration"                                                      | "Configuration"                                                           |
| `organizer.bracket.config.bracketSize`         | "Bracket size"                                                       | "Taille du tableau"                                                       |
| `organizer.bracket.config.fighterCount`        | "Fighters"                                                           | "Combattant·es"                                                           |
| `organizer.bracket.config.phaseType`           | "Phase type"                                                         | "Type de phase"                                                           |
| `organizer.bracket.config.grandFinalReset`     | "Grand Final reset"                                                  | "Reset de la Grande Finale"                                               |
| `organizer.bracket.config.grandFinalResetHint` | "If true, winner of LB must beat WB winner twice to take the title." | "Si activé, le vainqueur du LB doit battre le vainqueur du WB deux fois." |
| `organizer.bracket.config.save`                | "Save configuration"                                                 | "Enregistrer la configuration"                                            |
| `organizer.bracket.config.locked`              | "Configuration locked — finals already completed."                   | "Configuration verrouillée — finales déjà terminées."                     |

### Re-seed

| Key                                | EN                                                                                                      | FR                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `organizer.bracket.reseed.button`  | "Re-seed Round 1"                                                                                       | "Re-tirer le 1er tour"                                                                                       |
| `organizer.bracket.reseed.title`   | "Re-seed Round 1"                                                                                       | "Re-tirer le 1er tour"                                                                                       |
| `organizer.bracket.reseed.hint`    | "Choose a strategy and re-apply seeding to Round 1 only. Matches that have started cannot be reseeded." | "Choisissez une stratégie et appliquez-la au 1er tour. Les matchs déjà lancés ne peuvent pas être re-tirés." |
| `organizer.bracket.reseed.apply`   | "Apply"                                                                                                 | "Appliquer"                                                                                                  |
| `organizer.bracket.reseed.blocked` | "Some R1 matches have already started — cannot reseed."                                                 | "Certains matchs du 1er tour sont déjà lancés — re-tirage impossible."                                       |

### Seeding strategy

| Key                                                | EN                                      | FR                                             |
| -------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `organizer.bracket.seedingStrategy.label`          | "Seeding strategy"                      | "Stratégie de tirage"                          |
| `organizer.bracket.seedingStrategy.snake`          | "Snake (recommended)"                   | "Serpentin (recommandé)"                       |
| `organizer.bracket.seedingStrategy.byRating`       | "By rating (coming soon)"               | "Par classement (bientôt)"                     |
| `organizer.bracket.seedingStrategy.random`         | "Random (coming soon)"                  | "Aléatoire (bientôt)"                          |
| `organizer.bracket.seedingStrategy.byPoolRank`     | "By pool rank (coming soon)"            | "Par rang de poule (bientôt)"                  |
| `organizer.bracket.seedingStrategy.notImplemented` | "This strategy is not yet implemented." | "Cette stratégie n'est pas encore disponible." |

---

## 10. Out of scope (explicit)

- `apps/web-public/.../BracketView.tsx` — separate component for the public read-only bracket view. Will be updated in a follow-up.
- Pools-phase visual changes — pools pages retain their current layout.
- Deferred-reconnect telemetry — only console logs in this iteration; no server-side ingestion.
- Algorithmic implementations of `by-rating`, `random`, `by-pool-rank` — DTO accepts them, service returns 501.
- Migration to a new `matches` column — bronze match identified via existing slot self-ref convention.

---

## 11. Verification plan

### Automated

- `pnpm -r typecheck` — all 13 packages clean.
- `pnpm --filter api test` — existing 517 tests plus new tests for:
  - `grandFinalReset` persistence.
  - Bronze match creation on single-elim generation.
  - SF-loser propagation to bronze match.
  - `editBracketConfig` happy path + 409 paths.
  - `reseedBracketRoundOne` happy path + 409 paths (blocking matches).
  - 501 for unimplemented seeding strategies.
- `pnpm --filter web-admin test` — existing tests + new snapshot test for `BracketView` (8-fighter bracket + bronze + completed podium).

### Manual smoke

1. **8-fighter single-elim** — generate bracket; confirm connector lines render correctly between QF→SF→Final; bronze match visible below SF row; podium tiles render as Gold/Silver complete and Bronze/4th complete after final + bronze conclude.
2. **16-fighter single-elim** — confirm horizontal scroll works; connector geometry stays accurate across columns.
3. **32-fighter single-elim with play-in round** — confirm play-in column renders correctly.
4. **Double-elim** — generate with `grandFinalReset=true`; confirm WB/LB/GF lanes render with connectors and no medal podium.
5. **Configuration card** — toggle `grandFinalReset` on a fresh double-elim; confirm persists via PATCH.
6. **Re-seed Round 1** — change strategy on a fresh single-elim; confirm R1 seats are rewritten. Then start a R1 match → confirm Re-seed button now 409s with the blocking match's number in the error.
7. **Realtime** — open bracket page in two tabs; complete a match in one tab; confirm card flips status + score in the other within ~1s.
8. **Realtime fallback** — set browser to offline; wait ~5s; confirm `console.info` shows `[realtime] dropped`; set back online; confirm `[realtime] reconnected` log fires.
