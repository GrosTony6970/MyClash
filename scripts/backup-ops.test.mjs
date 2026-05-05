import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  backupSetsFromArtifacts,
  listLocalBackupArtifacts,
  parseAwsS3List,
  parseBackupFilename,
} from '../infra/ops-runner/backup-core.mjs';

test('parses MyClash backup filenames safely', () => {
  assert.deepEqual(parseBackupFilename('db-20260505T030000Z.sql.gz'), {
    kind: 'db',
    timestamp: '20260505T030000Z',
    filename: 'db-20260505T030000Z.sql.gz',
    encrypted: false,
  });
  assert.deepEqual(parseBackupFilename('storage-20260505T030000Z.tar.gz.gpg'), {
    kind: 'storage',
    timestamp: '20260505T030000Z',
    filename: 'storage-20260505T030000Z.tar.gz.gpg',
    encrypted: true,
  });
  assert.equal(parseBackupFilename('../db-20260505T030000Z.sql.gz'), null);
  assert.equal(parseBackupFilename('db-latest.sql.gz'), null);
});

test('groups local and Scaleway S3 artifacts by timestamp', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-backup-ops-'));
  const nightlyDir = path.join(rootDir, 'backups', 'nightly');
  await mkdir(nightlyDir, { recursive: true });
  await writeFile(path.join(nightlyDir, 'db-20260505T030000Z.sql.gz'), 'db');
  await writeFile(path.join(nightlyDir, 'storage-20260505T030000Z.tar.gz'), 'storage');

  const localArtifacts = await listLocalBackupArtifacts(rootDir);
  const cloudArtifacts = parseAwsS3List(
    [
      '2026-05-05 03:01:00         20 db-20260505T030000Z.sql.gz',
      '2026-05-05 03:02:00         40 storage-20260505T030000Z.tar.gz',
    ].join('\n'),
  ).map((entry) => ({ ...parseBackupFilename(entry.key), ...entry }));

  const sets = backupSetsFromArtifacts({ localArtifacts, cloudArtifacts });

  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, '20260505T030000Z');
  assert.equal(sets[0].local.available, true);
  assert.equal(sets[0].cloud.available, true);
  assert.equal(sets[0].local.artifacts.length, 2);
  assert.equal(sets[0].cloud.artifacts.length, 2);
});
