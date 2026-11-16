import { Redis } from 'ioredis';
import type { ConfigService } from '@nestjs/config';

/**
 * How long a runtime-health read waits for Redis (ruling 842). This connection keeps
 * `maxRetriesPerRequest: null` and its offline queue, so with Redis down a command waits forever
 * and the health card never loaded. Each Redis-backed read now runs under `boundedCall`
 * (`common/bounded-call.ts`): at the bound its tile is "unavailable" with the code `timeout`. An
 * abandoned command stays queued and is sent when Redis comes back.
 */
export const REDIS_CHECK_TIMEOUT_MS = 5_000;

/** What a Redis read that gave up at its bound says. */
export const redisGaveUp =
  (what: string) =>
  (ms: number): string =>
    `Redis did not answer within ${ms} ms (${what})`;

/**
 * One lazy ioredis connection for the runtime-health Redis + queue collectors.
 * Mirrors the connection resolution in workers.module.ts (REDIS_URL first,
 * then host/port/password). lazyConnect so nothing dials Redis until a metric
 * read actually happens.
 */
export function createRuntimeHealthRedis(config: ConfigService): Redis {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
  }
  return new Redis({
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    password: config.get<string>('REDIS_PASSWORD') ?? undefined,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}
