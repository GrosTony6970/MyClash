'use client';

import { useEffect, useRef, useState } from 'react';
import type { FightBookRead } from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';

/** What one search has shown: pages 0 to `answered`, and `page` asked for. */
interface View<T> {
  search: string;
  page: number;
  answered: number;
  items: T[] | null;
  more: boolean;
  failed: boolean;
}

interface Paged<T> {
  items: T[];
  more: boolean;
}

const fresh = <T>(search: string): View<T> => ({
  search,
  page: 0,
  answered: -1,
  items: null,
  more: false,
  failed: false,
});

/**
 * One answer folded into the view. The key check (`search|page`) drops an answer for another
 * search or another page. It cannot tell two visits of the same search waiting on the same page
 * apart: the abort guard drops a late answer of the earlier visit. The two together keep any old
 * page out. A later page appends only the items not already shown: someone who switches
 * FightBook on between two reads shifts the pages by one, and the next page would repeat an item
 * (and its React key).
 */
function withAnswer<T>(
  view: View<T>,
  search: string,
  page: number,
  answer: Paged<T> | 'failed',
  idOf: (item: T) => string,
): View<T> {
  if (view.search !== search || view.page !== page) return view;
  if (answer === 'failed') return { ...view, failed: true };
  const seen = new Set(view.items?.map(idOf));
  const added = answer.items.filter((item) => !seen.has(idOf(item)));
  const items = [...(view.items ?? []), ...added];
  return { ...view, answered: page, items, more: answer.more, failed: false };
}

/**
 * A list read page by page: the one owner of "Show more" for FightBook (Find, Thank-yous). Page 0
 * is read at once; `showMore` reads the next while the last answer said `more`, and only once that
 * answer is in.
 *
 * Every new `search` key starts at page 0 with no list, a return to an earlier search too: the
 * view is kept with the search it belongs to, and a render that finds another search sets a fresh
 * view (React's "state from the previous render" pattern; that render is redone before anything
 * shows or reads). The race: Hugo taps "Show more", then types a name before that page answers.
 * Two guards: the new search aborts the read, and an aborted read writes nothing; an answer that
 * still lands for another search or page is checked against the view's own key and dropped.
 * `readPage` may change every render: the effect reads the latest through a ref and runs only when
 * `search`, the page or a retry changes, so `search` must name everything `readPage` closes over.
 */
export function usePagedList<T>(
  search: string,
  readPage: (page: number, signal: AbortSignal) => Promise<FightBookRead<Paged<T>>>,
  idOf: (item: T) => string,
) {
  const [view, setView] = useState<View<T>>(() => fresh(search));
  const [attempt, setAttempt] = useState(0);
  if (view.search !== search) setView(fresh(search));
  const page = view.page;
  const latest = useRef({ readPage, idOf });
  useEffect(() => {
    latest.current = { readPage, idOf };
  });

  useEffect(() => {
    const controller = new AbortController();
    void latest.current.readPage(page, controller.signal).then((read) => {
      if (controller.signal.aborted || read.kind === 'aborted') return;
      if (read.kind === 'signin') return signInAgainHere();
      const answer = read.kind === 'data' ? read.data : 'failed';
      setView((now) => withAnswer(now, search, page, answer, latest.current.idOf));
    });
    return () => controller.abort();
  }, [search, page, attempt]);

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
