import type { ApiResult } from '@myclash/api-client';
import { describe, expect, it } from 'vitest';
import {
  UPLOAD_TIMING,
  completeAgainIn,
  nextChunkSize,
  uploadInChunks,
  type UploadSession,
  type UploadTransport,
} from './chunked-upload';

const MIB = 1024 * 1024;
const NAME = 'storage-20261030T030000Z.tar.gz';

type Answer<T> = ApiResult<T>;
const ok = <T>(data: T): Answer<T> => ({ ok: true, data });
const network: Answer<never> = { ok: false, kind: 'network' };
const http = (
  status: number,
  code: string | null,
  details: Record<string, unknown> | null = null,
) =>
  ({
    ok: false,
    kind: 'http',
    status,
    code,
    details,
    detail: code,
    validationErrors: null,
  }) as const;

type Fault = () => Answer<never> | 'took-it';
type Faults = Partial<Record<'start' | 'chunk' | 'status' | 'complete', Fault[]>>;
type FakeServer = UploadSession & {
  sent: number[];
  completes: number;
  afterComplete: Array<Partial<UploadSession>>;
};

function fakeClock() {
  const clock = {
    t: 0,
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.t += ms;
    },
  };
  return clock;
}

function fakeServer(size: number, received: number): FakeServer {
  return {
    uploadId: 'u1',
    filename: NAME,
    sizeBytes: size,
    receivedBytes: received,
    maxChunkBytes: 16 * MIB,
    state: 'receiving',
    code: null,
    sent: [],
    completes: 0,
    afterComplete: [],
  };
}

/**
 * The ops runner and the clock, faked together: a chunk takes `size / bytesPerMs` of clock time.
 * `faults` answers a call in its place (and may still let the server take the chunk).
 */
function world(size: number, options: { bytesPerMs?: number; received?: number } = {}) {
  const clock = fakeClock();
  const server = fakeServer(size, options.received ?? 0);
  const faults: Faults = {};
  const transport = fakeTransport(server, faults, (bytes) => {
    clock.t += bytes / (options.bytesPerMs ?? 10 * MIB);
  });
  return { clock, server, faults, transport };
}

function fakeTransport(
  server: FakeServer,
  faults: Faults,
  spend: (bytes: number) => void,
): UploadTransport {
  const fault = (kind: keyof Faults) => faults[kind]?.shift()?.();
  const view = (): UploadSession => {
    const { sent: _s, completes: _c, afterComplete: _a, ...session } = server;
    return { ...session };
  };
  const read = (kind: 'start' | 'status') => {
    const injected = fault(kind);
    return injected && injected !== 'took-it' ? injected : ok(view());
  };
  return {
    start: async () => read('start'),
    status: async () => read('status'),
    sendChunk: async (_id, offset, chunk) => {
      spend(chunk.size);
      const injected = fault('chunk');
      if (injected !== 'took-it' && injected !== undefined) return injected;
      if (offset !== server.receivedBytes) {
        return http(409, 'upload_out_of_order', { receivedBytes: server.receivedBytes });
      }
      server.sent.push(offset);
      server.receivedBytes = offset + chunk.size;
      return injected === 'took-it' ? network : ok({ receivedBytes: server.receivedBytes });
    },
    complete: async () => {
      server.completes += 1;
      const injected = fault('complete');
      if (injected && injected !== 'took-it') return injected;
      const next = server.afterComplete.shift();
      Object.assign(server, next ?? { state: 'staged', code: null, backup: { id: 'upload-x' } });
      return ok(view());
    },
  };
}

function file(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

async function upload(w: ReturnType<typeof world>, size: number, signal?: AbortSignal) {
  const phases: string[] = [];
  const outcome = await uploadInChunks(
    file(size),
    { filename: NAME, fingerprint: 'f'.repeat(64) },
    w.transport,
    {
      clock: w.clock,
      signal,
      onProgress: (progress) => phases.push(progress.phase),
    },
  );
  return { outcome, phases };
}

describe('uploadInChunks: the bytes', () => {
  it('sends every byte once, 4 MiB first, then chunks sized to the measured rate', async () => {
    const w = world(40 * MIB, { bytesPerMs: 0.5 * MIB });
    const { outcome } = await upload(w, 40 * MIB);
    expect(outcome.ok).toBe(true);
    expect(w.server.receivedBytes).toBe(40 * MIB);
    // 4 MiB at 0.5 MiB/ms → 20 s worth is far over the 16 MiB maximum.
    expect(w.server.sent).toEqual([0, 4 * MIB, 20 * MIB, 36 * MIB]);
  });

  it('a slow link gets chunks that take about 20 s', () => {
    // 4 MiB in 40 s (~0.8 Mbit/s): 2 MiB next.
    expect(nextChunkSize(4 * MIB, 40_000, 16 * MIB)).toBe(2 * MIB);
    expect(nextChunkSize(4 * MIB, 400_000, 16 * MIB)).toBe(MIB);
    expect(nextChunkSize(4 * MIB, 1, 16 * MIB)).toBe(16 * MIB);
  });

  it('resumes from the offset the server holds when the start finds the same file', async () => {
    const w = world(10 * MIB, { received: 8 * MIB });
    expect((await upload(w, 10 * MIB)).outcome.ok).toBe(true);
    expect(w.server.sent).toEqual([8 * MIB]);
  });

  it('a lost answer: asks where the upload is, and never sends a byte twice', async () => {
    const w = world(12 * MIB);
    w.faults.chunk = [() => 'took-it'];
    const { outcome, phases } = await upload(w, 12 * MIB);
    expect(outcome.ok).toBe(true);
    expect(new Set(w.server.sent).size).toBe(w.server.sent.length);
    expect(phases).toContain('retrying');
  });

  it('a chunk the server did not expect resumes from the offset it names', async () => {
    const w = world(8 * MIB, { received: 0 });
    // The start answered 0; another tab then sent the first chunk.
    const start = w.transport.start;
    w.transport.start = async (input) => {
      const answer = await start(input);
      w.server.receivedBytes = 4 * MIB;
      return answer;
    };
    expect((await upload(w, 8 * MIB)).outcome.ok).toBe(true);
    expect(w.server.sent).toEqual([4 * MIB]);
  });

  it('an outage (a restore stops the API): backs off, halves the chunk, then finishes', async () => {
    const w = world(20 * MIB);
    const down = () => http(502, null);
    w.faults.chunk = [() => 'took-it', down, down];
    w.faults.status = [() => network, () => network];
    const { outcome } = await upload(w, 20 * MIB);
    expect(outcome.ok).toBe(true);
    expect(w.server.receivedBytes).toBe(20 * MIB);
    // After the cut 4 MiB chunk, the next is at most half of it.
    expect(w.server.sent[1]).toBe(4 * MIB);
    expect((w.server.sent[2] ?? 0) - (w.server.sent[1] ?? 0)).toBeLessThanOrEqual(2 * MIB);
  });

  it('a 429 is waited out, not a refusal', async () => {
    const w = world(4 * MIB);
    w.faults.chunk = [() => http(429, 'TOO_MANY_REQUESTS')];
    expect((await upload(w, 4 * MIB)).outcome.ok).toBe(true);
  });

  it('gives up after ten minutes without one answer', async () => {
    const w = world(8 * MIB);
    w.faults.chunk = Array.from({ length: 100 }, () => () => network);
    w.faults.status = Array.from({ length: 100 }, () => () => network);
    const { outcome } = await upload(w, 8 * MIB);
    expect(outcome).toEqual({ ok: false, failure: { kind: 'network' } });
    expect(w.clock.t).toBeGreaterThan(UPLOAD_TIMING.giveUpMs);
    expect(w.clock.t).toBeLessThan(UPLOAD_TIMING.giveUpMs + 2 * UPLOAD_TIMING.maxBackoffMs);
  });

  it('gives up after ten minutes without a byte more, even while the server answers', async () => {
    // A full disk: every chunk is a 503, every status read is fine.
    const w = world(8 * MIB);
    w.faults.chunk = Array.from({ length: 200 }, () => () => http(503, null));
    const { outcome } = await upload(w, 8 * MIB);
    expect(outcome).toMatchObject({ ok: false, failure: { status: 503 } });
    expect(w.clock.t).toBeGreaterThan(UPLOAD_TIMING.giveUpMs);
    expect(w.clock.t).toBeLessThan(UPLOAD_TIMING.giveUpMs + 2 * UPLOAD_TIMING.maxBackoffMs);
  });

  it('a refusal at the start ends it at once: nothing is sent', async () => {
    const w = world(4 * MIB);
    w.faults.start = [() => http(413, 'file_too_large', { maxBytes: 2048 * MIB })];
    const { outcome } = await upload(w, 4 * MIB);
    expect(outcome).toMatchObject({ ok: false, failure: { status: 413, code: 'file_too_large' } });
    expect(w.server.sent).toEqual([]);
  });

  it('a cancel stops it before the next chunk', async () => {
    const w = world(40 * MIB);
    const cancel = new AbortController();
    const send = w.transport.sendChunk;
    w.transport.sendChunk = async (...args) => {
      cancel.abort();
      return send(...args);
    };
    const { outcome } = await upload(w, 40 * MIB, cancel.signal);
    expect(outcome).toEqual({ ok: false, failure: { kind: 'aborted' } });
    expect(w.server.sent).toEqual([0]);
  });
});

describe('uploadInChunks: the end', () => {
  it('follows the check until the night is kept', async () => {
    const w = world(4 * MIB);
    w.server.afterComplete = [{ state: 'verifying' }];
    const statusReads: string[] = [];
    const status = w.transport.status;
    w.transport.status = async (id) => {
      statusReads.push('read');
      if (statusReads.length === 2) Object.assign(w.server, { state: 'staged' });
      return status(id);
    };
    const { outcome, phases } = await upload(w, 4 * MIB);
    expect(outcome).toMatchObject({ ok: true, session: { state: 'staged' } });
    expect(phases).toContain('checking');
    expect(w.server.completes).toBe(1);
  });

  it('a held lock: waits, then posts complete again', async () => {
    const w = world(4 * MIB);
    w.server.afterComplete = [{ state: 'receiving', receivedBytes: 4 * MIB, code: 'ops_busy' }];
    const { outcome, phases } = await upload(w, 4 * MIB);
    expect(outcome.ok).toBe(true);
    expect(w.server.completes).toBe(2);
    expect(phases).toContain('waiting');
  });

  it('a corrupt file is the failure, with its code and the server sentence', async () => {
    const w = world(4 * MIB);
    w.server.afterComplete = [{ state: 'failed', code: 'upload_corrupt', error: 'corrupt' }];
    const { outcome } = await upload(w, 4 * MIB);
    expect(outcome).toEqual({
      ok: false,
      failure: {
        kind: 'http',
        status: 409,
        code: 'upload_corrupt',
        detail: 'corrupt',
        details: null,
        validationErrors: null,
      },
    });
  });

  it('posts complete again on a check or a move that reads the same for too long', () => {
    const at = (state: UploadSession['state'], code: string | null = null) =>
      ({ state, code, receivedBytes: 1, sizeBytes: 1 }) as UploadSession;
    expect(completeAgainIn(at('verifying'), UPLOAD_TIMING.verifyingAgainMs - 1)).toBeNull();
    expect(completeAgainIn(at('verifying'), UPLOAD_TIMING.verifyingAgainMs)).toBe(0);
    expect(completeAgainIn(at('staging'), UPLOAD_TIMING.stagingAgainMs - 1)).toBeNull();
    expect(completeAgainIn(at('staging'), UPLOAD_TIMING.stagingAgainMs)).toBe(0);
    expect(completeAgainIn(at('receiving', 'ops_busy'), 0)).toBe(UPLOAD_TIMING.busyMs);
    // A server that restarted during the check: every byte is there, complete again now.
    expect(completeAgainIn(at('receiving'), 0)).toBe(0);
  });

  it('a check that never ends is posted again, and its restart finishes the upload', async () => {
    const w = world(4 * MIB);
    w.server.afterComplete = [{ state: 'verifying' }];
    const { outcome } = await upload(w, 4 * MIB);
    expect(outcome.ok).toBe(true);
    expect(w.server.completes).toBe(2);
    expect(w.clock.t).toBeGreaterThanOrEqual(UPLOAD_TIMING.verifyingAgainMs);
  });
});
