'use client';

import { useI18n } from '@myclash/next-i18n/client';
import {
  groupMatchesForDisplay,
  needsTournamentHeadings,
} from '../../../../src/components/group-matches-for-display';
import type { LiceMatch } from '../../../../src/components/lice-match-types';
import { LiceMatchCard } from './LiceMatchCard';

/**
 * A list of bouts, split under the tournament each belongs to.
 *
 * A busy piste runs two or three tournaments back to back, and a flat list of
 * twenty bouts gives the operator no way to see where one ends and the next
 * begins. On a single-tournament piste the headings are suppressed entirely —
 * one heading repeated over every row is noise, not structure.
 *
 * Shared by NEXT and by the "all matches" fold so the two can never disagree
 * about how the day is divided.
 */
export function GroupedMatchList({
  matches,
  compact = false,
}: {
  matches: LiceMatch[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const groups = groupMatchesForDisplay(matches);
  const showHeadings = needsTournamentHeadings(groups);

  if (!showHeadings) {
    return (
      <div className="flex flex-col gap-2">
        {matches.map((match) => (
          <LiceMatchCard key={match.id} match={match} compact={compact} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.tournamentId ?? '__none__'} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary">
            {group.tournamentName ?? t('scoring.lice.otherMatches')}
          </h3>
          {group.matches.map((match) => (
            <LiceMatchCard key={match.id} match={match} compact={compact} />
          ))}
        </div>
      ))}
    </div>
  );
}
