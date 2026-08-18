import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  writesTo,
  type RecordedWrite,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { asSupabase as as, phaseRow, swissConfig, swissRound } from './swiss.fixtures';
import { parseSwissConfig } from './dto/swiss-config.dto';
import { SwissFinaliseService } from './swiss-finalise.service';
import { SwissPairingService } from './swiss-pairing.service';

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase({
    phases: { rows: [phaseRow()] },
    swiss_entrants: { rows: [] },
    swiss_rounds: { rows: [swissRound({ id: 'sr1', status: 'completed' })] },
    audit_log: { rows: [] as SupabaseRow[] },
    ...over,
  });
  return {
    supabase,
    service: new SwissFinaliseService(as(supabase), new SwissPairingService(as(supabase))),
  };
};

/** The config as it was actually written to the phase. */
const writtenConfig = (supabase: { writes: RecordedWrite[] }) =>
  (writesTo(supabase, 'phases')[0]?.row as { config_json?: unknown })?.config_json;

/** A phase frozen after `atRound`, as `finalise` leaves it. */
const frozen = (atRound = 2) =>
  phaseRow({
    config_json: {
      ...swissConfig(),
      finalized: { atRound, at: '2026-08-18T10:00:00.000Z', byUserId: null },
    },
  });

/** An elimination phase of t1, seeded from the Swiss standings. */
const downstreamBracket = (over: SupabaseRow = {}): SupabaseRow => ({
  id: 'b1',
  type: 'single_elim',
  tournament_id: 't1',
  config_json: { seedingStrategy: 'by-swiss-rank' },
  ...over,
});

describe('SwissFinaliseService — freezing the standings', () => {
  it('writes a config that can still be read back when nobody can be attributed', async () => {
    // The route is guarded, but the guard verifies the token LOCALLY while the
    // controller resolves the actor over the NETWORK — so a Supabase blip
    // hands this a null actor on a request the guard already allowed.
    //
    // Whatever is stored then, the config has to survive a round trip. It once
    // stored '' for the user, which is not a UUID, so the WHOLE config stopped
    // parsing: the phase could not be paired, viewed, or even resumed.
    const { supabase, service } = build();

    await service.finalise('p1', null);

    const reparsed = parseSwissConfig(writtenConfig(supabase));
    expect(reparsed).not.toBeNull();
    expect(reparsed?.finalized?.byUserId).toBeNull();
  });

  it('records the organiser who froze the standings', async () => {
    const { supabase, service } = build();

    await service.finalise('p1', '11111111-1111-4111-8111-111111111111');

    expect(parseSwissConfig(writtenConfig(supabase))?.finalized).toMatchObject({
      byUserId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('freezes at the rounds actually fought, not the rounds generated', async () => {
    // A paired but unplayed round is pending, and finalising must not claim it
    // as a result.
    const { service } = build({
      swiss_rounds: {
        rows: [
          swissRound({ id: 'sr1', round_number: 1, status: 'completed' }),
          swissRound({ id: 'sr2', round_number: 2, status: 'completed' }),
          swissRound({ id: 'sr3', round_number: 3, status: 'pending' }),
        ],
      },
    });

    const finalized = await service.finalise('p1', null);

    expect(finalized).toMatchObject({ atRound: 2 });
  });

  it('leaves a phase that is already frozen exactly as it was', async () => {
    // Freezing twice must not restamp the moment: the first freeze IS the
    // result, and a later timestamp would misreport when the podium was set.
    const { supabase, service } = build({ phases: { rows: [frozen(2)] } });

    const finalized = await service.finalise('p1', 'u1');

    expect(finalized).toMatchObject({ atRound: 2, at: '2026-08-18T10:00:00.000Z' });
    expect(writesTo(supabase, 'phases')).toHaveLength(0);
    expect(writesTo(supabase, 'audit_log')).toHaveLength(0);
  });

  it('records the freeze in the audit log', async () => {
    const { supabase, service } = build();

    await service.finalise('p1', '11111111-1111-4111-8111-111111111111');

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      actor_user_id: '11111111-1111-4111-8111-111111111111',
      action: 'swiss.finalise',
      entity_type: 'phase',
      entity_id: 'p1',
    });
  });
});

describe('SwissFinaliseService — resuming a frozen phase', () => {
  it('does nothing to a phase that was never frozen', async () => {
    const { supabase, service } = build();

    await expect(service.unfinalise('p1', 'u1')).resolves.toEqual({ finalized: null });
    expect(writesTo(supabase, 'phases')).toHaveLength(0);
    expect(writesTo(supabase, 'audit_log')).toHaveLength(0);
  });

  it('clears the freeze and records what it cleared', async () => {
    // The audit entry carries the freeze that was undone, because "resumed" on
    // its own does not say which result was withdrawn.
    const { supabase, service } = build({ phases: { rows: [frozen(3)] } });

    await expect(service.unfinalise('p1', 'u1')).resolves.toEqual({ finalized: null });

    expect(parseSwissConfig(writtenConfig(supabase))?.finalized).toBeNull();
    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      action: 'swiss.unfinalise',
      entity_id: 'p1',
      payload_json: { wasFinalizedAt: { atRound: 3 } },
    });
  });

  it('refuses once a bracket seeded from these standings has a bout under way', async () => {
    // That bracket's round 1 IS this ranking, so resuming would change the
    // seeding it was built from.
    const { supabase, service } = build({
      phases: { rows: [frozen(3), downstreamBracket()] },
      matches: { rows: [{ id: 'm1', phase_id: 'b1', status: 'running' }] },
    });

    await expect(service.unfinalise('p1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    // And the freeze is still standing.
    expect(writesTo(supabase, 'phases')).toHaveLength(0);
  });

  it('resumes while the downstream bracket is still only scheduled', async () => {
    // A bracket that exists but has not been fought is re-seedable, so the
    // organiser is not locked out.
    //
    // The Swiss phase's OWN completed bout is the decoy that matters here: a
    // phase worth freezing has always fought some, so a probe that forgot to
    // scope itself to the bracket would refuse every resume there is.
    const { supabase, service } = build({
      phases: { rows: [frozen(3), downstreamBracket()] },
      matches: {
        rows: [
          { id: 'm1', phase_id: 'b1', status: 'scheduled' },
          { id: 'sw1', phase_id: 'p1', status: 'completed' },
        ],
      },
    });

    await expect(service.unfinalise('p1', 'u1')).resolves.toEqual({ finalized: null });
    expect(parseSwissConfig(writtenConfig(supabase))?.finalized).toBeNull();
  });
});
