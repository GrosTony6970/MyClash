import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

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

export class RestoreBackupDto {
  @IsIn(['local', 's3', 'upload'])
  location!: BackupLocation;

  @IsString()
  @Matches(/^\d{8}T\d{6}Z$|^[A-Za-z0-9_-]{8,80}$/)
  backupId!: string;

  @IsOptional()
  @IsBoolean()
  includeStorage?: boolean;

  @IsBoolean()
  confirmed!: boolean;
}

export class UpdateBackupScheduleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(BACKUP_FREQUENCIES as unknown as string[])
  frequency!: BackupFrequency;

  @IsInt()
  @Min(0)
  @Max(23)
  hourUtc!: number;

  @IsInt()
  @Min(0)
  @Max(59)
  minuteUtc!: number;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth!: number;

  @IsInt()
  @Min(1)
  @Max(365)
  retentionCountLocal!: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  retentionCountCloud!: number;
}

export class DeleteAllBackupsDto {
  @IsString()
  @Matches(/^DELETE ALL MYCLASH BACKUPS$/)
  confirmation!: string;
}
