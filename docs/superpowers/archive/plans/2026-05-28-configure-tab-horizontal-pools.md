# Configure tab — fixed-width wrapping pool cards — Implementation Plan

> **Status (2026-07-01 doc review):** Superseded — the Configure-tab pool layout shipped as a vertical `flex flex-col gap-4` stack of `w-full` cards (one pool per row), not the `flex flex-wrap` + `w-72` wrapping row this plan proposed; neither the cited grid baseline nor the flex-wrap target exists in `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`. Audited against code.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the Configure tab's responsive grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`) for a wrapping flex row of fixed-width (`w-72`) pool cards so as many fit per row as the container's actual width allows, with overflow wrapping to the next row.

**Architecture:** One classlist change on the pool-grid wrapper + one classlist change on each pool card's outer `<div>` to add `w-72`. No new files, no new components, no new helpers. HTML5 native drag-drop continues to work because drop targets are per-card.

**Tech Stack:** Next.js 16 + React + Tailwind CSS v4 (web-admin app).

**Spec:** [`docs/superpowers/archive/specs/2026-05-28-configure-tab-horizontal-pools-design.md`](../specs/2026-05-28-configure-tab-horizontal-pools-design.md)

---

## File structure

| File                                                            | Action                     | Responsibility                                                                                     |
| --------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx` | Modify (2 classlist edits) | Wrapper at line 734 becomes `flex flex-wrap gap-4`; per-card `<div>` at line 736-741 gains `w-72`. |

Only one file. One commit. No tests (pure Tailwind classes; the existing pool-management suite doesn't assert on layout class names, and the spec explicitly defers extracting the width constant to a future regression).

---

## Task 1: Swap the pool-grid wrapper + add fixed width to each card

**Files:**

- Modify: [`apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`](apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx) — lines 734 and 736-741.

### Step 1.1: Apply the two classlist changes

- [ ] Open the file. Find this block at line 733-744:

```tsx
{/* Pool cards with drag-drop */}
{pools && pools.length > 0 && (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {pools.map((pool) => (
      <div
        key={pool.id}
        className={[
          'border-2 rounded-xl p-4 transition-colors',
          dragging ? 'border-dashed border-red-300 bg-red-50/30' : 'border-gray-200',
        ].join(' ')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => void handleDrop(pool.id)}
      >
```

- [ ] Replace with:

```tsx
{/* Pool cards with drag-drop */}
{pools && pools.length > 0 && (
  <div className="flex flex-wrap gap-4">
    {pools.map((pool) => (
      <div
        key={pool.id}
        className={[
          'w-72 border-2 rounded-xl p-4 transition-colors',
          dragging ? 'border-dashed border-red-300 bg-red-50/30' : 'border-gray-200',
        ].join(' ')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => void handleDrop(pool.id)}
      >
```

Two changes:

1. Line 734 wrapper: `grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` → `flex flex-wrap gap-4`.
2. Line 739 per-card classlist: prepend `'w-72 '` so the card becomes `w-72 border-2 rounded-xl p-4 transition-colors`.

Nothing else inside the card changes.

### Step 1.2: Run typecheck to confirm nothing else regressed

- [ ] Run from the repo root:

```bash
pnpm -F @myclash/web-admin typecheck
```

Expected: clean exit (no TypeScript errors). The change is class strings only — no type surface touched — so this should pass on the first try.

### Step 1.3: Run the existing pool-management tests as a regression guard

- [ ] Run:

```bash
pnpm -F @myclash/web-admin exec vitest run pools
```

Expected: same pass/fail baseline as before the change. The web-admin test suite includes `pools/_tabs/match-scores-merge.test.ts` and other pool-adjacent tests; none assert on the Configure tab's layout classes, so they should all stay green. (A separate unrelated pre-existing failure in `compute-wizard-step.test.ts` may show in totals — see commit ea452c7 era notes — that's not introduced by this change.)

### Step 1.4: Manual visual verification

- [ ] Run the dev server locally:

```bash
pnpm -F @myclash/web-admin dev
```

- [ ] Open the admin → an event with pools → Configure tab. Verify each of these viewport states by resizing the browser window (or use DevTools device emulation):

| Pool count | Viewport     | Expected                                                              |
| ---------- | ------------ | --------------------------------------------------------------------- |
| 0          | any          | empty state renders, no scroll                                        |
| 1          | 1440px       | single 288px card aligned left, no scroll                             |
| 5          | 1440px       | 4 cards row 1, 5th wraps to row 2                                     |
| 12         | 1440px       | 3 rows of 4                                                           |
| 5          | 768px tablet | sidebar wraps below; 2-3 cards per row                                |
| 20+        | 1440px       | rows fill, page scrollbar vertically engages, NO horizontal scrollbar |

- [ ] Drag a fighter from a pool on row 1 to a pool on row 2. Drop lands cleanly; the drag indicator (`border-dashed border-red-300 bg-red-50/30` from line 740) still appears on each pool while dragging.

### Step 1.5: Commit

- [ ] Stage and commit (from repo root):

```bash
git add apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx
git commit -m "feat(web-admin): Configure tab uses wrapping flex row of fixed-width pool cards

Replaces the breakpoint-pinned responsive grid
(grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4) with
'flex flex-wrap gap-4' and gives each pool card a fixed w-72
(~288px). Browser packs as many cards per row as the container's
actual width allows; overflow wraps to a new row below.

No horizontal scroll at any viewport. Vertical scroll continues to
use the page scrollbar. Right sidebar and drag-drop unchanged.
Scope: Configure tab only — Matches / Referees / Standings tabs
keep their distinct layouts.

Spec: docs/superpowers/archive/specs/2026-05-28-configure-tab-horizontal-pools-design.md
"
```

- [ ] Push:

```bash
git push origin main
```

---

## Self-review

**Spec coverage:**

- "Pool cards become fixed-width (`w-72`)" → Step 1.1 prepends `w-72`. ✓
- "As many fit per row as the container's actual width allows" → `flex flex-wrap` semantics. ✓
- "No horizontal scroll" → no `overflow-x` on the wrapper. ✓
- "Vertical scroll continues to use the page scrollbar (no internal scroll container)" → no `overflow-y` on the wrapper. ✓
- "Right sidebar stays" → parent `lg:grid-cols-[1fr_280px]` untouched. ✓
- "Drag-drop unchanged" → `onDragOver` / `onDrop` handlers on the card preserved verbatim. ✓
- "Non-goals: don't touch Matches / Referees / Standings" → only one file modified. ✓
- "Non-goals: don't extract into ConfigureTab.tsx" → no new files. ✓

**Placeholder scan:** every code block is concrete. No TBDs or "implement later" hooks. ✓

**Type consistency:** no types touched (class string change only). ✓

---

## Execution handoff

Plan complete and saved to `docs/superpowers/archive/plans/2026-05-28-configure-tab-horizontal-pools.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent for Task 1, review on completion, fast iteration.

**2. Inline Execution** — Execute the task in this session using executing-plans, single checkpoint at the end.

Given the change is one file and two classlist edits, inline execution is probably the more proportionate choice — but subagent-driven gives a clean review surface and stays consistent with the prior plans this session. Pick whichever you prefer.
