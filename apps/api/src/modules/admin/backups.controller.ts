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
import { AdminBackupsService } from './backups.service';
import type {
  BackupActionResponseDto,
  BackupDeleteResponseDto,
  BackupListResponseDto,
  BackupLocation,
  BackupScheduleDto,
  BackupStatusDto,
  BackupUploadResponseDto,
  DeleteAllBackupsResponseDto,
} from './dto/admin-backups.dto';
import {
  DeleteAllBackupsDto,
  RestoreBackupDto,
  UpdateBackupScheduleDto,
} from './dto/admin-backups.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/backups')
export class BackupsAdminController {
  constructor(private readonly backups: AdminBackupsService) {}

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
      'Wipe every local + S3 backup. Requires the literal confirmation token "DELETE ALL MYCLASH BACKUPS".',
  })
  deleteAllBackups(@Body() dto: DeleteAllBackupsDto): Promise<DeleteAllBackupsResponseDto> {
    return this.backups.deleteAllBackups(dto);
  }

  @Delete(':backupId')
  @ApiOperation({ summary: 'Delete a local or Scaleway S3 backup copy' })
  @ApiParam({ name: 'backupId', type: 'string' })
  @ApiQuery({ name: 'location', enum: ['local', 's3'] })
  deleteBackup(
    @Param('backupId') backupId: string,
    @Query('location') location: Extract<BackupLocation, 'local' | 's3'> = 'local',
  ): Promise<BackupDeleteResponseDto> {
    return this.backups.deleteBackup(backupId, location);
  }

  @Get('operations/:operationId')
  @ApiOperation({ summary: 'Get backup operation status' })
  @ApiParam({ name: 'operationId', type: 'string' })
  getOperation(@Param('operationId') operationId: string) {
    return this.backups.getOperation(operationId);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Stage an uploaded backup file for restore' })
  async uploadBackup(@Req() req: FastifyRequest): Promise<BackupUploadResponseDto> {
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          | {
              filename: string;
              toBuffer: () => Promise<Buffer>;
            }
          | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.backups.uploadBackup(data?.filename ?? '', buffer);
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
