import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  writesTo,
  type RecordedWrite,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { asSupabase as as, phaseRow, swissRound } from './swiss.fixtures';
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
});
