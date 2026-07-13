'use client';

import { MetricCard, StatsGrid } from '@myclash/ui';
import type { EventRollup } from './types';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The event-wide rollup band — the reference page's 6 headline tiles. */
export function EventStatBand({ event, t }: { event: EventRollup; t: Translate }) {
  return (
    <StatsGrid cols={3}>
      <MetricCard
        label={t('organizer.eventStats.band.participants')}
        value={String(event.participantCount)}
        detail={t('organizer.eventStats.band.participantsHint', { count: event.tournamentCount })}
      />
      <MetricCard
        label={t('organizer.eventStats.band.tournaments')}
        value={String(event.tournamentCount)}
      />
      <MetricCard label={t('organizer.eventStats.band.matches')} value={String(event.matchCount)} />
      <MetricCard
        label={t('organizer.eventStats.band.doubles')}
        value={`${event.doublesPercent}%`}
        detail={t('organizer.eventStats.band.doublesHint')}
      />
      <MetricCard label={t('organizer.eventStats.band.clubs')} value={String(event.clubCount)} />
      <MetricCard
        label={t('organizer.eventStats.band.completion')}
        value={`${event.completionPercent}%`}
        detail={t('organizer.eventStats.band.completionHint', {
          completed: event.completedMatchCount,
          total: event.matchCount,
        })}
      />
    </StatsGrid>
  );
}
