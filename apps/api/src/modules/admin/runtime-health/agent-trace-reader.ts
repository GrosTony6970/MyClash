import { boundedCall } from '../../../common/bounded-call';
import { REDIS_CHECK_TIMEOUT_MS, redisGaveUp } from './redis-connection';

/**
 * The wake-up's own state (design §4; never the email's `runtime-health:alert-state`): the worker
 * writes it each tick (`workers/ops-agent-wake.ts`), the console reads it here.
 */
export const WAKE_STATE_KEY = 'ops-agent:wake-state';

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

/** What the console's runtime-health answer says of the wake-up. */
export type AgentWakeReading =
  { read: 'ok'; state: WakeState } | { read: 'not_checked' } | { read: 'unreadable' };

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

  async readWake(): Promise<AgentWakeReading> {
    let raw: string | null;
    try {
      raw = await boundedCall(
        () => this.redis.get(WAKE_STATE_KEY),
        this.timeoutMs,
        redisGaveUp('agent wake-up state'),
      );
    } catch {
      return { read: 'unreadable' };
    }
    if (!raw) return { read: 'not_checked' };
    try {
      return { read: 'ok', state: JSON.parse(raw) as WakeState };
    } catch {
      return { read: 'unreadable' };
    }
  }
}
