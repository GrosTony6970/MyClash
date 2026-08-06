// apps/api/src/modules/staff/live-board-payload.ts
//
// The shape `GET /events/:eventId/live-board` returns. Split from live-board.ts
// (which owns the raw DB rows and the assembly) so the wire contract reads on
// its own — apps/web-admin mirrors this file by hand, and diffing the two is a
// review step on every change here.

/** One officiating referee as the board renders them. */
export interface BoardReferee {
  name: string;
  roleLabel: string | null;
  /**
   * A design ColorToken ('slate', 'amber', …) from `referee_skills.color` —
   * NOT a hex value. Map it through the app's token→class table; never
   * interpolate it into a style attribute.
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
  /** Raw `matches.status`; the FE maps it through organizer.live.matchStatus.*. */
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
  /** Always `others.length`; kept because the phone card renders the count alone. */
  otherCount: number;
  others: BoardScorerPeer[];
}

export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
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
    /** From `lices.color_hex`. */
    colorHex: string | null;
    venue: BoardPlace | null;
    area: BoardPlace | null;
  };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  /** Always `queue[0] ?? null`; kept because the realtime merge patches it. */
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

/** Event-wide bout progress for the summary strip. */
export interface LiveBoardProgress {
  completed: number;
  total: number;
}

/**
 * Every staff account on the event with the pistes it covers.
 *
 * Shipped with the board because `GET /events/:id/staff-accounts` requires the
 * `editor` role while the board requires only `scorekeeper` — a scorekeeper
 * reassigning a piste could not otherwise list the candidates. Costs nothing:
 * the accounts and assignments are already fetched to build the rows.
 */
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
}
