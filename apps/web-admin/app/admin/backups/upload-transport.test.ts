import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupUploadTransport, fileFingerprint } from './upload-transport';

/**
 * The loop reads the ops runner's numbers through the same `ApiFailure` the screen gets: the
 * offset to resume from rides in a real problem+json body, one level under `details`.
 */
afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

describe('the upload transport', () => {
  it('reads an out-of-order refusal with the offset to resume from', async () => {
    const fetch = vi.fn().mockResolvedValue(
      answer(409, {
        type: 'about:blank',
        status: 409,
        detail: 'This chunk is out of order.',
        code: 'upload_out_of_order',
        details: { receivedBytes: 8 },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await backupUploadTransport('http://api.test').sendChunk(
      'u1',
      0,
      new Blob(['abcd']),
    );
    expect(result).toMatchObject({
      ok: false,
      kind: 'http',
      status: 409,
      code: 'upload_out_of_order',
      details: { receivedBytes: 8 },
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/admin/backups/uploads/u1/chunks?offset=0');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('fingerprints the first MiB of the file, as the server checks it', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 5).map((_, i) => i % 253);
    const expected = createHash('sha256')
      .update(bytes.subarray(0, 1024 * 1024))
      .digest('hex');
    expect(await fileFingerprint(new Blob([bytes]))).toBe(expected);
  });
});
