import { BadRequestException, ConflictException } from '@nestjs/common';
import { checkReferee } from '@myclash/rulesets/scheduling/referee-checker';
import type * as RefereeChecker from '@myclash/rulesets/scheduling/referee-checker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectsFor } from '../../common/testing/supabase-chain';
import { resolveMatchLengths } from '../schedule/match-lengths';
import { AssignmentBoardService } from './assignment-board.service';
import { HARD_CODED_DEFAULT_SLOTS } from './staffing.service';

// The length helper is a plain module with reads of its own; its own test proves
// the resolution. Mocked here so the positional `from()` queue below stays the
// board's reads only. Every bout is five minutes unless a test says otherwise.
vi.mock('../schedule/match-lengths', () => ({
  resolveMatchLengths: vi.fn((_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
    Promise.resolve(new Map(inputs.map((input) => [input.id, 5]))),
  ),
}));
const resolveMatchLengthsMock = vi.mocked(resolveMatchLengths);

// A pass-through spy: the real checker answers, and a test can read what each door asked it.
vi.mock('@myclash/rulesets/scheduling/referee-checker', async (importOriginal) => {
  const actual = await importOriginal<typeof RefereeChecker>();
  return { ...actual, checkReferee: vi.fn(actual.checkReferee) };
});
const checkRefereeSpy = vi.mocked(checkReferee);

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
/** Every rule on. Named so a test can flip one without restating the other eleven. */
const DEFAULT_RULE_SETTINGS = {
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  maxBoutsPerDay: 0,
  workshopConflictWarning: true,
  ratingBasedOrdering: true,
  workloadBalance: true,
  enableOwnPoolRule: true,
  enableOwnPoolSpanRule: true,
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
function queueCandidateReads(refereeDays: unknown[] = [], failing?: FailingRead) {
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
    // event_referee_days. Empty by default — most fixtures have no granular
    // allowlist, so the engine treats every candidate as available for every
    // tournament + day. `refereeDays` seeds the per-day one.
    .mockReturnValueOnce(
      makeChain(failing === 'event_referee_tournaments' ? FAILED : { data: [], error: null }),
    )
    .mockReturnValueOnce(
      makeChain(failing === 'event_referee_days' ? FAILED : { data: refereeDays, error: null }),
    );
}

/**
 * Knobs the day-bucketing fixtures need. Defaults reproduce the board every
 * other test in this file expects, so adding one is not a behaviour change for
 * the existing cases.
 */
interface BoardReadOptions {
  /** The Pool bout's own stored length, when a test needs one. */
  matchOverride?: number;
  /** The `events` row. Carries the timezone the day index is measured on. */
  event?: { start_date: string | null; timezone?: string | null };
  /** When the pool's single match is scheduled. Sets the pool's window. */
  matchScheduledAt?: string;
  /** `event_referee_days` rows — the per-day availability allowlist. */
  refereeDays?: unknown[];
  /** One read that fails, by table. */
  failing?: FailingRead;
}

type FailingRead = 'events' | 'event_referee_tournaments' | 'event_referee_days';
const FAILED = { data: null, error: { message: 'connection reset' } };

function queueBoardReads(assignments: unknown[] = [], options: BoardReadOptions = {}) {
  const event = options.event ?? { start_date: '2026-05-21' };
  const matchScheduledAt = options.matchScheduledAt ?? '2026-05-21T10:00:00.000Z';
  fromMock
    // Slice 8: loadContext now fetches event.start_date + timezone up front.
    .mockReturnValueOnce(
      makeChain(options.failing === 'events' ? FAILED : { data: event, error: null }),
    )
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
                phase_id: 'phase-1',
                planned_duration_override_minutes: options.matchOverride ?? null,
                scheduled_at: matchScheduledAt,
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
  queueCandidateReads(options.refereeDays ?? [], options.failing);
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
    // R4: bracket phases query (returns empty so these tests stay
    // pool-only — the bracket loader short-circuits and asks nothing
    // further). Other R4-specific tests cover the bracket path.
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    // Slice 7: swiss phases query. Empty for the same reason — the Swiss
    // loader short-circuits before touching swiss_rounds or matches.
    // NOTE: this mock chain is POSITIONAL. Any new query in loadContext must
    // add an entry here or every test in this file reds with a bare TypeError.
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    // W1: the Event's Workshops, for teaching/attending commitments. None here —
    // the Workshop read short-circuits before sessions and enrolments.
    .mockReturnValueOnce(makeChain({ data: [], error: null }));
}

describe('AssignmentBoardService', () => {
  let service: AssignmentBoardService;

  beforeEach(() => {
    vi.clearAllMocks();
    // A describe below turns rest off for its own tests; every test starts from the default.
    mockSettings.getSettings.mockResolvedValue(DEFAULT_RULE_SETTINGS);
    // clearAllMocks keeps queued mockReturnValueOnce answers: a test that stops early must
    // not hand its unread rows to the next one.
    fromMock.mockReset();
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

  it('returns a scheduled pool board with candidates, missing slots, and an amber fighter-referee', async () => {
    queueBoardReads();

    const board = await service.getBoard('event-1');

    expect(board.pools).toHaveLength(1);
    expect(board.unscheduledPools).toEqual([]);
    expect(board.pools[0]!.scheduledStart).toBe('2026-05-21T10:00:00.000Z');
    // Refereeing one's own Pool is Discouraged (ADR-016): amber, assignable after confirming.
    const slot = board.pools[0]!.roleSlots[0]!;
    expect(slot.candidates.warning).toEqual([
      expect.objectContaining({
        userId: 'user-a',
        reasons: [{ code: 'own_pool', label: 'Longsword · Pool 1' }],
      }),
    ]);
    expect(slot.candidates.blocked.map((c) => c.userId)).not.toContain('user-a');
    expect(board.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-b', displayName: 'Pure Referee' }),
      ]),
    );
    expect(board.missingSlots.length).toBeGreaterThanOrEqual(0);
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

  it('asks for confirmation before a referee takes the pool they fight in', async () => {
    queueBoardReads();

    // The guard must catch this even though the candidate's id
    // (FIGHTER_REF_GLOBAL_ID = global_persons.id) is structurally distinct from
    // the pool member's persons.id (FIGHTER_REF_PERSONS_ID). Pre-fix code
    // projected persons.id and failed the comparison silently.
    const refusal = await service
      .applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_declarant',
        personId: FIGHTER_REF_GLOBAL_ID,
      })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toEqual({
      code: 'referee_needs_confirmation',
      // Names each reason: the AI assistant keeps nothing but the message on a failed draft.
      message: 'Assigning this referee needs confirmation: own_pool (Longsword · Pool 1)',
      level: 'discouraged',
      reasons: [
        {
          code: 'own_pool',
          level: 'discouraged',
          against: { kind: 'pool', id: 'pool-1', label: 'Longsword · Pool 1' },
          confirmed: false,
        },
      ],
    });
    // Nothing was written.
    expect(fromMock.mock.results.some((r) => r.value?.insert?.mock?.calls?.length)).toBe(false);
  });

  it('writes the confirmed-over reason onto the row, and does not drop it', async () => {
    queueBoardReads();
    const writes = makeChain({ data: null, error: null });
    fromMock.mockReturnValueOnce(writes).mockReturnValueOnce(writes);
    queueBoardReads(); // the board re-read after the write

    await service.applyManual('event-1', {
      poolId: 'pool-1',
      role: 'arbitre_declarant',
      personId: FIGHTER_REF_GLOBAL_ID,
      confirm: true,
    });

    expect(writes.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        person_id: FIGHTER_REF_GLOBAL_ID,
        scope_type: 'pool',
        pool_id: 'pool-1',
        conflicts_jsonb: [{ code: 'own_pool', label: 'Longsword · Pool 1' }],
      }),
    ]);
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

  it('asks for confirmation when the referee already has another role in the same pool', async () => {
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

    const refusal = await service
      .applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_assesseur',
        personId: PURE_REF_GLOBAL_ID,
      })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: 'referee_needs_confirmation',
      level: 'discouraged',
      reasons: [expect.objectContaining({ code: 'two_roles' })],
    });
  });

  it('the picker and Assign hand the one checker the same person, target and commitments', async () => {
    queueBoardReads();
    await service.getBoard('event-1');
    const pickerCall = checkRefereeSpy.mock.calls.find(
      ([args]) =>
        args.personId === FIGHTER_REF_GLOBAL_ID && args.target.role === 'arbitre_declarant',
    )?.[0];
    checkRefereeSpy.mockClear();

    queueBoardReads();
    await service
      .applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_declarant',
        personId: FIGHTER_REF_GLOBAL_ID,
      })
      .catch(() => undefined);
    const assignCall = checkRefereeSpy.mock.calls[0]?.[0];

    expect(pickerCall).toBeDefined();
    expect(assignCall).toEqual(pickerCall);
    // And the commitments are the board's: her bout of match-1, her Pool.
    expect(assignCall!.commitments.map((c) => c.kind).sort()).toEqual(['fight', 'fight-pool']);
    expect(checkRefereeSpy).toHaveBeenCalledTimes(1);
  });

  // Availability is an Impossible rule: a read that fails must not answer "no restriction".
  it.each(['events', 'event_referee_tournaments', 'event_referee_days'] as const)(
    'a failed read of %s is a plain Error (a 5xx), never an unchecked all-clear',
    async (failing) => {
      queueBoardReads([], { failing });
      const failure = service.getBoard('event-1');
      await expect(failure).rejects.toThrow(/^Could not read .*: connection reset$/);
      await expect(failure).rejects.not.toHaveProperty('status');
    },
  );

  it('keeps a missing skill a 400, before any scheduling rule', async () => {
    queueBoardReads();
    await expect(
      service.applyManual('event-1', {
        poolId: 'pool-1',
        role: 'arbitre_table',
        personId: FIGHTER_REF_GLOBAL_ID,
      }),
    ).rejects.toThrow(new BadRequestException('Selected referee is not qualified for this role'));
  });

  // R4: bracket-match classification.
  describe('each bout at its planned length (ADR-018)', () => {
    it('resolves every bout ONCE for the whole board, with its phase and its own override', async () => {
      queueBoardReads([], { matchOverride: 9 });

      await service.getBoard('event-1');

      expect(resolveMatchLengthsMock).toHaveBeenCalledTimes(1);
      expect(resolveMatchLengthsMock.mock.calls[0]?.[1]).toBe('event-1');
      expect(resolveMatchLengthsMock.mock.calls[0]?.[2]).toEqual([
        { id: 'match-1', phaseId: 'phase-1', plannedDurationOverrideMinutes: 9 },
      ]);
    });

    it("ends a Pool when its last bout's planned length runs out", async () => {
      resolveMatchLengthsMock.mockResolvedValueOnce(new Map([['match-1', 12]]));
      queueBoardReads();

      const board = await service.getBoard('event-1');

      // It was the last start plus five minutes, whatever the sheet said.
      expect(board.pools[0]!.scheduledEnd).toBe('2026-05-21T10:12:00.000Z');
    });

    it("asks the Pools read for each bout's phase and override", async () => {
      // The positional double ignores the projection: without this the columns
      // could leave the embed and every value above would still be right.
      queueBoardReads();

      await service.getBoard('event-1');

      expect(selectsFor(fromMock as never, 'pools')).toEqual([
        'id, phase_id, name, sort_order, pool_members(registration_id, registrations(id, person_id, persons(id, global_person_id, given_name, family_name, club_id, clubs(name)))), matches(id, phase_id, planned_duration_override_minutes, scheduled_at, lice_id, red_registration_id, blue_registration_id)',
      ]);
    });

    /**
     * No Pools, no Swiss: one single-elimination phase with one bout on a piste.
     * Same positional chain as `queueBoardReads` up to the bracket loader.
     */
    function queueBracketBoardReads() {
      fromMock
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
        .mockReturnValueOnce(
          makeChain({ data: [{ id: 'tournament-1', name: 'Longsword' }], error: null }),
        )
        .mockReturnValueOnce(makeChain({ data: [], error: null })); // pool phases
      queueCandidateReads();
      fromMock
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // registrations
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // assignments
        .mockReturnValueOnce(
          makeChain({
            data: [{ id: 'bracket-phase-1', tournament_id: 'tournament-1', type: 'single_elim' }],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeChain({
            data: [
              {
                id: 'bout-1',
                phase_id: 'bracket-phase-1',
                planned_duration_override_minutes: null,
                scheduled_at: '2026-05-21T14:00:00.000Z',
                lice_id: 'lice-1',
                red_registration_id: 'reg-x',
                blue_registration_id: 'reg-y',
                bracket_slot_id: 'slot-1',
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeChain({
            data: [{ id: 'slot-1', phase_id: 'bracket-phase-1', round: 1, position: 1 }],
            error: null,
          }),
        )
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // swiss phases
        .mockReturnValueOnce(makeChain({ data: [], error: null })); // workshops
    }

    it('ends a bracket bout at its own planned length and reads what that length needs', async () => {
      resolveMatchLengthsMock.mockResolvedValueOnce(new Map([['bout-1', 15]]));
      queueBracketBoardReads();

      const board = await service.getBoard('event-1');

      const unit = board.pools.find((p) => p.id === 'match-bout-1');
      expect(unit?.scheduledEnd).toBe('2026-05-21T14:15:00.000Z');
      expect(resolveMatchLengthsMock.mock.calls[0]?.[2]).toEqual([
        { id: 'bout-1', phaseId: 'bracket-phase-1', plannedDurationOverrideMinutes: null },
      ]);
      expect(selectsFor(fromMock as never, 'matches')).toEqual([
        'id, phase_id, planned_duration_override_minutes, scheduled_at, lice_id, red_registration_id, blue_registration_id, bracket_slot_id',
      ]);
    });
  });

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
    // A duty stores no time of its own (migration 0198): every reader works its
    // window out from the Matches it covers, so a copy here would only go stale.
    const rows = insertChain.insert.mock.calls[0]![0] as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'auto_assigned',
        'conflicts_jsonb',
        'event_id',
        'lice_id',
        'match_id',
        'person_id',
        'pool_id',
        'role',
        'scope_type',
        'status',
      ]);
    }
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
        )
        .mockReturnValueOnce(makeChain({ data: [], error: null })); // workshops
    }

    function swissMatch(id: string, liceId: string, hhmm: string, red: string, blue: string) {
      return {
        id,
        phase_id: 'swiss-phase-1',
        planned_duration_override_minutes: null,
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

    it('ends each (round × piste) unit at its latest planned bout end', async () => {
      resolveMatchLengthsMock.mockResolvedValueOnce(
        new Map([
          ['sw-1', 12],
          ['sw-2', 12],
          ['sw-3', 12],
        ]),
      );
      queueSwissBoardReads();

      const board = await service.getBoard('event-1');

      const units = [...board.pools, ...board.unscheduledPools].filter((p) => p.kind === 'swiss');
      // lice-1 runs 10:00 and 10:10; the second bout ends at 10:22.
      expect(units.map((u) => [u.id, u.scheduledEnd])).toEqual([
        ['swiss-round-3-lice-1', '2026-05-21T10:22:00.000Z'],
        ['swiss-round-3-lice-2', '2026-05-21T10:12:00.000Z'],
      ]);
      expect(resolveMatchLengthsMock.mock.calls[0]?.[2]).toEqual([
        { id: 'sw-1', phaseId: 'swiss-phase-1', plannedDurationOverrideMinutes: null },
        { id: 'sw-2', phaseId: 'swiss-phase-1', plannedDurationOverrideMinutes: null },
        { id: 'sw-3', phaseId: 'swiss-phase-1', plannedDurationOverrideMinutes: null },
      ]);
      expect(selectsFor(fromMock as never, 'matches')).toEqual([
        'id, phase_id, planned_duration_override_minutes, swiss_round_id, scheduled_at, lice_id, red_registration_id, blue_registration_id',
      ]);
    });

    it('blocks a fighter from reffing their own round on EITHER piste', async () => {
      queueSwissBoardReads();

      const board = await service.getBoard('event-1');

      // The fighter competes on lice-1 at 10:00. Both units must block them: on
      // lice-1 it is their own bout, on lice-2 a bout at the same time, because
      // the two pistes of one round run at once.
      const units = [...board.pools, ...board.unscheduledPools].filter((p) => p.kind === 'swiss');
      const codesOn = (liceId: string) =>
        units
          .find((u) => u.liceId === liceId)!
          .roleSlots[0]!.candidates.blocked.find((c) => c.personId === FIGHTER_REF_GLOBAL_ID)
          ?.reasons.map((r) => r.code);
      expect(codesOn('lice-1')).toEqual(['own_match']);
      expect(codesOn('lice-2')).toEqual(['fights_overlap', 'own_pool']);
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
    // `loadBoardRows` is private, so the spy needs a structural view of it. Cast
    // through `unknown` — TS2352 otherwise, per the repo's mock-chain note. The rest of
    // `loadContext` (the clock, the commitments) is the real one.
    type WithBoardRows = { loadBoardRows: (eventId: string) => Promise<unknown> };

    function stubContext(overrides: Record<string, unknown>) {
      return vi.spyOn(service as unknown as WithBoardRows, 'loadBoardRows').mockResolvedValue({
        eventId: 'event-1',
        eventStartDate: null,
        // Present because the real context carries it. The literal is cast
        // `as never`, so a missing field takes no type error — and a day index
        // asked for without a zone falls back to the runner's clock, which is
        // the bug the zone was threaded through to remove.
        eventTimezone: 'Europe/Paris',
        ruleSettings: DEFAULT_RULE_SETTINGS,
        tournaments: [],
        phases: [],
        pools: [],
        candidates: [],
        assignments: [],
        fighterRegistrationIdsByPerson: new Map(),
        slotConfigByTournament: new Map(),
        locked: false,
        ...overrides,
      } as never);
    }

    it('refuses on a locked board and deletes nothing', async () => {
      stubContext({ locked: true });

      await expect(service.applyPreview('event-1')).rejects.toBeInstanceOf(ConflictException);
      // The guard has to run BEFORE persistAssignments, not alongside it: the
      // delete is the first thing that method does.
      expect(fromMock).not.toHaveBeenCalledWith('referee_assignments');
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
     * Each Discouraged rule has its own switch, so a switched-off rule leaves no
     * amber row. Without this field the banner cannot tell "no conflicts" from
     * "nobody is checking", and the second one reads as safe.
     */
    it('reports a switched-off Discouraged rule rather than silently returning nothing', async () => {
      mockSettings.getSettings.mockResolvedValueOnce({
        ...DEFAULT_RULE_SETTINGS,
        enableOwnPoolSpanRule: false,
      });
      queueBoardReads();

      const slim = await service.getCrewConflicts('event-1');

      expect(slim.rules).toEqual({
        ownPool: true,
        ownPoolSpan: false,
        twoRoles: true,
        attendWorkshop: true,
        restSlots: 1,
        maxBoutsPerDay: 0,
      });
    });

    it('reports every rule on when every rule is on', async () => {
      queueBoardReads();
      const slim = await service.getCrewConflicts('event-1');
      expect(slim.rules).toEqual({
        ownPool: true,
        ownPoolSpan: true,
        twoRoles: true,
        attendWorkshop: true,
        restSlots: 1,
        maxBoutsPerDay: 0,
      });
    });

    it('re-judges an existing duty, and shows a confirmed-over reason grey (ruling 135)', async () => {
      // The fighter-referee holds a Declarant duty on their own Pool.
      const own = {
        id: 'own-pool-duty',
        person_id: FIGHTER_REF_GLOBAL_ID,
        pool_id: 'pool-1',
        match_id: null,
        role: 'arbitre_declarant',
        status: 'assigned',
        auto_assigned: false,
      };
      queueBoardReads([own]);
      const amber = await service.getCrewConflicts('event-1');
      queueBoardReads([
        { ...own, conflicts_jsonb: [{ code: 'own_pool', label: 'Longsword · Pool 1' }] },
      ]);
      const confirmed = await service.getCrewConflicts('event-1');

      expect(amber.conflicts).toEqual([
        expect.objectContaining({
          assignmentId: 'own-pool-duty',
          personName: 'Fighter Referee',
          unitName: 'Longsword · Pool 1',
          level: 'discouraged',
          reasons: [expect.objectContaining({ code: 'own_pool', confirmed: false })],
        }),
      ]);
      expect(confirmed.conflicts).toEqual([
        expect.objectContaining({
          level: 'fine',
          reasons: [expect.objectContaining({ code: 'own_pool', confirmed: true })],
        }),
      ]);
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

    // About the overlap alone: two Pools at two start times are also two day slots,
    // and rest (ADR-019) would add its own amber.
    beforeEach(() => {
      mockSettings.getSettings.mockResolvedValue({
        ...DEFAULT_RULE_SETTINGS,
        enforceRefereeNoBackToBack: false,
      });
    });
    const C_GLOBAL_ID = 'person-c-global';
    const D_GLOBAL_ID = 'person-d-global';

    /**
     * Two pools running at the same time on two pistes. Pool 1 holds match-1,
     * pool 2 holds match-2. Nobody fights in both — the only thing that can
     * collide here is a REFEREE.
     */
    function queueTwoOverlappingPools(
      assignments: unknown[],
      pool2At = '2026-05-21T10:00:00.000Z',
    ) {
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
                    scheduled_at: pool2At,
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
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // bracket phases
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // swiss phases
        .mockReturnValueOnce(makeChain({ data: [], error: null })); // workshops
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

    /** The 409 body of an Impossible refusal, or a failure naming what came back. */
    async function impossibleCodes(promise: Promise<unknown>): Promise<string[]> {
      const error = await promise.then(
        () => new Error('accepted'),
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as {
        code: string;
        level: string;
        reasons: Array<{ code: string }>;
      };
      expect(body).toMatchObject({ code: 'referee_impossible', level: 'impossible' });
      return body.reasons.map((r) => r.code);
    }

    it('refuses a referee already booked on an overlapping fight', async () => {
      queueTwoOverlappingPools([perMatchAssignment]);

      expect(
        await impossibleCodes(
          service.applyManual('event-1', {
            poolId: 'pool-2',
            role: 'arbitre_declarant',
            personId: POOL_2_REF,
          }),
        ),
      ).toEqual(['referees_overlap']);
    });

    it("refuses them when their fight's planned length runs into the pool they would referee", async () => {
      // match-1 runs 10:00–10:12 at its planned 12 minutes and pool 2 starts at
      // 10:08. Five minutes said match-1 was over at 10:05 and the referee free.
      resolveMatchLengthsMock.mockResolvedValueOnce(
        new Map([
          ['match-1', 12],
          ['match-2', 12],
        ]),
      );
      queueTwoOverlappingPools([perMatchAssignment], '2026-05-21T10:08:00.000Z');

      expect(
        await impossibleCodes(
          service.applyManual('event-1', {
            poolId: 'pool-2',
            role: 'arbitre_declarant',
            personId: POOL_2_REF,
          }),
        ),
      ).toEqual(['referees_overlap']);
    });

    it('accepts them when that fight is planned to end before the pool starts', async () => {
      // The same two pools, match-1 planned at 7 minutes: over at 10:07, before 10:08.
      resolveMatchLengthsMock.mockResolvedValueOnce(
        new Map([
          ['match-1', 7],
          ['match-2', 7],
        ]),
      );
      queueTwoOverlappingPools([perMatchAssignment], '2026-05-21T10:08:00.000Z');

      await expect(
        service.applyManual('event-1', {
          poolId: 'pool-2',
          role: 'arbitre_declarant',
          personId: POOL_2_REF,
        }),
      ).resolves.toBeDefined();
    });

    it('refuses them with the old double-booking switch off: an Impossible rule has none', async () => {
      // ADR-016: refereeing two places at once is Impossible, with no switch and
      // no override (hard rule 8). The legacy column still exists until W1.4; the
      // checker does not read it, and this pins that.
      mockSettings.getSettings.mockResolvedValueOnce({
        ...DEFAULT_RULE_SETTINGS,
        enableDoubleBookedRule: false,
        enableOfficiateVsFightRule: false,
        enableAvailabilityRule: false,
      });
      queueTwoOverlappingPools([perMatchAssignment]);

      expect(
        await impossibleCodes(
          service.applyManual('event-1', {
            poolId: 'pool-2',
            role: 'arbitre_declarant',
            personId: POOL_2_REF,
          }),
        ),
      ).toEqual(['referees_overlap']);
    });

    it('checkEvent reports a Pool-scoped crew whose referee fights at the same time', async () => {
      // The case the Pools page could not see: its old read took Match-scoped rows
      // only, and this crew is one Pool-scoped row on pool-2 while its referee fights
      // match-1 of pool-1 at 10:00. The real checker, over the whole loaded Event.
      queueTwoOverlappingPools([
        {
          id: 'pool-crew',
          person_id: FIGHTER_REF_GLOBAL_ID,
          pool_id: 'pool-2',
          match_id: null,
          role: 'arbitre_declarant',
          status: 'assigned',
          auto_assigned: false,
        },
      ]);

      const { conflicts, units } = await service.checkEvent('event-1');

      expect(units.map((u) => u.id)).toEqual(['pool-1', 'pool-2']);
      expect(conflicts).toEqual([
        expect.objectContaining({
          assignmentId: 'pool-crew',
          unitId: 'pool-2',
          level: 'impossible',
          reasons: [
            expect.objectContaining({
              code: 'fights_overlap',
              against: expect.objectContaining({ kind: 'match', id: 'match-1' }),
            }),
          ],
        }),
      ]);
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

  // ── The day a Pool falls on is the EVENT's day ────────────────────────────
  //
  // One instant, two events, two timezones on opposite sides of UTC. A server
  // clock cannot tell them apart, so the DIFFERENCE between the two boards is
  // the assertion — which makes these red under every runner zone rather than
  // only under the one that happens to disagree with the container.
  describe('per-day availability is bucketed on the event timezone', () => {
    /** 22:00Z on 21 May: midday on the 22nd in Kiritimati (UTC+14), evening of
     *  the 21st in New York (UTC-4). */
    const INSTANT = '2026-05-21T22:00:00.000Z';
    /** The pure referee is allowlisted for day 1 and no other day. */
    const DAY_ONE_ONLY = [{ person_id: PURE_REF_GLOBAL_ID, day_index: 1 }];

    function queueEventIn(timezone: string) {
      queueBoardReads([], {
        event: { start_date: '2026-05-21', timezone },
        matchScheduledAt: INSTANT,
        refereeDays: DAY_ONE_ONLY,
      });
    }

    /** Whoever ended up holding a slot chip on the board. */
    function assignedPersonIds(board: Awaited<ReturnType<AssignmentBoardService['getBoard']>>) {
      return board.pools
        .flatMap((pool) => pool.roleSlots)
        .map((slot) => slot.assignment?.personId)
        .filter((personId): personId is string => Boolean(personId));
    }

    /** Every blocked-reason the board recorded for one candidate, any slot. */
    function blockedReasons(board: Awaited<ReturnType<AssignmentBoardService['getBoard']>>) {
      return board.pools
        .flatMap((pool) => pool.roleSlots)
        .flatMap((slot) => slot.candidates.blocked)
        .filter((candidate) => candidate.personId === PURE_REF_GLOBAL_ID)
        .flatMap((candidate) => candidate.reasons.map((reason) => reason.code));
    }

    it('getBoard blocks the referee on one event and not the other', async () => {
      queueEventIn('Pacific/Kiritimati');
      const east = await service.getBoard('event-1');
      queueEventIn('America/New_York');
      const west = await service.getBoard('event-1');

      // Kiritimati: the Pool is on day 1, which the referee declared.
      expect(blockedReasons(east)).not.toContain('outside_availability');
      // New York: the same instant is still day 0, which they did not.
      expect(blockedReasons(west)).toContain('outside_availability');
      // The mock ignores the projection, so the column has to be asserted by
      // name — deleting it from the read leaves every value assertion green.
      expect(selectsFor(fromMock as never, 'events')[0]).toContain('timezone');
    });

    it('the engine drops the referee only when the event day is outside their availability', async () => {
      queueEventIn('Pacific/Kiritimati');
      const east = await service.previewBoard('event-1');
      queueEventIn('America/New_York');
      const west = await service.previewBoard('event-1');

      expect(assignedPersonIds(east)).toContain(PURE_REF_GLOBAL_ID);
      expect(assignedPersonIds(west)).not.toContain(PURE_REF_GLOBAL_ID);
      // Name the rule that dropped them, on the slot only they can fill: the checker's code.
      const table = west.pools
        .flatMap((pool) => pool.roleSlots)
        .find((slot) => slot.role === 'arbitre_table');
      expect(table?.missingReasons).toEqual(['outside_availability']);
    });
  });
});
