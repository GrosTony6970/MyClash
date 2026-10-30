import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NO_UPLOAD, readUpload } from '../../common/read-upload';
import { BackupUploadsService } from './backup-uploads.service';
import { AdminBackupsService } from './backups.service';
import type {
  BackupActionResponseDto,
  BackupChunkResponseDto,
  BackupDeleteResponseDto,
  BackupListResponseDto,
  BackupLocation,
  BackupScheduleDto,
  BackupStatusDto,
  BackupUploadCancelResponseDto,
  BackupUploadSessionDto,
  DeleteAllBackupsResponseDto,
} from './dto/admin-backups.dto';
import {
  BackupChunkQueryDto,
  DeleteAllBackupsDto,
  RestoreBackupDto,
  StartBackupUploadDto,
  UpdateBackupScheduleDto,
} from './dto/admin-backups.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@PlatformRole('super_admin')
@Controller('admin/backups')
export class BackupsAdminController {
  constructor(
    private readonly backups: AdminBackupsService,
    private readonly uploads: BackupUploadsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get backup status summary' })
  getStatus(): Promise<BackupStatusDto> {
    return this.backups.getStatus();
  }

  @Get()
  @ApiOperation({ summary: 'List local and cloud backups' })
  listBackups(): Promise<BackupListResponseDto> {
    return this.backups.listBackups();
  }

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger a manual backup' })
  triggerBackup(): Promise<BackupActionResponseDto> {
    return this.backups.triggerBackup();
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Get backup schedule' })
  getSchedule(): Promise<BackupScheduleDto> {
    return this.backups.getSchedule();
  }

  @Put('schedule')
  @ApiOperation({ summary: 'Update backup schedule' })
  updateSchedule(@Body() dto: UpdateBackupScheduleDto): Promise<BackupScheduleDto> {
    return this.backups.updateSchedule(dto);
  }

  @Post('restore')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Restore from a local, cloud, or uploaded backup' })
  restoreBackup(@Body() dto: RestoreBackupDto): Promise<BackupActionResponseDto> {
    return this.backups.restoreBackup(dto);
  }

  @Delete()
  @ApiOperation({
    summary:
      'Wipe every local, S3 and uploaded backup. Requires the literal confirmation token "DELETE ALL MYCLASH BACKUPS".',
  })
  deleteAllBackups(@Body() dto: DeleteAllBackupsDto): Promise<DeleteAllBackupsResponseDto> {
    return this.backups.deleteAllBackups(dto);
  }

  @Delete(':backupId')
  @ApiOperation({ summary: 'Delete a local, Scaleway S3 or uploaded backup copy' })
  @ApiParam({ name: 'backupId', type: 'string' })
  @ApiQuery({ name: 'location', enum: ['local', 's3', 'upload'] })
  deleteBackup(
    @Param('backupId') backupId: string,
    @Query('location') location: BackupLocation = 'local',
  ): Promise<BackupDeleteResponseDto> {
    return this.backups.deleteBackup(backupId, location);
  }

  @Get('operations/:operationId')
  @ApiOperation({ summary: 'Get backup operation status' })
  @ApiParam({ name: 'operationId', type: 'string' })
  getOperation(@Param('operationId') operationId: string) {
    return this.backups.getOperation(operationId);
  }

  // A backup file arrives in chunks (ruling 216): Traefik reads a request body for 60 s at most.
  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start, or resume (the same file), a chunked backup upload' })
  startUpload(@Body() dto: StartBackupUploadDto): Promise<BackupUploadSessionDto> {
    return this.uploads.start(dto);
  }

  @Get('uploads/:uploadId')
  @ApiOperation({ summary: 'Where a chunked backup upload is' })
  @ApiParam({ name: 'uploadId', type: 'string' })
  uploadStatus(@Param('uploadId') uploadId: string): Promise<BackupUploadSessionDto> {
    return this.uploads.status(uploadId);
  }

  @Put('uploads/:uploadId/chunks')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Send one chunk (at most 16 MiB) of a backup upload at its offset' })
  @ApiParam({ name: 'uploadId', type: 'string' })
  async sendChunk(
    @Param('uploadId') uploadId: string,
    @Query() query: BackupChunkQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<BackupChunkResponseDto> {
    const { buffer } = (await readUpload(req, this.uploads.chunkLimit)) ?? NO_UPLOAD;
    return this.uploads.sendChunk(uploadId, query.offset, buffer);
  }

  @Post('uploads/:uploadId/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Check a fully sent backup upload, then keep it as its night' })
  @ApiParam({ name: 'uploadId', type: 'string' })
  completeUpload(@Param('uploadId') uploadId: string): Promise<BackupUploadSessionDto> {
    return this.uploads.complete(uploadId);
  }

  @Delete('uploads/:uploadId')
  @ApiOperation({ summary: 'Cancel a backup upload: what the server received goes' })
  @ApiParam({ name: 'uploadId', type: 'string' })
  cancelUpload(@Param('uploadId') uploadId: string): Promise<BackupUploadCancelResponseDto> {
    return this.uploads.cancel(uploadId);
  }

  @Get(':backupId/download')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download a backup artifact' })
  @ApiParam({ name: 'backupId', type: 'string' })
  @ApiQuery({ name: 'location', enum: ['local', 's3', 'upload'] })
  @ApiQuery({ name: 'artifact', enum: ['db', 'storage', 'bundle'] })
  async downloadBackup(
    @Param('backupId') backupId: string,
    @Query('location') location: BackupLocation = 'local',
    @Query('artifact') artifact: 'db' | 'storage' | 'bundle' = 'bundle',
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const download = await this.backups.downloadBackup(backupId, location, artifact);
    reply.header('Content-Type', download.contentType);
    reply.header('Content-Disposition', `attachment; filename="${download.filename}"`);
    return new StreamableFile(download.stream);
  }
}
