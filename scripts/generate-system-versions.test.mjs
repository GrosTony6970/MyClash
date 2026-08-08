import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateSystemVersions } from './generate-system-versions.mjs';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('generates system version metadata from app manifests and production compose', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-'));
  await writeFile(path.join(rootDir, 'VERSION'), 'v1.2.3\n');
  await writeJson(path.join(rootDir, 'package.json'), {
    name: 'myclash',
    packageManager: 'pnpm@9.12.0',
    engines: { node: '>=20.10.0' },
    devDependencies: { typescript: '^5.6.0' },
  });
  await writeJson(path.join(rootDir, 'apps', 'web-admin', 'package.json'), {
    name: '@myclash/web-admin',
    version: '0.4.0',
    dependencies: {
      next: '15.3.2',
      react: '^19.1.0',
      'react-dom': '^19.1.0',
    },
  });
  await writeJson(path.join(rootDir, 'apps', 'api', 'package.json'), {
    name: '@myclash/api',
    version: '0.5.0',
    dependencies: {
      '@nestjs/core': '^10.4.0',
    },
  });
  await mkdir(path.join(rootDir, 'infra'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'infra', 'docker-compose.prod.yml'),
    [
      'services:',
      '  traefik:',
      '    image: traefik:v3.6.6',
      '  db:',
      '    image: supabase/postgres:15.6.1.115',
      '  redis:',
      '    image: redis:7-alpine',
      '  api:',
      '    build:',
      '      args:',
      '        GIT_COMMIT: ${GIT_COMMIT:-unknown}',
      '',
    ].join('\n'),
  );

  const outputPath = path.join(rootDir, 'data', 'system-versions.json');
  const result = await generateSystemVersions({
    rootDir,
    outputPath,
    now: () => new Date('2026-05-05T09:00:00.000Z'),
    deploy: {
      kind: 'redeploy',
      deployedCommit: 'abcdef123456',
      deployedAt: '2026-05-05T08:59:00Z',
      deployedBy: 'deploy-user',
    },
  });

  assert.equal(result.generatedAt, '2026-05-05T09:00:00.000Z');
  assert.equal(result.deploy.deployedCommit, 'abcdef123456');
  assert.equal(result.deploy.kind, 'redeploy');
  assert.equal(result.app.version, 'v1.2.3');
  // `workspaces` was dropped: the admin page group it fed duplicated App containers.
  assert.equal(result.workspaces, undefined);
  assert.equal(result.framework.react, '^19.1.0');
  assert.equal(result.framework.next, '15.3.2');
  assert.equal(result.framework.nestjs, '^10.4.0');
  assert.equal(result.infrastructure.traefik.image, 'traefik:v3.6.6');
  assert.equal(result.infrastructure.traefik.version, 'v3.6.6');
  assert.equal(result.infrastructure.postgres.version, '15.6.1.115');
  assert.equal(result.infrastructure.redis.version, '7-alpine');

  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.deepEqual(written, result);
});

test('clamps an unrecognised or absent deploy kind to unknown', async () => {
  // The board translates this value through an i18n key, so anything outside the
  // closed set would reach the operator as a raw bracketed key. Callers are shell
  // scripts passing "$1" — a typo must degrade, not leak through.
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-kind-'));
  const outputPath = path.join(rootDir, 'data', 'system-versions.json');

  for (const [given, expected] of [
    ['deploy', 'deploy'],
    ['redeploy', 'redeploy'],
    ['rollback', 'rollback'],
    ['hotpatch', 'unknown'],
    ['', 'unknown'],
    [undefined, 'unknown'],
  ]) {
    const result = await generateSystemVersions({
      rootDir,
      outputPath,
      now: () => new Date('2026-05-05T09:00:00.000Z'),
      deploy: { kind: given },
    });
    assert.equal(result.deploy.kind, expected, `kind ${JSON.stringify(given)}`);
  }
});

test('rewrites the manifest in place so an already-open handle sees the update', async () => {
  // Load-bearing, and invisible from this file alone: infra/docker-compose.prod.yml
  // bind-mounts the manifest FILE (not its directory) into the api container. A
  // bind mount pins the inode, so switching this writer to the temp-file +
  // rename pattern used elsewhere in the repo (infra/ops-runner/server.mjs writes
  // backup-history.json that way) would leave the container reading a dead inode
  // forever — the admin board would freeze on the previous deploy's metadata with
  // nothing failing anywhere. Truncate-in-place is the contract.
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-system-versions-inode-'));
  await writeFile(path.join(rootDir, 'VERSION'), 'v1.0.0\n');
  const outputPath = path.join(rootDir, 'data', 'system-versions.json');

  await generateSystemVersions({
    rootDir,
    outputPath,
    now: () => new Date('2026-05-05T09:00:00.000Z'),
    deploy: { deployedCommit: 'aaaaaaa' },
  });
  const before = await stat(outputPath);

  // Hold a descriptor across the rewrite, the way the container holds the mount.
  const handle = await open(outputPath, 'r');
  try {
    await generateSystemVersions({
      rootDir,
      outputPath,
      now: () => new Date('2026-05-05T10:00:00.000Z'),
      deploy: { deployedCommit: 'bbbbbbb' },
    });

    const seenThroughOldHandle = JSON.parse(await handle.readFile('utf8'));
    assert.equal(seenThroughOldHandle.deploy.deployedCommit, 'bbbbbbb');
    assert.equal(seenThroughOldHandle.generatedAt, '2026-05-05T10:00:00.000Z');
  } finally {
    await handle.close();
  }

  // Windows reports ino 0 on some filesystems; only assert when it is meaningful.
  const after = await stat(outputPath);
  if (before.ino !== 0) assert.equal(after.ino, before.ino);
});
