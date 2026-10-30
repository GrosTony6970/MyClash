import { rm } from 'node:fs/promises';
import { parseBackupFilename } from './backup-core.mjs';
import { OPS_BUSY_CODE, OpsLockBusyError } from './ops-lock.mjs';
import { nightSet, refusal, stageUpload, stagedPath } from './upload-store.mjs';
import {
  bytesPath,
  exists,
  gone,
  publicView,
  readSession,
  removeSession,
  serialize,
  throwGone,
  writeSession,
} from './upload-session-files.mjs';

/**
 * The end of a chunked upload (`upload-chunks.mjs`): `complete` answers 202 at once, and a
 * background job checks the file (`gzip -t`, OUTSIDE the ops lock: 2 GB at `cpus: 1` must not hold
 * off a backup), then moves it into its night's folder UNDER the lock through commit A's
 * `stageUpload`. The end states are written in a fixed order, since their bytes leave on purpose:
 * `staging` (with its target) before the move, `staged` after it; `failed` before the corrupt
 * bytes go.
 */

/** A failure that was not the file's: its bytes stay, and the same file again resumes it. */
export const FAILED_CODE = 'upload_failed';

/** Idempotent; runs on the upload's queue. */
export async function complete(ctx, id) {
  const session = (await readSession(ctx, id)) ?? throwGone();
  if (session.state === 'failed') {
    throw refusal(409, session.error ?? 'This upload failed.', session.code ?? FAILED_CODE);
  }
  if (session.state === 'staging') startJob(ctx, id, () => recover(ctx, id));
  // A check whose job died without a word (its failure could not be written: a full disk) starts
  // again; `jobs` is what "a job is alive in this process" means.
  if (session.state === 'verifying') startJob(ctx, id, () => finish(ctx, id));
  if (session.state !== 'receiving') return publicView(session);
  if (session.receivedBytes !== session.sizeBytes) {
    throw refusal(409, 'This upload is not complete.', 'upload_incomplete', {
      receivedBytes: session.receivedBytes,
    });
  }
  const verifying = await writeSession(ctx, { ...session, state: 'verifying', code: null });
  startJob(ctx, id, () => finish(ctx, id));
  return publicView(verifying);
}

/** A background job never kills the process: what it throws becomes the upload's state. */
export function startJob(ctx, id, job) {
  if (ctx.jobs.has(id)) return;
  const run = job()
    .catch((error) => recordFailed(ctx, id, error))
    .catch(() => undefined)
    .finally(() => ctx.jobs.delete(id));
  ctx.jobs.set(id, run);
}

/** Every background job settled (a test seam, and a clean shutdown). */
export async function idle(ctx) {
  while (ctx.jobs.size > 0) await Promise.all([...ctx.jobs.values()]);
}

/** The check runs OUTSIDE the upload's queue and the lock; what follows it runs inside. */
async function finish(ctx, id) {
  const session = await readSession(ctx, id);
  if (!session) return;
  const skip = session.verified || parseBackupFilename(session.filename)?.encrypted;
  const ok = skip ? true : await ctx.verify(bytesPath(ctx, id));
  await serialize(ctx, id, () => afterCheck(ctx, id, ok));
}

async function afterCheck(ctx, id, ok) {
  const session = await readSession(ctx, id);
  // Delete all during the check took the whole folder: nothing is written back.
  if (!session) return;
  // The bytes alone went (a Cancel cannot: it refuses `verifying`): the upload is gone.
  if (!(await exists(bytesPath(ctx, id)))) return removeSession(ctx, id);
  if (!ok) {
    await writeSession(ctx, {
      ...session,
      state: 'failed',
      code: 'upload_corrupt',
      error: 'Uploaded backup failed integrity check (corrupt or truncated gzip).',
    });
    await rm(bytesPath(ctx, id), { force: true });
    return;
  }
  await stage(ctx, { ...session, state: 'receiving', verified: true });
}

/**
 * Under the ops lock: `staging` (with its target) BEFORE the move and `staged` after it, so a
 * crash between the two is recovered from the mark. A busy lock keeps the state with `ops_busy`:
 * the screen asks again.
 */
async function stage(ctx, session) {
  try {
    await ctx.withLock(async () => {
      const target = stagedPath(ctx.rootDir, session.filename);
      const staging = { ...session, state: 'staging', target, code: null };
      await writeSession(ctx, staging);
      const source = bytesPath(ctx, session.id);
      const { backup } = await stageUpload(ctx.rootDir, session.filename, source);
      await writeSession(ctx, { ...staging, state: 'staged', backup });
    });
  } catch (error) {
    if (!(error instanceof OpsLockBusyError)) throw error;
    await writeSession(ctx, { ...session, code: OPS_BUSY_CODE });
  }
}

/** A `staging` mark left by a crash: finished, moved again, or gone. */
export function recover(ctx, id) {
  return serialize(ctx, id, async () => {
    const session = await readSession(ctx, id);
    if (session?.state !== 'staging') return;
    if (await exists(bytesPath(ctx, id))) return stage(ctx, session);
    if (await exists(stagedPath(ctx.rootDir, session.filename))) {
      const timestamp = parseBackupFilename(session.filename).timestamp;
      const backup = await nightSet(ctx.rootDir, timestamp);
      await writeSession(ctx, { ...session, state: 'staged', code: null, backup });
      return;
    }
    const error = gone().message;
    await writeSession(ctx, { ...session, state: 'failed', code: 'upload_gone', error });
  });
}

/**
 * A `staging` upload stays for its recovery (the screen posts `complete` again). Any other becomes
 * `failed` with `upload_failed`, its bytes KEPT: the fault was not the file's (a lock file that
 * could not be written, too many open files), and the same file started again resumes it.
 */
function recordFailed(ctx, id, error) {
  return serialize(ctx, id, async () => {
    const session = await readSession(ctx, id);
    if (!session || session.state === 'staging') return;
    const message = error instanceof Error ? error.message : 'Upload failed.';
    await writeSession(ctx, { ...session, state: 'failed', code: FAILED_CODE, error: message });
  });
}
