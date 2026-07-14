import { describe, expect, it } from 'vitest';
import { buildFighterCareer } from './fighter-career';

describe('buildFighterCareer', () => {
  it('derives win/loss totals and double-hit percentage from completed MyClash data', () => {
    const career = buildFighterCareer({
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-1',
          tournamentId: 'tournament-1',
          tournamentName: 'Longsword Open',
          tournamentSlug: 'longsword-open',
          tournamentStatus: 'completed',
          weapon: 'Longsword',
          eventId: 'event-1',
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          eventStatus: 'completed',
          eventStartDate: '2026-03-01',
          eventEndDate: '2026-03-02',
        },
      ],
      matches: [
        {
          id: 'match-win',
          tournamentId: 'tournament-1',
          status: 'completed',
          redRegistrationId: 'reg-1',
          blueRegistrationId: 'reg-2',
          winnerRegistrationId: 'reg-1',
          redScore: 5,
          blueScore: 2,
          scheduledAt: '2026-03-01T10:00:00Z',
          matchNumberLabel: 'P1-M1',
          opponentName: 'Blue Fighter',
        },
        {
          id: 'match-loss',
          tournamentId: 'tournament-1',
          status: 'completed',
          redRegistrationId: 'reg-3',
          blueRegistrationId: 'reg-1',
          winnerRegistrationId: 'reg-3',
          redScore: 4,
          blueScore: 3,
          scheduledAt: '2026-03-01T11:00:00Z',
          matchNumberLabel: 'P1-M2',
          opponentName: 'Red Fighter',
        },
      ],
      exchanges: [
        { id: 'ex-1', matchId: 'match-win', type: 'double', voided: false },
        { id: 'ex-2', matchId: 'match-win', type: 'clean', voided: false },
        { id: 'ex-3', matchId: 'match-loss', type: 'double', voided: true },
        { id: 'ex-4', matchId: 'match-loss', type: 'afterblow', voided: false },
      ],
      leagueRankings: [],
    });

    expect(career.stats.overall).toMatchObject({
      wins: 1,
      losses: 1,
      matches: 2,
      doubleHits: 1,
      exchanges: 3,
      doubleHitPercentage: 33.33,
    });
    expect(career.stats.byWeapon).toEqual([
      expect.objectContaining({
        weapon: 'Longsword',
        wins: 1,
        losses: 1,
        doubleHitPercentage: 33.33,
      }),
    ]);
  });

  it('separates upcoming registrations from completed event participation', () => {
    const career = buildFighterCareer({
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-complete',
          tournamentId: 'tournament-complete',
          tournamentName: 'Rapier Open',
          tournamentSlug: 'rapier-open',
          tournamentStatus: 'completed',
          weapon: 'Rapier',
          eventId: 'event-complete',
          eventName: 'Past Event',
          eventSlug: 'past-event',
          eventStatus: 'completed',
          eventStartDate: '2025-05-01',
          eventEndDate: '2025-05-02',
        },
        {
          id: 'reg-next',
          tournamentId: 'tournament-next',
          tournamentName: 'Sabre Open',
          tournamentSlug: 'sabre-open',
          tournamentStatus: 'published',
          weapon: 'Sabre',
          eventId: 'event-next',
          eventName: 'Next Event',
          eventSlug: 'next-event',
          eventStatus: 'published',
          eventStartDate: '2026-06-01',
          eventEndDate: '2026-06-02',
        },
      ],
      matches: [],
      exchanges: [],
      leagueRankings: [
        {
          leagueName: 'TF 2026',
          leagueSlug: 'tf-2026',
          rank: 4,
          totalPoints: 20,
          medalCount: 1,
          group: 'Rapier',
        },
      ],
    });

    expect(career.eventParticipation).toHaveLength(1);
    expect(career.eventParticipation[0]?.eventName).toBe('Past Event');
    expect(career.upcoming).toHaveLength(1);
    expect(career.upcoming[0]?.eventName).toBe('Next Event');
    expect(career.leagueRankings).toEqual([
      {
        leagueName: 'TF 2026',
        leagueSlug: 'tf-2026',
        rank: 4,
        totalPoints: 20,
        medalCount: 1,
        group: 'Rapier',
      },
    ]);
  });

  it('fills tournament placements from the placement map and sorts most-recent first', () => {
    const career = buildFighterCareer({
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-older',
          tournamentId: 't-older',
          tournamentName: 'Spring Cup',
          tournamentSlug: 'spring-cup',
          tournamentStatus: 'completed',
          weapon: 'Longsword',
          eventId: 'e-older',
          eventName: 'Spring 2025',
          eventSlug: 'spring-2025',
          eventStatus: 'completed',
          eventStartDate: '2025-04-01',
          eventEndDate: '2025-04-02',
        },
        {
          id: 'reg-newer',
          tournamentId: 't-newer',
          tournamentName: 'Winter Cup',
          tournamentSlug: 'winter-cup',
          tournamentStatus: 'completed',
          weapon: 'Rapier',
          eventId: 'e-newer',
          eventName: 'Winter 2026',
          eventSlug: 'winter-2026',
          eventStatus: 'completed',
          eventStartDate: '2026-01-10',
          eventEndDate: '2026-01-11',
        },
      ],
      matches: [],
      exchanges: [],
      leagueRankings: [],
      placementByRegistrationId: new Map([
        ['reg-older', { place: 1, resultKind: 'champion', totalRanked: 16 }],
        ['reg-newer', { place: 5, resultKind: 'round', totalRanked: 12 }],
      ]),
    });

    // Sorted most-recent first → Winter (2026) before Spring (2025).
    expect(career.tournamentPlacements.map((p) => p.tournamentSlug)).toEqual([
      'winter-cup',
      'spring-cup',
    ]);
    expect(career.tournamentPlacements[0]).toMatchObject({
      tournamentName: 'Winter Cup',
      eventSlug: 'winter-2026',
      place: 5,
      resultKind: 'round',
      totalRanked: 12,
      date: '2026-01-10',
    });
    expect(career.tournamentPlacements[1]).toMatchObject({
      tournamentName: 'Spring Cup',
      place: 1,
      resultKind: 'champion',
      totalRanked: 16,
    });
  });

  it('leaves placement null when no placement map entry exists', () => {
    const career = buildFighterCareer({
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-1',
          tournamentId: 't-1',
          tournamentName: 'Open',
          tournamentSlug: 'open',
          tournamentStatus: 'completed',
          weapon: 'Longsword',
          eventId: 'e-1',
          eventName: 'Event',
          eventSlug: 'event',
          eventStatus: 'completed',
          eventStartDate: '2026-02-01',
          eventEndDate: '2026-02-02',
        },
      ],
      matches: [],
      exchanges: [],
      leagueRankings: [],
    });

    expect(career.tournamentPlacements).toHaveLength(1);
    expect(career.tournamentPlacements[0]).toMatchObject({
      place: null,
      resultKind: null,
      totalRanked: null,
    });
  });

  it('computes recent form (most recent first) and the current streak', () => {
    const career = buildFighterCareer({
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-1',
          tournamentId: 't-1',
          tournamentName: 'Open',
          tournamentSlug: 'open',
          tournamentStatus: 'completed',
          weapon: 'Longsword',
          eventId: 'e-1',
          eventName: 'Event',
          eventSlug: 'event',
          eventStatus: 'completed',
          eventStartDate: '2026-01-01',
          eventEndDate: '2026-01-02',
        },
      ],
      matches: [
        // Oldest: a loss.
        {
          id: 'm1',
          tournamentId: 't-1',
          status: 'completed',
          redRegistrationId: 'reg-1',
          blueRegistrationId: 'opp',
          winnerRegistrationId: 'opp',
          redScore: 2,
          blueScore: 5,
          scheduledAt: '2026-01-01T09:00:00Z',
          matchNumberLabel: null,
          opponentName: null,
        },
        // Then two wins (newest last).
        {
          id: 'm2',
          tournamentId: 't-1',
          status: 'completed',
          redRegistrationId: 'reg-1',
          blueRegistrationId: 'opp',
          winnerRegistrationId: 'reg-1',
          redScore: 5,
          blueScore: 3,
          scheduledAt: '2026-01-01T10:00:00Z',
          matchNumberLabel: null,
          opponentName: null,
        },
        {
          id: 'm3',
          tournamentId: 't-1',
          status: 'completed',
          redRegistrationId: 'reg-1',
          blueRegistrationId: 'opp',
          winnerRegistrationId: 'reg-1',
          redScore: 5,
          blueScore: 1,
          scheduledAt: '2026-01-01T11:00:00Z',
          matchNumberLabel: null,
          opponentName: null,
        },
      ],
      exchanges: [],
      leagueRankings: [],
    });

    expect(career.recentForm.map((form) => form.outcome)).toEqual(['win', 'win', 'loss']);
    expect(career.recentForm[0]).toMatchObject({
      matchId: 'm3',
      outcome: 'win',
      ourScore: 5,
      opponentScore: 1,
    });
    expect(career.currentStreak).toEqual({ kind: 'win', count: 2 });
  });

  it('buckets combat stats per event × weapon as raw (unfinalized) counts', () => {
    const career = buildFighterCareer({
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-ls',
          tournamentId: 't-ls',
          tournamentName: 'Longsword',
          tournamentSlug: 'longsword',
          tournamentStatus: 'completed',
          weapon: 'Longsword',
          eventId: 'event-1',
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          eventStatus: 'completed',
          eventStartDate: '2026-03-01',
          eventEndDate: '2026-03-02',
        },
        {
          id: 'reg-rap',
          tournamentId: 't-rap',
          tournamentName: 'Rapier',
          tournamentSlug: 'rapier',
          tournamentStatus: 'completed',
          weapon: 'Rapier',
          eventId: 'event-2',
          eventName: 'Winter 2026',
          eventSlug: 'winter-2026',
          eventStatus: 'completed',
          eventStartDate: '2026-01-05',
          eventEndDate: '2026-01-06',
        },
      ],
      matches: [
        {
          id: 'm-ls-win',
          tournamentId: 't-ls',
          status: 'completed',
          redRegistrationId: 'reg-ls',
          blueRegistrationId: 'opp',
          winnerRegistrationId: 'reg-ls',
          redScore: 5,
          blueScore: 1,
          scheduledAt: '2026-03-01T10:00:00Z',
          matchNumberLabel: null,
          opponentName: null,
        },
        {
          id: 'm-rap-loss',
          tournamentId: 't-rap',
          status: 'completed',
          redRegistrationId: 'reg-rap',
          blueRegistrationId: 'opp',
          winnerRegistrationId: 'opp',
          redScore: 2,
          blueScore: 5,
          scheduledAt: '2026-01-05T10:00:00Z',
          matchNumberLabel: null,
          opponentName: null,
        },
      ],
      exchanges: [
        { id: 'ex-1', matchId: 'm-ls-win', type: 'double', voided: false },
        { id: 'ex-2', matchId: 'm-ls-win', type: 'clean', voided: false },
        { id: 'ex-3', matchId: 'm-rap-loss', type: 'clean', voided: false },
      ],
      leagueRankings: [],
    });

    expect(career.stats.byEvent).toEqual(
      expect.arrayContaining([
        {
          eventKey: 'event-1',
          eventId: 'event-1',
          eventName: 'FAL 2026',
          weapon: 'Longsword',
          matches: 1,
          wins: 1,
          losses: 0,
          doubleHits: 1,
          exchanges: 2,
        },
        {
          eventKey: 'event-2',
          eventId: 'event-2',
          eventName: 'Winter 2026',
          weapon: 'Rapier',
          matches: 1,
          wins: 0,
          losses: 1,
          doubleHits: 0,
          exchanges: 1,
        },
      ]),
    );
    // Buckets are raw — no server-derived rate fields (client re-derives).
    expect(career.stats.byEvent[0]).not.toHaveProperty('winLossRatio');
    expect(career.stats.byEvent[0]).not.toHaveProperty('doubleHitPercentage');
  });

  it('enriches received penalties with event + weapon, only on the private path', () => {
    const base = {
      fighterId: 'fighter-1',
      registrations: [
        {
          id: 'reg-ls',
          tournamentId: 't-ls',
          tournamentName: 'Longsword',
          tournamentSlug: 'longsword',
          tournamentStatus: 'completed',
          weapon: 'Longsword',
          eventId: 'event-1',
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          eventStatus: 'completed',
          eventStartDate: '2026-03-01',
          eventEndDate: '2026-03-02',
        },
      ],
      matches: [],
      exchanges: [],
      leagueRankings: [],
    };

    // No penalties supplied → the field is omitted (public projection).
    expect(buildFighterCareer(base).penalties).toBeUndefined();

    const career = buildFighterCareer({
      ...base,
      penalties: [
        { registrationId: 'reg-ls', card: 'yellow', category: 'Sortie de Lice' },
        { registrationId: 'reg-ls', card: 'red', category: 'Sortie de Lice' },
        // A card whose registration isn't in the career set is dropped.
        { registrationId: 'unknown-reg', card: 'black', category: 'Insulte' },
      ],
    });

    expect(career.penalties).toEqual([
      {
        eventKey: 'event-1',
        eventId: 'event-1',
        eventName: 'FAL 2026',
        weapon: 'Longsword',
        card: 'yellow',
        category: 'Sortie de Lice',
      },
      {
        eventKey: 'event-1',
        eventId: 'event-1',
        eventName: 'FAL 2026',
        weapon: 'Longsword',
        card: 'red',
        category: 'Sortie de Lice',
      },
    ]);
  });
});
