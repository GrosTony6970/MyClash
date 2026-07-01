export type ArchiveInclude = 'structure' | 'scoring';
export type ArchiveScope = 'event' | 'tournament';

export interface ArchiveOptions {
  include: ArchiveInclude;
}

export interface ArchiveSource {
  eventId: string;
  eventSlug: string;
  eventName: string;
  eventStatus: string;
  tournamentId?: string;
  tournamentSlug?: string;
  tournamentName?: string;
  tournamentStatus?: string;
}

export type ArchiveRow = Record<string, unknown>;

export interface ArchiveTables {
  events: ArchiveRow[];
  themes: ArchiveRow[];
  lices: ArchiveRow[];
  persons: ArchiveRow[];
  personPrivacy: ArchiveRow[];
  refereeQualifications: ArchiveRow[];
  poolAssignmentSettings: ArchiveRow[];
  tournaments: ArchiveRow[];
  registrations: ArchiveRow[];
  phases: ArchiveRow[];
  pools: ArchiveRow[];
  poolMembers: ArchiveRow[];
  bracketSlots: ArchiveRow[];
  matches: ArchiveRow[];
  matchEvents: ArchiveRow[];
  exchanges: ArchiveRow[];
  refereeAssignments: ArchiveRow[];
  workshops: ArchiveRow[];
  workshopInstructors: ArchiveRow[];
  workshopSessions: ArchiveRow[];
  workshopEnrollments: ArchiveRow[];
  workshopBreaks: ArchiveRow[];
  eventProgrammeBlocks: ArchiveRow[];
  refereeSkills: ArchiveRow[];
  eventReferees: ArchiveRow[];
  eventRefereeTournaments: ArchiveRow[];
  eventRefereeDays: ArchiveRow[];
  eventHiddenSkills: ArchiveRow[];
  eventInstructors: ArchiveRow[];
  eventSlotConfigDefault: ArchiveRow[];
  eventSlotConfigDefaultSkills: ArchiveRow[];
  tournamentSlotConfig: ArchiveRow[];
  tournamentSlotAllowedSkills: ArchiveRow[];
  tournamentPhaseVenues: ArchiveRow[];
  eventVenues: ArchiveRow[];
  refereeCompensationEventSettings: ArchiveRow[];
  matchPenalties: ArchiveRow[];
  matchForfeits: ArchiveRow[];
  tournamentPenaltyReviews: ArchiveRow[];
}

export interface TournamentArchiveReports {
  tournamentId: string;
  tournamentName: string;
  matchesCsv: string;
  exchangesCsv: string;
  resultsCsv: string;
  rankingsCsv: string;
}

export interface MyClashArchive {
  manifest: 'myclash.archive.v1';
  version: 1;
  generatedAt: string;
  scope: ArchiveScope;
  include: ArchiveInclude;
  source: ArchiveSource;
  data: Partial<ArchiveTables> & Pick<ArchiveTables, 'events' | 'tournaments'>;
  reports: {
    tournaments: TournamentArchiveReports[];
  };
}

export interface RestorePreview {
  manifest: string;
  version: number;
  scope: ArchiveScope;
  include: ArchiveInclude;
  source: ArchiveSource;
  counts: Record<string, number>;
  warnings: string[];
  canRestore: boolean;
}

export interface RestoreOptions {
  targetOrganizationId?: string;
  targetEventId?: string;
  confirmation?: string;
}

export interface RestoreResult {
  scope: ArchiveScope;
  restoredEventId?: string;
  restoredTournamentId?: string;
  restoredSlug: string;
  counts: Record<string, number>;
}
