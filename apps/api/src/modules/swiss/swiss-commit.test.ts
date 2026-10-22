import { describe, expect, it } from 'vitest';
import type { SwissRoundPlan } from '@myclash/rules/scheduling';
import { lastFunctionBody } from '../../common/testing/migration-function';
import { swissMatchRows } from './swiss-match-rows';
import { activeEntrants } from './swiss-snapshot';

/**
 * `swiss_commit_round` (0243) has two TS twins, and a drift in either is silent: a bout key its
 * record type does not name is dropped from every bout it writes, and a field rule that differs
 * from the plan's answers 'stale' to every plan, so no round is ever paired again.
 */
const body = lastFunctionBody('swiss_commit_round');

describe('swiss_commit_round — the twins it shares with the TS', () => {
  it('reads exactly the keys swissMatchRows builds a bout with', () => {
    const recordType = /as b\((.*?)\) returning/u.exec(body)?.[1];
    expect(recordType, 'the record type of the bouts').toBeDefined();
    const columns = recordType!.split(',').map((column) => column.trim().split(' ')[0]);
    const plan = {
      pairings: [{ aId: 'r1', bId: 'r2', board: 1 }],
      byeRegistrationId: null,
      warnings: [],
    } as unknown as SwissRoundPlan;
    const [row] = swissMatchRows(1, plan, { match_rules_id: 'mr1' });
    expect([...columns].sort()).toEqual(Object.keys(row!).sort());
    // And writes each of them, beside the phase and the round it sets itself.
    const inserted = /insert into public\.matches \((.*?)\) select/u.exec(body)?.[1];
    expect(inserted, 'the column list of the insert').toBeDefined();
    expect(inserted!.split(',').map((column) => column.trim())).toEqual([
      'phase_id',
      'swiss_round_id',
      ...columns,
    ]);
  });

  it('draws the field as activeEntrants does', () => {
    const predicate = /where phase_id = p_phase and \((.*?)\);/u.exec(body)?.[1];
    expect(predicate, 'the field predicate').toBeDefined();
    const clauses = predicate!.split(' or ');
    const active = (withdrawn: number | null, round: number) =>
      clauses.some((clause) => {
        if (clause === 'withdrawn_at_round is null') return withdrawn === null;
        const compared = /^withdrawn_at_round (>|>=|<|<=|=) p_round$/u.exec(clause);
        if (!compared) throw new Error(`a clause this test cannot read: ${clause}`);
        if (withdrawn === null) return false;
        return {
          '>': withdrawn > round,
          '>=': withdrawn >= round,
          '<': withdrawn < round,
          '<=': withdrawn <= round,
          '=': withdrawn === round,
        }[compared[1] as '>'];
      });
    const round = 3;
    for (const withdrawn of [null, 2, 3, 4]) {
      const entrant = { registrationId: 'r1', withdrawnAtRound: withdrawn };
      expect(activeEntrants([entrant], round).length === 1, `withdrawn at ${withdrawn}`).toBe(
        active(withdrawn, round),
      );
    }
  });
});
