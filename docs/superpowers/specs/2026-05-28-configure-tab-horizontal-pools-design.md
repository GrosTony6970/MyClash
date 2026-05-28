# Configure tab — fixed-width pool cards that wrap

**Date:** 2026-05-28
**Status:** Approved
**Scope:** Configure tab on the pool-management page only.

## Problem

The Configure tab on `/org/:slug/events/:eventId/pools` renders pool
cards in a responsive grid pinned to breakpoint-driven column counts
(`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). Wide
screens cap at 4 cards per row even when there's room for 5-6, and
the locked breakpoints don't react well when the right sidebar
relocates beneath the grid on narrow viewports.

The user wants pools laid out so that as many cards fit per row as
the container's actual width allows, with any overflow wrapping to a
new row beneath. No horizontal scroll. Vertical scroll is the page
scrollbar as normal.

## Goals & non-goals

**Goals**

- Pool cards become fixed-width (`w-72`, ≈288px). The browser packs
  as many as fit on each row; the rest wrap below.
- Behaviour scales smoothly from tablet (1-2 per row) to ultrawide
  (5-6+ per row), driven by actual container width, not viewport
  class names.
- No horizontal scroll under any viewport size.
- Vertical scroll continues to use the page scrollbar (no internal
  scroll container on the pool grid).

**Non-goals**

- Touching the Matches / Referees / Standings tabs.
- Extracting the Configure tab into a separate `_tabs/ConfigureTab.tsx`
  component. That's a separate housekeeping pass.
- Swapping the HTML5 native drag-drop for a library. Drop targets are
  per-card, so wrapped layouts already work.
- Removing or repositioning the right sidebar (assignment config form
  - lifecycle buttons stay).

## Layout change

One classlist swap on the pool-grid wrapper at
[`apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx:734`](apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx#L734).

Before:

```tsx
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {pools.map((pool) => (
    <div key={pool.id} className="rounded-lg border border-gray-200 …" …>
      {/* pool card body */}
    </div>
  ))}
</div>
```

After:

```tsx
<div className="flex flex-wrap gap-4">
  {pools.map((pool) => (
    <div key={pool.id} className="w-72 rounded-lg border border-gray-200 …" …>
      {/* pool card body */}
    </div>
  ))}
</div>
```

Only the wrapper's class list and the card's outer `<div>` class list
change. Everything inside the card (header, fighter rows, drag
handles, remove buttons) is untouched.

## Why `flex flex-wrap` + fixed `w-72` (not CSS grid)

`grid` with `auto-fill` / `minmax(...)` would also work, but it
spreads cards to fill the remaining row width, which makes a single
card look stretched and odd. `flex-wrap` + fixed-width keeps each
card the same compact size and left-aligns the row. The user reads
"one pool per visual unit" more naturally with consistent card sizes.

## Behaviour by viewport

- **0 pools:** existing empty state renders (no change).
- **1 pool:** single 288px card aligned left.
- **5 pools at 1440px:** 4 cards fit row 1, the 5th wraps below.
- **12 pools at 1440px:** 3 rows of 4.
- **Tablet (sidebar drops below):** 2-3 cards per row driven by
  available width.
- **Many pools (rows exceed viewport height):** the page scrolls
  vertically as normal — the pool grid does NOT get its own internal
  scroll container, so the page scrollbar remains the single scroll
  axis and any `lg:sticky` on the right sidebar continues to work.
- **No horizontal scrollbar at any viewport size.**

## Drag-and-drop

Unchanged. HTML5 native drag-drop fires `onDragOver`/`onDrop` on each
pool card individually. Wrapped layouts work because the drop target
is the card itself, not the row. A user dragging from a pool on row
1 to a pool on row 2 works exactly as it does today between any two
pools.

## Test plan

Pure-Tailwind class change with no new helpers; the existing
pool-management tests don't assert on layout class names. Verification
is manual:

- 0 pools → empty state renders, no scroll.
- 1 pool → single card left-aligned, no scroll.
- 5 pools on a 1440px viewport → 4 + 1 layout.
- 12 pools on a 1440px viewport → 3 rows of 4.
- Resize the browser slowly: pools reflow, count per row decreases
  without horizontal scrollbars ever appearing.
- Drag a fighter from a pool on row 1 to a pool on row 2 → drag/drop
  works.
- Many pools (e.g. 20+): page scrolls vertically; right sidebar's
  sticky behaviour (if present) continues to work.

If a future regression makes the wrapping break, extract the card
width into a named constant and assert on it then.

## Risk & rollback

- **Risk:** the `lg:sticky` (if any) on the right sidebar could
  interact poorly with the new flex layout. Mitigation: the parent
  `lg:grid-cols-[1fr_280px]` split isn't changing, so the sidebar
  column geometry is identical.
- **Risk:** drag-drop near a row boundary feels different (cards
  reflow as the row count changes). Mitigation: the drag target is
  the dropped-on card, not the row — the user's mental model is
  per-card, so the row layout is incidental.
- **Rollback:** revert the one classlist change. Single-commit
  revert, no migration or data implications.

## Critical files

- [`apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`](apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx)
  — line 734 (wrapper) and the pool card's outer `<div>` className
  (around line 736-740).

No other files. No new components. No new helpers.

## References

- The Matches tab uses a different responsive grid
  (`grid-cols-1 md:grid-cols-2`) at
  `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx:204`
  — intentionally capped at 2 because match tables are wider. Don't
  align it with the new Configure tab layout.
- Pool-card content (`pool.name`, fighter rows, HEMA rating badges,
  drag handlers) is preserved verbatim; only the wrapping flex
  container's class list changes.
