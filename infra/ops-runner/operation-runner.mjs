import { randomUUID } from 'node:crypto';
import { OpsLockBusyError } from './ops-lock.mjs';

/**
 * Backup and restore operations under the ops lock. Out of server.mjs so it can be tested
 * (server.mjs listens and awaits at the top level): the lock, the process runner and the history
 * writer are handed in as `deps` = { operations, acquire, release, run, appendHistory, sanitize }.
 *
 * `start(kind, createCommand, body)` returns `{ operation, started }`. `createCommand` resolves
 * `{ command, afterSuccess? }`; `afterSuccess` runs ONLY when the command exited 0 (an uploaded
 * night's files are deleted there, ruling 214: a failed restore must keep them).
 * `started` resolves, and never rejects:
 *   'running' — the lock was taken;
 *   'busy'    — another operation holds it (a scheduled try is retried, ruling 217);
 *   'failed'  — the lock could not be taken for another reason (a full disk): a failed run.
 */
export function createOperationRunner(deps) {
  return { start: (kind, createCommand, body) => start(deps, kind, createCommand, body) };
}

function start(deps, kind, createCommand, body = {}) {
  const operation = {
    id: randomUUID(),
    kind,
    status: 'running',
    startedAt: new Date().toISOString(),
    source: body.location,
    backupId: body.backupId,
    scheduled: Boolean(body.scheduled),
    logTail: [],
  };
  // A scheduled try that meets the lock held is retried every tick: it is listed only once it
  // runs, or the screen would poll a "running" operation that is gone the next instant.
  if (!operation.scheduled) deps.operations.set(operation.id, operation);
  let settle;
  const started = new Promise((resolve) => {
    settle = resolve;
  });
  void runLocked(deps, operation, createCommand, settle);
  return { operation, started };
}

async function runLocked(deps, operation, createCommand, settle) {
  let handle;
  try {
    handle = await deps.acquire(operation);
  } catch (error) {
    fail(deps, operation, error);
    if (error instanceof OpsLockBusyError) {
      settle('busy');
      return;
    }
    deps.operations.set(operation.id, operation);
    await deps.appendHistory(operation).catch(() => undefined);
    settle('failed');
    return;
  }
  deps.operations.set(operation.id, operation);
  settle('running');

  try {
    if (operation.kind === 'restore') {
      // The safety net: the state the restore is about to replace.
      await deps.run(operation, ['bash', 'infra/scripts/backup.sh']);
    }
    const { command, afterSuccess } = await createCommand();
    await deps.run(operation, command);
    operation.status = 'success';
    await afterSuccess?.(operation);
  } catch (error) {
    fail(deps, operation, error);
  } finally {
    operation.finishedAt = new Date().toISOString();
    await deps.appendHistory(operation).catch(() => undefined);
    await deps.release(handle);
  }
}

function fail(deps, operation, error) {
  operation.status = 'failed';
  operation.error = deps.sanitize(error);
  operation.finishedAt = new Date().toISOString();
}
