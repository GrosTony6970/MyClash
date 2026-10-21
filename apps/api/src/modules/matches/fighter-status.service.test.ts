import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import {
  CLUB_START_FORFEIT_RULES,
  FFAMHE_FORFEIT_RULES,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import { mockSupabase, type ChainResult } from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { PenaltiesService } from '../penalties/penalties.service';
import { FighterStatusService, isEntryStatusChanged } from './fighter-status.service';
import { settleRpc, type SettleCall } from './fighter-status.fixtures';
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

function settler(seed: Parameters<typeof mockSupabase>[0], answer?: ChainResult) {
  const calls: SettleCall[] = [];
  const db = mockSupabase(
    seed,
    settleRpc(calls, () => db.writes, answer),
  );
  return { service: new FighterStatusService(db as never), calls };
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
    const { service } = settler(tournamentUnder(FFAMHE_FORFEIT_RULES), {
      data: { before: 'checked_in', after: 'withdrawn' },
      error: null,
    });
    await expect(service.settle(FIGHTER)).resolves.toEqual({
      before: 'checked_in',
      after: 'withdrawn',
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
