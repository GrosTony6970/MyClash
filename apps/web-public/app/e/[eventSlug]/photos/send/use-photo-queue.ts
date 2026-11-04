'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { removed, retried, type QueueItem } from '@/lib/photos/photo-queue';
import type { PhotoFields } from '@/lib/photos/send-photo';
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
  eventId: string;
  token: string;
  t: Translate;
}

/**
 * The photos a phone picked, and the ONE loop that sends them (`sendQueued`).
 *
 * The race, named: the loop and a tap on Retry, Remove or a new pick all change the list. The
 * loop reads the list's ref at each turn, so a photo retried or picked during a run is sent in
 * that run, after the ones before it, with the fields of the latest tap (`fieldsRef`); the photo
 * on its way cannot be removed (`removed`). A Send or Retry while the loop runs starts no second
 * loop (`runningRef`). Leaving the page aborts the open send (`useLeavingSignal`).
 */
export function usePhotoQueue({ apiUrl, eventId, token, t }: QueueTarget) {
  const list = useQueueList(t);
  const { itemsRef, update } = list;
  const [running, setRunning] = useState(false);
  const [closedBy, setClosedBy] = useState<string | null>(null);
  const fieldsRef = useRef<PhotoFields>(NO_FIELDS);
  const runningRef = useRef(false);
  const leaving = useLeavingSignal();

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
        send: photoSender({ apiUrl, eventId, token, signal }),
        t,
        onClosed: setClosedBy,
      });
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [apiUrl, eventId, token, t, itemsRef, update, leaving]);

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
