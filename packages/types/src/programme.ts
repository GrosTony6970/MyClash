export type BlockType = 'admin' | 'competition' | 'workshop' | 'break';
export type ProgrammePhase = 'pool' | 'bracket' | 'finals';

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
  matchDurationMinutes: number;
  matchGapSeconds: number;
  minRestMinutes: number;
  breakBetweenSessionsMinutes: number;
  middayBreakStart: string;
  middayBreakEnd: string;
  registrationDurationMinutes: number;
  gearCheckDurationMinutes: number;
  refereeMeetingDurationMinutes: number;
}
