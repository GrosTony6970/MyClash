'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { ThemeSwitcher } from '../../../../src/theme/ThemeSwitcher';

/**
 * Light-chrome header for a piste.
 *
 * `liceName` is rendered RAW. The organiser's own default naming already
 * produces "Lice 4", so the previous "Lice {name}" template rendered
 * "LICE LICE 4"; the /lices picker has always shown it raw, and this matches.
 */
export function LiceHeader({ liceName }: { liceName: string | null }) {
  const { t } = useI18n();
  return (
    <header className="border-b border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/lices"
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground-secondary hover:border-muted hover:bg-background"
        >
          ← {t('scoring.lice.yourLices')}
        </Link>
        <h1 data-testid="lice-title" className="text-base font-bold uppercase tracking-wide">
          {liceName ?? '—'}
        </h1>
        <div className="flex min-w-20 justify-end">
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}
