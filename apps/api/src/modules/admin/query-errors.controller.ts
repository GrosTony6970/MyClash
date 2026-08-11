import { Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { AdminQueryErrorsService } from './query-errors.service';

// No @PlatformRole decorator, and that is the deliberate choice: PlatformRoleGuard
// defaults a non-GET to super_admin, which is the tier this needs. Naming a role
// on a GET would be a silent no-op, and naming one here would only restate the
// default — the sibling admin controllers all rely on the verb default the same
// way. platform-role-coverage.test.ts pins the resulting tier.
@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/query-errors')
export class QueryErrorsAdminController {
  constructor(private readonly queryErrors: AdminQueryErrorsService) {}

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Silence a tripped query until it happens again' })
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ id: string; resolvedAt: string }> {
    return this.queryErrors.resolve(id);
  }
}
