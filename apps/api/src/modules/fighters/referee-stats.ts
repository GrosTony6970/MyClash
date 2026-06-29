export type RefereeRole = 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';
export type RefereeCard = 'yellow' | 'red' | 'black';

export interface RefereeAssignmentInput {
  matchId: string;
  userId: string;
  role: RefereeRole | string | null;
  eventId?: string | null;
  eventName?: string | null;
  tournamentId?: string | null;
  tournamentName?: string | null;
  weapon?: string | null;
  scheduledAt?: string | null;
  // Phase/round metadata used to break refereed matches down by type
  // (Pool vs bracket tier) in the referee profile tree. poolNumber is
  // 1-indexed; bracketRound is bracket_slots.round (0 = play-in);
  // bracketSize is the phase's bracket size (for the round-tier label).
  phaseType?: string | null;
  poolNumber?: number | null;
  bracketRound?: number | null;
  bracketSize?: number | null;
}

export interface RefereeMatchDurationInput {
  matchId: string;
  durationActiveMs: number | null;
  events?: RefereeMatchEventInput[];
}

export interface RefereeMatchEventInput {
  type: string;
  occurredAt: string;
  adjustmentMs?: number | null;
}

export interface RefereePenaltyInput {
  matchId: string;
  card: RefereeCard | string;
  voided: boolean;
}

export interface RefereeBuddyInput {
  userId: string;
  displayName: string | null;
}

export interface RefereeSkillInfo {
  skillId: string;
  skillName: string;
  skillColor: string;
}

export interface RefereeStatsInput {
  userId: string;
  assignments: RefereeAssignmentInput[];
  durations: RefereeMatchDurationInput[];
  penalties: RefereePenaltyInput[];
  buddiesByUserId?: Record<string, RefereeBuddyInput>;
  includePrivateDetails?: boolean;
  skillsByRole?: Map<string, RefereeSkillInfo>;
}

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
  /** Cards issued in this match, counted only when the ref was declarant
   *  (mirrors the top-level `cards` semantics) — lets the FE sum cards per
   *  event when the stat panel is scoped to a single event. */
  cards: { yellow: number; red: number; black: number };
}

export interface RefereeStats {
  totalMatches: number;
  averageRefereeTimeMs: number;
  roles: Record<RefereeRole, number>;
  cards: Record<RefereeCard, number>;
  bestBuddies: Array<{ userId: string; displayName: string | null; matchesTogether: number }>;
  history?: RefereeHistoryEntry[];
}

const ROLE_KEYS: RefereeRole[] = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];
const CARD_KEYS: RefereeCard[] = ['yellow', 'red', 'black'];

export function buildRefereeStats(input: RefereeStatsInput): RefereeStats {
  const mine = input.assignments.filter((assignment) => assignment.userId === input.userId);
  const matchIds = new Set(mine.map((assignment) => assignment.matchId));
  const declarantMatchIds = new Set(
    mine
      .filter((assignment) => assignment.role === 'arbitre_declarant')
      .map((assignment) => assignment.matchId),
  );
  const durationByMatch = new Map(
    input.durations.map((duration) => [duration.matchId, resolveDurationMs(duration)]),
  );
  const roles = { arbitre_declarant: 0, arbitre_assesseur: 0, arbitre_table: 0 };

  for (const assignment of mine) {
    if (isRefereeRole(assignment.role)) roles[assignment.role] += 1;
  }

  const durations = [...matchIds].map((matchId) => durationByMatch.get(matchId) ?? 0);
  const averageRefereeTimeMs =
    durations.length === 0
      ? 0
      : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);

  const cards = { yellow: 0, red: 0, black: 0 };
  const cardsByMatch = new Map<string, { yellow: number; red: number; black: number }>();
  for (const penalty of input.penalties) {
    if (penalty.voided || !declarantMatchIds.has(penalty.matchId)) continue;
    if (!isRefereeCard(penalty.card)) continue;
    cards[penalty.card] += 1;
    const perMatch = cardsByMatch.get(penalty.matchId) ?? { yellow: 0, red: 0, black: 0 };
    perMatch[penalty.card] += 1;
    cardsByMatch.set(penalty.matchId, perMatch);
  }

  const buddyCounts = new Map<string, number>();
  for (const matchId of matchIds) {
    const matchAssignments = input.assignments.filter(
      (assignment) => assignment.matchId === matchId,
    );
    for (const assignment of matchAssignments) {
      if (assignment.userId === input.userId) continue;
      buddyCounts.set(assignment.userId, (buddyCounts.get(assignment.userId) ?? 0) + 1);
    }
  }

  const bestBuddies = [...buddyCounts.entries()]
    .map(([userId, matchesTogether]) => ({
      userId,
      displayName: input.buddiesByUserId?.[userId]?.displayName ?? null,
      matchesTogether,
    }))
    .sort((a, b) => b.matchesTogether - a.matchesTogether || a.userId.localeCompare(b.userId))
    .slice(0, 5);

  return {
    totalMatches: matchIds.size,
    averageRefereeTimeMs,
    roles,
    cards,
    bestBuddies,
    ...(input.includePrivateDetails
      ? {
          history: mine.map((assignment): RefereeHistoryEntry => {
            const skill =
              assignment.role && input.skillsByRole
                ? (input.skillsByRole.get(assignment.role) ?? null)
                : null;
            return {
              matchId: assignment.matchId,
              role: assignment.role,
              eventId: assignment.eventId ?? null,
              eventName: assignment.eventName ?? null,
              tournamentId: assignment.tournamentId ?? null,
              tournamentName: assignment.tournamentName ?? null,
              weapon: assignment.weapon ?? null,
              scheduledAt: assignment.scheduledAt ?? null,
              durationMs: durationByMatch.get(assignment.matchId) ?? 0,
              skillId: skill?.skillId ?? null,
              skillName: skill?.skillName ?? null,
              skillColor: skill?.skillColor ?? null,
              phaseType: assignment.phaseType ?? null,
              poolNumber: assignment.poolNumber ?? null,
              bracketRound: assignment.bracketRound ?? null,
              bracketSize: assignment.bracketSize ?? null,
              cards: cardsByMatch.get(assignment.matchId) ?? { yellow: 0, red: 0, black: 0 },
            };
          }),
        }
      : {}),
  };
}

function isRefereeRole(value: unknown): value is RefereeRole {
  return typeof value === 'string' && (ROLE_KEYS as string[]).includes(value);
}

function isRefereeCard(value: unknown): value is RefereeCard {
  return typeof value === 'string' && (CARD_KEYS as string[]).includes(value);
}

function resolveDurationMs(input: RefereeMatchDurationInput): number {
  if (typeof input.durationActiveMs === 'number') return Math.max(0, input.durationActiveMs);
  return replayDuration(input.events ?? []);
}

function replayDuration(events: RefereeMatchEventInput[]): number {
  const sorted = [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  let runningFrom: number | null = null;
  let activeMs = 0;

  for (const event of sorted) {
    const occurredAt = new Date(event.occurredAt).getTime();
    if (event.type === 'start' || event.type === 'resume') {
      if (runningFrom === null) runningFrom = occurredAt;
    } else if (event.type === 'halt' || event.type === 'end') {
      if (runningFrom !== null) {
        activeMs += Math.max(0, occurredAt - runningFrom);
        runningFrom = null;
      }
    } else if (event.type === 'adjust_time') {
      activeMs = Math.max(0, activeMs + (event.adjustmentMs ?? 0));
    } else if (event.type === 'reset_clock' || event.type === 'reset_match') {
      activeMs = 0;
      runningFrom = null;
    }
  }

  return activeMs;
}
