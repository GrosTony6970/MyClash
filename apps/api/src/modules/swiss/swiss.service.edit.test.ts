import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { asSupabase as as, phaseRow, swissConfig, swissRound } from './swiss.fixtures';
import { SwissPairingService } from './swiss-pairing.service';
import type { SwissSeedingService } from './swiss-seeding.service';
import { parseSwissConfig } from './dto/swiss-config.dto';
import type { UpdateSwissConfigDto } from './dto/swiss.dto';
import { SwissService } from './swiss.service';

/**
 * Editing a phase that already exists: changing its config, and withdrawing a
 * fighter from it. Both read the phase through the real pairing context, so
 * the rounds already generated are what the refusals are measured against.
 */
const entrant = (registrationId: string, withdrawnAtRound: number | null = null): SupabaseRow => ({
  phase_id: 'p1',
  registration_id: registrationId,
  withdrawn_at_round: withdrawnAtRound,
});

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase({
    phases: { rows: [phaseRow()] },
    swiss_entrants: { rows: [entrant('r1'), entrant('r2')] },
    swiss_rounds: { rows: [swissRound({ id: 'sr1', round_number: 1, status: 'completed' })] },
    audit_log: { rows: [] as SupabaseRow[] },
    ...over,
  });
  const service = new SwissService(
    as(supabase),
    new SwissPairingService(as(supabase)),
    {} as SwissSeedingService,
  );
  return { supabase, service };
};

/** Two rounds generated, which is where the retroactive edits freeze. */
const twoRounds = {
  swiss_rounds: {
    rows: [
      swissRound({ id: 'sr1', round_number: 1, status: 'completed' }),
      swissRound({ id: 'sr2', round_number: 2, status: 'pending' }),
    ],
  },
};

const dto = (over: Partial<UpdateSwissConfigDto>) => over as UpdateSwissConfigDto;

/** The config as it was actually written back to the phase. */
const writtenConfig = (supabase: { writes: Parameters<typeof writesTo>[0]['writes'] }) =>
  (writesTo(supabase, 'phases')[0]?.row as { config_json?: unknown })?.config_json;

describe('SwissService.updateConfig — what a live phase will still accept', () => {
  it('changes what nobody has played on yet', async () => {
    const { supabase, service } = build();

    const next = await service.updateConfig('p1', dto({ pairingMethod: 'adjacent' }), 'u1');

    expect(next.pairingMethod).toBe('adjacent');
    expect(parseSwissConfig(writtenConfig(supabase))?.pairingMethod).toBe('adjacent');
  });

  it('keeps every setting the request did not mention', async () => {
    // A partial edit must not reset the rest of the config to its defaults.
    const { supabase, service } = build();

    await service.updateConfig('p1', dto({ roundCount: 7 }), 'u1');

    expect(parseSwissConfig(writtenConfig(supabase))).toMatchObject({
      roundCount: 7,
      pairingMethod: swissConfig().pairingMethod,
      tiebreakChain: swissConfig().tiebreakChain,
    });
  });

  it('refuses to change what the played rounds were worth', async () => {
    // pairingMethod, points and grouping all retroactively change the value of
    // rounds already fought, so past round 2 they are frozen.
    const { supabase, service } = build(twoRounds);

    await expect(
      service.updateConfig('p1', dto({ points: { win: 2, draw: 1, loss: 0, bye: 2 } }), 'u1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writesTo(supabase, 'phases')).toHaveLength(0);
  });

  it('names every frozen setting the request tried to change', async () => {
    // One message listing all three beats three round trips.
    const { service } = build(twoRounds);

    await expect(
      service.updateConfig(
        'p1',
        dto({ pairingMethod: 'adjacent', grouping: { kind: 'points' } }),
        'u1',
      ),
    ).rejects.toThrow(/pairingMethod, grouping/);
  });

  it('still allows a harmless edit after round 2', async () => {
    // Only the retroactive three are frozen; the tiebreak chain is applied at
    // read time, so it can still be changed.
    const { supabase, service } = build(twoRounds);

    await service.updateConfig('p1', dto({ tiebreakChain: ['buchholz'] }), 'u1');

    expect(parseSwissConfig(writtenConfig(supabase))?.tiebreakChain).toEqual(['buchholz']);
  });

  it('refuses a round count below the rounds already generated', async () => {
    const { service } = build(twoRounds);

    await expect(service.updateConfig('p1', dto({ roundCount: 1 }), 'u1')).rejects.toThrow(
      /cannot drop below the 2 round\(s\)/,
    );
  });

  it('accepts a round count that matches what is already generated', async () => {
    // The boundary is "below", not "at": a phase settling on the rounds it has
    // is an ordinary way to end one early. Three rather than two, because the
    // schema floors a Swiss phase at three rounds either way.
    const { supabase, service } = build({
      swiss_rounds: {
        rows: [
          swissRound({ id: 'sr1', round_number: 1, status: 'completed' }),
          swissRound({ id: 'sr2', round_number: 2, status: 'completed' }),
          swissRound({ id: 'sr3', round_number: 3, status: 'pending' }),
        ],
      },
    });

    await service.updateConfig('p1', dto({ roundCount: 3 }), 'u1');

    expect(parseSwissConfig(writtenConfig(supabase))?.roundCount).toBe(3);
  });

  it('records which settings were changed', async () => {
    const { supabase, service } = build();

    await service.updateConfig('p1', dto({ roundCount: 6 }), 'u1');

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      action: 'swiss.config_update',
      entity_type: 'phase',
      entity_id: 'p1',
      payload_json: { changed: ['roundCount'] },
    });
  });
});

describe('SwissService.withdraw — taking a fighter out mid-phase', () => {
  it('marks the fighter as out from the next round on', async () => {
    // Decision 11: the round they already played stands, so the withdrawal
    // starts at the round after the ones generated.
    const { supabase, service } = build();

    await expect(service.withdraw('p1', 'r2', 'u1')).resolves.toEqual({ withdrawnAtRound: 2 });

    expect(writesTo(supabase, 'swiss_entrants')[0]?.row).toEqual({ withdrawn_at_round: 2 });
  });

  it('scopes the withdrawal to one fighter in one phase', async () => {
    // The same registration can be entered in another phase, and the phase
    // holds other fighters. An unscoped update would withdraw them all.
    const { supabase, service } = build();

    await service.withdraw('p1', 'r2', 'u1');

    expect(writesTo(supabase, 'swiss_entrants')[0]?.filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['phase_id', 'p1'] },
        { method: 'eq', args: ['registration_id', 'r2'] },
      ]),
    );
  });

  it('reports a fighter who is not in this phase', async () => {
    const { supabase, service } = build();

    await expect(service.withdraw('p1', 'r9', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(writesTo(supabase, 'swiss_entrants')).toHaveLength(0);
  });

  it('leaves a fighter who has already withdrawn where they were', async () => {
    // Withdrawing twice must not move the round they went out at, which is
    // what every later pairing and standings read is computed from.
    const { supabase, service } = build({
      swiss_entrants: { rows: [entrant('r1'), entrant('r2', 1)] },
    });

    await expect(service.withdraw('p1', 'r2', 'u1')).resolves.toEqual({ withdrawnAtRound: 1 });
    expect(writesTo(supabase, 'swiss_entrants')).toHaveLength(0);
    expect(writesTo(supabase, 'audit_log')).toHaveLength(0);
  });

  it('records the withdrawal against the phase', async () => {
    const { supabase, service } = build();

    await service.withdraw('p1', 'r2', '11111111-1111-4111-8111-111111111111');

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      actor_user_id: '11111111-1111-4111-8111-111111111111',
      action: 'swiss.withdraw',
      entity_type: 'phase',
      entity_id: 'p1',
      payload_json: { registrationId: 'r2', withdrawnAtRound: 2 },
    });
  });
});
