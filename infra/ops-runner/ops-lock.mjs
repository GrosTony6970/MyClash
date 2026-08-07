import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Cross-operation mutual exclusion for the ops runner (backup, restore,
 * delete-all). Extracted from server.mjs so it can be unit-tested — server.mjs
 * calls createServer()/listen() and awaits at the top level, so nothing left
 * inside it is importable from a test.
 *
 * LOAD-BEARING INVARIANT: the runner is a SINGLE Node process — one
 * `ops-runner` compose service, no replicas, `CMD ["node", …]`. That is what
 * lets us treat a lock stamped with a different `instanceId` as definitively
 * abandoned rather than guessing with a TTL: no other live process could have
 * written it. If the service is ever scaled, or a second container mounts the
 * same bind mount, this reasoning breaks and the lock needs a real lease.
 */

/** Regenerated on every process start. See the invariant above. */
export const RUNNER_INSTANCE_ID = randomUUID();

/**
 * A lock file is created and populated by one `writeFile(…, {flag:'wx'})`, but
 * a reader can still catch the file between the O_CREAT|O_EXCL and the bytes
 * landing. Rather than reclaim on that race, an unreadable lock is treated as
 * held until it is this old — after which it is a genuine leftover (locks
 * written before this module existed are zero-byte and land here too, so a
 * currently-wedged VPS self-heals on the next operation).
 */
export const UNREADABLE_LOCK_GRACE_MS = 5_000;

/**
 * Tokens handed out by `acquireOpsLock` and not yet released. Membership is
 * the definition of "an operation is still running in this process": it
 * survives a failed unlink (release clears the token regardless) and dies with
 * the process, which is exactly the semantics a stale-lock check needs.
 */
const liveTokens = new Set();

export class OpsLockBusyError extends Error {
  constructor(message = 'Another backup operation is already running.') {
    super(message);
    this.name = 'OpsLockBusyError';
    // Surfaced by the HTTP layer so contention reads as 409 Conflict rather
    // than being flattened into the catch-all 500.
    this.statusCode = 409;
  }
}

export function opsLockPath(rootDir) {
  return path.join(rootDir, 'backups', '.ops.lock');
}

/**
 * Classify an existing lock file. Returns one of:
 *   held     — a real operation is running; the caller must back off
 *   stale    — abandoned; the caller may reclaim it
 *   vanished — released between our failed create and this read; just retry
 */
export async function inspectOpsLock(lockPath, now = Date.now()) {
  let raw;
  try {
    raw = await readFile(lockPath, 'utf8');
  } catch {
    return { verdict: 'vanished' };
  }

  let holder = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.instanceId === 'string') {
      holder = parsed;
    }
  } catch {
    holder = null;
  }

  if (!holder) {
    let mtimeMs;
    try {
      ({ mtimeMs } = await stat(lockPath));
    } catch {
      return { verdict: 'vanished' };
    }
    return now - mtimeMs >= UNREADABLE_LOCK_GRACE_MS
      ? { verdict: 'stale', reason: 'unreadable', holder: null }
      : { verdict: 'held', reason: 'being-written', holder: null };
  }

  if (holder.instanceId !== RUNNER_INSTANCE_ID) {
    return { verdict: 'stale', reason: 'foreign-instance', holder };
  }
  if (!liveTokens.has(holder.token)) {
    return { verdict: 'stale', reason: 'abandoned', holder };
  }
  return { verdict: 'held', reason: 'running', holder };
}

/**
 * Take the ops lock, reclaiming it if the current holder is provably gone.
 * Throws `OpsLockBusyError` when something is genuinely running.
 *
 * @returns a handle to pass to `releaseOpsLock`.
 */
export async function acquireOpsLock(
  rootDir,
  { kind, operationId, now = Date.now, onReclaim } = {},
) {
  const lockPath = opsLockPath(rootDir);
  await mkdir(path.dirname(lockPath), { recursive: true });

  const token = randomUUID();
  const payload = `${JSON.stringify({
    token,
    instanceId: RUNNER_INSTANCE_ID,
    pid: process.pid,
    kind: kind ?? null,
    operationId: operationId ?? null,
    startedAt: new Date().toISOString(),
  })}\n`;

  // Three attempts: create → (reclaim a stale lock) → create → (lose the
  // reclaim race to a concurrent contender) → create. Bounded so a pathological
  // churn can never spin here.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(lockPath, payload, { flag: 'wx' });
      liveTokens.add(token);
      return { lockPath, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const state = await inspectOpsLock(lockPath, now());
    if (state.verdict === 'held') throw new OpsLockBusyError();
    if (state.verdict === 'stale') {
      onReclaim?.(state);
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }

  throw new OpsLockBusyError();
}

/**
 * Drop the lock. Ownership-checked: if our lock was reclaimed while we were
 * running, the file on disk now belongs to whoever reclaimed it and must be
 * left alone — deleting it would hand a third caller a lock that is genuinely
 * held.
 */
export async function releaseOpsLock(handle) {
  if (!handle) return;
  liveTokens.delete(handle.token);

  let owned = false;
  try {
    const parsed = JSON.parse(await readFile(handle.lockPath, 'utf8'));
    owned = parsed?.token === handle.token;
  } catch {
    // Already gone, or replaced by an unreadable lock we can't claim.
    return;
  }
  if (owned) await rm(handle.lockPath, { force: true }).catch(() => undefined);
}

/** Run `fn` under the ops lock, releasing it however `fn` settles. */
export async function withOpsLock(rootDir, options, fn) {
  const handle = await acquireOpsLock(rootDir, options);
  try {
    return await fn();
  } finally {
    await releaseOpsLock(handle);
  }
}

/** Test seam: forget every live token, as a process restart would. */
export function resetLiveTokensForTest() {
  liveTokens.clear();
}
