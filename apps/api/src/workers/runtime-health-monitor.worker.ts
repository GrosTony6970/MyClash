/**
 * runtime-health-monitor.worker.ts
 *
 * Fixed 5-min BullMQ tick that reads the operator-configured alert settings
 * (RuntimeHealthAlertSettingsService), collects a runtime-health snapshot
 * (AdminRuntimeHealthService.collect()), and emails the operator when any
 * metric is at/above the configured alert level.
 *
 * De-dup / cooldown / re-arm state lives in Redis under `runtime-health:alert-state`
 * as JSON `{ lastCriticalKeys, lastEmailedAt, lastCheckedAt }` — a fresh critical
 * set (or cooldown expiry) re-emails; going fully healthy clears the state so the
 * next new critical set emails immediately (re-arm).
 *
 * Queue name: "runtime-health-monitor"
 * Job name:   "tick"
 * Cadence:    every 5 minutes (independent of the operator's checkIntervalMinutes,
 *             which throttles how often a *check* actually runs within each tick).
 */

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AdminRuntimeHealthService } from '../modules/admin/runtime-health.service';
import { RuntimeHealthAlertSettingsService } from '../modules/admin/runtime-health-alert-settings.service';
import { MailService } from '../modules/mail/mail.service';
import type {
  MetricStatus,
  RuntimeHealthResponseDto,
} from '../modules/admin/dto/runtime-health.dto';

export const RUNTIME_HEALTH_MONITOR_QUEUE = 'runtime-health-monitor';
export const RUNTIME_HEALTH_MONITOR_JOB = 'tick';
const STATE_KEY = 'runtime-health:alert-state';

interface AlertState {
  lastCriticalKeys: string[];
  lastEmailedAt: number;
  lastCheckedAt: number;
}

const METRIC_KEYS = ['database', 'redis', 'queues', 'disk'] as const;

@Processor(RUNTIME_HEALTH_MONITOR_QUEUE)
@Injectable()
export class RuntimeHealthMonitorWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RuntimeHealthMonitorWorker.name);

  constructor(
    @InjectQueue(RUNTIME_HEALTH_MONITOR_QUEUE) private readonly queue: Queue,
    private readonly runtimeHealth: AdminRuntimeHealthService,
    private readonly settingsService: RuntimeHealthAlertSettingsService,
    private readonly mail: MailService,
    @Optional() private readonly redis?: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'runtime-health-monitor-tick',
      { pattern: '*/5 * * * *' },
      { name: RUNTIME_HEALTH_MONITOR_JOB, data: {} },
    );
    this.logger.log('Runtime health monitor scheduled (every 5 min)');
  }

  async process(_job: Job): Promise<void> {
    await this.tick(Date.now());
  }

  /** Public for tests. Returns whether a full check ran + whether an email was sent. */
  async tick(now: number): Promise<{ ran: boolean; emailed: boolean; criticalKeys: string[] }> {
    const settings = await this.settingsService.getSettings();
    if (!settings.enabled) return { ran: false, emailed: false, criticalKeys: [] };

    const { state, ok: stateOk } = await this.readState();
    // Throttle full checks to checkIntervalMinutes ONLY while quiet (no active
    // alert). Once something is flagged, re-check on every fixed 5-min tick
    // regardless of the operator's interval, so recovery (re-arm) is caught
    // quickly instead of waiting out the full interval while still critical.
    const isQuiet = state.lastCriticalKeys.length === 0;
    if (isQuiet && now - state.lastCheckedAt < settings.checkIntervalMinutes * 60_000) {
      return { ran: false, emailed: false, criticalKeys: state.lastCriticalKeys };
    }

    const snapshot = await this.runtimeHealth.collect();
    const criticalKeys = this.keysAtLeast(snapshot, 'critical');
    const warningKeys = this.keysAtLeast(snapshot, 'warning');

    for (const key of warningKeys) {
      this.logger.warn(`Runtime health ${key} = ${statusOf(snapshot, key)}`);
    }

    const alertKeys = settings.emailLevel === 'warning' ? warningKeys : criticalKeys;
    let emailed = false;
    if (!stateOk) {
      // Fail-closed: a de-dup-store read failure must never cause an email —
      // we can't tell whether this alert set was already emailed, and a flaky
      // Redis would otherwise re-email on every single tick.
      if (alertKeys.length > 0) {
        this.logger.warn('De-dup state unavailable; suppressing alert emails this tick');
      }
    } else if (alertKeys.length > 0) {
      const isNewSet = !sameSet(alertKeys, state.lastCriticalKeys);
      const cooldownElapsed = now - state.lastEmailedAt >= settings.cooldownMinutes * 60_000;
      if (isNewSet || cooldownElapsed) {
        emailed = await this.sendEmail(alertKeys, snapshot, settings.recipientEmails);
      }
    }

    if (stateOk) {
      // Don't persist state built on a failed read — it would be misleading
      // (we only have the empty fallback, not the real last-known set). This is
      // best-effort anyway: writeState() below already no-ops if the store is
      // down, so skipping it here just avoids writing a false "no prior alert".
      await this.writeState({
        lastCriticalKeys: alertKeys,
        lastEmailedAt: emailed ? now : alertKeys.length === 0 ? 0 : state.lastEmailedAt,
        lastCheckedAt: now,
      });
    }

    return { ran: true, emailed, criticalKeys };
  }

  private keysAtLeast(snapshot: RuntimeHealthResponseDto, level: 'warning' | 'critical'): string[] {
    // 'unavailable' (collector threw / subsystem unreachable) is bucketed at the
    // CRITICAL tier: a dead subsystem is at least as bad as a critical reading, so
    // it must page at the default emailLevel='critical' rather than being gated
    // behind emailLevel='warning'.
    const bad: MetricStatus[] =
      level === 'critical' ? ['critical', 'unavailable'] : ['warning', 'critical', 'unavailable'];
    return METRIC_KEYS.filter((k) => bad.includes(statusOf(snapshot, k)));
  }

  private async sendEmail(
    keys: string[],
    snapshot: RuntimeHealthResponseDto,
    recipients: string[],
  ): Promise<boolean> {
    if (recipients.length === 0) return false;
    const domain = process.env['DOMAIN'] ?? 'myclash.fr';
    const details = keys.map((k) => `${k}: ${statusOf(snapshot, k)}`).join(' | ');
    try {
      for (const to of recipients) {
        await this.mail.sendNotification({
          to,
          subject: `[MyClash] Runtime health alert (${keys.length})`,
          title: `Runtime health degraded on ${domain}`,
          body: `${keys.length} metric(s) need attention: ${details}. Review https://admin.${domain}/admin/system-versions.`,
          actionUrl: `https://admin.${domain}/admin/system-versions`,
        });
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not send runtime-health alert email: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * `ok: false` iff the Redis `get` itself threw (store unreachable/errored) —
   * distinct from "no state yet" (empty store, healthy read) or "state
   * unparseable" (both treated as `ok: true` with the empty fallback). Callers
   * MUST treat `ok: false` as fail-closed: never email on that path, since we
   * cannot tell whether the current alert set was already emailed.
   */
  private async readState(): Promise<{ state: AlertState; ok: boolean }> {
    const empty: AlertState = { lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: 0 };
    if (!this.redis) return { state: empty, ok: true };
    let raw: string | null;
    try {
      raw = await this.redis.get(STATE_KEY);
    } catch {
      return { state: empty, ok: false };
    }
    if (!raw) return { state: empty, ok: true };
    try {
      return { state: { ...empty, ...(JSON.parse(raw) as AlertState) }, ok: true };
    } catch {
      return { state: empty, ok: true };
    }
  }

  private async writeState(state: AlertState): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(STATE_KEY, JSON.stringify(state)).catch(() => undefined);
  }
}

function statusOf(snapshot: RuntimeHealthResponseDto, key: string): MetricStatus {
  // `!` is safe: key always comes from METRIC_KEYS, which are guaranteed
  // properties of RuntimeHealthResponseDto (noUncheckedIndexedAccess just
  // can't see that through the Record<string, ...> cast).
  return (snapshot as unknown as Record<string, { status: MetricStatus }>)[key]!.status;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}
