import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TlsCertMonitorWorker } from './tls-cert-monitor.worker';
import type { TlsCertStatusDto, TlsStatusResponseDto } from '../modules/admin/dto/tls-status.dto';
import type { AdminTlsStatusService } from '../modules/admin/tls-status.service';
import type { MailService } from '../modules/mail/mail.service';

function cert(host: string, health: TlsCertStatusDto['health']): TlsCertStatusDto {
  return { host, reachable: health !== 'error', caType: 'prod', health, daysUntilExpiry: 10 };
}

function makeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) } as never;
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, def?: unknown) => (key in overrides ? overrides[key] : def),
  } as unknown as ConfigService;
}

describe('TlsCertMonitorWorker.check', () => {
  let probeAll: ReturnType<typeof vi.fn>;
  let sendNotification: ReturnType<typeof vi.fn>;
  let tlsStatus: AdminTlsStatusService;
  let mail: MailService;

  beforeEach(() => {
    probeAll = vi.fn();
    sendNotification = vi.fn().mockResolvedValue(undefined);
    tlsStatus = { probeAll } as unknown as AdminTlsStatusService;
    mail = { sendNotification } as unknown as MailService;
  });

  function makeWorker(
    config = makeConfig({ LETSENCRYPT_EMAIL: 'ops@myclash.fr', DOMAIN: 'myclash.fr' }),
  ) {
    return new TlsCertMonitorWorker(makeQueue(), tlsStatus, config, mail);
  }

  function response(certificates: TlsCertStatusDto[]): TlsStatusResponseDto {
    return { checkedAt: new Date().toISOString(), minDays: 21, certificates };
  }

  it('sends no email and reports no unhealthy certs when all are ok', async () => {
    probeAll.mockResolvedValue(response([cert('myclash.fr', 'ok'), cert('api.myclash.fr', 'ok')]));

    const { unhealthy } = await makeWorker().check();

    expect(unhealthy).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('emails LETSENCRYPT_EMAIL when at least one cert is unhealthy', async () => {
    probeAll.mockResolvedValue(
      response([cert('app.myclash.fr', 'expiringSoon'), cert('api.myclash.fr', 'staging')]),
    );

    const { unhealthy } = await makeWorker().check();

    expect(unhealthy.map((c) => c.host)).toEqual(['app.myclash.fr', 'api.myclash.fr']);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0]![0]).toMatchObject({ to: 'ops@myclash.fr' });
  });

  it('does not send email when LETSENCRYPT_EMAIL is unset', async () => {
    probeAll.mockResolvedValue(response([cert('admin.myclash.fr', 'error')]));

    const { unhealthy } = await makeWorker(makeConfig({ DOMAIN: 'myclash.fr' })).check();

    expect(unhealthy).toHaveLength(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('does not throw when the mail send fails (best-effort alerting)', async () => {
    probeAll.mockResolvedValue(response([cert('app.myclash.fr', 'expiringSoon')]));
    sendNotification.mockRejectedValue(new Error('resend down'));

    await expect(makeWorker().check()).resolves.toMatchObject({ unhealthy: [expect.any(Object)] });
  });
});
