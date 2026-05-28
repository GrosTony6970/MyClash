# Bracket MatchCard — wider cards + lift pills out of overflow-hidden

**Date:** 2026-05-28
**Status:** Approved
**Scope:** Shared `MatchCard` + `BracketView` UI components used by the admin bracket page.

## Problem

On the admin bracket screen the "Pending" status pill and the
round-code chip (e.g. `LSW-QF-M1`) get visually clipped. Two compounding
causes:

1. **Vertical clipping.** Both chips are positioned `absolute -bottom-2`
   on the card div — meant to sit half outside the card's bottom edge.
   But that same div has `overflow-hidden` (necessary to clip the
   colored fighter rows to the card's rounded corners), so the chips
   never render past the card's bottom edge.
2. **Horizontal tightness.** Cards bottom out at `min-w-[180px]`
   (`MatchCard.tsx:84` and `BracketView.tsx:215`). On narrow viewports
   that leaves ~150px of usable width for `Pending` (~60px) + a code
   like `LSW-QF-M1` (~85px) + their inset padding (~16px). The math
   barely works; longer codes blow it.

## Goals & non-goals

**Goals**

- Both chips always render fully, regardless of viewport width or card
  content.
- Cards have ~40px more breathing room at the narrow end and at the
  wide end.
- Connector-line geometry is unaffected (it reads computed positions
  from each card's `registerRef`).
- The card keeps `overflow-hidden` (colored fighter rows must continue
  to clip to the rounded corners).
- The override-edit pencil button at top-right keeps its current
  position and behavior.

**Non-goals**

- The public-app `BracketView` at
  `apps/web-public/app/e/[eventSlug]/t/[tournamentSlug]/BracketView.tsx`.
  Different file lineage and the user reported the issue on the admin.
  A follow-up if the public app shows the same problem.
- Card size variants (`sm`/`md`/`lg`). One set of dimensions.
- Snapshot tests on card markup. Locks the wrong things (Tailwind
  classes, DOM nesting) and these are exactly what's being changed.

## Design

Two file edits.

### 1) `packages/ui/src/components/bracket/MatchCard.tsx`

**Width bump (line 84):**

```tsx
// before
'group relative flex h-[52px] w-full min-w-[180px] max-w-[320px] items-stretch overflow-hidden rounded-md bg-white shadow-sm transition-shadow';

// after
'group relative flex h-[52px] w-full min-w-[220px] max-w-[360px] items-stretch overflow-hidden rounded-md bg-white shadow-sm transition-shadow';
```

**Reparent the pills.** Today both pills are children of the card div
(which has `overflow-hidden`). Move them to the outer wrapper — the
same wrapper that already hosts the unclipped override button (lines
152-164 of today's file). The override button is the precedent: it's
positioned `-top-2 -right-2` on the outer wrapper and isn't clipped,
so it renders fully. Apply the same pattern to the two bottom pills.

```tsx
// before — pills inside the overflow-hidden card div
<div ref={refCallback} className="relative">
  <div className={cardClasses /* includes overflow-hidden */}>
    {/* fighter rows */}
    <span className="absolute -bottom-2 right-2 ...">{pill.label}</span>
    {roundCode && (
      <span className="absolute -bottom-2 left-2 ...">{roundCode}</span>
    )}
  </div>
  {onOverride && <button … />}
</div>

// after — pills lifted to the outer wrapper, z-10 to stack above
// the card and any connector that draws through the same region
<div ref={refCallback} className="relative">
  <div className={cardClasses /* still has overflow-hidden so fighter
                                rows stay clipped to rounded corners */}>
    {/* fighter rows only */}
  </div>
  <span className="absolute -bottom-2 right-2 z-10 ...">{pill.label}</span>
  {roundCode && (
    <span className="absolute -bottom-2 left-2 z-10 ...">{roundCode}</span>
  )}
  {onOverride && <button … />}
</div>
```

The pills' visual position is identical: the outer wrapper hugs the
card tightly with no padding, so `-bottom-2 right-2` on the wrapper
coincides with `-bottom-2 right-2` on the card. `z-10` ensures the
pills stack above the card body and above any connector lines that
draw through the same region.

The card div keeps `overflow-hidden` because the colored fighter rows
still need to clip to the rounded card corners.

### 2) `packages/ui/src/components/BracketView.tsx`

**Width bump (line 215):**

```tsx
// before
'relative z-10 flex min-w-[180px] max-w-[320px] flex-1 flex-col';

// after
'relative z-10 flex min-w-[220px] max-w-[360px] flex-1 flex-col';
```

Keeps the round column and the card width in sync so cards can
actually reach their new `max-w-[360px]`.

## Behavior after change

- Narrowest case (cards at 220px floor) with both pills present:
  `Pending` (~60px) + `LSW-QF-M1` (~85px) + inset padding (~16px) =
  ~161px used. Remaining ~59px of clear space between the chips.
- Widest case (cards at 360px ceiling): same chips, more whitespace.
- Connectors recompute from each card's `registerRef` callback —
  DOM-driven, not class-driven, so they adapt automatically.
- Override pencil button: unchanged; was already on the outer
  wrapper.

## Tests

The change is presentational — Tailwind classes and DOM nesting.
Locking it with a snapshot or class-list assertion would lock the
exact implementation details this work is changing.

Verification is manual:

- Round-1 card with the "Pending" pill: chip fully visible at the
  card's bottom-right, no truncation.
- Same card on a narrow viewport (≤1024px): card is at least 220px
  wide; both chips render.
- Completed match: "Final" pill renders; winner highlight + score
  chip unchanged.
- Bronze match (single-elim): bronze dashed border unchanged; pills
  still render.
- Championship final: gold accent + ring unchanged; pills render.
- Override pencil button: still positioned at top-right, still
  clickable.

## Risk & rollback

- **Risk:** other consumers of `MatchCard` outside the bracket view
  could rely on the absolute-positioning context. There are none
  today — `MatchCard` is rendered only by `BracketView` / the bracket
  page. Confirmed via grep on the UI package's `MatchCard` import.
- **Risk:** the public-app `BracketView` may have copied the same
  pattern. Out of scope — separate file, separate fix if needed.
- **Rollback:** single revert of the touching commit. No data
  migrations, no API changes.

## Critical files

- [`packages/ui/src/components/bracket/MatchCard.tsx`](packages/ui/src/components/bracket/MatchCard.tsx)
  — line 84 (width) + lines 137-149 (reparent the two pills).
- [`packages/ui/src/components/BracketView.tsx`](packages/ui/src/components/BracketView.tsx)
  — line 215 (column width).

No other files. No new components. No new helpers. The UI package's
existing build step (`tsc` → `dist/`) emits the updated artifact that
the admin app consumes; no app-side changes needed.
