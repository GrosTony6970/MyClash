/**
 * A bout created with a time is a placed bout. Its Fighters and their followers get their
 * "starts soon" alert as for any placed bout, and in a Pool it can be the earliest one, which
 * moves the start of the Pool's locked referee duties (operator ruling 221). The new bout goes
 * to the alert seam, which owns the three families.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';
import { withStampedRules } from '../phases/match-rules.fixtures';

const DTO = {
  phaseId: 'phase-1',
  poolId: 'pool-1',
  redRegistrationId: 'r',
  blueRegistrationId: 'b',
  scheduledAt: '2026-06-06T08:00:00.000Z',
};

function makeService(matches: TableSeed) {
  // The new bout takes the ruleset of its phase's Tournament: the phase is read and its rules
  // stamped, and after the write stamped again, for the ruleset in force then (R3).
  const [seed, { stamp_match_rules: stamp }] = withStampedRules({
    matches,
    phases: { rows: [{ id: 'phase-1', tournament_id: 't-1' }] },
    tournaments: { rows: [{ id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1.0.0' }] },
  });
  /** The writes of bouts that had landed at each stamp of the Tournament's rules. */
  const boutWritesAtStamp: string[][] = [];
  const supabase = mockSupabase(seed, {
    stamp_match_rules: (args) => {
      boutWritesAtStamp.push(boutWrites());
      return stamp!(args);
    },
  });
  const boutWrites = () => writesTo(supabase, 'matches').map((write) => write.op);
  /** The writes of bouts, and the stamps, that had landed when the seam was asked. */
  const whenAsked: Array<{ writes: string[]; stamps: number }> = [];
  const matchAlerts = {
    refresh: vi.fn(() => {
      whenAsked.push({ writes: boutWrites(), stamps: boutWritesAtStamp.length });
      return Promise.resolve();
    }),
  };
  const service = new MatchesService(
    supabase as never,
    {} as never,
    matchAlerts as never,
    { placeMatches: vi.fn(() => Promise.resolve()) } as never,
    {} as never,
  );
  return { service, supabase, matchAlerts, whenAsked, boutWritesAtStamp };
}

describe('createMatch: the alerts of the new bout (ruling 221)', () => {
  it('names the new bout to the alert seam, once it is saved', async () => {
    // A decoy first: the id is the saved row's, not the first row of the table.
    const { service, matchAlerts, whenAsked } = makeService({
      returning: { id: 'new-match' },
      rows: [{ id: 'another-bout' }],
    });

    await service.createMatch(DTO as never);

    expect(matchAlerts.refresh.mock.calls).toEqual([[['new-match']]]);
    // Saved, and stamped again with the ruleset in force (R3).
    expect(whenAsked).toEqual([{ writes: ['insert'], stamps: 2 }]);
  });

  // The Tournament's rules can change between the door's stamp and the write: the change moves
  // the bouts not started, and the new one is not in yet. So the door stamps again after (R3).
  it('re-stamps the new bout with the ruleset in force once it is in', async () => {
    const { service, supabase, boutWritesAtStamp } = makeService({
      returning: { id: 'new-match' },
      rows: [],
    });

    await service.createMatch(DTO as never);

    // The door's stamp before the bout is written, and the re-stamp after it.
    expect(boutWritesAtStamp).toEqual([[], ['insert']]);
    expect(supabase.rpc.mock.calls).toEqual([
      ['stamp_match_rules', { p_tournament_id: 't-1' }],
      ['stamp_match_rules', { p_tournament_id: 't-1' }],
    ]);
  });

  it('still answers the saved bout when the queue is down: a retry would make a second one', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, matchAlerts } = makeService({ returning: { id: 'new-match' }, rows: [] });
    matchAlerts.refresh.mockRejectedValue(new Error('redis is down'));

    await expect(service.createMatch(DTO as never)).resolves.toMatchObject({ id: 'new-match' });

    expect(warn.mock.calls).toEqual([
      ['The alerts of the new bout new-match were not set: redis is down'],
    ]);
    warn.mockRestore();
  });

  it('asks nothing when the bout is refused', async () => {
    const { service, matchAlerts } = makeService({ data: null, error: { message: 'boom' } });

    await expect(service.createMatch(DTO as never)).rejects.toBeInstanceOf(BadRequestException);

    expect(matchAlerts.refresh).not.toHaveBeenCalled();
  });
});
