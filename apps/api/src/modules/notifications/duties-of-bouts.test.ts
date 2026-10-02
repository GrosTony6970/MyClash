/**
 * The locked duties whose start a write of some bouts can move (operator rulings 220, 221).
 *
 * Pool A holds bout-a1 and bout-a2; the final is a bout of no Pool. Anna is locked on Pool A, Paul
 * on the final, Marc on bout-a2 alone. The decoys: a duty on Pool B, whose bouts are not named, a
 * duty still being planned on Pool A, and one on the final.
 */
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { lockedDutiesOfBouts } from './duties-of-bouts';

const bout = (id: string, poolId: string | null) => ({ id, pool_id: poolId });
const onPool = (id: string, poolId: string, status = 'confirmed') => ({
  id,
  pool_id: poolId,
  match_id: null,
  status,
});
const onBout = (id: string, matchId: string, status = 'confirmed') => ({
  id,
  pool_id: null,
  match_id: matchId,
  status,
});

function tables(overrides: Record<string, TableSeed> = {}): Record<string, TableSeed> {
  return {
    matches: {
      rows: [
        bout('bout-a1', 'pool-a'),
        bout('bout-a2', 'pool-a'),
        bout('bout-b1', 'pool-b'),
        bout('final', null),
      ],
    },
    referee_assignments: {
      rows: [
        onPool('anna-pool-a', 'pool-a'),
        onPool('planned-pool-a', 'pool-a', 'assigned'),
        onPool('zoe-pool-b', 'pool-b'),
        onBout('marc-a2', 'bout-a2'),
        onBout('paul-final', 'final'),
        onBout('planned-final', 'final', 'assigned'),
      ],
    },
    ...overrides,
  };
}
const BOOM = { data: null, error: { message: 'boom' } };
const DUTY_COLUMNS =
  'id, person_id, event_id, pool_id, match_id, role, status, matches ( match_number_label, lices ( name ) )';

async function dutiesOf(matchIds: string[], overrides: Record<string, TableSeed> = {}) {
  const db = mockSupabase(tables(overrides));
  const duties = await lockedDutiesOfBouts(db as never, matchIds);
  return { db, duties: duties.map((duty) => duty.id).sort() };
}

describe('the locked duties of some bouts', () => {
  it('finds the duty on a bout that is named', async () => {
    expect((await dutiesOf(['final'])).duties).toEqual(['paul-final']);
  });

  it("finds the duty on the bout's Pool, and not the one on another bout of that Pool", async () => {
    // bout-a1 is named: Anna's Pool duty can move. Marc's duty is on bout-a2, which is not.
    expect((await dutiesOf(['bout-a1'])).duties).toEqual(['anna-pool-a']);
  });

  it('finds both kinds at once, each duty once', async () => {
    const { duties } = await dutiesOf(['bout-a1', 'bout-a2', 'final']);

    expect(duties).toEqual(['anna-pool-a', 'marc-a2', 'paul-final']);
  });

  it('leaves out a duty that is not locked: it rings for nobody (ruling 220)', async () => {
    const { duties } = await dutiesOf(['bout-a1', 'final']);

    expect(duties).not.toContain('planned-pool-a');
    expect(duties).not.toContain('planned-final');
  });

  it('asks for columns the tables have, by the bouts and by their Pools', async () => {
    const { db } = await dutiesOf(['bout-a1', 'bout-a2', 'final']);

    expect(selectsFor(db.from, 'matches')).toEqual(['id, pool_id']);
    // The columns both alert families read: one row serves the referee's and his followers'.
    expect(selectsFor(db.from, 'referee_assignments')).toEqual([DUTY_COLUMNS, DUTY_COLUMNS]);
    expect(filtersFor(db.from, 'matches', 'in')).toEqual([['id', ['bout-a1', 'bout-a2', 'final']]]);
    expect(filtersFor(db.from, 'referee_assignments', 'eq')).toEqual([
      ['status', 'confirmed'],
      ['status', 'confirmed'],
    ]);
    // Each Pool once, however many of its bouts were named.
    expect(filtersFor(db.from, 'referee_assignments', 'in')).toEqual([
      ['match_id', ['bout-a1', 'bout-a2', 'final']],
      ['pool_id', ['pool-a']],
    ]);
  });

  it('reads no Pool duty when no bout named sits in a Pool', async () => {
    const { db } = await dutiesOf(['final']);

    expect(filtersFor(db.from, 'referee_assignments', 'in')).toEqual([['match_id', ['final']]]);
  });

  it('reads nothing when no bout is named', async () => {
    const { db, duties } = await dutiesOf([]);

    expect(duties).toEqual([]);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('a failed read of the bouts is a plain Error, not "no duty"', async () => {
    const failure = await dutiesOf(['bout-a1'], { matches: BOOM }).catch((error: unknown) => error);

    expect((failure as Error).constructor).toBe(Error);
    expect((failure as Error).message).toBe('moved bouts read failed: boom');
  });

  it.each<[string, unknown[]]>([
    ['duties on the moved bouts', [BOOM]],
    ['duties on the Pools of the moved bouts', [{ data: [{ id: 'marc-a2' }], error: null }, BOOM]],
  ])('a failed read of the %s is a plain Error too', async (what, answers) => {
    const failure = await dutiesOf(['bout-a1', 'bout-a2'], {
      referee_assignments: answers as never,
    }).catch((error: unknown) => error);

    expect((failure as Error).constructor).toBe(Error);
    expect((failure as Error).message).toBe(`${what} read failed: boom`);
  });
});
