import { responseFailure, type ApiResult } from '@myclash/api-client';

/**
 * One photo sent to `POST events/:eventId/photos`, from the Event's QR link, or to
 * `POST me/events/:eventId/photos`, from her personal space under her login (slice 6b).
 *
 * Through `XMLHttpRequest`, not `apiRequest`: `fetch` reports no upload progress, and the page
 * shows each photo's. The answer is still read the way `apiRequest` reads one, through
 * `responseFailure`, so the page speaks it with `failureMessage` like every other screen. (The
 * no-raw-fetch lint rule looks for `fetch`, not for this.)
 *
 * The QR token goes in the `x-photo-token` header only. A URL reaches the access log; a header
 * does not.
 */

export type PhotoTag = { kind: 'tournament' | 'workshop'; id: string };
/** Where a photo goes: the QR link's route with its token, or her own Event's, with her login. */
export type PhotoTarget =
  { kind: 'qr'; eventId: string; token: string } | { kind: 'account'; eventId: string };
export interface PhotoFields {
  name: string;
  caption: string;
  tag: PhotoTag | null;
}
export interface PhotoSent {
  id: string;
  status: 'waiting' | 'approved';
}

/**
 * The page's own cut. Traefik cuts a request at 60 s in production (ruling 429); this one is for
 * the hosts with no proxy in front, so that no photo waits forever.
 */
export const SEND_TIMEOUT_MS = 120_000;

function formOf(file: File, fields: PhotoFields): FormData {
  const form = new FormData();
  if (fields.name.trim()) form.append('name', fields.name.trim());
  if (fields.caption.trim()) form.append('caption', fields.caption.trim());
  if (fields.tag) {
    form.append(fields.tag.kind === 'tournament' ? 'tournamentId' : 'workshopId', fields.tag.id);
  }
  form.append('file', file);
  return form;
}

function parsed(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** The answer of a request that completed, read as `apiRequest` reads one. */
function resultOf(xhr: XMLHttpRequest): ApiResult<PhotoSent> {
  const body = parsed(xhr.responseText);
  const ok = xhr.status >= 200 && xhr.status < 300;
  if (ok)
    return body === undefined
      ? { ok: false, kind: 'network' }
      : { ok: true, data: body as PhotoSent };
  return { ok: false, ...responseFailure(xhr.status, body) };
}

/** Opens the request to the target's route; the QR token rides in its header. */
function openFor(xhr: XMLHttpRequest, apiUrl: string, target: PhotoTarget): void {
  const event = encodeURIComponent(target.eventId);
  switch (target.kind) {
    case 'qr':
      xhr.open('POST', `${apiUrl}/api/v1/events/${event}/photos`);
      xhr.setRequestHeader('x-photo-token', target.token);
      return;
    case 'account':
      xhr.open('POST', `${apiUrl}/api/v1/me/events/${event}/photos`);
      return;
  }
}

/** Never rejects: every way a send ends is a value. */
export function sendPhoto(input: {
  apiUrl: string;
  target: PhotoTarget;
  file: File;
  fields: PhotoFields;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}): Promise<ApiResult<PhotoSent>> {
  if (input.signal.aborted) return Promise.resolve({ ok: false, kind: 'aborted' });
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const settle = (result: ApiResult<PhotoSent>) => {
      input.signal.removeEventListener('abort', abort);
      resolve(result);
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) input.onProgress(event.loaded / event.total);
    };
    xhr.onload = () => settle(resultOf(xhr));
    xhr.onerror = () => settle({ ok: false, kind: 'network' });
    xhr.ontimeout = () => settle({ ok: false, kind: 'network' });
    xhr.onabort = () => settle({ ok: false, kind: 'aborted' });
    // `open`, a header and `send` can each throw at once (a bad URL, a value no header may hold):
    // that photo did not leave, which is what a lost connection says.
    try {
      openFor(xhr, input.apiUrl, input.target);
      xhr.withCredentials = true;
      xhr.timeout = SEND_TIMEOUT_MS;
      input.signal.addEventListener('abort', abort);
      xhr.send(formOf(input.file, input.fields));
    } catch {
      settle({ ok: false, kind: 'network' });
    }
  });
}
