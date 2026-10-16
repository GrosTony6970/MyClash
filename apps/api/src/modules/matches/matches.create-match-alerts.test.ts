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

const DTO = {
  phaseId: 'phase-1',
  poolId: 'pool-1',
  redRegistrationId: 'r',
  blueRegistrationId: 'b',
  scheduledAt: '2026-06-06T08:00:00.000Z',
};

function makeService(matches: TableSeed, rulesetNow = 'TF_v1') {
  // The new bout takes the ruleset of its phase's Tournament: the phase is read, and after the
  // write the Tournament again, for the ruleset in force then (R3).
  const supabase = mockSupabase({
    matches,
    phases: {
      rows: [{ id: 'phase-1', tournament_id: 't-1', tournaments: { ruleset_code: 'TF_v1' } }],
    },
    tournaments: { rows: [{ id: 't-1', ruleset_code: rulesetNow, ruleset_version: '1.0.0' }] },
  });
  /** The writes of bouts that had landed when the seam was asked. */
  const boutWritesWhenAsked: string[][] = [];
  const matchAlerts = {
    refresh: vi.fn(() => {
      boutWritesWhenAsked.push(writesTo(supabase, 'matches').map((write) => write.op));
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
  return { service, supabase, matchAlerts, boutWritesWhenAsked };
}

describe('createMatch: the alerts of the new bout (ruling 221)', () => {
  it('names the new bout to the alert seam, once it is saved', async () => {
    // A decoy first: the id is the saved row's, not the first row of the table.
    const { service, matchAlerts, boutWritesWhenAsked } = makeService({
      returning: { id: 'new-match' },
      rows: [{ id: 'another-bout' }],
    });

    await service.createMatch(DTO as never);

    expect(matchAlerts.refresh.mock.calls).toEqual([[['new-match']]]);
    // Saved, and re-stamped with the ruleset in force (R3).
    expect(boutWritesWhenAsked).toEqual([['insert', 'update']]);
  });

  // The door read TF_v1; the Tournament moved to points-cap before the bout was in (R3).
  it('re-stamps the new bout with the ruleset in force once it is in', async () => {
    const { service, supabase } = makeService(
      { returning: { id: 'new-match' }, rows: [] },
      'Generic_PointsCap',
    );

    await service.createMatch(DTO as never);

    const writes = writesTo(supabase, 'matches');
    expect(writes.map((write) => write.op)).toEqual(['insert', 'update']);
    expect(writes[1]?.row).toMatchObject({ ruleset_code: 'Generic_PointsCap' });
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
