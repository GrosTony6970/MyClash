import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import {
  FIELD_OF_FOUR,
  OTHER_PHASE,
  asSupabase as as,
  bout,
  entrant,
  phaseRow,
  readState,
  swissConfig as config,
  swissRound,
} from './swiss.fixtures';
import { SwissPairingService } from './swiss-pairing.service';

const fighters = (plan: { pairings: Array<{ aId: string; bId: string }> }) =>
  plan.pairings.flatMap((pairing) => [pairing.aId, pairing.bId]).sort();

describe('SwissPairingService — loading a phase', () => {
  it('answers null for a phase that is not Swiss, without reading anything else', async () => {
    const supabase = mockSupabase(readState({ phases: { rows: [phaseRow({ type: 'pool' })] } }));
    const service = new SwissPairingService(as(supabase));

    await expect(service.loadContext('p1')).resolves.toBeNull();
    // Stops at phases — entrants and rounds are never asked for.
    expect(queriedTables(supabase.from)).toEqual(['phases']);
  });

  it('refuses a Swiss phase whose config does not parse', async () => {
    const supabase = mockSupabase(
      readState({ phases: { rows: [phaseRow({ config_json: { nope: true } })] } }),
    );
    const service = new SwissPairingService(as(supabase));

    await expect(service.loadContext('p1')).rejects.toThrow(BadRequestException);
    await expect(service.loadContext('p1')).rejects.toThrow(/invalid config/);
  });

  it('takes only this phase’s entrants and rounds', async () => {
    // Every table below also holds a row belonging to the other Swiss phase.
    // A lost scope would deal another tournament’s fighter into this draw.
    const supabase = mockSupabase(
      readState({
        swiss_rounds: {
          rows: [swissRound(), swissRound({ id: 'sr-other', phase_id: 'p2', round_number: 1 })],
        },
      }),
    );
    const service = new SwissPairingService(as(supabase));

    const context = await service.loadContext('p1');

    expect(context).toMatchObject({ phaseId: 'p1', tournamentId: 't1' });
    expect(context?.entrants.map((e) => e.registrationId)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(context?.rounds.map((r) => r.id)).toEqual(['sr-old']);
  });

  it('reports a missing phase as not found', async () => {
    const supabase = mockSupabase(readState({ phases: { rows: [OTHER_PHASE] } }));
    const service = new SwissPairingService(as(supabase));

    await expect(service.requireContext('p1')).rejects.toThrow(NotFoundException);
  });
});

describe('SwissPairingService — planning a round', () => {
  it('pairs the whole field for the first round', async () => {
    const supabase = mockSupabase(readState());
    const service = new SwissPairingService(as(supabase));

    const planned = await service.planNextRound('p1');

    expect(planned?.roundNumber).toBe(1);
    expect(planned?.plan.pairings).toHaveLength(2);
    // Everyone fights, nobody twice, and an even field needs no bye.
    expect(fighters(planned!.plan)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(planned?.plan.byeRegistrationId).toBeNull();
  });

  it('leaves a withdrawn fighter out of the draw', async () => {
    // Five entrants, one withdrawn before round 1. Their played results stand,
    // but they are not dealt in again — so the field is four and even, and the
    // bye that an odd field would need does not appear.
    const supabase = mockSupabase(
      readState({
        swiss_entrants: { rows: [...FIELD_OF_FOUR, entrant('r5', 'p1', 1)] },
      }),
    );
    const service = new SwissPairingService(as(supabase));

    const planned = await service.planNextRound('p1');

    expect(fighters(planned!.plan)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(planned?.plan.byeRegistrationId).toBeNull();
  });

  it('gives the bye when the field is odd', async () => {
    const supabase = mockSupabase(
      readState({ swiss_entrants: { rows: [...FIELD_OF_FOUR, entrant('r5')] } }),
    );
    const service = new SwissPairingService(as(supabase));

    const planned = await service.planNextRound('p1');

    expect(planned?.plan.pairings).toHaveLength(2);
    expect(planned?.plan.byeRegistrationId).not.toBeNull();
    // The bye is a place in the round, not an exclusion from it.
    expect([...fighters(planned!.plan), planned!.plan.byeRegistrationId]).toHaveLength(5);
  });

  it('stops once every configured round has been paired', async () => {
    const supabase = mockSupabase(
      readState({
        phases: { rows: [phaseRow({ config_json: config(3) }), OTHER_PHASE] },
        swiss_rounds: {
          rows: [
            swissRound({ id: 'sr1', round_number: 1 }),
            swissRound({ id: 'sr2', round_number: 2 }),
            swissRound({ id: 'sr3', round_number: 3 }),
          ],
        },
      }),
    );
    const service = new SwissPairingService(as(supabase));

    await expect(service.planNextRound('p1')).resolves.toBeNull();
  });

  it('refuses to pair on top of a round somebody is missing from', async () => {
    // `setMatchSides` is the escape hatch that can produce this: it writes
    // whoever it is told to. Pairing the next round from here would carry the
    // error into every later round's opponent lists, permanently.
    const supabase = mockSupabase(
      readState({
        swiss_rounds: {
          rows: [
            swissRound({
              matches: [bout('m1', 'r1', 'r2')],
            }),
          ],
        },
      }),
    );
    const service = new SwissPairingService(as(supabase));

    await expect(service.planNextRound('p1')).rejects.toThrow(ConflictException);
    await expect(service.planNextRound('p1')).rejects.toThrow(/not in the round: r3, r4/);
  });

  it('checks the LAST round, not whichever row came back last', async () => {
    // Only the last round is re-litigated; earlier ones have been carried and
    // blocking a phase over history nobody can change would be worse. So which
    // round counts as "last" is decided by the round number, not by the order
    // Postgres happened to return the rows in — seeded here in reverse.
    const supabase = mockSupabase(
      readState({
        swiss_rounds: {
          rows: [
            swissRound({
              id: 'sr2',
              round_number: 2,
              matches: [bout('m3', 'r1', 'r2')],
            }),
            swissRound({
              id: 'sr1',
              round_number: 1,
              matches: [bout('m1', 'r1', 'r2'), bout('m2', 'r3', 'r4')],
            }),
          ],
        },
      }),
    );
    const service = new SwissPairingService(as(supabase));

    // Round 1 is a complete, legal round. Round 2 is the broken one.
    await expect(service.planNextRound('p1')).rejects.toThrow(/^Round 2 is not a valid/);
  });

  it('refuses to pair on top of a round somebody fought twice in', async () => {
    const supabase = mockSupabase(
      readState({
        swiss_rounds: {
          rows: [
            swissRound({
              matches: [bout('m1', 'r1', 'r2'), bout('m2', 'r1', 'r3')],
            }),
          ],
        },
      }),
    );
    const service = new SwissPairingService(as(supabase));

    await expect(service.planNextRound('p1')).rejects.toThrow(/fighting twice: r1/);
  });
});
