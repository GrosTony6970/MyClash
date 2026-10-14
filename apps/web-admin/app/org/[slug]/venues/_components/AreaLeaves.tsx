'use client';

import { useI18n } from '@myclash/next-i18n/client';

/** What a venue area holds, as the club's venue list names it (O25). */
export interface AreaLeaves {
  pistes: Array<{ name: string; event: string | null }>;
  sessions: Array<{ title: string; startsAt: string; event: string | null }>;
}

/**
 * The body of "Remove this area?": each Event piste and workshop session the area would leave
 * without an area, by name and Event (O25, ruled 2026-10-14), or that it holds none.
 */
export function AreaLeavesList({ leaves }: { leaves: AreaLeaves | undefined }) {
  const { t } = useI18n();
  const named = [
    ...(leaves?.pistes ?? []).map((piste) =>
      piste.event
        ? t('organizer.venues.areaLeavesPiste', { name: piste.name, event: piste.event })
        : piste.name,
    ),
    ...(leaves?.sessions ?? []).map((session) =>
      session.event
        ? t('organizer.venues.areaLeavesSession', { name: session.title, event: session.event })
        : session.title,
    ),
  ];
  if (named.length === 0) return <>{t('organizer.venues.areaLeavesNothing')}</>;
  return (
    <>
      {t('organizer.venues.areaLeavesIntro')}
      <ul className="mt-2 list-disc pl-5">
        {named.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </>
  );
}
