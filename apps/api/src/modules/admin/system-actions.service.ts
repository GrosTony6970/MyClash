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

/** The ops runner's disk prune (ruling 884): the build cache and the dangling images. */
export interface DiskPruneResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  /** The free bytes the prune gave back, measured on the stack's filesystem; never negative. */
  freedBytes: number;
  availBytes: number;
  stderr: string;
}

export interface DiskUsageResult {
  mountpoint: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}

/** One container of the stack, as the ops runner's `GET /containers` reports it. */
export interface ContainerRow {
  name: string;
  service: string;
  state: string;
  health: string | null;
  status: string;
  exitCode: number | null;
}

export interface ContainersResult {
  generatedAt: string;
  containers: ContainerRow[];
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

/**
 * The UI key of a compose service of the list. Its callers hold the service to the list (the
 * door's DTO), so a service off it is a bug: it throws, rather than answer a value a caller could
 * fall back from in silence.
 */
export function componentKeyForService(service: string): string {
  const key = Object.keys(RESTARTABLE_COMPONENTS).find(
    (candidate) => RESTARTABLE_COMPONENTS[candidate] === service,
  );
  if (key === undefined) throw new Error(`${service} is not a restartable service`);
  return key;
}

const DEFAULT_OPS_TIMEOUT_MS = 35_000; // ops-runner kills at 30s; give it slack
// A container action: an action on the worker waits up to 270 s for its job in flight, and the
// ops-runner bounds it at 285 s (WORKER_ACTION_TIMEOUT_MS, infra/ops-runner/container-actions.mjs;
// rulings 811, 818). Wait past that, so the runner's own answer arrives, timed out or not; and
// under 300 s, where this fetch (undici, no dispatcher of its own) gives up on an answer whose
// headers have not come. infra:review pins the order.
const WORKER_ACTION_WAIT_MS = 295_000;
// The disk prune: the runner bounds each of its two steps (PRUNE_STEP_TIMEOUT_MS,
// infra/ops-runner/container-actions.mjs). Wait past both, and under undici's 300 s.
// infra:review pins the order.
const PRUNE_WAIT_MS = 295_000;
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

  /** Whether the ops runner is configured: without it, every call here throws a 503. */
  opsAvailable(): boolean {
    return this.ops.available();
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

  /**
   * Free disk space: the runner empties Docker's build cache and removes the dangling images. No
   * container stops; the next deploy rebuilds from the start. The console's Host card and the ops
   * agent's door both come here, and the audit row says who freed how much.
   */
  async pruneDisk(actorUserId: string): Promise<DiskPruneResult> {
    const result = await this.ops.post<DiskPruneResult>('/disk/prune', {}, PRUNE_WAIT_MS);

    await this.writeAuditLog(actorUserId, 'system.disk.prune', 'system_disk', 'docker', {
      ok: result.ok,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      freedBytes: result.freedBytes,
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
   * The state of every container of the stack, stopped ones included, via the ops runner's
   * `GET /containers` (`infra/ops-runner/container-logs.mjs`). The ops agent's door and the
   * containers metric of runtime health both read it here (ruling 900). The runner's JSON arrives
   * untyped, so each row is built field by field: nothing the runner adds passes.
   */
  async getContainers(): Promise<ContainersResult> {
    const answer = await this.ops.get<Record<string, unknown>>('/containers');
    const rows = Array.isArray(answer['containers'])
      ? (answer['containers'] as Record<string, unknown>[])
      : [];
    return { generatedAt: String(answer['generatedAt'] ?? ''), containers: rows.map(containerRow) };
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

function containerRow(row: Record<string, unknown>): ContainerRow {
  return {
    name: String(row['name'] ?? ''),
    service: String(row['service'] ?? ''),
    state: String(row['state'] ?? ''),
    health: typeof row['health'] === 'string' ? row['health'] : null,
    status: String(row['status'] ?? ''),
    exitCode: typeof row['exitCode'] === 'number' ? row['exitCode'] : null,
  };
}

function isValidAction(value: string): value is ComponentAction {
  return value === 'start' || value === 'stop' || value === 'restart';
}
