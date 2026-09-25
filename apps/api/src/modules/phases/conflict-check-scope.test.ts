import { describe, expect, it } from 'vitest';
import type { RefereeReason } from '@myclash/rulesets/scheduling/referee-checker';
import type {
  AssignmentBoardPool,
  RefereeConflictEntry,
} from '../referees/assignment-board.service';
import { conflictsTouchingTournament } from './conflict-check-scope';

const T = 'longsword';
const OTHER = 'sabre';

function unit(
  id: string,
  tournamentId: string,
  matchIds: string[],
  over: Partial<AssignmentBoardPool> = {},
) {
  return {
    id,
    name: id,
    tournamentId,
    tournamentName: tournamentId,
    liceId: null,
    scheduledStart: null,
    scheduledEnd: null,
    kind: 'pool',
    members: [],
    roleSlots: [],
    matches: matchIds.map((m) => ({
      id: m,
      scheduledAt: null,
      durationMinutes: 5,
      liceId: null,
      redRegistrationId: null,
      blueRegistrationId: null,
    })),
    ...over,
  } as AssignmentBoardPool;
}

const units = [
  unit('pool-ls', T, ['ls1']),
  unit('swiss-ls-r2-l1', T, ['sw1'], { kind: 'swiss', swissRoundId: 'r2' }),
  unit('pool-sb', OTHER, ['sb1']),
  unit('pool-sb2', OTHER, ['sb2']),
];

function entry(
  unitId: string,
  tournamentId: string,
  reasons: RefereeReason['against'][],
): RefereeConflictEntry {
  return {
    assignmentId: `row-${unitId}`,
    personId: 'lea',
    personName: 'Léa',
    unitId,
    unitName: unitId,
    tournamentId,
    role: 'decl',
    start: null,
    level: 'impossible',
    reasons: reasons.map((against) => ({
      code: 'fights_overlap',
      level: 'impossible',
      against,
      confirmed: false,
    })),
  };
}

describe('conflictsTouchingTournament', () => {
  it("keeps a duty of T's own", () => {
    const own = entry('pool-ls', T, [{ kind: 'match', id: 'sb1', label: 'x' }]);
    expect(conflictsTouchingTournament([own], units, T)).toEqual([own]);
  });

  it("keeps another Tournament's Pool crew whose referee fights one of T's bouts", () => {
    const crossing = entry('pool-sb', OTHER, [
      { kind: 'match', id: 'ls1', label: 'Longsword · pool-ls' },
    ]);
    expect(conflictsTouchingTournament([crossing], units, T)).toEqual([crossing]);
  });

  it("keeps one that points at T's Pool, T's Swiss round, or T's unit", () => {
    const atPool = entry('pool-sb', OTHER, [{ kind: 'pool', id: 'pool-ls', label: 'x' }]);
    const atRound = entry('pool-sb', OTHER, [{ kind: 'pool', id: 'swiss:r2', label: 'x' }]);
    const atUnit = entry('pool-sb', OTHER, [{ kind: 'unit', id: 'swiss-ls-r2-l1', label: 'x' }]);
    expect(conflictsTouchingTournament([atPool, atRound, atUnit], units, T)).toHaveLength(3);
  });

  it('drops a verdict of another Tournament that points nowhere in T', () => {
    const elsewhere = entry('pool-sb', OTHER, [{ kind: 'unit', id: 'pool-sb2', label: 'x' }]);
    const workshop = entry('pool-sb', OTHER, [{ kind: 'workshop', id: 'ls1', label: 'x' }]);
    const availability = entry('pool-sb', OTHER, [null]);
    expect(conflictsTouchingTournament([elsewhere, workshop, availability], units, T)).toEqual([]);
  });
});
