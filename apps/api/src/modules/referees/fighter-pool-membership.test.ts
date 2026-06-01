import { describe, expect, it } from 'vitest';
import { buildFightersByPool } from './fighter-pool-membership';

describe('buildFightersByPool', () => {
  it('indexes pool members by poolId so the persist guard can check person ∈ pool', () => {
    const result = buildFightersByPool([
      {
        id: 'pool-1',
        members: [{ personId: 'thomas' }, { personId: 'sasha' }],
      },
    ]);
    expect(result.get('pool-1')?.has('thomas')).toBe(true);
    expect(result.get('pool-1')?.has('sasha')).toBe(true);
    expect(result.get('pool-1')?.has('egon')).toBe(false);
  });

  it('yields an empty Set for a pool with no members (not undefined)', () => {
    const result = buildFightersByPool([{ id: 'pool-empty', members: [] }]);
    expect(result.get('pool-empty')).toBeInstanceOf(Set);
    expect(result.get('pool-empty')?.size).toBe(0);
  });

  it('keeps the same person on each pool they belong to (deterministic across pools)', () => {
    const result = buildFightersByPool([
      { id: 'pool-1', members: [{ personId: 'thomas' }] },
      { id: 'pool-2', members: [{ personId: 'thomas' }, { personId: 'mireille' }] },
    ]);
    expect(result.get('pool-1')?.has('thomas')).toBe(true);
    expect(result.get('pool-2')?.has('thomas')).toBe(true);
    expect(result.get('pool-2')?.has('mireille')).toBe(true);
  });
});
