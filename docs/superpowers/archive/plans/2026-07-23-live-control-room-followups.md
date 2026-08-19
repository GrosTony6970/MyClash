# Live Control Room — Follow-ups Implementation Plan

> **Status (2026-08-19):** Shipped — follow-ups to the live control room, which is live. Paths below name `apps/web-scoring`, renamed to `apps/web-staff` in `11db3c66`; read them as historical. The unchecked `- [ ]` boxes are an artefact of how the plan was written. Do not execute this plan.

**Goal:** Polish the shipped Live control-room board (deep-links, a11y, responsive, lighter polling), light up its health lens by adding the Phase-5 tablet heartbeat end-to-end, and clear the one genuinely-red test suite left on `main`.

**Architecture:** Three independent groups. **A (board polish)** is presentational web-admin work on the existing `live/` route — verified by typecheck/lint/manual per repo convention, with one extracted pure helper that carries a test. **B (heartbeat)** is a new cross-app path: the scoring PWA computes sync metrics from its IndexedDB outbox and POSTs them on a timer to a new staff-authed API endpoint that stamps them onto `event_staff_accounts` — the columns the board already reads. **C (repo health)** fixes a stale test mock and three FR i18n typos.

**Tech Stack:** NestJS + Fastify + Supabase + `nestjs-zod` (API), Next.js App Router + `@myclash/ui` + Tailwind semantic tokens (web-admin, web-scoring), Dexie/IndexedDB (web-scoring offline), Vitest.

## Global Constraints

- **Do not renumber or add migrations.** The heartbeat writes to columns that already exist on `event_staff_accounts` (migration `0149`, already on `main`). No schema change is in scope.
- **Tokenized UI only:** build with `@myclash/ui` components + semantic tokens (`bg-surface`, `text-foreground`, `text-muted`, `border-border`, `bg-danger`, `bg-warning`, `bg-success`, `bg-muted`, `bg-foreground`); never raw palette classes or hex.
- **i18n:** every `t()` key must exist in **both** `en` and `fr` in `packages/i18n/src/index.ts` (the `t-key-references` lint fails otherwise). Dynamic keys of the form ``t(`prefix.${x}`)`` are auto-covered by the reverse-sweep as long as the static prefix is ≥3 chars with a dot.
- **web-admin i18n hook is LOCAL:** `import { useI18n } from '@/i18n/I18nProvider'`, used as `const { t } = useI18n()`. Type a translate prop as `ReturnType<typeof useI18n>['t']`. (This is NOT `@myclash/i18n`.)
- **web-scoring i18n hook:** `import { useI18n } from '../i18n/I18nProvider'` (or the correct relative depth), also `const { t } = useI18n()`.
- **Path alias:** web-admin resolves `@/*` → `./src/*`. Use `@/lib/...`, `@/i18n/...`.
- **web-admin API base:** `process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'`. web-scoring API base: `getApiUrl()` from `src/lib/api-url.ts` (returns `''` in the browser → same-origin).
- **`react-hooks/set-state-in-effect` is enforced at 0 in web-admin AND web-scoring.** Never call a setState (directly or via a callback the linter can see) synchronously in an effect body; defer the first call with `window.setTimeout(fn, 0)` (see the existing `useLiveBoard`/`live-now-banner.tsx` pattern). A hook that only performs I/O (no setState) is fine.
- **`no-misused-promises`:** never pass an `async`/Promise-returning function to a prop typed `() => void`; wrap it `onX={() => void asyncFn()}`.
- **`no-literal-string` (web-admin + web-scoring):** flags user-facing JSX **text** and the watched props `title/aria-label/placeholder/alt/label`. Symbol-only strings (no letters) inside `{…}` expressions are fine; anything with letters in those sinks must be a `t()` call.
- **Commit subjects must be lowercase** (commitlint `subject-case`): `feat(web-admin): live …`, never `feat(web-admin): Live …`.
- **Commit trailer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Concurrent sessions share this working tree.** Stage explicit paths (never `git add -A`); the pre-commit hook runs prettier on staged files, which may reformat them (expected).
- **Verify commands.** API: `pnpm --filter @myclash/api build` (the real typecheck — `tsc` stale-passes) and `pnpm --filter @myclash/api test`. web-admin: rebuild deps first (`pnpm --filter @myclash/i18n build && pnpm --filter @myclash/ui build`), then `pnpm --filter @myclash/web-admin exec tsc --noEmit`, `pnpm --filter @myclash/web-admin exec eslint <paths>`, `pnpm --filter @myclash/web-admin test`. web-scoring: `pnpm --filter @myclash/web-scoring test` and `pnpm --filter @myclash/web-scoring exec tsc --noEmit`. i18n: `pnpm --filter @myclash/i18n test`.
- **Known-red baseline (NOT yours):** `events.service.test.ts` is red until Task 8. Ignore it when judging other tasks; isolate any failure to the file you touched.

## File Structure

**web-admin (Group A):**

- `app/org/[slug]/events/[eventId]/live/LiveBoard.tsx` — **modify** (A1, A2, A3, A4). Presentational.
- `app/org/[slug]/events/[eventId]/live/live-board-state.ts` (+ `.test.ts`) — **modify** (A3). Add `partitionByHealth()`.
- `packages/i18n/src/index.ts` — **modify** (A1, A2, C2). New `organizer.live.state.*` + `organizer.live.next`; FR typo fixes.

**API (Group B):**

- `apps/api/src/modules/staff/dto.ts` — **modify** (B1). Add `StaffHeartbeatDto`.
- `apps/api/src/modules/staff/staff.service.ts` — **modify** (B1). Add `recordHeartbeat()`.
- `apps/api/src/modules/staff/staff.controller.ts` — **modify** (B1). Add `POST staff/heartbeat`.
- `apps/api/src/modules/staff/staff.service.heartbeat.test.ts` — **new** (B1).

**web-scoring (Group B):**

- `apps/web-scoring/src/offline/heartbeat.ts` (+ `.test.ts`) — **new** (B2). Pure `computeHeartbeatMetrics()`.
- `apps/web-scoring/src/hooks/useHeartbeat.ts` — **new** (B3). Timer + POST.
- `apps/web-scoring/src/components/HeartbeatRunner.tsx` — **new** (B3). Null-rendering client mount.
- `apps/web-scoring/app/layout.tsx` — **modify** (B3). Mount `<HeartbeatRunner/>`.

**Group C:**

- `apps/api/src/modules/events/events.service.test.ts` — **modify** (C1). Teach the supabase mock the `custom_rulesets` table.
- `packages/i18n/src/index.ts` — **modify** (C2). Three FR accent fixes (folded into A's i18n commit or its own).

---

## Task 1 (A1): NEXT column + deep-links on the board

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`
- Modify: `packages/i18n/src/index.ts`

**Interfaces:**

- Consumes: `BoardRow.nextUp: { matchId: string; label: string } | null`, `BoardRow.currentMatch.id`, existing `slug`/`eventId` props (already in `BoardRowView`).
- Produces: no new exports. The match page is `/org/{slug}/events/{eventId}/matches/{matchId}`; staff page is `/org/{slug}/events/{eventId}/staff`; schedule is `/org/{slug}/events/{eventId}/schedule`.

Presentational — no unit test (repo convention: web-admin has no RTL). Verified by typecheck + lint + the manual walk.

- [ ] **Step 1: Add the i18n key** in `packages/i18n/src/index.ts`, inside the existing `organizer.live` block in **both** locales.
  - EN (add after `synced: 'Synced',`): `nextLabel: 'Next',`
  - FR (add after `synced: 'Synchronisé',`): `nextLabel: 'Suivant',`

- [ ] **Step 2: Make the match score cell a deep-link.** In `LiveBoard.tsx` `BoardRowView`, replace the plain score `<span>` with a link to the match page when there is a current match. Replace:

```tsx
<span className="flex-1 truncate text-foreground">
  {cm
    ? `${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`
    : t('organizer.live.idle')}
</span>
```

with:

```tsx
{
  cm ? (
    <Link
      href={`/org/${slug}/events/${eventId}/matches/${cm.id}`}
      className="flex-1 truncate text-foreground hover:underline"
    >
      {`${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`}
    </Link>
  ) : (
    <span className="flex-1 truncate text-muted">{t('organizer.live.idle')}</span>
  );
}
```

- [ ] **Step 3: Make the scorer cell a deep-link to Staff.** Replace:

```tsx
<span className="w-28 shrink-0 text-muted">
  {row.scorer ? row.scorer.name : t('organizer.live.noScorer')}
</span>
```

with:

```tsx
<span className="w-28 shrink-0 truncate text-muted">
  {row.scorer ? (
    <Link href={`/org/${slug}/events/${eventId}/staff`} className="hover:underline">
      {row.scorer.name}
    </Link>
  ) : (
    t('organizer.live.noScorer')
  )}
</span>
```

- [ ] **Step 4: Add the NEXT cell** as the last cell of the row (after the attention cell), linking to the schedule. Insert before the closing `</li>`:

```tsx
<span className="w-20 shrink-0 text-right text-muted">
  {row.nextUp ? (
    <Link
      href={`/org/${slug}/events/${eventId}/schedule`}
      className="hover:underline"
      title={t('organizer.live.nextLabel')}
    >
      {row.nextUp.label}
    </Link>
  ) : (
    '—'
  )}
</span>
```

- [ ] **Step 5: Verify.**

```bash
pnpm --filter @myclash/i18n build
pnpm --filter @myclash/web-admin exec tsc --noEmit
pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
pnpm --filter @myclash/i18n test
```

Expected: clean; `nextLabel` resolves EN+FR; no `no-literal-string` (the `title` uses `t()`).

- [ ] **Step 6: Commit** (hold the i18n file — Tasks 2 and 9 also touch it; commit them together at Task 2, or commit now and re-stage later. Simplest: commit A1+A2 together at the end of Task 2.) If committing now:

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx" packages/i18n/src/index.ts
git commit -m "feat(web-admin): deep-links + next-up column on the live board"
```

---

## Task 2 (A2): localized health-state aria-label

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`
- Modify: `packages/i18n/src/index.ts`

**Interfaces:**

- Consumes: `HealthState` union (`'attention' | 'no_scorer' | 'stuck' | 'stale' | 'unknown' | 'synced' | 'idle'`) from `live-board-state.ts`, and `t` (already in `BoardRowView`).

The dot currently uses `aria-label={state}` — the raw English token (`"no_scorer"`), unreadable by a screen reader. Localize it.

- [ ] **Step 1: Add the state labels** to `organizer.live` in **both** locales as a nested `state` object (the dynamic key `organizer.live.state.` is auto-covered by the reverse-sweep).
  - EN:
    ```
    state: { attention: 'Needs attention', no_scorer: 'No scorer', stuck: 'Sync stuck', stale: 'Sync lagging', unknown: 'Health unknown', synced: 'Synced', idle: 'Idle' },
    ```
  - FR:
    ```
    state: { attention: 'À traiter', no_scorer: 'Aucun marqueur', stuck: 'Sync bloquée', stale: 'Sync en retard', unknown: 'État inconnu', synced: 'Synchronisé', idle: 'Inactif' },
    ```

- [ ] **Step 2: Use it for the dot's aria-label.** In `BoardRowView`, replace:

```tsx
<span className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`} aria-label={state} />
```

with:

```tsx
<span
  className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`}
  aria-label={t(`organizer.live.state.${state}`)}
/>
```

- [ ] **Step 3: Verify.**

```bash
pnpm --filter @myclash/i18n build
pnpm --filter @myclash/web-admin exec tsc --noEmit
pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
pnpm --filter @myclash/i18n test
```

Expected: clean. The i18n reverse-sweep detects the `organizer.live.state.` prefix from the template literal, so the 7 state keys are not flagged as orphans.

- [ ] **Step 4: Commit** (A1 + A2 together).

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx" packages/i18n/src/index.ts
git commit -m "feat(web-admin): deep-links, next-up column, and localized health labels on the live board"
```

---

## Task 3 (A3): responsive stacked-card layout + healthy fold

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.ts`
- Test: `apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.test.ts`
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`
- Modify: `packages/i18n/src/index.ts`

**Interfaces:**

- Produces: `partitionByHealth(rows: BoardRow[]): { problems: BoardRow[]; healthy: BoardRow[] }` — `healthy` = rows whose `deriveHealthState` is `synced` or `idle`; `problems` = everything else. Preserves input order within each bucket.

The design wants: on a phone the fixed-width table is unusable; healthy pistes fold behind a "🟢 N pistes synced ▸" expander so only problems show, worst-first. Implement the fold with a tested pure partition + a presentational toggle. Keep the existing wide-table layout at `md+`.

- [ ] **Step 1: Write the failing test** — append to `live-board-state.test.ts`:

```ts
import { partitionByHealth } from './live-board-state';

describe('partitionByHealth', () => {
  const healthy1 = mk({ lice: { id: 'A', name: 'P1', sortOrder: 0 } }); // synced
  const idle = mk({ lice: { id: 'B', name: 'P2', sortOrder: 1 }, currentMatch: null }); // idle
  const problem = mk({
    lice: { id: 'C', name: 'P3', sortOrder: 2 },
    attention: { reason: 'medic' },
  });

  it('buckets synced and idle rows as healthy, everything else as problems', () => {
    const { problems, healthy } = partitionByHealth([healthy1, problem, idle]);
    expect(healthy.map((r) => r.lice.id)).toEqual(['A', 'B']);
    expect(problems.map((r) => r.lice.id)).toEqual(['C']);
  });

  it('preserves input order within each bucket', () => {
    const { healthy } = partitionByHealth([idle, healthy1]);
    expect(healthy.map((r) => r.lice.id)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @myclash/web-admin test -- live-board-state`
Expected: FAIL — `partitionByHealth` is not exported.

- [ ] **Step 3: Implement** — add to `live-board-state.ts` (below `sortBoardRows`):

```ts
/** Split rows into problems (anything not fully fine) and healthy (synced/idle). */
export function partitionByHealth(rows: BoardRow[]): { problems: BoardRow[]; healthy: BoardRow[] } {
  const problems: BoardRow[] = [];
  const healthy: BoardRow[] = [];
  for (const row of rows) {
    const s = deriveHealthState(row);
    (s === 'synced' || s === 'idle' ? healthy : problems).push(row);
  }
  return { problems, healthy };
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `pnpm --filter @myclash/web-admin test -- live-board-state`
Expected: PASS (11 tests total in the file now).

- [ ] **Step 5: Add the i18n key** for the fold summary, in `organizer.live` (both locales):
  - EN: `healthyFold: '{count} pistes synced',`
  - FR: `healthyFold: '{count} pistes synchronisées',`

- [ ] **Step 6: Wire the responsive fold into `LiveBoard`.** Import `partitionByHealth`, add fold state, and render the healthy bucket behind a toggle **only below `md`** (the `md:` table stays as-is). In `LiveBoard.tsx`:
  1. Extend the imports:

  ```tsx
  import {
    deriveHealthState,
    partitionByHealth,
    sortBoardRows,
    type HealthState,
  } from './live-board-state';
  ```

  2. Add fold state next to `mode`:

  ```tsx
  const [showHealthy, setShowHealthy] = useState(false);
  ```

  3. After `const sorted = sortBoardRows(rows, mode);`, derive the mobile split:

  ```tsx
  const { problems, healthy } = partitionByHealth(sorted);
  ```

  4. Replace the single `<ul>` with two lists — the full one for `md+`, and a problems-first folded one below `md`:

  ```tsx
  {
    /* Wide table: every piste, all breakpoints ≥ md */
  }
  <ul className="hidden divide-y divide-border md:block">
    {sorted.map((row) => (
      <BoardRowView
        key={row.lice.id}
        row={row}
        slug={slug}
        eventId={eventId}
        onAck={(id) => void acknowledge(id)}
        t={t}
      />
    ))}
  </ul>;

  {
    /* Phone: problems first; healthy pistes folded away */
  }
  <div className="md:hidden">
    <ul className="divide-y divide-border">
      {problems.map((row) => (
        <BoardRowView
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
          className="mt-2 flex w-full items-center gap-2 py-2 text-sm text-muted"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
          {t('organizer.live.healthyFold', { count: healthy.length })}
          <span aria-hidden>{showHealthy ? '▾' : '▸'}</span>
        </button>
        {showHealthy && (
          <ul className="divide-y divide-border opacity-60">
            {healthy.map((row) => (
              <BoardRowView
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

  (The per-lice `<LiceRealtime>` subscribers above are unchanged — they still render once for the full `rows` set.)

- [ ] **Step 7: Verify.**

```bash
pnpm --filter @myclash/i18n build
pnpm --filter @myclash/web-admin exec tsc --noEmit
pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
pnpm --filter @myclash/web-admin test -- live-board-state
pnpm --filter @myclash/i18n test
```

Expected: all clean/green.

- [ ] **Step 8: Commit.**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.ts" "apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.test.ts" "apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx" packages/i18n/src/index.ts
git commit -m "feat(web-admin): responsive live board with healthy-piste fold on mobile"
```

---

## Task 4 (A4): stop redundant degraded-mode polling

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`

**Interfaces:** none changed.

Today each `<LiceRealtime>` wires `onFallbackPoll: onDrop` → a full board refetch, so a dropped socket fires N board GETs every 7 s **on top of** `useLiveBoard`'s own 7 s structural poll. `useLiveBoard` already polls; the per-lice subscribers only need to patch score cells while the socket is healthy. Make their fallback a no-op.

Presentational; no unit test.

- [ ] **Step 1: Drop the `onDrop` wiring.** In `LiveBoard.tsx`, change the `LiceRealtime` prop signature and usage.

  In the `LiceRealtime` component, remove `onDrop` and give the hook a no-op fallback:

  ```tsx
  function LiceRealtime({
    liceId,
    onChange,
  }: {
    liceId: string;
    onChange: (c: MatchChange) => void;
  }) {
    useRealtimeWithFallback({
      channelName: `live-board-lice:${liceId}`,
      table: 'matches',
      filter: `lice_id=eq.${liceId}`,
      event: 'UPDATE',
      onEvent: ({ new: n }) => {
        if (!n) return;
        onChange({
          id: n['id'] as string,
          redScore: n['red_score'] as number,
          blueScore: n['blue_score'] as number,
          status: n['status'] as string,
        });
      },
      // useLiveBoard already runs the 7s structural poll; the per-lice channel
      // is a score-cell overlay only, so its socket-down fallback is a no-op.
      onFallbackPoll: () => {},
      fallbackPollMs: 7000,
    });
    return null;
  }
  ```

  And at the render site drop `onDrop`:

  ```tsx
  {
    rows.map((r) => (
      <LiceRealtime key={r.lice.id} liceId={r.lice.id} onChange={applyMatchChange} />
    ));
  }
  ```

  `refetch` is still used by `applyMatchChange` (rollover on `completed`) and stays in the destructure.

- [ ] **Step 2: Verify.**

```bash
pnpm --filter @myclash/web-admin exec tsc --noEmit
pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
```

Expected: clean (no unused-var for `refetch`; it is still consumed by `applyMatchChange`).

- [ ] **Step 3: Commit.**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx"
git commit -m "perf(web-admin): drop redundant per-lice fallback polling on the live board"
```

---

## Task 5 (B1): API staff-heartbeat endpoint

**Files:**

- Modify: `apps/api/src/modules/staff/dto.ts`
- Modify: `apps/api/src/modules/staff/staff.service.ts`
- Modify: `apps/api/src/modules/staff/staff.controller.ts`
- Test: `apps/api/src/modules/staff/staff.service.heartbeat.test.ts` (new)

**Interfaces:**

- Consumes: private `requireStaffFromRequest(req) → StaffAccountRow` (has `id`, `event_id`); `this.supabase.service`.
- Produces: `StaffService.recordHeartbeat(req, dto) → Promise<{ ok: true }>`; route `POST /api/v1/staff/heartbeat`; `StaffHeartbeatDto { outboxDepth, oldestPendingAgeSec, rejectedCount }`.

The scoring tablet is a **staff-cookie** session (not a Supabase user), so this mirrors `assignedLices`/`getMe` — auth via `requireStaffFromRequest`, which stamps the metrics onto that account's row. `last_seen_at` is set server-side to now.

- [ ] **Step 1: Write the failing test** — `staff.service.heartbeat.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

const req = { cookies: {} } as never;

describe('StaffService.recordHeartbeat', () => {
  it('stamps the metrics + last_seen_at onto the caller staff account', async () => {
    const updates: Record<string, unknown>[] = [];
    const service = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {
          update: vi.fn((patch: Record<string, unknown>) => {
            updates.push(patch);
            return chain;
          }),
          eq: vi.fn(() => chain),
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
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @myclash/api test -- staff.service.heartbeat`
Expected: FAIL — `recordHeartbeat is not a function`.

- [ ] **Step 3: Add the DTO** in `dto.ts` (alongside the other `createZodDto` classes):

```ts
const staffHeartbeatSchema = z
  .object({
    outboxDepth: z.number().int().min(0),
    oldestPendingAgeSec: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
  })
  .strict();
export class StaffHeartbeatDto extends createZodDto(staffHeartbeatSchema) {}
```

- [ ] **Step 4: Add the service method** in `staff.service.ts` (near `getMe`/`listAssignedLices`). Add `StaffHeartbeatDto` to the existing `import type { … } from './dto';` block.

```ts
async recordHeartbeat(req: FastifyRequest, dto: StaffHeartbeatDto): Promise<{ ok: true }> {
  const staff = await this.requireStaffFromRequest(req);
  const { error } = await this.supabase.service
    .from('event_staff_accounts')
    .update({
      last_seen_at: new Date().toISOString(),
      outbox_depth: dto.outboxDepth,
      oldest_pending_age_seconds: dto.oldestPendingAgeSec,
      rejected_count: dto.rejectedCount,
    })
    .eq('event_id', staff.event_id)
    .eq('id', staff.id);
  if (error) throw new BadRequestException(error.message);
  return { ok: true };
}
```

- [ ] **Step 5: Add the controller route** in `staff.controller.ts`, alongside `assignedLices` (staff-cookie routes — NO `@Public`, NO extra guard; `requireStaffFromRequest` inside enforces the session). Add `StaffHeartbeatDto` to the DTO import.

```ts
@Post('staff/heartbeat')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Report scoring-tablet sync health for the Live board' })
async heartbeat(@Body() dto: StaffHeartbeatDto, @Req() req: FastifyRequest) {
  return this.staff.recordHeartbeat(req, dto);
}
```

- [ ] **Step 6: Run tests + build.**

Run: `pnpm --filter @myclash/api test -- staff.service.heartbeat` → PASS (1 test).
Run: `pnpm --filter @myclash/api build` → clean.

- [ ] **Step 7: Commit.**

```bash
git add apps/api/src/modules/staff/dto.ts apps/api/src/modules/staff/staff.service.ts apps/api/src/modules/staff/staff.controller.ts apps/api/src/modules/staff/staff.service.heartbeat.test.ts
git commit -m "feat(api): staff-heartbeat endpoint stamping tablet sync health"
```

---

## Task 6 (B2): scoring-app sync-metrics helper (pure)

**Files:**

- Create: `apps/web-scoring/src/offline/heartbeat.ts`
- Test: `apps/web-scoring/src/offline/heartbeat.test.ts`

**Interfaces:**

- Consumes: `OutboxEntry` (from `./db` — has `createdAt: number`, `attempts: number`).
- Produces: `computeHeartbeatMetrics(entries: OutboxEntry[], now: number): { outboxDepth: number; oldestPendingAgeSec: number; rejectedCount: number }` and `STUCK_ATTEMPTS = 3`.

`outboxDepth` = queue length. `oldestPendingAgeSec` = age of the oldest queued entry (0 when empty). `rejectedCount` = entries wedged in retry (`attempts >= STUCK_ATTEMPTS`) — terminal 400s are deleted by `sync.ts` so they never appear here; this counts what is _currently_ stuck, which is what the board's `stuck` state means. (Surfacing lifetime terminal-400 drops would need a persisted counter — out of scope; noted as a follow-up.)

- [ ] **Step 1: Write the failing test** — `heartbeat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeHeartbeatMetrics, STUCK_ATTEMPTS } from './heartbeat';
import type { OutboxEntry } from './db';

function entry(over: Partial<OutboxEntry>): OutboxEntry {
  return {
    clientUuid: 'u',
    matchId: 'm',
    sequence: 1,
    type: 'clean',
    occurredAt: '2026-07-23T10:00:00Z',
    createdAt: 0,
    attempts: 0,
    ...over,
  };
}

const NOW = 100_000; // ms

describe('computeHeartbeatMetrics', () => {
  it('reports zeros for an empty outbox', () => {
    expect(computeHeartbeatMetrics([], NOW)).toEqual({
      outboxDepth: 0,
      oldestPendingAgeSec: 0,
      rejectedCount: 0,
    });
  });

  it('counts depth and the oldest age in whole seconds', () => {
    const m = computeHeartbeatMetrics(
      [entry({ createdAt: NOW - 5_000 }), entry({ createdAt: NOW - 40_000 })],
      NOW,
    );
    expect(m.outboxDepth).toBe(2);
    expect(m.oldestPendingAgeSec).toBe(40);
  });

  it(`counts entries stuck at >= ${STUCK_ATTEMPTS} attempts as rejected`, () => {
    const m = computeHeartbeatMetrics(
      [
        entry({ attempts: STUCK_ATTEMPTS }),
        entry({ attempts: 1 }),
        entry({ attempts: STUCK_ATTEMPTS + 2 }),
      ],
      NOW,
    );
    expect(m.rejectedCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `pnpm --filter @myclash/web-scoring test -- heartbeat`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `heartbeat.ts`:

```ts
import type { OutboxEntry } from './db';

/** Retry attempts at which a queued exchange is treated as stuck (matches the
 *  sync engine's maxConsecutiveFailures). */
export const STUCK_ATTEMPTS = 3;

export interface HeartbeatMetrics {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}

/** Derive tablet sync-health metrics from the current outbox snapshot. Pure. */
export function computeHeartbeatMetrics(entries: OutboxEntry[], now: number): HeartbeatMetrics {
  if (entries.length === 0) {
    return { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0 };
  }
  const oldestCreatedAt = entries.reduce((min, e) => Math.min(min, e.createdAt), Infinity);
  return {
    outboxDepth: entries.length,
    oldestPendingAgeSec: Math.max(0, Math.floor((now - oldestCreatedAt) / 1000)),
    rejectedCount: entries.filter((e) => e.attempts >= STUCK_ATTEMPTS).length,
  };
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `pnpm --filter @myclash/web-scoring test -- heartbeat`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/web-scoring/src/offline/heartbeat.ts apps/web-scoring/src/offline/heartbeat.test.ts
git commit -m "feat(web-scoring): pure sync-health metrics from the outbox"
```

---

## Task 7 (B3): scoring-app heartbeat sender + mount

**Files:**

- Create: `apps/web-scoring/src/hooks/useHeartbeat.ts`
- Create: `apps/web-scoring/src/components/HeartbeatRunner.tsx`
- Modify: `apps/web-scoring/app/layout.tsx`

**Interfaces:**

- Consumes: `computeHeartbeatMetrics` (Task 6), `getAllPending` (`../offline/outbox`), `getApiUrl` (`../lib/api-url`), the `POST /api/v1/staff/heartbeat` contract (Task 5).

Glue (I/O only, no React state), so no unit test — the pure metrics are already covered. Verified by typecheck/lint + the manual walk. The hook performs only `fetch`, so it does not trip `set-state-in-effect`.

- [ ] **Step 1: Write the hook** — `useHeartbeat.ts`:

```ts
'use client';
import { useEffect } from 'react';
import { getApiUrl } from '../lib/api-url';
import { getAllPending } from '../offline/outbox';
import { computeHeartbeatMetrics } from '../offline/heartbeat';

const HEARTBEAT_MS = 20_000;

/**
 * Best-effort tablet heartbeat: every 20s, while online, snapshot the outbox
 * and POST sync-health to the API, which stamps it on the staff account for the
 * organizer Live board. Swallows every error — a 401 (not logged in), an
 * offline network, or a server hiccup must never disrupt scoring. No React
 * state is set here, so it is exempt from set-state-in-effect.
 */
export function useHeartbeat(): void {
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

    // Defer the first send off the effect body (consistency with the repo's
    // effect rules; also lets the outbox settle after mount).
    const initial = window.setTimeout(() => void send(), 0);
    const id = window.setInterval(() => void send(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, []);
}
```

- [ ] **Step 2: Write the null-rendering mount** — `HeartbeatRunner.tsx`:

```tsx
'use client';
import { useHeartbeat } from '../hooks/useHeartbeat';

/** Runs the tablet heartbeat for as long as it is mounted. Renders nothing. */
export function HeartbeatRunner() {
  useHeartbeat();
  return null;
}
```

- [ ] **Step 3: Mount it in the root layout.** In `apps/web-scoring/app/layout.tsx`, import and render `<HeartbeatRunner />` inside the existing `<body>` tree (it renders nothing; on the login/offline screens the POST 401s and is silently ignored — acceptable best-effort noise). Use the correct relative import from `app/` to `src/components/` (e.g. `../src/components/HeartbeatRunner`; verify the depth against a sibling import already in `layout.tsx`).

```tsx
import { HeartbeatRunner } from '../src/components/HeartbeatRunner';
// …inside the returned JSX, within <body>…
<HeartbeatRunner />;
```

- [ ] **Step 4: Typecheck + lint.**

```bash
pnpm --filter @myclash/web-scoring exec tsc --noEmit
pnpm --filter @myclash/web-scoring exec eslint src/hooks/useHeartbeat.ts src/components/HeartbeatRunner.tsx app/layout.tsx
```

Expected: clean (no `set-state-in-effect` — the hook sets no state).

- [ ] **Step 5: Commit.**

```bash
git add apps/web-scoring/src/hooks/useHeartbeat.ts apps/web-scoring/src/components/HeartbeatRunner.tsx apps/web-scoring/app/layout.tsx
git commit -m "feat(web-scoring): tablet heartbeat reporting sync health to the live board"
```

---

## Task 8 (C1): fix the stale `custom_rulesets` mock in events.service tests

**Files:**

- Modify: `apps/api/src/modules/events/events.service.test.ts`

**Interfaces:** none — test-only.

Root cause: `getPublicTournamentStandings` / `listTournaments` now read `custom_rulesets` (added by the ruleset content-hash work), but the test's table-keyed supabase mock (`from()` around line 1563) `throw new Error('unexpected table ${table}')` for any table it does not special-case — so it throws `unexpected table custom_rulesets`. Teach the mock that table (and any other newly-queried table the run surfaces).

This is investigate-then-fix: the exact rows depend on what the service selects. Drive it from the failing run.

- [ ] **Step 1: Reproduce and read the drift.**

Run: `pnpm --filter @myclash/api test -- events.service`
Expected: 9 failing, error `unexpected table custom_rulesets` (plus a couple of downstream length/`toBeDefined` assertions that cascade from the throw).
Then read how `custom_rulesets` is queried: `grep -n "custom_rulesets" apps/api/src/modules/events/events.service.ts` — note the `.select(...)`, the filter column (e.g. `.in('id', …)` or `.eq('tournament_id', …)`), and whether the result is expected to be an array or single.

- [ ] **Step 2: Extend the mock.** In `events.service.test.ts`, find the `from(table)` switch (~line 1563) and add a `custom_rulesets` branch that returns a chain matching the service's call shape, resolving to an empty array by default (the standings tests don't assert ruleset content — they only need the query not to throw). Follow the file's existing chain-mock idiom (the same `select/eq/in/…` object the other tables return). If a specific test asserts ruleset-derived output, give that test's mock a row shaped like the service's `select`.

- [ ] **Step 3: Re-run until green.**

Run: `pnpm --filter @myclash/api test -- events.service`
Expected: 52 passing, 0 failing. If a new `unexpected table X` surfaces, repeat Step 2 for `X`.

- [ ] **Step 4: Full API build (guards against a typed mock drift).**

Run: `pnpm --filter @myclash/api build`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/events/events.service.test.ts
git commit -m "test(api): teach events.service mock the custom_rulesets read"
```

---

## Task 9 (C2): fix FR accent typos in event nav labels

**Files:**

- Modify: `packages/i18n/src/index.ts`

**Interfaces:** none.

The FR `organizer.eventHub.sections` block has three unaccented labels in an otherwise fully-accented FR tree.

- [ ] **Step 1: Fix the three FR values** (FR block only — do not touch the EN values):
  - `penalties: 'Penalites'` → `penalties: 'Pénalités'`
  - `staff: 'Staff evenement'` → `staff: 'Staff évènement'`
  - `theme: 'Identite visuelle'` → `theme: 'Identité visuelle'`

- [ ] **Step 2: Verify.**

```bash
pnpm --filter @myclash/i18n test
```

Expected: PASS (keys unchanged; only values edited).

- [ ] **Step 3: Commit.**

```bash
git add packages/i18n/src/index.ts
git commit -m "fix(i18n): restore French accents on event nav labels"
```

---

## Task 10: Integration verification (no code)

- [ ] **Step 1: Full sweep.**

```bash
pnpm --filter @myclash/api test && pnpm --filter @myclash/api build
pnpm --filter @myclash/i18n build && pnpm --filter @myclash/ui build
pnpm --filter @myclash/web-admin exec tsc --noEmit && pnpm --filter @myclash/web-admin test && pnpm --filter @myclash/web-admin exec eslint "app/org/[slug]/events/[eventId]/live"
pnpm --filter @myclash/web-scoring test && pnpm --filter @myclash/web-scoring exec tsc --noEmit
pnpm --filter @myclash/i18n test
```

Expected: all green (`events.service` now included in the API pass).

- [ ] **Step 2: Manual walk.**
  - **Board:** on `/org/<slug>/events/<eventId>/live` — the score cell links to the match page, the scorer name links to Staff, a NEXT link appears when a lice has a queued bout; the health dot has a readable localized tooltip; on a narrow viewport the healthy pistes fold behind "N pistes synced ▸".
  - **Heartbeat:** open the scoring app as a logged-in scorer, score a hit, then throttle/offline the network so the outbox grows. Within ~20 s the board's SYNC cell for that lice moves off "unknown" to a queue/▲/✖ readout, and the row's dot leaves grey. Reconnect → it returns to synced.

- [ ] **Step 3: Stop for review.** (Do not commit fixups beyond the per-task commits above without review.)

---

## Self-Review

**Coverage of the seven items:**

- #1 NEXT + deep-links → Task 1. ✅
- #2 localized aria-label → Task 2. ✅
- #3 responsive → Task 3 (pure `partitionByHealth` + tested; presentational fold). ✅
- #4 redundant polling → Task 4. ✅
- #5 Phase-5 heartbeat → Tasks 5 (API), 6 (pure metrics), 7 (sender). ✅ Full end-to-end.
- #6 archive `tournament_ruleset_repins` → **removed by decision** (already deliberately excluded and green; leaving as-is). events.service reds → Task 8. ✅
- #7 FR i18n typos → Task 9. ✅

**Placeholder scan:** Task 8 is deliberately investigate-then-fix (the user chose this) — it carries the concrete root cause, exact reproduction, the mock location, and a green-exit gate; the only non-literal part is the mock rows, which depend on the service's `select` and are derived in Step 1–2. Every other task has complete code.

**Type consistency:** `HeartbeatMetrics`/`computeHeartbeatMetrics` (Task 6) feed the `StaffHeartbeatDto { outboxDepth, oldestPendingAgeSec, rejectedCount }` contract (Task 5) via `useHeartbeat` (Task 7) — the three field names match across all three. `partitionByHealth` (Task 3) reuses `deriveHealthState` and the `BoardRow` type already in `live-board-state.ts`/`types.ts`. `organizer.live.state.*` and `organizer.live.next`/`healthyFold` are added in both locales.

**Ordering:** Group A tasks are independent of each other but all touch `LiveBoard.tsx`; execute 1→2→3→4 in order to avoid stale-edit churn. Task 7 depends on 5 + 6. Tasks 8 and 9 are independent. `events.service` is red until Task 8 — do not let it mask a regression in Tasks 5.

**No migration:** confirmed — every heartbeat column exists from `0149`; the write is by primary key, no new index.
