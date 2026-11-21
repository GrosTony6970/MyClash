'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * The piste this tablet has open, and how many other tablets the server heard
 * from on it lately (ruling 953: two tablets on one piste warn both sides).
 *
 * The check-in (`useHeartbeat`) sends the piste and gets the count back; the
 * banner reads it. The race: a check-in sent from piste A may be answered after
 * the referee opened piste B. So the count is kept WITH the piste it was asked
 * for, and a count of another piste reads as none.
 */
let openPiste: string | null = null;
let report: { liceId: string | null; others: number } = { liceId: null, others: 0 };
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());
/** Told of a new open piste only, not of a count: the check-in sends at once on it. */
const pisteListeners = new Set<() => void>();

export function setOpenPiste(liceId: string | null): void {
  if (openPiste === liceId) return;
  openPiste = liceId;
  tell();
  pisteListeners.forEach((listener) => listener());
}

export function onOpenPisteChange(listener: () => void): () => void {
  pisteListeners.add(listener);
  return () => pisteListeners.delete(listener);
}

/** The piste a check-in sends now. */
export function openPisteId(): string | null {
  return openPiste;
}

/** What the server answered to a check-in sent from `liceId`. */
export function noteOtherTablets(liceId: string | null, others: number): void {
  if (report.liceId === liceId && report.others === others) return;
  report = { liceId, others };
  tell();
}

/** Other tablets on the piste open now; 0 while the server has said nothing of it. */
export function otherTablets(): number {
  return openPiste !== null && report.liceId === openPiste ? report.others : 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOtherTablets(): number {
  return useSyncExternalStore(subscribe, otherTablets, () => 0);
}

/** A screen of one piste: the bout screen, the piste's list. */
export function useOpenPiste(liceId: string | null | undefined): void {
  useEffect(() => {
    setOpenPiste(liceId ?? null);
    return () => setOpenPiste(null);
  }, [liceId]);
}
