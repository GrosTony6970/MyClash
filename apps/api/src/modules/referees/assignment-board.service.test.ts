import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentBoardService } from './assignment-board.service';
import { HARD_CODED_DEFAULT_SLOTS } from './staffing.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
/** Every rule on. Named so a test can flip one without restating the other eleven. */
const DEFAULT_RULE_SETTINGS = {
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  enforceDedicatedRefereeRest: true,
  workshopConflictWarning: true,
  ratingBasedOrdering: true,
  workloadBalance: true,
  enableOwnPoolRule: true,
  enableOfficiateVsFightRule: true,
  enableDoubleBookedRule: true,
  enableTwoRolesRule: true,
  enableAvailabilityRule: true,
  enableCapacityRule: true,
};
const mockSettings = {
  getSettings: vi.fn().mockResolvedValue(DEFAULT_RULE_SETTINGS),
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
    or: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });

  for (const key of ['select', 'eq', 'in', 'or', 'order', 'delete']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  chain.insert = vi.fn().mockResolvedValue(result);

  return chain;
}

// Distinct UUIDs per id-space so the fixture can't accidentally
// "work" when the production code compares the wrong space. The
// originating Denis-Allaume bug hid behind a fixture where
// `persons.id === global_persons.id`.
const FIGHTER_REF_PERSONS_ID = 'persons-row-fighter-ref'; // event-scoped persons.id
const FIGHTER_REF_GLOBAL_ID = 'person-ref-a'; // global_persons.id, candidate side
const PURE_REF_GLOBAL_ID = 'person-ref-b';
const BLUE_PERSONS_ID = 'persons-row-blue';
const BLUE_GLOBAL_ID = 'person-b-global';

/**
 * The five candidate-side reads `loadContext` makes, in order:
 * event_referees → qualifications → global_persons → referee tournaments →
 * referee days. Shared by every board fixture so a change to the candidate
 * pipeline is edited once instead of per-fixture.
 */
function queueCandidateReads() {
  fromMock
    .mockReturnValueOnce(
      makeChain({
        data: [{ person_id: FIGHTER_REF_GLOBAL_ID }, { person_id: PURE_REF_GLOBAL_ID }],
        error: null,
      }),
    )
    .mockReturnValueOnce(
      makeChain({
        data: [
          { person_id: FIGHTER_REF_GLOBAL_ID, role: 'arbitre_declarant', rating: 5 },
          { person_id: PURE_REF_GLOBAL_ID, role: 'arbitre_declarant', rating: 4 },
          { person_id: PURE_REF_GLOBAL_ID, role: 'arbitre_assesseur', rating: 4 },
          { person_id: PURE_REF_GLOBAL_ID, role: 'arbitre_table', rating: 4 },
        ],
        error: null,
      }),
    )
    // global_persons by id (post-0063: listCandidates does a single id-in lookup)
    .mockReturnValueOnce(
      makeChain({
        data: [
          {
            id: FIGHTER_REF_GLOBAL_ID,
            claimed_by_user_id: 'user-a',
            given_name: 'Fighter',
            family_name: 'Referee',
            club_id: null,
          },
          {
            id: PURE_REF_GLOBAL_ID,
            claimed_by_user_id: 'user-b',
            given_name: 'Pure',
            family_name: 'Referee',
            club_id: null,
          },
        ],
        error: null,
      }),
    )
    // Slice 8: listCandidates now reads event_referee_tournaments +
    // event_referee_days. Empty here — no fixture has granular allowlists, so
    // the engine treats every candidate as available for every tournament + day.
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    .mockReturnValueOnce(makeChain({ data: [], error: null }));
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
                  person_id: FIGHTER_REF_PERSONS_ID,
                  persons: {
                    id: FIGHTER_REF_PERSONS_ID,
                    global_person_id: FIGHTER_REF_GLOBAL_ID,
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
    );
  // event_referees → … → referee days
  queueCandidateReads();
  fromMock
    // registrations — now joined with persons(global_person_id) so the
    // map keys live in the same id-space as the candidate side.
    .mockReturnValueOnce(
      makeChain({
        data: [
          {
            id: 'reg-fighter-ref',
            person_id: FIGHTER_REF_PERSONS_ID,
            tournament_id: 'tournament-1',
            persons: { global_person_id: FIGHTER_REF_GLOBAL_ID },
          },
          {
            id: 'reg-b',
            person_id: BLUE_PERSONS_ID,
            tournament_id: 'tournament-1',
            persons: { global_person_id: BLUE_GLOBAL_ID },
          },
        ],
        error: null,
      }),
    )
    .mockReturnValueOnce(makeChain({ data: assignments, error: null }))
    // Tier 3: loadContext now fetches event lices (→ venue) for the cross-venue
    // referee double-booking warning. Empty → no venue resolved (no behavior
    // change for these fixtures).
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    // R4: bracket phases query (returns empty so these tests stay
    // pool-only — the bracket loader short-circuits and asks nothing
    // further). Other R4-specific tests cover the bracket path.
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    // Slice 7: swiss phases query. Empty for the same reason — the Swiss
    // loader short-circuits before touching swiss_rounds or matches.
    // NOTE: this mock chain is POSITIONAL. Any new query in loadContext must
    // add an entry here or every test in this file reds with a bare TypeError.
    .mockReturnValueOnce(makeChain({ data: [], error: null }));
}

describe('AssignmentBoardService', () => {
  let service: AssignmentBoardService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffing.getResolvedConfigForAssignmentBoard.mockResolvedValue({
      pool: [...HARD_CODED_DEFAULT_SLOTS],
      swiss: [...HARD_CODED_DEFAULT_SLOTS],
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

  it('getBoard does NOT run the auto-assign engine — no proposal chips appear', async () => {
    // Regression guard: prior to this change getBoard() called
    // previewFromContext() on every load, so the operator saw a
    // board pre-filled with engine proposals before clicking
    // anything. Now it must be persisted-only — no fixture row,
    // no chip.
    queueBoardReads();

    const board = await service.getBoard('event-1');

    const allSlots = board.pools.flatMap((pool) => pool.roleSlots);
    expect(allSlots.length).toBeGreaterThan(0);
    for (const slot of allSlots) {
      // No persisted assignment was queued, so every slot must be
      // empty. Any non-null assignment here would mean the engine
      // ran and produced a proposal — the very behaviour we're
      // fixing.
      expect(slot.assignment).toBeNull();
    }
  });

  it('previewBoard runs the engine and surfaces proposals as isProposal: true', async () => {
    queueBoardReads();

    const board = await service.previewBoard('event-1');

    const proposalAssignments = board.pools
      .flatMap((pool) => pool.roleSlots)
      .map((slot) => slot.assignment)
      .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== null);

    expect(proposalAssignments.length).toBeGreaterThan(0);
    for (const assignment of proposalAssignments) {
      // Engine produced this chip; no persisted row exists in the
      // fixture, so isProposal must be true.
      expect(assignment.isProposal).toBe(true);
    }
  });

  it('rejects a manual assignment when the referee is fighting in that pool', async () => {
    queueBoardReads();

    // The manual-PATCH guard must catch this even though the
    // candidate's id (FIGHTER_REF_GLOBAL_ID = global_persons.id) is
    // structurally distinct from the pool member's persons.id
    // (FIGHTER_REF_PERSONS_ID). Pre-fix code projected persons.id and
    // failed the comparison silently.
    await expect(
      service.applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_declarant',
        personId: FIGHTER_REF_GLOBAL_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks the fighter-in-pool as a referee proposal even when persons.id differs from global_persons.id', async () => {
    // Regression: the originating Denis-Allaume bug. The fighter's
    // event-scoped persons.id (FIGHTER_REF_PERSONS_ID) is distinct
    // from their global_persons.id (FIGHTER_REF_GLOBAL_ID); the
    // referee candidate side keys on the latter. Pre-fix code
    // compared persons.id and never matched, so the engine
    // happily proposed the fighter as a referee for their own pool.
    queueBoardReads();

    const board = await service.previewBoard('event-1');

    const slot1Assignment = board.pools[0]!.roleSlots[0]!.assignment;
    // The fighter must NOT have been proposed as a referee here. If
    // the engine had a clean candidate to fill the slot it picked
    // that; if not, the slot is empty — either is correct, but the
    // fighter (FIGHTER_REF_GLOBAL_ID) is never the answer.
    expect(slot1Assignment?.personId).not.toBe(FIGHTER_REF_GLOBAL_ID);
  });

  it('rejects a manual assignment when the referee already has another role in the same pool', async () => {
    // Slice 7b: the pure referee (PURE_REF_GLOBAL_ID) is qualified
    // for all three roles per queueBoardReads. They're already
    // assigned to pool-1 as Déclarant — assigning them as Assesseur
    // on the same pool would split their attention across roles, so
    // the manual PATCH must reject.
    queueBoardReads([
      {
        id: 'existing-assign',
        person_id: PURE_REF_GLOBAL_ID,
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
        personId: PURE_REF_GLOBAL_ID,
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
          // CHECK referee_assignments_scope_check (migration 0091)
          // requires lice_id + match_id NULL for scope_type='pool'.
          // Locked in here so a future regression that re-introduces
          // denormalised values trips this test instead of production.
          lice_id: null,
          match_id: null,
          auto_assigned: true,
        }),
      ]),
    );
  });

  // ── Slice 7: Swiss (round × piste) units ─────────────────────────────────
  describe('Swiss rounds as board units', () => {
    /**
     * Same positional chain as `queueBoardReads`, but with no pools and a
     * populated Swiss phase: phases → pools → … → bracket phases (empty) →
     * swiss phases → swiss_rounds → matches → registrations.
     */
    function queueSwissBoardReads(assignments: unknown[] = []) {
      fromMock
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
        .mockReturnValueOnce(
          makeChain({
            data: [{ id: 'tournament-1', name: 'Longsword', weapon: 'longsword' }],
            error: null,
          }),
        )
        // listPhases filters type='pool' → none, so listPools is skipped entirely
        .mockReturnValueOnce(makeChain({ data: [], error: null }));
      queueCandidateReads();
      fromMock
        .mockReturnValueOnce(
          makeChain({
            data: [
              {
                id: 'reg-fighter-ref',
                person_id: FIGHTER_REF_PERSONS_ID,
                tournament_id: 'tournament-1',
                persons: { global_person_id: FIGHTER_REF_GLOBAL_ID },
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(makeChain({ data: assignments, error: null }))
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // lices → venue
        .mockReturnValueOnce(makeChain({ data: [], error: null })); // bracket phases
      queueSwissPhaseReads();
    }

    /**
     * The Swiss loader's four reads: phases → swiss_rounds → matches →
     * registrations. Round 3 runs three bouts across two pistes.
     */
    function queueSwissPhaseReads() {
      fromMock
        .mockReturnValueOnce(
          makeChain({
            data: [{ id: 'swiss-phase-1', tournament_id: 'tournament-1' }],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeChain({
            data: [{ id: 'round-3', phase_id: 'swiss-phase-1', round_number: 3 }],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeChain({
            data: [
              swissMatch('sw-1', 'lice-1', '10:00', 'reg-fighter-ref', 'reg-b'),
              swissMatch('sw-2', 'lice-1', '10:10', 'reg-c', 'reg-d'),
              swissMatch('sw-3', 'lice-2', '10:00', 'reg-e', 'reg-f'),
            ],
            error: null,
          }),
        )
        // registrations → persons, for the round's member list
        .mockReturnValueOnce(
          makeChain({
            data: [
              {
                id: 'reg-fighter-ref',
                person_id: FIGHTER_REF_PERSONS_ID,
                persons: {
                  id: FIGHTER_REF_PERSONS_ID,
                  global_person_id: FIGHTER_REF_GLOBAL_ID,
                  given_name: 'Fighter',
                  family_name: 'Referee',
                  display_name: null,
                  clubs: { name: 'Salle A' },
                },
              },
            ],
            error: null,
          }),
        );
    }

    function swissMatch(id: string, liceId: string, hhmm: string, red: string, blue: string) {
      return {
        id,
        swiss_round_id: 'round-3',
        scheduled_at: `2026-05-21T${hhmm}:00.000Z`,
        lice_id: liceId,
        red_registration_id: red,
        blue_registration_id: blue,
      };
    }

    it('emits one unit per (round × piste) carrying every bout of that piste', async () => {
      queueSwissBoardReads();

      const board = await service.getBoard('event-1');

      const units = [...board.pools, ...board.unscheduledPools].filter((p) => p.kind === 'swiss');
      expect(units).toHaveLength(2);
      expect(units.map((u) => u.id)).toEqual(['swiss-round-3-lice-1', 'swiss-round-3-lice-2']);
      expect(units[0]!.matchIds).toEqual(['sw-1', 'sw-2']);
      expect(units[1]!.matchIds).toEqual(['sw-3']);
      expect(units[0]!.name).toBe('LSW-S3');
      expect(units[0]!.swissRound).toBe(3);
      expect(units[0]!.swissRoundId).toBe('round-3');
      expect(units[0]!.liceId).toBe('lice-1');
      expect(units[0]!.scheduledStart).toBe('2026-05-21T10:00:00.000Z');
    });

    it('blocks a fighter from reffing their own round on EITHER piste', async () => {
      queueSwissBoardReads();

      const board = await service.getBoard('event-1');

      // The fighter competes on lice-1. Both units must block them, because
      // the two pistes of one round run at the same time.
      const units = [...board.pools, ...board.unscheduledPools].filter((p) => p.kind === 'swiss');
      for (const unit of units) {
        expect(unit.roleSlots[0]!.candidates.blocked).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              personId: FIGHTER_REF_GLOBAL_ID,
              reasons: expect.arrayContaining(['fighter_referee_overlap']),
            }),
          ]),
        );
      }
    });

    it('writes one scope_type=match row per bout, never a lice-scoped row', async () => {
      queueSwissBoardReads();
      const deleteChain = makeChain({ data: null, error: null });
      const insertChain = makeChain({ data: null, error: null });
      fromMock.mockReturnValueOnce(deleteChain).mockReturnValueOnce(insertChain);

      await service.applyPreview('event-1');

      const rows = insertChain.insert.mock.calls[0]![0] as Array<Record<string, unknown>>;
      const lice1Rows = rows.filter((r) => r['match_id'] === 'sw-1' || r['match_id'] === 'sw-2');
      // Each assigned role fans out across both bouts of the piste.
      expect(lice1Rows.length).toBeGreaterThan(0);
      expect(lice1Rows.filter((r) => r['match_id'] === 'sw-1')).toHaveLength(
        lice1Rows.filter((r) => r['match_id'] === 'sw-2').length,
      );
      // scope_type='lice' would drop this work out of the referee workload
      // counts (qualifications.service.ts excludes lice-scoped rows).
      expect(rows.every((r) => r['scope_type'] === 'match')).toBe(true);
      expect(rows.every((r) => r['lice_id'] === null)).toBe(true);
      expect(rows.every((r) => r['pool_id'] === null)).toBe(true);
    });
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

  // ── applyPreview: the fifth bulk path ─────────────────────────────────
  // `clearEventAssignments` above refuses on a locked board and says why in
  // its docblock — "otherwise we'd silently wipe a locked board". Applying the
  // preview does something strictly worse (delete-then-insert) and used to ask
  // nothing at all. These pin the guard and the delete's scope.
  //
  // `loadContext` is stubbed rather than mocked through `fromMock`: it makes a
  // dozen queries, and none of them is what either test is about.
  describe('applyPreview lock guard', () => {
    // `loadContext` is private, so the spy needs a structural view of it. Cast
    // through `unknown` — TS2352 otherwise, per the repo's mock-chain note.
    type WithLoadContext = { loadContext: (eventId: string) => Promise<unknown> };

    function stubContext(overrides: Record<string, unknown>) {
      return vi.spyOn(service as unknown as WithLoadContext, 'loadContext').mockResolvedValue({
        eventId: 'event-1',
        eventStartDate: null,
        ruleSettings: DEFAULT_RULE_SETTINGS,
        tournaments: [],
        phases: [],
        pools: [],
        candidates: [],
        assignments: [],
        fighterRegistrationIdsByPerson: new Map(),
        slotConfigByTournament: new Map(),
        venueByLiceId: new Map(),
        locked: false,
        ...overrides,
      } as never);
    }

    it('refuses on a locked board and deletes nothing', async () => {
      stubContext({ locked: true });

      await expect(service.applyPreview('event-1')).rejects.toBeInstanceOf(ConflictException);
      // The guard has to run BEFORE persistAssignments, not alongside it: the
      // delete is the first thing that method does.
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('scopes the delete to the units the run covers, not the whole event', async () => {
      const poolShape = {
        name: 'A',
        tournamentId: 't-1',
        tournamentName: 'T',
        liceId: null,
        scheduledStart: null,
        scheduledEnd: null,
        members: [],
        matches: [],
      };
      stubContext({
        pools: [
          { ...poolShape, id: 'pool-1', kind: 'pool', matchIds: [] },
          { ...poolShape, id: 'bracket-unit', kind: 'bracket', matchIds: ['m-1', 'm-2'] },
        ],
      });
      const deleteChain = makeChain({ data: null, error: null });
      fromMock.mockReturnValue(deleteChain);

      await service.applyPreview('event-1');

      expect(deleteChain.delete).toHaveBeenCalled();
      expect(deleteChain.eq).toHaveBeenCalledWith('auto_assigned', true);
      // A lice-scoped row has pool_id and match_id NULL, so this predicate
      // cannot reach one — which is the point.
      expect(deleteChain.or).toHaveBeenCalledWith('pool_id.in.(pool-1),match_id.in.(m-1,m-2)');
    });

    it('deletes nothing when the run covers no placeable unit', async () => {
      stubContext({ pools: [] });

      await service.applyPreview('event-1');

      // Falsifies the old order, where `rows.length === 0` returned AFTER the
      // delete had already wiped the event's auto-assigned rows.
      expect(fromMock).not.toHaveBeenCalled();
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

  /**
   * The schedule board's banner reads this instead of the whole workspace. Two
   * things have to hold: it must not become a second implementation that drifts
   * from `getBoard`, and it must say whether anybody was looking.
   */
  describe('getCrewConflicts', () => {
    it('returns exactly what getBoard computes, and none of the rest of the workspace', async () => {
      queueBoardReads();
      const board = await service.getBoard('event-1');
      queueBoardReads();
      const slim = await service.getCrewConflicts('event-1');

      expect(slim.conflicts).toEqual(board.conflicts);
      // The whole point of the endpoint. Spreading the board in here would
      // still satisfy the assertion above and undo the reason it exists.
      expect(Object.keys(slim).sort()).toEqual(['asOf', 'conflicts', 'rules']);
    });

    /**
     * Each conflict kind is gated by its own toggle, so a switched-off rule
     * empties the list. Without this field the banner cannot tell "no
     * conflicts" from "nobody is checking", and the second one reads as safe.
     */
    it('reports a switched-off rule rather than silently returning nothing', async () => {
      mockSettings.getSettings.mockResolvedValueOnce({
        ...DEFAULT_RULE_SETTINGS,
        enableDoubleBookedRule: false,
      });
      queueBoardReads();

      const slim = await service.getCrewConflicts('event-1');

      expect(slim.rules).toEqual({
        officiateVsFight: true,
        doubleBooked: false,
        availability: true,
      });
    });

    it('reports every rule on when every rule is on', async () => {
      queueBoardReads();
      const slim = await service.getCrewConflicts('event-1');
      expect(slim.rules).toEqual({
        officiateVsFight: true,
        doubleBooked: true,
        availability: true,
      });
    });

    /** This half of the banner is the LAGGING one and has to be able to say so. */
    it('stamps when it looked', async () => {
      queueBoardReads();
      const slim = await service.getCrewConflicts('event-1');
      expect(Number.isNaN(Date.parse(slim.asOf))).toBe(false);
    });
  });

  /**
   * A referee committed to ONE FIGHT is still committed.
   *
   * Two things put a referee on a bout. The board assigns a whole pool and
   * writes `scope_type='pool'`; the pool tab's matches table sets the crew of a
   * single fight and writes `scope_type='match'` with a null `pool_id`. The
   * commitment model the write path judges by only ever collected the first
   * kind, so a referee already booked on a fight looked completely free, and
   * `applyManual` accepted an overlap the board had been drawing a banner about
   * since W6.2.
   *
   * The reason the obvious one-line union does not fix it: a REAL pool unit
   * carries no `matchIds` at all. That field is set only on the synthetic
   * bracket and Swiss units. `listPools` projects `matches`, so that is what the
   * unit's fights have to be read from — matching on `matchIds` alone would have
   * been a no-op that tested green against a bracket fixture.
   */
  describe('a per-match referee is a commitment the write path can see', () => {
    const POOL_2_REF = 'person-ref-b'; // = PURE_REF_GLOBAL_ID, the referee being moved
    const C_GLOBAL_ID = 'person-c-global';
    const D_GLOBAL_ID = 'person-d-global';

    /**
     * Two pools running at the same time on two pistes. Pool 1 holds match-1,
     * pool 2 holds match-2. Nobody fights in both — the only thing that can
     * collide here is a REFEREE.
     */
    function queueTwoOverlappingPools(assignments: unknown[]) {
      // A fallback for everything after the positional queue: an assignment
      // that is ACCEPTED goes on to delete and insert, and those reads are not
      // part of loadContext.
      fromMock.mockReturnValue(makeChain({ data: [], error: null }));
      fromMock
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
                pool_members: [],
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
              {
                id: 'pool-2',
                phase_id: 'phase-1',
                name: 'Pool 2',
                pool_members: [],
                matches: [
                  {
                    id: 'match-2',
                    scheduled_at: '2026-05-21T10:00:00.000Z',
                    lice_id: 'lice-2',
                    red_registration_id: 'reg-c',
                    blue_registration_id: 'reg-d',
                  },
                ],
              },
            ],
            error: null,
          }),
        );
      queueCandidateReads();
      fromMock
        .mockReturnValueOnce(
          makeChain({
            data: [
              {
                id: 'reg-fighter-ref',
                person_id: FIGHTER_REF_PERSONS_ID,
                tournament_id: 'tournament-1',
                persons: { global_person_id: FIGHTER_REF_GLOBAL_ID },
              },
              {
                id: 'reg-b',
                person_id: BLUE_PERSONS_ID,
                tournament_id: 'tournament-1',
                persons: { global_person_id: BLUE_GLOBAL_ID },
              },
              {
                id: 'reg-c',
                person_id: 'persons-row-c',
                tournament_id: 'tournament-1',
                persons: { global_person_id: C_GLOBAL_ID },
              },
              {
                id: 'reg-d',
                person_id: 'persons-row-d',
                tournament_id: 'tournament-1',
                persons: { global_person_id: D_GLOBAL_ID },
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(makeChain({ data: assignments, error: null }))
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // lices
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // bracket phases
        .mockReturnValueOnce(makeChain({ data: [], error: null })); // swiss phases
    }

    /** Booked on match-1 alone: scope 'match', match_id set, pool_id NULL. */
    const perMatchAssignment = {
      id: 'existing-match-scoped',
      person_id: POOL_2_REF,
      pool_id: null,
      match_id: 'match-1',
      role: 'arbitre_declarant',
      status: 'assigned',
      auto_assigned: false,
    };

    it('refuses a referee already booked on an overlapping fight', async () => {
      queueTwoOverlappingPools([perMatchAssignment]);

      await expect(
        service.applyManual('event-1', {
          poolId: 'pool-2',
          role: 'arbitre_declarant',
          personId: POOL_2_REF,
        }),
      ).rejects.toThrow(/already officiating/);
    });

    it('still accepts them when the double-booking rule is switched off', async () => {
      // The refusal rides on `enableDoubleBookedRule`, which is a real toggle an
      // organiser may turn off — unlike rule 8, which is its own always-true
      // setting and is not what gates this. A disabled rule must let the write
      // through, or the toggle is decoration.
      mockSettings.getSettings.mockResolvedValueOnce({
        ...DEFAULT_RULE_SETTINGS,
        enableDoubleBookedRule: false,
      });
      queueTwoOverlappingPools([perMatchAssignment]);

      await expect(
        service.applyManual('event-1', {
          poolId: 'pool-2',
          role: 'arbitre_declarant',
          personId: POOL_2_REF,
        }),
      ).resolves.toBeDefined();
    });

    it('leaves a referee booked on a fight that does NOT overlap alone', async () => {
      // The commitment is real but the windows do not touch, so there is
      // nothing to refuse. Without this the fix could simply refuse every
      // per-match referee everywhere and still look correct.
      queueTwoOverlappingPools([
        { ...perMatchAssignment, match_id: 'match-elsewhere' },
        {
          id: 'unrelated-pool-scoped',
          person_id: POOL_2_REF,
          pool_id: 'pool-nowhere',
          match_id: null,
          role: 'arbitre_declarant',
          status: 'assigned',
          auto_assigned: false,
        },
      ]);

      await expect(
        service.applyManual('event-1', {
          poolId: 'pool-2',
          role: 'arbitre_declarant',
          personId: POOL_2_REF,
        }),
      ).resolves.toBeDefined();
    });
  });
});
