'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { RefereeReasons } from '@/components/RefereeReasons';
import type { RefereeConflictEntry } from '@/lib/referee-reasons';

/**
 * The Pools page's referee verdicts (hard rule 8, ADR-016): the one checker's answer over
 * the whole Event, kept to what concerns this Tournament — its own duties, and another
 * Tournament's crews whose referee fights here at the same time.
 *
 * Red when any duty is Impossible (reassign before publishing), amber when only
 * Discouraged ones wait for a confirmation. A reason the organiser already confirmed over
 * is listed grey (ruling 135); the caller shows no banner when nothing else is left.
 */
export function RefereeVerdictBanner({ conflicts }: { conflicts: RefereeConflictEntry[] }) {
  const { t } = useI18n();
  const red = conflicts.some((c) => c.level === 'impossible');
  return (
    <div
      className={[
        'border rounded-xl px-4 py-3 text-sm',
        red ? 'bg-danger/10 border-danger/30' : 'bg-warning/10 border-warning/30',
      ].join(' ')}
    >
      <p className={`font-bold mb-1 ${red ? 'text-danger' : 'text-warning'}`}>
        {red
          ? t('organizer.pools.page.refereeImpossibleTitle')
          : t('organizer.pools.page.refereeDiscouragedTitle')}
      </p>
      <ul className="list-disc list-inside space-y-0.5">
        {conflicts.map((c) => (
          <li key={`${c.assignmentId}:${c.role}`}>
            <strong>{c.personName}</strong> — {c.unitName}: <RefereeReasons reasons={c.reasons} />
          </li>
        ))}
      </ul>
      {red && (
        <p className="mt-2 font-medium text-danger">
          {t('organizer.pools.page.conflictsReassignHint')}
        </p>
      )}
    </div>
  );
}
