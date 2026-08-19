# Live Control Room — Follow-ups Round 2 Implementation Plan

> **Status (2026-08-19):** Shipped — round-2 follow-ups to the live control room, which is live. Paths below name `apps/web-scoring`, renamed to `apps/web-staff` in `11db3c66`; read them as historical. The unchecked `- [ ]` boxes are an artefact of how the plan was written. Do not execute this plan.

**Goal:** Clear the deferred follow-ups the round-1 whole-branch review left open — a real phone-usable Live board, a single health-label vocabulary, a next-up match deep-link, and three heartbeat test/robustness gaps.

**Architecture:** Two independent groups on top of the shipped round-1 branch. **A (web-admin Live board)** consolidates the duplicated i18n health labels, then rebuilds the mobile (`< md`) view as stacked cards while the `md+` wide table is untouched, and points the next-up links at the specific match. **B (heartbeat robustness)** hardens two existing test suites and adds an in-flight guard to the scoring-app sender. No API surface, no schema, no new endpoints.

**Tech Stack:** Next.js App Router + `@myclash/ui` + Tailwind semantic tokens (web-admin, web-scoring), NestJS + Vitest (api), Vitest (web-scoring).

## Global Constraints

- **Base is the round-1 head `26b075a5`** (the shipped Live control-room follow-ups). This plan builds directly on it. No migration, no new API route, no schema change.
- **No known-red baseline.** As of `26b075a5` the whole tree is green (api 195 files/1633 tests, web-admin 392, web-scoring 70, i18n refs resolve). Any red you see is yours — isolate it to the file you touched.
- **Tokenized UI only:** build with `@myclash/ui` components + semantic tokens (`bg-surface`, `text-foreground`, `text-muted`, `border-border`, `bg-danger`, `bg-warning`, `bg-success`, `bg-muted`, `bg-foreground`); never raw palette classes or hex.
- **i18n:** every `t()` key must exist in **both** `en` and `fr` in `packages/i18n/src/index.ts` (the `t-key-references` lint fails otherwise, in BOTH directions — an unreferenced key is also a failure). Dynamic keys of the form ``t(`prefix.${x}`)`` are auto-covered by the reverse-sweep as long as the static prefix is ≥3 chars with a dot; `organizer.live.state.` already qualifies.
- **web-admin i18n hook is LOCAL:** `import { useI18n } from '@/i18n/I18nProvider'`, used as `const { t } = useI18n()`. A translate prop is typed `ReturnType<typeof useI18n>['t']` (aliased `T` in `LiveBoard.tsx`). (This is NOT `@myclash/i18n`.)
- **Path alias:** web-admin resolves `@/*` → `./src/*`.
- **`react-hooks/set-state-in-effect` is enforced at 0 in web-admin AND web-scoring.** None of these tasks add React state inside an effect. The heartbeat hook (Task 5) sets no state and stays exempt — do not introduce any setState there.
- **`no-misused-promises`:** never pass an `async`/Promise-returning function to a `() => void` sink; wrap it `() => void asyncFn()` (the heartbeat timers already do this — keep it).
- **`no-literal-string` (web-admin):** flags user-facing JSX **text** and the watched props `title/aria-label/placeholder/alt/label`. Symbol-only strings (no letters) are fine — e.g. `'—'`, `'▲'`, `` `✖ ${n}q·${r}r` ``, and a bare `·` text node between two `{…}` expressions (this exact pattern already ships in `BoardRowView`). Anything with letters in a text node or a watched prop must be a `t()` call.
- **Cross-app heartbeat field-name contract is FROZEN:** `{ outboxDepth, oldestPendingAgeSec, rejectedCount }` is shared verbatim by the web-scoring metrics helper, the `StaffHeartbeatDto`, and the DB write. Task 3/4/5 must not rename any of these.
- **Commit subjects must be lowercase** (commitlint `subject-case`): `feat(web-admin): stacked …`, never `Stacked …`.
- **Commit trailer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. (A round-1 commit shipped without it and had to be amended — do not repeat that.)
- **Concurrent sessions share this working tree.** Stage explicit paths (never `git add -A`); the pre-commit hook runs prettier on staged files, which may reformat them (expected). Do NOT push.
- **Verify commands.** web-admin: rebuild deps first (`pnpm --filter @myclash/i18n build && pnpm --filter @myclash/ui build`), then `pnpm --filter @myclash/web-admin exec tsc --noEmit`, `pnpm --filter @myclash/web-admin exec eslint <paths>`. i18n: `pnpm --filter @myclash/i18n test`. api: `pnpm --filter @myclash/api test -- <file>` and `pnpm --filter @myclash/api build` (the real typecheck — `tsc` stale-passes). web-scoring: `pnpm --filter @myclash/web-scoring test -- <file>` and `pnpm --filter @myclash/web-scoring exec tsc --noEmit`.

## File Structure

**web-admin (Group A):**

- `packages/i18n/src/index.ts` — **modify** (Task 1). Delete 3 duplicate flat keys per locale.
- `app/org/[slug]/events/[eventId]/live/LiveBoard.tsx` — **modify** (Tasks 1, 2). Repoint 3 cells (Task 1); NEXT match deep-link + new `BoardCard` mobile component (Task 2). Presentational — no RTL tests by repo convention.

**heartbeat (Group B):**

- `apps/api/src/modules/staff/staff.service.heartbeat.test.ts` — **modify** (Task 3). Assert account-scoping.
- `apps/web-scoring/src/offline/heartbeat.test.ts` — **modify** (Task 4). Two edge-case tests.
- `apps/web-scoring/src/hooks/useHeartbeat.ts` — **modify** (Task 5). In-flight guard + drop dead guard.

**Explicitly OUT of scope (round-1 review finding N3, accepted as-is):** the fact that each piste renders in both the `hidden md:block` table (`BoardRowView`) and the `md:hidden` card list (`BoardCard`) with CSS hiding one — this is the standard Tailwind responsive idiom and the round-1 review said no action needed. Do not try to de-duplicate the two presentational components into one.

---

## Task 1: consolidate duplicate flat health i18n keys onto `state.*`

**Files:**

- Modify: `packages/i18n/src/index.ts`
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`

**Interfaces:** none changed (i18n keys + JSX only).

Round-1 review deferred finding #3: `organizer.live` carries flat cell-text keys (`idle`, `noScorer`, `unknown`, `synced`) that overlap the nested `state.*` health-dot aria keys added in round-1. In BOTH locales, `idle`/`noScorer`/`synced` are **byte-identical** to `state.idle`/`state.no_scorer`/`state.synced`, so they are true duplicates. `unknown` is NOT a duplicate — flat `unknown` is the compact health-cell text (`'Unknown'`/`'Inconnu'`) while `state.unknown` is the fuller dot aria label (`'Health unknown'`/`'État inconnu'`) — so it stays split. Delete the three duplicates and source those three cell sites from `state.*`; keep `unknown`. Zero visible/aria copy changes.

Presentational + i18n — verified by i18n test + typecheck + lint.

- [ ] **Step 1: Delete the three duplicate flat keys — EN.** In `packages/i18n/src/index.ts`, in the **EN** `organizer.live` block (the one whose `forbidden` reads `'You do not have access to this event.'`), delete exactly these three lines:

```
      idle: 'Idle',
      noScorer: 'No scorer',
```

and

```
      synced: 'Synced',
```

Leave `unknown: 'Unknown',` in place, and leave the whole `state: { … }` sub-object untouched. Add a clarifying comment immediately above `unknown:` so the remaining flat key's purpose is unambiguous:

```ts
      // Compact health-cell text. Deliberately distinct from state.unknown
      // ('Health unknown'), which is the dot's fuller aria label. idle/
      // no_scorer/synced were byte-identical duplicates of state.* and were
      // removed — those cells now read straight from organizer.live.state.*.
      unknown: 'Unknown',
```

- [ ] **Step 2: Delete the three duplicate flat keys — FR.** In the **FR** `organizer.live` block (the one whose `forbidden` reads `"Vous n'avez pas accès à cet évènement."`), delete exactly:

```
      idle: 'Inactif',
      noScorer: 'Aucun marqueur',
```

and

```
      synced: 'Synchronisé',
```

Leave `unknown: 'Inconnu',` in place (no comment needed on the FR side; the EN comment documents the pattern). Leave the FR `state: { … }` sub-object untouched.

- [ ] **Step 3: Repoint the three cell sites in `LiveBoard.tsx`.** In `BoardRowView`, make exactly these three replacements (the `unknown` cell is unchanged):
  1. The idle score-cell fallback:

  ```tsx
  <span className="flex-1 truncate text-muted">{t('organizer.live.idle')}</span>
  ```

  →

  ```tsx
  <span className="flex-1 truncate text-muted">{t('organizer.live.state.idle')}</span>
  ```

  2. The no-scorer fallback:

  ```tsx
  t('organizer.live.noScorer');
  ```

  →

  ```tsx
  t('organizer.live.state.no_scorer');
  ```

  3. The synced health readout (the final branch of the health ternary):

  ```tsx
                : t('organizer.live.synced')}
  ```

  →

  ```tsx
                : t('organizer.live.state.synced')}
  ```

  Do NOT touch `t('organizer.live.unknown')` (the `row.health === null` branch) — that flat key is intentionally retained.

- [ ] **Step 4: Verify.**

```bash
pnpm --filter @myclash/i18n build
pnpm --filter @myclash/web-admin exec tsc --noEmit
pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
pnpm --filter @myclash/i18n test
```

Expected: all clean. The i18n reverse-sweep passes because the three deleted keys are no longer referenced anywhere (grep-confirmed: their only uses were the three cells you just repointed), and `state.idle`/`state.no_scorer`/`state.synced` remain referenced (now by both the dynamic aria-label and these explicit cells).

- [ ] **Step 5: Commit.**

```bash
git add packages/i18n/src/index.ts "apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx"
git commit -m "refactor(web-admin): dedupe live-board health labels onto the state keys"
```

Body must end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 2: stacked-card mobile board + next-up match deep-link

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`

**Interfaces:**

- Consumes: `BoardRow` (from `./types`) — note `nextUp: { matchId: string; label: string } | null` (matchId is populated by the API `live-board.ts`), `currentMatch: BoardMatch | null`, `scorer`, `health`, `attention`; `deriveHealthState`, `DOT`, and the `T` translate type already in the file.
- Produces: a new `BoardCard` presentational component (mobile only). No exports.

Round-1 review finding N1: the `md:hidden` view only _folds away_ healthy pistes — each problem row is still the wide desktop flex row (~30rem of `shrink-0` cells), so a phone scrolls horizontally, and round-1's own NEXT column made it wider. Rebuild the mobile view as stacked cards. Also apply deferred finding #2: the next-up links (desktop cell **and** the new card) point at the specific match (`/matches/${nextUp.matchId}`) instead of the schedule page. The `hidden md:block` wide table and the `BoardRowView` component it uses are unchanged **except** the desktop NEXT cell's href.

**Depends on Task 1** (the card reads `organizer.live.state.idle/no_scorer/synced` + flat `unknown`). Run Task 1 first.

Presentational — no RTL test. Verified by typecheck + lint + the manual walk.

- [ ] **Step 1: Point the desktop NEXT cell at the match.** In `BoardRowView`, in the last `<span className="w-20 …">` cell, change only the `href`:

```tsx
<Link
  href={`/org/${slug}/events/${eventId}/schedule`}
  className="hover:underline"
  title={t('organizer.live.nextLabel')}
>
  {row.nextUp.label}
</Link>
```

→

```tsx
<Link
  href={`/org/${slug}/events/${eventId}/matches/${row.nextUp.matchId}`}
  className="hover:underline"
  title={t('organizer.live.nextLabel')}
>
  {row.nextUp.label}
</Link>
```

(Inside the `row.nextUp ? …` ternary, `row.nextUp` is non-null, so `row.nextUp.matchId` is safe.)

- [ ] **Step 2: Add the `BoardCard` component.** Append it immediately after the `BoardRowView` function definition (it reuses the module-level `DOT`, `deriveHealthState`, and the `T` type):

```tsx
// Mobile (< md): one stacked card per piste. The wide desktop row
// (BoardRowView) is unusable on a phone — this variant stacks the piste
// header, the score line, and a wrapping meta row (status · scorer · health)
// so a card never forces horizontal scroll.
function BoardCard({
  row,
  slug,
  eventId,
  onAck,
  t,
}: {
  row: BoardRow;
  slug: string;
  eventId: string;
  onAck: (id: string) => void;
  t: T;
}) {
  const state = deriveHealthState(row);
  const cm = row.currentMatch;
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`}
          aria-label={t(`organizer.live.state.${state}`)}
        />
        <Link
          href={`/org/${slug}/events/${eventId}/schedule`}
          className="min-w-0 flex-1 truncate font-semibold text-foreground hover:underline"
        >
          {row.lice.name}
        </Link>
        {row.nextUp && (
          <Link
            href={`/org/${slug}/events/${eventId}/matches/${row.nextUp.matchId}`}
            className="shrink-0 truncate text-xs text-muted hover:underline"
            title={t('organizer.live.nextLabel')}
          >
            {t('organizer.live.nextLabel')} · {row.nextUp.label}
          </Link>
        )}
      </div>
      {cm ? (
        <Link
          href={`/org/${slug}/events/${eventId}/matches/${cm.id}`}
          className="truncate text-foreground hover:underline"
        >
          {`${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`}
        </Link>
      ) : (
        <span className="text-muted">{t('organizer.live.state.idle')}</span>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {cm && <span>{`${cm.round ? `R${cm.round} · ` : ''}${cm.status}`}</span>}
        <span className="min-w-0 truncate">
          {row.scorer ? (
            <Link href={`/org/${slug}/events/${eventId}/staff`} className="hover:underline">
              {row.scorer.name}
            </Link>
          ) : (
            t('organizer.live.state.no_scorer')
          )}
        </span>
        <span>
          {row.health === null
            ? t('organizer.live.unknown')
            : row.health.rejectedCount > 0
              ? `✖ ${row.health.outboxDepth}q·${row.health.rejectedCount}r`
              : row.health.outboxDepth > 0
                ? `▲ ${row.health.outboxDepth}q`
                : t('organizer.live.state.synced')}
        </span>
      </div>
      {row.attention && row.scorer && (
        <button
          type="button"
          onClick={() => onAck(row.scorer!.accountId)}
          className="self-start rounded-md bg-danger/10 px-2 py-1 text-xs text-danger"
        >
          {t(`organizer.live.reason.${row.attention.reason}`)} · {t('organizer.live.ack')}
        </button>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Render `BoardCard` in the mobile block.** In `LiveBoard`, the `<div className="md:hidden">` block currently renders `BoardRowView` in both the problems `<ul>` and the folded healthy `<ul>`. Swap **both** to `BoardCard` (identical prop set). The fold `<button>` (with its `aria-expanded`/`aria-hidden` from round-1) is unchanged. After the swap the block reads:

```tsx
{
  /* Phone: problems first as stacked cards; healthy pistes folded away */
}
<div className="md:hidden">
  <ul className="divide-y divide-border">
    {problems.map((row) => (
      <BoardCard
        key={row.lice.id}
        row={row}
        slug={slug}
        eventId={eventId}
        onAck={(id) => void acknowledge(id)}
        t={t}
      />
    ))}
  </ul>
  {healthy.length > 0 && (
    <>
      <button
        type="button"
        onClick={() => setShowHealthy((v) => !v)}
        aria-expanded={showHealthy}
        className="mt-2 flex w-full items-center gap-2 py-2 text-sm text-muted"
      >
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-success" />
        {t('organizer.live.healthyFold', { count: healthy.length })}
        <span aria-hidden>{showHealthy ? '▾' : '▸'}</span>
      </button>
      {showHealthy && (
        <ul className="divide-y divide-border opacity-60">
          {healthy.map((row) => (
            <BoardCard
              key={row.lice.id}
              row={row}
              slug={slug}
              eventId={eventId}
              onAck={(id) => void acknowledge(id)}
              t={t}
            />
          ))}
        </ul>
      )}
    </>
  )}
</div>;
```

The `hidden md:block` wide table above it (which maps `sorted` over `BoardRowView`) and the per-lice `<LiceRealtime>` subscribers are unchanged.

- [ ] **Step 4: Verify.**

```bash
pnpm --filter @myclash/i18n build
pnpm --filter @myclash/web-admin exec tsc --noEmit
pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
```

Expected: clean. In particular no `no-literal-string`: every text sink is a `t()` call or a symbol-only string; the `·` text node between `{t(...)}` and `{row.nextUp.label}` mirrors the existing attention-cell `·` and is lint-safe.

- [ ] **Step 5: Commit.**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx"
git commit -m "feat(web-admin): stacked-card live board on mobile with next-up match deep-links"
```

Body must end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 3: assert the heartbeat write is account-scoped

**Files:**

- Modify: `apps/api/src/modules/staff/staff.service.heartbeat.test.ts`

**Interfaces:** none — test-only.

Round-1 review deferred finding #5: `recordHeartbeat` IS correctly scoped — `.eq('event_id', staff.event_id).eq('id', staff.id)` off the staff cookie — but the test's mock `eq: vi.fn(() => chain)` discards its arguments, so the test never asserts the scoping. A regression that dropped `event_id` (a cross-event write) would pass. Capture the `.eq()` calls and assert both filters. The code is already correct, so this new assertion passes immediately — it locks in the security-relevant filter.

- [ ] **Step 1: Capture `.eq()` args in the mock and assert them.** Replace the test body's mock + assertions. The full file becomes:

```ts
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

const req = { cookies: {} } as never;

describe('StaffService.recordHeartbeat', () => {
  it('stamps the metrics + last_seen_at, scoped to the caller staff account', async () => {
    const updates: Record<string, unknown>[] = [];
    const eqCalls: Array<[string, unknown]> = [];
    const service = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {
          update: vi.fn((patch: Record<string, unknown>) => {
            updates.push(patch);
            return chain;
          }),
          eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
          }),
          then: (r: (v: { data: null; error: null }) => void) => r({ data: null, error: null }),
        };
        return chain;
      }),
    };
    const svc = new StaffService({ service } as never, {} as never, {} as never);
    vi.spyOn(
      svc as never as { requireStaffFromRequest: () => Promise<{ id: string; event_id: string }> },
      'requireStaffFromRequest',
    ).mockResolvedValue({ id: 'a1', event_id: 'E1' });

    await expect(
      svc.recordHeartbeat(req, { outboxDepth: 3, oldestPendingAgeSec: 42, rejectedCount: 1 }),
    ).resolves.toEqual({ ok: true });

    expect(updates[0]).toMatchObject({
      outbox_depth: 3,
      oldest_pending_age_seconds: 42,
      rejected_count: 1,
    });
    expect(typeof updates[0]!['last_seen_at']).toBe('string');

    // The write must be scoped to the caller's OWN account — both the event
    // and the account id — never a cross-event or cross-account write.
    expect(eqCalls).toContainEqual(['event_id', 'E1']);
    expect(eqCalls).toContainEqual(['id', 'a1']);
  });
});
```

- [ ] **Step 2: Run it.**

Run: `pnpm --filter @myclash/api test -- staff.service.heartbeat`
Expected: PASS (1 test). The two new `toContainEqual` assertions pass against the already-correct `.eq('event_id', …).eq('id', …)` in `recordHeartbeat`.

- [ ] **Step 3: Full API build (guards against a typed-mock drift).**

Run: `pnpm --filter @myclash/api build`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add apps/api/src/modules/staff/staff.service.heartbeat.test.ts
git commit -m "test(api): assert the staff heartbeat write is account-scoped"
```

Body must end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 4: harden the heartbeat-metrics edge cases

**Files:**

- Modify: `apps/web-scoring/src/offline/heartbeat.test.ts`

**Interfaces:** none — test-only. Uses the existing `entry()` factory and `computeHeartbeatMetrics`/`STUCK_ATTEMPTS` already imported in the file.

Round-1 review deferred finding #6: the "oldest age" test happens to put the oldest entry LAST, so a buggy `entries[entries.length - 1].createdAt` would pass; and the `Math.max(0, …)` floor (clock-skew guard) is untested. Add two tests that pin these. Both pass against the current correct implementation (`reduce(Math.min)` + `Math.max(0, Math.floor(...))`).

- [ ] **Step 1: Add the two tests.** Insert these two `it(...)` blocks inside the existing `describe('computeHeartbeatMetrics', …)` block (e.g. immediately after the "counts depth and the oldest age" test):

```ts
it('uses the oldest entry regardless of array order (oldest first)', () => {
  const m = computeHeartbeatMetrics(
    [entry({ createdAt: NOW - 40_000 }), entry({ createdAt: NOW - 5_000 })],
    NOW,
  );
  // Oldest is now the FIRST element — a last-element bug would report 5, not 40.
  expect(m.oldestPendingAgeSec).toBe(40);
});

it('never reports a negative age when an entry timestamp is in the future', () => {
  const m = computeHeartbeatMetrics([entry({ createdAt: NOW + 5_000 })], NOW);
  expect(m.oldestPendingAgeSec).toBe(0);
});
```

- [ ] **Step 2: Run it.**

Run: `pnpm --filter @myclash/web-scoring test -- heartbeat`
Expected: PASS (5 tests total in the file now).

- [ ] **Step 3: Commit.**

```bash
git add apps/web-scoring/src/offline/heartbeat.test.ts
git commit -m "test(web-scoring): pin heartbeat-metrics order-independence and age floor"
```

Body must end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 5: guard the heartbeat sender against overlapping sends

**Files:**

- Modify: `apps/web-scoring/src/hooks/useHeartbeat.ts`

**Interfaces:** none changed — same `useHeartbeat(): void` signature.

Round-1 review deferred finding #7: the 20s interval fires unconditionally, so a slow/hanging `fetch` can overlap with the next tick (two in-flight POSTs). It's harmless telemetry, but an in-flight guard is cheap and correct. Also drop the `typeof navigator !== 'undefined'` dead-code branch — this is a `'use client'` effect that only ever runs in the browser, where `navigator` is always defined. The hook still sets no React state (stays exempt from `set-state-in-effect`) and keeps `() => void send()` at both timer sites (`no-misused-promises`).

Glue (I/O only) — no unit test; verified by typecheck + lint.

- [ ] **Step 1: Add the in-flight guard and simplify the online check.** Replace the effect body's `send` closure. The current effect is:

```ts
  useEffect(() => {
    let cancelled = false;

    async function send(): Promise<void> {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const entries = await getAllPending();
        const metrics = computeHeartbeatMetrics(entries, Date.now());
        if (cancelled) return;
        await fetch(`${getApiUrl()}/api/v1/staff/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(metrics),
        });
      } catch {
        // best-effort telemetry; never surface
      }
    }
```

Replace it with:

```ts
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function send(): Promise<void> {
      // Skip if the previous send is still in flight (a slow fetch must not
      // stack a second POST on the next tick) or if we're offline.
      if (inFlight || !navigator.onLine) return;
      inFlight = true;
      try {
        const entries = await getAllPending();
        const metrics = computeHeartbeatMetrics(entries, Date.now());
        if (cancelled) return;
        await fetch(`${getApiUrl()}/api/v1/staff/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(metrics),
        });
      } catch {
        // best-effort telemetry; never surface
      } finally {
        inFlight = false;
      }
    }
```

Leave the rest of the effect (the `setTimeout`/`setInterval` scheduling and the cleanup that clears both and sets `cancelled = true`) exactly as-is.

- [ ] **Step 2: Typecheck + lint.**

```bash
pnpm --filter @myclash/web-scoring exec tsc --noEmit
pnpm --filter @myclash/web-scoring exec eslint src/hooks/useHeartbeat.ts
```

Expected: clean — no `set-state-in-effect` (no state set), no `no-misused-promises` (timers still `() => void send()`), no unused vars.

- [ ] **Step 3: Commit.**

```bash
git add apps/web-scoring/src/hooks/useHeartbeat.ts
git commit -m "refactor(web-scoring): in-flight guard for the tablet heartbeat sender"
```

Body must end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 6: Integration verification (no code)

- [ ] **Step 1: Full sweep.**

```bash
pnpm --filter @myclash/i18n build && pnpm --filter @myclash/ui build
pnpm --filter @myclash/web-admin exec tsc --noEmit && pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
pnpm --filter @myclash/web-admin test
pnpm --filter @myclash/api test -- staff.service.heartbeat && pnpm --filter @myclash/api build
pnpm --filter @myclash/web-scoring test -- heartbeat && pnpm --filter @myclash/web-scoring exec tsc --noEmit
pnpm --filter @myclash/i18n test
```

Expected: all green.

- [ ] **Step 2: Manual walk.**
  - **Consolidated labels (Task 1):** on `/org/<slug>/events/<eventId>/live`, an idle piste's score cell still reads "Idle"/"Inactif", an unassigned scorer still reads "No scorer"/"Aucun marqueur", a synced piste's health cell still reads "Synced"/"Synchronisé", and a null-health cell still reads the compact "Unknown"/"Inconnu" (not "Health unknown"). The health dot's tooltip is unchanged.
  - **Mobile cards + next-up (Task 2):** narrow the viewport below `md` — each problem piste is a stacked card (piste + next-up on top, score line, then a wrapping status·scorer·health meta row) with NO horizontal page scroll; the "N pistes synced ▸" fold still gates the healthy cards. The next-up link (card and the `md+` desktop cell) navigates to that specific match's page.
  - **Heartbeat (Tasks 3–5):** unchanged runtime behavior — the tablet still POSTs every ~20s; the board's SYNC cell for a lice with a growing outbox still moves off "unknown". (Tasks 3/4 are test-only; Task 5 only prevents overlapping POSTs.)

- [ ] **Step 3: Stop for review.** (Do not commit fixups beyond the per-task commits above without review.)

---

## Self-Review

**Coverage of the deferred items** (round-1 whole-branch review):

- N1 real mobile layout → Task 2 (stacked `BoardCard`). ✅
- #2 next-up `matchId` unused → Task 2 (desktop cell + card deep-link to `/matches/${matchId}`). ✅
- #3 flat vs nested key overlap → Task 1 (delete the 3 true duplicates, keep `unknown` split, document). ✅
- #5 heartbeat scoping untested → Task 3. ✅
- #6 metrics order-independence + floor untested → Task 4. ✅
- #7 overlapping sends + dead `typeof navigator` → Task 5. ✅
- N3 double render → explicitly OUT of scope (intentional responsive idiom). ✅

**Placeholder scan:** every step carries the exact code or exact command. The only non-verbatim element is which whitespace prettier applies on commit (expected per Global Constraints).

**Type/name consistency:** `BoardCard` reuses the same prop shape as `BoardRowView` (`{ row, slug, eventId, onAck, t }`) and the module-level `DOT`/`deriveHealthState`/`T`. It reads `organizer.live.state.idle/no_scorer/synced` (the keys Task 1 keeps) + flat `organizer.live.unknown` (the key Task 1 keeps) — no reference to the three deleted keys. The heartbeat field names `{ outboxDepth, oldestPendingAgeSec, rejectedCount }` are untouched across Tasks 3–5.

**Ordering:** Task 1 before Task 2 (the card reads the consolidated keys). Tasks 3, 4, 5 are mutually independent and independent of Group A. Task 6 last.

**No migration / no API change:** confirmed — Group A is presentational + i18n; Group B is test-only (Tasks 3–4) plus a client-hook guard (Task 5). The heartbeat endpoint, DTO, and `event_staff_accounts` columns are untouched.
