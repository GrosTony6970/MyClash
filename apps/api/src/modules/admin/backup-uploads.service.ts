import { BadRequestException, Injectable } from '@nestjs/common';
import type { UploadLimit } from '../../common/read-upload';
import { OpsRunnerClient } from './ops-runner-client';
import type { OpsRunnerClientOptions } from './ops-runner-client';
import { UPLOAD_SESSION_ID_PATTERN } from './dto/admin-backups.dto';
import type {
  BackupChunkResponseDto,
  BackupUploadCancelResponseDto,
  BackupUploadSessionDto,
  StartBackupUploadDto,
} from './dto/admin-backups.dto';

/**
 * A backup file uploaded in chunks (ruling 216): Traefik reads a request body for 60 s at most, so
 * the screen sends a file of up to 2 GB (ruling 212) as many requests of at most 16 MiB. The ops
 * runner owns the upload, its limit and its refusals (`infra/ops-runner/upload-chunks.mjs`); this
 * service forwards each call and its answer.
 */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

@Injectable()
export class BackupUploadsService {
  private readonly ops: OpsRunnerClient;
  /** One chunk is read under it (`read-upload.ts`): the ops runner takes no longer one. */
  readonly chunkLimit: UploadLimit = {
    maxBytes: MAX_CHUNK_BYTES,
    tooLarge: 'A backup upload chunk exceeds 16 MiB.',
  };

  constructor(options: OpsRunnerClientOptions = {}) {
    this.ops = new OpsRunnerClient(options);
  }

  start(dto: StartBackupUploadDto): Promise<BackupUploadSessionDto> {
    return this.ops.post<BackupUploadSessionDto>('/upload-sessions', {
      filename: dto.filename,
      sizeBytes: dto.sizeBytes,
      fingerprint: dto.fingerprint,
    });
  }

  status(uploadId: string): Promise<BackupUploadSessionDto> {
    return this.ops.get<BackupUploadSessionDto>(route(uploadId));
  }

  /** The chunk's bytes go on whole, as the raw body, at the offset the screen read. */
  sendChunk(uploadId: string, offset: string, chunk: Buffer): Promise<BackupChunkResponseDto> {
    if (chunk.length === 0) throw new BadRequestException('No chunk uploaded.');
    return this.ops.request<BackupChunkResponseDto>(
      `${route(uploadId)}/chunks?offset=${encodeURIComponent(offset)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length),
      },
    );
  }

  complete(uploadId: string): Promise<BackupUploadSessionDto> {
    return this.ops.post<BackupUploadSessionDto>(`${route(uploadId)}/complete`, {});
  }

  cancel(uploadId: string): Promise<BackupUploadCancelResponseDto> {
    return this.ops.delete<BackupUploadCancelResponseDto>(route(uploadId));
  }
}

function route(uploadId: string): string {
  if (!UPLOAD_SESSION_ID_PATTERN.test(uploadId)) {
    throw new BadRequestException('Invalid upload identifier.');
  }
  return `/upload-sessions/${uploadId}`;
}
