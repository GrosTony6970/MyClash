import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuditLogService } from './admin-audit-log.service';
import { ListAuditLogQueryDto } from './dto/admin-audit-log.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/audit-log')
export class AuditLogAdminController {
  constructor(private readonly service: AdminAuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries (super admin)' })
  async list(@Query() query: ListAuditLogQueryDto) {
    return this.service.list(query);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  @ApiOperation({ summary: 'Export audit log entries as CSV (super admin)' })
  async exportCsv(@Query() query: ListAuditLogQueryDto) {
    return this.service.exportCsv(query);
  }
}
