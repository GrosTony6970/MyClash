import { describe, it, expect } from 'vitest';
import {
  computeEventReadiness,
  type ReadinessCheck,
  type ReadinessLevel,
  type ReadinessRosterSnapshot,
  type ReadinessSnapshot,
  type ReadinessTournamentSnapshot,
} from './event-readiness';

/** A tournament that passes every check, so each test varies one thing. */
function readyTournament(
  overrides: Partial<ReadinessTournamentSnapshot> = {},
): ReadinessTournamentSnapshot {
  return {
    id: 't1',
    name: 'Longsword Open',
    rulesetCode: 'TF_v1',
    activeFighterCount: 16,
    hasPoolPhase: true,
    hasSwissPhase: false,
    hasElimPhase: true,
    poolCount: 4,
    swissRoundCount: 0,
    poolsWithoutReferee: 0,
    poolMatchCount: 24,
    unscheduledPoolMatchCount: 0,
    ...overrides,
  };
}

/** A roster with nothing missing, so each test varies one gap. */
function readyRoster(overrides: Partial<ReadinessRosterSnapshot> = {}): ReadinessRosterSnapshot {
  return {
    activeFighterCount: 16,
    withoutClub: 0,
    withoutRatingsId: 0,
    withoutGlobalIdentity: 0,
    ...overrides,
  };
}

function readySnapshot(overrides: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return { liceCount: 2, tournaments: [readyTournament()], roster: readyRoster(), ...overrides };
}

function find(checks: ReadinessCheck[], key: string): ReadinessCheck | undefined {
  return checks.find((check) => check.key === key);
}

function levelOf(snapshot: ReadinessSnapshot, key: string): ReadinessLevel | undefined {
  return find(computeEventReadiness(snapshot).checks, key)?.level;
}

describe('computeEventReadiness — a fully prepared event', () => {
  it('reports no warnings and no criticals', () => {
    const report = computeEventReadiness(readySnapshot());
    expect(report.counts.warn).toBe(0);
    expect(report.counts.critical).toBe(0);
    expect(report.worst).toBe('ok');
  });

  it('tags event-level checks with a null tournamentId and the rest with the tournament', () => {
    const { checks } = computeEventReadiness(readySnapshot());
    expect(find(checks, 'tournaments')?.tournamentId).toBeNull();
    expect(find(checks, 'pistes')?.tournamentId).toBeNull();
    expect(find(checks, 'fighters')?.tournamentId).toBe('t1');
    expect(find(checks, 'poolReferees')?.tournamentId).toBe('t1');
  });
});

describe('computeEventReadiness — event-level rules', () => {
  it('is critical with no tournaments', () => {
    expect(levelOf(readySnapshot({ tournaments: [] }), 'tournaments')).toBe('critical');
  });

  it('is ok at one tournament', () => {
    expect(levelOf(readySnapshot(), 'tournaments')).toBe('ok');
  });

  it('warns with no pistes and clears at one', () => {
    expect(levelOf(readySnapshot({ liceCount: 0 }), 'pistes')).toBe('warn');
    expect(levelOf(readySnapshot({ liceCount: 1 }), 'pistes')).toBe('ok');
  });
});

describe('computeEventReadiness — fighters', () => {
  it.each([
    [0, 'critical'],
    [1, 'critical'],
    [2, 'ok'],
    [3, 'ok'],
  ])('reports %i active fighters as %s', (count, expected) => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ activeFighterCount: count })],
    });
    expect(levelOf(snapshot, 'fighters')).toBe(expected);
  });

  it('carries the count for the message', () => {
    const snapshot = readySnapshot({ tournaments: [readyTournament({ activeFighterCount: 1 })] });
    expect(find(computeEventReadiness(snapshot).checks, 'fighters')?.values).toEqual({ count: 1 });
  });
});

describe('computeEventReadiness — ruleset', () => {
  // `tournaments.ruleset_code` is NOT NULL DEFAULT 'TF_v1' and custom pins
  // write into the same column, so the row reports which ruleset is in force
  // rather than pretending it can catch a missing one.
  it('is informational when set, never a warning', () => {
    expect(levelOf(readySnapshot(), 'ruleset')).toBe('info');
  });

  it('carries the code so the row can name it', () => {
    const snapshot = readySnapshot({ tournaments: [readyTournament({ rulesetCode: 'FAL_2026' })] });
    expect(find(computeEventReadiness(snapshot).checks, 'ruleset')?.values).toEqual({
      ruleset: 'FAL_2026',
    });
  });

  it('keeps a defensive warn for a blank code, should the column ever go nullable', () => {
    for (const rulesetCode of [null, '', '   ']) {
      const snapshot = readySnapshot({ tournaments: [readyTournament({ rulesetCode })] });
      expect(levelOf(snapshot, 'ruleset')).toBe('warn');
    }
  });

  it('does not let an informational ruleset row drag the roll-up off ok', () => {
    expect(computeEventReadiness(readySnapshot()).worst).toBe('ok');
  });
});

describe('computeEventReadiness — format and pools', () => {
  it('warns on a tournament with no phases at all, and skips the downstream rows', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ hasPoolPhase: false, hasElimPhase: false })],
    });
    const { checks } = computeEventReadiness(snapshot);
    expect(find(checks, 'format')?.level).toBe('warn');
    expect(find(checks, 'pools')).toBeUndefined();
    expect(find(checks, 'poolReferees')).toBeUndefined();
    expect(find(checks, 'schedule')).toBeUndefined();
    expect(find(checks, 'bracket')).toBeUndefined();
  });

  it('does not emit `format` once any phase exists', () => {
    expect(find(computeEventReadiness(readySnapshot()).checks, 'format')).toBeUndefined();
  });

  it('counts Swiss as a format, so a Swiss-only tournament is not "no format"', () => {
    // Without this a Swiss-only tournament reported "no format chosen" and the
    // early return above skipped EVERY downstream check.
    const snapshot = readySnapshot({
      tournaments: [
        readyTournament({
          hasPoolPhase: false,
          hasElimPhase: false,
          hasSwissPhase: true,
          poolCount: 0,
          poolMatchCount: 0,
          swissRoundCount: 1,
        }),
      ],
    });
    const { checks } = computeEventReadiness(snapshot);
    expect(find(checks, 'format')).toBeUndefined();
    expect(find(checks, 'swissRounds')?.level).toBe('info');
    expect(find(checks, 'swissRounds')?.values).toEqual({ rounds: 1 });
  });

  it('omits the Swiss row entirely when there is no Swiss phase', () => {
    // Vacuous checks are omitted, never reported green.
    expect(find(computeEventReadiness(readySnapshot()).checks, 'swissRounds')).toBeUndefined();
  });

  it('never lets the Swiss row exceed info, even with no rounds generated yet', () => {
    // Rounds are generated one at a time as the phase runs, so "only round 1
    // exists" is the normal state on the morning of the event.
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ hasSwissPhase: true, swissRoundCount: 0 })],
    });
    expect(find(computeEventReadiness(snapshot).checks, 'swissRounds')?.level).toBe('info');
  });

  it('reports pools as info — not a warning — when the tournament goes straight to bracket', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ hasPoolPhase: false, poolCount: 0, poolMatchCount: 0 })],
    });
    expect(levelOf(snapshot, 'pools')).toBe('info');
  });

  it('warns when a pool phase exists but generated no pools', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ poolCount: 0, poolMatchCount: 0 })],
    });
    expect(levelOf(snapshot, 'pools')).toBe('warn');
  });
});

describe('computeEventReadiness — pool referees', () => {
  it('warns when any pool lacks an assignment', () => {
    const snapshot = readySnapshot({ tournaments: [readyTournament({ poolsWithoutReferee: 1 })] });
    const check = find(computeEventReadiness(snapshot).checks, 'poolReferees');
    expect(check?.level).toBe('warn');
    expect(check?.values).toEqual({ missing: 1, total: 4 });
  });

  it('is ok when every pool has one', () => {
    expect(levelOf(readySnapshot(), 'poolReferees')).toBe('ok');
  });

  it('is omitted rather than reported green when there are no pools', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ poolCount: 0, poolsWithoutReferee: 0, poolMatchCount: 0 })],
    });
    expect(find(computeEventReadiness(snapshot).checks, 'poolReferees')).toBeUndefined();
  });
});

describe('computeEventReadiness — schedule', () => {
  it('warns when any pool match is missing its piste or its time', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ unscheduledPoolMatchCount: 3 })],
    });
    const check = find(computeEventReadiness(snapshot).checks, 'schedule');
    expect(check?.level).toBe('warn');
    expect(check?.values).toEqual({ unscheduled: 3, total: 24 });
  });

  it('is ok when every pool match has both', () => {
    expect(levelOf(readySnapshot(), 'schedule')).toBe('ok');
  });

  it('is omitted rather than reported green when there are no pool matches', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ poolMatchCount: 0, unscheduledPoolMatchCount: 0 })],
    });
    expect(find(computeEventReadiness(snapshot).checks, 'schedule')).toBeUndefined();
  });
});

describe('computeEventReadiness — the bracket row never escalates', () => {
  it('stays info on an unpopulated bracket with unfinished pools', () => {
    const snapshot = readySnapshot({
      tournaments: [
        readyTournament({ poolCount: 4, poolsWithoutReferee: 4, unscheduledPoolMatchCount: 24 }),
      ],
    });
    expect(levelOf(snapshot, 'bracket')).toBe('info');
  });

  it('stays info even on an otherwise critical tournament', () => {
    const snapshot = readySnapshot({
      tournaments: [readyTournament({ activeFighterCount: 0 })],
    });
    expect(levelOf(snapshot, 'bracket')).toBe('info');
  });

  it('is not emitted for a pool-only tournament', () => {
    const snapshot = readySnapshot({ tournaments: [readyTournament({ hasElimPhase: false })] });
    expect(find(computeEventReadiness(snapshot).checks, 'bracket')).toBeUndefined();
  });
});

describe('computeEventReadiness — aggregation', () => {
  it('lets critical beat warn', () => {
    const snapshot = readySnapshot({
      liceCount: 0,
      tournaments: [readyTournament({ activeFighterCount: 1 })],
    });
    expect(computeEventReadiness(snapshot).worst).toBe('critical');
  });

  it('reports warn when the worst outstanding item is a warning', () => {
    expect(computeEventReadiness(readySnapshot({ liceCount: 0 })).worst).toBe('warn');
  });

  it('does not let the info bracket row drag `worst` below ok', () => {
    const report = computeEventReadiness(readySnapshot());
    expect(report.counts.info).toBeGreaterThan(0);
    expect(report.worst).toBe('ok');
  });

  it('counts every check exactly once across the levels', () => {
    const report = computeEventReadiness(
      readySnapshot({
        liceCount: 0,
        tournaments: [readyTournament(), readyTournament({ id: 't2', activeFighterCount: 0 })],
      }),
    );
    const total =
      report.counts.ok + report.counts.warn + report.counts.critical + report.counts.info;
    expect(total).toBe(report.checks.length);
  });

  it('walks every tournament', () => {
    const report = computeEventReadiness(
      readySnapshot({
        tournaments: [
          readyTournament(),
          readyTournament({ id: 't2' }),
          readyTournament({ id: 't3' }),
        ],
      }),
    );
    expect(new Set(report.checks.map((c) => c.tournamentId))).toEqual(
      new Set([null, 't1', 't2', 't3']),
    );
  });
});

describe('computeEventReadiness — an empty event', () => {
  it('reports the two event-level rows only, worst critical', () => {
    const report = computeEventReadiness({
      liceCount: 0,
      tournaments: [],
      roster: readyRoster({ activeFighterCount: 0 }),
    });
    expect(report.checks.map((c) => c.key)).toEqual(['tournaments', 'pistes']);
    expect(report.worst).toBe('critical');
    expect(report.counts).toEqual({ ok: 0, warn: 1, critical: 1, info: 0 });
  });
});

describe('computeEventReadiness — roster quality', () => {
  it('reports all three rows green on a clean roster', () => {
    const report = computeEventReadiness(readySnapshot());
    for (const key of ['rosterIdentity', 'rosterClub', 'rosterRatings']) {
      expect(find(report.checks, key)?.level).toBe('ok');
    }
  });

  it('is EVENT-level, not per tournament', () => {
    // A fighter entered in two weapons is one person with one club. Emitting a
    // row per tournament would report the same gap twice and imply it could be
    // fixed in one tournament but not the other.
    const report = computeEventReadiness(
      readySnapshot({
        tournaments: [readyTournament({ id: 't1' }), readyTournament({ id: 't2' })],
      }),
    );
    const roster = report.checks.filter((c) => c.key.startsWith('roster'));
    expect(roster).toHaveLength(3);
    expect(roster.every((c) => c.tournamentId === null)).toBe(true);
  });

  it('WARNS on an unresolved identity — that is a failed import, not a state', () => {
    // The fighter's results never reach their profile, their career page or any
    // league standing, and nothing else in the app will ever say so.
    const snapshot = readySnapshot({ roster: readyRoster({ withoutGlobalIdentity: 2 }) });
    expect(levelOf(snapshot, 'rosterIdentity')).toBe('warn');
    expect(computeEventReadiness(snapshot).worst).toBe('warn');
  });

  it('keeps a missing club at info, so it never moves the header chip', () => {
    // Unaffiliated fighters are a real and legitimate thing to be. Registration
    // is open for weeks; an amber roster the whole time trains the organiser to
    // ignore the panel.
    const snapshot = readySnapshot({ roster: readyRoster({ withoutClub: 5 }) });
    expect(levelOf(snapshot, 'rosterClub')).toBe('info');
    expect(computeEventReadiness(snapshot).worst).toBe('ok');
  });

  it('keeps a missing rating at info for the same reason', () => {
    const snapshot = readySnapshot({ roster: readyRoster({ withoutRatingsId: 5 }) });
    expect(levelOf(snapshot, 'rosterRatings')).toBe('info');
    expect(computeEventReadiness(snapshot).worst).toBe('ok');
  });

  it('carries the gap and the total, so the message can say 5 of 16', () => {
    const snapshot = readySnapshot({
      roster: readyRoster({ activeFighterCount: 16, withoutClub: 5 }),
    });
    expect(find(computeEventReadiness(snapshot).checks, 'rosterClub')?.values).toEqual({
      missing: 5,
      total: 16,
    });
  });

  it('OMITS all three when nobody has an active registration', () => {
    // "Everyone has a club" is trivially true of an empty roster, and a green
    // row there is exactly the false all-clear the vacuous-check rule exists to
    // prevent.
    const report = computeEventReadiness(
      readySnapshot({ roster: readyRoster({ activeFighterCount: 0, withoutClub: 0 }) }),
    );
    expect(report.checks.filter((c) => c.key.startsWith('roster'))).toEqual([]);
  });
});
