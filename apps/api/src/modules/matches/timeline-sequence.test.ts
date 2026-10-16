import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { nextSequence } from './timeline-sequence';

const rowAt = (sequence: number, matchId = 'm1') => ({ match_id: matchId, sequence });

describe('nextSequence — the next row of a bout timeline', () => {
  it('follows the last row of that bout', async () => {
    const db = mockSupabase({ match_events: { rows: [rowAt(1), rowAt(3), rowAt(9, 'm2')] } });

    await expect(nextSequence(db.service as never, 'm1')).resolves.toBe(4);
  });

  it('is 1 on a bout with no row yet', async () => {
    const db = mockSupabase({ match_events: { rows: [rowAt(5, 'm2')] } });

    await expect(nextSequence(db.service as never, 'm1')).resolves.toBe(1);
  });

  it('is an error when the timeline cannot be read, never 1', async () => {
    const db = mockSupabase({ match_events: { data: null, error: { message: 'timeout' } } });

    await expect(nextSequence(db.service as never, 'm1')).rejects.toThrow(
      'Could not read the timeline of bout m1: timeout',
    );
  });
});
