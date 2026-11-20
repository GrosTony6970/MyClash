import { boundedCall } from '../../../common/bounded-call';
import { REDIS_CHECK_TIMEOUT_MS, redisGaveUp } from './redis-connection';

/**
 * The wake-up's own state (design §4; never the email's `runtime-health:alert-state`): the worker
 * writes it each tick (`workers/ops-agent-wake.ts`), the console reads it here.
 */
export const WAKE_STATE_KEY = 'ops-agent:wake-state';
/** The outside watcher's ping state (design §8, ruling 903): `workers/watcher-ping.ts` writes it. */
export const WATCHER_STATE_KEY = 'ops-agent:watcher-trace';

export type WakeConfig = 'configured' | 'not_configured' | 'misconfigured';

export interface WakeState {
  config: WakeConfig;
  /** When the worker last looked (ISO). An old one means the worker stopped. */
  checkedAt: string;
  /** The keys of the last set seen (a fire, or the set it shrank to since): the de-dup. */
  lastKeys: string[];
  lastFiredAt: string | null;
  /** The fire endpoint's answer to the last call; `null` when it did not answer. */
  lastStatus: number | null;
}

export interface WatcherState {
  config: 'configured' | 'not_configured';
  /** When the worker last pinged (ISO). An old one means the worker stopped. */
  checkedAt: string;
  /** The last ping the watcher answered; `null` since the worker started, if none did. */
  lastOkAt: string | null;
  /** The last ping failed. */
  failing: boolean;
}

/** What the console's runtime-health answer says of one of the agent's wires. */
export type AgentTraceReading<T> =
  { read: 'ok'; state: T } | { read: 'not_checked' } | { read: 'unreadable' };
export type AgentWakeReading = AgentTraceReading<WakeState>;
export type AgentWatcherReading = AgentTraceReading<WatcherState>;

interface RedisGet {
  get(key: string): Promise<string | null>;
}

/**
 * The console's read of the agent's wiring, from Redis, bounded like every runtime-health Redis
 * read (ruling 842): a hung Redis reads as `unreadable`, and the card still loads.
 */
export class OpsAgentTraceReader {
  constructor(
    private readonly redis: RedisGet,
    private readonly timeoutMs = REDIS_CHECK_TIMEOUT_MS,
  ) {}

  readWake(): Promise<AgentWakeReading> {
    return this.read<WakeState>(WAKE_STATE_KEY, 'agent wake-up state');
  }

  readWatcher(): Promise<AgentWatcherReading> {
    return this.read<WatcherState>(WATCHER_STATE_KEY, 'outside watcher state');
  }

  private async read<T>(key: string, what: string): Promise<AgentTraceReading<T>> {
    let raw: string | null;
    try {
      raw = await boundedCall(() => this.redis.get(key), this.timeoutMs, redisGaveUp(what));
    } catch {
      return { read: 'unreadable' };
    }
    if (!raw) return { read: 'not_checked' };
    try {
      return { read: 'ok', state: JSON.parse(raw) as T };
    } catch {
      return { read: 'unreadable' };
    }
  }
}
