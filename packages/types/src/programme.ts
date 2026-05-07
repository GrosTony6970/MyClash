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

export interface GenerateResult {
  matchesScheduled: number;
  workshopSessionsCreated: number;
  warnings: BlockWarning[];
}

export interface SuggestConfig {
  dayStartTime: string;
  dayEndTime: string;
  parallelLiceCount: number;
  matchDurationMinutes: number;
  matchGapSeconds: number;
  breakBetweenSessionsMinutes: number;
  middayBreakStart: string;
  middayBreakEnd: string;
  registrationDurationMinutes: number;
  gearCheckDurationMinutes: number;
  refereeMeetingDurationMinutes: number;
}
