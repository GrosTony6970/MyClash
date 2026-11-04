import type { RefusalEnd } from './photo-refusal';
import type { PhotoSent } from './send-photo';

/**
 * The photos a phone has picked, as plain transitions. The page's hook holds them in React state
 * and runs the one send loop; every change goes through here, so the rules below are tested
 * without a browser.
 */

export interface QueueItem {
  /** Pick order. */
  key: number;
  file: File;
  /**
   * `refused`: refused for its own bytes, before sending or by the API, so a Retry would only be
   * refused again. `failed`: something passing (network, busy, a field); Retry may land.
   */
  state: 'refused' | 'waiting' | 'sending' | 'busy' | 'sent' | 'failed';
  /** 0 to 1, while sending. */
  progress: number;
  message: string | null;
  sent: PhotoSent['status'] | null;
}

/** The next photo to send: the first one waiting, in pick order. */
export function nextWaiting(items: readonly QueueItem[]): QueueItem | null {
  return items.find((item) => item.state === 'waiting') ?? null;
}

export function withState(
  items: readonly QueueItem[],
  key: number,
  patch: Partial<Omit<QueueItem, 'key' | 'file'>>,
): QueueItem[] {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

/** A failed photo waits to be sent again; any other is left as it is. */
export function retried(items: readonly QueueItem[], key: number): QueueItem[] {
  return items.map((item) =>
    item.key === key && item.state === 'failed'
      ? { ...item, state: 'waiting', progress: 0, message: null }
      : item,
  );
}

/** Off the list, unless it is on its way: the send in flight is not the list's to cancel. */
export function removed(items: readonly QueueItem[], key: number): QueueItem[] {
  const target = items.find((item) => item.key === key);
  if (!target || target.state === 'sending' || target.state === 'busy') return [...items];
  return items.filter((item) => item.key !== key);
}

/** Whether the loop goes on to the next photo after this one ended so. */
export function keepsSending(end: RefusalEnd | 'sent'): boolean {
  return end === 'sent' || end === 'photo';
}
