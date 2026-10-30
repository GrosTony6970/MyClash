import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
// `Readable.fromWeb` takes the stream/web ReadableStream, which is a distinct
// declaration from the global (DOM) one of the same name — only the former's
// async iterator carries [Symbol.asyncDispose]. Node exposes the stream/web
// class as the global at runtime, so this import just disambiguates the type.
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import path from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { OPS_RUNNER_TIMEOUT_MS, OpsRunnerClient } from './ops-runner-client';
import type { OpsRunnerClientOptions } from './ops-runner-client';
import {
  BACKUP_FILENAME_PATTERN,
  BACKUP_TIMESTAMP_PATTERN,
  UPLOAD_ID_PATTERN,
} from './dto/admin-backups.dto';
import type {
  BackupActionResponseDto,
  BackupArtifactDto,
  BackupDeleteResponseDto,
  BackupListResponseDto,
  BackupLocation,
  BackupOperationDto,
  BackupScheduleDto,
  BackupSetDto,
  BackupStatusDto,
  DeleteAllBackupsResponseDto,
} from './dto/admin-backups.dto';
import type {
  DeleteAllBackupsDto,
  RestoreBackupDto,
  UpdateBackupScheduleDto,
} from './dto/admin-backups.dto';

export interface AdminBackupsServiceOptions extends OpsRunnerClientOptions {
  rootDir?: string;
  backupsDir?: string;
}

/** The backups screen's reads and actions. An upload arrives in chunks: `BackupUploadsService`. */
@Injectable()
export class AdminBackupsService {
  private readonly rootDir: string;
  private readonly backupsDir: string;
  private readonly ops: OpsRunnerClient;

  constructor(options: AdminBackupsServiceOptions = {}) {
    this.rootDir = options.rootDir ?? path.resolve(process.cwd(), '..', '..');
    this.backupsDir =
      options.backupsDir ?? process.env['BACKUP_LOCAL_DIR'] ?? path.join(this.rootDir, 'backups');
    this.ops = new OpsRunnerClient(options);
  }

  async getStatus(): Promise<BackupStatusDto> {
    if (this.ops.available()) {
      return this.ops.get<BackupStatusDto>('/status');
    }
    const backups = await this.readLocalBackups();
    const last = backups[0] ?? null;
    return {
      generatedAt: new Date().toISOString(),
      cloudConfigured: false,
      lastBackup: last
        ? {
            timestamp: last.timestamp,
            status: 'unknown',
            localAvailable: last.local.available,
            cloudAvailable: false,
          }
        : null,
      runningOperation: null,
    };
  }

  async listBackups(): Promise<BackupListResponseDto> {
    if (this.ops.available()) {
      return this.ops.get<BackupListResponseDto>('/backups');
    }
    return {
      generatedAt: new Date().toISOString(),
      backups: await this.readLocalBackups(),
    };
  }

  async triggerBackup(): Promise<BackupActionResponseDto> {
    return this.ops.post<BackupActionResponseDto>('/operations/backup', {});
  }

  async getSchedule(): Promise<BackupScheduleDto> {
    return this.ops.get<BackupScheduleDto>('/schedule');
  }

  async updateSchedule(dto: UpdateBackupScheduleDto): Promise<BackupScheduleDto> {
    return this.ops.put<BackupScheduleDto>('/schedule', {
      enabled: dto.enabled,
      frequency: dto.frequency,
      hourUtc: dto.hourUtc,
      minuteUtc: dto.minuteUtc,
      dayOfWeek: dto.dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
      retentionCountLocal: dto.retentionCountLocal,
      retentionCountCloud: dto.retentionCountCloud,
      timezoneLabel: 'UTC',
    });
  }

  async deleteAllBackups(dto: DeleteAllBackupsDto): Promise<DeleteAllBackupsResponseDto> {
    if (dto.confirmation !== 'DELETE ALL MYCLASH BACKUPS') {
      throw new BadRequestException('Delete-all confirmation is required.');
    }
    return this.ops.request<DeleteAllBackupsResponseDto>('/backups', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: dto.confirmation }),
    });
  }

  async restoreBackup(dto: RestoreBackupDto): Promise<BackupActionResponseDto> {
    validateBackupId(dto.backupId, dto.location);
    if (!dto.confirmed) {
      throw new BadRequestException('Restore confirmation is required.');
    }
    const expectedConfirmation = `RESTORE MYCLASH ${dto.backupId}`;
    return this.ops.post<BackupActionResponseDto>('/operations/restore', {
      location: dto.location,
      backupId: dto.backupId,
      includeStorage: dto.includeStorage ?? true,
      ...(dto.scope ? { scope: dto.scope } : {}),
      confirmation: expectedConfirmation,
    });
  }

  async deleteBackup(backupId: string, location: BackupLocation): Promise<BackupDeleteResponseDto> {
    if (!['local', 's3', 'upload'].includes(location)) {
      throw new BadRequestException('Invalid backup location.');
    }
    validateBackupId(backupId, location);
    return this.ops.delete<BackupDeleteResponseDto>(
      `/backups/${encodeURIComponent(backupId)}?location=${encodeURIComponent(location)}`,
    );
  }

  async getOperation(operationId: string): Promise<BackupOperationDto> {
    validateOperationId(operationId);
    return this.ops.get<BackupOperationDto>(`/operations/${encodeURIComponent(operationId)}`);
  }

  async downloadBackup(
    backupId: string,
    location: BackupLocation,
    artifact: 'db' | 'storage' | 'bundle',
  ): Promise<{ filename: string; contentType: string; stream: Readable }> {
    validateBackupId(backupId, location);
    if (!['db', 'storage', 'bundle'].includes(artifact)) {
      throw new BadRequestException('Invalid backup artifact.');
    }
    if (!this.ops.available()) {
      throw new OperationalUnavailableException('Backup downloads require the ops runner.');
    }

    const url = new URL(`${this.ops.url}/download/${encodeURIComponent(backupId)}`);
    url.searchParams.set('location', location);
    url.searchParams.set('artifact', artifact);
    const response = await this.ops.fetch(url, {
      headers: this.ops.headers(),
      signal: AbortSignal.timeout(OPS_RUNNER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new OperationalUnavailableException(
        `Ops runner download failed with ${response.status}.`,
      );
    }
    if (!response.body) {
      throw new OperationalUnavailableException('Ops runner returned an empty download response.');
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    return {
      filename: filenameFromDisposition(disposition) ?? `myclash-backup-${backupId}.bin`,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      stream: Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    };
  }

  private async readLocalBackups(): Promise<BackupSetDto[]> {
    const nightlyDir = path.join(this.backupsDir, 'nightly');
    let entries: string[];
    try {
      entries = await readdir(nightlyDir);
    } catch {
      return [];
    }

    const byTimestamp = new Map<string, BackupArtifactDto[]>();
    for (const entry of entries) {
      const parsed = parseBackupFilename(entry);
      if (!parsed) continue;
      const fileStat = await stat(path.join(nightlyDir, entry));
      const artifacts = byTimestamp.get(parsed.timestamp) ?? [];
      artifacts.push({
        kind: parsed.kind,
        filename: entry,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        encrypted: parsed.encrypted,
      });
      byTimestamp.set(parsed.timestamp, artifacts);
    }

    return [...byTimestamp.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([timestamp, artifacts]) => ({
        id: timestamp,
        timestamp,
        displayName: timestamp,
        local: { available: artifacts.length > 0, artifacts },
        cloud: { available: false, artifacts: [] },
      }));
  }
}

function parseBackupFilename(
  filename: string,
): { kind: 'db' | 'storage'; timestamp: string; encrypted: boolean } | null {
  const match = BACKUP_FILENAME_PATTERN.exec(filename);
  if (!match?.groups) return null;
  const timestamp = match.groups['dbTs'] ?? match.groups['storageTs'];
  if (!timestamp) return null;
  return {
    kind: match.groups['dbTs'] ? 'db' : 'storage',
    timestamp,
    encrypted: Boolean(match.groups['gpg']),
  };
}

function validateBackupId(backupId: string, location: BackupLocation): void {
  const ok =
    location === 'upload'
      ? UPLOAD_ID_PATTERN.test(backupId)
      : BACKUP_TIMESTAMP_PATTERN.test(backupId);
  if (!ok) throw new BadRequestException('Invalid backup identifier.');
}

function validateOperationId(operationId: string): void {
  if (!operationId || operationId.length > 80 || !/^[A-Za-z0-9_-]+$/.test(operationId)) {
    throw new BadRequestException('Invalid operation identifier.');
  }
}

function filenameFromDisposition(disposition: string): string | null {
  const match = /filename="(?<filename>[^"]+)"/.exec(disposition);
  return match?.groups?.['filename'] ?? null;
}

export function createBackupOperation(kind: 'backup' | 'restore'): BackupOperationDto {
  return {
    id: randomUUID(),
    kind,
    status: 'queued',
    startedAt: new Date().toISOString(),
    logTail: [],
  };
}
