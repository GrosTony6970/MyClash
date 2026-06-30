import { describe, it, expect } from 'vitest';
import { buildSelfPoolHighlight } from './self-pool-highlight';

const pools = [
  {
    id: 'p1',
    name: 'Pool 1',
    members: [{ registrationId: 'r-alice' }, { registrationId: 'r-bob' }],
  },
  { id: 'p2', name: 'Pool 2', members: [{ registrationId: 'r-carol' }] },
  { id: 'p3', name: 'Pool 3', members: [{ registrationId: 'r-dave' }] },
];

describe('buildSelfPoolHighlight', () => {
  it('returns empty when the viewer is neither fighter nor referee here', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: null,
    });
    expect(out).toEqual({ ringPoolIds: [], refereeRowKeys: [], scrollTargetPoolId: null });
  });

  it('rings + targets the fighting pool (fighter only)', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: 'r-bob',
    });
    expect(out.ringPoolIds).toEqual(['p1']);
    expect(out.refereeRowKeys).toEqual([]);
    expect(out.scrollTargetPoolId).toBe('p1');
  });

  it('matches a referee row by tournament + pool name + role; target follows display order', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [
        { tournamentName: 'Sidesword Open', poolName: 'Pool 3', role: 'arbitre_declarant' },
      ],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: null,
    });
    expect(out.ringPoolIds).toEqual(['p3']);
    expect(out.refereeRowKeys).toEqual(['p3::arbitre_declarant']);
    // Non-first pool — confirms the scroll target is the matched pool, not pools[0].
    expect(out.scrollTargetPoolId).toBe('p3');
  });

  it('rings every refereed pool but scrolls to the first in display order', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [
        { tournamentName: 'Sidesword Open', poolName: 'Pool 3', role: 'arbitre_table' },
        { tournamentName: 'Sidesword Open', poolName: 'Pool 2', role: 'arbitre_assesseur' },
      ],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: null,
    });
    expect(out.ringPoolIds).toEqual(['p2', 'p3']);
    expect(out.scrollTargetPoolId).toBe('p2');
  });

  it('when both fighter and referee, rings both and scrolls to the fighting pool first', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [
        { tournamentName: 'Sidesword Open', poolName: 'Pool 1', role: 'arbitre_declarant' },
      ],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: 'r-carol', // fights in Pool 2
    });
    // Fighter pool (p2) first, then refereed pool (p1); deduped.
    expect(out.ringPoolIds).toEqual(['p2', 'p1']);
    expect(out.refereeRowKeys).toEqual(['p1::arbitre_declarant']);
    expect(out.scrollTargetPoolId).toBe('p2');
  });

  it('dedups when the viewer fights AND referees the same pool', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [
        { tournamentName: 'Sidesword Open', poolName: 'Pool 1', role: 'arbitre_declarant' },
      ],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: 'r-alice', // also fights in Pool 1
    });
    expect(out.ringPoolIds).toEqual(['p1']);
    expect(out.refereeRowKeys).toEqual(['p1::arbitre_declarant']);
    expect(out.scrollTargetPoolId).toBe('p1');
  });

  it('excludes a pool name that belongs to a different tournament', () => {
    const out = buildSelfPoolHighlight({
      refereeOf: [
        // Same pool name, but the assignment is for another tournament.
        { tournamentName: 'Longsword Open', poolName: 'Pool 1', role: 'arbitre_declarant' },
      ],
      tournamentName: 'Sidesword Open',
      pools,
      highlightRegistrationId: null,
    });
    expect(out).toEqual({ ringPoolIds: [], refereeRowKeys: [], scrollTargetPoolId: null });
  });
});
