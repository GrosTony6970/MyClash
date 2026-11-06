import { renewLogin, type ApiResult } from '@myclash/api-client';
import { sendRetryingBusy } from './busy-retry';
import { localRefusal, PHOTO_HEAD_BYTES } from './photo-checks';
import { keepsSending, nextWaiting, withState, type QueueItem } from './photo-queue';
import { localRefusalView, refusalView, type RefusalEnd } from './photo-refusal';
import { sendPhoto, type PhotoFields, type PhotoSent, type PhotoTarget } from './send-photo';

/**
 * The send loop of the phone page, outside React so its rules are tested without a browser. The
 * hook (`use-photo-queue.ts`) holds the state, starts at most one loop, and gives it these.
 */

type Translate = (key: string, values?: Record<string, string>) => string;

export interface SendQueueDeps {
  /** The list as it is NOW: a photo retried during the run is seen at the next turn. */
  items: () => readonly QueueItem[];
  update: (change: (items: QueueItem[]) => QueueItem[]) => void;
  /** Read for each photo: the fields of the latest Send or Retry tap. */
  fields: () => PhotoFields;
  send: (
    item: QueueItem,
    fields: PhotoFields,
    on: { progress: (fraction: number) => void; busy: () => void },
  ) => Promise<ApiResult<PhotoSent>>;
  t: Translate;
  onClosed: (message: string) => void;
  /** Said once for each photo the API took: a personal space then reads her photos again. */
  onSent?: () => void;
}

type SendEnd = RefusalEnd | 'sent' | 'aborted';

async function sendOne(item: QueueItem, deps: SendQueueDeps): Promise<SendEnd> {
  const at = (patch: Partial<QueueItem>) => deps.update((list) => withState(list, item.key, patch));
  at({ state: 'sending', progress: 0, message: null });
  const result = await deps.send(item, deps.fields(), {
    progress: (progress) => at({ state: 'sending', progress }),
    busy: () => at({ state: 'busy' }),
  });
  if (result.ok) {
    at({ state: 'sent', progress: 1, sent: result.data.status });
    deps.onSent?.();
    return 'sent';
  }
  // The page is leaving: nothing is left to show it to.
  if (result.kind === 'aborted') return 'aborted';
  const view = refusalView(result, deps.t);
  // Refused for its own bytes, a photo would be refused again: no Retry.
  at({ state: view.end === 'photo' ? 'refused' : 'failed', message: view.message });
  if (view.end === 'closed') deps.onClosed(view.message);
  return view.end;
}

/** Sends every waiting photo, one at a time, in pick order, until one ends the run. */
export async function sendQueued(deps: SendQueueDeps): Promise<void> {
  for (let item = nextWaiting(deps.items()); item; item = nextWaiting(deps.items())) {
    const end = await sendOne(item, deps);
    if (end === 'aborted' || !keepsSending(end)) return;
  }
}

/** A pause that the page leaving also ends. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Her login has run out (it lasts an hour): `/me` can renew it. A 403 is an answer. */
const loginLapsed = (result: ApiResult<PhotoSent>) =>
  !result.ok && result.kind === 'unauthenticated' && result.status === 401;

/**
 * The real send of one photo: the XHR, retried on its own while the API is busy. From a personal
 * space, a login over an hour old is renewed once and the photo sent once more, as `apiRequest`
 * does for every other request (`renew-login.ts`); the QR link needs no login.
 */
export function photoSender(
  to: { apiUrl: string; target: PhotoTarget; signal: AbortSignal },
  renew: (apiUrl: string) => Promise<boolean> = renewLogin,
): SendQueueDeps['send'] {
  return async (item, fields, on) => {
    const { apiUrl, target, signal } = to;
    const once = () =>
      sendRetryingBusy(
        () =>
          sendPhoto({ apiUrl, target, file: item.file, fields, onProgress: on.progress, signal }),
        { wait: (ms) => pause(ms, signal), random: Math.random, onBusy: on.busy },
      );
    const result = await once();
    if (target.kind === 'qr' || !loginLapsed(result)) return result;
    return (await renew(apiUrl)) ? once() : result;
  };
}

export async function headOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, PHOTO_HEAD_BYTES).arrayBuffer());
}

/**
 * The picked files as queue items, keyed from `firstKey` in pick order. A file the phone cannot
 * read (a photo kept only in the cloud) gets its own refused row; the others are kept.
 */
export async function pickedItems(
  files: readonly File[],
  firstKey: number,
  t: Translate,
  readHead: (file: File) => Promise<Uint8Array> = headOf,
): Promise<QueueItem[]> {
  return Promise.all(
    files.map(async (file, index): Promise<QueueItem> => {
      const base = { key: firstKey + index, file, progress: 0, sent: null };
      let head: Uint8Array;
      try {
        head = await readHead(file);
      } catch {
        return { ...base, state: 'refused', message: t('publicApp.photoSend.unreadable') };
      }
      const refusal = localRefusal(file.size, head);
      return refusal
        ? { ...base, state: 'refused', message: localRefusalView(refusal, t).message }
        : { ...base, state: 'waiting', message: null };
    }),
  );
}
