export interface CareerRegistrationInput {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  tournamentStatus: string;
  weapon: string | null;
  eventId: string;
  eventName: string;
  eventSlug: string;
  eventStatus: string;
  eventStartDate: string | null;
  eventEndDate: string | null;
}

export interface CareerMatchInput {
  id: string;
  tournamentId: string;
  status: string;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  winnerRegistrationId: string | null;
  redScore: number;
  blueScore: number;
  scheduledAt: string | null;
  matchNumberLabel: string | null;
  opponentName: string | null;
}

export interface CareerExchangeInput {
  id: string;
  matchId: string;
  type: string;
  voided: boolean;
}

export interface CareerLeagueRankingInput {
  leagueName: string;
  rank: number;
  totalPoints: number;
  group: string;
}

export interface BuildFighterCareerInput {
  fighterId: string;
  registrations: CareerRegistrationInput[];
  matches: CareerMatchInput[];
  exchanges: CareerExchangeInput[];
  leagueRankings: CareerLeagueRankingInput[];
}

export interface FighterCareerStats {
  matches: number;
  wins: number;
  losses: number;
  winLossRatio: number | null;
  doubleHits: number;
  exchanges: number;
  doubleHitPercentage: number;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyStats(): FighterCareerStats {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    winLossRatio: null,
    doubleHits: 0,
    exchanges: 0,
    doubleHitPercentage: 0,
  };
}

function finalizeStats(stats: FighterCareerStats): FighterCareerStats {
  return {
    ...stats,
    winLossRatio:
      stats.losses === 0 ? (stats.wins > 0 ? stats.wins : null) : stats.wins / stats.losses,
    doubleHitPercentage:
      stats.exchanges === 0 ? 0 : roundPercent((stats.doubleHits / stats.exchanges) * 100),
  };
}

export function buildFighterCareer(input: BuildFighterCareerInput) {
  const registrationById = new Map(
    input.registrations.map((registration) => [registration.id, registration]),
  );
  const completedRegistrationIds = new Set(
    input.registrations
      .filter((registration) => registration.tournamentStatus === 'completed')
      .map((registration) => registration.id),
  );
  const matchById = new Map(input.matches.map((match) => [match.id, match]));
  const overall = emptyStats();
  const byWeapon = new Map<string, FighterCareerStats & { weapon: string }>();
  const byYear = new Map<string, FighterCareerStats & { year: string }>();

  for (const match of input.matches) {
    if (match.status !== 'completed') continue;
    const registrationId = completedRegistrationIds.has(match.redRegistrationId ?? '')
      ? match.redRegistrationId
      : completedRegistrationIds.has(match.blueRegistrationId ?? '')
        ? match.blueRegistrationId
        : null;
    if (!registrationId) continue;

    const registration = registrationById.get(registrationId);
    if (!registration) continue;

    const weapon = registration.weapon ?? 'Unknown';
    const year = registration.eventStartDate?.slice(0, 4) ?? 'unknown';
    const weaponStats =
      byWeapon.get(weapon) ??
      ({
        ...emptyStats(),
        weapon,
      } satisfies FighterCareerStats & { weapon: string });
    const yearStats =
      byYear.get(year) ??
      ({
        ...emptyStats(),
        year,
      } satisfies FighterCareerStats & { year: string });

    for (const stats of [overall, weaponStats, yearStats]) {
      stats.matches += 1;
      if (match.winnerRegistrationId === registrationId) stats.wins += 1;
      else if (match.winnerRegistrationId) stats.losses += 1;
    }

    byWeapon.set(weapon, weaponStats);
    byYear.set(year, yearStats);
  }

  for (const exchange of input.exchanges) {
    if (exchange.voided) continue;
    const match = matchById.get(exchange.matchId);
    if (!match) continue;
    const registrationId = completedRegistrationIds.has(match.redRegistrationId ?? '')
      ? match.redRegistrationId
      : completedRegistrationIds.has(match.blueRegistrationId ?? '')
        ? match.blueRegistrationId
        : null;
    if (!registrationId) continue;

    const registration = registrationById.get(registrationId);
    if (!registration) continue;
    const weapon = registration.weapon ?? 'Unknown';
    const year = registration.eventStartDate?.slice(0, 4) ?? 'unknown';
    const weaponStats = byWeapon.get(weapon);
    const yearStats = byYear.get(year);

    for (const stats of [overall, weaponStats, yearStats]) {
      if (!stats) continue;
      stats.exchanges += 1;
      if (exchange.type === 'double') stats.doubleHits += 1;
    }
  }

  const completedEvents = new Map<string, CareerRegistrationInput>();
  const upcoming = input.registrations.filter(
    (registration) =>
      !['completed', 'archived'].includes(registration.eventStatus) &&
      !['completed', 'archived'].includes(registration.tournamentStatus),
  );

  for (const registration of input.registrations) {
    if (registration.eventStatus === 'completed')
      completedEvents.set(registration.eventId, registration);
  }

  return {
    fighterId: input.fighterId,
    eventParticipation: [...completedEvents.values()].map((registration) => ({
      eventId: registration.eventId,
      eventName: registration.eventName,
      eventSlug: registration.eventSlug,
      startDate: registration.eventStartDate,
      endDate: registration.eventEndDate,
    })),
    upcoming,
    matches: input.matches,
    tournamentPlacements: input.registrations
      .filter((registration) => registration.tournamentStatus === 'completed')
      .map((registration) => ({
        tournamentId: registration.tournamentId,
        tournamentName: registration.tournamentName,
        eventName: registration.eventName,
        weapon: registration.weapon,
        rank: null as number | null,
      })),
    leagueRankings: input.leagueRankings,
    stats: {
      overall: finalizeStats(overall),
      byWeapon: [...byWeapon.values()].map(finalizeStats),
      byYear: [...byYear.values()].map(finalizeStats),
    },
  };
}
