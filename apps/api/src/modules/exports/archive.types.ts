import type { ArchiveRow } from './archive.table-spec';
import type { ArchiveKey } from './archive.tables';

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

export type { ArchiveRow } from './archive.table-spec';

/**
 * One member per archived table, derived from the registry.
 *
 * This was a hand-written interface listing all 41 camelCase keys — one of six
 * places a table had to be named, and the one that at least failed loudly. The
 * registry in `archive.tables.ts` is the single source now: add a table there
 * and this widens with it.
 */
export type ArchiveTables = Record<ArchiveKey, ArchiveRow[]>;

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
