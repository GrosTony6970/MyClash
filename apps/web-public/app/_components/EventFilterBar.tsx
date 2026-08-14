'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CountryCombobox } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import {
  DEFAULT_CATALOG_TAB,
  hasAnyFilter,
  toCatalogQueryString,
  type CatalogTab,
  type EventFilters,
} from './event-filters';

export interface WeaponOption {
  slug: string;
  name: string;
}

/**
 * Filter controls for the public event catalogue.
 *
 * Writes to the URL rather than holding results in state: the page above is a
 * server component that reads `searchParams`, so a filtered view is a
 * shareable link, is server-rendered, and stays indexable. This component owns
 * only the draft text input; everything else commits immediately.
 */
export function EventFilterBar({
  filters,
  weapons,
  resultCount,
  tab = DEFAULT_CATALOG_TAB,
}: {
  filters: EventFilters;
  weapons: WeaponOption[];
  resultCount: number;
  /**
   * Re-emitted by every commit. `commit` rebuilds the whole query string, and
   * the debounced search calls it once per keystroke — so a tab this component
   * cannot see is a tab it erases, one character at a time.
   */
  tab?: CatalogTab;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // The text input is the one control that can't commit per keystroke — a
  // round trip per character would be unusable. Everything else writes the URL
  // directly, so `filters` stays the single source of truth for them.
  const [draftQ, setDraftQ] = useState(filters.q ?? '');
  const committedQ = useRef(filters.q ?? '');

  // Adopt the URL's value when it changes underneath us (back/forward, or
  // Clear), but never clobber what the user is mid-way through typing.
  useEffect(() => {
    const incoming = filters.q ?? '';
    if (incoming !== committedQ.current) {
      committedQ.current = incoming;
      setDraftQ(incoming);
    }
  }, [filters.q]);

  function commit(next: EventFilters) {
    committedQ.current = next.q ?? '';
    const qs = toCatalogQueryString(next, tab);
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    const trimmed = draftQ.trim();
    if (trimmed === (filters.q ?? '')) return;
    const timer = setTimeout(() => {
      commit({ ...filters, q: trimmed === '' ? null : trimmed });
    }, 300);
    return () => clearTimeout(timer);
    // `commit` is stable enough for this: it closes over router/pathname and
    // `tab`, all of which are re-read from props on every render anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQ, filters, tab]);

  const showClear = hasAnyFilter(filters);

  return (
    <section
      aria-labelledby="public-events-filters-label"
      className="flex flex-col gap-3"
      aria-busy={pending}
    >
      <h2
        id="public-events-filters-label"
        className="text-xs font-semibold uppercase tracking-wider text-muted"
      >
        {t('publicApp.home.searchLabel')}
      </h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1 sm:min-w-[16rem] sm:flex-1">
          <label htmlFor="public-events-search" className="sr-only">
            {t('publicApp.home.searchLabel')}
          </label>
          <input
            id="public-events-search"
            type="search"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder={t('publicApp.home.searchPlaceholder')}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div className="flex flex-col gap-1 sm:w-48">
          <label
            htmlFor="public-events-country"
            className="text-xs font-medium text-foreground-secondary"
          >
            {t('publicApp.home.filterCountryLabel')}
          </label>
          <CountryCombobox
            id="public-events-country"
            value={filters.country}
            locale={locale}
            aria-label={t('publicApp.home.filterCountryLabel')}
            onChange={(code) => commit({ ...filters, country: code })}
          />
        </div>

        <div className="flex flex-col gap-1 sm:w-48">
          <label
            htmlFor="public-events-weapon"
            className="text-xs font-medium text-foreground-secondary"
          >
            {t('publicApp.home.filterWeaponLabel')}
          </label>
          <select
            id="public-events-weapon"
            value={filters.weapon ?? ''}
            onChange={(e) => commit({ ...filters, weapon: e.target.value || null })}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">{t('publicApp.home.filterWeaponAny')}</option>
            {weapons.map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="public-events-from"
            className="text-xs font-medium text-foreground-secondary"
          >
            {t('publicApp.home.filterFromLabel')}
          </label>
          <input
            id="public-events-from"
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => commit({ ...filters, from: e.target.value || null })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="public-events-to"
            className="text-xs font-medium text-foreground-secondary"
          >
            {t('publicApp.home.filterToLabel')}
          </label>
          <input
            id="public-events-to"
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => commit({ ...filters, to: e.target.value || null })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        {showClear && (
          <button
            type="button"
            onClick={() => commit({ q: null, country: null, weapon: null, from: null, to: null })}
            className="self-start rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-foreground-secondary hover:bg-background sm:self-auto"
          >
            {t('publicApp.home.filterClear')}
          </button>
        )}
      </div>

      {/* Announced on change so a screen-reader user learns the list moved —
          the results themselves are re-rendered by the server, silently. */}
      <p role="status" className="text-xs text-muted">
        {t('publicApp.home.filterResultCount', { count: resultCount })}
      </p>
    </section>
  );
}
