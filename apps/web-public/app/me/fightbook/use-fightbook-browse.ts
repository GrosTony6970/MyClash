'use client';

import { useEffect, useState } from 'react';
import type { FindCard, FindPage } from '@myclash/types';
import { readFindBrowse } from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';

/** The name box waits this long after the last key before it reads. */
export const NAME_DEBOUNCE_MS = 250;

/** The name the box asks for, once typing pauses. Under 2 letters it narrows nothing: everyone. */
export function useNameFilter(text: string): string {
  const [name, setName] = useState('');
  useEffect(() => {
    const trimmed = text.trim();
    const timer = setTimeout(() => setName(trimmed.length >= 2 ? trimmed : ''), NAME_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return name;
}

interface Shown {
  page: number;
  items: FindCard[];
  more: boolean;
}

/**
 * A later page appends only the cards not already shown: someone who switches FightBook on between
 * two reads shifts the pages by one, and the next page would repeat a card (and its React key).
 */
function appendPage(shown: Shown | null, page: number, answer: FindPage): Shown {
  const seen = new Set(shown?.items.map((card) => card.fighter.globalPersonId));
  const added = answer.items.filter((card) => !seen.has(card.fighter.globalPersonId));
  return { page, items: [...(shown?.items ?? []), ...added], more: answer.more };
}

/**
 * All of FightBook for one search (a name and a weapon), page by page. Page 0 is read at once;
 * `showMore` reads the next while the last answer said `more`.
 *
 * One search per mount: the caller keys the component that holds this hook by `name|weapon`, so a
 * new name or weapon starts again at page 0 with an empty list. The race: Hugo taps "Show more",
 * then types a name before that page answers. The unmount aborts the read, and an aborted read
 * writes nothing, so a page of the old search never lands under the new one (key `q|weapon|page`).
 * Within one search "Show more" is offered only once the last page has answered.
 */
export function useFightBookBrowse(apiUrl: string, name: string, weapon: string) {
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readFindBrowse(apiUrl, name, weapon, page, controller.signal).then((read) => {
      if (controller.signal.aborted || read.kind === 'aborted') return;
      if (read.kind === 'signin') return signInAgainHere();
      if (read.kind === 'failed') return setFailed(true);
      setShown((now) => appendPage(now, page, read.data));
    });
    return () => controller.abort();
  }, [apiUrl, name, weapon, page, attempt]);

  const loading = !failed && shown?.page !== page;
  return {
    items: shown?.items ?? null,
    loading,
    failed,
    more: !loading && !failed && shown?.more === true,
    showMore: () => setPage((now) => now + 1),
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}
