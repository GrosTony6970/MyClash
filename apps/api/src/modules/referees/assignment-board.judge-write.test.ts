/**
 * `AssignmentBoardService.judgeWrite` — the question every other write door asks (W1.2):
 * the per-bout and per-Pool crew of the Pools page and the AI assistant's apply.
 *
 * Only the board's row read is stubbed: the commitments, the targets and the checker are
 * the real ones, so each case is a rule actually firing on a real Pool.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { AssignmentBoardService, type RefereeWrite } from './assignment-board.service';

const RULES = {
  enableOwnPoolRule: true,
  enableOwnPoolSpanRule: true,
  enableTwoRolesRule: true,
  workshopConflictWarning: true,
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  maxBoutsPerDay: 0,
};

const bout = (id: string, at: string, red: string, blue: string) => ({
  id,
  scheduledAt: `2026-05-21T${at}:00.000Z`,
  durationMinutes: 5,
  liceId: 'lice-1',
  redRegistrationId: red,
  blueRegistrationId: blue,
});

const pool = (id: string, name: string, matches: ReturnType<typeof bout>[]) => ({
  id,
  name,
  tournamentId: 't-1',
  tournamentName: 'Longsword',
  liceId: 'lice-1',
  scheduledStart: null,
  scheduledEnd: null,
  kind: 'pool' as const,
  members: [],
  matches,
  roleSlots: [],
});

/** Léa fights m-1 (10:00) and m-3 (10:10) of Pool A; Pool B's m-4 is at 10:00 on another piste. */
const POOL_A = pool('pool-a', 'Pool A', [
  bout('m-1', '10:00', 'reg-lea', 'reg-ben'),
  bout('m-2', '10:05', 'reg-ben', 'reg-cleo'),
  bout('m-3', '10:10', 'reg-lea', 'reg-cleo'),
]);
const POOL_B = pool('pool-b', 'Pool B', [bout('m-4', '10:00', 'reg-dan', 'reg-eve')]);

const candidate = (personId: string, roles: string[]) => ({
  personId,
  userId: null,
  displayName: personId,
  clubLabel: null,
  qualifications: roles.map((role) => ({ role, rating: null })),
});

const ROWS = {
  eventId: 'event-1',
  eventStartDate: '2026-05-21',
  eventTimezone: 'UTC',
  ruleSettings: RULES,
  tournaments: [],
  phases: [],
  pools: [POOL_A, POOL_B],
  candidates: [
    candidate('lea', ['arbitre_declarant']),
    candidate('ref', ['arbitre_declarant']),
    candidate('tablist', ['arbitre_table']),
  ],
  assignments: [],
  fighterRegistrationIdsByPerson: new Map([
    ['lea', ['reg-lea']],
    ['ben', ['reg-ben']],
    ['cleo', ['reg-cleo']],
    ['dan', ['reg-dan']],
    ['eve', ['reg-eve']],
  ]),
  slotConfigByTournament: new Map(),
  locked: false,
};

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

const write = (over: Partial<RefereeWrite> & object): RefereeWrite =>
  ({ personId: 'lea', role: 'arbitre_declarant', confirm: false, ...over }) as RefereeWrite;

describe('AssignmentBoardService.judgeWrite', () => {
  let service: AssignmentBoardService;

  beforeEach(() => {
    service = new AssignmentBoardService(
      mockSupabase({ workshops: { rows: [] } }) as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(
      service as unknown as { loadBoardRows: (eventId: string) => Promise<unknown> },
      'loadBoardRows',
    ).mockResolvedValue(ROWS);
  });

  const refusal = (w: RefereeWrite) =>
    service.judgeWrite('event-1', w).then(unexpected, (e: unknown) => e as ConflictException);

  it('refuses a person off the roster 400, before any rule', async () => {
    await expect(
      service.judgeWrite('event-1', write({ personId: 'ben', matchIds: ['m-4'] })),
    ).rejects.toThrow(new BadRequestException('Selected referee is not on this event roster'));
  });

  it('refuses a person without the role 400', async () => {
    await expect(
      service.judgeWrite('event-1', write({ personId: 'tablist', matchIds: ['m-4'] })),
    ).rejects.toThrow(new BadRequestException('Selected referee is not qualified for this role'));
  });

  it('refuses a fighter on her own bout: own_match, Impossible, confirm or not', async () => {
    const error = await refusal(write({ matchIds: ['m-1'], confirm: true }));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      code: 'referee_impossible',
      message: 'This referee cannot take this slot: own_match (Longsword · Pool A)',
      level: 'impossible',
    });
  });

  it('refuses a bout of another Pool at the time she fights: fights_overlap', async () => {
    const error = await refusal(write({ matchIds: ['m-4'], confirm: true }));
    expect(error.getResponse()).toMatchObject({
      code: 'referee_impossible',
      reasons: [expect.objectContaining({ code: 'fights_overlap' })],
    });
  });

  it('asks to confirm a bout of her own Pool she does not fight, then stores the reason', async () => {
    const error = await refusal(write({ matchIds: ['m-2'] }));
    expect(error.getResponse()).toMatchObject({
      code: 'referee_needs_confirmation',
      message: 'Assigning this referee needs confirmation: own_pool (Longsword · Pool A)',
    });

    await expect(
      service.judgeWrite('event-1', write({ matchIds: ['m-2'], confirm: true })),
    ).resolves.toEqual({
      stored: [{ code: 'own_pool', label: 'Longsword · Pool A' }],
      matchIds: ['m-2'],
      skippedMatchIds: [],
    });
  });

  it('a Pool crew leaves out her own bouts, so the own-Pool confirm is reachable', async () => {
    const all = ['m-1', 'm-2', 'm-3'];
    // Judged with her own bouts, the write is Impossible.
    const whole = await refusal(write({ matchIds: all, confirm: true }));
    expect(whole.getResponse()).toMatchObject({ code: 'referee_impossible' });

    await expect(
      service.judgeWrite('event-1', write({ matchIds: all, skipOwnBouts: true, confirm: true })),
    ).resolves.toEqual({
      stored: [{ code: 'own_pool', label: 'Longsword · Pool A' }],
      matchIds: ['m-2'],
      skippedMatchIds: ['m-1', 'm-3'],
    });
  });

  it('lets a free referee through with nothing to store', async () => {
    await expect(
      service.judgeWrite('event-1', write({ personId: 'ref', matchIds: ['m-1', 'm-2'] })),
    ).resolves.toEqual({ stored: [], matchIds: ['m-1', 'm-2'], skippedMatchIds: [] });
  });

  it("judges each bout with the write's other bouts: two pistes at once is Impossible", async () => {
    // m-1 (Pool A) and m-4 (Pool B) both start at 10:00 on two pistes.
    const error = await refusal(
      write({ personId: 'ref', matchIds: ['m-1', 'm-4'], confirm: true }),
    );
    expect(error.getResponse()).toMatchObject({
      code: 'referee_impossible',
      reasons: [
        expect.objectContaining({
          code: 'referees_overlap',
          against: expect.objectContaining({ id: 'pool-b' }),
        }),
        expect.objectContaining({
          code: 'referees_overlap',
          against: expect.objectContaining({ id: 'pool-a' }),
        }),
      ],
    });
  });

  it('refuses a crew for two bouts of one Pool dragged to two pistes at the same time', async () => {
    // Pool D's two bouts both start at 11:00: one crew cannot stand on both pistes.
    const poolD = pool('pool-d', 'Pool D', [
      { ...bout('m-5', '11:00', 'reg-ben', 'reg-cleo'), liceId: 'lice-1' },
      { ...bout('m-6', '11:00', 'reg-dan', 'reg-eve'), liceId: 'lice-2' },
    ]);
    vi.spyOn(
      service as unknown as { loadBoardRows: (eventId: string) => Promise<unknown> },
      'loadBoardRows',
    ).mockResolvedValue({ ...ROWS, pools: [POOL_A, POOL_B, poolD] });
    const error = await refusal(
      write({ personId: 'ref', matchIds: ['m-5', 'm-6'], confirm: true }),
    );
    expect(error.getResponse()).toMatchObject({
      code: 'referee_impossible',
      reasons: [expect.objectContaining({ code: 'referees_overlap' })],
    });
  });

  it("counts the whole crew against the day's bout cap, not one bout at a time", async () => {
    vi.spyOn(
      service as unknown as { loadBoardRows: (eventId: string) => Promise<unknown> },
      'loadBoardRows',
    ).mockResolvedValue({ ...ROWS, ruleSettings: { ...RULES, maxBoutsPerDay: 2 } });
    const crew = write({ personId: 'ref', matchIds: ['m-1', 'm-2', 'm-3'] });
    const error = await refusal(crew);
    expect(error.getResponse()).toMatchObject({
      code: 'referee_needs_confirmation',
      reasons: [
        {
          code: 'cap',
          level: 'discouraged',
          against: { kind: 'day', id: '0', label: '3' },
          confirmed: false,
        },
      ],
    });
    await expect(service.judgeWrite('event-1', { ...crew, confirm: true })).resolves.toEqual({
      stored: [{ code: 'cap', label: '3' }],
      matchIds: ['m-1', 'm-2', 'm-3'],
      skippedMatchIds: [],
    });
  });

  it('judges a whole Pool as the board does (the AI door)', async () => {
    const error = await refusal(write({ poolId: 'pool-a' }));
    expect(error.getResponse()).toMatchObject({ code: 'referee_needs_confirmation' });
    await expect(
      service.judgeWrite('event-1', write({ personId: 'ref', poolId: 'pool-a' })),
    ).resolves.toEqual({ stored: [], matchIds: [], skippedMatchIds: [] });
  });

  it("the board's Assign answers 409 referee_board_locked while the board is locked", async () => {
    vi.spyOn(
      service as unknown as { loadBoardRows: (eventId: string) => Promise<unknown> },
      'loadBoardRows',
    ).mockResolvedValue({ ...ROWS, locked: true });
    const error = await service
      .applyManual('event-1', { poolId: 'pool-a', role: 'arbitre_declarant', personId: 'ref' })
      .then(unexpected, (e: unknown) => e as ConflictException);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
  });

  it.each([
    ['bout', write({ personId: 'ref', matchIds: ['m-elsewhere'] }), /Match m-elsewhere/],
    ['Pool', write({ personId: 'ref', poolId: 'pool-elsewhere' }), /Pool pool-elsewhere/],
  ])('a %s the board does not hold is a plain Error, never judged fine', async (_l, w, text) => {
    const failure = service.judgeWrite('event-1', w);
    await expect(failure).rejects.toThrow(text);
    await expect(failure).rejects.not.toHaveProperty('status');
  });
});
