import type { FinalRankingResultKind } from '../ranking';
import { isDoubleLossBout } from '../match-format';

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
  /** `matches.end_reason` — 'max_doubles' means BOTH fighters LOST. */
  endReason: string | null;
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
  leagueSlug: string;
  rank: number;
  totalPoints: number;
  medalCount: number;
  group: string;
}

/** A penalty card a fighter received, linked back to a career registration.
 *  `category` coalesces the ruleset entry's `short_name` and a manual card's
 *  free-text `reason` (see FightersService.fetchFighterPenalties). Only passed
 *  on the private `/me` path so cards-received stays off public projections. */
export interface CareerPenaltyInput {
  registrationId: string;
  card: string;
  category: string | null;
}

/** Raw per-(event × weapon) combat counts. Unlike `byWeapon`/`byYear` these are
 *  NOT finalized (no winLossRatio/doubleHitPercentage) — the client sums the
 *  buckets matching the selected event+weapon scope, then derives the rates. */
export interface FighterEventStat {
  eventKey: string;
  eventId: string;
  eventName: string;
  weapon: string;
  matches: number;
  wins: number;
  losses: number;
  doubleHits: number;
  exchanges: number;
}

/** A received penalty enriched with its event/weapon, ready for client-side
 *  event+weapon filtering and top-reason tallying. */
export interface FighterPenalty {
  eventKey: string;
  eventId: string;
  eventName: string;
  weapon: string;
  card: string;
  category: string | null;
}

/** A fighter's final placement in one completed tournament, derived from the
 *  shared `computeFinalRanking` (same ordering the public tournament page
 *  shows). `place` is 1-indexed; `totalRanked` is the size of the ranked field. */
export interface TournamentPlacement {
  place: number;
  resultKind: FinalRankingResultKind;
  totalRanked: number;
}

export interface BuildFighterCareerInput {
  fighterId: string;
  registrations: CareerRegistrationInput[];
  matches: CareerMatchInput[];
  exchanges: CareerExchangeInput[];
  leagueRankings: CareerLeagueRankingInput[];
  /** Per-registration final placement, keyed by registration id. Optional so
   *  callers (and tests) that don't compute placements still build a career. */
  placementByRegistrationId?: Map<string, TournamentPlacement>;
  /** Received penalty cards. Only provided on the private `/me` dashboard path;
   *  when present, the career emits an enriched `penalties` list. */
  penalties?: CareerPenaltyInput[];
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

/** Stable per-event key for a registration (falls back to the event name so two
 *  distinct events never collapse when an id is somehow missing). */
function eventKeyOf(eventId: string, eventName: string): string {
  return eventId || `name:${eventName || 'unknown'}`;
}

export function buildFighterCareer(input: BuildFighterCareerInput) {
  const registrationById = new Map(
    input.registrations.map((registration) => [registration.id, registration]),
  );
  // Every registration this fighter holds — used purely to answer "which side of
  // this match was I on?". Deliberately NOT gated on `tournamentStatus`: a match
  // counts the moment IT is completed, so stats stay live during an event and
  // never wait on an organiser flipping the tournament to `completed` (nothing
  // does so automatically — the status ticker only transitions events).
  const myRegistrationIds = new Set(input.registrations.map((registration) => registration.id));
  const matchById = new Map(input.matches.map((match) => [match.id, match]));
  const overall = emptyStats();
  const byWeapon = new Map<string, FighterCareerStats & { weapon: string }>();
  const byYear = new Map<string, FighterCareerStats & { year: string }>();
  // Per-(event × weapon) raw counts — lets the client re-scope combat tiles by
  // the selected event and/or weapon. Keyed by `${eventKey}|${weapon}`.
  const byEvent = new Map<string, FighterEventStat>();

  // Events / tournaments the fighter actually fought in (≥1 completed match) —
  // filled by the match loop below and used for the attendance counts, so those
  // no longer hinge on an event/tournament being flagged `completed` either.
  const foughtEventIds = new Set<string>();
  const foughtTournamentIds = new Set<string>();

  for (const match of input.matches) {
    if (match.status !== 'completed') continue;
    const registrationId = myRegistrationIds.has(match.redRegistrationId ?? '')
      ? match.redRegistrationId
      : myRegistrationIds.has(match.blueRegistrationId ?? '')
        ? match.blueRegistrationId
        : null;
    if (!registrationId) continue;

    const registration = registrationById.get(registrationId);
    if (!registration) continue;

    if (registration.eventId) foughtEventIds.add(registration.eventId);
    if (registration.tournamentId) foughtTournamentIds.add(registration.tournamentId);

    const weapon = registration.weapon ?? 'Unknown';
    const year = registration.eventStartDate?.slice(0, 4) ?? 'unknown';
    const eventKey = eventKeyOf(registration.eventId, registration.eventName);
    const eventBucketKey = `${eventKey}|${weapon}`;
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
    const eventStats =
      byEvent.get(eventBucketKey) ??
      ({
        eventKey,
        eventId: registration.eventId,
        eventName: registration.eventName,
        weapon,
        matches: 0,
        wins: 0,
        losses: 0,
        doubleHits: 0,
        exchanges: 0,
      } satisfies FighterEventStat);

    for (const stats of [overall, weaponStats, yearStats, eventStats]) {
      stats.matches += 1;
      // FIRST: a ceiling double loss has no winner, so the tests below file it
      // as neither a win nor a loss while still counting the bout — quietly
      // inflating the denominator of every win rate on the page.
      if (isDoubleLossBout(match.endReason)) stats.losses += 1;
      else if (match.winnerRegistrationId === registrationId) stats.wins += 1;
      else if (match.winnerRegistrationId) stats.losses += 1;
    }

    byWeapon.set(weapon, weaponStats);
    byYear.set(year, yearStats);
    byEvent.set(eventBucketKey, eventStats);
  }

  for (const exchange of input.exchanges) {
    if (exchange.voided) continue;
    const match = matchById.get(exchange.matchId);
    if (!match) continue;
    // Same gate as the match loop above. `overall` is always defined, so without
    // this an in-progress match's exchanges landed in the career total (and
    // diluted double-hit %) even though its result didn't count.
    if (match.status !== 'completed') continue;
    const registrationId = myRegistrationIds.has(match.redRegistrationId ?? '')
      ? match.redRegistrationId
      : myRegistrationIds.has(match.blueRegistrationId ?? '')
        ? match.blueRegistrationId
        : null;
    if (!registrationId) continue;

    const registration = registrationById.get(registrationId);
    if (!registration) continue;
    const weapon = registration.weapon ?? 'Unknown';
    const year = registration.eventStartDate?.slice(0, 4) ?? 'unknown';
    const eventBucketKey = `${eventKeyOf(registration.eventId, registration.eventName)}|${weapon}`;
    const weaponStats = byWeapon.get(weapon);
    const yearStats = byYear.get(year);
    const eventStats = byEvent.get(eventBucketKey);

    for (const stats of [overall, weaponStats, yearStats, eventStats]) {
      if (!stats) continue;
      stats.exchanges += 1;
      if (exchange.type === 'double') stats.doubleHits += 1;
    }
  }

  // An event counts as attended once it's `completed` OR the fighter fought a
  // completed match there — the latter covers an event still running (or one an
  // organiser never closed) whose matches are already in the books.
  const attendedEvents = new Map<string, CareerRegistrationInput>();
  const upcoming = input.registrations.filter(
    (registration) =>
      !['completed', 'archived'].includes(registration.eventStatus) &&
      !['completed', 'archived'].includes(registration.tournamentStatus) &&
      // An event we've already fought in is history, not something upcoming —
      // without this it would show under both.
      !foughtEventIds.has(registration.eventId),
  );

  for (const registration of input.registrations) {
    if (registration.eventStatus === 'completed' || foughtEventIds.has(registration.eventId))
      attendedEvents.set(registration.eventId, registration);
  }

  // Recent form / streak — the fighter's outcome (+ score) per completed match.
  const formMatches = input.matches
    .filter((match) => match.status === 'completed')
    .flatMap((match) => {
      const onRed = myRegistrationIds.has(match.redRegistrationId ?? '');
      const onBlue = myRegistrationIds.has(match.blueRegistrationId ?? '');
      const registrationId = onRed
        ? match.redRegistrationId
        : onBlue
          ? match.blueRegistrationId
          : null;
      if (!registrationId) return [];
      // Same ordering, same reason: with no winner recorded this read as a
      // draw, so the form badge showed a D and the streak survived a bout both
      // fighters lost.
      const outcome: 'win' | 'loss' | 'draw' = isDoubleLossBout(match.endReason)
        ? 'loss'
        : match.winnerRegistrationId === registrationId
          ? 'win'
          : match.winnerRegistrationId
            ? 'loss'
            : 'draw';
      return [
        {
          matchId: match.id,
          date: match.scheduledAt,
          outcome,
          ourScore: onRed ? match.redScore : match.blueScore,
          opponentScore: onRed ? match.blueScore : match.redScore,
        },
      ];
    })
    // Most recent first; matches without a scheduled time sort last.
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const recentForm = formMatches.slice(0, 10);

  // Current streak = consecutive same-outcome run from the most recent match.
  // A draw breaks the streak (kind 'none').
  let currentStreak: { kind: 'win' | 'loss' | 'none'; count: number } = { kind: 'none', count: 0 };
  const mostRecent = formMatches[0];
  if (mostRecent && mostRecent.outcome !== 'draw') {
    let count = 0;
    for (const formMatch of formMatches) {
      if (formMatch.outcome === mostRecent.outcome) count += 1;
      else break;
    }
    currentStreak = { kind: mostRecent.outcome, count };
  }

  // Received penalty cards, enriched with each card's event + weapon via its
  // registration. Only emitted when the caller supplied penalties (private
  // `/me` path) — coalescing to a flat list the client filters + tallies.
  const penalties: FighterPenalty[] | undefined = input.penalties
    ? input.penalties.flatMap((penalty) => {
        const registration = registrationById.get(penalty.registrationId);
        if (!registration) return [];
        return [
          {
            eventKey: eventKeyOf(registration.eventId, registration.eventName),
            eventId: registration.eventId,
            eventName: registration.eventName,
            weapon: registration.weapon ?? 'Unknown',
            card: penalty.card,
            category: penalty.category,
          },
        ];
      })
    : undefined;

  return {
    recentForm,
    currentStreak,
    fighterId: input.fighterId,
    eventParticipation: [...attendedEvents.values()].map((registration) => ({
      eventId: registration.eventId,
      eventName: registration.eventName,
      eventSlug: registration.eventSlug,
      startDate: registration.eventStartDate,
      endDate: registration.eventEndDate,
    })),
    /** Distinct tournaments the fighter fought a completed match in. The tile
     *  labelled "tournaments attended" wants this — `tournamentPlacements`
     *  counts tournaments we could *rank*, which is a different question. */
    tournamentsAttended: foughtTournamentIds.size,
    upcoming,
    matches: input.matches,
    tournamentPlacements: input.registrations
      // A tournament shows here once it's `completed` OR the fighter fought in
      // it — `place` stays null until it's genuinely decided, so an in-progress
      // tournament is listed without handing out a medal.
      .filter(
        (registration) =>
          registration.tournamentStatus === 'completed' ||
          foughtTournamentIds.has(registration.tournamentId),
      )
      .map((registration) => {
        const placement = input.placementByRegistrationId?.get(registration.id) ?? null;
        return {
          tournamentId: registration.tournamentId,
          tournamentName: registration.tournamentName,
          tournamentSlug: registration.tournamentSlug,
          eventId: registration.eventId,
          eventName: registration.eventName,
          eventSlug: registration.eventSlug,
          weapon: registration.weapon,
          date: registration.eventStartDate,
          place: placement?.place ?? null,
          resultKind: placement?.resultKind ?? null,
          totalRanked: placement?.totalRanked ?? null,
        };
      })
      // Most-recent first (ISO date strings sort lexicographically).
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    leagueRankings: input.leagueRankings,
    stats: {
      overall: finalizeStats(overall),
      byWeapon: [...byWeapon.values()].map(finalizeStats),
      byYear: [...byYear.values()].map(finalizeStats),
      byEvent: [...byEvent.values()],
    },
    ...(penalties ? { penalties } : {}),
  };
}
