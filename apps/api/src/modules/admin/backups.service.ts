import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { Injectable, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import type {
  BackupActionResponseDto,
  BackupArtifactDto,
  BackupDeleteResponseDto,
  BackupListResponseDto,
  BackupLocation,
  BackupOperationDto,
  BackupSetDto,
  BackupStatusDto,
  BackupUploadResponseDto,
} from './dto/admin-backups.dto';
import type { RestoreBackupDto } from './dto/admin-backups.dto';

const TIMESTAMP_PATTERN = /^\d{8}T\d{6}Z$/;
const BACKUP_FILENAME_PATTERN =
  /^(db-(?<dbTs>\d{8}T\d{6}Z)\.sql\.gz|storage-(?<storageTs>\d{8}T\d{6}Z)\.tar\.gz)(?<gpg>\.gpg)?$/;
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const DEFAULT_OPS_TIMEOUT_MS = 15_000;
const DEFAULT_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

type FetchLike = typeof fetch;

export interface AdminBackupsServiceOptions {
  rootDir?: string;
  backupsDir?: string;
  opsRunnerUrl?: string;
  opsRunnerSecret?: string;
  fetchImpl?: FetchLike;
  uploadMaxBytes?: number;
}

@Injectable()
export class AdminBackupsService {
  private readonly rootDir: string;
  private readonly backupsDir: string;
  private readonly opsRunnerUrl: string;
  private readonly opsRunnerSecret: string;
  private readonly fetchImpl: FetchLike;
  private readonly uploadMaxBytes: number;

  constructor(options: AdminBackupsServiceOptions = {}) {
    this.rootDir = options.rootDir ?? path.resolve(process.cwd(), '..', '..');
    this.backupsDir =
      options.backupsDir ?? process.env['BACKUP_LOCAL_DIR'] ?? path.join(this.rootDir, 'backups');
    this.opsRunnerUrl = stripTrailingSlash(options.opsRunnerUrl ?? process.env['OPS_RUNNER_URL']);
    this.opsRunnerSecret = options.opsRunnerSecret ?? process.env['OPS_RUNNER_SECRET'] ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.uploadMaxBytes =
      options.uploadMaxBytes ??
      Number(process.env['BACKUP_UPLOAD_MAX_BYTES'] ?? DEFAULT_UPLOAD_MAX_BYTES);
  }

  async getStatus(): Promise<BackupStatusDto> {
    if (this.hasOpsRunner()) {
      return this.opsGet<BackupStatusDto>('/status');
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
    if (this.hasOpsRunner()) {
      return this.opsGet<BackupListResponseDto>('/backups');
    }
    return {
      generatedAt: new Date().toISOString(),
      backups: await this.readLocalBackups(),
    };
  }

  async triggerBackup(): Promise<BackupActionResponseDto> {
    return this.opsPost<BackupActionResponseDto>('/operations/backup', {});
  }

  async restoreBackup(dto: RestoreBackupDto): Promise<BackupActionResponseDto> {
    validateBackupId(dto.backupId, dto.location);
    if (!dto.confirmed) {
      throw new BadRequestException('Restore confirmation is required.');
    }
    const expectedConfirmation = `RESTORE MYCLASH ${dto.backupId}`;
    return this.opsPost<BackupActionResponseDto>('/operations/restore', {
      location: dto.location,
      backupId: dto.backupId,
      includeStorage: dto.includeStorage ?? true,
      confirmation: expectedConfirmation,
    });
  }

  async deleteBackup(
    backupId: string,
    location: Extract<BackupLocation, 'local' | 's3'>,
  ): Promise<BackupDeleteResponseDto> {
    validateBackupId(backupId, location);
    if (!['local', 's3'].includes(location)) {
      throw new BadRequestException('Invalid backup location.');
    }
    return this.opsDelete<BackupDeleteResponseDto>(
      `/backups/${encodeURIComponent(backupId)}?location=${encodeURIComponent(location)}`,
    );
  }

  async getOperation(operationId: string): Promise<BackupOperationDto> {
    validateOperationId(operationId);
    return this.opsGet<BackupOperationDto>(`/operations/${encodeURIComponent(operationId)}`);
  }

  async uploadBackup(filename: string, buffer: Buffer): Promise<BackupUploadResponseDto> {
    validateBackupFilename(filename);
    if (buffer.length === 0) {
      throw new BadRequestException('No backup file uploaded.');
    }
    if (buffer.length > this.uploadMaxBytes) {
      throw new BadRequestException('Backup upload exceeds the configured size limit.');
    }
    return this.opsPost<BackupUploadResponseDto>('/uploads', {
      filename,
      contentBase64: buffer.toString('base64'),
    });
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
    if (!this.hasOpsRunner()) {
      throw new ServiceUnavailableException('Backup downloads require the ops runner.');
    }

    const url = new URL(`${this.opsRunnerUrl}/download/${encodeURIComponent(backupId)}`);
    url.searchParams.set('location', location);
    url.searchParams.set('artifact', artifact);
    const response = await this.fetchImpl(url, {
      headers: this.opsHeaders(),
      signal: AbortSignal.timeout(DEFAULT_OPS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(`Ops runner download failed with ${response.status}.`);
    }
    if (!response.body) {
      throw new ServiceUnavailableException('Ops runner returned an empty download response.');
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    return {
      filename: filenameFromDisposition(disposition) ?? `myclash-backup-${backupId}.bin`,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      stream: Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    };
  }

  private hasOpsRunner(): boolean {
    return Boolean(this.opsRunnerUrl && this.opsRunnerSecret);
  }

  private async opsGet<T>(route: string): Promise<T> {
    return this.opsRequest<T>(route, { method: 'GET' });
  }

  private async opsPost<T>(route: string, body: unknown): Promise<T> {
    return this.opsRequest<T>(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async opsDelete<T>(route: string): Promise<T> {
    return this.opsRequest<T>(route, { method: 'DELETE' });
  }

  private async opsRequest<T>(route: string, init: RequestInit): Promise<T> {
    if (!this.hasOpsRunner()) {
      throw new ServiceUnavailableException('Backup operations require the ops runner.');
    }
    const response = await this.fetchImpl(`${this.opsRunnerUrl}${route}`, {
      ...init,
      headers: { ...this.opsHeaders(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(DEFAULT_OPS_TIMEOUT_MS),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        message || `Ops runner request failed with ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  }

  private opsHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.opsRunnerSecret}` };
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

function validateBackupFilename(filename: string): void {
  if (filename !== path.basename(filename) || !BACKUP_FILENAME_PATTERN.test(filename)) {
    throw new BadRequestException('Unsupported backup filename.');
  }
}

function validateBackupId(backupId: string, location: BackupLocation): void {
  const ok =
    location === 'upload' ? UPLOAD_ID_PATTERN.test(backupId) : TIMESTAMP_PATTERN.test(backupId);
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

function stripTrailingSlash(value: string | undefined): string {
  return value?.replace(/\/+$/, '') ?? '';
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
