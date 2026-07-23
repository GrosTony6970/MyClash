import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * UI-key → docker-compose service name for every component that can be
 * controlled from the System Versions admin page. Mirrors the allowlist in
 * `infra/ops-runner/server.mjs`. Anything not in this map is rejected
 * server-side as a 403, regardless of what the UI sent.
 *
 * Catastrophic / self-referential services are intentionally excluded:
 *   - `api`        — would kill the request mid-flight
 *   - `postgres`   — full data outage
 *   - `traefik`    — lose all HTTPS routing
 *   - `ops-runner` — lose the channel that would restart anything else
 */
const RESTARTABLE_COMPONENTS: Record<string, string> = {
  worker: 'worker',
  'web-admin': 'web-admin',
  'web-public': 'web-public',
  'web-scoring': 'web-scoring',
  'web-marketing': 'web-marketing',
  redis: 'redis',
  supabaseAuth: 'supabase-auth',
  supabaseRealtime: 'supabase-realtime',
  supabaseStorage: 'supabase-storage',
  postgrest: 'supabase-rest',
};

export type ComponentAction = 'start' | 'stop' | 'restart';

export interface ComponentActionResult {
  ok: boolean;
  component: string;
  action: ComponentAction;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  error?: string;
}

export interface CertRenewalResult {
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  error?: string;
}

type FetchLike = typeof fetch;

export interface AdminSystemActionsServiceOptions {
  opsRunnerUrl?: string;
  opsRunnerSecret?: string;
  fetchImpl?: FetchLike;
}

const DEFAULT_OPS_TIMEOUT_MS = 35_000; // ops-runner kills at 30s; give it slack

@Injectable()
export class AdminSystemActionsService {
  private readonly logger = new Logger(AdminSystemActionsService.name);
  private readonly opsRunnerUrl: string;
  private readonly opsRunnerSecret: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly supabase: SupabaseService,
    options: AdminSystemActionsServiceOptions = {},
  ) {
    this.opsRunnerUrl = stripTrailingSlash(
      options.opsRunnerUrl ?? process.env['OPS_RUNNER_URL'] ?? '',
    );
    this.opsRunnerSecret = options.opsRunnerSecret ?? process.env['OPS_RUNNER_SECRET'] ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isRestartable(componentKey: string): boolean {
    return Object.prototype.hasOwnProperty.call(RESTARTABLE_COMPONENTS, componentKey);
  }

  /** Compose service name for a given UI key, or undefined if not allowlisted. */
  composeServiceFor(componentKey: string): string | undefined {
    return RESTARTABLE_COMPONENTS[componentKey];
  }

  async runComponentAction(
    componentKey: string,
    action: ComponentAction,
    actorUserId: string,
  ): Promise<ComponentActionResult> {
    if (!isValidAction(action)) {
      throw new BadRequestException('Invalid component action.');
    }
    const composeService = RESTARTABLE_COMPONENTS[componentKey];
    if (!composeService) {
      throw new ForbiddenException('This component is not controllable from the admin UI.');
    }
    if (!this.opsRunnerUrl || !this.opsRunnerSecret) {
      throw new ServiceUnavailableException(
        'Container lifecycle controls require the ops-runner sidecar.',
      );
    }

    let result: ComponentActionResult;
    try {
      const response = await this.fetchImpl(
        `${this.opsRunnerUrl}/containers/${composeService}/${action}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.opsRunnerSecret}` },
          signal: AbortSignal.timeout(DEFAULT_OPS_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new ServiceUnavailableException(
          message || `ops-runner returned ${response.status} for ${composeService}.`,
        );
      }
      result = (await response.json()) as ComponentActionResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ops-runner request failed';
      this.logger.warn(
        `Component action failed for ${componentKey}:${action} via ops-runner — ${message}`,
      );
      throw err instanceof ServiceUnavailableException
        ? err
        : new ServiceUnavailableException(message);
    }

    await this.writeAuditLog(
      actorUserId,
      `system.component.${action}`,
      'system_component',
      composeService,
      {
        componentKey,
        composeService,
        action,
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut ?? false,
      },
    );

    return result;
  }

  /**
   * Force a Let's Encrypt renewal attempt by restarting Traefik via the
   * ops-runner's dedicated `/operations/renew-certs` route. Traefik re-runs its
   * ACME resolver on boot and renews any cert already inside its ~30-day window;
   * `acme.json` is left untouched, so there's no LE rate-limit risk.
   *
   * Note the container-lifecycle allowlist deliberately excludes `traefik`
   * (restarting it via the generic `/containers` route is blocked) — this is the
   * one sanctioned, restart-only path, so we call the purpose-built endpoint.
   */
  async renewCertificates(actorUserId: string): Promise<CertRenewalResult> {
    if (!this.opsRunnerUrl || !this.opsRunnerSecret) {
      throw new ServiceUnavailableException('Certificate renewal requires the ops-runner sidecar.');
    }

    let result: CertRenewalResult;
    try {
      const response = await this.fetchImpl(`${this.opsRunnerUrl}/operations/renew-certs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opsRunnerSecret}` },
        signal: AbortSignal.timeout(DEFAULT_OPS_TIMEOUT_MS),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new ServiceUnavailableException(
          message || `ops-runner returned ${response.status} for cert renewal.`,
        );
      }
      result = (await response.json()) as CertRenewalResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ops-runner request failed';
      this.logger.warn(`Certificate renewal failed via ops-runner — ${message}`);
      throw err instanceof ServiceUnavailableException
        ? err
        : new ServiceUnavailableException(message);
    }

    await this.writeAuditLog(actorUserId, 'system.tls.renew', 'system_tls', 'traefik', {
      ok: result.ok,
      exitCode: result.exitCode,
      timedOut: result.timedOut ?? false,
    });

    return result;
  }

  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }
}

function isValidAction(value: string): value is ComponentAction {
  return value === 'start' || value === 'stop' || value === 'restart';
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
