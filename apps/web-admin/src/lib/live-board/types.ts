// FE mirror of the API payload (apps/api/src/modules/staff/live-board-payload.ts).
// Kept structurally identical so the poll response drops straight into row
// state. There is no shared package copy — diff the two files whenever either
// side changes.

export interface BoardReferee {
  name: string;
  roleLabel: string | null;
  /**
   * A design ColorToken ('slate', 'amber', …) from `referee_skills.color` —
   * NOT a hex value. Render it through a token→class map; never interpolate it
   * into a style attribute.
   */
  roleColor: string;
  status: string;
}

export interface BoardMatch {
  id: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  /** Raw `matches.status`; translate via `matchStatusLabel`. */
  status: string;
  round: number | null;
  matchNumberLabel: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  poolName: string | null;
  tournamentName: string | null;
  phaseType: string | null;
  referees: BoardReferee[];
}

export interface BoardScorerPeer {
  accountId: string;
  name: string;
  lastSeenAt: string | null;
}

export interface BoardScorer {
  accountId: string;
  name: string;
  username: string | null;
  status: string | null;
  lastSeenAt: string | null;
  /** Always `others.length`. */
  otherCount: number;
  others: BoardScorerPeer[];
}

export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
  /**
   * Signed ms the tablet clock is AHEAD of the server at its last heartbeat.
   * `null` = never measured, which is NOT zero — see `isClockSkewed`.
   */
  clockSkewMs: number | null;
}

export interface BoardAttention {
  reason: 'medic' | 'head_ref' | 'dispute';
}

export interface BoardPlace {
  id: string;
  name: string;
}

export interface BoardQueueEntry {
  matchId: string;
  label: string;
  scheduledAt: string | null;
}

export interface BoardRow {
  lice: {
    id: string;
    name: string;
    sortOrder: number;
    locationLabel: string | null;
    colorHex: string | null;
    venue: BoardPlace | null;
    area: BoardPlace | null;
  };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  /** Always `queue[0] ?? null`. */
  nextUp: { matchId: string; label: string } | null;
  queue: BoardQueueEntry[];
  lastCompleted: { matchId: string; label: string; endedAt: string | null } | null;
}

/** The clock the board measures elapsed, late and overrun against. */
export interface LiveBoardTiming {
  /** Server clock at assembly. */
  nowIso: string;
  matchDurationMinutes: number;
  block: { id: string; label: string; startTime: string; endTime: string } | null;
}

export interface LiveBoardProgress {
  completed: number;
  total: number;
}

export interface LiveBoardAccount {
  accountId: string;
  name: string;
  username: string | null;
  status: string | null;
  lastSeenAt: string | null;
  liceIds: string[];
}

export interface LiveBoardPayload {
  rows: BoardRow[];
  timing: LiveBoardTiming;
  progress: LiveBoardProgress;
  accounts: LiveBoardAccount[];
  /** The EVENT slug, for the public piste-kiosk href. Not the org slug. */
  eventSlug: string;
}

/** A realtime `matches` UPDATE, narrowed to the fields the board patches. */
export interface MatchChange {
  id: string;
  redScore?: number;
  blueScore?: number;
  status?: string;
  round?: number | null;
}
