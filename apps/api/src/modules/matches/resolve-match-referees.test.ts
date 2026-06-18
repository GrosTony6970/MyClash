import { describe, expect, it } from 'vitest';
import { resolveMatchReferees, type RefereeAssignmentRow } from './resolve-match-referees';

const target = { matchId: 'm1', poolId: 'p1', liceId: 'l1' };

const row = (over: Partial<RefereeAssignmentRow>): RefereeAssignmentRow => ({
  scopeType: 'match',
  matchId: null,
  poolId: null,
  liceId: null,
  name: 'Ref',
  ...over,
});

describe('resolveMatchReferees', () => {
  it('returns [] when nothing covers the match', () => {
    expect(resolveMatchReferees([], target)).toEqual([]);
    expect(
      resolveMatchReferees([row({ scopeType: 'pool', poolId: 'OTHER', name: 'X' })], target),
    ).toEqual([]);
  });

  it('prefers a match-scope assignment over pool/lice', () => {
    const rows = [
      row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' }),
      row({ scopeType: 'pool', poolId: 'p1', name: 'Pool Ref' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Match Ref' }),
    ];
    expect(resolveMatchReferees(rows, target)).toEqual(['Match Ref']);
  });

  it('falls back to the pool-scope assignment when there is no match one', () => {
    const rows = [
      row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' }),
      row({ scopeType: 'pool', poolId: 'p1', name: 'Pool Ref' }),
    ];
    expect(resolveMatchReferees(rows, target)).toEqual(['Pool Ref']);
  });

  it('uses the lice-scope assignment as a last resort', () => {
    const rows = [row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' })];
    expect(resolveMatchReferees(rows, target)).toEqual(['Lice Ref']);
  });

  it('returns every referee of the winning tier, deduped + non-empty', () => {
    const rows = [
      row({ scopeType: 'match', matchId: 'm1', name: 'Head' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Assessor' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Head' }), // dup
      row({ scopeType: 'match', matchId: 'm1', name: '  ' }), // empty
    ];
    expect(resolveMatchReferees(rows, target)).toEqual(['Head', 'Assessor']);
  });

  it('skips pool/lice tiers when the target has no pool/lice', () => {
    const rows = [
      row({ scopeType: 'pool', poolId: 'p1', name: 'Pool Ref' }),
      row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' }),
    ];
    expect(resolveMatchReferees(rows, { matchId: 'm1', poolId: null, liceId: null })).toEqual([]);
  });
});
