import { apiRequest } from '@myclash/api-client';
import type { UploadClock, UploadSession, UploadTransport } from './chunked-upload';

/**
 * The chunked upload's transport (`chunked-upload.ts`) over the API's `admin/backups/uploads`
 * routes, and what a browser adds: the file's fingerprint and the clock.
 */
const UPLOADS = '/api/v1/admin/backups/uploads';
const FINGERPRINT_BYTES = 1024 * 1024;

export function backupUploadTransport(apiUrl: string, signal?: AbortSignal): UploadTransport {
  return {
    start: (body) => apiRequest<UploadSession>(apiUrl, UPLOADS, { method: 'POST', body, signal }),
    status: (uploadId) => apiRequest<UploadSession>(apiUrl, `${UPLOADS}/${uploadId}`, { signal }),
    sendChunk: (uploadId, offset, chunk) => {
      // One file part: the API reads it as any upload (`read-upload.ts`) and sends it on raw.
      const form = new FormData();
      form.set('file', chunk, 'chunk');
      return apiRequest<{ receivedBytes: number }>(
        apiUrl,
        `${UPLOADS}/${uploadId}/chunks?offset=${offset}`,
        { method: 'PUT', body: form, signal },
      );
    },
    complete: (uploadId) =>
      apiRequest<UploadSession>(apiUrl, `${UPLOADS}/${uploadId}/complete`, {
        method: 'POST',
        signal,
      }),
  };
}

/** Cancel: what the server received goes. */
export function cancelBackupUpload(apiUrl: string, uploadId: string) {
  return apiRequest<unknown>(apiUrl, `${UPLOADS}/${uploadId}`, { method: 'DELETE' });
}

/**
 * sha-256 of the file's first MiB, hex: the server knows the same file picked again after a
 * reload, and resumes its upload (ruling 219).
 */
export async function fileFingerprint(file: Blob): Promise<string> {
  const head = await file.slice(0, FINGERPRINT_BYTES).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', head));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The browser's clock; a pause ends early when the upload is cancelled. */
export const browserClock: UploadClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
};
