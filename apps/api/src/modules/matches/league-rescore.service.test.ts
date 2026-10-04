import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from './frozen-results.guard';
import { LeagueRescoreService } from './league-rescore.service';

/**
 * Ruling 248: a hit or a card that changes a bout of an Event that is OVER makes
 * the server score that Event's League results again. Before it, a corrected
 * final left the League table on the old points until a League admin pressed
 * Recompute, and nobody told the League admin.
 *
 * The REAL guard reads the Event here, over a seeded database with a second
 * Event beside it.
 */
const BOUT = 'm1';

function setup(status: string, recompute = vi.fn().mockResolvedValue({ recomputedLeagues: [] })) {
  const db = mockSupabase({
    matches: {
      rows: [
        { id: BOUT, phase_id: 'p1' },
        { id: 'm2', phase_id: 'p2' },
      ],
    },
    phases: {
      rows: [
        { id: 'p1', tournament_id: 't1' },
        { id: 'p2', tournament_id: 't2' },
      ],
    },
    tournaments: {
      rows: [
        { id: 't1', event_id: 'e1' },
        { id: 't2', event_id: 'e2' },
      ],
    },
    events: {
      rows: [
        { id: 'e1', status },
        // The decoy is the other way round: a read that loses its filter flips the answer.
        { id: 'e2', status: status === 'running' ? 'completed' : 'running' },
      ],
    },
  });
  const guard = new FrozenResultsGuard(db as never, {} as never);
  const service = new LeagueRescoreService(guard, { recomputeForEvent: recompute } as never);
  return { db, service, recompute };
}

afterEach(() => vi.restoreAllMocks());

describe('LeagueRescoreService.afterResultWrite', () => {
  it.each(['completed', 'archived'])('scores the Leagues of a %s Event again', async (status) => {
    const { service, recompute } = setup(status);

    await service.afterResultWrite(BOUT);

    // No user id: the server acts, as when the Event completed.
    expect(recompute.mock.calls).toEqual([['e1']]);
  });

  it.each(['running', 'published', 'draft'])('does nothing on a %s Event', async (status) => {
    const { service, recompute } = setup(status);

    await service.afterResultWrite(BOUT);

    expect(recompute).not.toHaveBeenCalled();
  });

  it('a re-score that fails leaves the correction standing, and says so', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = setup('completed', vi.fn().mockRejectedValue(new Error('no identity')));

    await expect(service.afterResultWrite(BOUT)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/m1.*no identity/));
  });

  it('a bout whose Event cannot be read is said, not thrown', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, recompute } = setup('completed');

    await expect(service.afterResultWrite('gone')).resolves.toBeUndefined();

    expect(recompute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/gone/));
  });

  it('reads the bout’s own Event', async () => {
    const { db, service } = setup('completed');

    await service.afterResultWrite(BOUT);

    expect(selectsFor(db.from, 'events')).toEqual(['id, status']);
  });
});
