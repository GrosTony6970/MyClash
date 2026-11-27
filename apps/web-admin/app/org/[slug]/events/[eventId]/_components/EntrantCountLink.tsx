'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { withTournament } from '@/lib/tournament-choice';
import { formatCountOfMax } from '../format-count-of-max';
import type { EntrantKind } from '../tournaments/_shared/entrant-kind';

/**
 * A Tournament's entrants against its cap, on the Event dashboard, linked to where they are made:
 * an individual Tournament's Fighters on the Persons page, a team Tournament's teams on the Teams
 * page, worded as teams (`entrantCount` counts them there, `events.service.ts`).
 */
export function EntrantCountLink({
  tournament,
  base,
  className,
}: {
  tournament: {
    id: string;
    entrantKind: EntrantKind;
    entrantCount: number;
    maxParticipants: number | null;
  };
  /** The Event's admin address, `/org/:slug/events/:eventId`. */
  base: string;
  className: string;
}) {
  const { t } = useI18n();
  const count = formatCountOfMax(tournament.entrantCount, tournament.maxParticipants);
  const team = tournament.entrantKind === 'team';
  return (
    <Link
      href={withTournament(`${base}/${team ? 'teams' : 'persons'}`, tournament.id)}
      className={className}
    >
      {team ? t('organizer.eventHub.dashboard.teamCount', { count }) : count}
    </Link>
  );
}
