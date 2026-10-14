'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { useMatchListFilters } from './useMatchListFilters';

/** The bouts tab's filter field and "Hide completed" (O29). */
export function MatchListFilterBar({
  query,
  hideDone,
  setQuery,
  setHideDone,
}: ReturnType<typeof useMatchListFilters>) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-wrap items-center gap-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label={t('organizer.pools.matches.filterLabel')}
        placeholder={t('organizer.pools.matches.filterPlaceholder')}
        className="w-full max-w-xs rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
      />
      <label className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
        <input
          type="checkbox"
          checked={hideDone}
          onChange={(event) => setHideDone(event.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        {t('organizer.pools.matches.hideCompleted')}
      </label>
    </div>
  );
}
