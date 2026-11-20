import { boundedCall } from '../common/bounded-call';
import type { ProcessRole } from '../common/process-role';
import type { RuntimeHealthResponseDto } from '../modules/admin/dto/runtime-health.dto';
import {
  WAKE_STATE_KEY,
  type WakeConfig,
  type WakeState,
} from '../modules/admin/runtime-health/agent-trace-reader';
import { describeContainerProblem } from '../modules/admin/runtime-health/containers-collector';
import {
  REDIS_CHECK_TIMEOUT_MS,
  redisGaveUp,
} from '../modules/admin/runtime-health/redis-connection';
import { keysAtLeast, statusOf } from './runtime-health-keys';

/** The fire call's bound. A timeout is a failed call: the set is kept, so no retry storm. */
export const FIRE_TIMEOUT_MS = 15_000;

export type WakeOutcome = 'fired' | 'failed' | 'same-set' | 'cleared' | 'skipped';

interface WakeRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

interface WakeLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface OpsAgentWakeDeps {
  env: Record<string, string | undefined>;
  logger: WakeLogger;
  redis: WakeRedis;
  processRole: ProcessRole;
  fetchFn?: typeof fetch;
}

/**
 * The alert wake-up (design §4, rulings 901, 902): on a NEW critical set, one POST to the cloud
 * task's fire endpoint, which starts a run of type `alert`. Never a retry: the endpoint has no
 * idempotency key, so a retry is a second run. Fail-closed: a wake state it cannot read means no
 * call (the outside watcher covers a dead Redis).
 */
export class OpsAgentWake {
  readonly config: WakeConfig;
  private readonly url: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly deps: OpsAgentWakeDeps) {
    this.url = deps.env['OPS_AGENT_WAKE_URL'] ?? '';
    this.token = deps.env['OPS_AGENT_WAKE_TOKEN'] ?? '';
    this.fetchFn = deps.fetchFn ?? fetch;
    this.config = configOf(this.url, this.token);
    // WorkersModule is in the API's graph too (app.module.ts): only the worker runs the tick.
    if (deps.processRole !== 'worker') return;
    if (this.config === 'not_configured') deps.logger.log('agent wake-up: not configured');
    if (this.config === 'misconfigured') {
      deps.logger.warn(
        'agent wake-up: misconfigured (one of its two keys is missing); it never fires',
      );
    }
  }

  /** Not configured: only the trace, so the console card can say so. */
  async noteUnconfigured(now: number): Promise<void> {
    await this.tryWrite({
      config: this.config,
      checkedAt: new Date(now).toISOString(),
      lastKeys: [],
      lastFiredAt: null,
      lastStatus: null,
    });
  }

  async onSnapshot(snapshot: RuntimeHealthResponseDto, now: number): Promise<WakeOutcome> {
    let previous: WakeState;
    try {
      previous = await this.read();
    } catch (error) {
      this.deps.logger.warn(
        `agent wake-up: state unreadable, no call this tick (${nameOf(error)})`,
      );
      return 'skipped';
    }
    const keys = wakeKeys(snapshot);
    const base = { ...previous, config: this.config, checkedAt: new Date(now).toISOString() };
    if (keys.length === 0) {
      await this.tryWrite({ ...base, lastKeys: [] });
      return 'cleared';
    }
    const seen = new Set(previous.lastKeys);
    if (keys.every((key) => seen.has(key))) {
      await this.tryWrite({ ...base, lastKeys: keys });
      return 'same-set';
    }
    // Saved BEFORE the call: a set the next tick cannot see would fire again on every tick (a
    // Redis at its memory cap answers GET and refuses SET). No save, no call.
    const firing = { ...base, lastKeys: keys, lastFiredAt: base.checkedAt, lastStatus: null };
    try {
      await this.write(firing);
    } catch (error) {
      this.deps.logger.warn(`agent wake-up: state not saved, no call this tick (${nameOf(error)})`);
      return 'skipped';
    }
    const status = await this.fire(wakeText(snapshot, keys));
    await this.tryWrite({ ...firing, lastStatus: status });
    return status !== null && status >= 200 && status < 300 ? 'fired' : 'failed';
  }

  private async fire(text: string): Promise<number | null> {
    try {
      const response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
      });
      if (!response.ok)
        this.deps.logger.warn(`agent wake-up: the call answered ${response.status}`);
      return response.status;
    } catch (error) {
      this.deps.logger.warn(`agent wake-up: the call failed (${nameOf(error)})`);
      return null;
    }
  }

  private async read(): Promise<WakeState> {
    const raw = await boundedCall(
      () => this.deps.redis.get(WAKE_STATE_KEY),
      REDIS_CHECK_TIMEOUT_MS,
      redisGaveUp('agent wake-up state'),
    );
    const empty: WakeState = {
      config: this.config,
      checkedAt: '',
      lastKeys: [],
      lastFiredAt: null,
      lastStatus: null,
    };
    if (!raw) return empty;
    try {
      return { ...empty, ...(JSON.parse(raw) as Partial<WakeState>) };
    } catch {
      return empty;
    }
  }

  /** Bounded: the connection waits forever with Redis down (`redis-connection.ts`). Throws. */
  private async write(state: WakeState): Promise<void> {
    await boundedCall(
      () => this.deps.redis.set(WAKE_STATE_KEY, JSON.stringify(state)),
      REDIS_CHECK_TIMEOUT_MS,
      redisGaveUp('agent wake-up state write'),
    );
  }

  private async tryWrite(state: WakeState): Promise<void> {
    await this.write(state).catch(() => undefined);
  }
}

function configOf(url: string, token: string): WakeConfig {
  if (url && token) return 'configured';
  return url || token ? 'misconfigured' : 'not_configured';
}

/** The critical-tier keys, the containers one split per service at fault (`containers:web-public`). */
export function wakeKeys(snapshot: RuntimeHealthResponseDto): string[] {
  return keysAtLeast(snapshot, 'critical').flatMap((key) => {
    const { containers } = snapshot;
    if (key !== 'containers' || !('problems' in containers)) return [key];
    return containers.problems.map((problem) => `containers:${problem.service}`);
  });
}

/** `alert disk=critical 93% containers=critical(web-public exited 1)`: data, no person data. */
export function wakeText(snapshot: RuntimeHealthResponseDto, keys: string[]): string {
  const metrics = [...new Set(keys.map((key) => key.split(':')[0]!))];
  return ['alert', ...metrics.map((key) => `${key}=${figureOf(snapshot, key)}`)].join(' ');
}

function figureOf(snapshot: RuntimeHealthResponseDto, key: string): string {
  const status = statusOf(snapshot, key);
  const { containers, disk } = snapshot;
  if (key === 'containers' && 'problems' in containers) {
    return `${status}(${containers.problems.map(describeContainerProblem).join(', ')})`;
  }
  if (key === 'disk' && 'usePercent' in disk) return `${status} ${disk.usePercent}%`;
  return status;
}

/** An error's name and code, never its message: a fetch error can quote a header value. */
function nameOf(error: unknown): string {
  if (!(error instanceof Error)) return 'error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}
