/**
 * A team on a bracket slot cannot be deleted, as a Fighter on one cannot (call 15).
 *
 * The story: Lyon Blades won its Pool and holds a bye slot of Team Longsword's bracket. A bye slot
 * has no bout, and the slot's team key nulls on delete (0282): without the slot read, a delete
 * would take Lyon Blades out of the bracket with no word. The slots are simulated tables
 * (`{ rows }`), which apply the `.or` filter, so a read that drops it goes red on Paris's slot.
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { TeamsService } from './teams.service';

const T_A = '55555555-5555-4555-8555-555555555555';
const LYON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lyon = { id: LYON, tournament_id: T_A, name: 'Lyon Blades', slug: 'lyon-blades', size: 3 };

function setup(slots: SupabaseRow[]) {
  const db = mockSupabase({
    teams: { rows: [lyon] },
    matches: { rows: [] },
    bracket_slots: { rows: slots },
  });
  return { db, teams: new TeamsService(db as never) };
}

describe('remove — a team on a bracket slot', () => {
  it.each([
    ['a bye slot, side a', { id: 'slot-bye', team_a_id: LYON, team_b_id: null }],
    ['side b', { id: 'slot-b', team_a_id: PARIS, team_b_id: LYON }],
  ])('refuses 409 team_in_bouts while it holds %s', async (_side, held) => {
    const { db, teams } = setup([held]);

    const refusal = await teams.remove(T_A, LYON).catch((e: unknown) => e);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      reason: 'team_in_bouts',
    });
    expect(writesTo(db, 'teams')).toEqual([]);
    expect(selectsFor(db.from, 'bracket_slots')).toEqual(['id']);
  });

  it('deletes the team while the slots hold only other teams', async () => {
    const { db, teams } = setup([{ id: 'slot-1', team_a_id: PARIS, team_b_id: null }]);

    await teams.remove(T_A, LYON);

    expect(writesTo(db, 'teams').map((write) => write.op)).toEqual(['delete']);
  });
});
