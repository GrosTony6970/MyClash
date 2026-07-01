import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
  deletedFiles: string[];
}

export interface BackupActionResponseDto {
  operation: BackupOperationDto;
}

export interface BackupUploadResponseDto {
  backup: BackupSetDto;
}

export interface BackupDeleteResponseDto {
  deleted: true;
  backupId: string;
  location: Extract<BackupLocation, 'local' | 's3'>;
  deletedArtifacts: string[];
}

const restoreBackupSchema = z
  .object({
    location: z.enum(['local', 's3', 'upload']),
    backupId: z.string().regex(/^\d{8}T\d{6}Z$|^[A-Za-z0-9_-]{8,80}$/),
    includeStorage: z.boolean().optional(),
    confirmed: z.boolean(),
  })
  .strict();
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
