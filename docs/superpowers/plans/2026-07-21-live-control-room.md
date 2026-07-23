# Live Control Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give organizers a live, per-piste operations board (scores + tablet health + attention) as a new "Live" menu in web-admin.

**Architecture:** Two coordinated sources per piste row. An authenticated aggregate endpoint (`GET /events/:id/live-board`, polled every 7s) is the structural source of truth; an anon Supabase-realtime subscription per lice patches score cells instantly between polls. Scores stay server-derived (`matches.red_score`/`blue_score`); organizer-scoped health rides the authed API only. All join/derive/merge logic lives in pure, unit-tested functions; services and components are thin.

**Tech Stack:** NestJS + Fastify + Supabase (API), Next.js App Router + `@myclash/ui` + Tailwind semantic tokens (web-admin), Supabase Realtime (`useRealtimeWithFallback`), Vitest.

## Global Constraints

- **Design doc:** `docs/superpowers/specs/2026-07-21-live-control-room-design.md` — the source of truth for scope. v1 = full board (all three lenses) + realtime scores + health + Acknowledge + deep-links. Deferred: expandable row detail, inline reassign, TV mode.
- **Migration numbering:** next prefix is `0149`; never renumber an applied migration.
- **Tokenized UI only:** build with `@myclash/ui` components + semantic tokens (`bg-surface`, `text-foreground`, `text-muted`, `border-border`, `bg-danger`, `bg-warning`, `bg-success`); never raw palette classes or hex.
- **i18n:** every `t()` key must exist in **both** `en` and `fr` in `packages/i18n/src/index.ts` (a lint test fails otherwise).
- **Unknown health ≠ healthy:** a lice with no reported heartbeat renders **grey "unknown"**, never green. This is a correctness requirement, not cosmetic.
- **Realtime is anon:** sensitive (organizer-scoped) data never rides realtime — only public `matches` score rows do. Use the existing `useRealtimeWithFallback` (`apps/web-admin/src/lib/supabase-browser.ts`).
- **web-admin tests are pure-logic `.test.ts`** (Vitest, jsdom). There is no React Testing Library and no `.test.tsx`. Put tested logic in pure helpers; verify components manually.
- **Commit trailer:** end every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verify commands:** API — `pnpm --filter @myclash/api test` and `pnpm --filter @myclash/api build`. web-admin — `pnpm --filter @myclash/web-admin test`; rebuild UI first with `pnpm --filter @myclash/ui build` before any app typecheck.
- **Dependency note (out of scope here):** the health metrics are _populated_ by the scoring-app heartbeat (remediation Phase 5) and `needs_attention` is _set_ by the pad (Phase 7). This plan only _reads_ health and _clears_ attention. Until Phase 5 ships, health shows "unknown" and the board still delivers scores + presence + throughput.

## File Structure

**API (`apps/api/src/modules/staff/`):**

- `live-board.ts` — **new**. Pure types + `assembleBoardRows()` + `mapBoardMatch()`. No I/O.
- `live-board.test.ts` — **new**. Unit tests for the pure module.
- `staff.service.ts` — **modify**. Add `getLiveBoard(req, eventId)` and `acknowledgeAttention(req, eventId, staffAccountId)`.
- `staff.service.live-board.test.ts` — **new**. Service tests (authz + assembly + ack).
- `staff.controller.ts` — **modify**. Add `GET events/:eventId/live-board` and `POST events/:eventId/live/attention/:staffAccountId/ack`.

**DB (`packages/db/migrations/`):**

- `0149_live_board_columns.sql` — **new**. Health + attention columns on `event_staff_accounts`.

**web-admin:**

- `src/components/event-nav-groups.ts` — **modify**. Add the `live` nav item.
- `src/components/event-nav-groups.test.ts` — **modify**. Bump the expected route list.
- `packages/i18n/src/index.ts` — **modify**. Add `organizer.eventHub.sections.live` (EN + FR).
- `app/org/[slug]/events/[eventId]/live/types.ts` — **new**. FE row types (mirror the API payload).
- `app/org/[slug]/events/[eventId]/live/live-board-merge.ts` (+ `.test.ts`) — **new**. `mergeRealtimePatch()`.
- `app/org/[slug]/events/[eventId]/live/live-board-state.ts` (+ `.test.ts`) — **new**. `deriveHealthState()`, `sortBoardRows()`.
- `app/org/[slug]/events/[eventId]/live/useLiveBoard.ts` — **new**. Poll + realtime + ack hook.
- `app/org/[slug]/events/[eventId]/live/LiveBoard.tsx` — **new**. Presentational board + per-lice realtime subscriber.
- `app/org/[slug]/events/[eventId]/live/page.tsx` — **new**. Route entry.

---

## Task 1: Migration — board columns on `event_staff_accounts`

**Files:**

- Create: `packages/db/migrations/0149_live_board_columns.sql`

**Interfaces:**

- Produces: columns `last_seen_at`, `outbox_depth`, `oldest_pending_age_seconds`, `rejected_count`, `needs_attention`, `needs_attention_reason` on `event_staff_accounts`.

Migrations are not red-green TDD; the deliverable is the SQL, verified by applying it and inspecting the schema.

- [ ] **Step 1: Write the migration**

```sql
-- 0149_live_board_columns.sql
-- Live control room: per-tablet sync health + scorer attention on staff accounts.
-- Health is POPULATED by the scoring-app heartbeat (remediation Phase 5); the
-- attention flag is SET by the scoring pad (Phase 7). This migration only adds
-- the columns the Live board READS. NULL health = UNKNOWN, never "healthy".
-- `IF NOT EXISTS` on last_seen_at keeps this mergeable with Phase 5's migration.

ALTER TABLE event_staff_accounts
  ADD COLUMN IF NOT EXISTS last_seen_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outbox_depth               INTEGER,
  ADD COLUMN IF NOT EXISTS oldest_pending_age_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS rejected_count             INTEGER,
  ADD COLUMN IF NOT EXISTS needs_attention            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_attention_reason     TEXT
    CHECK (needs_attention_reason IS NULL OR needs_attention_reason IN ('medic','head_ref','dispute'));
```

- [ ] **Step 2: Apply the migration**

Run the repo's migration runner (the same command CI/deploy uses; check `package.json` scripts — e.g. `pnpm --filter @myclash/db migrate` against your local Supabase).
Expected: applies cleanly, ledger records `0149_live_board_columns.sql`.

- [ ] **Step 3: Verify the columns exist**

Run against the local DB:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'event_staff_accounts'
  AND column_name IN ('last_seen_at','outbox_depth','oldest_pending_age_seconds',
                      'rejected_count','needs_attention','needs_attention_reason')
ORDER BY column_name;
```

Expected: 6 rows.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0149_live_board_columns.sql
git commit -m "feat(db): add live-board health + attention columns to event_staff_accounts"
```

---

## Task 2: API — pure board assembler

**Files:**

- Create: `apps/api/src/modules/staff/live-board.ts`
- Test: `apps/api/src/modules/staff/live-board.test.ts`

**Interfaces:**

- Produces (consumed by Task 3 and mirrored by Task 5's FE types):

```ts
export interface BoardMatch {
  id: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  status: string;
  round: number | null;
}
export interface BoardScorer {
  accountId: string;
  name: string;
  lastSeenAt: string | null;
  otherCount: number;
}
export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}
export interface BoardAttention {
  reason: 'medic' | 'head_ref' | 'dispute';
}
export interface BoardRow {
  lice: { id: string; name: string; sortOrder: number };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  nextUp: { matchId: string; label: string } | null;
}
export function assembleBoardRows(input: AssembleInput): BoardRow[];
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/staff/live-board.test.ts
import { describe, expect, it } from 'vitest';
import { assembleBoardRows, type AssembleInput } from './live-board';

function base(): AssembleInput {
  return {
    lices: [{ id: 'L1', name: 'Piste 1', sort_order: 0 }],
    matches: [],
    accounts: [],
    assignments: [],
  };
}

describe('assembleBoardRows', () => {
  it('picks a running match as current and maps score + fighters', () => {
    const input = base();
    input.matches = [
      {
        id: 'm1',
        lice_id: 'L1',
        status: 'running',
        red_score: 3,
        blue_score: 2,
        match_number_label: '#3',
        bracket_slots: { round: 2 },
        red: { persons: { given_name: 'Marie', family_name: 'D' } },
        blue: { persons: { given_name: 'Jean', family_name: 'P' } },
      },
    ];
    const [row] = assembleBoardRows(input);
    expect(row.currentMatch).toEqual({
      id: 'm1',
      redFighterName: 'Marie D',
      blueFighterName: 'Jean P',
      redScore: 3,
      blueScore: 2,
      status: 'running',
      round: 2,
    });
  });

  it('is idle (currentMatch null) when the lice has no running/scheduled match', () => {
    expect(assembleBoardRows(base())[0].currentMatch).toBeNull();
  });

  it('sets nextUp to the first scheduled match that is not current', () => {
    const input = base();
    input.matches = [
      {
        id: 'm1',
        lice_id: 'L1',
        status: 'running',
        red_score: 0,
        blue_score: 0,
        match_number_label: '#1',
        bracket_slots: null,
        red: null,
        blue: null,
      },
      {
        id: 'm2',
        lice_id: 'L1',
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
        match_number_label: '#2',
        bracket_slots: null,
        red: null,
        blue: null,
      },
    ];
    expect(assembleBoardRows(input)[0].nextUp).toEqual({ matchId: 'm2', label: '#2' });
  });

  it('joins the assigned scorer, most-recently-seen first, with otherCount', () => {
    const input = base();
    input.accounts = [
      {
        id: 'a1',
        display_name: 'Léa',
        last_seen_at: '2026-07-21T10:00:02Z',
        outbox_depth: 0,
        oldest_pending_age_seconds: 0,
        rejected_count: 0,
        needs_attention: false,
        needs_attention_reason: null,
      },
      {
        id: 'a2',
        display_name: 'Tom',
        last_seen_at: '2026-07-21T09:00:00Z',
        outbox_depth: 0,
        oldest_pending_age_seconds: 0,
        rejected_count: 0,
        needs_attention: false,
        needs_attention_reason: null,
      },
    ];
    input.assignments = [
      { staff_account_id: 'a1', lice_id: 'L1' },
      { staff_account_id: 'a2', lice_id: 'L1' },
    ];
    const [row] = assembleBoardRows(input);
    expect(row.scorer).toEqual({
      accountId: 'a1',
      name: 'Léa',
      lastSeenAt: '2026-07-21T10:00:02Z',
      otherCount: 1,
    });
  });

  it('reports health UNKNOWN (null) when no metric has been reported', () => {
    const input = base();
    input.accounts = [
      {
        id: 'a1',
        display_name: 'Léa',
        last_seen_at: '2026-07-21T10:00:02Z',
        outbox_depth: null,
        oldest_pending_age_seconds: null,
        rejected_count: null,
        needs_attention: false,
        needs_attention_reason: null,
      },
    ];
    input.assignments = [{ staff_account_id: 'a1', lice_id: 'L1' }];
    expect(assembleBoardRows(input)[0].health).toBeNull();
  });

  it('surfaces the attention flag + reason', () => {
    const input = base();
    input.accounts = [
      {
        id: 'a1',
        display_name: 'Ana',
        last_seen_at: null,
        outbox_depth: 8,
        oldest_pending_age_seconds: 300,
        rejected_count: 2,
        needs_attention: true,
        needs_attention_reason: 'medic',
      },
    ];
    input.assignments = [{ staff_account_id: 'a1', lice_id: 'L1' }];
    const [row] = assembleBoardRows(input);
    expect(row.attention).toEqual({ reason: 'medic' });
    expect(row.health).toEqual({ outboxDepth: 8, oldestPendingAgeSec: 300, rejectedCount: 2 });
  });

  it('has a null scorer when no account is assigned to the lice', () => {
    expect(assembleBoardRows(base())[0].scorer).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api test -- live-board.test`
Expected: FAIL — `Cannot find module './live-board'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/modules/staff/live-board.ts

export interface RawBoardMatch {
  id: string;
  lice_id: string;
  status: string;
  red_score: number;
  blue_score: number;
  match_number_label: string | null;
  bracket_slots: { round?: number } | null;
  red: { persons?: { given_name?: string; family_name?: string } | null } | null;
  blue: { persons?: { given_name?: string; family_name?: string } | null } | null;
}

export interface BoardAccountInput {
  id: string;
  display_name: string;
  last_seen_at: string | null;
  outbox_depth: number | null;
  oldest_pending_age_seconds: number | null;
  rejected_count: number | null;
  needs_attention: boolean;
  needs_attention_reason: 'medic' | 'head_ref' | 'dispute' | null;
}

export interface AssembleInput {
  lices: Array<{ id: string; name: string; sort_order: number }>;
  matches: RawBoardMatch[];
  accounts: BoardAccountInput[];
  assignments: Array<{ staff_account_id: string; lice_id: string }>;
}

export interface BoardMatch {
  id: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  status: string;
  round: number | null;
}
export interface BoardScorer {
  accountId: string;
  name: string;
  lastSeenAt: string | null;
  otherCount: number;
}
export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}
export interface BoardAttention {
  reason: 'medic' | 'head_ref' | 'dispute';
}
export interface BoardRow {
  lice: { id: string; name: string; sortOrder: number };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  nextUp: { matchId: string; label: string } | null;
}

function fighterName(side: RawBoardMatch['red']): string | null {
  const p = side?.persons;
  if (!p) return null;
  const name = [p.given_name, p.family_name].filter(Boolean).join(' ').trim();
  return name.length ? name : null;
}

export function mapBoardMatch(row: RawBoardMatch): BoardMatch {
  return {
    id: row.id,
    redFighterName: fighterName(row.red),
    blueFighterName: fighterName(row.blue),
    redScore: row.red_score,
    blueScore: row.blue_score,
    status: row.status,
    round: typeof row.bracket_slots?.round === 'number' ? row.bracket_slots.round : null,
  };
}

export function assembleBoardRows(input: AssembleInput): BoardRow[] {
  const accountById = new Map(input.accounts.map((a) => [a.id, a]));

  return input.lices
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((lice) => {
      const liceMatches = input.matches.filter((m) => m.lice_id === lice.id);
      const currentRaw =
        liceMatches.find((m) => m.status === 'running' || m.status === 'paused') ??
        liceMatches.find((m) => m.status === 'scheduled') ??
        null;
      const currentMatch = currentRaw ? mapBoardMatch(currentRaw) : null;

      const nextRaw = liceMatches.find((m) => m.status === 'scheduled' && m.id !== currentRaw?.id);
      const nextUp = nextRaw
        ? { matchId: nextRaw.id, label: nextRaw.match_number_label ?? '' }
        : null;

      const assigned = input.assignments
        .filter((a) => a.lice_id === lice.id)
        .map((a) => accountById.get(a.staff_account_id))
        .filter((a): a is BoardAccountInput => Boolean(a))
        .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''));
      const primary = assigned[0] ?? null;

      const scorer: BoardScorer | null = primary
        ? {
            accountId: primary.id,
            name: primary.display_name,
            lastSeenAt: primary.last_seen_at,
            otherCount: assigned.length - 1,
          }
        : null;

      // Health is UNKNOWN unless the tablet has reported at least one metric.
      const health: BoardHealth | null =
        primary && primary.outbox_depth !== null
          ? {
              outboxDepth: primary.outbox_depth ?? 0,
              oldestPendingAgeSec: primary.oldest_pending_age_seconds ?? 0,
              rejectedCount: primary.rejected_count ?? 0,
            }
          : null;

      const attention: BoardAttention | null =
        primary && primary.needs_attention && primary.needs_attention_reason
          ? { reason: primary.needs_attention_reason }
          : null;

      return {
        lice: { id: lice.id, name: lice.name, sortOrder: lice.sort_order },
        currentMatch,
        scorer,
        health,
        attention,
        nextUp,
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api test -- live-board.test`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff/live-board.ts apps/api/src/modules/staff/live-board.test.ts
git commit -m "feat(api): add pure live-board assembler"
```

---

## Task 3: API — `getLiveBoard` service method + endpoint

**Files:**

- Modify: `apps/api/src/modules/staff/staff.service.ts`
- Modify: `apps/api/src/modules/staff/staff.controller.ts`
- Test: `apps/api/src/modules/staff/staff.service.live-board.test.ts`

**Interfaces:**

- Consumes: `assembleBoardRows` (Task 2); existing private `getSupabaseUserId(req)`, `getEventById(eventId)`, `listAssignmentsForEvent(eventId)`; `this.orgs.assertOrgRole(orgId, userId, role)`.
- Produces: `StaffService.getLiveBoard(req, eventId) → Promise<{ rows: BoardRow[] }>`; route `GET /api/v1/events/:eventId/live-board`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/staff/staff.service.live-board.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { StaffService } from './staff.service';

// Table-keyed mock: from(table).select().eq()... resolves to the array for that table.
function makeSupabase(tables: Record<string, unknown[]>) {
  const service = {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        order: vi.fn(() => chain),
        maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return chain;
    }),
  };
  return { service };
}

const req = { cookies: {} } as never;

describe('StaffService.getLiveBoard', () => {
  it('throws 403 when the caller lacks an org role on the event', async () => {
    const supabase = makeSupabase({
      events: [{ id: 'E1', organization_id: 'O1', status: 'running' }],
    });
    const orgs = { assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('no role')) };
    const svc = new StaffService(supabase as never, orgs as never, {} as never);
    // Force the Supabase-user branch:
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');
    await expect(svc.getLiveBoard(req, 'E1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('assembles one row per lice for an authorized organizer', async () => {
    const supabase = makeSupabase({
      events: [{ id: 'E1', organization_id: 'O1', status: 'running' }],
      lices: [{ id: 'L1', name: 'Piste 1', sort_order: 0 }],
      matches: [
        {
          id: 'm1',
          lice_id: 'L1',
          status: 'running',
          red_score: 1,
          blue_score: 0,
          match_number_label: '#1',
          bracket_slots: null,
          red: null,
          blue: null,
        },
      ],
      event_staff_accounts: [],
      event_staff_lice_assignments: [],
    });
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const svc = new StaffService(supabase as never, orgs as never, {} as never);
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');

    const out = await svc.getLiveBoard(req, 'E1');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].currentMatch?.id).toBe('m1');
    expect(out.rows[0].currentMatch?.redScore).toBe(1);
  });
});
```

> Note: the mock's `then` shim makes an un-awaited-`.maybeSingle` query chain thenable so `await query` resolves to `{ data, error }`. Match your query style to it — use `await this.supabase.service.from(...).select(...)...` (no `.single()`), destructuring `{ data, error }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api test -- staff.service.live-board.test`
Expected: FAIL — `getLiveBoard is not a function`.

- [ ] **Step 3: Add the service method**

Add to `StaffService` (near `getAssignedLices`). Imports at top of file: `import { assembleBoardRows, type RawBoardMatch, type BoardAccountInput } from './live-board';`

```ts
async getLiveBoard(req: FastifyRequest, eventId: string): Promise<{ rows: import('./live-board').BoardRow[] }> {
  const userId = await this.getSupabaseUserId(req);
  if (!userId) throw new UnauthorizedException('Organizer session required');
  const event = await this.getEventById(eventId);
  await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

  const { data: lices, error: liceErr } = await this.supabase.service
    .from('lices')
    .select('id,name,sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true });
  if (liceErr) throw new BadRequestException(liceErr.message);
  const liceRows = (lices ?? []) as Array<{ id: string; name: string; sort_order: number }>;
  const liceIds = liceRows.map((l) => l.id);

  let matches: RawBoardMatch[] = [];
  if (liceIds.length > 0) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id,lice_id,status,red_score,blue_score,match_number_label,bracket_slots(round),red:registrations!matches_red_registration_id_fkey(persons(given_name,family_name)),blue:registrations!matches_blue_registration_id_fkey(persons(given_name,family_name))',
      )
      .in('lice_id', liceIds)
      .in('status', ['running', 'paused', 'scheduled'])
      .order('status', { ascending: true })
      .order('scheduled_at', { ascending: true, nullsFirst: false });
    if (error) throw new BadRequestException(error.message);
    matches = (data ?? []) as unknown as RawBoardMatch[];
  }

  const { data: accounts, error: accErr } = await this.supabase.service
    .from('event_staff_accounts')
    .select('id,display_name,last_seen_at,outbox_depth,oldest_pending_age_seconds,rejected_count,needs_attention,needs_attention_reason')
    .eq('event_id', eventId);
  if (accErr) throw new BadRequestException(accErr.message);

  const assignments = await this.listAssignmentsForEvent(eventId);

  const rows = assembleBoardRows({
    lices: liceRows,
    matches,
    accounts: (accounts ?? []) as unknown as BoardAccountInput[],
    assignments: assignments.map((a) => ({ staff_account_id: a.staff_account_id, lice_id: a.lice_id })),
  });
  return { rows };
}
```

- [ ] **Step 4: Add the controller route**

In `staff.controller.ts`, add (alongside the other event-scoped routes):

```ts
@Get('events/:eventId/live-board')
@ApiOperation({ summary: 'Live control-room board: per-lice score + scorer + tablet health' })
async liveBoard(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
  return this.staff.getLiveBoard(req, eventId);
}
```

- [ ] **Step 5: Run tests + build to verify they pass**

Run: `pnpm --filter @myclash/api test -- staff.service.live-board.test`
Expected: PASS (2 tests).
Run: `pnpm --filter @myclash/api build`
Expected: builds clean (catches type errors `tsc --noEmit` can miss).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/staff/staff.service.ts apps/api/src/modules/staff/staff.controller.ts apps/api/src/modules/staff/staff.service.live-board.test.ts
git commit -m "feat(api): live-board aggregate endpoint (org-role gated, per-event)"
```

---

## Task 4: API — acknowledge attention

**Files:**

- Modify: `apps/api/src/modules/staff/staff.service.ts`
- Modify: `apps/api/src/modules/staff/staff.controller.ts`
- Test: `apps/api/src/modules/staff/staff.service.live-board.test.ts` (extend)

**Interfaces:**

- Produces: `StaffService.acknowledgeAttention(req, eventId, staffAccountId) → Promise<{ ok: true }>`; route `POST /api/v1/events/:eventId/live/attention/:staffAccountId/ack`.

- [ ] **Step 1: Write the failing test** (append to `staff.service.live-board.test.ts`)

```ts
describe('StaffService.acknowledgeAttention', () => {
  it('clears the attention flag for an authorized organizer', async () => {
    const updated: Record<string, unknown>[] = [];
    const service = {
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'E1', organization_id: 'O1', status: 'running' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        const chain: Record<string, unknown> = {
          update: vi.fn((patch: Record<string, unknown>) => {
            updated.push(patch);
            return chain;
          }),
          eq: vi.fn(() => chain),
          then: (r: (v: { data: null; error: null }) => void) => r({ data: null, error: null }),
        };
        return chain;
      }),
    };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const svc = new StaffService({ service } as never, orgs as never, {} as never);
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');

    await expect(svc.acknowledgeAttention(req, 'E1', 'a1')).resolves.toEqual({ ok: true });
    expect(updated[0]).toMatchObject({ needs_attention: false, needs_attention_reason: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api test -- staff.service.live-board.test`
Expected: FAIL — `acknowledgeAttention is not a function`.

- [ ] **Step 3: Add the service method**

```ts
async acknowledgeAttention(req: FastifyRequest, eventId: string, staffAccountId: string): Promise<{ ok: true }> {
  const userId = await this.getSupabaseUserId(req);
  if (!userId) throw new UnauthorizedException('Organizer session required');
  const event = await this.getEventById(eventId);
  await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

  const { error } = await this.supabase.service
    .from('event_staff_accounts')
    .update({ needs_attention: false, needs_attention_reason: null })
    .eq('event_id', eventId)
    .eq('id', staffAccountId);
  if (error) throw new BadRequestException(error.message);
  return { ok: true };
}
```

- [ ] **Step 4: Add the controller route**

```ts
@Post('events/:eventId/live/attention/:staffAccountId/ack')
@ApiOperation({ summary: 'Acknowledge (clear) a scorer needs-attention flag from the Live board' })
async ackAttention(
  @Param('eventId', ParseUUIDPipe) eventId: string,
  @Param('staffAccountId', ParseUUIDPipe) staffAccountId: string,
  @Req() req: FastifyRequest,
) {
  return this.staff.acknowledgeAttention(req, eventId, staffAccountId);
}
```

- [ ] **Step 5: Run tests + build**

Run: `pnpm --filter @myclash/api test -- staff.service.live-board.test` → PASS (3 tests).
Run: `pnpm --filter @myclash/api build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/staff/staff.service.ts apps/api/src/modules/staff/staff.controller.ts apps/api/src/modules/staff/staff.service.live-board.test.ts
git commit -m "feat(api): acknowledge-attention endpoint for the live board"
```

---

## Task 5: web-admin — "Live" nav item + i18n

**Files:**

- Modify: `apps/web-admin/src/components/event-nav-groups.ts`
- Modify: `apps/web-admin/src/components/event-nav-groups.test.ts`
- Modify: `packages/i18n/src/index.ts`

**Interfaces:**

- Produces: nav route `live` in the `competition` group; label key `organizer.eventHub.sections.live`.

- [ ] **Step 1: Update the nav test (failing)**

In `event-nav-groups.test.ts`, add `'live'` to the `expected` array and change the `it('covers exactly the 19 expected routes'` title to `20`:

```ts
it('covers exactly the 20 expected routes', () => {
  const expected = [
    '',
    'persons',
    'clubs',
    'referees',
    'staff',
    'live',
    'tournaments',
    'pools',
    'bracket',
    'finalranking',
    'schedule',
    'statistics',
    'workshops',
    'penalties',
    'compensation',
    'notifications',
    'theme',
    'archive',
    'ai-assistant',
    'chat',
  ];
  expect([...flatHrefs].sort()).toEqual([...expected].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/web-admin test -- event-nav-groups`
Expected: FAIL — flatHrefs missing `live`.

- [ ] **Step 3: Add the nav item**

In `event-nav-groups.ts`, add as the **first** item of the `competition` group:

```ts
    items: [
      { href: 'live', labelKey: 'organizer.eventHub.sections.live', badge: 'LV' },
      { href: 'tournaments', labelKey: 'organizer.shell.nav.tournaments', badge: 'TR' },
      // …existing items unchanged…
```

- [ ] **Step 4: Add the i18n keys**

In `packages/i18n/src/index.ts`, add `live` to `organizer.eventHub.sections` in **both** locales, next to the existing `schedule`/`statistics` keys:

- EN: `live: 'Live',`
- FR: `live: 'En direct',`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @myclash/web-admin test -- event-nav-groups`
Expected: PASS.
Run: `pnpm --filter @myclash/i18n test` (the t-key reference lint) → PASS (key resolves in EN+FR).

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin/src/components/event-nav-groups.ts apps/web-admin/src/components/event-nav-groups.test.ts packages/i18n/src/index.ts
git commit -m "feat(web-admin): add Live nav item + EN/FR label"
```

---

## Task 6: web-admin — realtime merge (pure)

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/live/types.ts`
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-merge.ts`
- Test: `apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-merge.test.ts`

**Interfaces:**

- Produces: FE `BoardRow` (mirrors the API payload from Task 2); `mergeRealtimePatch(rows, change) → { rows, shouldRefetch }`.

- [ ] **Step 1: Write the failing test**

```ts
// live-board-merge.test.ts
import { describe, expect, it } from 'vitest';
import { mergeRealtimePatch } from './live-board-merge';
import type { BoardRow } from './types';

function row(matchId: string | null): BoardRow {
  return {
    lice: { id: 'L1', name: 'P1', sortOrder: 0 },
    currentMatch: matchId
      ? {
          id: matchId,
          redFighterName: 'A',
          blueFighterName: 'B',
          redScore: 0,
          blueScore: 0,
          status: 'running',
          round: 1,
        }
      : null,
    scorer: null,
    health: null,
    attention: null,
    nextUp: null,
  };
}

describe('mergeRealtimePatch', () => {
  it('patches the score on the matching row only', () => {
    const rows = [row('m1'), row('m2')];
    const { rows: out, shouldRefetch } = mergeRealtimePatch(rows, {
      id: 'm1',
      redScore: 3,
      blueScore: 2,
      status: 'running',
    });
    expect(out[0].currentMatch).toMatchObject({ redScore: 3, blueScore: 2 });
    expect(out[1].currentMatch?.redScore).toBe(0);
    expect(shouldRefetch).toBe(false);
  });

  it('returns the same array reference and no refetch when nothing matches', () => {
    const rows = [row('m1')];
    const res = mergeRealtimePatch(rows, { id: 'zzz', redScore: 9 });
    expect(res.rows).toBe(rows);
    expect(res.shouldRefetch).toBe(false);
  });

  it('flags shouldRefetch when the current match completes (rollover)', () => {
    const res = mergeRealtimePatch([row('m1')], { id: 'm1', status: 'completed' });
    expect(res.shouldRefetch).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/web-admin test -- live-board-merge`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types + merge**

```ts
// types.ts — mirrors the API payload (apps/api/.../live-board.ts BoardRow)
export interface BoardMatch {
  id: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  status: string;
  round: number | null;
}
export interface BoardScorer {
  accountId: string;
  name: string;
  lastSeenAt: string | null;
  otherCount: number;
}
export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}
export interface BoardAttention {
  reason: 'medic' | 'head_ref' | 'dispute';
}
export interface BoardRow {
  lice: { id: string; name: string; sortOrder: number };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  nextUp: { matchId: string; label: string } | null;
}
export interface MatchChange {
  id: string;
  redScore?: number;
  blueScore?: number;
  status?: string;
  round?: number | null;
}
```

```ts
// live-board-merge.ts
import type { BoardRow, MatchChange } from './types';

export function mergeRealtimePatch(
  rows: BoardRow[],
  change: MatchChange,
): { rows: BoardRow[]; shouldRefetch: boolean } {
  let matched = false;
  const next = rows.map((r) => {
    if (r.currentMatch && r.currentMatch.id === change.id) {
      matched = true;
      return {
        ...r,
        currentMatch: {
          ...r.currentMatch,
          redScore: change.redScore ?? r.currentMatch.redScore,
          blueScore: change.blueScore ?? r.currentMatch.blueScore,
          status: change.status ?? r.currentMatch.status,
          round: change.round ?? r.currentMatch.round,
        },
      };
    }
    return r;
  });
  const shouldRefetch = matched && (change.status === 'completed' || change.status === 'void');
  return { rows: matched ? next : rows, shouldRefetch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/web-admin test -- live-board-merge`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/types.ts" "apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-merge.ts" "apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-merge.test.ts"
git commit -m "feat(web-admin): live-board realtime merge (pure)"
```

---

## Task 7: web-admin — health state + sort (pure)

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.ts`
- Test: `apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.test.ts`

**Interfaces:**

- Produces: `type HealthState`; `deriveHealthState(row, thresholds?) → HealthState`; `sortBoardRows(rows, mode) → BoardRow[]`; `DEFAULT_THRESHOLDS`.

- [ ] **Step 1: Write the failing test**

```ts
// live-board-state.test.ts
import { describe, expect, it } from 'vitest';
import { deriveHealthState, sortBoardRows } from './live-board-state';
import type { BoardRow } from './types';

function mk(over: Partial<BoardRow>): BoardRow {
  return {
    lice: { id: 'L', name: 'P', sortOrder: 0 },
    currentMatch: {
      id: 'm',
      redFighterName: null,
      blueFighterName: null,
      redScore: 0,
      blueScore: 0,
      status: 'running',
      round: null,
    },
    scorer: { accountId: 'a', name: 'S', lastSeenAt: '2026-07-21T10:00:00Z', otherCount: 0 },
    health: { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0 },
    attention: null,
    nextUp: null,
    ...over,
  };
}

describe('deriveHealthState', () => {
  it('is unknown (never synced) when health is null', () => {
    expect(deriveHealthState(mk({ health: null }))).toBe('unknown');
  });
  it('is no_scorer when no scorer is assigned', () => {
    expect(deriveHealthState(mk({ scorer: null }))).toBe('no_scorer');
  });
  it('is attention when the flag is set (outranks everything)', () => {
    expect(deriveHealthState(mk({ attention: { reason: 'medic' } }))).toBe('attention');
  });
  it('is idle when there is no current match', () => {
    expect(
      deriveHealthState(
        mk({
          currentMatch: null,
          health: { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0 },
        }),
      ),
    ).toBe('idle');
  });
  it('is stuck when a rejection exists', () => {
    expect(
      deriveHealthState(
        mk({ health: { outboxDepth: 3, oldestPendingAgeSec: 10, rejectedCount: 1 } }),
      ),
    ).toBe('stuck');
  });
  it('is stale when the queue is old but not rejected', () => {
    expect(
      deriveHealthState(
        mk({ health: { outboxDepth: 3, oldestPendingAgeSec: 120, rejectedCount: 0 } }),
      ),
    ).toBe('stale');
  });
  it('is synced when the queue is empty', () => {
    expect(deriveHealthState(mk({}))).toBe('synced');
  });
});

describe('sortBoardRows', () => {
  const a = mk({ lice: { id: 'A', name: 'P1', sortOrder: 0 } }); // synced
  const b = mk({ lice: { id: 'B', name: 'P2', sortOrder: 1 }, attention: { reason: 'medic' } }); // attention
  it('by piste keeps sortOrder', () => {
    expect(sortBoardRows([b, a], 'piste').map((r) => r.lice.id)).toEqual(['A', 'B']);
  });
  it('worst-first floats problems to the top', () => {
    expect(sortBoardRows([a, b], 'worst').map((r) => r.lice.id)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/web-admin test -- live-board-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// live-board-state.ts
import type { BoardRow } from './types';

export type HealthState =
  | 'attention'
  | 'no_scorer'
  | 'stuck'
  | 'stale'
  | 'unknown'
  | 'synced'
  | 'idle';

export interface Thresholds {
  staleAgeSec: number;
  stuckAgeSec: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { staleAgeSec: 60, stuckAgeSec: 300 };

export function deriveHealthState(row: BoardRow, t: Thresholds = DEFAULT_THRESHOLDS): HealthState {
  if (row.attention) return 'attention';
  if (!row.scorer) return 'no_scorer';
  if (!row.currentMatch) return 'idle';
  if (row.health === null) return 'unknown';
  const h = row.health;
  if (h.rejectedCount > 0 || h.oldestPendingAgeSec > t.stuckAgeSec) return 'stuck';
  if (h.outboxDepth > 0 && h.oldestPendingAgeSec > t.staleAgeSec) return 'stale';
  return 'synced';
}

// worst-first severity (lower = more urgent). no_scorer sits low: a setup gap, not a live failure.
const SEVERITY: Record<HealthState, number> = {
  attention: 0,
  stuck: 1,
  stale: 2,
  unknown: 3,
  synced: 4,
  idle: 5,
  no_scorer: 6,
};

export function sortBoardRows(rows: BoardRow[], mode: 'piste' | 'worst'): BoardRow[] {
  const copy = rows.slice();
  if (mode === 'piste') {
    return copy.sort(
      (a, b) => a.lice.sortOrder - b.lice.sortOrder || a.lice.name.localeCompare(b.lice.name),
    );
  }
  return copy.sort((a, b) => {
    const d = SEVERITY[deriveHealthState(a)] - SEVERITY[deriveHealthState(b)];
    return d !== 0 ? d : a.lice.sortOrder - b.lice.sortOrder;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/web-admin test -- live-board-state`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.ts" "apps/web-admin/app/org/[slug]/events/[eventId]/live/live-board-state.test.ts"
git commit -m "feat(web-admin): live-board health-state + sort (pure)"
```

---

## Task 8: web-admin — `useLiveBoard` hook

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/live/useLiveBoard.ts`

**Interfaces:**

- Consumes: `mergeRealtimePatch` (Task 6), `BoardRow`/`MatchChange` (Task 6).
- Produces: `useLiveBoard(eventId) → { rows, error, refetch, acknowledge, applyMatchChange }`.

This hook is glue (network + state). web-admin has no hook test harness (0 `.test.tsx`, no RTL), so it is verified via typecheck + the manual walk in Task 10; its pure dependencies are already covered by Tasks 6–7.

- [ ] **Step 1: Write the hook**

```ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { mergeRealtimePatch } from './live-board-merge';
import type { BoardRow, MatchChange } from './types';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? '';

export function useLiveBoard(eventId: string) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<'refresh' | 'forbidden' | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/events/${eventId}/live-board`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        setError('forbidden');
        return;
      }
      if (!res.ok) {
        setError('refresh');
        return;
      }
      const data = (await res.json()) as { rows: BoardRow[] };
      setRows(data.rows);
      setError(null);
    } catch {
      setError('refresh'); // keep last-known rows, never blank
    }
  }, [eventId]);

  // Always-on structural poll (rollover, health, attention, scores fallback).
  useEffect(() => {
    void refetch();
    const id = window.setInterval(() => void refetch(), 7000);
    return () => window.clearInterval(id);
  }, [refetch]);

  // Instant score patch from a per-lice realtime subscriber.
  const applyMatchChange = useCallback(
    (change: MatchChange) => {
      setRows((prev) => {
        if (!prev) return prev;
        const { rows: next, shouldRefetch } = mergeRealtimePatch(prev, change);
        if (shouldRefetch) void refetch();
        return next;
      });
    },
    [refetch],
  );

  const acknowledge = useCallback(
    async (staffAccountId: string) => {
      // optimistic: clear the flag locally, revert on failure
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.scorer?.accountId === staffAccountId ? { ...r, attention: null } : r,
          ) ?? prev,
      );
      try {
        const res = await fetch(
          `${API}/api/v1/events/${eventId}/live/attention/${staffAccountId}/ack`,
          { method: 'POST', credentials: 'include' },
        );
        if (!res.ok) void refetch(); // revert to server truth
      } catch {
        void refetch();
      }
    },
    [eventId, refetch],
  );

  return { rows, error, refetch, acknowledge, applyMatchChange };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @myclash/ui build && pnpm --filter @myclash/web-admin exec tsc --noEmit`
Expected: no errors in `live/`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/useLiveBoard.ts"
git commit -m "feat(web-admin): useLiveBoard hook (poll + realtime merge + ack)"
```

---

## Task 9: web-admin — board component + page

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/live/LiveBoard.tsx`
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/live/page.tsx`

**Interfaces:**

- Consumes: `useLiveBoard` (Task 8), `deriveHealthState`/`sortBoardRows` (Task 7), `useRealtimeWithFallback` (`apps/web-admin/src/lib/supabase-browser.ts`).

Presentational; verified via typecheck/lint + the manual walk (Task 10). All raw data-shaping is already tested (Tasks 2, 6, 7). Use `@myclash/ui` + semantic tokens only.

- [ ] **Step 1: Write the per-lice realtime subscriber + board**

```tsx
// LiveBoard.tsx
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '@myclash/i18n';
import { useRealtimeWithFallback } from '../../../../../../../src/lib/supabase-browser';
import { useLiveBoard } from './useLiveBoard';
import { deriveHealthState, sortBoardRows, type HealthState } from './live-board-state';
import type { BoardRow, MatchChange } from './types';

// One channel per lice (stable set). `matches` is scoped by lice_id (no event_id),
// so we subscribe per lice and patch the current match on that lice.
function LiceRealtime({
  liceId,
  onChange,
  onDrop,
}: {
  liceId: string;
  onChange: (c: MatchChange) => void;
  onDrop: () => void;
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
    onFallbackPoll: onDrop, // socket down → force a structural refetch
    fallbackPollMs: 7000,
  });
  return null;
}

const DOT: Record<HealthState, string> = {
  attention: 'bg-danger',
  stuck: 'bg-danger',
  stale: 'bg-warning',
  synced: 'bg-success',
  idle: 'bg-muted',
  unknown: 'bg-muted',
  no_scorer: 'bg-foreground',
};

export function LiveBoard({ slug, eventId }: { slug: string; eventId: string }) {
  const t = useI18n();
  const { rows, error, refetch, acknowledge, applyMatchChange } = useLiveBoard(eventId);
  const [mode, setMode] = useState<'piste' | 'worst'>('piste');

  if (error === 'forbidden')
    return <p className="p-6 text-muted">{t('organizer.live.forbidden')}</p>;
  if (!rows) return <p className="p-6 text-muted">{t('common.loading')}</p>;

  const sorted = sortBoardRows(rows, mode);
  const attentionCount = rows.filter((r) => r.attention).length;

  return (
    <div className="p-4">
      {/* per-lice realtime subscribers (render nothing) */}
      {rows.map((r) => (
        <LiceRealtime
          key={r.lice.id}
          liceId={r.lice.id}
          onChange={applyMatchChange}
          onDrop={() => void refetch()}
        />
      ))}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {t('organizer.live.summary', { pistes: rows.length, attention: attentionCount })}
        </p>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode('piste')}
            className={mode === 'piste' ? 'font-semibold text-foreground' : 'text-muted'}
          >
            {t('organizer.live.sortPiste')}
          </button>
          <button
            type="button"
            onClick={() => setMode('worst')}
            className={mode === 'worst' ? 'font-semibold text-foreground' : 'text-muted'}
          >
            {t('organizer.live.sortWorst')}
          </button>
        </div>
      </div>
      {error === 'refresh' && (
        <p className="mb-2 text-xs text-warning">{t('organizer.live.staleRefresh')}</p>
      )}

      <ul className="divide-y divide-border">
        {sorted.map((row) => (
          <BoardRowView
            key={row.lice.id}
            row={row}
            slug={slug}
            eventId={eventId}
            onAck={acknowledge}
            t={t}
          />
        ))}
      </ul>
    </div>
  );
}

function BoardRowView({
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
  t: ReturnType<typeof useI18n>;
}) {
  const state = deriveHealthState(row);
  const dim = state === 'synced' || state === 'idle' ? 'opacity-60' : '';
  const cm = row.currentMatch;
  return (
    <li className={`flex items-center gap-3 py-2 text-sm ${dim}`}>
      <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[state]}`} aria-label={state} />
      <Link
        href={`/org/${slug}/events/${eventId}/schedule`}
        className="w-16 shrink-0 font-semibold text-foreground hover:underline"
      >
        {row.lice.name}
      </Link>
      <span className="flex-1 truncate text-foreground">
        {cm
          ? `${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`
          : t('organizer.live.idle')}
      </span>
      <span className="w-24 shrink-0 text-muted">
        {cm ? `${cm.round ? `R${cm.round} · ` : ''}${cm.status}` : ''}
      </span>
      <span className="w-28 shrink-0 text-muted">
        {row.scorer ? row.scorer.name : t('organizer.live.noScorer')}
      </span>
      <span className="w-24 shrink-0 text-muted">
        {row.health === null
          ? t('organizer.live.unknown')
          : row.health.rejectedCount > 0
            ? `✖ ${row.health.outboxDepth}q·${row.health.rejectedCount}r`
            : row.health.outboxDepth > 0
              ? `▲ ${row.health.outboxDepth}q`
              : t('organizer.live.synced')}
      </span>
      <span className="w-32 shrink-0">
        {row.attention && row.scorer ? (
          <button
            type="button"
            onClick={() => onAck(row.scorer!.accountId)}
            className="rounded-md bg-danger/10 px-2 py-1 text-danger"
          >
            {t(`organizer.live.reason.${row.attention.reason}`)} · {t('organizer.live.ack')}
          </button>
        ) : (
          '—'
        )}
      </span>
    </li>
  );
}
```

> Import-path note: adjust the `../../../../../../../src/lib/supabase-browser` depth to reach `apps/web-admin/src/lib/` from the `live/` route folder (verify with your editor). If the repo exposes a path alias (e.g. `@/lib/...`), use that instead.

- [ ] **Step 2: Write the page**

```tsx
// page.tsx
import { LiveBoard } from './LiveBoard';

export default async function LivePage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;
  return <LiveBoard slug={slug} eventId={eventId} />;
}
```

- [ ] **Step 3: Add the i18n keys**

Add to `packages/i18n/src/index.ts` under a new `organizer.live` block in **both** locales. EN example (write the FR equivalents alongside):

```
live: {
  forbidden: 'You do not have access to this event.',
  summary: '{pistes} pistes · {attention} need attention',
  sortPiste: 'By piste', sortWorst: 'Worst first',
  staleRefresh: "Couldn't refresh — retrying",
  idle: 'Idle', noScorer: 'No scorer', unknown: 'Unknown', synced: 'Synced', ack: 'Ack',
  reason: { medic: 'Medic', head_ref: 'Head ref', dispute: 'Dispute' },
},
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @myclash/ui build && pnpm --filter @myclash/web-admin exec tsc --noEmit`
Run: `pnpm --filter @myclash/web-admin lint`
Expected: clean (no raw-palette / no-literal-string violations; keys resolve).

- [ ] **Step 5: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/live/" packages/i18n/src/index.ts
git commit -m "feat(web-admin): Live control-room board + page"
```

---

## Task 10: Integration verification

**Files:** none (verification only).

- [ ] **Step 1: Full test + build sweep**

```bash
pnpm --filter @myclash/api test && pnpm --filter @myclash/api build
pnpm --filter @myclash/ui build && pnpm --filter @myclash/web-admin test && pnpm --filter @myclash/web-admin lint
pnpm --filter @myclash/i18n test
```

Expected: all green.

- [ ] **Step 2: Manual walk (dev app)**

Start the app, open `/org/<slug>/events/<eventId>/live` as an organizer:

- The **Live** item appears in the event sidebar (Competition group).
- One row per piste; a running match shows a live score; toggling **worst-first** re-orders; healthy rows are dimmed.
- A lice with no heartbeat shows **grey "Unknown"** (not green).
- Score a hit on the scoring app → the row's score cell updates within ~1s (realtime); completing a bout rolls the lice to the next match within a poll.
- With `needs_attention` set on an account (set it directly in DB for the test), the row shows the reason + **Ack**; clicking Ack clears it and it does not reappear.

- [ ] **Step 3: Commit any fixups, then stop for review.**

---

## Self-Review

**Spec coverage:** ✅ two-source architecture (Tasks 3 + 8/9), authed aggregate endpoint (Task 3), anon realtime score overlay per-lice (Task 9), nav + EN/FR + test (Task 5), by-piste default + worst-first toggle (Task 7/9), light actions Ack + deep-links (Tasks 4/9), unknown≠green (Tasks 2/7/9 + explicit tests), socket-down poll fallback (Tasks 8/9), instant rollover on completed (Task 6), no-scorer/idle/multi-scorer (Task 2 tests), thresholds (Task 7), authz 403 (Task 3), testing plan (pure fns fully covered; UI manual per repo convention). Clock-is-status honored (no `clockStatus` field; `status` used). Migration (Task 1) + dependency note on Phase-5 population documented.

**Deviations from spec (intentional):** the assembler lives in `StaffService.getLiveBoard` + a pure `live-board.ts` module rather than a standalone `LiveBoardService`, to reuse StaffService's existing event/org/assignment helpers (DRY, follow existing patterns). Nav slot is "first in Competition" (a documented spec open-decision); promoting to a top-level slot is a later tweak.

**Placeholder scan:** none — every code step is complete; the only prose notes are the import-path depth (Task 9) and the migration-runner command (Task 1), both concrete-with-verification.

**Type consistency:** `BoardRow`/`BoardMatch`/`BoardHealth`/`BoardAttention` are defined identically in API `live-board.ts` (Task 2) and FE `types.ts` (Task 6); `MatchChange` is FE-only (Task 6) and consumed by Tasks 8/9. `assembleBoardRows` input keys are snake_case (DB rows) throughout Tasks 2–3.
