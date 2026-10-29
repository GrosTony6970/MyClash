/**
 * `unfoughtBoutsOf`, the one reader of a Fighter's unfought bouts (the audited settings change,
 * revision 17 fold 1): their scheduled or paused bouts in the Pool phases. It reads nothing of the
 * Fighter's spell out, so a Fighter still in (`out_since` null) is read too: the follow of a rules
 * change asks it of such Fighters, and a range filter on a null bound fails at the database (the
 * seeded double refuses it as the database does).
 */
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase } from '../../common/testing/supabase-chain';
import { unfoughtBoutsOf } from './fighter-reconcile';

const db = () =>
  mockSupabase({
    phases: { rows: [{ id: 'p1', type: 'pool', tournament_id: 't1' }] },
    matches: {
      rows: [
        {
          id: 'm1',
          phase_id: 'p1',
          status: 'scheduled',
          red_registration_id: 'reg-paul',
          blue_registration_id: 'reg-jean',
        },
        {
          id: 'm2',
          phase_id: 'p1',
          status: 'paused',
          red_registration_id: 'reg-ann',
          blue_registration_id: 'reg-paul',
        },
        {
          id: 'm3',
          phase_id: 'p1',
          status: 'completed',
          red_registration_id: 'reg-paul',
          blue_registration_id: 'reg-luc',
        },
        {
          id: 'm4',
          phase_id: 'p1',
          status: 'scheduled',
          red_registration_id: 'reg-ann',
          blue_registration_id: 'reg-jean',
        },
      ],
    },
  });

describe('unfoughtBoutsOf', () => {
  it('reads a Fighter’s scheduled and paused bouts of the Pool phases, no other', async () => {
    const bouts = await unfoughtBoutsOf(db().service as never, 't1', 'reg-paul');
    expect(bouts.map((bout) => bout['id'])).toEqual(['m1', 'm2']);
  });

  it('reads nothing of the spell out: no range filter, on any table', async () => {
    const supabase = db();
    await unfoughtBoutsOf(supabase.service as never, 't1', 'reg-paul');
    for (const op of ['gte', 'gt', 'lte', 'lt'] as const) {
      expect(filtersFor(supabase.from, 'matches', op)).toEqual([]);
      expect(filtersFor(supabase.from, 'match_forfeits', op)).toEqual([]);
    }
  });
});
