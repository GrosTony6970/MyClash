/**
 * tls-cert-monitor.worker.ts
 *
 * Daily cron that probes the served TLS certificate for every deployed
 * `${DOMAIN}` subdomain (via AdminTlsStatusService) and raises an alert when any
 * certificate is:
 *   - unreachable / handshake-failing  (health = 'error')
 *   - issued by the LE *staging* CA     (health = 'staging', browser-untrusted)
 *   - within TLS_CERT_MIN_DAYS of expiry (health = 'expiringSoon')
 *
 * Alerting is three-pronged per the feature decision: a structured `logger.warn`
 * (log-based alerting), the red status on the admin card (separate on-demand
 * endpoint), and an email to LETSENCRYPT_EMAIL via the shared MailService. When
 * every cert is `ok` the run is silent.
 *
 * Certs auto-renew in Traefik, so this is a safety net — it does not renew
 * anything itself.
 *
 * Queue name: "tls-cert-monitor"
 * Job name:   "check"
 * Cron:       daily at 06:17 UTC (off-peak, staggered from the other jobs)
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { AdminTlsStatusService } from '../modules/admin/tls-status.service';
import type { TlsCertStatusDto } from '../modules/admin/dto/tls-status.dto';
import { MailService } from '../modules/mail/mail.service';

export const TLS_CERT_MONITOR_QUEUE = 'tls-cert-monitor';
export const TLS_CERT_MONITOR_JOB = 'check';

@Processor(TLS_CERT_MONITOR_QUEUE)
@Injectable()
export class TlsCertMonitorWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TlsCertMonitorWorker.name);

  constructor(
    @InjectQueue(TLS_CERT_MONITOR_QUEUE) private readonly queue: Queue,
    private readonly tlsStatus: AdminTlsStatusService,
    private readonly config: ConfigService,
    @Optional() private readonly mail?: MailService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // BullMQ repeatable jobs are idempotent by jobId — safe to call on every boot.
    await this.queue.add(
      TLS_CERT_MONITOR_JOB,
      {},
      {
        repeat: { pattern: '17 6 * * *' },
        jobId: 'tls-cert-monitor-daily',
      },
    );
    this.logger.log('TLS certificate monitor scheduled (daily, 06:17 UTC)');
  }

  async process(_job: Job): Promise<void> {
    await this.check();
  }

  /**
   * Public so tests + dev REPLs can drive it without the BullMQ queue.
   * Returns the unhealthy certs for test assertions; the production path
   * discards the result.
   */
  async check(): Promise<{ unhealthy: TlsCertStatusDto[] }> {
    const status = await this.tlsStatus.probeAll();
    const unhealthy = status.certificates.filter((cert) => cert.health !== 'ok');
    if (unhealthy.length === 0) return { unhealthy };

    for (const cert of unhealthy) {
      this.logger.warn(
        `TLS cert ${cert.host}: health=${cert.health} caType=${cert.caType} ` +
          `daysUntilExpiry=${cert.daysUntilExpiry ?? 'n/a'}${cert.error ? ` error=${cert.error}` : ''}`,
      );
    }

    await this.sendAlertEmail(unhealthy, status.minDays);
    return { unhealthy };
  }

  private async sendAlertEmail(unhealthy: TlsCertStatusDto[], minDays: number): Promise<void> {
    const to = this.config.get<string>('LETSENCRYPT_EMAIL');
    if (!to || !this.mail) return;

    const domain = this.config.get<string>('DOMAIN', 'myclash.fr');
    const details = unhealthy
      .map((cert) => {
        const days = cert.daysUntilExpiry != null ? ` (${cert.daysUntilExpiry}d)` : '';
        const reason = cert.error ? ` - ${cert.error}` : '';
        return `${cert.host}: ${cert.health}${days}${reason}`;
      })
      .join(' | ');

    try {
      await this.mail.sendNotification({
        to,
        subject: `[MyClash] TLS certificate warning (${unhealthy.length})`,
        title: `TLS certificate issues on ${domain}`,
        body:
          `${unhealthy.length} certificate(s) need attention (threshold ${minDays} days): ` +
          `${details}. Review https://admin.${domain}/admin/system-versions.`,
        actionUrl: `https://admin.${domain}/admin/system-versions`,
      });
    } catch (err) {
      this.logger.warn(
        `Could not send TLS alert email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
