/**
 * referee-assigner.test.ts — the engine asks the one checker (W1.3, ADR-016 + ADR-019).
 *
 * The checker's rules are proved in referee-checker*.test.ts and referee-load.test.ts.
 * Here: that the engine asks it for every candidate with the run's proposals as duties,
 * picks only Fine, words an empty slot by the checker's codes, and keeps its two seat
 * rules and its ranking.
 */
import { describe, expect, it } from 'vitest';
import {
  assignReferees,
  type EngineRules,
  type PoolSlot,
  type RefereeCandidate,
} from './referee-assigner';
import { ANY_AVAILABILITY, type RefereeCommitment, type RefereeSwitches } from './referee-checker';

const MIN = 60_000;
const T0 = Date.parse('2026-10-03T08:00:00Z');
const w = (from: number, to: number) => ({ startMs: T0 + from * MIN, endMs: T0 + to * MIN });

const RULES_OFF: RefereeSwitches = {
  ownPool: true,
  ownPoolSpan: true,
  twoRoles: true,
  attendWorkshop: true,
  restSlots: 0,
  maxBoutsPerDay: 0,
};
const RANKED = { ratingBasedOrdering: true, workloadBalance: true };
const ONE_SLOT = [{ index: 1, displayName: null, allowedSkillIds: ['decl'] }];

/** A Pool on day 0: `slot` is its day slot, `from`/`to` minutes after 08:00. */
function pool(id: string, slot: number | null, from: number, to: number, bouts = 2): PoolSlot {
  return {
    poolId: id,
    poolName: id,
    label: `Longsword · ${id}`,
    slotDefinitions: ONE_SLOT,
    target: {
      scope: 'pool',
      unitId: id,
      poolId: id,
      groupId: id,
      matchIds: Array.from({ length: bouts }, (_, i) => `${id}-m${i}`),
      window: w(from, to),
      tournamentId: 'longsword',
      dayIndex: 0,
      slot,
    },
  };
}

const ref = (id: string, rating = 3, roles = ['decl']): RefereeCandidate => ({
  personId: id,
  personName: id,
  qualifications: roles.map((role) => ({ role, rating })),
});

function rules(
  commitments: RefereeCommitment[] = [],
  switches: Partial<RefereeSwitches> = {},
  availabilityOf: EngineRules['availabilityOf'] = () => ANY_AVAILABILITY,
): EngineRules {
  const commitmentsByPerson = new Map<string, RefereeCommitment[]>();
  for (const c of commitments) {
    commitmentsByPerson.set(c.personId, [...(commitmentsByPerson.get(c.personId) ?? []), c]);
  }
  return { commitmentsByPerson, availabilityOf, switches: { ...RULES_OFF, ...switches } };
}

const picked = (r: ReturnType<typeof assignReferees>) =>
  r.assignments.map((a) => `${a.poolId}:${a.personId}`);
const reasonsOf = (r: ReturnType<typeof assignReferees>) =>
  r.missing.map((m) => `${m.poolId}:${m.rejectionReasons.join('+')}`);

describe('seat rules', () => {
  it('reports no_qualified_users when nobody holds a skill the slot allows', () => {
    const r = assignReferees([pool('A', 0, 0, 60)], [ref('ann', 3, ['table'])], RANKED, rules());
    expect(reasonsOf(r)).toEqual(['A:no_qualified_users']);
  });

  it('never seats one person twice in the same role of one unit', () => {
    const twoDecl = {
      ...pool('A', 0, 0, 60),
      slotDefinitions: [ONE_SLOT[0]!, { ...ONE_SLOT[0]!, index: 2 }],
    };
    const r = assignReferees([twoDecl], [ref('ann')], RANKED, rules());
    expect(picked(r)).toEqual(['A:ann']);
    expect(reasonsOf(r)).toEqual(['A:all_qualified_already_seated']);
  });

  it('gives two roles on one unit only when the two-roles rule is off', () => {
    const decl = ONE_SLOT[0]!;
    const both = {
      ...pool('A', 0, 0, 60),
      slotDefinitions: [decl, { index: 2, displayName: null, allowedSkillIds: ['table'] }],
    };
    const ann = ref('ann', 3, ['decl', 'table']);
    expect(reasonsOf(assignReferees([both], [ann], RANKED, rules()))).toEqual(['A:two_roles']);
    const off = assignReferees([both], [ann], RANKED, rules([], { twoRoles: false }));
    expect(picked(off)).toEqual(['A:ann', 'A:ann']);
  });
});

describe('the checker decides who may take a slot', () => {
  const at = (personId: string, extra: Partial<RefereeCommitment>): RefereeCommitment =>
    ({ personId, label: 'x', window: w(10, 20), ...extra }) as RefereeCommitment;

  it('never picks a Discouraged candidate, and never an Impossible one', () => {
    const commitments = [
      at('own', { kind: 'fight-pool', groupId: 'A', window: w(0, 60) }),
      at('fights', { kind: 'fight', matchId: 'x1', groupId: 'X' }),
      at('teaches', { kind: 'teach', sessionId: 's1' }),
      at('attends', { kind: 'attend', sessionId: 's1' }),
    ];
    const people = ['own', 'fights', 'teaches', 'attends'].map((id) => ref(id, 9));
    const r = assignReferees(
      [pool('A', 0, 0, 60)],
      [...people, ref('free', 1)],
      RANKED,
      rules(commitments),
    );
    expect(picked(r)).toEqual(['A:free']);
  });

  it('words an empty slot by every code that refused someone, in the checker order', () => {
    const commitments = [
      at('teaches', { kind: 'teach', sessionId: 's1' }),
      at('own', { kind: 'fight-pool', groupId: 'A', window: w(0, 60) }),
    ];
    const away = () => ({ tournamentIds: ['other'], dayIndices: null });
    const r = assignReferees(
      [pool('A', 0, 0, 60)],
      [ref('own'), ref('teaches'), ref('away')],
      RANKED,
      rules(commitments, {}, (id) => (id === 'away' ? away() : ANY_AVAILABILITY)),
    );
    expect(reasonsOf(r)).toEqual(['A:teaches_overlap+outside_availability+own_pool']);
  });

  it('holds a kept (manual) duty against the candidate', () => {
    const manual = at('ann', {
      kind: 'referee',
      unitId: 'B',
      poolId: 'B',
      matchId: null,
      role: 'decl',
      matchIds: ['B-m0'],
      slot: 0,
      dayIndex: 0,
      window: w(30, 90),
    });
    const r = assignReferees([pool('A', 0, 0, 60)], [ref('ann')], RANKED, rules([manual]));
    expect(reasonsOf(r)).toEqual(['A:referees_overlap']);
  });
});

describe("the run's own proposals are duties", () => {
  it('does not double-book one referee on two Pools at the same time', () => {
    const r = assignReferees(
      [pool('A', 0, 0, 60), pool('B', 0, 0, 60)],
      [ref('ann')],
      RANKED,
      rules(),
    );
    expect(picked(r)).toEqual(['A:ann']);
    expect(reasonsOf(r)).toEqual(['B:referees_overlap']);
  });

  it('rests a referee for restSlots day slots — counted in slots, not minutes', () => {
    // 08:00, 10:00, and 14:00 after a long lunch: three slots.
    const day = [pool('A', 0, 0, 60), pool('B', 1, 120, 180), pool('C', 2, 360, 420)];
    const r = assignReferees(day, [ref('ann')], RANKED, rules([], { restSlots: 1 }));
    expect(picked(r)).toEqual(['A:ann', 'C:ann']);
    expect(reasonsOf(r)).toEqual(['B:rest']);
    const noRest = assignReferees(day, [ref('ann')], RANKED, rules());
    expect(picked(noRest)).toEqual(['A:ann', 'B:ann', 'C:ann']);
  });

  it('never rests around a bracket bout (no slot, ruling 139)', () => {
    const bout = {
      ...pool('F1', null, 70, 80, 1),
      target: {
        ...pool('F1', null, 70, 80, 1).target,
        scope: 'match' as const,
        poolId: null,
        groupId: null,
      },
    };
    const r = assignReferees(
      [pool('A', 0, 0, 60), bout],
      [ref('ann')],
      RANKED,
      rules([], { restSlots: 1 }),
    );
    expect(picked(r)).toEqual(['A:ann', 'F1:ann']);
  });

  it("stops at the day's bout cap", () => {
    const day = [pool('A', 0, 0, 60, 3), pool('B', 2, 240, 300, 3)];
    const r = assignReferees(day, [ref('ann')], RANKED, rules([], { maxBoutsPerDay: 5 }));
    expect(picked(r)).toEqual(['A:ann']);
    expect(reasonsOf(r)).toEqual(['B:cap']);
    expect(
      picked(assignReferees(day, [ref('ann')], RANKED, rules([], { maxBoutsPerDay: 6 }))),
    ).toEqual(['A:ann', 'B:ann']);
  });
});

describe('ranking and priors', () => {
  it('prefers the higher rating, then the less loaded', () => {
    const day = [pool('A', 0, 0, 60), pool('B', 2, 240, 300)];
    expect(picked(assignReferees(day, [ref('low', 1), ref('high', 5)], RANKED, rules()))).toEqual([
      'A:high',
      'B:high',
    ]);
    const balanced = { ratingBasedOrdering: false, workloadBalance: true };
    expect(picked(assignReferees(day, [ref('ann'), ref('bob')], balanced, rules()))).toEqual([
      'A:ann',
      'B:bob',
    ]);
  });

  it('leaves a manually filled slot alone and counts it toward workload', () => {
    const day = [pool('A', 0, 0, 60), pool('B', 2, 240, 300)];
    const prior = [{ poolId: 'A', role: 'decl', personId: 'ann' }];
    const balanced = { ratingBasedOrdering: false, workloadBalance: true };
    const r = assignReferees(day, [ref('ann'), ref('bob')], balanced, rules(), prior);
    expect(picked(r)).toEqual(['B:bob']);
    expect(r.missing).toEqual([]);
  });

  it('picks the best matching skill of a multi-skill slot, and stamps finals', () => {
    const multi = {
      ...pool('F', 0, 0, 60),
      isFinals: true,
      slotDefinitions: [{ index: 1, displayName: 'Head', allowedSkillIds: ['decl', 'senior'] }],
    };
    const ann: RefereeCandidate = {
      personId: 'ann',
      personName: 'ann',
      qualifications: [
        { role: 'decl', rating: 2 },
        { role: 'senior', rating: 4 },
      ],
    };
    const r = assignReferees([multi], [ann], RANKED, rules());
    expect(r.assignments).toEqual([
      {
        poolId: 'F',
        poolName: 'F',
        slotIndex: 1,
        role: 'senior',
        personId: 'ann',
        personName: 'ann',
        autoAssigned: true,
        isFinals: true,
      },
    ]);
  });
});
