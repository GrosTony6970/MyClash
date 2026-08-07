import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  ListExchangeEditRequestsDto,
  RejectExchangeEditRequestDto,
} from './dto/exchange-edit-requests.dto';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';
import { getActorId } from '../../common/auth/actor';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('platform_admin')
@Controller('admin/exchange-edit-requests')
export class ExchangeEditRequestsAdminController {
  constructor(private readonly service: ExchangeEditRequestsAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List frozen-result exchange edit requests (super admin)' })
  async list(@Query() query: ListExchangeEditRequestsDto) {
    return this.service.list(query);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a frozen-result exchange edit request (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.approve(id, getActorId(req));
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a frozen-result exchange edit request (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectExchangeEditRequestDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.reject(id, getActorId(req), dto.reason);
  }
}
