import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  OpsLockBusyError,
  RUNNER_INSTANCE_ID,
  UNREADABLE_LOCK_GRACE_MS,
  acquireOpsLock,
  inspectOpsLock,
  opsLockPath,
  releaseOpsLock,
  resetLiveTokensForTest,
  withOpsLock,
} from './ops-lock.mjs';

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'myclash-ops-lock-'));
  await mkdir(path.join(root, 'backups'), { recursive: true });
  return root;
}

/** Plant a lock file directly, bypassing acquire, to stage a given verdict. */
async function plantLock(root, payload) {
  await writeFile(
    opsLockPath(root),
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  );
}

const readLock = async (root) => JSON.parse(await readFile(opsLockPath(root), 'utf8'));
const fileExists = async (p) =>
  stat(p)
    .then(() => true)
    .catch(() => false);

test('acquire takes the lock and stamps it with this process instance', async () => {
  const root = await tempRoot();
  const handle = await acquireOpsLock(root, { kind: 'backup', operationId: 'op-1' });

  const written = await readLock(root);
  assert.equal(written.instanceId, RUNNER_INSTANCE_ID);
  assert.equal(written.operationId, 'op-1');
  assert.equal(written.kind, 'backup');
  assert.equal(written.token, handle.token);

  await releaseOpsLock(handle);
});

test('a genuinely running operation blocks a second acquire with a 409', async () => {
  const root = await tempRoot();
  const held = await acquireOpsLock(root, { kind: 'backup', operationId: 'op-1' });

  await assert.rejects(
    () => acquireOpsLock(root, { kind: 'restore', operationId: 'op-2' }),
    (error) => {
      assert.ok(error instanceof OpsLockBusyError);
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
  // The incumbent still owns the file.
  assert.equal((await readLock(root)).token, held.token);

  await releaseOpsLock(held);
});

test('a lock from a previous process instance is reclaimed, not obeyed', async () => {
  // THE wedge case: the container was killed mid-backup, so the cleanup
  // `finally` never ran and the lock outlived the process that took it.
  const root = await tempRoot();
  await plantLock(root, {
    token: 'token-from-a-dead-process',
    instanceId: 'a-previous-boot-of-the-runner',
    pid: 1,
    kind: 'backup',
    operationId: 'op-dead',
    startedAt: '2026-08-07T03:00:00.000Z',
  });

  const reclaimed = [];
  const handle = await acquireOpsLock(root, {
    kind: 'backup',
    operationId: 'op-new',
    onReclaim: (state) => reclaimed.push(state.reason),
  });

  assert.deepEqual(reclaimed, ['foreign-instance']);
  assert.equal((await readLock(root)).operationId, 'op-new');

  await releaseOpsLock(handle);
});

test('a same-instance lock whose holder already finished is reclaimed', async () => {
  // Cleanup ran but the unlink failed: our own instance id, a token nobody holds.
  const root = await tempRoot();
  await plantLock(root, {
    token: 'never-handed-out',
    instanceId: RUNNER_INSTANCE_ID,
    pid: process.pid,
    kind: 'backup',
    operationId: 'op-abandoned',
    startedAt: '2026-08-07T03:00:00.000Z',
  });

  const reclaimed = [];
  const handle = await acquireOpsLock(root, {
    kind: 'delete-all',
    operationId: 'op-new',
    onReclaim: (state) => reclaimed.push(state.reason),
  });

  assert.deepEqual(reclaimed, ['abandoned']);
  await releaseOpsLock(handle);
});

test('a zero-byte legacy lock is reclaimed once past the grace window', async () => {
  // Locks written before this module existed carry no payload at all, so a
  // wedged VPS heals itself on the next operation instead of needing an SSH.
  const root = await tempRoot();
  await plantLock(root, '');

  const reclaimed = [];
  const handle = await acquireOpsLock(root, {
    kind: 'backup',
    operationId: 'op-new',
    now: () => Date.now() + UNREADABLE_LOCK_GRACE_MS + 1_000,
    onReclaim: (state) => reclaimed.push(state.reason),
  });

  assert.deepEqual(reclaimed, ['unreadable']);
  await releaseOpsLock(handle);
});

test('a zero-byte lock inside the grace window is respected, not reclaimed', async () => {
  // Closes the create-then-write race: a lock caught mid-write must not be
  // mistaken for a leftover.
  const root = await tempRoot();
  await plantLock(root, '');

  await assert.rejects(
    () => acquireOpsLock(root, { kind: 'backup', operationId: 'op-new' }),
    OpsLockBusyError,
  );
});

test('release removes the lock so the next operation can run', async () => {
  const root = await tempRoot();
  const handle = await acquireOpsLock(root, { kind: 'backup', operationId: 'op-1' });
  await releaseOpsLock(handle);

  assert.equal(await fileExists(opsLockPath(root)), false);
  const next = await acquireOpsLock(root, { kind: 'restore', operationId: 'op-2' });
  assert.equal((await readLock(root)).operationId, 'op-2');
  await releaseOpsLock(next);
});

test('a reclaimed holder must not delete the lock its reclaimer now owns', async () => {
  // Otherwise recovery is worse than the wedge: the abandoned operation's late
  // cleanup would strip the lock off a backup that is actively running.
  const root = await tempRoot();
  const abandoned = await acquireOpsLock(root, { kind: 'backup', operationId: 'op-abandoned' });

  // Simulate the holder being forgotten (as a process restart would), which is
  // what lets the next contender classify the lock as abandoned.
  resetLiveTokensForTest();
  const reclaimer = await acquireOpsLock(root, { kind: 'restore', operationId: 'op-reclaimer' });

  await releaseOpsLock(abandoned);

  assert.equal(await fileExists(opsLockPath(root)), true);
  assert.equal((await readLock(root)).token, reclaimer.token);
  assert.equal((await readLock(root)).operationId, 'op-reclaimer');

  await releaseOpsLock(reclaimer);
});

test('withOpsLock releases the lock even when the body throws', async () => {
  const root = await tempRoot();

  await assert.rejects(
    () =>
      withOpsLock(root, { kind: 'delete-all' }, async () => {
        throw new Error('aws exited with 1');
      }),
    /aws exited with 1/,
  );

  assert.equal(await fileExists(opsLockPath(root)), false);
});

test('withOpsLock returns the body result and serialises against a held lock', async () => {
  const root = await tempRoot();
  assert.equal(await withOpsLock(root, { kind: 'delete-all' }, async () => 'done'), 'done');

  const held = await acquireOpsLock(root, { kind: 'backup', operationId: 'op-1' });
  await assert.rejects(
    () => withOpsLock(root, { kind: 'delete-all' }, async () => 'should not run'),
    OpsLockBusyError,
  );
  await releaseOpsLock(held);
});

test('inspectOpsLock reports a missing lock as vanished rather than stale', async () => {
  const root = await tempRoot();
  assert.deepEqual(await inspectOpsLock(opsLockPath(root)), { verdict: 'vanished' });
});
