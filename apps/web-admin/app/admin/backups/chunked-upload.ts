import type { ApiFailure, ApiResult } from '@myclash/api-client';

/**
 * A backup file uploaded in chunks (rulings 212, 216, 219). Traefik reads a request body for 60 s
 * at most, so a file of up to 2 GB goes as many small requests; the ops runner holds where the
 * upload is, and this loop follows it:
 *
 * - each chunk is sized to take about 20 s (1 MiB to the server's maximum), and halved after one
 *   that failed in transit: a slow uplink still never meets the 60 s cut;
 * - a failure in transit (no answer, a 5xx, a 408, a 429 — a restore stops the API for minutes)
 *   is retried with a growing pause, after asking the server where the upload is; ten minutes
 *   without one answer, or without a byte more on the server, ends the upload;
 * - a chunk the server did not expect (`upload_out_of_order`, a lost answer) resumes from the
 *   offset the server names; nothing is sent twice;
 * - after the last chunk, `complete`: the server checks the file, then keeps it as its night.
 *   A held lock (`ops_busy`) or a restarted server (`receiving` with every byte) posts `complete`
 *   again; so does a check or a move that reads the same for too long.
 *
 * Pure: the transport, the clock and the abort signal are handed in (`upload-transport.ts`).
 */
export type UploadState = 'receiving' | 'verifying' | 'staging' | 'staged' | 'failed';

export interface UploadSession {
  uploadId: string;
  filename: string;
  sizeBytes: number;
  receivedBytes: number;
  maxChunkBytes: number;
  state: UploadState;
  code: string | null;
  error?: string;
  backup?: unknown;
}

export interface UploadTransport {
  start(input: {
    filename: string;
    sizeBytes: number;
    fingerprint: string;
  }): Promise<ApiResult<UploadSession>>;
  status(uploadId: string): Promise<ApiResult<UploadSession>>;
  sendChunk(
    uploadId: string,
    offset: number,
    chunk: Blob,
  ): Promise<ApiResult<{ receivedBytes: number }>>;
  complete(uploadId: string): Promise<ApiResult<UploadSession>>;
}

export interface UploadClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export type UploadProgress =
  | { phase: 'sending'; sentBytes: number; totalBytes: number }
  | { phase: 'retrying'; sentBytes: number; totalBytes: number }
  | { phase: 'checking' }
  | { phase: 'waiting' };

export type UploadOutcome =
  { ok: true; session: UploadSession } | { ok: false; failure: ApiFailure };

export interface UploadOptions {
  clock: UploadClock;
  onProgress?: (progress: UploadProgress) => void;
  /** The server's id of this upload, once it has one: what Cancel removes. */
  onStart?: (uploadId: string) => void;
  signal?: AbortSignal;
}

const MIB = 1024 * 1024;
export const UPLOAD_TIMING = {
  firstChunkBytes: 4 * MIB,
  minChunkBytes: MIB,
  chunkTargetMs: 20_000,
  firstBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  giveUpMs: 10 * 60_000,
  pollMs: 2_000,
  busyMs: 5_000,
  stagingAgainMs: 10_000,
  verifyingAgainMs: 30_000,
} as const;

interface Run extends UploadOptions {
  lastAnswer: number;
}

const ABORTED: UploadOutcome = { ok: false, failure: { kind: 'aborted' } };

export async function uploadInChunks(
  file: Blob,
  start: { filename: string; fingerprint: string },
  transport: UploadTransport,
  options: UploadOptions,
): Promise<UploadOutcome> {
  const run: Run = { ...options, lastAnswer: options.clock.now() };
  const started = await call(run, () =>
    transport.start({
      filename: start.filename,
      sizeBytes: file.size,
      fingerprint: start.fingerprint,
    }),
  );
  if (!started.ok) return failed(started);
  run.onStart?.(started.data.uploadId);
  const sent = await sendAll(run, transport, file, started.data);
  if (sent) return sent;
  return finish(run, transport, started.data.uploadId);
}

/** No answer, or an answer that says "try again": the server, the API or the edge is away. */
export function inTransit(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;
  if (result.kind === 'network') return true;
  return (
    result.kind === 'http' &&
    (result.status >= 500 || result.status === 408 || result.status === 429)
  );
}

function failed(result: { ok: false } & ApiFailure): UploadOutcome {
  const { ok: _ok, ...failure } = result;
  return { ok: false, failure };
}

/** One call, retried while it fails in transit, until ten minutes pass without an answer. */
async function call<T>(run: Run, request: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  let pause: number = UPLOAD_TIMING.firstBackoffMs;
  for (;;) {
    if (run.signal?.aborted) return { ok: false, kind: 'aborted' };
    const result = await request();
    if (!inTransit(result)) {
      if (result.ok) run.lastAnswer = run.clock.now();
      return result;
    }
    if (run.clock.now() - run.lastAnswer > UPLOAD_TIMING.giveUpMs) return result;
    await run.clock.sleep(pause, run.signal);
    pause = Math.min(pause * 2, UPLOAD_TIMING.maxBackoffMs);
  }
}

function report(run: Run, progress: UploadProgress): void {
  run.onProgress?.(progress);
}

/** @returns null when every byte is on the server, else the outcome that ended the upload. */
async function sendAll(
  run: Run,
  transport: UploadTransport,
  file: Blob,
  session: UploadSession,
): Promise<UploadOutcome | null> {
  const total = file.size;
  let offset = session.receivedBytes;
  let size = Math.min(UPLOAD_TIMING.firstChunkBytes, session.maxChunkBytes);
  let pause: number = UPLOAD_TIMING.firstBackoffMs;
  // Ten minutes without a byte more on the server ends it, even while the server answers: a
  // chunk that fails every time (a full disk, a file changed since it was picked) never ends.
  let progressAt = run.clock.now();
  while (offset < total) {
    report(run, { phase: 'sending', sentBytes: offset, totalBytes: total });
    if (run.signal?.aborted) return ABORTED;
    const chunk = file.slice(offset, offset + size);
    const began = run.clock.now();
    const result = await transport.sendChunk(session.uploadId, offset, chunk);
    if (result.ok) {
      run.lastAnswer = run.clock.now();
      size = nextChunkSize(chunk.size, run.lastAnswer - began, session.maxChunkBytes);
      if (result.data.receivedBytes > offset) progressAt = run.lastAnswer;
      offset = result.data.receivedBytes;
      pause = UPLOAD_TIMING.firstBackoffMs;
      continue;
    }
    const resumeAt = outOfOrderOffset(result);
    if (resumeAt !== null) {
      offset = resumeAt;
      continue;
    }
    if (!inTransit(result)) return failed(result);
    if (run.clock.now() - progressAt > UPLOAD_TIMING.giveUpMs) return failed(result);
    // Cut in transit: a smaller chunk next, and the offset the server holds.
    size = Math.max(UPLOAD_TIMING.minChunkBytes, Math.floor(size / 2));
    report(run, { phase: 'retrying', sentBytes: offset, totalBytes: total });
    await run.clock.sleep(pause, run.signal);
    pause = Math.min(pause * 2, UPLOAD_TIMING.maxBackoffMs);
    const where = await call(run, () => transport.status(session.uploadId));
    if (!where.ok) return failed(where);
    if (where.data.receivedBytes > offset) progressAt = run.clock.now();
    offset = where.data.receivedBytes;
  }
  // Every byte is on the server: from here it checks and keeps the file (no Cancel offered).
  report(run, { phase: 'checking' });
  return null;
}

/** About 20 s of the measured rate, between 1 MiB and the server's maximum. */
export function nextChunkSize(sentBytes: number, elapsedMs: number, maxBytes: number): number {
  const rate = sentBytes / Math.max(1, elapsedMs);
  const wanted = Math.floor(rate * UPLOAD_TIMING.chunkTargetMs);
  return Math.min(maxBytes, Math.max(UPLOAD_TIMING.minChunkBytes, wanted));
}

function outOfOrderOffset(result: ApiResult<unknown>): number | null {
  if (result.ok || result.kind !== 'http' || result.code !== 'upload_out_of_order') return null;
  const offset = result.details?.['receivedBytes'];
  return typeof offset === 'number' ? offset : null;
}

/** `complete`, then follow the check and the move until the night is kept, or failed. */
async function finish(
  run: Run,
  transport: UploadTransport,
  uploadId: string,
): Promise<UploadOutcome> {
  let posted = run.clock.now();
  let result = await call(run, () => transport.complete(uploadId));
  for (;;) {
    if (!result.ok) return failed(result);
    const session = result.data;
    if (session.state === 'staged') return { ok: true, session };
    if (session.state === 'failed') return { ok: false, failure: sessionFailure(session) };
    report(run, { phase: session.code === 'ops_busy' ? 'waiting' : 'checking' });
    const again = completeAgainIn(session, run.clock.now() - posted);
    await run.clock.sleep(again ?? UPLOAD_TIMING.pollMs, run.signal);
    if (run.signal?.aborted) return ABORTED;
    if (again === null) {
      result = await call(run, () => transport.status(uploadId));
    } else {
      posted = run.clock.now();
      result = await call(run, () => transport.complete(uploadId));
    }
  }
}

/** How long to wait before posting `complete` again, or null to read the state again. */
export function completeAgainIn(session: UploadSession, sincePostedMs: number): number | null {
  if (session.state === 'receiving') {
    return session.code === 'ops_busy' ? UPLOAD_TIMING.busyMs : 0;
  }
  if (session.state === 'staging' && sincePostedMs >= UPLOAD_TIMING.stagingAgainMs) return 0;
  if (session.state === 'verifying' && sincePostedMs >= UPLOAD_TIMING.verifyingAgainMs) return 0;
  return null;
}

/** A failed upload, read as the refusal the screen words (`upload_corrupt`, `upload_failed`). */
function sessionFailure(session: UploadSession): ApiFailure {
  return {
    kind: 'http',
    status: 409,
    detail: session.error ?? null,
    code: session.code,
    details: null,
    validationErrors: null,
  };
}
