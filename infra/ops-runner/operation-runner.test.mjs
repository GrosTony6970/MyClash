import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationRunner } from './operation-runner.mjs';
import { OpsLockBusyError } from './ops-lock.mjs';

/** A runner whose lock, processes and history are recorded in `events`. */
function harness({ lock = 'free', exits = {} } = {}) {
  const events = [];
  const operations = new Map();
  const runner = createOperationRunner({
    operations,
    acquire: async (operation) => {
      if (lock === 'busy') throw new OpsLockBusyError();
      if (lock === 'broken')
        throw Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' });
      events.push(`lock ${operation.kind}`);
      return { token: 'h' };
    },
    release: async () => {
      events.push('release');
    },
    run: async (_operation, command) => {
      events.push(`run ${command.join(' ')}`);
      const exit = exits[command.at(-1)] ?? 0;
      if (exit !== 0) throw new Error(`bash exited with ${exit}`);
    },
    appendHistory: async (operation) => {
      events.push(`history ${operation.kind} ${operation.status}`);
    },
    sanitize: (error) => (error instanceof Error ? error.message : 'Unknown operation error.'),
  });
  return { runner, events, operations };
}

const restoreOf = (afterSuccess) => async () => ({
  command: ['bash', 'infra/scripts/restore.sh', 'db.sql.gz'],
  afterSuccess,
});
const settled = async ({ operation, started }) => {
  const result = await started;
  // The run goes on after `started`: wait for its history line.
  for (let i = 0; i < 20 && !operation.finishedAt; i += 1)
    await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  return result;
};

test('a restore that worked deletes what it used, once, before its history line', async () => {
  const { runner, events } = harness();
  const started = runner.start(
    'restore',
    restoreOf(async () => {
      events.push('afterSuccess');
    }),
  );
  assert.equal(await settled(started), 'running');
  assert.deepEqual(events, [
    'lock restore',
    'run bash infra/scripts/backup.sh',
    'run bash infra/scripts/restore.sh db.sql.gz',
    'afterSuccess',
    'history restore success',
    'release',
  ]);
});

test('a restore that failed keeps the uploaded files (ruling 214)', async () => {
  const { runner, events } = harness({ exits: { 'db.sql.gz': 1 } });
  const started = runner.start(
    'restore',
    restoreOf(async () => {
      events.push('afterSuccess');
    }),
  );
  await settled(started);
  assert.equal(started.operation.status, 'failed');
  assert.equal(events.includes('afterSuccess'), false, events.join(' | '));
  assert.ok(events.includes('history restore failed'));
});

test('a safety backup that failed stops the restore before it runs', async () => {
  const { runner, events } = harness({ exits: { 'infra/scripts/backup.sh': 1 } });
  const started = runner.start(
    'restore',
    restoreOf(async () => events.push('afterSuccess')),
  );
  await settled(started);
  assert.equal(
    events.some((event) => event.includes('restore.sh')),
    false,
    events.join(' | '),
  );
  assert.equal(events.includes('afterSuccess'), false);
});

test('a scheduled try that meets the lock held is busy, unlisted, and leaves no history', async () => {
  const { runner, events, operations } = harness({ lock: 'busy' });
  const started = runner.start(
    'backup',
    async () => ({ command: ['bash', 'infra/scripts/backup.sh'] }),
    { scheduled: true },
  );
  assert.equal(operations.size, 0, 'never listed, even before the lock answers');
  assert.equal(await settled(started), 'busy');
  assert.equal(operations.size, 0);
  assert.deepEqual(events, []);
});

test('a backup started by hand that meets the lock held is listed as failed', async () => {
  const { runner, operations } = harness({ lock: 'busy' });
  const started = runner.start('backup', async () => ({ command: ['bash', 'b.sh'] }));
  assert.equal(await settled(started), 'busy');
  assert.equal(operations.get(started.operation.id)?.status, 'failed');
  // The screen words it in the reader's language: the lock's code rides on the operation.
  assert.equal(operations.get(started.operation.id)?.code, 'ops_busy');
});

test('a lock that cannot be written is a failed run with its own cause, not "busy"', async () => {
  const { runner, events, operations } = harness({ lock: 'broken' });
  const started = runner.start('backup', async () => ({ command: ['bash', 'b.sh'] }), {
    scheduled: true,
  });
  assert.equal(await settled(started), 'failed');
  assert.match(started.operation.error, /ENOSPC/u);
  assert.equal(started.operation.code, undefined, "Node's own codes are no refusal");
  assert.equal(operations.get(started.operation.id)?.status, 'failed');
  assert.deepEqual(events, ['history backup failed']);
});

test('a scheduled backup that runs is listed once it holds the lock', async () => {
  const { runner, operations } = harness();
  const started = runner.start('backup', async () => ({ command: ['bash', 'b.sh'] }), {
    scheduled: true,
  });
  assert.equal(await settled(started), 'running');
  assert.equal(operations.get(started.operation.id)?.status, 'success');
});
