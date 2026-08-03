export type BlockType = 'admin' | 'competition' | 'workshop' | 'break';
export type ProgrammePhase = 'pool' | 'swiss' | 'bracket' | 'finals';

export interface ProgrammeBlock {
  id: string;
  eventId: string;
  dayIndex: number;
  sortOrder: number;
  blockType: BlockType;
  label: string;
  competitionId: string | null;
  competitionPhase: ProgrammePhase | null;
  workshopId: string | null;
  liceCount: number;
  startTime: string;
  endTime: string;
  matchGapSeconds: number;
  matchDurationMinutes: number;
  /** Minimum rest per fighter between their matches, in minutes (competition
   *  blocks only — the scheduler waits this long before re-pairing a fighter). */
  minRestMinutes: number;
  /** Optional "#rrggbb" override for the bar tint; null = per-kind default. */
  colorHex: string | null;
  generatedAt: string | null;
}

export interface BlockWarning {
  blockId: string;
  message: string;
  suggestedEndTime: string;
  overflowMinutes: number;
}

export interface ProgrammeSuggestion {
  blocks: ProgrammeBlock[];
  warnings: BlockWarning[];
}

export interface BlockDiagnostic {
  blockId: string;
  blockLabel: string;
  blockType: BlockType;
  fetchedMatches: number;
  scheduledMatches: number;
  licesAvailable: number;
}

export interface GenerateResult {
  matchesScheduled: number;
  workshopSessionsCreated: number;
  warnings: BlockWarning[];
  /**
   * Per-block summary. Lets the operator see why a competition block
   * produced zero scheduled matches (no draws yet, no lices for the
   * event, block too narrow, etc.) instead of just seeing a `0`.
   * Optional for backward compatibility on consumers that don't read
   * it yet.
   */
  blockDiagnostics?: BlockDiagnostic[];
}

export interface SuggestConfig {
  dayStartTime: string;
  dayEndTime: string;
  parallelLiceCount: number;
  /** Duration of a pool match, in minutes (drives the Pools bars). */
  poolMatchDurationMinutes: number;
  /**
   * Duration of a Swiss-round match, in minutes (drives the Swiss bars).
   * Optional: a payload predating the Swiss format omits it, and the server
   * falls back to `poolMatchDurationMinutes` — a Swiss bout is a group-stage
   * bout, so the pool clock is the honest default.
   */
  swissMatchDurationMinutes?: number;
  /** Duration of a non-final bracket match, in minutes (drives the Bracket bars). */
  eliminationMatchDurationMinutes: number;
  /** Duration of a final-round match — gold + bronze (drives the Finals bars). */
  finalsMatchDurationMinutes: number;
  matchGapSeconds: number;
  minRestMinutes: number;
  breakBetweenSessionsMinutes: number;
  middayBreakStart: string;
  middayBreakEnd: string;
  registrationDurationMinutes: number;
  gearCheckDurationMinutes: number;
  refereeMeetingDurationMinutes: number;
}
