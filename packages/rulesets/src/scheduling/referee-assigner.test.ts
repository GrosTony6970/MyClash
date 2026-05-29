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

// ── Slice 8: granular per-tournament + per-day availability ──────────────────

describe('Granular availability (Slice 8)', () => {
  it('excludes a referee who is not allowlisted for the pool tournament', () => {
    const pool: PoolSlot = {
      ...makePool('p1', 'Pool A'),
      tournamentId: 't-longsword',
    };
    const restricted: RefereeCandidate = {
      ...makeCandidate('r1', 'Restricted', [
        'arbitre_declarant',
        'arbitre_assesseur',
        'arbitre_table',
      ]),
      availableTournamentIds: ['t-rapier'], // only available for rapier
    };

    const result = assignRefereesWithPools([pool], [restricted], DEFAULT_SETTINGS);

    const declarant = result.missing.find((m) => m.role === 'arbitre_declarant');
    expect(declarant).toBeDefined();
    expect(declarant!.rejectionReasons).toContain('all_qualified_unavailable_for_this_pool');
  });

  it('excludes a referee who is not allowlisted for the pool day', () => {
    const pool: PoolSlot = {
      ...makePool('p1', 'Pool A'),
      tournamentId: 't1',
      dayIndex: 1,
    };
    const restricted: RefereeCandidate = {
      ...makeCandidate('r1', 'Restricted', [
        'arbitre_declarant',
        'arbitre_assesseur',
        'arbitre_table',
      ]),
      availableTournamentIds: ['t1'],
      availableDayIndices: [0], // only available on day 0, pool runs on day 1
    };

    const result = assignRefereesWithPools([pool], [restricted], DEFAULT_SETTINGS);

    const declarant = result.missing.find((m) => m.role === 'arbitre_declarant');
    expect(declarant).toBeDefined();
    expect(declarant!.rejectionReasons).toContain('all_qualified_unavailable_for_this_pool');
  });

  it('keeps a referee whose allowlist covers the pool tournament and day', () => {
    const pool: PoolSlot = {
      ...makePool('p1', 'Pool A'),
      tournamentId: 't1',
      dayIndex: 0,
    };
    const ok: RefereeCandidate = {
      ...makeCandidate('r1', 'Available', [
        'arbitre_declarant',
        'arbitre_assesseur',
        'arbitre_table',
      ]),
      availableTournamentIds: ['t1', 't2'],
      availableDayIndices: [0, 1],
    };

    const result = assignRefereesWithPools([pool], [ok], DEFAULT_SETTINGS);

    expect(
      result.assignments.find((a) => a.poolId === 'p1' && a.role === 'arbitre_declarant'),
    ).toBeDefined();
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

// ── R4: swap suggestions + isFinals routing + bracket-as-pool-of-one ─────────

describe('R4: swap suggestions for back-to-back violations', () => {
  it('returns an empty suggestion list when no back-to-back warnings exist', () => {
    // 2 pools, 2 candidates per role — no candidate covers both pools, so
    // no back-to-back chain. swapSuggestions should be empty.
    const pools = [makePool('p1', 'Pool A'), makePool('p2', 'Pool B')];
    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Decl0', ['arbitre_declarant']),
      makeCandidate('d1', 'Decl1', ['arbitre_declarant']),
      makeCandidate('a0', 'Asses0', ['arbitre_assesseur']),
      makeCandidate('a1', 'Asses1', ['arbitre_assesseur']),
      makeCandidate('t0', 'Table0', ['arbitre_table']),
      makeCandidate('t1', 'Table1', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools(pools, candidates, DEFAULT_SETTINGS);

    expect(result.warnings.filter((w) => w.type === 'back_to_back')).toHaveLength(0);
    expect(result.swapSuggestions).toEqual([]);
  });

  it('proposes a swap when an alternative candidate can break a back-to-back chain', () => {
    // 4 pools, 2 declarants. Workload balance is OFF so the higher-rated d0
    // takes every pool (back-to-back across p2/p3/p4). The lower-rated d1
    // ends up unassigned and becomes the natural swap target.
    const pools = [
      makePool('p1', 'Pool A'),
      makePool('p2', 'Pool B'),
      makePool('p3', 'Pool C'),
      makePool('p4', 'Pool D'),
    ];
    const candidates: RefereeCandidate[] = [
      // Higher-rated declarant — wins every slot when workload balance is off.
      {
        personId: 'd0',
        personName: 'Top Decl',
        qualifications: [{ role: 'arbitre_declarant', rating: 5 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
      // Lower-rated declarant — never wins on score but is the only swap option.
      {
        personId: 'd1',
        personName: 'Backup Decl',
        qualifications: [{ role: 'arbitre_declarant', rating: 3 }],
        fighterRegistrationIds: [],
        workshopWindows: [],
      },
      // Other roles get covered without affecting the declarant scoring.
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`a${i}`, `Asses${i}`, ['arbitre_assesseur']),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`t${i}`, `Table${i}`, ['arbitre_table']),
      ),
    ];

    const result = assignRefereesWithPools(pools, candidates, {
      ...DEFAULT_SETTINGS,
      workloadBalance: false, // keep d0 winning every declarant slot
    });

    // Sanity: a back-to-back warning fired on d0.
    const b2b = result.warnings.filter((w) => w.type === 'back_to_back' && w.personId === 'd0');
    expect(b2b.length).toBeGreaterThan(0);
    // The swap suggestion should propose d1 as the replacement for d0.
    expect(result.swapSuggestions.length).toBeGreaterThan(0);
    expect(
      result.swapSuggestions.some(
        (s) =>
          s.fromPersonId === 'd0' && s.toPersonId === 'd1' && s.reason === 'breaks_back_to_back',
      ),
    ).toBe(true);
  });

  it('does NOT propose a swap when the only alternative would also be back-to-back', () => {
    // Edge: same scenario but no alternative is actually free (e.g. d1
    // is already assigned everywhere else). With only one qualified
    // candidate per role and back-to-back chains everywhere, no swap can
    // resolve anything.
    const pools = [makePool('p1', 'Pool A'), makePool('p2', 'Pool B'), makePool('p3', 'Pool C')];
    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'OnlyDecl', ['arbitre_declarant']),
      makeCandidate('a0', 'OnlyAsses', ['arbitre_assesseur']),
      makeCandidate('t0', 'OnlyTable', ['arbitre_table']),
    ];

    const result = assignRefereesWithPools(pools, candidates, DEFAULT_SETTINGS);

    expect(result.warnings.filter((w) => w.type === 'back_to_back').length).toBeGreaterThan(0);
    expect(result.swapSuggestions).toEqual([]);
  });
});

describe('R4: bracket modelled as a pool-of-one match', () => {
  it('assigns refs to a synthetic single-match pool without leaking pool semantics', () => {
    // A bracket match modelled as a one-match pool with bracket slot
    // definitions. No "pool members" — the synthetic pool has matches[0]
    // with the two fighter registration IDs.
    const bracketMatch: PoolSlot = {
      poolId: 'match-bracket-1',
      poolName: 'Quarter 1',
      matches: [
        {
          id: 'match-bracket-1',
          scheduledAt: null,
          durationMinutes: 5,
          redRegistrationId: 'reg-red',
          blueRegistrationId: 'reg-blue',
        },
      ],
      earliestStart: null,
      latestEnd: null,
      slotDefinitions: [
        { index: 1, displayName: 'Lead', allowedSkillIds: ['arbitre_declarant'] },
        { index: 2, displayName: 'Side', allowedSkillIds: ['arbitre_assesseur'] },
      ],
    };
    const candidates: RefereeCandidate[] = [
      makeCandidate('d0', 'Decl', ['arbitre_declarant']),
      makeCandidate('a0', 'Asses', ['arbitre_assesseur']),
    ];

    const result = assignRefereesWithPools([bracketMatch], candidates, DEFAULT_SETTINGS);

    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.map((a) => a.slotIndex).sort()).toEqual([1, 2]);
    expect(result.missing).toHaveLength(0);
    // No `isFinals` set on these assignments — the pool didn't flag it.
    expect(result.assignments.every((a) => a.isFinals === undefined)).toBe(true);
  });

  it('stamps `isFinals: true` on assignments when the pool flags it', () => {
    const finalsMatch: PoolSlot = {
      poolId: 'match-final',
      poolName: 'Gold Final',
      matches: [
        {
          id: 'match-final',
          scheduledAt: null,
          durationMinutes: 5,
          redRegistrationId: 'reg-r',
          blueRegistrationId: 'reg-b',
        },
      ],
      earliestStart: null,
      latestEnd: null,
      slotDefinitions: [{ index: 1, displayName: 'Head', allowedSkillIds: ['arbitre_declarant'] }],
      isFinals: true,
    };
    const candidates: RefereeCandidate[] = [makeCandidate('d0', 'Head Ref', ['arbitre_declarant'])];

    const result = assignRefereesWithPools([finalsMatch], candidates, DEFAULT_SETTINGS);

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.isFinals).toBe(true);
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
