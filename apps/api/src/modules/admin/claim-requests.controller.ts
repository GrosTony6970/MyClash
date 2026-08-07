import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { ClaimRequestsService } from './claim-requests.service';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { getActorId } from '../../common/auth/actor';

const rejectClaimRequestSchema = z.object({ reason: z.string().min(2).max(500) }).strict();
class RejectClaimRequestDto extends createZodDto(rejectClaimRequestSchema) {}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/global-person-claim-requests')
export class ClaimRequestsAdminController {
  constructor(private readonly service: ClaimRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'List pending global-person claim requests (super admin)' })
  async list() {
    return this.service.listAllPending();
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Approve a pending claim request (super admin)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.approve(id, getActorId(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reject a pending claim request (super admin)' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectClaimRequestDto,
    @Req() req: FastifyRequest,
  ) {
    await this.service.reject(id, getActorId(req), dto.reason);
  }
}
