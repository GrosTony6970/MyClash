'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '../../src/i18n/I18nProvider';

/**
 * Name search for the organiser directory.
 *
 * Writes to the URL rather than holding results in state, exactly like
 * EventFilterBar: the page above is a server component reading `searchParams`,
 * so a filtered view stays a shareable, server-rendered, indexable link. This
 * component owns only the draft text.
 */
export function OrganiserSearchBar({ q, resultCount }: { q: string; resultCount: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState(q);
  const committed = useRef(q);

  // Adopt the URL's value when it changes underneath us (back/forward, or
  // Clear), but never clobber what the user is mid-way through typing.
  useEffect(() => {
    if (q !== committed.current) {
      committed.current = q;
      setDraft(q);
    }
  }, [q]);

  function commit(next: string) {
    committed.current = next;
    const trimmed = next.trim();
    // Dropping `offset` on a new search is the point: page 3 of the old result
    // set is meaningless against the new one.
    startTransition(() => {
      router.replace(trimmed ? `${pathname}?q=${encodeURIComponent(trimmed)}` : pathname, {
        scroll: false,
      });
    });
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        commit(draft);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="sr-only" htmlFor="organiser-search">
        {t('publicApp.organisers.searchLabel')}
      </label>
      <input
        id="organiser-search"
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t('publicApp.organisers.searchPlaceholder')}
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 sm:max-w-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-default"
      >
        {t('publicApp.organisers.searchLabel')}
      </button>
      {q && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            commit('');
          }}
          className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground-secondary transition-colors hover:border-accent/60 hover:bg-accent/10"
        >
          {t('publicApp.organisers.clear')}
        </button>
      )}
      <span aria-live="polite" className="text-xs text-muted">
        {t('publicApp.organisers.resultCount', { count: resultCount })}
      </span>
    </form>
  );
}
