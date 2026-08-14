'use client';

import Link from 'next/link';
import { EmptyState } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { FighterDirectoryTable } from '../fighters/FighterDirectoryTable';
import { DEFAULT_DIRECTORY_FILTERS } from '../fighters/directory-filters';
import type { DirectoryApiFighter } from '../fighters/fighter-row-model';

/**
 * The catalogue's Fighters tab: a preview, not the directory.
 *
 * It shows the first handful and links through, mirroring how the Leagues tab
 * hands off. Reproducing the directory here would mean two implementations of
 * filtering, sorting and paging over one dataset — and the second one is always
 * the one that forgets somebody's opt-out. It renders through the SAME
 * `FighterDirectoryTable`, so the row model, the mobile/desktop split and the
 * visibility rules are shared rather than re-derived.
 *
 * Sorting from here would be a lie: the preview is one unsorted page of a larger
 * set, so a header that reordered these rows would claim to have ordered the
 * whole directory. The table is handed the DEFAULT filters and the reader is
 * sent to /fighters to do anything more.
 */
export function PublicFightersPreview({ fighters }: { fighters: DirectoryApiFighter[] }) {
  const { t } = useI18n();

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground sm:text-xl">
          {t('publicApp.fighters.title')}
        </h2>
        <Link
          href="/fighters"
          className="text-sm font-semibold text-accent hover:text-accent-hover hover:underline"
        >
          {t('publicApp.fighters.browseCta')}
        </Link>
      </div>

      {fighters.length === 0 ? (
        <EmptyState
          title={t('publicApp.fighters.empty')}
          description={t('publicApp.fighters.emptyHint')}
        />
      ) : (
        <FighterDirectoryTable fighters={fighters} filters={DEFAULT_DIRECTORY_FILTERS} />
      )}
    </section>
  );
}
