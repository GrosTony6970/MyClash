import { describe, expect, it } from 'vitest';
import { diffRoleAssignments } from './diff-role-assignments';

describe('diffRoleAssignments', () => {
  it('returns nothing when nothing changed', () => {
    const cur = [{ role: 'head', refereeId: 'r1' }];
    expect(diffRoleAssignments(cur, [{ role: 'head', refereeId: 'r1' }])).toEqual([]);
  });

  it('returns a changed assignment', () => {
    expect(
      diffRoleAssignments([{ role: 'head', refereeId: 'r1' }], [{ role: 'head', refereeId: 'r2' }]),
    ).toEqual([{ role: 'head', refereeId: 'r2' }]);
  });

  it('returns a clear (null) when an assigned role is emptied', () => {
    expect(
      diffRoleAssignments([{ role: 'head', refereeId: 'r1' }], [{ role: 'head', refereeId: null }]),
    ).toEqual([{ role: 'head', refereeId: null }]);
  });

  it('treats a role absent from current as null (no-op when draft is also null)', () => {
    expect(diffRoleAssignments([], [{ role: 'assessor', refereeId: null }])).toEqual([]);
    expect(diffRoleAssignments([], [{ role: 'assessor', refereeId: 'r3' }])).toEqual([
      { role: 'assessor', refereeId: 'r3' },
    ]);
  });

  it('returns only the roles that changed', () => {
    const cur = [
      { role: 'head', refereeId: 'r1' },
      { role: 'assessor', refereeId: 'r2' },
    ];
    const draft = [
      { role: 'head', refereeId: 'r1' },
      { role: 'assessor', refereeId: 'r9' },
    ];
    expect(diffRoleAssignments(cur, draft)).toEqual([{ role: 'assessor', refereeId: 'r9' }]);
  });
});
