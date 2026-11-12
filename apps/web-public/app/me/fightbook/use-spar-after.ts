'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { SparReview } from '@myclash/types';
import { writeFightBook, type FightBookWrite } from '@/lib/fightbook/read-fightbook';
import { sparRefusalKey } from '@/lib/fightbook/refusal';
import { markedDone, noted, reviewed, undone } from './fightbook-patches';
import { useInFlight } from './use-in-flight';
import type { FightBookData } from './use-fightbook';

export interface AfterHandlers {
  onMarked: (id: string) => void;
  onUndone: (id: string) => void;
  onReviewed: (id: string, review: SparReview) => void;
  onNoted: (id: string, note: string | null) => void;
  /** A write found the page stale (`not_open`): read it again behind the page. */
  onStale: () => void;
}

/** The handlers that patch the page's data: one owner for the Tabs and the FightBook-off view. */
export const afterHandlers = (
  update: (change: Patch) => void,
  refresh: () => void,
): AfterHandlers => ({
  onMarked: (id) => update(markedDone(id)),
  onUndone: (id) => update(undone(id)),
  onReviewed: (id, review) => update(reviewed(id, review)),
  onNoted: (id, note) => update(noted(id, note)),
  onStale: refresh,
});

type Patch = (data: FightBookData) => Partial<FightBookData>;

export interface ReviewInput {
  stars: number;
  text: string;
  anonymous: boolean;
}

/**
 * The four writes after a spar: mark, undo, review, note. Each is one request; a won one patches
 * the list from its own answer. A refusal is said, and `not_open` (a window that closed while the
 * page was open, or a lost race) also reads the page again, so the card shows what is true now.
 * A card's buttons are disabled while its write runs.
 */
export function useSparAfter(apiUrl: string, id: string, on: AfterHandlers) {
  const { t } = useI18n();
  const { inFlight, run } = useInFlight();
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Whether the write won. */
  const send = async (
    write: () => Promise<FightBookWrite<unknown>>,
    won: () => void,
  ): Promise<boolean> => {
    setRefusal(null);
    const res = await run(id, write);
    if (res.ok) {
      won();
      return true;
    }
    if (res.code === 'not_open') on.onStale();
    setRefusal(t(sparRefusalKey(res.code)));
    return false;
  };
  const mark = () =>
    send(
      () => writeFightBook(apiUrl, `/api/v1/me/fightbook/requests/${id}/done`, 'POST'),
      () => on.onMarked(id),
    );
  const undo = () =>
    send(
      () => writeFightBook(apiUrl, `/api/v1/me/fightbook/requests/${id}/undo`, 'POST'),
      () => on.onUndone(id),
    );
  const review = ({ stars, text, anonymous }: ReviewInput) => {
    // No `text` key when anonymous or empty: the API refuses an empty string.
    const words = anonymous ? '' : text.trim();
    const body = words ? { stars, anonymous, text: words } : { stars, anonymous };
    return send(
      () => writeFightBook(apiUrl, `/api/v1/me/fightbook/requests/${id}/review`, 'POST', body),
      () => on.onReviewed(id, { stars, anonymous, text: words || null }),
    );
  };
  const note = (text: string) => {
    const body = text.trim() || null;
    return send(
      () => writeFightBook(apiUrl, `/api/v1/me/fightbook/requests/${id}/note`, 'PUT', { body }),
      () => on.onNoted(id, body),
    );
  };
  return { mark, undo, review, note, busy: inFlight(id), refusal };
}
