import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BACKUP_SCHEDULE } from './backup-core.mjs';
import { createScheduledBackup, missedBackupRecord } from './scheduled-backup.mjs';

const DAILY = { ...DEFAULT_BACKUP_SCHEDULE, frequency: 'daily', hourUtc: 3, minuteUtc: 0 };
const at = (day, hh, mm, ss = 0) => new Date(Date.UTC(2026, 9, day, hh, mm, ss));

/** A scheduler whose lock answers come from `answers`, one per attempt (the last one repeats). */
function harness(answers) {
  const attempts = [];
  const missed = [];
  const scheduler = createScheduledBackup({
    start: async () => {
      attempts.push(attempts.length);
      return answers[Math.min(attempts.length - 1, answers.length - 1)];
    },
    recordMissed: async (slot, now) => {
      missed.push({ runKey: slot.runKey, now: now.toISOString() });
    },
  });
  return { scheduler, attempts, missed };
}

test('a free slot runs once', async () => {
  const { scheduler, attempts } = harness(['running']);
  assert.equal(await scheduler.tick(DAILY, at(30, 2, 59, 40)), 'idle');
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 10)), 'running');
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 40)), 'idle');
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 1, 10)), 'idle');
  assert.equal(attempts.length, 1);
});

test('a busy night is retried every tick, past its minute, until it runs (ruling 217)', async () => {
  const { scheduler, attempts, missed } = harness(['busy', 'busy', 'busy', 'running']);
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 10)), 'busy');
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 40)), 'busy');
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 1, 10)), 'busy');
  assert.equal(await scheduler.tick(DAILY, at(30, 5, 12, 0)), 'running');
  assert.equal(await scheduler.tick(DAILY, at(30, 5, 12, 30)), 'idle');
  assert.equal(attempts.length, 4);
  assert.deepEqual(missed, []);
});

test('a night still busy at the next slot is recorded as missed, and the new night is tried', async () => {
  const { scheduler, attempts, missed } = harness(['busy']);
  await scheduler.tick(DAILY, at(30, 3, 0, 10));
  await scheduler.tick(DAILY, at(31, 2, 59, 50));
  assert.deepEqual(missed, []);
  assert.equal(await scheduler.tick(DAILY, at(31, 3, 0, 10)), 'busy');
  assert.deepEqual(missed, [{ runKey: '2026-10-30T03:00Z', now: at(31, 3, 0, 10).toISOString() }]);
  assert.equal(attempts.length, 3, 'the new night is tried in the same tick');
  await scheduler.tick(DAILY, at(31, 3, 0, 40));
  assert.equal(missed.length, 1, 'one record per night');
});

test('the next slot is read from the schedule in force, not the one of the night', async () => {
  const { scheduler, missed } = harness(['busy']);
  await scheduler.tick(DAILY, at(30, 3, 0, 10));
  await scheduler.tick(DAILY, at(30, 5, 0, 30));
  assert.deepEqual(missed, []);
  const hourly = { ...DAILY, frequency: 'hourly' };
  await scheduler.tick(hourly, at(30, 5, 0, 40));
  assert.deepEqual(
    missed.map((entry) => entry.runKey),
    ['2026-10-30T03:00Z'],
    'hourly: the next slot after 03:00 was 04:00, already past',
  );
});

test('a schedule turned off while a night waits ends the wait as missed', async () => {
  const { scheduler, attempts, missed } = harness(['busy']);
  await scheduler.tick(DAILY, at(30, 3, 0, 10));
  assert.equal(await scheduler.tick({ ...DAILY, enabled: false }, at(30, 3, 0, 40)), 'idle');
  assert.equal(missed.length, 1);
  assert.equal(attempts.length, 1);
});

test('a night whose lock could not be written ran and failed: no retry, no missed record', async () => {
  const { scheduler, attempts, missed } = harness(['failed', 'running']);
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 10)), 'failed');
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 40)), 'idle');
  await scheduler.tick(DAILY, at(31, 3, 0, 10));
  assert.deepEqual(missed, []);
  assert.equal(attempts.length, 2, 'the next night is tried as usual');
});

test('one attempt at a time: a tick during an attempt does not start another', async () => {
  let release;
  const attempts = [];
  const scheduler = createScheduledBackup({
    start: () => {
      attempts.push(1);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    recordMissed: async () => undefined,
  });
  const first = scheduler.tick(DAILY, at(30, 3, 0, 10));
  assert.equal(await scheduler.tick(DAILY, at(30, 3, 0, 40)), 'in-flight');
  release('running');
  assert.equal(await first, 'running');
  assert.equal(attempts.length, 1);
});

test('a missed night is a failed scheduled backup in the history', () => {
  const record = missedBackupRecord(
    { runKey: '2026-10-30T03:00Z', slotAt: at(30, 3, 0) },
    at(31, 3, 0, 10),
  );
  assert.equal(record.kind, 'backup');
  assert.equal(record.status, 'failed');
  assert.equal(record.scheduled, true);
  assert.equal(record.code, 'scheduled_backup_missed');
  assert.equal(record.startedAt, '2026-10-30T03:00:00.000Z');
  assert.equal(record.finishedAt, '2026-10-31T03:00:10.000Z');
  assert.match(record.error, /did not run/u);
  assert.match(record.id, /^[0-9a-f-]{36}$/u);
});
