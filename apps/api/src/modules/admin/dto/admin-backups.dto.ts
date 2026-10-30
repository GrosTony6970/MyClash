import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A server backup set is named by its night. */
export const BACKUP_TIMESTAMP_PATTERN = /^\d{8}T\d{6}Z$/;
/** An uploaded set is one night too (`infra/ops-runner/upload-store.mjs` holds the same shape). */
export const UPLOAD_ID_PATTERN = /^upload-\d{8}T\d{6}Z$/;
/** A backup file: a night's database or images, plain or encrypted (the ops runner's shape). */
export const BACKUP_FILENAME_PATTERN =
  /^(db-(?<dbTs>\d{8}T\d{6}Z)\.sql\.gz|storage-(?<storageTs>\d{8}T\d{6}Z)\.tar\.gz)(?<gpg>\.gpg)?$/;
/** An open chunked upload (`infra/ops-runner/upload-session-files.mjs` holds the same shape). */
export const UPLOAD_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type BackupArtifactKind = 'db' | 'storage';
export type BackupLocation = 'local' | 's3' | 'upload';
export type BackupOperationKind = 'backup' | 'restore';
export type BackupOperationStatus = 'queued' | 'running' | 'success' | 'failed';

export interface BackupArtifactDto {
  kind: BackupArtifactKind;
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  encrypted: boolean;
}

export interface BackupSetDto {
  id: string;
  timestamp: string;
  displayName: string;
  local: {
    available: boolean;
    artifacts: BackupArtifactDto[];
  };
  cloud: {
    available: boolean;
    artifacts: BackupArtifactDto[];
  };
  upload?: {
    available: boolean;
    artifacts: BackupArtifactDto[];
  };
}

export interface BackupOperationDto {
  id: string;
  kind: BackupOperationKind;
  status: BackupOperationStatus;
  startedAt: string;
  finishedAt?: string;
  source?: BackupLocation;
  backupId?: string;
  logTail: string[];
  error?: string;
  /** A refusal the screen words itself (`ops_busy`: the lock was held). */
  code?: string | null;
}

export interface BackupStatusDto {
  generatedAt: string;
  cloudConfigured: boolean;
  lastBackup: {
    timestamp: string;
    status: 'success' | 'failed' | 'unknown';
    /** Wall-clock finish of the most recent backup run, when known. */
    finishedAt?: string | null;
    /** Error message from the most recent backup run, when it failed. */
    error?: string | null;
    /** A failure the screen words itself: `scheduled_backup_missed` (ruling 217). */
    code?: string | null;
    localAvailable: boolean;
    cloudAvailable: boolean;
  } | null;
  runningOperation: BackupOperationDto | null;
}

export interface BackupListResponseDto {
  generatedAt: string;
  backups: BackupSetDto[];
}

export type BackupFrequency = 'hourly' | 'every6h' | 'every12h' | 'daily' | 'weekly' | 'monthly';

export const BACKUP_FREQUENCIES: readonly BackupFrequency[] = [
  'hourly',
  'every6h',
  'every12h',
  'daily',
  'weekly',
  'monthly',
] as const;

export interface BackupScheduleDto {
  enabled: boolean;
  frequency: BackupFrequency;
  hourUtc: number;
  minuteUtc: number;
  /** 0 = Sunday … 6 = Saturday. Only meaningful when `frequency=weekly`. */
  dayOfWeek: number;
  /** 1..28. Capped at 28 so the schedule fires every month. */
  dayOfMonth: number;
  /** Keep last N local backup sets on the VPS disk. */
  retentionCountLocal: number;
  /** Keep last N S3 backup sets in the cloud. */
  retentionCountCloud: number;
  timezoneLabel: string;
  updatedAt: string | null;
  nextRunAt: string | null;
}

export interface DeleteAllBackupsResponseDto {
  deleted: true;
  deletedLocalSets: number;
  deletedCloudSets: number;
  /** Delete-all clears the uploaded nights too (ruling 218). */
  deletedUploadSets: number;
  deletedFiles: string[];
  /** Local artifacts the wipe could not remove. Reported, never swallowed. */
  failedFiles: string[];
}

export interface BackupActionResponseDto {
  operation: BackupOperationDto;
}

/** Where a chunked upload is (rulings 212, 216, 219), as the ops runner says it. */
export interface BackupUploadSessionDto {
  uploadId: string;
  filename: string;
  sizeBytes: number;
  receivedBytes: number;
  /** A chunk is at most this long. */
  maxChunkBytes: number;
  state: 'receiving' | 'verifying' | 'staging' | 'staged' | 'failed';
  /** Why it waits or failed, for the screen to word: `ops_busy`, `upload_corrupt`… */
  code: string | null;
  error?: string;
  /** The night's whole set, once staged. */
  backup?: BackupSetDto;
}

export interface BackupChunkResponseDto {
  receivedBytes: number;
}

export interface BackupUploadCancelResponseDto {
  cancelled: true;
  uploadId: string;
}

const startBackupUploadSchema = z
  .object({
    filename: z.string().regex(BACKUP_FILENAME_PATTERN),
    sizeBytes: z.number().int().positive(),
    /** sha-256 of the file's first MiB, hex: the same file started again resumes (ruling 219). */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export class StartBackupUploadDto extends createZodDto(startBackupUploadSchema) {}

const backupChunkQuerySchema = z
  .object({
    /** Digits only: a number parser would read `''` as 0 and `1e3` as 1000. */
    offset: z.string().regex(/^\d+$/),
  })
  .strict();
export class BackupChunkQueryDto extends createZodDto(backupChunkQuerySchema) {}

export interface BackupDeleteResponseDto {
  deleted: true;
  backupId: string;
  location: BackupLocation;
  deletedArtifacts: string[];
}

const restoreBackupSchema = z
  .object({
    location: z.enum(['local', 's3', 'upload']),
    backupId: z
      .string()
      .regex(new RegExp(`${BACKUP_TIMESTAMP_PATTERN.source}|${UPLOAD_ID_PATTERN.source}`)),
    includeStorage: z.boolean().optional(),
    /**
     * What the dialog said an upload restores. The ops runner refuses the restore when the night
     * changed since (another tab uploaded a file), so "images only" never drops the database.
     */
    scope: z.enum(['both', 'database', 'images']).optional(),
    confirmed: z.boolean(),
  })
  .strict()
  // A server set restores database + images, whatever a scope said: refused, not ignored.
  .refine((body) => body.scope === undefined || body.location === 'upload', {
    message: 'A restore scope is for an uploaded backup only.',
    path: ['scope'],
  });
export class RestoreBackupDto extends createZodDto(restoreBackupSchema) {}

const updateBackupScheduleSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(BACKUP_FREQUENCIES as unknown as [BackupFrequency, ...BackupFrequency[]]),
    hourUtc: z.number().int().min(0).max(23),
    minuteUtc: z.number().int().min(0).max(59),
    dayOfWeek: z.number().int().min(0).max(6),
    dayOfMonth: z.number().int().min(1).max(28),
    retentionCountLocal: z.number().int().min(1).max(365),
    retentionCountCloud: z.number().int().min(1).max(3650),
  })
  .strict();
export class UpdateBackupScheduleDto extends createZodDto(updateBackupScheduleSchema) {}

const deleteAllBackupsSchema = z
  .object({
    confirmation: z.string().regex(/^DELETE ALL MYCLASH BACKUPS$/),
  })
  .strict();
export class DeleteAllBackupsDto extends createZodDto(deleteAllBackupsSchema) {}
