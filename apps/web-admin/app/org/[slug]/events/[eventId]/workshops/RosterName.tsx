'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * The name line of a Workshop roster row: the person's name, a "Guest" tag when no
 * account holds the roster row (operator ruling 264), and the club.
 */
export function RosterName({
  name,
  guest,
  club,
}: {
  /** `null` when the booking's roster row is gone. */
  name: string | null;
  guest: boolean;
  club: string | null;
}) {
  const { t } = useI18n();
  return (
    // min-w-0 on every link of the chain, or the club overflows the row.
    <p className="flex min-w-0 items-baseline gap-1.5 font-medium text-foreground">
      <span className="truncate">{name ?? t('organizer.workshopsPage.unknownPerson')}</span>
      {guest && (
        <span className="shrink-0 rounded bg-border px-1.5 py-0.5 text-xs font-medium text-foreground-secondary">
          {t('organizer.workshopsPage.guestTag')}
        </span>
      )}
      {club && (
        <span className="min-w-0 shrink-[9999] truncate text-xs font-normal text-muted">
          {club}
        </span>
      )}
    </p>
  );
}
