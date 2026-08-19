# Bracket MatchCard — wider cards + lift pills out of overflow-hidden — Implementation Plan

> **Status (2026-07-01 doc review):** Shipped, then superseded — the pill-reparenting landed and card width kept growing past this plan's target (now `min-w-[256px] max-w-[360px]`, not the `min-w-[220px] max-w-[360px]` prescribed here). Audited against code.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the "Pending" status pill and the round-code chip from being clipped on the admin bracket view, and give cards ~40px more breathing room.

**Architecture:** Two presentational edits in the shared `@myclash/ui` package. `MatchCard` width goes from `min-w-[180px] max-w-[320px]` to `min-w-[220px] max-w-[360px]`, and the two absolute-positioned pills move from inside the `overflow-hidden` card div to its outer wrapper (matching the existing pattern used by the unclipped override-edit button). `BracketView`'s round-column wrapper bumps to the same min/max so cards can actually reach the new ceiling.

**Tech Stack:** React + Tailwind CSS, packaged as `@myclash/ui` (tsc → `dist/`). The admin Next.js app consumes the rebuilt artifact automatically through workspace linkage.

**Spec:** [`docs/superpowers/archive/specs/2026-05-28-bracket-card-thickness-design.md`](../specs/2026-05-28-bracket-card-thickness-design.md)

---

## File structure

| File                                               | Action          | Responsibility                                                                                         |
| -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/ui/src/components/bracket/MatchCard.tsx` | Modify          | Bump width at line 84 + lift the two pills (lines 137-149) out of the card div onto the outer wrapper. |
| `packages/ui/src/components/BracketView.tsx`       | Modify (1 line) | Bump round-column width at line 215 to match the new card max.                                         |

Two files. One commit. No tests added (per spec — class+nesting change locks the wrong things in a snapshot).

---

## Task 1: Widen MatchCard and reparent the pills

**Files:**

- Modify: [`packages/ui/src/components/bracket/MatchCard.tsx`](packages/ui/src/components/bracket/MatchCard.tsx) — line 84 (width) + the JSX block at lines 136-149 (pill reparenting).

### Step 1.1: Bump the card width

- [ ] Open the file. Find the `cardClasses` array around line 83-89:

```tsx
const cardClasses = [
  'group relative flex h-[52px] w-full min-w-[180px] max-w-[320px] items-stretch overflow-hidden rounded-md bg-white shadow-sm transition-shadow',
  borderClass,
  handleClick ? 'cursor-pointer hover:shadow-md' : '',
]
  .filter(Boolean)
  .join(' ');
```

- [ ] Change the first string literal — `min-w-[180px] max-w-[320px]` → `min-w-[220px] max-w-[360px]`. Result:

```tsx
const cardClasses = [
  'group relative flex h-[52px] w-full min-w-[220px] max-w-[360px] items-stretch overflow-hidden rounded-md bg-white shadow-sm transition-shadow',
  borderClass,
  handleClick ? 'cursor-pointer hover:shadow-md' : '',
]
  .filter(Boolean)
  .join(' ');
```

Nothing else on that line changes. `h-[52px]`, `overflow-hidden`, `rounded-md`, `bg-white`, `shadow-sm`, `transition-shadow` all stay.

### Step 1.2: Move the two pills out of the card div

- [ ] In the same file, find the JSX block around lines 99-150:

```tsx
return (
  <div ref={refCallback} className="relative">
    <div
      role={handleClick ? 'button' : undefined}
      tabIndex={handleClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={
        handleClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClick();
            }
          : undefined
      }
      className={cardClasses}
    >
      {/* Stacked fighter rows. The two side colours render
          horizontally: each row owns a left stripe + tinted
          background driven by its sideColor (sourced from the
          tournament's scoring_config.display.sideColors). */}
      <div className="flex flex-1 flex-col">
        <FighterRow
          name={slot.redFighterName}
          club={slot.redClubAbbrev}
          score={slot.redScore}
          highlight={redWins}
          isCompleted={isCompleted}
          sideColor={redColor}
        />
        <FighterRow
          name={slot.blueFighterName}
          club={slot.blueClubAbbrev}
          score={slot.blueScore}
          highlight={blueWins}
          isCompleted={isCompleted}
          sideColor={blueColor}
        />
      </div>

      {/* Status pill bottom-right (absolute, outside the row flex) */}
      <span
        className={`absolute -bottom-2 right-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.cls}`}
      >
        {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />}
        {pill.label}
      </span>

      {/* Round code bottom-left, mirror to the status pill. */}
      {roundCode && (
        <span className="absolute -bottom-2 left-2 inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide text-slate-50">
          {roundCode}
        </span>
      )}
    </div>

    {onOverride && (
      <button
        type="button"
        aria-label="Override slot"
        ...
```

- [ ] Replace with the version below. The two `<span>` blocks for the status pill and the round code move OUT of the inner `<div className={cardClasses}>` (which has `overflow-hidden`) and become direct children of the outer `<div ref={refCallback} className="relative">` wrapper. The card div now contains only the fighter-rows wrapper. Both pills gain `z-10` to stack above the card body and any connector line.

```tsx
return (
  <div ref={refCallback} className="relative">
    <div
      role={handleClick ? 'button' : undefined}
      tabIndex={handleClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={
        handleClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClick();
            }
          : undefined
      }
      className={cardClasses}
    >
      {/* Stacked fighter rows. The two side colours render
          horizontally: each row owns a left stripe + tinted
          background driven by its sideColor (sourced from the
          tournament's scoring_config.display.sideColors). */}
      <div className="flex flex-1 flex-col">
        <FighterRow
          name={slot.redFighterName}
          club={slot.redClubAbbrev}
          score={slot.redScore}
          highlight={redWins}
          isCompleted={isCompleted}
          sideColor={redColor}
        />
        <FighterRow
          name={slot.blueFighterName}
          club={slot.blueClubAbbrev}
          score={slot.blueScore}
          highlight={blueWins}
          isCompleted={isCompleted}
          sideColor={blueColor}
        />
      </div>
    </div>

    {/* Status pill bottom-right — lifted out of the card's
        overflow-hidden so it renders fully. z-10 keeps it above
        connector lines that pass through the same region. */}
    <span
      className={`absolute -bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${pill.cls}`}
    >
      {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />}
      {pill.label}
    </span>

    {/* Round code bottom-left, mirror to the status pill. Also lifted. */}
    {roundCode && (
      <span className="absolute -bottom-2 left-2 z-10 inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide text-slate-50">
        {roundCode}
      </span>
    )}

    {onOverride && (
      <button
        type="button"
        aria-label="Override slot"
        ...
```

Three changes inside the JSX block:

1. The status pill `<span>` moves to be a sibling of the inner card div instead of a child.
2. The round-code `<span>` (inside the `{roundCode && (...)}` conditional) moves the same way.
3. Both spans gain `z-10` in their className strings.

The override-button `<button>` block at lines 152+ stays exactly where it is — it was already a sibling of the inner card div and the precedent for this pattern.

### Step 1.3: Verify the file looks right

- [ ] Scan the modified block. Checks:
  - The outer `<div ref={refCallback} className="relative">` has, in order: the inner card `<div>` (with fighter rows only), the status pill `<span>`, the round-code `<span>` (conditional), and the override `<button>` (conditional). Four direct children.
  - The inner `<div className={cardClasses}>` contains only the fighter-rows wrapper `<div className="flex flex-1 flex-col">`. No `<span>` siblings.
  - Both reparented pills include `z-10` in their className.
  - The card's `cardClasses` first-array-entry now reads `min-w-[220px] max-w-[360px]`.

---

## Task 2: Widen the round-column wrapper to match

**Files:**

- Modify: [`packages/ui/src/components/BracketView.tsx`](packages/ui/src/components/BracketView.tsx) — line 215.

### Step 2.1: Bump the column width

- [ ] Open the file. Find the round-column wrapper around line 213-216:

```tsx
const roundSlots = byRound.get(round) ?? [];
return (
  <div
    key={round}
    className="relative z-10 flex min-w-[180px] max-w-[320px] flex-1 flex-col"
  >
```

- [ ] Change the className — `min-w-[180px] max-w-[320px]` → `min-w-[220px] max-w-[360px]`:

```tsx
const roundSlots = byRound.get(round) ?? [];
return (
  <div
    key={round}
    className="relative z-10 flex min-w-[220px] max-w-[360px] flex-1 flex-col"
  >
```

Nothing else on the line changes. `relative`, `z-10`, `flex`, `flex-1`, `flex-col` all stay.

### Step 2.2: Confirm no other column wrappers need the same bump

- [ ] Run from the repo root:

```bash
grep -n "min-w-\[180px\]" packages/ui/src/components/BracketView.tsx
```

Expected: zero matches after Step 2.1. If the grep returns any hits, the bracket has a second column-width declaration (e.g. for the double-elim lower bracket) that also needs the same treatment.

If matches appear, replace each occurrence's `min-w-[180px] max-w-[320px]` with `min-w-[220px] max-w-[360px]`, then re-run the grep until it's empty.

---

## Task 3: Verify the build + commit

**Files:** none (verification + commit only).

### Step 3.1: Typecheck the UI package

- [ ] Run from the repo root:

```bash
pnpm -F @myclash/ui typecheck
```

Expected: clean exit. The change is class strings + JSX nesting; no type surface touched.

### Step 3.2: Rebuild the UI package so `dist/` reflects the source

- [ ] Run:

```bash
pnpm -F @myclash/ui build
```

Expected: clean build. The admin app imports `BracketView` and `MatchCard` from `@myclash/ui/dist/...`; without this rebuild the change won't propagate to the running app in development.

### Step 3.3: Typecheck the admin app (regression guard)

- [ ] Run:

```bash
pnpm -F @myclash/web-admin typecheck
```

Expected: clean. The admin's bracket page consumes `BracketView` through the UI package's public API and the API didn't change.

### Step 3.4: Manual visual verification

- [ ] Run the dev server locally:

```bash
pnpm -F @myclash/web-admin dev
```

- [ ] Open the admin → an event with a generated bracket. Verify each of these:

| Card state                                | Expected                                                       |
| ----------------------------------------- | -------------------------------------------------------------- |
| Round-1 card with "Pending" status        | Pill fully visible at the card's bottom-right; no truncation.  |
| Same card on a narrow viewport (≤1024px)  | Card is at least 220px wide; both chips render.                |
| Card with a round code (e.g. `LSW-QF-M1`) | Round-code chip fully visible at the card's bottom-left.       |
| Completed match                           | "Final" pill renders; winner highlight + score chip unchanged. |
| Bronze match (single-elim)                | Bronze dashed border unchanged; pills still render.            |
| Championship final                        | Gold accent + ring unchanged; pills render.                    |
| Card with an `onOverride` handler         | Pencil button still positioned at top-right, still clickable.  |

### Step 3.5: Commit

- [ ] Stage and commit (from repo root):

```bash
git add packages/ui/src/components/bracket/MatchCard.tsx packages/ui/src/components/BracketView.tsx packages/ui/dist
git commit -m "feat(ui): widen bracket cards + lift status pill / round code out of overflow-hidden

MatchCard cards bump from min-w-[180px] max-w-[320px] to
min-w-[220px] max-w-[360px], and the two absolute-positioned pills
('Pending'/'Final'/etc. on bottom-right + round code on bottom-left)
move from inside the card's overflow-hidden div onto the outer
wrapper that already hosts the unclipped override-edit button.

Both pills gain z-10 to stack above the card body and any connector
line that draws through the same region. The card keeps
overflow-hidden so the colored fighter rows still clip to the
rounded corners.

BracketView's round-column wrapper bumps to the same min/max so the
cards can actually reach their new ceiling.

Spec: docs/superpowers/archive/specs/2026-05-28-bracket-card-thickness-design.md"
```

- [ ] Push:

```bash
git push origin main
```

---

## Self-review

**Spec coverage:**

- "Both chips always render fully" → Step 1.2 reparents them. ✓
- "Cards have ~40px more breathing room" → Steps 1.1 + 2.1. ✓
- "Connector-line geometry unaffected" → Connectors compute from `registerRef`, which still wraps the same outer `<div>`. ✓
- "Card keeps overflow-hidden" → Step 1.1 leaves it in place. ✓
- "Override pencil keeps its position" → Step 1.2 doesn't touch it; only the two `<span>` pills move. ✓
- "z-10 keeps pills above connectors" → Step 1.2 adds `z-10` to both. ✓
- "Non-goal: public-app BracketView" → Out of scope. ✓
- "Non-goal: snapshot tests" → No tests added. ✓

**Placeholder scan:** every code block is complete and concrete. No TBDs.

**Type consistency:** no types touched.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/archive/plans/2026-05-28-bracket-card-thickness.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task with two-stage review per task; fast iteration consistent with prior plans this session.

**2. Inline Execution** — Execute the three tasks in this session using executing-plans, with checkpoints at the end of each task.

Which approach?
