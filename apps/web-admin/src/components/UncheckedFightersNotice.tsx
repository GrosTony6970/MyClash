'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * The rule-8 notice of a team Pool (CLAUDE.md rule 8; ADR-016, 2026-11-13; design decision 11).
 * A team's slots have no names in slice 1b-1, so the one checker cannot stop one of its Fighters
 * being booked to referee while the team fights. The screens that assign referees say so.
 *
 * A note, not a verdict: it blocks nothing, and it is not a fourth level beside Impossible,
 * Discouraged and Fine. So it takes the info ink, not the danger or warning one.
 */
export function UncheckedFightersNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <p
      role="note"
      className={[
        'border border-info/30 bg-info/10 text-info',
        compact ? 'rounded-md px-2 py-1 text-xs' : 'rounded-xl px-4 py-3 text-sm',
      ].join(' ')}
    >
      {t('organizer.refereesPage.uncheckedFighters')}
    </p>
  );
}
