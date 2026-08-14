'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CountryCombobox } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { directoryHref, withFilter, type DirectoryFilters } from './directory-filters';

/** A round trip per character would be unusable; a pause is the signal. */
const DEBOUNCE_MS = 300;

export interface WeaponOption {
  slug: string;
  name: string;
}

/**
 * A text filter that is typed locally and committed to the URL on a pause.
 *
 * The text inputs are the controls that cannot commit per keystroke — a round
 * trip per character would be unusable. Everything else writes the URL
 * directly, so `filters` stays the single source of truth for them.
 *
 * Two of them behave identically, so this exists once rather than twice: the
 * draft/committed dance is subtle (adopt the URL's value on back/forward or
 * Clear, but never clobber what the user is mid-way through typing) and two
 * copies of subtle is two places to fix it.
 */
function useDraftFilter(
  filters: DirectoryFilters,
  key: 'q' | 'club',
  commit: (next: DirectoryFilters) => void,
): [string, (value: string) => void] {
  const urlValue = filters[key] ?? '';
  const [draft, setDraft] = useState(urlValue);
  const committed = useRef(urlValue);

  useEffect(() => {
    if (urlValue !== committed.current) {
      committed.current = urlValue;
      setDraft(urlValue);
    }
  }, [urlValue]);

  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed === urlValue) return;
    const timer = setTimeout(() => {
      committed.current = trimmed;
      commit(withFilter(filters, key, trimmed === '' ? null : trimmed));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, filters, urlValue, key]);

  return [draft, setDraft];
}

/**
 * One control per column.
 *
 * Below `md` the table becomes cards, so these collapse into an expandable
 * panel rather than disappearing — a column whose filter is unreachable on a
 * phone is a column the phone reader cannot use.
 */
function ColumnFilters({
  open,
  filters,
  weapons,
  locale,
  t,
  draftClub,
  onDraftClub,
  onCommit,
}: {
  open: boolean;
  filters: DirectoryFilters;
  weapons: WeaponOption[];
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  draftClub: string;
  onDraftClub: (value: string) => void;
  onCommit: (next: DirectoryFilters) => void;
}) {
  const inputClass =
    'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div
      id="fighter-filter-panel"
      className={[
        'flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end',
        open ? 'flex' : 'hidden md:flex',
      ].join(' ')}
    >
      <div className="flex flex-col gap-1 sm:w-48">
        <label htmlFor="fighter-club" className="text-xs font-medium text-foreground-secondary">
          {t('publicApp.fighters.colClub')}
        </label>
        <input
          id="fighter-club"
          type="search"
          value={draftClub}
          onChange={(e) => onDraftClub(e.target.value)}
          placeholder={t('publicApp.fighters.clubPlaceholder')}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1 sm:w-48">
        <label htmlFor="fighter-country" className="text-xs font-medium text-foreground-secondary">
          {t('publicApp.fighters.colCountry')}
        </label>
        <CountryCombobox
          id="fighter-country"
          value={filters.country}
          locale={locale}
          aria-label={t('publicApp.fighters.colCountry')}
          onChange={(code) => onCommit(withFilter(filters, 'country', code))}
        />
      </div>

      <div className="flex flex-col gap-1 sm:w-48">
        <label htmlFor="fighter-weapon" className="text-xs font-medium text-foreground-secondary">
          {t('publicApp.fighters.colWeapons')}
        </label>
        <select
          id="fighter-weapon"
          value={filters.weapon ?? ''}
          onChange={(e) => onCommit(withFilter(filters, 'weapon', e.target.value || null))}
          className={inputClass}
        >
          <option value="">{t('publicApp.fighters.weaponAny')}</option>
          {weapons.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Directory filters. Every control writes the URL.
 *
 * The page above is a server component that reads `searchParams`, so a filtered
 * directory is a shareable link, is server-rendered, and stays indexable —
 * exactly how the events bar and /organisers already work. This component owns
 * only the two draft text inputs; everything else commits immediately.
 *
 * On mobile the per-column controls collapse into one expandable panel below
 * the search box, so no column's filter becomes unreachable when the table
 * turns into cards.
 */
export function FighterDirectoryFilters({
  filters,
  weapons,
  resultCount,
}: {
  filters: DirectoryFilters;
  weapons: WeaponOption[];
  resultCount: number;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panelOpen, setPanelOpen] = useState(false);

  const commit = useCallback(
    (next: DirectoryFilters) => {
      startTransition(() => {
        router.replace(directoryHref(next), { scroll: false });
      });
    },
    [router],
  );

  const [draftQ, setDraftQ] = useDraftFilter(filters, 'q', commit);
  const [draftClub, setDraftClub] = useDraftFilter(filters, 'club', commit);

  const inputClass =
    'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <section
      aria-labelledby="fighter-filters-label"
      className="flex flex-col gap-3"
      aria-busy={pending}
    >
      <h2 id="fighter-filters-label" className="sr-only">
        {t('publicApp.fighters.filtersLabel')}
      </h2>

      {/* One box, matching name OR club — the RPC scores both, so a reader who
          knows only the club does not need a different control to say so. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="fighter-search" className="sr-only">
          {t('publicApp.fighters.searchLabel')}
        </label>
        <input
          id="fighter-search"
          type="search"
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          placeholder={t('publicApp.fighters.searchPlaceholder')}
          className={inputClass}
        />
      </div>

      <button
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        aria-expanded={panelOpen}
        aria-controls="fighter-filter-panel"
        className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background md:hidden"
      >
        {t('publicApp.fighters.filtersToggle')}
      </button>

      <ColumnFilters
        open={panelOpen}
        filters={filters}
        weapons={weapons}
        locale={locale}
        t={t}
        draftClub={draftClub}
        onDraftClub={setDraftClub}
        onCommit={commit}
      />

      {/* Announced on change so a screen-reader user learns the list moved —
          the results themselves are re-rendered by the server, silently. */}
      <p role="status" className="text-xs text-muted">
        {t('publicApp.fighters.resultCount', { count: resultCount })}
      </p>
    </section>
  );
}
