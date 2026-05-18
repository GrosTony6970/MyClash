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

export interface BackupScheduleDto {
  enabled: boolean;
  hourUtc: number;
  minuteUtc: number;
  timezoneLabel: string;
  updatedAt: string | null;
  nextRunAt: string | null;
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

  @IsInt()
  @Min(0)
  @Max(23)
  hourUtc!: number;

  @IsInt()
  @Min(0)
  @Max(59)
  minuteUtc!: number;
}
