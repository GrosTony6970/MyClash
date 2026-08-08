import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDockerInfo } from './host-info.mjs';

// Trimmed from a real `docker info --format '{{json .}}'`, keeping the fields the
// projection reads plus the ones it must drop.
const REAL_SAMPLE = JSON.stringify({
  ID: 'a1b2c3',
  Containers: 21,
  Name: 'myclash-vps-01',
  OperatingSystem: 'Debian GNU/Linux 12 (bookworm)',
  OSVersion: '12',
  OSType: 'linux',
  KernelVersion: '6.1.0-18-amd64',
  Architecture: 'x86_64',
  NCPU: 4,
  MemTotal: 8348332032,
  ServerVersion: '27.3.1',
  Driver: 'overlay2',
  HttpProxy: 'http://proxy-user:hunter2@proxy.internal:3128',
  HttpsProxy: 'https://proxy-user:hunter2@proxy.internal:3128',
  NoProxy: 'localhost',
  RegistryConfig: { IndexConfigs: { 'docker.io': { Name: 'docker.io', Secure: true } } },
  Swarm: { NodeID: 'node-1', LocalNodeState: 'inactive' },
  SecurityOptions: ['name=seccomp,profile=builtin'],
});

test('parseDockerInfo projects the host facts the board shows', () => {
  assert.deepEqual(parseDockerInfo(REAL_SAMPLE), {
    hostname: 'myclash-vps-01',
    os: 'Debian GNU/Linux 12 (bookworm)',
    osVersion: '12',
    kernelVersion: '6.1.0-18-amd64',
    architecture: 'x86_64',
    cpuCount: 4,
    memoryTotalBytes: 8348332032,
    dockerVersion: '27.3.1',
  });
});

test('parseDockerInfo forwards nothing outside its allowlist', () => {
  // The response reaches a browser. `docker info` carries proxy URLs that can
  // embed credentials, plus registry and swarm topology — none of it belongs on
  // an inventory panel, and a passthrough would ship each new daemon field by
  // default. deepEqual above already pins the shape; this pins the reason.
  const projected = JSON.stringify(parseDockerInfo(REAL_SAMPLE));
  for (const secret of ['hunter2', 'proxy.internal', 'RegistryConfig', 'Swarm', 'seccomp']) {
    assert.equal(projected.includes(secret), false, `leaked ${secret}`);
  }
});

test('parseDockerInfo returns nulls for malformed or empty daemon output', () => {
  const allNull = {
    hostname: null,
    os: null,
    osVersion: null,
    kernelVersion: null,
    architecture: null,
    cpuCount: null,
    memoryTotalBytes: null,
    dockerVersion: null,
  };
  // Never throws: the caller has already decided the daemon answered, and the
  // API composes this with a separate disk read that may well have succeeded.
  for (const input of ['', '   ', 'not json', 'null', '[]', '"a string"', undefined]) {
    assert.deepEqual(parseDockerInfo(input), allNull, `input ${JSON.stringify(input)}`);
  }
});

test('parseDockerInfo treats blank and zero daemon values as unknown', () => {
  // A daemon that could not determine a value reports '' or 0; rendering that
  // verbatim would put a confident "0 CPU" and "0 B" on the board.
  const result = parseDockerInfo(
    JSON.stringify({
      Name: '',
      OperatingSystem: '   ',
      OSVersion: '',
      NCPU: 0,
      MemTotal: 0,
      ServerVersion: '27.3.1',
    }),
  );
  assert.equal(result.hostname, null);
  assert.equal(result.os, null);
  assert.equal(result.osVersion, null);
  assert.equal(result.cpuCount, null);
  assert.equal(result.memoryTotalBytes, null);
  assert.equal(result.dockerVersion, '27.3.1');
});
