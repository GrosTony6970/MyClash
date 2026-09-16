import { describe, expect, it } from 'vitest';
import { recordConflictCheck, type ConflictChecks } from './conflict-checks';

type Answer = { conflicts: string[] };
const NONE: ConflictChecks<Answer> = {};
const CLASH: Answer = { conflicts: ['Ada fights and referees at 09:00'] };
const CLEAR: Answer = { conflicts: [] };

describe('recordConflictCheck', () => {
  it('keeps a failed check as a failure, not as an empty answer', () => {
    expect(recordConflictCheck(NONE, 'A', 1, null)).toEqual({ A: { seq: 1, result: null } });
  });

  it('lets a later check of the same Tournament replace an earlier one', () => {
    const failed = recordConflictCheck(NONE, 'A', 1, null);
    expect(recordConflictCheck(failed, 'A', 2, CLASH)).toEqual({ A: { seq: 2, result: CLASH } });
  });

  it('drops an answer that arrives after a later check of the same Tournament answered', () => {
    // Two edits, two checks; the first answers last. Its older all-clear must
    // not hide the clash the second one found.
    const latest = recordConflictCheck(NONE, 'A', 2, CLASH);
    expect(recordConflictCheck(latest, 'A', 1, CLEAR)).toBe(latest);
  });

  it("never touches another Tournament's check", () => {
    // Edit in A, switch to B, edit there: B's check fails fast, then A's slow
    // all-clear arrives. B's failure must stay, and A's answer stays under A.
    const bFailed = recordConflictCheck(NONE, 'B', 2, null);
    expect(recordConflictCheck(bFailed, 'A', 1, CLEAR)).toEqual({
      B: { seq: 2, result: null },
      A: { seq: 1, result: CLEAR },
    });
  });
});
