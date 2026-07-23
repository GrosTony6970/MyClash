import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { TlsStatusResponseDto } from './dto/tls-status.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminSystemActionsService, type CertRenewalResult } from './system-actions.service';
import { AdminTlsStatusService } from './tls-status.service';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/system/tls-status')
export class TlsStatusAdminController {
  constructor(
    private readonly tlsStatus: AdminTlsStatusService,
    private readonly systemActions: AdminSystemActionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Probe served TLS certificates for the deployed domains' })
  getTlsStatus(): Promise<TlsStatusResponseDto> {
    return this.tlsStatus.probeAll();
  }

  @Post('renew')
  @ApiOperation({ summary: "Force a Let's Encrypt renewal attempt (restarts Traefik)" })
  renewCertificates(@Req() req: FastifyRequest): Promise<CertRenewalResult> {
    return this.systemActions.renewCertificates(getActorId(req));
  }
}
