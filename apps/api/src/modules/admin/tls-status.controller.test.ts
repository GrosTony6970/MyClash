import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { SuperAdminGuard } from './guards/super-admin.guard';
import type { AdminSystemActionsService } from './system-actions.service';
import type { AdminTlsStatusService } from './tls-status.service';
import { TlsStatusAdminController } from './tls-status.controller';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, TlsStatusAdminController) ?? [];
}

describe('TlsStatusAdminController', () => {
  it('protects the TLS status routes with SuperAdminGuard', () => {
    expect(controllerGuards()).toContain(SuperAdminGuard);
  });

  it('delegates GET to the probe service', async () => {
    const probeAll = vi.fn().mockResolvedValue({ checkedAt: 'now', minDays: 21, certificates: [] });
    const controller = new TlsStatusAdminController(
      { probeAll } as unknown as AdminTlsStatusService,
      {} as AdminSystemActionsService,
    );

    await controller.getTlsStatus();

    expect(probeAll).toHaveBeenCalledTimes(1);
  });

  it('delegates POST /renew to the actions service with the actor id', async () => {
    const renewCertificates = vi.fn().mockResolvedValue({ ok: true });
    const controller = new TlsStatusAdminController(
      {} as AdminTlsStatusService,
      { renewCertificates } as unknown as AdminSystemActionsService,
    );
    const req = { actorUserId: 'tony-user-id' } as unknown as FastifyRequest;

    await controller.renewCertificates(req);

    expect(renewCertificates).toHaveBeenCalledWith('tony-user-id');
  });
});
