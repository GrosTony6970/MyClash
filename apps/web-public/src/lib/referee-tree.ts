import { bracketRoundLabel } from '@myclash/types';

/**
 * A referee's history as a tree: Event → Tournament → match-type tier → bout.
 *
 * Order (quick-win M7, operator 2026-10-14): the Event of the latest bout first, and inside an
 * Event the Tournament of the latest bout first, by the bouts' planned time (`scheduledAt`, the
 * one time the history carries); a group with no planned time at all comes last. Events used to
 * be ordered by their number of bouts, so a big Event of last year sat above yesterday's.
 */

export interface RefereeHistoryEntry {
  matchId: string;
  role: string | null;
  eventId: string | null;
  eventName: string | null;
  tournamentId: string | null;
  tournamentName: string | null;
  weapon: string | null;
  scheduledAt: string | null;
  durationMs: number;
  skillId: string | null;
  skillName: string | null;
  skillColor: string | null;
  phaseType: string | null;
  poolNumber: number | null;
  bracketRound: number | null;
  bracketSize: number | null;
  cards: { yellow: number; red: number; black: number };
  /** The tournament's configured fighter-side colour tokens. */
  sideColors: { red: string; blue: string } | null;
  coReferees: {
    personId: string;
    name: string | null;
    skillId: string | null;
    skillName: string | null;
    skillColor: string | null;
  }[];
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number | null;
  blueScore: number | null;
  winner: 'red' | 'blue' | null;
}

/** A refereed match's type/tier, used both to group the history tree and to
 *  detect finals / pool-vs-bracket in the stat panel. Pool matches sort first,
 *  then play-ins, then bracket rounds in chronological order (earlier round =
 *  more fighters remaining). */
export function roundTier(entry: RefereeHistoryEntry): { key: string; order: number } {
  if (entry.poolNumber != null || entry.phaseType === 'pool') return { key: 'pool', order: 0 };
  if (entry.bracketRound === 0) return { key: 'playin', order: 1 };
  if (entry.bracketRound != null) {
    const code = bracketRoundLabel(entry.bracketRound, entry.bracketSize) || 'other';
    return { key: code, order: 10 + entry.bracketRound };
  }
  return { key: 'other', order: 999 };
}

/** Stable per-event / per-tournament key (falls back to the name when an id is
 *  somehow missing, so grouping never collapses two distinct events). */
export function eventKey(entry: RefereeHistoryEntry): string {
  return entry.eventId ?? `name:${entry.eventName ?? 'unknown'}`;
}
export function tournamentKey(entry: RefereeHistoryEntry): string {
  return entry.tournamentId ?? `name:${entry.tournamentName ?? 'unknown'}`;
}

interface SkillRef {
  id: string;
  name: string;
  color: string;
}
interface CoRefereeChipData {
  personId: string;
  name: string | null;
  skillName: string | null;
  skillColor: string | null;
}
export interface RefereeMatchRow {
  matchId: string;
  /** The tournament's configured side colour tokens, so each line paints in
   *  the organiser's palette rather than a fixed red/blue. */
  sideColors: { red: string; blue: string } | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  /** Final score per side; null means unresolved, which renders as "-" rather
   *  than a 0 that would read as a genuine shutout. */
  redScore: number | null;
  blueScore: number | null;
  /** Winning side, from the match's recorded winner — null on a draw or an
   *  undecided match. Never inferred from the scores (forfeits invert them). */
  winner: 'red' | 'blue' | null;
  /** The viewer's own role for this match (null when unresolved). */
  viewerRole: SkillRef | null;
  coReferees: CoRefereeChipData[];
}
export interface TierGroup {
  key: string;
  order: number;
  matchIds: Set<string>;
  skills: Map<string, SkillRef>;
  matches: Map<string, RefereeMatchRow>;
}
export interface TournamentGroup {
  id: string;
  name: string;
  matchIds: Set<string>;
  /** The planned time of its latest bout, in ms; null when no bout has one. */
  latestAt: number | null;
  tiers: Map<string, TierGroup>;
}
export interface EventGroup {
  id: string;
  name: string;
  matchIds: Set<string>;
  /** The planned time of its latest bout, in ms; null when no bout has one. */
  latestAt: number | null;
  tournaments: Map<string, TournamentGroup>;
}

function later(current: number | null, scheduledAt: string | null): number | null {
  const at = scheduledAt ? Date.parse(scheduledAt) : Number.NaN;
  if (Number.isNaN(at)) return current;
  return current === null ? at : Math.max(current, at);
}

/** Latest first; a group with no planned time last; a tie keeps the bigger group first. */
function latestFirst(
  a: { latestAt: number | null; matchIds: Set<string> },
  b: { latestAt: number | null; matchIds: Set<string> },
): number {
  if (a.latestAt !== b.latestAt) {
    if (a.latestAt === null) return 1;
    if (b.latestAt === null) return -1;
    return b.latestAt - a.latestAt;
  }
  return b.matchIds.size - a.matchIds.size;
}

function matchRowOf(entry: RefereeHistoryEntry, viewerRole: SkillRef | null): RefereeMatchRow {
  return {
    matchId: entry.matchId,
    sideColors: entry.sideColors ?? null,
    redFighterName: entry.redFighterName,
    blueFighterName: entry.blueFighterName,
    redScore: entry.redScore,
    blueScore: entry.blueScore,
    winner: entry.winner,
    viewerRole,
    coReferees: (entry.coReferees ?? []).map((coRef) => ({
      personId: coRef.personId,
      name: coRef.name,
      skillName: coRef.skillName,
      skillColor: coRef.skillColor,
    })),
  };
}

function addToTier(tournament: TournamentGroup, entry: RefereeHistoryEntry): void {
  const tier = roundTier(entry);
  const tierGroup =
    tournament.tiers.get(tier.key) ??
    ({
      key: tier.key,
      order: tier.order,
      matchIds: new Set(),
      skills: new Map(),
      matches: new Map(),
    } satisfies TierGroup);
  tierGroup.matchIds.add(entry.matchId);
  const viewerRole: SkillRef | null =
    entry.skillId && entry.skillName && entry.skillColor
      ? { id: entry.skillId, name: entry.skillName, color: entry.skillColor }
      : null;
  if (viewerRole) tierGroup.skills.set(viewerRole.id, viewerRole);
  if (!tierGroup.matches.has(entry.matchId)) {
    tierGroup.matches.set(entry.matchId, matchRowOf(entry, viewerRole));
  }
  tournament.tiers.set(tier.key, tierGroup);
}

/** Group the flat history into event → tournament → match-type tiers, latest first. */
export function buildRefereeTree(history: RefereeHistoryEntry[], unknown: string): EventGroup[] {
  const events = new Map<string, EventGroup>();
  for (const entry of history) {
    const eId = eventKey(entry);
    const event =
      events.get(eId) ??
      ({
        id: eId,
        name: entry.eventName ?? unknown,
        matchIds: new Set(),
        latestAt: null,
        tournaments: new Map(),
      } satisfies EventGroup);
    event.matchIds.add(entry.matchId);
    event.latestAt = later(event.latestAt, entry.scheduledAt);

    const tId = tournamentKey(entry);
    const tournament =
      event.tournaments.get(tId) ??
      ({
        id: tId,
        name: entry.tournamentName ?? unknown,
        matchIds: new Set(),
        latestAt: null,
        tiers: new Map(),
      } satisfies TournamentGroup);
    tournament.matchIds.add(entry.matchId);
    tournament.latestAt = later(tournament.latestAt, entry.scheduledAt);

    addToTier(tournament, entry);
    event.tournaments.set(tId, tournament);
    events.set(eId, event);
  }
  return [...events.values()].sort(latestFirst).map((event) => ({
    ...event,
    tournaments: new Map(
      [...event.tournaments.entries()].sort(([, a], [, b]) => latestFirst(a, b)),
    ),
  }));
}
