import { describe, expect, it } from 'vitest';
import { boardHealthStatus, summariseBoard, summariseRosterHealth } from './board-diagnostics';

const slot = (overrides: Partial<{ role: string; assigned: boolean; reasons: string[] }> = {}) => ({
  slotIndex: 0,
  displayName: null,
  allowedSkillIds: [overrides.role ?? 'arbitre_declarant'],
  role: overrides.role ?? 'arbitre_declarant',
  assignment: overrides.assigned
    ? { id: 'a', userId: null, personId: 'p', displayName: 'X', status: 's', autoAssigned: true }
    : null,
  missingReasons: overrides.reasons ?? [],
  candidates: { recommended: [], warning: [], blocked: [] },
});

describe('summariseBoard', () => {
  it('counts total slots, filled slots, and reasons across pools', () => {
    const board = {
      pools: [
        {
          roleSlots: [
            slot({ assigned: true }),
            slot({ reasons: ['no_qualified_users'] }),
            slot({ reasons: ['all_qualified_have_time_conflict_with_other_pool'] }),
          ],
        },
        {
          roleSlots: [
            slot({ assigned: true }),
            slot({ reasons: ['all_qualified_have_time_conflict_with_other_pool'] }),
          ],
        },
      ],
    };
    const summary = summariseBoard(board);
    expect(summary.totalSlots).toBe(5);
    expect(summary.filledSlots).toBe(2);
    expect(summary.byReason).toEqual({
      no_qualified_users: 1,
      all_qualified_have_time_conflict_with_other_pool: 2,
    });
  });

  it('returns zeros for an empty board', () => {
    expect(summariseBoard({ pools: [] })).toEqual({ totalSlots: 0, filledSlots: 0, byReason: {} });
  });
});

describe('summariseRosterHealth', () => {
  it('flags skills where open slots exceed qualified candidates', () => {
    const board = {
      pools: [
        { roleSlots: [slot({ role: 'arbitre_declarant' }), slot({ role: 'arbitre_declarant' })] },
        { roleSlots: [slot({ role: 'arbitre_declarant', assigned: true })] },
      ],
      candidates: [{ personId: 'p1', qualifications: [{ role: 'arbitre_declarant', rating: 4 }] }],
    };
    const health = summariseRosterHealth(board, new Map([['arbitre_declarant', 'Declarant']]));
    expect(health).toEqual([
      {
        skillId: 'arbitre_declarant',
        skillName: 'Declarant',
        slotsOpen: 2,
        qualifiedCount: 1,
        shortBy: 1,
      },
    ]);
  });

  it('reports shortBy 0 when there are enough qualified referees', () => {
    const board = {
      pools: [{ roleSlots: [slot({ role: 'arbitre_table' })] }],
      candidates: [
        { personId: 'p1', qualifications: [{ role: 'arbitre_table', rating: 3 }] },
        { personId: 'p2', qualifications: [{ role: 'arbitre_table', rating: 4 }] },
      ],
    };
    const health = summariseRosterHealth(board, new Map([['arbitre_table', 'Table']]));
    expect(health[0]?.shortBy).toBe(0);
  });
});

describe('boardHealthStatus', () => {
  it('is "healthy" when everything is filled and there are no problems', () => {
    expect(
      boardHealthStatus({
        openSlots: 0,
        rosterShort: false,
        conflicts: 0,
        capacity: 0,
        deadEnds: 0,
      }),
    ).toBe('healthy');
  });

  it('is "gaps" when slots are merely unfilled', () => {
    expect(
      boardHealthStatus({
        openSlots: 2,
        rosterShort: false,
        conflicts: 0,
        capacity: 0,
        deadEnds: 0,
      }),
    ).toBe('gaps');
  });

  it('escalates to "conflict" (red) when there are scheduling conflicts', () => {
    expect(
      boardHealthStatus({
        openSlots: 0,
        rosterShort: false,
        conflicts: 1,
        capacity: 0,
        deadEnds: 0,
      }),
    ).toBe('conflict');
  });

  it('treats capacity shortages, dead-ends and roster shortage as red too', () => {
    expect(
      boardHealthStatus({
        openSlots: 0,
        rosterShort: false,
        conflicts: 0,
        capacity: 1,
        deadEnds: 0,
      }),
    ).toBe('conflict');
    expect(
      boardHealthStatus({
        openSlots: 0,
        rosterShort: false,
        conflicts: 0,
        capacity: 0,
        deadEnds: 1,
      }),
    ).toBe('conflict');
    expect(
      boardHealthStatus({
        openSlots: 3,
        rosterShort: true,
        conflicts: 0,
        capacity: 0,
        deadEnds: 0,
      }),
    ).toBe('shortage');
  });
});
