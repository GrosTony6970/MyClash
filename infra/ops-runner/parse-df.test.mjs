import { describe, it, expect } from 'vitest';
import { parseDfOutput } from './server.mjs';

describe('parseDfOutput', () => {
  it('parses df -P -B1 output', () => {
    const real = [
      'Filesystem     1B-blocks        Used   Available Capacity Mounted on',
      '/dev/sda1  50000000000 32000000000 18000000000  65% /srv/myclash',
    ].join('\n');
    const result = parseDfOutput(real);
    expect(result).toEqual({
      filesystem: '/dev/sda1',
      sizeBytes: 50000000000,
      usedBytes: 32000000000,
      availBytes: 18000000000,
      usePercent: 65,
      mountpoint: '/srv/myclash',
    });
  });
});
