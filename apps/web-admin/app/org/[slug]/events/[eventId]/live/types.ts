// FE mirror of the API payload (apps/api/src/modules/staff/live-board.ts BoardRow).
// Kept structurally identical so the poll response drops straight into row state.

export interface BoardMatch {
  id: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  status: string;
  round: number | null;
}
export interface BoardScorer {
  accountId: string;
  name: string;
  lastSeenAt: string | null;
  otherCount: number;
}
export interface BoardHealth {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}
export interface BoardAttention {
  reason: 'medic' | 'head_ref' | 'dispute';
}
export interface BoardRow {
  lice: { id: string; name: string; sortOrder: number };
  currentMatch: BoardMatch | null;
  scorer: BoardScorer | null;
  health: BoardHealth | null;
  attention: BoardAttention | null;
  nextUp: { matchId: string; label: string } | null;
}

/** A realtime `matches` UPDATE, narrowed to the fields the board patches. */
export interface MatchChange {
  id: string;
  redScore?: number;
  blueScore?: number;
  status?: string;
  round?: number | null;
}
