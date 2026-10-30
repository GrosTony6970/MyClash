import { vi, type Mock } from 'vitest';

/**
 * A multipart request for the upload door tests (`upload-limits.*.test.ts`): signed in as `USER`
 * (or signed out, given `null`), carrying a file the plugin has found too large. `file` and
 * `parts` record the options the reader passed; the file's `toBuffer` rejects as
 * @fastify/multipart does past `fileSize`.
 *
 * Both readers sit here as properties, so the upload source guard (`read-upload.guard.test.ts`)
 * has nothing to find in this file.
 */

const USER = '11111111-1111-4111-8111-111111111111';
export const EVENT = '22222222-2222-4222-8222-222222222222';
export const ORG = '33333333-3333-4333-8333-333333333333';

export interface UploadRequest {
  req: never;
  file: Mock;
  parts: Mock;
}

const tooLarge = (): Promise<never> =>
  Promise.reject(
    Object.assign(new Error('request file too large'), {
      code: 'FST_REQ_FILE_TOO_LARGE',
      statusCode: 413,
    }),
  );

export function tooLargeUpload(user: string | null = USER): UploadRequest {
  const part = {
    type: 'file',
    fieldname: 'file',
    filename: 'probe-marker.json',
    mimetype: 'application/json',
    file: { resume: vi.fn() },
    toBuffer: tooLarge,
  };
  const file = vi.fn(async () => part);
  const parts = vi.fn(() =>
    (async function* () {
      yield part;
    })(),
  );
  const headers = user ? { authorization: `Bearer ${user}` } : {};
  return { req: { headers, cookies: {}, file, parts } as never, file, parts };
}

/** A service none of whose methods the door reaches: each resolves `undefined`. */
export function anyService(): never {
  return new Proxy(
    {},
    { get: (_target, key) => (key === 'then' ? undefined : vi.fn(async () => undefined)) },
  ) as never;
}

/** The auth service: a token is its own user id. */
export function authAs(service: unknown = {}): never {
  return { service, getAuthUser: vi.fn(async (token: string) => ({ id: token })) } as never;
}
