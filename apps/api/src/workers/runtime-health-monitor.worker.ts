/**
 * runtime-health-monitor.worker.ts
 *
 * Fixed 5-min BullMQ tick that reads the operator-configured alert settings
 * (RuntimeHealthAlertSettingsService), collects a runtime-health snapshot
 * (AdminRuntimeHealthService.collect()), and emails the operator when any
 * metric is at/above the configured alert level. When the ops agent's wake-up is configured,
 * every tick also reads health and hands it to the wake-up (`ops-agent-wake.ts`, ruling 902).
 * Each tick first pings the outside watcher (`watcher-ping.ts`, ruling 903).
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
import { utcCron } from './cron-zone';
import type { Redis } from 'ioredis';
import { AdminRuntimeHealthService } from '../modules/admin/runtime-health.service';
import { RuntimeHealthAlertSettingsService } from '../modules/admin/runtime-health-alert-settings.service';
import { RuntimeHealthSamplesService } from '../modules/admin/runtime-health-samples.service';
import { MailService } from '../modules/mail/mail.service';
import type {
  RuntimeHealthAlertSettings,
  RuntimeHealthResponseDto,
} from '../modules/admin/dto/runtime-health.dto';
import type { OpsAgentWake } from './ops-agent-wake';
import type { WatcherPing } from './watcher-ping';
import { detailOf, keysAtLeast, statusOf } from './runtime-health-keys';

export const RUNTIME_HEALTH_MONITOR_QUEUE = 'runtime-health-monitor';
export const RUNTIME_HEALTH_MONITOR_JOB = 'tick';
const STATE_KEY = 'runtime-health:alert-state';

interface AlertState {
  lastCriticalKeys: string[];
  lastEmailedAt: number;
  lastCheckedAt: number;
}

/** A tick that checks nothing: alerts off, or the worker stopping. */
const notRun = () => ({ ran: false, emailed: false, criticalKeys: [] as string[] });

@Processor(RUNTIME_HEALTH_MONITOR_QUEUE)
@Injectable()
export class RuntimeHealthMonitorWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RuntimeHealthMonitorWorker.name);

  constructor(
    @InjectQueue(RUNTIME_HEALTH_MONITOR_QUEUE) private readonly queue: Queue,
    private readonly runtimeHealth: AdminRuntimeHealthService,
    private readonly settingsService: RuntimeHealthAlertSettingsService,
    private readonly samples: RuntimeHealthSamplesService,
    private readonly mail: MailService,
    /**
     * graceful-stop's `isStopping`. A stopping worker closes its idle consumers first: the queue
     * tile would read 0 and alarm on every deploy (ruling 830). `tick` asks before its read and
     * again after it, since the read can outlast the signal.
     */
    private readonly isStopping: () => boolean,
    /** The alert wake-up (rulings 901, 902): it reads every tick, whatever the email settings. */
    private readonly wake: OpsAgentWake,
    /** The outside watcher's ping (ruling 903): every tick, before anything that can stop it. */
    private readonly watcher: WatcherPing,
    @Optional() private readonly redis?: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler('runtime-health-monitor-tick', utcCron('*/5 * * * *'), {
      name: RUNTIME_HEALTH_MONITOR_JOB,
      data: {},
    });
    this.logger.log('Runtime health monitor scheduled (every 5 min)');
  }

  async process(_job: Job): Promise<void> {
    await this.tick(Date.now());
  }

  /**
   * Public for tests. Returns whether the email check ran + whether an email was sent. The
   * wake-up does not follow the email settings (design §4, ruling 902): when it is configured,
   * every tick reads health once, and the email check reuses that read when it is due.
   */
  async tick(now: number): Promise<{ ran: boolean; emailed: boolean; criticalKeys: string[] }> {
    if (this.isStopping()) return notRun();
    // First, and whatever follows: the watcher hears "alive" as long as the ticks run (ruling 903).
    await this.watcher.ping(now);
    const settings = await this.settingsService.getSettings();
    const { state, ok: stateOk } = await this.readState();
    const due = settings.enabled && emailCheckDue(state, settings, now);
    const wakeOn = this.wake.config === 'configured';
    const snapshot = due || wakeOn ? await this.runtimeHealth.collect() : null;
    // A draining worker reads its queues as unworked (ruling 830): every deploy would alarm.
    if (this.isStopping()) return notRun();
    if (wakeOn && snapshot) await this.wake.onSnapshot(snapshot, now);
    else await this.wake.noteUnconfigured(now);
    if (!due || !snapshot) {
      return { ran: false, emailed: false, criticalKeys: state.lastCriticalKeys };
    }
    return this.emailCheck(snapshot, settings, { state, stateOk }, now);
  }

  /** The alert email, from the tick's one snapshot. */
  private async emailCheck(
    snapshot: RuntimeHealthResponseDto,
    settings: RuntimeHealthAlertSettings,
    { state, stateOk }: { state: AlertState; stateOk: boolean },
    now: number,
  ): Promise<{ ran: boolean; emailed: boolean; criticalKeys: string[] }> {
    // Retain the tick before anything that can short-circuit, so the trend keeps
    // its densest data exactly when things are going wrong.
    await this.recordSample(snapshot, now);

    const criticalKeys = keysAtLeast(snapshot, 'critical');
    const warningKeys = keysAtLeast(snapshot, 'warning');

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

  /**
   * Guarded here rather than trusting the service to stay non-throwing: history is worth strictly
   * less than the alert email this tick exists to send, and that must hold however the
   * persistence layer fails later.
   */
  private async recordSample(snapshot: RuntimeHealthResponseDto, now: number): Promise<void> {
    try {
      await this.samples.record(snapshot);
      await this.samples.prune(new Date(now));
    } catch (err) {
      this.logger.warn(
        `Runtime health sample not retained: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sendEmail(
    keys: string[],
    snapshot: RuntimeHealthResponseDto,
    recipients: string[],
  ): Promise<boolean> {
    if (recipients.length === 0) return false;
    const domain = process.env['DOMAIN'] ?? 'myclash.fr';
    const details = keys.map((k) => `${k}: ${detailOf(snapshot, k)}`).join(' | ');
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

/**
 * Throttle full checks to checkIntervalMinutes ONLY while quiet (no active alert). Once something
 * is flagged, re-check on every fixed 5-min tick regardless of the operator's interval, so
 * recovery (re-arm) is caught quickly instead of waiting out the full interval while still
 * critical.
 */
function emailCheckDue(
  state: AlertState,
  settings: RuntimeHealthAlertSettings,
  now: number,
): boolean {
  const isQuiet = state.lastCriticalKeys.length === 0;
  return !isQuiet || now - state.lastCheckedAt >= settings.checkIntervalMinutes * 60_000;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}
