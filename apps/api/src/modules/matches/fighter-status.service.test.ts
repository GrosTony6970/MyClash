import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import {
  CLUB_START_FORFEIT_RULES,
  FFAMHE_FORFEIT_RULES,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { PenaltiesService } from '../penalties/penalties.service';
import { isEntryStatusChanged } from './fighter-status.service';
import { fighterStatusOver, settleRpc, swissRpc, type SettleCall } from './fighter-status.fixtures';
import { MatchForfeitsService } from './match-forfeits.service';

/**
 * What the API asks `settle_fighter_status` (migration 0240): the Fighter, the rules in force as
 * the database reads them, the server's clock and the hand's change; and what its refusals become.
 * What the database ANSWERS is probe check 16's, on a replayed Postgres.
 */

/** A Tournament under the built-in penalty ruleset holding `rules` and the two card settings. */
const tournamentUnder = (rules: unknown, first = 'match', second = 'tournament') => ({
  tournaments: { rows: [{ id: 't1', event_id: 'e1', penalty_ruleset_id: null }] },
  events: { rows: [{ id: 'e1', penalty_ruleset_id: null }] },
  penalty_rulesets: {
    rows: [
      {
        id: 'built-in',
        built_in: true,
        owner_organization_id: null,
        first_black_card_forfeit: first,
        second_black_card_forfeit: second,
        forfeit_rules: rules,
      },
    ],
  },
});

/** A Fighter who is in, with nothing forfeited: the bouts have nothing to follow. */
const IN_WITH_NOTHING = {
  registrations: {
    rows: [{ id: 'reg-1', tournament_id: 't1', status: 'checked_in', out_since: null }],
  },
  match_forfeits: { rows: [] },
  // In no Swiss phase: nothing to put back in the pairings.
  swiss_entrants: { rows: [] },
};

function settler(seed: Parameters<typeof mockSupabase>[0], answer?: ChainResult) {
  const calls: SettleCall[] = [];
  const db = mockSupabase(
    { ...IN_WITH_NOTHING, ...seed },
    settleRpc(calls, () => db.writes, answer),
  );
  return { service: fighterStatusOver(db), calls };
}

const FIGHTER = { registrationId: 'reg-1', tournamentId: 't1' };

afterEach(() => {
  vi.useRealTimers();
});

describe('what a settle asks the database', () => {
  it('names every parameter the function is defined with, and no other', async () => {
    const { service, calls } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES));
    await service.settle(FIGHTER);
    expect(Object.keys(calls[0]!.args).sort()).toEqual(
      [...lastFunctionParams('settle_fighter_status')].sort(),
    );
    expect(calls[0]!.args['p_registration']).toBe('reg-1');
  });

  it('hands it the Tournament’s rules in force, as the database reads them', async () => {
    const { service, calls } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES));
    await service.settle(FIGHTER);
    expect(calls[0]!.args['p_rules']).toEqual({
      disqualifyAfter: 2,
      firstCardOut: false,
      secondCardOut: true,
      countedReasons: ['injury', 'voluntary', 'conduct_violation'],
    });
  });

  it('"disqualify after" off is null, and each card says whether it puts the Fighter out', async () => {
    const rules: ForfeitRules = CLUB_START_FORFEIT_RULES;
    const { service, calls } = settler(tournamentUnder(rules, 'tournament', 'match'));
    await service.settle(FIGHTER);
    expect(calls[0]!.args['p_rules']).toMatchObject({
      disqualifyAfter: null,
      firstCardOut: true,
      secondCardOut: false,
    });
  });

  it('takes the rules a door read as they are, and reads none', async () => {
    // No table is seeded: a read would throw.
    const { service, calls } = settler({});
    await service.settle({
      ...FIGHTER,
      rules: {
        ...FFAMHE_FORFEIT_RULES,
        disqualifyAfter: 7,
        firstBlackCard: 'none',
        secondBlackCard: 'none',
      },
    });
    expect(calls[0]!.args['p_rules']).toMatchObject({ disqualifyAfter: 7, secondCardOut: false });
  });

  it('dates the spell out by the server’s clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-02-03T04:05:06.789Z'));
    const { service, calls } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES));
    await service.settle(FIGHTER);
    expect(calls[0]!.args['p_now']).toBe('2031-02-03T04:05:06.789Z');
  });

  it('a settle with no hand change keeps the hand', async () => {
    const { service, calls } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES));
    await service.settle(FIGHTER);
    expect(calls[0]!.args).toMatchObject({
      p_entry_status: null,
      p_expected_entry_status: null,
      p_clear_waitlist: false,
    });
  });

  it('a hand change names the new hand and the one its door read', async () => {
    const { service, calls } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES));
    await service.settle({ ...FIGHTER, entry: { status: 'withdrawn', expected: 'checked_in' } });
    await service.settle({
      ...FIGHTER,
      entry: { status: 'registered', expected: 'waitlist', clearWaitlist: true },
    });
    expect(calls.map((call) => call.args)).toMatchObject([
      {
        p_entry_status: 'withdrawn',
        p_expected_entry_status: 'checked_in',
        p_clear_waitlist: false,
      },
      { p_entry_status: 'registered', p_expected_entry_status: 'waitlist', p_clear_waitlist: true },
    ]);
  });

  it('answers what the database answered: the status before and after', async () => {
    // What the bouts did after it is the reconcile's (`fighter-reconcile.*.test.ts`): nothing,
    // for a Fighter the seed has in with no forfeit.
    const { service } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES), {
      data: { before: 'checked_in', after: 'withdrawn' },
      error: null,
    });
    await expect(service.settle(FIGHTER)).resolves.toEqual({
      before: 'checked_in',
      after: 'withdrawn',
      forfeited: 0,
      broughtBack: 0,
    });
  });
});

describe('a service that settles is never built without the settle', () => {
  // Nest injects it as any required dependency; only a hand construction can miss it, and it
  // throws rather than leave a door that changes a cause and settles nobody.
  it.each([
    ['MatchForfeitsService', () => new MatchForfeitsService({} as never)],
    ['PenaltiesService', () => new PenaltiesService({} as never)],
  ])('%s', (name, build) => {
    expect(build).toThrow(`${name} needs the FighterStatusService`);
  });
});

describe('what a refused settle becomes', () => {
  const refusedWith = (error: { code: string; message: string }) =>
    settler(tournamentUnder(FFAMHE_FORFEIT_RULES), { data: null, error }).service.settle(FIGHTER);

  it('an entry changed since its door read it is a 409 that names it', async () => {
    const refusal = await refusedWith({
      code: 'P0001',
      message: 'entry_status_changed: registration reg-1 is registered, not waitlist',
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: 'entry_status_changed',
    });
    expect(isEntryStatusChanged(refusal)).toBe(true);
  });

  it('a Registration that is not there is a 404', async () => {
    await expect(
      refusedWith({ code: 'P0002', message: 'registration reg-1 not found' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    { code: '23514', message: 'violates check constraint "registrations_status_follows_entry"' },
    { code: 'P0001', message: 'some other refusal' },
    { code: '57014', message: 'canceling statement due to statement timeout' },
  ])('anything else is a server error, never a 4xx: $code', async (error) => {
    const refusal = await refusedWith(error).catch((caught: unknown) => caught);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toBeInstanceOf(HttpException);
    expect(isEntryStatusChanged(refusal)).toBe(false);
  });

  it('rules that do not parse are the worded 409 of a forfeit recorded by hand', async () => {
    const { service, calls } = settler(tournamentUnder({ disqualifyAfter: 'twice' }));
    const refusal = await service.settle(FIGHTER).catch((error: unknown) => error);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: 'forfeit_rules_invalid',
    });
    expect(calls).toEqual([]);
  });
});

describe('a Swiss phase reopened (rulings 127, 129)', () => {
  const fighter = (id: string, status: string) => ({
    id,
    tournament_id: 't1',
    status,
    out_since: status === 'withdrawn' ? '2026-10-21T10:00:00.000Z' : null,
  });
  const entrant = (registration: string, phase = 'p1', withdrawnBy: string | null = null) => ({
    phase_id: phase,
    registration_id: registration,
    withdrawn_by: withdrawnBy,
  });

  /**
   * Back in but still withdrawn by status (read first), out, plainly in, and out in another phase.
   * `answers`: functions that answer otherwise than the recording doubles.
   */
  function reopened(answers: Record<string, (args: Record<string, unknown>) => ChainResult> = {}) {
    // One record of every call, the settles and the Swiss functions (each named by its `fn`).
    const sequence: SettleCall[] = [];
    const db = mockSupabase(
      {
        ...IN_WITH_NOTHING,
        ...tournamentUnder(CLUB_START_FORFEIT_RULES),
        registrations: {
          rows: [
            fighter('reg-back', 'checked_in'),
            fighter('reg-out', 'withdrawn'),
            fighter('reg-in', 'checked_in'),
            fighter('reg-elsewhere', 'withdrawn'),
          ],
        },
        swiss_entrants: {
          rows: [
            entrant('reg-out'),
            entrant('reg-back', 'p1', 'status'),
            entrant('reg-in'),
            entrant('reg-elsewhere', 'p2'),
          ],
        },
        phases: { rows: [] },
      },
      {
        ...settleRpc(sequence, () => db.writes),
        ...swissRpc(sequence, () => db.writes),
        ...answers,
      },
    );
    const named = () =>
      sequence
        .filter((call) => call.args['fn'] !== 'swiss_phase_over')
        .map(({ args }) => `${(args['fn'] as string) ?? 'settle'} ${args['p_registration']}`);
    return { service: fighterStatusOver(db), named, db };
  }

  it('settles the Fighters the phase did not follow while over, and no one else', async () => {
    const { service, named, db } = reopened();
    await service.followReopenedSwissPhase('p1', 't1', { userId: 'u1' });
    const settled = named().filter((call) => call.startsWith('settle'));
    expect(settled).toEqual(['settle reg-out', 'settle reg-back']);
    // The double returns whole rows: the entrants, their kind and their statuses read by name.
    expect(selectsFor(db.from, 'swiss_entrants')[0]).toBe('registration_id, withdrawn_by');
    expect(selectsFor(db.from, 'registrations')[0]).toBe('id, status');
    // The rules in force are read once for them all (every Save sends the round count).
    expect(queriedTables(db.from).filter((table) => table === 'tournaments')).toHaveLength(1);
  });

  it('moves every pairing first, then settles those out before those back in (127, 129, 131)', async () => {
    // Back in read first: whichever order the rows come in, every pairing has moved before a
    // settle can forfeit, and the Fighters out are settled first, in the order they went out.
    const { service, named } = reopened();
    await service.followReopenedSwissPhase('p1', 't1', { userId: 'u1' });
    expect(named().slice(0, 3)).toEqual([
      'swiss_withdraw reg-out',
      'swiss_put_back reg-back',
      'settle reg-out',
    ]);
  });

  it('tries every Fighter, then fails as a 5xx: a resend repairs who did not follow', async () => {
    const seen: unknown[] = [];
    const { service } = reopened({
      settle_fighter_status: (args) => {
        seen.push(args['p_registration']);
        // A 404 of one settle (a Registration gone meanwhile) is folded in, never the answer.
        return args['p_registration'] === 'reg-back'
          ? { data: null, error: { code: 'P0002', message: 'registration not found' } }
          : { data: { before: 'checked_in', after: 'checked_in' }, error: null };
      },
    });
    const refusal = await service
      .followReopenedSwissPhase('p1', 't1', { userId: 'u1' })
      .catch((error: unknown) => error);
    expect(seen).toEqual(['reg-out', 'reg-back']);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).not.toBeInstanceOf(HttpException);
    expect((refusal as Error).message).toContain('reg-back');
  });

  it('still settles a Fighter whose pairing could not move first: the settle moves it again', async () => {
    const { service, named } = reopened({
      swiss_put_back: () => ({
        data: null,
        error: { code: '57014', message: 'statement timeout' },
      }),
    });
    const refusal = await service
      .followReopenedSwissPhase('p1', 't1', { userId: 'u1' })
      .catch((error: unknown) => error);
    expect(named()).toContain('settle reg-back');
    expect((refusal as Error).message).toContain('reg-back');
  });
});
