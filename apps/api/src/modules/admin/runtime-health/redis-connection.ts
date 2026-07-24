import { Redis } from 'ioredis';
import type { ConfigService } from '@nestjs/config';

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
