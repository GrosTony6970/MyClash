/**
 * Auto-assign's Apply asks the one checker (W1.3, plan C4 + C7).
 *
 * Only the board's row read is stubbed: the clock, the commitments, the engine and the
 * checker are the real ones.
 *   - The engine is judged over the commitments the run KEEPS: the auto rows it replaces
 *     do not hold their referee, the manual ones do.
 *   - A proposal the checker refuses is an engine bug: a plain Error, and nothing is
 *     deleted or written.
 *   - The picker shows each candidate's bouts on the slot's day (ADR-019's one count).
 */
import { HttpException } from '@nestjs/common';
import type { AssignmentResult } from '@myclash/rulesets/scheduling';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { AssignmentBoardService } from './assignment-board.service';

const RULES = {
  enableOwnPoolRule: true,
  enableOwnPoolSpanRule: true,
  enableTwoRolesRule: true,
  workshopConflictWarning: true,
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  maxBoutsPerDay: 0,
  ratingBasedOrdering: true,
  workloadBalance: true,
  enableCapacityRule: false,
};

const bout = (id: string, at: string, red: string, blue: string) => ({
  id,
  scheduledAt: `2026-05-21T${at}:00.000Z`,
  durationMinutes: 10,
  liceId: null,
  redRegistrationId: red,
  blueRegistrationId: blue,
});

const pool = (id: string, name: string, at: string, red: string, blue: string) => ({
  id,
  name,
  tournamentId: 't-1',
  tournamentName: 'Longsword',
  liceId: null,
  scheduledStart: `2026-05-21T${at}:00.000Z`,
  scheduledEnd: null,
  kind: 'pool' as const,
  members: [],
  matches: [bout(`${id}-m1`, at, red, blue)],
  roleSlots: [],
});

const candidate = (personId: string, rating: number) => ({
  personId,
  userId: null,
  displayName: personId,
  clubLabel: null,
  qualifications: [{ role: 'arbitre_declarant', rating }],
});

/** Pools A and B at 10:00 on two pistes. Ann (rated 5) is preferred over Bob (rated 1). */
const ROWS = {
  eventId: 'event-1',
  eventStartDate: '2026-05-21',
  eventTimezone: 'UTC',
  ruleSettings: RULES,
  tournaments: [],
  phases: [],
  pools: [
    pool('pool-a', 'Pool A', '10:00', 'reg-x', 'reg-y'),
    pool('pool-b', 'Pool B', '10:00', 'reg-z', 'reg-w'),
  ],
  candidates: [candidate('ann', 5), candidate('bob', 1)],
  assignments: [] as unknown[],
  fighterRegistrationIdsByPerson: new Map<string, string[]>(),
  slotConfigByTournament: new Map([
    [
      't-1',
      {
        pool: [{ index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] }],
        bracket: [],
        finals: [],
      },
    ],
  ]),
  locked: false,
};

/** Ann on Pool B's declarant seat, from the last run or by hand. */
const annOnB = (autoAssigned: boolean) => ({
  id: 'row-1',
  person_id: 'ann',
  pool_id: 'pool-b',
  match_id: null,
  role: 'arbitre_declarant',
  status: 'assigned',
  auto_assigned: autoAssigned,
  conflicts_jsonb: [],
});

type Private = {
  loadBoardRows: (eventId: string) => Promise<unknown>;
  previewFromContext: (context: unknown) => Promise<AssignmentResult>;
};

const picks = (result: AssignmentResult) =>
  result.assignments.map((a) => `${a.poolId}:${a.personId}`);

describe('auto-assign asks the checker (W1.3)', () => {
  let supabase: ReturnType<typeof mockSupabase>;
  let service: AssignmentBoardService;
  const rows = (over: Partial<typeof ROWS> = {}) =>
    vi
      .spyOn(service as unknown as Private, 'loadBoardRows')
      .mockResolvedValue({ ...ROWS, ...over });

  beforeEach(() => {
    supabase = mockSupabase({ workshops: { rows: [] }, referee_assignments: { rows: [] } });
    service = new AssignmentBoardService(supabase as never, {} as never, {} as never);
  });

  it('does not let an auto row the run replaces hold its referee', async () => {
    rows({ assignments: [annOnB(true)] });
    expect(picks(await service.preview('event-1'))).toEqual(['pool-a:ann', 'pool-b:bob']);
  });

  it('holds a manual row against its referee, and leaves its seat alone', async () => {
    rows({ assignments: [annOnB(false)] });
    const result = await service.preview('event-1');
    expect(picks(result)).toEqual(['pool-a:bob']);
    expect(result.missing).toEqual([]);
  });

  it('writes what the engine proposed after judging it', async () => {
    rows();
    await service.applyPreview('event-1');
    const written = writesTo(supabase, 'referee_assignments');
    expect(written.map((w) => w.op)).toEqual(['delete', 'insert']);
    expect(written[1]!.row).toEqual([
      expect.objectContaining({ person_id: 'ann', pool_id: 'pool-a', scope_type: 'pool' }),
      expect.objectContaining({ person_id: 'bob', pool_id: 'pool-b', scope_type: 'pool' }),
    ]);
  });

  describe('a proposal the checker refuses is an engine bug', () => {
    const proposal = (poolId: string, personId: string) => ({
      poolId,
      poolName: poolId,
      slotIndex: 1,
      role: 'arbitre_declarant',
      personId,
      personName: personId,
      autoAssigned: true as const,
    });
    const engineSays = (...assignments: ReturnType<typeof proposal>[]) =>
      vi
        .spyOn(service as unknown as Private, 'previewFromContext')
        .mockResolvedValue({ assignments, missing: [] });

    async function refusedWithNothingWritten(code: string) {
      const failure = await service.applyPreview('event-1').then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect((failure as Error).message).toContain(code);
      expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
    }

    it('one person on two Pools at once: refused before the delete', async () => {
      rows();
      engineSays(proposal('pool-a', 'ann'), proposal('pool-b', 'ann'));
      await refusedWithNothingWritten('referees_overlap');
    });

    it('a fighter on their own Pool: refused, never dropped in silence', async () => {
      rows({ fighterRegistrationIdsByPerson: new Map([['ann', ['reg-x']]]) });
      engineSays(proposal('pool-a', 'ann'));
      await refusedWithNothingWritten('own_pool');
    });
  });

  it('reports the cap on a crew held bout by bout, counted whole (C11)', async () => {
    const twoBouts = {
      ...pool('pool-c', 'Pool C', '12:00', 'reg-x', 'reg-y'),
      matches: [bout('c1', '12:00', 'reg-x', 'reg-y'), bout('c2', '12:10', 'reg-z', 'reg-w')],
    };
    const perBout = (matchId: string) => ({
      ...annOnB(false),
      id: matchId,
      pool_id: null,
      match_id: matchId,
    });
    rows({
      pools: [twoBouts],
      assignments: [perBout('c1'), perBout('c2')],
      ruleSettings: { ...RULES, maxBoutsPerDay: 1 },
    });
    const { conflicts } = await service.getCrewConflicts('event-1');
    // One entry per person, unit and role; each bout alone is 1 bout and under the cap.
    expect(
      conflicts.map((c) => [c.personId, c.reasons.map((r) => `${r.code}:${r.against?.label}`)]),
    ).toEqual([['ann', ['cap:2']]]);
  });

  it("shows each candidate's bouts on the slot's day", async () => {
    rows({ assignments: [annOnB(false)] });
    const board = await service.getBoard('event-1');
    const slotA = board.pools.find((p) => p.id === 'pool-a')!.roleSlots[0]!;
    const all = [
      ...slotA.candidates.recommended,
      ...slotA.candidates.warning,
      ...slotA.candidates.blocked,
    ];
    expect(Object.fromEntries(all.map((c) => [c.personId, c.boutsThatDay]))).toEqual({
      ann: 1,
      bob: 0,
    });
  });

  it('shows no load for a slot with no time yet, rather than a false 0', async () => {
    const untimed = {
      ...pool('pool-u', 'Pool U', '10:00', 'reg-x', 'reg-y'),
      scheduledStart: null,
    };
    untimed.matches = [{ ...untimed.matches[0]!, scheduledAt: null as unknown as string }];
    rows({ pools: [untimed] as unknown as typeof ROWS.pools, assignments: [annOnB(false)] });
    const board = await service.getBoard('event-1');
    const slot = [...board.pools, ...board.unscheduledPools][0]!.roleSlots[0]!;
    const all = [
      ...slot.candidates.recommended,
      ...slot.candidates.warning,
      ...slot.candidates.blocked,
    ];
    expect(all.map((c) => c.boutsThatDay)).toEqual([null, null]);
  });
});
