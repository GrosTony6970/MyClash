import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { readBoutResults } from './bout-results';

/** The Workshop board asks who of its instructors is out of their bracket (2026-11-23). */
describe('readBoutResults', () => {
  it("reads each bout's status and winner, by the ids asked", async () => {
    const supabase = mockSupabase({
      matches: {
        rows: [
          { id: 'qf', status: 'completed', winner_registration_id: 'reg-z' },
          { id: 'other', status: 'scheduled', winner_registration_id: null },
        ],
      },
    });
    const client = supabase.service as unknown as SupabaseClient;

    const results = await readBoutResults(client, { warn: vi.fn() }, 'event-1', ['qf']);

    expect([...results]).toEqual([['qf', { status: 'completed', winnerRegistrationId: 'reg-z' }]]);
    expect(selectsFor(supabase.from, 'matches')).toEqual(['id, status, winner_registration_id']);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['id', ['qf']]]);
  });

  it('reads nothing when no bout is asked', async () => {
    const supabase = mockSupabase({ matches: { rows: [] } });

    const results = await readBoutResults(
      supabase.service as unknown as SupabaseClient,
      { warn: vi.fn() },
      'event-1',
      [],
    );

    expect(results.size).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('answers nothing, and says so, when the read fails: everyone stays in', async () => {
    const supabase = mockSupabase({ matches: { data: null, error: { message: 'down' } } });
    const logger = { warn: vi.fn() };

    const results = await readBoutResults(
      supabase.service as unknown as SupabaseClient,
      logger,
      'event-1',
      ['qf'],
    );

    expect(results.size).toBe(0);
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('event-1');
  });
});
