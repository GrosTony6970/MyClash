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
      leagueRankings: [{ leagueName: 'TF 2026', rank: 4, totalPoints: 20, group: 'Rapier' }],
    });

    expect(career.eventParticipation).toHaveLength(1);
    expect(career.eventParticipation[0]?.eventName).toBe('Past Event');
    expect(career.upcoming).toHaveLength(1);
    expect(career.upcoming[0]?.eventName).toBe('Next Event');
    expect(career.leagueRankings).toEqual([
      { leagueName: 'TF 2026', rank: 4, totalPoints: 20, group: 'Rapier' },
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
});
