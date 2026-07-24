import { describe, it, expect } from 'vitest';
import { collectRedis } from './redis-collector';

const INFO = [
  '# Memory',
  'used_memory:125829120',
  'maxmemory:536870912',
  '# Clients',
  'connected_clients:7',
].join('\r\n');

describe('collectRedis', () => {
  it('parses used/max memory + clients + dbsize', async () => {
    const redis = {
      info: async () => INFO,
      dbsize: async () => 42,
    };
    const result = await collectRedis(redis);
    expect(result).toEqual({
      usedMemoryBytes: 125829120,
      maxMemoryBytes: 536870912,
      keys: 42,
      connectedClients: 7,
    });
  });

  it('treats maxmemory:0 (unlimited) as 0', async () => {
    const redis = {
      info: async () => 'used_memory:1000\r\nmaxmemory:0\r\nconnected_clients:1',
      dbsize: async () => 0,
    };
    const result = await collectRedis(redis);
    expect(result.maxMemoryBytes).toBe(0);
  });
});
