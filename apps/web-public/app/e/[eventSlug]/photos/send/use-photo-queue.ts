'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { removed, retried, type QueueItem } from '@/lib/photos/photo-queue';
import type { PhotoFields, PhotoTarget } from '@/lib/photos/send-photo';
import { photoSender, pickedItems, sendQueued } from '@/lib/photos/send-queue';

type Translate = (key: string, values?: Record<string, string>) => string;

const NO_FIELDS: PhotoFields = { name: '', caption: '', tag: null };

/**
 * The list of photos picked. Every change goes through `update`, which writes the ref and the
 * state together, so the send loop, reading the ref, always sees the list as it is now.
 */
function useQueueList(t: Translate) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  const nextKey = useRef(0);

  const update = useCallback((change: (items: QueueItem[]) => QueueItem[]) => {
    itemsRef.current = change(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const add = useCallback(
    async (files: File[]) => {
      // Keys are taken before any read: they are the pick order, whichever read ends first.
      const firstKey = nextKey.current + 1;
      nextKey.current += files.length;
      const picked = await pickedItems(files, firstKey, t);
      update((list) => [...list, ...picked]);
    },
    [t, update],
  );

  const remove = (key: number) => update((list) => removed(list, key));
  const markRetried = (key: number) => update((list) => retried(list, key));
  return { items, itemsRef, update, add, remove, markRetried };
}

/** The page's leaving, as a signal: Strict Mode's second mount gets a fresh controller. */
function useLeavingSignal() {
  const leaving = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, []);
  return leaving;
}

interface QueueTarget {
  apiUrl: string;
  target: PhotoTarget;
  t: Translate;
  /** Said once for each photo the API took. */
  onSent?: () => void;
}

/** The same target object while its values stay: a caller's inline object makes no new loop. */
function useStableTarget(target: PhotoTarget): PhotoTarget {
  const { kind, eventId } = target;
  const token = target.kind === 'qr' ? target.token : '';
  return useMemo((): PhotoTarget => {
    switch (kind) {
      case 'qr':
        return { kind, eventId, token };
      case 'account':
        return { kind, eventId };
    }
  }, [kind, eventId, token]);
}

/** The latest `onSent`, so a new callback each render does not make a new loop. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/**
 * The photos a phone picked, and the ONE loop that sends them (`sendQueued`).
 *
 * The race, named: the loop and a tap on Retry, Remove or a new pick all change the list. The
 * loop reads the list's ref at each turn, so a photo retried or picked during a run is sent in
 * that run, after the ones before it, with the fields of the latest tap (`fieldsRef`); the photo
 * on its way cannot be removed (`removed`). A Send or Retry while the loop runs starts no second
 * loop (`runningRef`). Leaving the page aborts the open send (`useLeavingSignal`). The target
 * is read when a run starts: the QR page's token, or her own Event (slice 6b).
 */
export function usePhotoQueue({ apiUrl, target, t, onSent }: QueueTarget) {
  const list = useQueueList(t);
  const { itemsRef, update } = list;
  const [running, setRunning] = useState(false);
  const [closedBy, setClosedBy] = useState<string | null>(null);
  const fieldsRef = useRef<PhotoFields>(NO_FIELDS);
  const runningRef = useRef(false);
  const leaving = useLeavingSignal();
  const sentRef = useLatest(onSent);
  const to = useStableTarget(target);

  const run = useCallback(async () => {
    const signal = leaving.current?.signal;
    if (runningRef.current || !signal) return;
    runningRef.current = true;
    setRunning(true);
    try {
      await sendQueued({
        items: () => itemsRef.current,
        update,
        fields: () => fieldsRef.current,
        send: photoSender({ apiUrl, target: to, signal }),
        t,
        onClosed: setClosedBy,
        onSent: () => sentRef.current?.(),
      });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [apiUrl, to, t, itemsRef, update, leaving, sentRef]);

  const start = (fields: PhotoFields) => {
    fieldsRef.current = fields;
    void run();
  };
  return {
    items: list.items,
    running,
    closedBy,
    add: list.add,
    remove: list.remove,
    send: start,
    retry: (key: number, fields: PhotoFields) => {
      list.markRetried(key);
      start(fields);
    },
  };
}
