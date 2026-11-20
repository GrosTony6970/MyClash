import { boundedCall } from '../common/bounded-call';
import {
  WATCHER_STATE_KEY,
  type WatcherState,
} from '../modules/admin/runtime-health/agent-trace-reader';
import {
  REDIS_CHECK_TIMEOUT_MS,
  redisGaveUp,
} from '../modules/admin/runtime-health/redis-connection';

/** The ping's bound: a slow watcher must not hold the tick. */
export const PING_TIMEOUT_MS = 10_000;

export type PingOutcome = 'ok' | 'failed' | 'not_configured';

interface WatcherRedis {
  set(key: string, value: string): Promise<unknown>;
}

interface PingLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface WatcherPingDeps {
  env: Record<string, string | undefined>;
  logger: PingLogger;
  redis: WatcherRedis;
  fetchFn?: typeof fetch;
}

/**
 * The outside watcher's ping (design §8, ruling 903): each tick of the runtime-health monitor
 * says "still alive" to a dead-man's switch (healthchecks.io). When the pings stop (a dead worker,
 * Redis or host), the watcher fires the cloud task with run type `silent`. Never throws; logs a
 * failure only when the ping before it did not fail, so a watcher down for an hour logs once.
 */
export class WatcherPing {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private failing = false;
  private lastOkAt: string | null = null;

  constructor(private readonly deps: WatcherPingDeps) {
    this.url = deps.env['OPS_AGENT_WATCHER_PING_URL'] ?? '';
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  async ping(now: number): Promise<PingOutcome> {
    const at = new Date(now).toISOString();
    if (!this.url) {
      await this.write({ config: 'not_configured', checkedAt: at, lastOkAt: null, failing: false });
      return 'not_configured';
    }
    const ok = await this.send();
    if (ok) this.lastOkAt = at;
    else if (!this.failing) this.deps.logger.warn('outside watcher: the ping failed');
    if (ok && this.failing) this.deps.logger.log('outside watcher: the ping answers again');
    this.failing = !ok;
    await this.write({
      config: 'configured',
      checkedAt: at,
      lastOkAt: this.lastOkAt,
      failing: !ok,
    });
    return ok ? 'ok' : 'failed';
  }

  private async send(): Promise<boolean> {
    try {
      const response = await this.fetchFn(this.url, {
        method: 'GET',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Best effort, and bounded: the connection waits forever with Redis down. */
  private async write(state: WatcherState): Promise<void> {
    await boundedCall(
      () => this.deps.redis.set(WATCHER_STATE_KEY, JSON.stringify(state)),
      REDIS_CHECK_TIMEOUT_MS,
      redisGaveUp('outside watcher state write'),
    ).catch(() => undefined);
  }
}
