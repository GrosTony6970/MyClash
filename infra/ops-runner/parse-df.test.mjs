import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDfOutput } from './disk.mjs';

test('parseDfOutput parses df -P -B1 output', () => {
  const real = [
    'Filesystem     1B-blocks        Used   Available Capacity Mounted on',
    '/dev/sda1  50000000000 32000000000 18000000000  65% /srv/myclash',
  ].join('\n');

  assert.deepEqual(parseDfOutput(real), {
    filesystem: '/dev/sda1',
    sizeBytes: 50000000000,
    usedBytes: 32000000000,
    availBytes: 18000000000,
    usePercent: 65,
    mountpoint: '/srv/myclash',
  });
});
