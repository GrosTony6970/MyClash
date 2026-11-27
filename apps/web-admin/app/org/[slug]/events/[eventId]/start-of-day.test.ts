import { describe, expect, it } from 'vitest';
import type { ReadinessCheck, ReadinessLevel, ReadinessReport } from './readiness-copy';
import { buildStartOfDay, stageOf, STAGE_ORDER, tournamentTag } from './start-of-day';

function check(key: string, level: ReadinessLevel = 'ok'): ReadinessCheck {
  return { key, level, tournamentId: null };
}

function report(checks: ReadinessCheck[]): ReadinessReport {
  return {
    eventId: 'event-1',
    eventStatus: 'draft',
    tournaments: [],
    checks,
    worst: 'ok',
    counts: { ok: 0, warn: 0, critical: 0, info: 0 },
  };
}

describe('tournamentTag', () => {
  const LONGSWORD = { id: 'a', name: 'Longsword' };
  const RAPIER = { id: 'b', name: 'Rapier' };
  const withTournaments = (tournaments: ReadinessReport['tournaments']) => ({
    ...report([]),
    tournaments,
  });

  it("names a row's Tournament when the Event holds several", () => {
    const ruleset = { ...check('ruleset'), tournamentId: 'b' };
    expect(tournamentTag(withTournaments([LONGSWORD, RAPIER]), ruleset)).toBe('Rapier');
  });

  it('names nothing when the Event holds one Tournament — there is nothing to tell apart', () => {
    const ruleset = { ...check('ruleset'), tournamentId: 'a' };
    expect(tournamentTag(withTournaments([LONGSWORD]), ruleset)).toBeNull();
  });

  it('names nothing on an Event-level row', () => {
    expect(tournamentTag(withTournaments([LONGSWORD, RAPIER]), check('pistes'))).toBeNull();
  });
});

describe('stageOf', () => {
  it.each([
    ['tournaments', 'event'],
    ['fighters', 'event'],
    ['teams', 'event'],
    ['ruleset', 'event'],
    ['rosterIdentity', 'roster'],
    ['rosterClub', 'roster'],
    ['rosterRatings', 'roster'],
    ['format', 'draw'],
    ['pools', 'draw'],
    ['swissRounds', 'draw'],
    ['bracket', 'draw'],
    ['pistes', 'run'],
    ['schedule', 'run'],
    ['poolReferees', 'run'],
  ])('puts %s in the %s stage', (key, stage) => {
    expect(stageOf(key)).toBe(stage);
  });

  it('lands an unknown key in the last stage rather than dropping it', () => {
    // A new server check must never vanish from the morning list because
    // nobody updated this file.
    expect(stageOf('somethingNew')).toBe('run');
  });
});

describe('buildStartOfDay', () => {
  it('returns all four stages in dependency order, even when empty', () => {
    // A stable shape the organiser can learn, rather than sections that appear
    // and disappear as work is done.
    const stages = buildStartOfDay(report([]));
    expect(stages.map((s) => s.key)).toEqual([...STAGE_ORDER]);
    expect(stages.every((s) => s.checks.length === 0)).toBe(true);
  });

  it('routes every check into its stage', () => {
    const stages = buildStartOfDay(
      report([check('pistes'), check('tournaments'), check('rosterClub'), check('pools')]),
    );
    expect(stages.map((s) => s.checks.map((c) => c.key))).toEqual([
      ['tournaments'],
      ['rosterClub'],
      ['pools'],
      ['pistes'],
    ]);
  });

  it('puts outstanding rows first inside a stage', () => {
    // The organiser wants the work, not the receipt.
    const stages = buildStartOfDay(
      report([check('pistes', 'ok'), check('schedule', 'warn'), check('poolReferees', 'critical')]),
    );
    const run = stages.find((s) => s.key === 'run');
    expect(run?.checks.map((c) => c.key)).toEqual(['schedule', 'poolReferees', 'pistes']);
  });

  it('keeps cleared rows visible rather than filtering them out', () => {
    // "pools: 4 created" is how you confirm you are looking at the right event.
    const stages = buildStartOfDay(report([check('pools', 'ok')]));
    expect(stages.find((s) => s.key === 'draw')?.checks).toHaveLength(1);
  });

  it('counts only outstanding rows per stage — info never counts as work', () => {
    const stages = buildStartOfDay(
      report([
        check('rosterIdentity', 'warn'),
        check('rosterClub', 'info'),
        check('rosterRatings', 'ok'),
      ]),
    );
    expect(stages.find((s) => s.key === 'roster')?.outstandingCount).toBe(1);
  });

  it('marks the FIRST stage with work as current, and only that one', () => {
    const stages = buildStartOfDay(
      report([check('fighters', 'critical'), check('schedule', 'warn')]),
    );
    expect(stages.filter((s) => s.current).map((s) => s.key)).toEqual(['event']);
  });

  it('skips a fully cleared stage when marking current', () => {
    const stages = buildStartOfDay(
      report([check('fighters', 'ok'), check('rosterClub', 'info'), check('schedule', 'warn')]),
    );
    expect(stages.filter((s) => s.current).map((s) => s.key)).toEqual(['run']);
  });

  it("keeps one check's rows side by side across Tournaments", () => {
    // The server sends them Tournament by Tournament; read in that order, two
    // Tournaments gave "Ruleset, Fighters, Ruleset, Fighters".
    const stages = buildStartOfDay(
      report([
        check('tournaments'),
        { ...check('ruleset'), tournamentId: 'a' },
        { ...check('fighters'), tournamentId: 'a' },
        { ...check('ruleset'), tournamentId: 'b' },
        { ...check('fighters'), tournamentId: 'b' },
      ]),
    );
    expect(
      stages.find((s) => s.key === 'event')?.checks.map((c) => `${c.key}:${c.tournamentId}`),
    ).toEqual(['tournaments:null', 'ruleset:a', 'ruleset:b', 'fighters:a', 'fighters:b']);
  });

  it('marks NO stage current when everything is clear', () => {
    // What lets the view say "you are ready" instead of pointing at a stage
    // with nothing left in it.
    const stages = buildStartOfDay(report([check('fighters', 'ok'), check('schedule', 'ok')]));
    expect(stages.some((s) => s.current)).toBe(false);
  });
});
