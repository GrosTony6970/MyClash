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
 * One answer folded into the view. The key check (`q|weapon|page`) drops an answer for another
 * search or another page. It cannot tell two visits of the same search waiting on the same page
 * apart: the abort guard drops a late answer of the earlier visit. The two together keep any old
 * page out. A later page appends only the cards not already shown: someone who switches
 * FightBook on between two reads shifts the pages by one, and the next page would repeat a card
 * (and its React key).
 */
function withAnswer(view: View, search: string, page: number, answer: FindPage | 'failed'): View {
  if (view.search !== search || view.page !== page) return view;
  if (answer === 'failed') return { ...view, failed: true };
  const seen = new Set(view.items?.map((card) => card.fighter.globalPersonId));
  const added = answer.items.filter((card) => !seen.has(card.fighter.globalPersonId));
  const items = [...(view.items ?? []), ...added];
  return { ...view, answered: page, items, more: answer.more, failed: false };
}

/**
 * All of FightBook for the current search, page by page. Page 0 is read at once; `showMore` reads
 * the next while the last answer said `more`, and only once that answer is in.
 *
 * Every new name or weapon starts at page 0 with no list, a return to an earlier search too: the
 * view is kept with the search it belongs to, and a render that finds another search sets a fresh
 * view (React's "state from the previous render" pattern; that render is redone before anything
 * shows or reads). The race: Hugo taps "Show more", then types a name before that page answers.
 * Two guards: the new search aborts the read, and an aborted read writes nothing; an answer that
 * still lands for another search or page is checked against the view's own key and dropped.
 */
export function useFightBookBrowse(apiUrl: string, name: string, weapon: string) {
  const search = searchKey(name, weapon);
  const [view, setView] = useState<View>(() => fresh(search));
  const [attempt, setAttempt] = useState(0);
  if (view.search !== search) setView(fresh(search));
  const page = view.page;

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

  const loading = !view.failed && view.answered !== page;
  return {
    items: view.items,
    loading,
    failed: view.failed,
    more: !loading && !view.failed && view.more,
    showMore: () => setView((now) => ({ ...now, page: now.page + 1 })),
    retry: () => {
      setView((now) => ({ ...now, failed: false }));
      setAttempt((n) => n + 1);
    },
  };
}
