import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { MatchesService } from './matches.service';

/**
 * Ruling 331 at the status door: a bout set back to running or paused carries
 * no result, as one the clock reopened. No screen sends this today.
 */
const BOUT = 'm1';

function setup() {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: BOUT,
          status: 'completed',
          winner_registration_id: 'red',
          end_reason: 'forfeit',
          ended_at: '2026-04-25T09:01:00.000Z',
        },
      ],
    },
  });
  const completion = {
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
  };
  const scoring = { clockAction: vi.fn().mockResolvedValue({ status: 'halted' }) };
  const service = new MatchesService(
    db as never,
    scoring as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined,
    completion as never,
  );
  return { db, scoring, service };
}

const NO_RESULT = { winner_registration_id: null, end_reason: null, ended_at: null };

describe('MatchesService.updateStatus — a bout set back in play (ruling 331)', () => {
  it.each<'running' | 'paused'>(['running', 'paused'])('%s leaves no result', async (status) => {
    const { db, service } = setup();

    await service.updateStatus(BOUT, { status } as never);

    expect(writesTo(db, 'matches')[0]?.row).toMatchObject({ status, ...NO_RESULT });
  });

  it('completed keeps what the row holds', async () => {
    const { db, service } = setup();

    await service.updateStatus(BOUT, { status: 'completed' } as never);

    const row = writesTo(db, 'matches')[0]?.row as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['ended_at', 'status', 'updated_at']);
  });

  it('a voided bout keeps the result it was voided with', async () => {
    const { db, service } = setup();

    await service.voidMatch(BOUT);

    const row = writesTo(db, 'matches')[0]?.row as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['status', 'updated_at']);
  });
});

describe('MatchesService.clockAction', () => {
  it('goes through the door that reads the sheet (ruling 331)', async () => {
    const { scoring, service } = setup();
    const actor = { userId: 'u1' };

    await expect(service.clockAction(BOUT, 'reopen', 'why', actor, true)).resolves.toEqual({
      status: 'halted',
    });

    expect(scoring.clockAction.mock.calls).toEqual([[BOUT, 'reopen', 'why', actor, true]]);
  });
});
