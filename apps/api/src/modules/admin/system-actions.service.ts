import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { OpsRunnerClient, type OpsRunnerClientOptions } from './ops-runner-client';
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
  /** The runner answers before it restarts Traefik, which carries this very answer (D9). */
  scheduled?: boolean;
  exitCode?: number | null;
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

export type AdminSystemActionsServiceOptions = OpsRunnerClientOptions;

/** The compose services the platform may start or restart, as a non-empty tuple. */
const [firstService, ...otherServices] = Object.values(RESTARTABLE_COMPONENTS);
if (firstService === undefined) throw new Error('RESTARTABLE_COMPONENTS is empty');
export const RESTARTABLE_SERVICES: readonly [string, ...string[]] = [
  firstService,
  ...otherServices,
];

/** The UI key of a compose service of the list, or undefined when it is not on it. */
export function componentKeyForService(service: string): string | undefined {
  return Object.keys(RESTARTABLE_COMPONENTS).find((key) => RESTARTABLE_COMPONENTS[key] === service);
}

const DEFAULT_OPS_TIMEOUT_MS = 35_000; // ops-runner kills at 30s; give it slack
// A container action: an action on the worker waits up to 270 s for its job in flight, and the
// ops-runner bounds it at 285 s (WORKER_ACTION_TIMEOUT_MS, infra/ops-runner/container-actions.mjs;
// rulings 811, 818). Wait past that, so the runner's own answer arrives, timed out or not; and
// under 300 s, where this fetch (undici, no dispatcher of its own) gives up on an answer whose
// headers have not come. infra:review pins the order.
const WORKER_ACTION_WAIT_MS = 295_000;
// Host facts are a read, not an operation: the sidecar kills `docker info` at
// 5s, so a longer budget here would only turn a fast, clear failure into a slow
// one on a panel the operator is watching load.
const HOST_INFO_TIMEOUT_MS = 8_000;

/**
 * Container lifecycle, certificate renewal and the host reads, through the API's one road to the
 * ops runner (`OpsRunnerClient`): a refusal of the runner keeps its status and code — `409
 * ops_busy` when its lock is held (ruling 886), `409 deploy_running` during a deploy (887).
 */
@Injectable()
export class AdminSystemActionsService {
  private readonly logger = new Logger(AdminSystemActionsService.name);
  private readonly ops: OpsRunnerClient;

  constructor(
    private readonly supabase: SupabaseService,
    options: AdminSystemActionsServiceOptions = {},
  ) {
    this.ops = new OpsRunnerClient(options);
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

    const result = await this.ops.post<ComponentActionResult>(
      `/containers/${composeService}/${action}`,
      {},
      composeService === 'worker' ? WORKER_ACTION_WAIT_MS : DEFAULT_OPS_TIMEOUT_MS,
    );

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
   * `acme.json` is left untouched, so there's no LE rate-limit risk. The runner
   * answers first and restarts Traefik a moment later (`scheduled: true`).
   *
   * Note the container-lifecycle allowlist deliberately excludes `traefik`
   * (restarting it via the generic `/containers` route is blocked) — this is the
   * one sanctioned, restart-only path, so we call the purpose-built endpoint.
   */
  async renewCertificates(actorUserId: string): Promise<CertRenewalResult> {
    const result = await this.ops.post<CertRenewalResult>(
      '/operations/renew-certs',
      {},
      DEFAULT_OPS_TIMEOUT_MS,
    );

    await this.writeAuditLog(actorUserId, 'system.tls.renew', 'system_tls', 'traefik', {
      ok: result.ok,
      scheduled: result.scheduled ?? false,
      exitCode: result.exitCode,
      timedOut: result.timedOut ?? false,
    });

    return result;
  }

  /** Read-only host disk usage via the ops-runner's GET /disk route. */
  async getDiskUsage(): Promise<DiskUsageResult> {
    const body = await this.ops.get<DiskUsageResult>('/disk', DEFAULT_OPS_TIMEOUT_MS);
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
    const body = await this.ops.get<Partial<HostFactsResult>>('/host', HOST_INFO_TIMEOUT_MS);
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
