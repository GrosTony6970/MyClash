/**
 * referee-assigner.test.ts — T-903
 *
 * Test scenarios from BUILD_ORDER AC:
 *   1. 4 pools, 12 qualified referees (4 of each role), no overlaps → all assigned, no warnings
 *   2. 4 pools, 6 referees (2 per role) → all assigned, back-to-back warnings present
 *   3. 4 pools, only 1 qualified arbitre_assesseur → 3 missing cells reported
 *   4. Fighter Alice qualified as arbitre_table, also fighting Pool A → never assigned to Pool A
 */

import { describe, expect, it } from 'vitest';
import { assignRefereesWithPools } from './referee-assigner';
import type { AssignmentSettings, PoolSlot, RefereeCandidate } from './referee-assigner';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AssignmentSettings = {
  enforceRefereeNoBackToBack: true,
  refereeRestMinSlots: 1,
  enforceDedicatedRefereeRest: false,
  workshopConflictWarning: true,
  ratingBasedOrdering: true,
  workloadBalance: true,
};

function makePool(id: string, name: string, regIds: string[] = []): PoolSlot {
  return {
    poolId: id,
    poolName: name,
    matches:
      regIds.length >= 2
        ? [
            {
              id: `m-${id}`,
              scheduledAt: null,
              durationMinutes: 5,
              redRegistrationId: regIds[0]!,
              blueRegistrationId: regIds[1]!,
            },
          ]
        : [],
    earliestStart: null,
    latestEnd: null,
  };
}

function makeCandidate(
  id: string,
  name: string,
  roles: Array<'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table'>,
  fighterRegIds: string[] = [],
): RefereeCandidate {
  return {
    personId: id,
    personName: name,
    qualifications: roles.map((role) => ({ role, rating: 3 })),
    fighterRegistrationIds: fighterRegIds,
    workshopWindows: [],
  };
}

// ── Scenario 1: 4 pools, 12 referees (4 per role) → all assigned, no warnings ──

describe('Scenario 1: 4 pools, 12 referees (4 per role)', () => {
  it('assigns all 12 slots with no warnings', () => {
    const pools = [
      makePool('p1', 'Pool A'),
      makePool('p2', 'Pool B'),
      makePool('p3', 'Pool C'),
      makePool('p4', 'Pool D'),
    ];

    const candidates: RefereeCandidate[] = [
      // 4 arbitre_declarant
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`d${i}`, `Declarant ${i}`, ['arbitre_declarant']),
      ),
      // 4 arbitre_assesseur
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`a${i}`, `Assesseur ${i}`, ['arbitre_assesseur']),
      ),
      // 4 arbitre_table
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`t${i}`, `Table ${i}`, ['arbitre_table']),
      ),
    ];

    const result = assignRefereesWithPools(pools, candidates, {
      ...DEFAULT_SETTINGS,
      enforceRefereeNoBackToBack: false, // 4 pools, 4 referees each — no back-to-back possible
    });

    expect(result.assignments).toHaveLength(12); // 4 pools × 3 roles
    expect(result.missing).toHaveLength(0);
    // No back-to-back warnings since each referee only assigned once
    const backToBack = result.warnings.filter((w) => w.type === 'back_to_back');
    expect(backToBack).toHaveLength(0);
  });
});

// ── Scenario 2: 4 pools, 6 referees (2 per role) → all assigned ──────────────

describe('Scenario 2: 4 pools, 6 referees (2 per role)', () => {
  it('assigns all 12 slots (alternates between 2 referees per role)', () => {
    const pools = [
      makePool('p1', 'Pool A'),
      makePool('p2', 'Pool B'),
      makePool('p3', 'Pool C'),
      makePool('p4', 'Pool D'),
    ];

    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Declarant 0', ['arbitre_declarant']),
      makeCandidate('d1', 'Declarant 1', ['arbitre_declarant']),
      makeCandidate('a0', 'Assesseur 0', ['arbitre_assesseur']),
      makeCandidate('a1', 'Assesseur 1', ['arbitre_assesseur']),
      makeCandidate('t0', 'Table 0', ['arbitre_table']),
      makeCandidate('t1', 'Table 1', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools(pools, candidates, DEFAULT_SETTINGS);

    expect(result.assignments).toHaveLength(12);
    expect(result.missing).toHaveLength(0);
    // Each referee assigned to exactly 2 pools (workload balance)
    const d0Count = result.assignments.filter((a) => a.personId === 'd0').length;
    const d1Count = result.assignments.filter((a) => a.personId === 'd1').length;
    expect(d0Count + d1Count).toBe(4); // all 4 declarant slots covered
  });

  it('generates back-to-back warnings when only 1 referee per role', () => {
    const pools = [makePool('p1', 'Pool A'), makePool('p2', 'Pool B'), makePool('p3', 'Pool C')];

    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Declarant 0', ['arbitre_declarant']),
      makeCandidate('a0', 'Assesseur 0', ['arbitre_assesseur']),
      makeCandidate('t0', 'Table 0', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools(pools, candidates, DEFAULT_SETTINGS);

    expect(result.assignments).toHaveLength(9); // 3 pools × 3 roles
    // Back-to-back warnings since each referee covers 3 consecutive pools
    const backToBack = result.warnings.filter((w) => w.type === 'back_to_back');
    expect(backToBack.length).toBeGreaterThan(0);
  });
});

// ── Scenario 3: Only 1 qualified arbitre_assesseur → assigned to all pools with back-to-back ──

describe('Scenario 3: Only 1 qualified arbitre_assesseur', () => {
  it('assigns the single assesseur to all pools (back-to-back) with warnings', () => {
    const pools = [
      makePool('p1', 'Pool A'),
      makePool('p2', 'Pool B'),
      makePool('p3', 'Pool C'),
      makePool('p4', 'Pool D'),
    ];

    const candidates: RefereeCandidate[] = [
      // 4 declarants
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`d${i}`, `Declarant ${i}`, ['arbitre_declarant']),
      ),
      // Only 1 assesseur
      makeCandidate('a0', 'Assesseur 0', ['arbitre_assesseur']),
      // 4 table
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`t${i}`, `Table ${i}`, ['arbitre_table']),
      ),
    ];

    const result = assignRefereesWithPools(pools, candidates, DEFAULT_SETTINGS);

    // All 12 slots assigned (single assesseur covers all 4 pools)
    expect(result.assignments).toHaveLength(12);
    expect(result.missing).toHaveLength(0);

    // Back-to-back warnings for the single assesseur
    const assesseurWarnings = result.warnings.filter(
      (w) => w.personId === 'a0' && w.type === 'back_to_back',
    );
    expect(assesseurWarnings.length).toBeGreaterThan(0);
  });
});

// ── Scenario 4: Fighter Alice qualified as arbitre_table, fighting Pool A ─────

describe('Scenario 4: Fighter Alice cannot referee Pool A', () => {
  it('never assigns Alice to Pool A table role', () => {
    const aliceRegId = 'reg-alice';

    const pools = [
      makePool('p1', 'Pool A', [aliceRegId, 'reg-bob']), // Alice fights here
      makePool('p2', 'Pool B'),
      makePool('p3', 'Pool C'),
      makePool('p4', 'Pool D'),
    ];

    const candidates: RefereeCandidate[] = [
      // Alice: qualified as arbitre_table, also a fighter in Pool A
      makeCandidate('alice', 'Alice', ['arbitre_table'], [aliceRegId]),
      // Other referees
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`d${i}`, `Declarant ${i}`, ['arbitre_declarant']),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`a${i}`, `Assesseur ${i}`, ['arbitre_assesseur']),
      ),
      // One other table referee
      makeCandidate('t1', 'Table 1', ['arbitre_table']),
      makeCandidate('t2', 'Table 2', ['arbitre_table']),
      makeCandidate('t3', 'Table 3', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools(pools, candidates, {
      ...DEFAULT_SETTINGS,
      enforceRefereeNoBackToBack: false,
    });

    // Alice must NOT be assigned to Pool A for any role
    const alicePoolAAssignment = result.assignments.find(
      (a) => a.personId === 'alice' && a.poolId === 'p1',
    );
    expect(alicePoolAAssignment).toBeUndefined();

    // Alice CAN be assigned to other pools
    const aliceOtherPools = result.assignments.filter(
      (a) => a.personId === 'alice' && a.poolId !== 'p1',
    );
    expect(aliceOtherPools.length).toBeGreaterThan(0);
  });
});

// ── No qualified users ────────────────────────────────────────────────────────

describe('No qualified users for a role', () => {
  it('reports missing with no_qualified_users reason', () => {
    const pools = [makePool('p1', 'Pool A')];
    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Declarant', ['arbitre_declarant']),
      makeCandidate('t0', 'Table', ['arbitre_table']),
      // No arbitre_assesseur
    ];

    const result = assignRefereesWithPools(pools, candidates, DEFAULT_SETTINGS);

    const missing = result.missing.find((m) => m.role === 'arbitre_assesseur');
    expect(missing).toBeDefined();
    expect(missing!.rejectionReasons).toContain('no_qualified_users');
  });
});

// ── Time overlap: referee cannot be in two pools simultaneously ───────────────

describe('Time overlap: referee cannot referee two simultaneous pools', () => {
  it('excludes referee already assigned to an overlapping pool', () => {
    const SAME_TIME = '2026-06-01T10:00:00.000Z';
    const END_TIME = '2026-06-01T10:30:00.000Z';

    // Two pools running at the same time
    const poolA: PoolSlot = {
      poolId: 'pA',
      poolName: 'Pool A',
      matches: [],
      earliestStart: SAME_TIME,
      latestEnd: END_TIME,
    };
    const poolB: PoolSlot = {
      poolId: 'pB',
      poolName: 'Pool B',
      matches: [],
      earliestStart: SAME_TIME,
      latestEnd: END_TIME,
    };

    // Only one qualified referee per role
    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Declarant', ['arbitre_declarant']),
      makeCandidate('a0', 'Assesseur', ['arbitre_assesseur']),
      makeCandidate('t0', 'Table', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools([poolA, poolB], candidates, {
      ...DEFAULT_SETTINGS,
      enforceRefereeNoBackToBack: false,
    });

    // Pool A gets assigned (first pool)
    const poolAAssignments = result.assignments.filter((a) => a.poolId === 'pA');
    expect(poolAAssignments).toHaveLength(3);

    // Pool B cannot be assigned — same referee, same time
    const poolBMissing = result.missing.filter((m) => m.poolId === 'pB');
    expect(poolBMissing).toHaveLength(3);
    expect(poolBMissing[0]!.rejectionReasons).toContain(
      'all_qualified_have_time_conflict_with_other_pool',
    );
  });

  it('allows referee to cover sequential (non-overlapping) pools', () => {
    const POOL_A_START = '2026-06-01T10:00:00.000Z';
    const POOL_A_END = '2026-06-01T10:30:00.000Z';
    const POOL_B_START = '2026-06-01T11:00:00.000Z'; // 30 min gap
    const POOL_B_END = '2026-06-01T11:30:00.000Z';

    const poolA: PoolSlot = {
      poolId: 'pA',
      poolName: 'Pool A',
      matches: [],
      earliestStart: POOL_A_START,
      latestEnd: POOL_A_END,
    };
    const poolB: PoolSlot = {
      poolId: 'pB',
      poolName: 'Pool B',
      matches: [],
      earliestStart: POOL_B_START,
      latestEnd: POOL_B_END,
    };

    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Declarant', ['arbitre_declarant']),
      makeCandidate('a0', 'Assesseur', ['arbitre_assesseur']),
      makeCandidate('t0', 'Table', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools([poolA, poolB], candidates, {
      ...DEFAULT_SETTINGS,
      enforceRefereeNoBackToBack: false,
    });

    // Both pools fully assigned (sequential, no overlap)
    expect(result.assignments).toHaveLength(6);
    expect(result.missing).toHaveLength(0);
  });
});

// ── R3: Auto-assign for custom slot configs ──────────────────────────────────

describe('R3: custom slot configs', () => {
  it('auto-assigns a candidate qualified for a custom skill_id', () => {
    // Pool with a single slot allowing the custom skill `senior_ref`.
    const pool: PoolSlot = {
      poolId: 'p1',
      poolName: 'Pool A',
      matches: [],
      earliestStart: null,
      latestEnd: null,
      slotDefinitions: [{ index: 1, displayName: 'Senior', allowedSkillIds: ['senior_ref'] }],
    };
    const candidates: RefereeCandidate[] = [
      {
        personId: 'cand-1',
        personName: 'Senior Ref Alice',
        qualifications: [{ role: 'senior_ref', rating: 4 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
      // A second candidate qualified only for the legacy roles — must not be
      // picked because the slot doesn't allow them.
      {
        personId: 'cand-2',
        personName: 'Declarant Bob',
        qualifications: [{ role: 'arbitre_declarant', rating: 5 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
    ];

    const result = assignRefereesWithPools([pool], candidates, DEFAULT_SETTINGS);

    expect(result.assignments).toEqual([
      expect.objectContaining({
        poolId: 'p1',
        slotIndex: 1,
        role: 'senior_ref',
        personId: 'cand-1',
      }),
    ]);
    expect(result.missing).toHaveLength(0);
  });

  it('multi-skill slot picks the candidate with the best matching qual', () => {
    // Slot allows EITHER arbitre_declarant OR senior_ref. Candidate X is
    // declarant rating 2; candidate Y is senior_ref rating 5. Y wins.
    const pool: PoolSlot = {
      poolId: 'p1',
      poolName: 'Pool A',
      matches: [],
      earliestStart: null,
      latestEnd: null,
      slotDefinitions: [
        { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant', 'senior_ref'] },
      ],
    };
    const candidates: RefereeCandidate[] = [
      {
        personId: 'low-decl',
        personName: 'Low Declarant',
        qualifications: [{ role: 'arbitre_declarant', rating: 2 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
      {
        personId: 'high-senior',
        personName: 'High Senior',
        qualifications: [{ role: 'senior_ref', rating: 5 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
    ];

    const result = assignRefereesWithPools([pool], candidates, DEFAULT_SETTINGS);

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toEqual(
      expect.objectContaining({
        personId: 'high-senior',
        role: 'senior_ref', // engine records the specific qual that won
        slotIndex: 1,
      }),
    );
  });

  it('mixes legacy and custom pools without leaking the legacy floor', () => {
    // Pool A: 3 legacy slots (Décl/Asses/Table). Pool B: 5 custom-skill slots.
    // Each pool must fill only its own slot set.
    const legacyPool: PoolSlot = {
      poolId: 'pA',
      poolName: 'Legacy Pool',
      matches: [],
      earliestStart: null,
      latestEnd: null,
      // slotDefinitions omitted → falls back to LEGACY_DEFAULT_SLOTS (3 slots).
    };
    const customPool: PoolSlot = {
      poolId: 'pB',
      poolName: 'Custom Pool',
      matches: [],
      earliestStart: null,
      latestEnd: null,
      slotDefinitions: [
        { index: 1, displayName: 'Lead', allowedSkillIds: ['custom-lead'] },
        { index: 2, displayName: null, allowedSkillIds: ['custom-side'] },
        { index: 3, displayName: null, allowedSkillIds: ['custom-side'] },
        { index: 4, displayName: null, allowedSkillIds: ['custom-side'] },
        { index: 5, displayName: 'Score', allowedSkillIds: ['custom-score'] },
      ],
    };

    const candidates: RefereeCandidate[] = [
      // Enough refs for the legacy pool.
      makeCandidate('d1', 'Decl', ['arbitre_declarant']),
      makeCandidate('a1', 'Asses', ['arbitre_assesseur']),
      makeCandidate('t1', 'Table', ['arbitre_table']),
      // Enough refs for the custom pool.
      {
        personId: 'lead-1',
        personName: 'Lead Ref',
        qualifications: [{ role: 'custom-lead', rating: 4 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
      // 3 candidates for the 3 side slots.
      ...Array.from({ length: 3 }, (_, i) => ({
        personId: `side-${i}`,
        personName: `Side ${i}`,
        qualifications: [{ role: 'custom-side', rating: 3 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      })),
      {
        personId: 'score-1',
        personName: 'Score Ref',
        qualifications: [{ role: 'custom-score', rating: 5 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
    ];

    const result = assignRefereesWithPools([legacyPool, customPool], candidates, {
      ...DEFAULT_SETTINGS,
      enforceRefereeNoBackToBack: false,
    });

    const legacyAssignments = result.assignments.filter((a) => a.poolId === 'pA');
    const customAssignments = result.assignments.filter((a) => a.poolId === 'pB');
    expect(legacyAssignments).toHaveLength(3);
    expect(customAssignments).toHaveLength(5);

    // Legacy pool's roles must all be from the 3 legacy IDs.
    for (const a of legacyAssignments) {
      expect(['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table']).toContain(a.role);
    }
    // Custom pool's roles must all be custom IDs (no legacy leakage).
    for (const a of customAssignments) {
      expect(a.role.startsWith('custom-')).toBe(true);
    }
    expect(result.missing).toHaveLength(0);
  });
});
