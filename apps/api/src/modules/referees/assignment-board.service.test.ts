import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentBoardService } from './assignment-board.service';
import { HARD_CODED_DEFAULT_SLOTS } from './staffing.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const mockSettings = {
  getSettings: vi.fn().mockResolvedValue({
    enforceRefereeNoBackToBack: true,
    refereeRestMinSlots: 1,
    enforceDedicatedRefereeRest: true,
    workshopConflictWarning: true,
    ratingBasedOrdering: true,
    workloadBalance: true,
  }),
};
// R2: the assignment board now depends on the staffing resolver. In
// these tests we don't exercise custom slot configs — the
// hard-coded floor (3 legacy roles) is returned for every tournament
// so the board's behaviour matches the legacy expectations exactly.
const mockStaffing = {
  getResolvedConfigForAssignmentBoard: vi.fn().mockResolvedValue({
    pool: [...HARD_CODED_DEFAULT_SLOTS],
    bracket: [...HARD_CODED_DEFAULT_SLOTS],
    finals: [...HARD_CODED_DEFAULT_SLOTS],
    inheritsEventDefault: true,
    isHardCodedFloor: true,
  }),
};

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });

  for (const key of ['select', 'eq', 'in', 'order', 'delete']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  chain.insert = vi.fn().mockResolvedValue(result);

  return chain;
}

function queueBoardReads(assignments: unknown[] = []) {
  fromMock
    // Slice 8: loadContext now fetches event.start_date up front.
    .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
    .mockReturnValueOnce(
      makeChain({ data: [{ id: 'tournament-1', name: 'Longsword' }], error: null }),
    )
    .mockReturnValueOnce(
      makeChain({ data: [{ id: 'phase-1', tournament_id: 'tournament-1' }], error: null }),
    )
    .mockReturnValueOnce(
      makeChain({
        data: [
          {
            id: 'pool-1',
            phase_id: 'phase-1',
            name: 'Pool 1',
            pool_members: [
              {
                registration_id: 'reg-fighter-ref',
                registrations: {
                  id: 'reg-fighter-ref',
                  person_id: 'person-ref-a',
                  persons: {
                    id: 'person-ref-a',
                    given_name: 'Fighter',
                    family_name: 'Referee',
                    display_name: null,
                    clubs: { name: 'Salle A' },
                  },
                },
              },
            ],
            matches: [
              {
                id: 'match-1',
                scheduled_at: '2026-05-21T10:00:00.000Z',
                lice_id: 'lice-1',
                red_registration_id: 'reg-fighter-ref',
                blue_registration_id: 'reg-b',
              },
            ],
          },
        ],
        error: null,
      }),
    )
    // event_referees — post-0063 keyed on person_id only
    .mockReturnValueOnce(
      makeChain({
        data: [{ person_id: 'person-ref-a' }, { person_id: 'person-ref-b' }],
        error: null,
      }),
    )
    .mockReturnValueOnce(
      makeChain({
        data: [
          { person_id: 'person-ref-a', role: 'arbitre_declarant', rating: 5 },
          { person_id: 'person-ref-b', role: 'arbitre_declarant', rating: 4 },
          { person_id: 'person-ref-b', role: 'arbitre_assesseur', rating: 4 },
          { person_id: 'person-ref-b', role: 'arbitre_table', rating: 4 },
        ],
        error: null,
      }),
    )
    // global_persons by id (post-0063: listCandidates does a single id-in lookup)
    .mockReturnValueOnce(
      makeChain({
        data: [
          {
            id: 'person-ref-a',
            claimed_by_user_id: 'user-a',
            given_name: 'Fighter',
            family_name: 'Referee',
            club_id: null,
          },
          {
            id: 'person-ref-b',
            claimed_by_user_id: 'user-b',
            given_name: 'Pure',
            family_name: 'Referee',
            club_id: null,
          },
        ],
        error: null,
      }),
    )
    // Slice 8: listCandidates now reads event_referee_tournaments + event_referee_days.
    // Empty here — fixture has no granular allowlists, so the engine
    // treats every candidate as available for every tournament + day.
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    .mockReturnValueOnce(
      makeChain({
        data: [
          { id: 'reg-fighter-ref', person_id: 'person-ref-a', tournament_id: 'tournament-1' },
          { id: 'reg-b', person_id: 'person-b', tournament_id: 'tournament-1' },
        ],
        error: null,
      }),
    )
    .mockReturnValueOnce(makeChain({ data: assignments, error: null }))
    // R4: bracket phases query (returns empty so these tests stay
    // pool-only — the bracket loader short-circuits and asks nothing
    // further). Other R4-specific tests cover the bracket path.
    .mockReturnValueOnce(makeChain({ data: [], error: null }));
}

describe('AssignmentBoardService', () => {
  let service: AssignmentBoardService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffing.getResolvedConfigForAssignmentBoard.mockResolvedValue({
      pool: [...HARD_CODED_DEFAULT_SLOTS],
      bracket: [...HARD_CODED_DEFAULT_SLOTS],
      finals: [...HARD_CODED_DEFAULT_SLOTS],
      inheritsEventDefault: true,
      isHardCodedFloor: true,
    });
    service = new AssignmentBoardService(
      mockSupabase as never,
      mockSettings as never,
      mockStaffing as never,
    );
  });

  it('returns a scheduled pool board with candidates, missing slots, and hard-blocked fighter referees', async () => {
    queueBoardReads();

    const board = await service.getBoard('event-1');

    expect(board.pools).toHaveLength(1);
    expect(board.unscheduledPools).toEqual([]);
    expect(board.pools[0]!.scheduledStart).toBe('2026-05-21T10:00:00.000Z');
    expect(board.pools[0]!.roleSlots[0]!.candidates.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-a',
          reasons: expect.arrayContaining(['fighter_referee_overlap']),
        }),
      ]),
    );
    expect(board.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-b', displayName: 'Pure Referee' }),
      ]),
    );
    expect(board.missingSlots.length).toBeGreaterThanOrEqual(0);
    expect(board.swapSuggestions).toEqual([]);
  });

  it('rejects a manual assignment when the referee is fighting in that pool', async () => {
    queueBoardReads();

    await expect(
      service.applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_declarant',
        personId: 'person-a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a manual assignment when the referee already has another role in the same pool', async () => {
    // Slice 7b: person-ref-b is the pure referee (qualified for all
    // three roles per queueBoardReads). They're already assigned to
    // pool-1 as Déclarant — assigning them as Assesseur on the same
    // pool would split their attention across roles, so the manual
    // PATCH must reject.
    queueBoardReads([
      {
        id: 'existing-assign',
        person_id: 'person-ref-b',
        pool_id: 'pool-1',
        match_id: null,
        role: 'arbitre_declarant',
        status: 'assigned',
        auto_assigned: false,
      },
    ]);

    await expect(
      service.applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_assesseur',
        personId: 'person-ref-b',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // R4: bracket-match classification.
  describe('classifyBracketMatchKind (static)', () => {
    it('flags the final and bronze rounds as finals (round === maxRound)', () => {
      const info = { round: 4, position: 1, phaseId: 'phase-1' };
      expect(AssignmentBoardService.classifyBracketMatchKind(info, 4)).toBe('finals');
    });
    it('flags the semifinals as finals (round === maxRound - 1)', () => {
      const info = { round: 3, position: 1, phaseId: 'phase-1' };
      expect(AssignmentBoardService.classifyBracketMatchKind(info, 4)).toBe('finals');
    });
    it('flags earlier rounds as bracket', () => {
      const info = { round: 2, position: 1, phaseId: 'phase-1' };
      expect(AssignmentBoardService.classifyBracketMatchKind(info, 4)).toBe('bracket');
    });
    it('defaults to bracket when slot info is missing', () => {
      expect(AssignmentBoardService.classifyBracketMatchKind(null, 4)).toBe('bracket');
    });
  });

  it('persists auto-assign preview using the referee assignment schema columns', async () => {
    queueBoardReads();
    const deleteChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: null, error: null });
    fromMock.mockReturnValueOnce(deleteChain).mockReturnValueOnce(insertChain);

    const result = await service.applyPreview('event-1');

    expect(result.persisted).toBeGreaterThan(0);
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          event_id: 'event-1',
          person_id: 'person-ref-b',
          scope_type: 'pool',
          pool_id: 'pool-1',
          auto_assigned: true,
        }),
      ]),
    );
  });

  // ── Slice C ──────────────────────────────────────────────────────────────
  // The per-match referee columns in the pool tab need to know which
  // roles exist for this tournament (system + custom). The endpoint reads
  // the resolved staffing config, dedupes allowed skill ids across pool
  // slots, and joins referee_skills for human-readable names.
  describe('getPoolMatchRoleConfig', () => {
    it('returns one role per distinct skill id with the referee_skills display name', async () => {
      mockStaffing.getResolvedConfigForAssignmentBoard.mockResolvedValueOnce({
        pool: [
          { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
          { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
          { index: 3, displayName: 'Custom', allowedSkillIds: ['custom_skill_1'] },
        ],
        bracket: [],
        finals: [],
        inheritsEventDefault: false,
        isHardCodedFloor: false,
      });

      fromMock.mockReturnValueOnce(
        makeChain({
          data: [
            { id: 'arbitre_declarant', name: 'Déclarant' },
            { id: 'arbitre_assesseur', name: 'Assesseur' },
            { id: 'custom_skill_1', name: 'Chronométreur' },
          ],
          error: null,
        }),
      );

      const result = await service.getPoolMatchRoleConfig('tournament-1');

      expect(result.roles).toEqual([
        { id: 'arbitre_declarant', displayName: 'Déclarant' },
        { id: 'arbitre_assesseur', displayName: 'Assesseur' },
        { id: 'custom_skill_1', displayName: 'Chronométreur' },
      ]);
    });
  });

  // ── Clear assignments ─────────────────────────────────────────────────
  // Two new bulk-delete methods feeding the Referees → Assignments tab's
  // "Clear all" + per-pool trash actions. Both must refuse to run when
  // any row in scope is `status='confirmed'` (the lock guard) so the
  // operator can't accidentally wipe a locked board.
  describe('clearEventAssignments', () => {
    it('deletes every row in the event when none are confirmed', async () => {
      const selectChain = makeChain({
        data: [
          { id: 'a-1', status: 'assigned' },
          { id: 'a-2', status: 'assigned' },
        ],
        error: null,
      });
      const deleteChain = makeChain({ data: null, error: null });
      fromMock.mockReturnValueOnce(selectChain).mockReturnValueOnce(deleteChain);

      const result = await service.clearEventAssignments('event-1');

      expect(result).toEqual({ deleted: 2 });
      expect(deleteChain.delete).toHaveBeenCalled();
    });

    it('throws ConflictException when any row is confirmed (locked)', async () => {
      const selectChain = makeChain({
        data: [
          { id: 'a-1', status: 'assigned' },
          { id: 'a-2', status: 'confirmed' },
        ],
        error: null,
      });
      fromMock.mockReturnValueOnce(selectChain);

      await expect(service.clearEventAssignments('event-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('clearPoolAssignments', () => {
    it('deletes pool-scope rows and per-match rows for matches in the pool', async () => {
      // matches in pool
      const matchesChain = makeChain({
        data: [{ id: 'm-1' }, { id: 'm-2' }],
        error: null,
      });
      // pool-scope rows
      const poolRows = makeChain({
        data: [{ id: 'p-row-1', status: 'assigned' }],
        error: null,
      });
      // match-scope rows
      const matchRows = makeChain({
        data: [
          { id: 'm-row-1', status: 'assigned' },
          { id: 'm-row-2', status: 'assigned' },
        ],
        error: null,
      });
      const deleteChain = makeChain({ data: null, error: null });
      fromMock
        .mockReturnValueOnce(matchesChain)
        .mockReturnValueOnce(poolRows)
        .mockReturnValueOnce(matchRows)
        .mockReturnValueOnce(deleteChain);

      const result = await service.clearPoolAssignments('pool-1');

      expect(result).toEqual({ deleted: 3 });
      expect(deleteChain.delete).toHaveBeenCalled();
    });

    it('throws ConflictException when any pool-scope OR per-match row is confirmed', async () => {
      const matchesChain = makeChain({ data: [{ id: 'm-1' }], error: null });
      const poolRows = makeChain({
        data: [{ id: 'p-row-1', status: 'assigned' }],
        error: null,
      });
      const matchRows = makeChain({
        data: [{ id: 'm-row-1', status: 'confirmed' }],
        error: null,
      });
      fromMock
        .mockReturnValueOnce(matchesChain)
        .mockReturnValueOnce(poolRows)
        .mockReturnValueOnce(matchRows);

      await expect(service.clearPoolAssignments('pool-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
