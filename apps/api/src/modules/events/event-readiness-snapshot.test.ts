import { describe, it, expect } from 'vitest';
import {
  buildReadinessSnapshot,
  type ReadinessRows,
  type ReadinessTournamentSnapshot,
} from './event-readiness';

/** One tournament, one pool phase, one pool, two matches — the smallest real event. */
function baseRows(overrides: Partial<ReadinessRows> = {}): ReadinessRows {
  return {
    liceCount: 1,
    tournaments: [{ id: 't1', name: 'Longsword', ruleset_code: 'TF_v1' }],
    registrations: [
      { tournament_id: 't1', status: 'confirmed' },
      { tournament_id: 't1', status: 'confirmed' },
    ],
    phases: [{ id: 'ph-pool', tournament_id: 't1', type: 'pool' }],
    pools: [{ id: 'p1', phase_id: 'ph-pool' }],
    matches: [
      { id: 'm1', pool_id: 'p1', lice_id: 'l1', scheduled_at: '2026-08-01T09:00:00Z' },
      { id: 'm2', pool_id: 'p1', lice_id: 'l1', scheduled_at: '2026-08-01T09:20:00Z' },
    ],
    refereeAssignments: [{ pool_id: 'p1', match_id: null }],
    ...overrides,
  };
}

function onlyTournament(rows: ReadinessRows): ReadinessTournamentSnapshot {
  const [tournament] = buildReadinessSnapshot(rows).tournaments;
  if (!tournament) throw new Error('expected one tournament in the snapshot');
  return tournament;
}

describe('buildReadinessSnapshot — folding rows into the snapshot', () => {
  it('carries the event lice count and tournament identity through', () => {
    const snapshot = buildReadinessSnapshot(baseRows({ liceCount: 3 }));
    expect(snapshot.liceCount).toBe(3);
    expect(snapshot.tournaments).toHaveLength(1);
    expect(snapshot.tournaments[0]).toMatchObject({
      id: 't1',
      name: 'Longsword',
      rulesetCode: 'TF_v1',
    });
  });

  it('keeps a tournament with no phases at all, reporting neither format', () => {
    const tournament = onlyTournament(baseRows({ phases: [], pools: [], matches: [] }));
    expect(tournament.hasPoolPhase).toBe(false);
    expect(tournament.hasElimPhase).toBe(false);
    expect(tournament.poolCount).toBe(0);
  });

  it.each([
    ['single_elim', true],
    ['double_elim', true],
    ['pool', false],
  ])('reads %s as hasElimPhase=%s', (type, expected) => {
    const tournament = onlyTournament(
      baseRows({
        phases: [
          { id: 'ph-pool', tournament_id: 't1', type: 'pool' },
          { id: 'ph-2', tournament_id: 't1', type },
        ],
      }),
    );
    expect(tournament.hasElimPhase).toBe(expected);
  });
});

describe('buildReadinessSnapshot — active registrations', () => {
  it('excludes waitlisted, withdrawn and disqualified entries', () => {
    const tournament = onlyTournament(
      baseRows({
        registrations: [
          { tournament_id: 't1', status: 'confirmed' },
          { tournament_id: 't1', status: 'waitlist' },
          { tournament_id: 't1', status: 'withdrawn' },
          { tournament_id: 't1', status: 'disqualified' },
        ],
      }),
    );
    expect(tournament.activeFighterCount).toBe(1);
  });

  it('counts a null status as active rather than dropping the fighter', () => {
    const tournament = onlyTournament(
      baseRows({ registrations: [{ tournament_id: 't1', status: null }] }),
    );
    expect(tournament.activeFighterCount).toBe(1);
  });

  it('does not leak another tournament’s registrations', () => {
    const tournament = onlyTournament(
      baseRows({
        registrations: [
          { tournament_id: 't1', status: 'confirmed' },
          { tournament_id: 'other', status: 'confirmed' },
          { tournament_id: 'other', status: 'confirmed' },
        ],
      }),
    );
    expect(tournament.activeFighterCount).toBe(1);
  });
});

describe('buildReadinessSnapshot — pool referee coverage', () => {
  it('counts a pool-scoped assignment', () => {
    expect(onlyTournament(baseRows()).poolsWithoutReferee).toBe(0);
  });

  it('counts a MATCH-scoped assignment as covering its pool', () => {
    const tournament = onlyTournament(
      baseRows({ refereeAssignments: [{ pool_id: null, match_id: 'm2' }] }),
    );
    expect(tournament.poolsWithoutReferee).toBe(0);
  });

  it('reports an unstaffed pool', () => {
    const tournament = onlyTournament(baseRows({ refereeAssignments: [] }));
    expect(tournament.poolCount).toBe(1);
    expect(tournament.poolsWithoutReferee).toBe(1);
  });

  it('counts only the pools left uncovered when several exist', () => {
    const tournament = onlyTournament(
      baseRows({
        pools: [
          { id: 'p1', phase_id: 'ph-pool' },
          { id: 'p2', phase_id: 'ph-pool' },
          { id: 'p3', phase_id: 'ph-pool' },
        ],
        refereeAssignments: [{ pool_id: 'p2', match_id: null }],
      }),
    );
    expect(tournament.poolCount).toBe(3);
    expect(tournament.poolsWithoutReferee).toBe(2);
  });

  it('ignores an assignment pointing at a match outside the event’s pools', () => {
    const tournament = onlyTournament(
      baseRows({ refereeAssignments: [{ pool_id: null, match_id: 'stranger' }] }),
    );
    expect(tournament.poolsWithoutReferee).toBe(1);
  });
});

describe('buildReadinessSnapshot — pool match scheduling', () => {
  it('treats a match as scheduled only with BOTH a piste and a time', () => {
    const tournament = onlyTournament(
      baseRows({
        matches: [
          { id: 'm1', pool_id: 'p1', lice_id: 'l1', scheduled_at: '2026-08-01T09:00:00Z' },
          { id: 'm2', pool_id: 'p1', lice_id: null, scheduled_at: '2026-08-01T09:20:00Z' },
          { id: 'm3', pool_id: 'p1', lice_id: 'l1', scheduled_at: null },
          { id: 'm4', pool_id: 'p1', lice_id: null, scheduled_at: null },
        ],
      }),
    );
    expect(tournament.poolMatchCount).toBe(4);
    expect(tournament.unscheduledPoolMatchCount).toBe(3);
  });

  it('ignores bracket matches, which carry no pool', () => {
    const tournament = onlyTournament(
      baseRows({
        matches: [
          { id: 'm1', pool_id: 'p1', lice_id: 'l1', scheduled_at: '2026-08-01T09:00:00Z' },
          { id: 'b1', pool_id: null, lice_id: null, scheduled_at: null },
        ],
      }),
    );
    expect(tournament.poolMatchCount).toBe(1);
    expect(tournament.unscheduledPoolMatchCount).toBe(0);
  });
});

describe('buildReadinessSnapshot — several tournaments', () => {
  it('attributes pools, matches and assignments to the right tournament', () => {
    const snapshot = buildReadinessSnapshot({
      liceCount: 2,
      tournaments: [
        { id: 't1', name: 'Longsword', ruleset_code: 'TF_v1' },
        { id: 't2', name: 'Rapier', ruleset_code: null },
      ],
      registrations: [
        { tournament_id: 't1', status: 'confirmed' },
        { tournament_id: 't1', status: 'confirmed' },
        { tournament_id: 't2', status: 'confirmed' },
      ],
      phases: [
        { id: 'ph1', tournament_id: 't1', type: 'pool' },
        { id: 'ph2', tournament_id: 't2', type: 'pool' },
        { id: 'ph3', tournament_id: 't2', type: 'single_elim' },
      ],
      pools: [
        { id: 'p1', phase_id: 'ph1' },
        { id: 'p2', phase_id: 'ph2' },
      ],
      matches: [
        { id: 'm1', pool_id: 'p1', lice_id: 'l1', scheduled_at: '2026-08-01T09:00:00Z' },
        { id: 'm2', pool_id: 'p2', lice_id: null, scheduled_at: null },
      ],
      refereeAssignments: [{ pool_id: 'p1', match_id: null }],
    });

    expect(snapshot.tournaments[0]).toMatchObject({
      id: 't1',
      activeFighterCount: 2,
      hasElimPhase: false,
      poolCount: 1,
      poolsWithoutReferee: 0,
      poolMatchCount: 1,
      unscheduledPoolMatchCount: 0,
    });
    expect(snapshot.tournaments[1]).toMatchObject({
      id: 't2',
      rulesetCode: null,
      activeFighterCount: 1,
      hasPoolPhase: true,
      hasElimPhase: true,
      poolCount: 1,
      poolsWithoutReferee: 1,
      poolMatchCount: 1,
      unscheduledPoolMatchCount: 1,
    });
  });

  it('drops a pool whose phase belongs to no listed tournament', () => {
    const tournament = onlyTournament(
      baseRows({
        pools: [
          { id: 'p1', phase_id: 'ph-pool' },
          { id: 'orphan', phase_id: 'ph-unknown' },
        ],
      }),
    );
    expect(tournament.poolCount).toBe(1);
  });
});
