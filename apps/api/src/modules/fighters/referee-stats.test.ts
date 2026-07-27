import { describe, expect, it } from 'vitest';
import { buildRefereeStats } from './referee-stats';

describe('buildRefereeStats', () => {
  it('counts referee matches, roles, average time, cards credited to declarant, and buddies', () => {
    const stats = buildRefereeStats({
      userId: 'user-ref',
      assignments: [
        {
          matchId: 'match-1',
          userId: 'user-ref',
          role: 'arbitre_declarant',
          eventName: 'FAL 2026',
          tournamentName: 'Longsword Open',
          weapon: 'Longsword',
          scheduledAt: '2026-03-01T10:00:00Z',
        },
        { matchId: 'match-1', userId: 'buddy-1', role: 'arbitre_assesseur' },
        { matchId: 'match-1', userId: 'buddy-2', role: 'arbitre_table' },
        { matchId: 'match-2', userId: 'user-ref', role: 'arbitre_table' },
        { matchId: 'match-2', userId: 'buddy-1', role: 'arbitre_declarant' },
      ],
      durations: [
        { matchId: 'match-1', durationActiveMs: 120_000 },
        { matchId: 'match-2', durationActiveMs: 180_000 },
      ],
      penalties: [
        { matchId: 'match-1', card: 'yellow', voided: false },
        { matchId: 'match-1', card: 'red', voided: false },
        { matchId: 'match-1', card: 'black', voided: true },
        { matchId: 'match-2', card: 'black', voided: false },
      ],
      buddiesByUserId: {
        'buddy-1': { userId: 'buddy-1', displayName: 'Main Buddy' },
        'buddy-2': { userId: 'buddy-2', displayName: 'Table Buddy' },
      },
      includePrivateDetails: true,
      skillsByRole: new Map([
        [
          'arbitre_declarant',
          { skillId: 'arbitre_declarant', skillName: 'Lead', skillColor: 'blue' },
        ],
        [
          'arbitre_assesseur',
          { skillId: 'arbitre_assesseur', skillName: 'Assessor', skillColor: 'green' },
        ],
        ['arbitre_table', { skillId: 'arbitre_table', skillName: 'Table', skillColor: 'purple' }],
      ]),
      matchFightersByMatchId: new Map([
        [
          'match-1',
          { redName: 'Red One', blueName: 'Blue One', redScore: 5, blueScore: 3, winner: 'red' },
        ],
        [
          'match-2',
          { redName: 'Red Two', blueName: 'Blue Two', redScore: 2, blueScore: 2, winner: null },
        ],
      ]),
    });

    expect(stats.totalMatches).toBe(2);
    expect(stats.roles).toEqual({
      arbitre_declarant: 1,
      arbitre_assesseur: 0,
      arbitre_table: 1,
    });
    expect(stats.averageRefereeTimeMs).toBe(150_000);
    expect(stats.cards).toEqual({ yellow: 1, red: 1, black: 0 });
    expect(stats.bestBuddies[0]).toEqual({
      userId: 'buddy-1',
      displayName: 'Main Buddy',
      matchesTogether: 2,
    });
    expect(stats.history).toEqual([
      expect.objectContaining({ matchId: 'match-1', role: 'arbitre_declarant' }),
      expect.objectContaining({ matchId: 'match-2', role: 'arbitre_table' }),
    ]);

    // Co-referees on match-1 exclude the viewer, resolve names + skills, and
    // are stably ordered by skill name (Assessor before Table).
    expect(stats.history?.[0]?.coReferees).toEqual([
      {
        personId: 'buddy-1',
        name: 'Main Buddy',
        skillId: 'arbitre_assesseur',
        skillName: 'Assessor',
        skillColor: 'green',
      },
      {
        personId: 'buddy-2',
        name: 'Table Buddy',
        skillId: 'arbitre_table',
        skillName: 'Table',
        skillColor: 'purple',
      },
    ]);
    expect(stats.history?.[0]).toMatchObject({
      redFighterName: 'Red One',
      blueFighterName: 'Blue One',
      redScore: 5,
      blueScore: 3,
      winner: 'red',
    });
    // match-2: only buddy-1 (declarant) refereed alongside the viewer.
    expect(stats.history?.[1]?.coReferees).toEqual([
      {
        personId: 'buddy-1',
        name: 'Main Buddy',
        skillId: 'arbitre_declarant',
        skillName: 'Lead',
        skillColor: 'blue',
      },
    ]);
    // A draw carries both scores but no winning side.
    expect(stats.history?.[1]).toMatchObject({
      redFighterName: 'Red Two',
      blueFighterName: 'Blue Two',
      redScore: 2,
      blueScore: 2,
      winner: null,
    });
  });

  it('dedupes a co-referee holding two roles on one match and orders deterministically', () => {
    const stats = buildRefereeStats({
      userId: 'user-ref',
      assignments: [
        { matchId: 'm', userId: 'user-ref', role: 'arbitre_declarant' },
        { matchId: 'm', userId: 'buddy-dup', role: 'arbitre_assesseur' },
        { matchId: 'm', userId: 'buddy-dup', role: 'arbitre_table' },
        { matchId: 'm', userId: 'buddy-z', role: 'arbitre_table' },
      ],
      durations: [{ matchId: 'm', durationActiveMs: 60_000 }],
      penalties: [],
      buddiesByUserId: {
        'buddy-dup': { userId: 'buddy-dup', displayName: 'Dup Ref' },
        'buddy-z': { userId: 'buddy-z', displayName: 'Zed Ref' },
      },
      includePrivateDetails: true,
      skillsByRole: new Map([
        [
          'arbitre_assesseur',
          { skillId: 'arbitre_assesseur', skillName: 'Assessor', skillColor: 'green' },
        ],
        ['arbitre_table', { skillId: 'arbitre_table', skillName: 'Table', skillColor: 'purple' }],
      ]),
    });

    const coRefs = stats.history?.[0]?.coReferees ?? [];
    // buddy-dup appears once (first role wins), and Assessor sorts before Table.
    expect(coRefs.map((c) => c.personId)).toEqual(['buddy-dup', 'buddy-z']);
    expect(coRefs[0]).toMatchObject({ skillName: 'Assessor' });
    expect(coRefs[1]).toMatchObject({ personId: 'buddy-z', skillName: 'Table' });
  });

  it('defaults co-referees to [] and fighters/scores to null when detail maps are absent', () => {
    const stats = buildRefereeStats({
      userId: 'user-ref',
      assignments: [
        { matchId: 'm', userId: 'user-ref', role: 'arbitre_table' },
        { matchId: 'm', userId: 'buddy-1', role: 'custom-skill-id' },
      ],
      durations: [{ matchId: 'm', durationActiveMs: 60_000 }],
      penalties: [],
      buddiesByUserId: { 'buddy-1': { userId: 'buddy-1', displayName: 'Buddy One' } },
      includePrivateDetails: true,
    });

    // An unresolved match yields null scores, NOT 0 — the FE renders "-" for
    // "we don't know" and must keep that distinct from a genuine 0.
    expect(stats.history?.[0]).toMatchObject({
      redFighterName: null,
      blueFighterName: null,
      redScore: null,
      blueScore: null,
      winner: null,
    });
    // A co-referee with a custom (unmapped) skill still surfaces, name resolved,
    // skill name/color null but the raw role kept as skillId.
    expect(stats.history?.[0]?.coReferees).toEqual([
      {
        personId: 'buddy-1',
        name: 'Buddy One',
        skillId: 'custom-skill-id',
        skillName: null,
        skillColor: null,
      },
    ]);
  });

  it('replays match events when duration is not materialized', () => {
    const stats = buildRefereeStats({
      userId: 'user-ref',
      assignments: [{ matchId: 'match-1', userId: 'user-ref', role: 'arbitre_assesseur' }],
      durations: [
        {
          matchId: 'match-1',
          durationActiveMs: null,
          events: [
            { type: 'start', occurredAt: '2026-03-01T10:00:00.000Z' },
            { type: 'halt', occurredAt: '2026-03-01T10:01:00.000Z' },
            { type: 'adjust_time', occurredAt: '2026-03-01T10:01:01.000Z', adjustmentMs: 5_000 },
            { type: 'resume', occurredAt: '2026-03-01T10:02:00.000Z' },
            { type: 'end', occurredAt: '2026-03-01T10:03:00.000Z' },
          ],
        },
      ],
      penalties: [],
    });

    expect(stats.averageRefereeTimeMs).toBe(125_000);
  });
});
