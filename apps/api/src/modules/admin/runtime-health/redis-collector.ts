import { boundedCall } from '../../../common/bounded-call';
import { REDIS_CHECK_TIMEOUT_MS, redisGaveUp } from './redis-connection';

export interface RedisClientLike {
  info(section: string): Promise<string>;
  dbsize(): Promise<number>;
}

function parseInfoInt(info: string, key: string): number {
  const match = new RegExp(`^${key}:(\\d+)`, 'm').exec(info);
  return match ? Number(match[1]) : 0;
}

export async function collectRedis(
  redis: RedisClientLike,
  { timeoutMs = REDIS_CHECK_TIMEOUT_MS } = {},
): Promise<{
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  keys: number;
  connectedClients: number;
}> {
  const [memory, clients, keys] = await boundedCall(
    () => Promise.all([redis.info('memory'), redis.info('clients'), redis.dbsize()]),
    timeoutMs,
    redisGaveUp('info'),
  );
  return {
    usedMemoryBytes: parseInfoInt(memory, 'used_memory'),
    maxMemoryBytes: parseInfoInt(memory, 'maxmemory'),
    keys,
    connectedClients: parseInfoInt(clients, 'connected_clients'),
  };
}
