import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_BACKUP_SCHEDULE,
  deriveLastBackup,
  enforceLocalRetention,
  expectedBackupArtifactFilenames,
  nextBackupRun,
  normalizeBackupSchedule,
  shouldRunScheduledBackup,
} from './backup-core.mjs';

const artifactSet = (ts, { local = true, cloud = false } = {}) => ({
  timestamp: ts,
  local: { available: local },
  cloud: { available: cloud },
});

test('deriveLastBackup reports the last backup run as a coherent unit (status matches its own run)', () => {
  // A good backup at T1 left an artifact; a later run at T2 FAILED before
  // producing any artifact, so the newest artifact is still T1. The status
  // must reflect the T2 failure with T2's own timestamp/error — never T1's
  // artifact paired with T2's status.
  const history = [
    { kind: 'backup', status: 'success', finishedAt: '2026-05-01T03:00:00.000Z' },
    { kind: 'backup', status: 'failed', finishedAt: '2026-05-02T03:00:00.000Z', error: 'db down' },
  ];
  const result = deriveLastBackup(history, artifactSet('20260501T030000Z'));
  assert.equal(result.status, 'failed');
  assert.equal(result.timestamp, '2026-05-02T03:00:00.000Z');
  assert.equal(result.error, 'db down');
  assert.equal(result.localAvailable, true);
});

test('deriveLastBackup ignores restore safety-net backups (kind:restore)', () => {
  // After a restore, the safety-net produced the newest artifact (T2) but was
  // recorded as kind:restore. lastBackup must show the last real BACKUP run
  // (T1) with its own status, not T2's artifact paired with T1's status.
  const history = [
    { kind: 'backup', status: 'success', finishedAt: '2026-05-01T03:00:00.000Z' },
    { kind: 'restore', status: 'success', finishedAt: '2026-05-02T09:00:00.000Z' },
  ];
  const result = deriveLastBackup(history, artifactSet('20260502T090000Z'));
  assert.equal(result.status, 'success');
  assert.equal(result.timestamp, '2026-05-01T03:00:00.000Z');
});

test('deriveLastBackup falls back to the newest artifact as unknown before any run', () => {
  assert.deepEqual(deriveLastBackup([], artifactSet('20260501T030000Z', { cloud: true })), {
    timestamp: '20260501T030000Z',
    status: 'unknown',
    finishedAt: null,
    error: null,
    localAvailable: true,
    cloudAvailable: true,
  });
});

test('deriveLastBackup returns null with no history and no artifacts', () => {
  assert.equal(deriveLastBackup([], null), null);
});

test('expectedBackupArtifactFilenames returns local and encrypted DB/storage candidates', () => {
  assert.deepEqual(expectedBackupArtifactFilenames('20260505T030000Z'), [
    'db-20260505T030000Z.sql.gz',
    'db-20260505T030000Z.sql.gz.gpg',
    'storage-20260505T030000Z.tar.gz',
    'storage-20260505T030000Z.tar.gz.gpg',
  ]);
});

test('normalizeBackupSchedule defaults missing fields to the documented values', () => {
  const result = normalizeBackupSchedule({});
  assert.equal(result.frequency, 'daily');
  assert.equal(result.hourUtc, 3);
  assert.equal(result.minuteUtc, 0);
  assert.equal(result.dayOfWeek, 1);
  assert.equal(result.dayOfMonth, 1);
  assert.equal(result.retentionCountLocal, 14);
  assert.equal(result.retentionCountCloud, 60);
});

test('normalizeBackupSchedule rejects out-of-range values', () => {
  assert.throws(() => normalizeBackupSchedule({ frequency: 'every5h' }), /frequency/);
  assert.throws(() => normalizeBackupSchedule({ dayOfWeek: 7 }), /dayOfWeek/);
  // dayOfMonth is capped at 28 so the schedule fires every month.
  assert.throws(() => normalizeBackupSchedule({ dayOfMonth: 31 }), /dayOfMonth/);
  assert.throws(() => normalizeBackupSchedule({ retentionCountLocal: 0 }), /retentionCountLocal/);
  assert.throws(
    () => normalizeBackupSchedule({ retentionCountCloud: 100_000 }),
    /retentionCountCloud/,
  );
});

const BASE = {
  ...DEFAULT_BACKUP_SCHEDULE,
  enabled: true,
};

test('shouldRunScheduledBackup: daily fires once per day at the exact minute', () => {
  const schedule = { ...BASE, frequency: 'daily', hourUtc: 3, minuteUtc: 0 };
  const exact = new Date(Date.UTC(2026, 4, 27, 3, 0));
  const first = shouldRunScheduledBackup(schedule, exact, null);
  assert.equal(first.shouldRun, true);
  // Second call within the same minute: deduped via runKey.
  const second = shouldRunScheduledBackup(schedule, exact, first.runKey);
  assert.equal(second.shouldRun, false);
  // One minute later: not a slot anymore.
  const later = new Date(Date.UTC(2026, 4, 27, 3, 1));
  assert.equal(shouldRunScheduledBackup(schedule, later, first.runKey).shouldRun, false);
});

test('shouldRunScheduledBackup: hourly fires every hour at :minuteUtc', () => {
  const schedule = { ...BASE, frequency: 'hourly', minuteUtc: 30 };
  for (const hour of [0, 6, 13, 23]) {
    const now = new Date(Date.UTC(2026, 4, 27, hour, 30));
    assert.equal(shouldRunScheduledBackup(schedule, now, null).shouldRun, true, `hour ${hour}`);
  }
  // Wrong minute → no fire.
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 27, 5, 0)), null).shouldRun,
    false,
  );
});

test('shouldRunScheduledBackup: every6h fires four times a day from hourUtc', () => {
  const schedule = { ...BASE, frequency: 'every6h', hourUtc: 3, minuteUtc: 0 };
  for (const hour of [3, 9, 15, 21]) {
    assert.equal(
      shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 27, hour, 0)), null).shouldRun,
      true,
      `hour ${hour}`,
    );
  }
  for (const hour of [0, 4, 6, 12, 18]) {
    assert.equal(
      shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 27, hour, 0)), null).shouldRun,
      false,
      `hour ${hour}`,
    );
  }
});

test('shouldRunScheduledBackup: every12h fires twice a day', () => {
  const schedule = { ...BASE, frequency: 'every12h', hourUtc: 4, minuteUtc: 15 };
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 27, 4, 15)), null).shouldRun,
    true,
  );
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 27, 16, 15)), null).shouldRun,
    true,
  );
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 27, 10, 15)), null).shouldRun,
    false,
  );
});

test('shouldRunScheduledBackup: weekly fires only on the configured weekday', () => {
  // 2026-05-25 is a Monday (UTC). dayOfWeek=1 = Monday.
  const schedule = { ...BASE, frequency: 'weekly', hourUtc: 3, minuteUtc: 0, dayOfWeek: 1 };
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 25, 3, 0)), null).shouldRun,
    true,
  );
  // Tuesday at the same hour: no fire.
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 26, 3, 0)), null).shouldRun,
    false,
  );
});

test('shouldRunScheduledBackup: monthly fires only on the configured day of month', () => {
  const schedule = { ...BASE, frequency: 'monthly', hourUtc: 3, minuteUtc: 0, dayOfMonth: 15 };
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 15, 3, 0)), null).shouldRun,
    true,
  );
  assert.equal(
    shouldRunScheduledBackup(schedule, new Date(Date.UTC(2026, 4, 16, 3, 0)), null).shouldRun,
    false,
  );
});

test('shouldRunScheduledBackup: disabled never fires', () => {
  const schedule = { ...BASE, enabled: false };
  const now = new Date(Date.UTC(2026, 4, 27, 3, 0));
  assert.equal(shouldRunScheduledBackup(schedule, now, null).shouldRun, false);
});

test('nextBackupRun: daily returns tomorrow if today already passed', () => {
  const schedule = { ...BASE, frequency: 'daily', hourUtc: 3, minuteUtc: 0 };
  const now = new Date(Date.UTC(2026, 4, 27, 10, 0));
  assert.equal(nextBackupRun(schedule, now), '2026-05-28T03:00:00.000Z');
});

test('nextBackupRun: hourly returns the next hour at :minuteUtc', () => {
  const schedule = { ...BASE, frequency: 'hourly', minuteUtc: 30 };
  const now = new Date(Date.UTC(2026, 4, 27, 10, 45));
  assert.equal(nextBackupRun(schedule, now), '2026-05-27T11:30:00.000Z');
});

test('nextBackupRun: every6h returns the next slot from hourUtc', () => {
  const schedule = { ...BASE, frequency: 'every6h', hourUtc: 3, minuteUtc: 0 };
  // Slots: 03:00, 09:00, 15:00, 21:00. At 10:00 next is 15:00.
  const now = new Date(Date.UTC(2026, 4, 27, 10, 0));
  assert.equal(nextBackupRun(schedule, now), '2026-05-27T15:00:00.000Z');
});

test('nextBackupRun: weekly skips to next configured weekday', () => {
  const schedule = { ...BASE, frequency: 'weekly', hourUtc: 3, minuteUtc: 0, dayOfWeek: 1 };
  // 2026-05-27 is a Wednesday. Next Monday at 03:00 UTC = 2026-06-01.
  const now = new Date(Date.UTC(2026, 4, 27, 12, 0));
  assert.equal(nextBackupRun(schedule, now), '2026-06-01T03:00:00.000Z');
});

test('nextBackupRun: monthly jumps to next month when this month already passed', () => {
  const schedule = { ...BASE, frequency: 'monthly', hourUtc: 3, minuteUtc: 0, dayOfMonth: 15 };
  // 2026-05-27 is past May 15 → next is June 15.
  const now = new Date(Date.UTC(2026, 4, 27, 12, 0));
  assert.equal(nextBackupRun(schedule, now), '2026-06-15T03:00:00.000Z');
});

test('nextBackupRun: disabled returns null', () => {
  assert.equal(nextBackupRun({ ...BASE, enabled: false }), null);
});

test('enforceLocalRetention deletes the oldest sets and keeps the newest N', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'myclash-retention-'));
  const nightly = path.join(root, 'backups', 'nightly');
  await mkdir(nightly, { recursive: true });

  // 5 sets, newest first via lexicographic order of timestamps.
  const timestamps = [
    '20260527T030000Z',
    '20260526T030000Z',
    '20260525T030000Z',
    '20260524T030000Z',
    '20260523T030000Z',
  ];
  for (const ts of timestamps) {
    await writeFile(path.join(nightly, `db-${ts}.sql.gz`), 'fake');
    await writeFile(path.join(nightly, `storage-${ts}.tar.gz`), 'fake');
  }

  const summary = await enforceLocalRetention(root, 2);
  assert.equal(summary.deletedSets, 3);
  assert.equal(summary.deletedFiles.length, 6); // 3 sets × 2 artifacts each

  const remaining = await readdir(nightly);
  // Only the two newest timestamps survive.
  assert.deepEqual(
    new Set(remaining),
    new Set([
      'db-20260527T030000Z.sql.gz',
      'storage-20260527T030000Z.tar.gz',
      'db-20260526T030000Z.sql.gz',
      'storage-20260526T030000Z.tar.gz',
    ]),
  );
});

test('enforceLocalRetention is a no-op when the count is already within budget', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'myclash-retention-noop-'));
  const nightly = path.join(root, 'backups', 'nightly');
  await mkdir(nightly, { recursive: true });
  await writeFile(path.join(nightly, 'db-20260527T030000Z.sql.gz'), 'fake');

  const summary = await enforceLocalRetention(root, 5);
  assert.equal(summary.deletedSets, 0);
  assert.deepEqual(summary.deletedFiles, []);
});
