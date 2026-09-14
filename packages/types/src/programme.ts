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

/**
 * One Tournament's own bout lengths on the planner sheet (ADR-018). Every length
 * is optional: a blank one reads the Event's number.
 */
export interface TournamentLengths {
  tournamentId: string;
  poolMatchDurationMinutes?: number;
  swissMatchDurationMinutes?: number;
  eliminationMatchDurationMinutes?: number;
  finalsMatchDurationMinutes?: number;
}

/**
 * The planner's sheet: the one place an organiser types a bout length (ADR-018),
 * in ADR-021's three groups. Stored per Event in `event_programme_configs`; the
 * API's `programmeConfigSchema` validates every write and owns the defaults.
 */
export interface SuggestConfig {
  // ── Day ──
  dayStartTime: string;
  dayEndTime: string;
  middayBreakStart: string;
  /** How long the midday break lasts, from `middayBreakStart`, in minutes. */
  middayBreakMinutes: number;

  // ── Bouts ── every length is whole minutes above zero.
  /** A pool bout. */
  poolMatchDurationMinutes: number;
  /** A Swiss-round bout. Absent means the pool length. */
  swissMatchDurationMinutes?: number;
  /** A bracket bout that is not a final. */
  eliminationMatchDurationMinutes: number;
  /** A bout the planner's classifier calls a final (gold, bronze, grand final). */
  finalsMatchDurationMinutes: number;
  matchGapSeconds: number;
  minRestMinutes: number;
  /** A Tournament's own lengths, read before the Event's. One row per Tournament. */
  tournaments: TournamentLengths[];

  // ── Blocks ──
  breakBetweenSessionsMinutes: number;
  refereeMeetingDurationMinutes: number;
  /** Registration and gear check: one block, in minutes. */
  arrivalAndGearCheckMinutes: number;
}
