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

/** What one search (a name and a weapon) has shown: pages 0 to `answered`, and `page` asked for. */
interface View {
  search: string;
  page: number;
  answered: number;
  items: FindCard[] | null;
  more: boolean;
  failed: boolean;
}

const searchKey = (name: string, weapon: string) => `${name}|${weapon}`;
const fresh = (search: string): View => ({
  search,
  page: 0,
  answered: -1,
  items: null,
  more: false,
  failed: false,
});

/**
 * One answer folded into the view. An answer of another search starts the view again (page 0 of a
 * new search lands on an empty view). A later page appends only the cards not already shown:
 * someone who switches FightBook on between two reads shifts the pages by one, and the next page
 * would repeat a card (and its React key).
 */
function withAnswer(view: View, search: string, page: number, answer: FindPage | 'failed'): View {
  const base = view.search === search ? view : fresh(search);
  if (answer === 'failed') return { ...base, page, failed: true };
  const seen = new Set(base.items?.map((card) => card.fighter.globalPersonId));
  const added = answer.items.filter((card) => !seen.has(card.fighter.globalPersonId));
  const items = [...(base.items ?? []), ...added];
  return { ...base, page, answered: page, items, more: answer.more, failed: false };
}

/**
 * All of FightBook for the current search, page by page. Page 0 is read at once; `showMore` reads
 * the next while the last answer said `more`, and only once that answer is in.
 *
 * The view is kept with the search it shows. A new name or weapon finds a view of another search,
 * so it starts at page 0 with no list (no set-state needed: the view of the old search is simply
 * not the current one). The race: Hugo taps "Show more", then types a name before that page
 * answers. The new search aborts the read, and an aborted read writes nothing (key
 * `q|weapon|page`): written, that old page would replace the new search's view.
 */
export function useFightBookBrowse(apiUrl: string, name: string, weapon: string) {
  const search = searchKey(name, weapon);
  const [view, setView] = useState<View>(() => fresh(search));
  const [attempt, setAttempt] = useState(0);
  const current = view.search === search ? view : fresh(search);
  const page = current.page;

  useEffect(() => {
    const controller = new AbortController();
    void readFindBrowse(apiUrl, name, weapon, page, controller.signal).then((read) => {
      if (controller.signal.aborted || read.kind === 'aborted') return;
      if (read.kind === 'signin') return signInAgainHere();
      const answer = read.kind === 'data' ? read.data : 'failed';
      setView((now) => withAnswer(now, searchKey(name, weapon), page, answer));
    });
    return () => controller.abort();
  }, [apiUrl, name, weapon, page, attempt]);

  const loading = !current.failed && current.answered !== page;
  const sameSearch = (change: (view: View) => View) =>
    setView((now) => (now.search === search ? change(now) : now));
  return {
    items: current.items,
    loading,
    failed: current.failed,
    more: !loading && !current.failed && current.more,
    showMore: () => sameSearch((now) => ({ ...now, page: now.page + 1 })),
    retry: () => {
      sameSearch((now) => ({ ...now, failed: false }));
      setAttempt((n) => n + 1);
    },
  };
}
