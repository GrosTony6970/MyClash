import { describe, expect, it } from 'vitest';
import {
  refereeNamesOnly,
  resolveMatchReferees,
  type MatchRefereeTarget,
  type RefereeAssignmentRow,
} from './resolve-match-referees';

const target: MatchRefereeTarget = { matchId: 'm1', poolId: 'p1', liceId: 'l1' };

const row = (over: Partial<RefereeAssignmentRow>): RefereeAssignmentRow => ({
  scopeType: 'match',
  matchId: null,
  poolId: null,
  liceId: null,
  name: 'Ref',
  role: null,
  roleLabel: null,
  roleColor: 'slate',
  ...over,
});

const names = (rows: RefereeAssignmentRow[], t: MatchRefereeTarget = target) =>
  resolveMatchReferees(rows, t).map((r) => r.name);

describe('resolveMatchReferees', () => {
  it('returns [] when nothing covers the match', () => {
    expect(resolveMatchReferees([], target)).toEqual([]);
    expect(names([row({ scopeType: 'pool', poolId: 'OTHER', name: 'X' })])).toEqual([]);
  });

  it('prefers a match-scope assignment over pool/lice', () => {
    const rows = [
      row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' }),
      row({ scopeType: 'pool', poolId: 'p1', name: 'Pool Ref' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Match Ref' }),
    ];
    expect(names(rows)).toEqual(['Match Ref']);
  });

  it('falls back to the pool-scope assignment when there is no match one', () => {
    const rows = [
      row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' }),
      row({ scopeType: 'pool', poolId: 'p1', name: 'Pool Ref' }),
    ];
    expect(names(rows)).toEqual(['Pool Ref']);
  });

  it('uses the lice-scope assignment as a last resort', () => {
    expect(names([row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' })])).toEqual([
      'Lice Ref',
    ]);
  });

  it('returns every referee of the winning tier, deduped + non-empty', () => {
    const rows = [
      row({ scopeType: 'match', matchId: 'm1', name: 'Head', role: 'arbitre_declarant' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Assessor', role: 'arbitre_assesseur' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Head', role: 'arbitre_declarant' }), // dup
      row({ scopeType: 'match', matchId: 'm1', name: '  ' }), // empty
    ];
    expect(names(rows)).toEqual(['Head', 'Assessor']);
  });

  it('keeps one person twice when they hold two roles on the same match', () => {
    // Deduping by name alone would silently drop the second role — a screen
    // that looks correct while under-reporting who is officiating.
    const rows = [
      row({ scopeType: 'match', matchId: 'm1', name: 'Marc Lefevre', role: 'arbitre_declarant' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Marc Lefevre', role: 'arbitre_table' }),
    ];
    expect(resolveMatchReferees(rows, target)).toEqual([
      { name: 'Marc Lefevre', role: 'arbitre_declarant', roleLabel: null, roleColor: 'slate' },
      { name: 'Marc Lefevre', role: 'arbitre_table', roleLabel: null, roleColor: 'slate' },
    ]);
  });

  it('carries the role label and colour through to the caller', () => {
    const rows = [
      row({
        scopeType: 'match',
        matchId: 'm1',
        name: 'Marc Lefevre',
        role: 'arbitre_declarant',
        roleLabel: 'Déclarant',
        roleColor: 'orange',
      }),
    ];
    expect(resolveMatchReferees(rows, target)).toEqual([
      {
        name: 'Marc Lefevre',
        role: 'arbitre_declarant',
        roleLabel: 'Déclarant',
        roleColor: 'orange',
      },
    ]);
  });

  it('skips pool/lice tiers when the target has no pool/lice', () => {
    const rows = [
      row({ scopeType: 'pool', poolId: 'p1', name: 'Pool Ref' }),
      row({ scopeType: 'lice', liceId: 'l1', name: 'Lice Ref' }),
    ];
    expect(names(rows, { matchId: 'm1', poolId: null, liceId: null })).toEqual([]);
  });
});

// The public GET /matches/:id/summary ships `referees: string[]`, which the
// public match page renders as `referees.join(', ')`. These pin that contract.
describe('refereeNamesOnly', () => {
  it('collapses one person holding two roles back to a single name', () => {
    // Without this the public page would read "Marc Lefevre, Marc Lefevre".
    const rows = [
      row({ scopeType: 'match', matchId: 'm1', name: 'Marc Lefevre', role: 'arbitre_declarant' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Marc Lefevre', role: 'arbitre_table' }),
    ];
    expect(refereeNamesOnly(resolveMatchReferees(rows, target))).toEqual(['Marc Lefevre']);
  });

  it('preserves first-occurrence order, as the old name-keyed dedupe did', () => {
    const rows = [
      row({ scopeType: 'match', matchId: 'm1', name: 'Head', role: 'arbitre_declarant' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Assessor', role: 'arbitre_assesseur' }),
      row({ scopeType: 'match', matchId: 'm1', name: 'Head', role: 'arbitre_table' }),
    ];
    expect(refereeNamesOnly(resolveMatchReferees(rows, target))).toEqual(['Head', 'Assessor']);
  });

  it('is empty for an empty resolution', () => {
    expect(refereeNamesOnly([])).toEqual([]);
  });
});
