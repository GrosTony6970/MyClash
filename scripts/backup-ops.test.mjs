import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  backupSetsFromArtifacts,
  DEFAULT_BACKUP_SCHEDULE,
  nextBackupRun,
  normalizeBackupSchedule,
  readBackupSchedule,
  listLocalBackupArtifacts,
  parseAwsS3List,
  parseBackupFilename,
  shouldRunScheduledBackup,
  writeBackupSchedule,
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

test('reads missing backup schedule as default 03:00 UTC', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-backup-schedule-'));

  const schedule = await readBackupSchedule(rootDir);

  // Compare against the exported default rather than a hand-copied literal.
  // The literal version of this rotted the moment the schedule gained
  // frequency / dayOfWeek / dayOfMonth / retention fields, and nothing caught
  // it because nothing ran these tests. This asserts the CONTRACT — "no file
  // on disk yields the documented default" — which cannot drift.
  assert.deepEqual(schedule, DEFAULT_BACKUP_SCHEDULE);
  assert.equal(nextBackupRun(schedule, new Date('2026-05-18T02:30:00Z')), '2026-05-18T03:00:00.000Z');
});

test('persists editable backup schedule', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'myclash-backup-schedule-'));

  const schedule = await writeBackupSchedule(rootDir, {
    enabled: false,
    hourUtc: 22,
    minuteUtc: 45,
    timezoneLabel: 'UTC',
  });
  const fileText = await readFile(path.join(rootDir, 'data', 'backup-schedule.json'), 'utf8');

  assert.equal(schedule.enabled, false);
  assert.equal(schedule.hourUtc, 22);
  assert.equal(schedule.minuteUtc, 45);
  assert.match(schedule.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(fileText).hourUtc, 22);
});

test('detects scheduled backup minute once per run key', () => {
  // Built through normalizeBackupSchedule, not hand-rolled. A literal object
  // silently omitted `frequency`, so slotMatches fell through its switch to
  // `default: return false` and the test failed against perfectly correct
  // production code.
  const schedule = normalizeBackupSchedule({ hourUtc: 3, minuteUtc: 0 });

  const first = shouldRunScheduledBackup(schedule, new Date('2026-05-18T03:00:05Z'));
  const duplicate = shouldRunScheduledBackup(
    schedule,
    new Date('2026-05-18T03:00:40Z'),
    first.runKey,
  );

  assert.equal(first.shouldRun, true);
  assert.equal(first.runKey, '2026-05-18T03:00Z');
  assert.equal(duplicate.shouldRun, false);
});
