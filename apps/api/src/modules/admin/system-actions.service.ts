import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { RESTARTABLE_COMPONENTS } from './restartable-components';

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

export interface DiskUsageResult {
  mountpoint: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}

/** Host identity and capacity as the ops-runner's `GET /host` reports it. */
export interface HostFactsResult {
  hostname: string | null;
  os: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  architecture: string | null;
  cpuCount: number | null;
  memoryTotalBytes: number | null;
  dockerVersion: string | null;
}

type FetchLike = typeof fetch;

export interface AdminSystemActionsServiceOptions {
  opsRunnerUrl?: string;
  opsRunnerSecret?: string;
  fetchImpl?: FetchLike;
}

const DEFAULT_OPS_TIMEOUT_MS = 35_000; // ops-runner kills at 30s; give it slack
// A container action: an action on the worker waits up to 270 s for its job in flight, and the
// ops-runner bounds it at 285 s (WORKER_ACTION_TIMEOUT_MS, infra/ops-runner/server.mjs; rulings
// 811, 818). Wait past that, so the runner's own answer arrives, timed out or not; and under 300 s,
// where this fetch (undici, no dispatcher of its own) gives up on an answer whose headers have not
// come. infra:review pins the order.
const WORKER_ACTION_WAIT_MS = 295_000;
// Host facts are a read, not an operation: the sidecar kills `docker info` at
// 5s, so a longer budget here would only turn a fast, clear failure into a slow
// one on a panel the operator is watching load.
const HOST_INFO_TIMEOUT_MS = 8_000;

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
          signal: AbortSignal.timeout(WORKER_ACTION_WAIT_MS),
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

  /** Read-only host disk usage via the ops-runner's GET /disk route. */
  async getDiskUsage(): Promise<DiskUsageResult> {
    if (!this.opsRunnerUrl || !this.opsRunnerSecret) {
      throw new ServiceUnavailableException('Disk usage requires the ops-runner sidecar.');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.opsRunnerUrl}/disk`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.opsRunnerSecret}` },
        signal: AbortSignal.timeout(DEFAULT_OPS_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ops-runner request failed';
      throw new ServiceUnavailableException(message);
    }
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        message || `ops-runner returned ${response.status} for disk usage.`,
      );
    }
    const body = (await response.json()) as DiskUsageResult;
    return {
      mountpoint: body.mountpoint,
      sizeBytes: body.sizeBytes,
      usedBytes: body.usedBytes,
      availBytes: body.availBytes,
      usePercent: body.usePercent,
    };
  }

  /**
   * Read-only host identity and capacity via the ops-runner's GET /host route.
   *
   * Throws like `getDiskUsage()` rather than degrading here: this class is the
   * ops-runner client and its job is to report what the sidecar said. Deciding
   * that a missing hostname is tolerable is the caller's call, and
   * `AdminHostInfoService` makes it.
   */
  async getHostFacts(): Promise<HostFactsResult> {
    if (!this.opsRunnerUrl || !this.opsRunnerSecret) {
      throw new ServiceUnavailableException('Host details require the ops-runner sidecar.');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.opsRunnerUrl}/host`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.opsRunnerSecret}` },
        signal: AbortSignal.timeout(HOST_INFO_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ops-runner request failed';
      throw new ServiceUnavailableException(message);
    }
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        message || `ops-runner returned ${response.status} for host details.`,
      );
    }
    const body = (await response.json()) as Partial<HostFactsResult>;
    return {
      hostname: body.hostname ?? null,
      os: body.os ?? null,
      osVersion: body.osVersion ?? null,
      kernelVersion: body.kernelVersion ?? null,
      architecture: body.architecture ?? null,
      cpuCount: body.cpuCount ?? null,
      memoryTotalBytes: body.memoryTotalBytes ?? null,
      dockerVersion: body.dockerVersion ?? null,
    };
  }

  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType,
      entityId,
      payload,
    });
    if (error) {
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
