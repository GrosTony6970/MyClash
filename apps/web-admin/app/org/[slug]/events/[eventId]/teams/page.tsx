'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { AdminPageHeader, EmptyState, SegmentedTabs, TournamentColorDot } from '@myclash/ui';
import { failureMessage } from '@myclash/api-client';
import { useParams } from 'next/navigation';
import { EventCrumb, OrgCrumb } from '@/components/Crumbs';
import { PageAlert, errorOutcome } from '@/components/PageAlert';
import { useTournamentChoice } from '@/hooks/useTournamentChoice';
import { useEventStatus } from '../_hooks/useEventStatus';
import { TeamsPanel } from './_components/TeamsPanel';
import type { TeamTournament } from './team-form';
import { useTeamTournaments } from './useTeams';

/** A team Tournament's tab: its colour and its name. */
const tabOf = (tour: TeamTournament) => ({
  value: tour.id,
  label: (
    <span className="inline-flex items-center gap-2">
      <TournamentColorDot color={tour.color} size="sm" />
      {tour.name}
    </span>
  ),
});

/**
 * The teams of the Event's team Tournaments (Team Tournaments, slice 1b-1; design decision 10).
 * One Tournament at a time, picked as the other Event pages pick it (`useTournamentChoice`). The
 * Event menu offers this page only for an Event with a team Tournament; opened by a link on one
 * without, it says so.
 */
export default function EventTeamsPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);
  const { tournaments, failure } = useTeamTournaments(eventId);
  const [chosen, choose] = useTournamentChoice(
    eventId,
    (tournaments ?? []).map((x) => x.id),
  );
  const tournament = tournaments?.find((x) => x.id === chosen) ?? null;
  const refused = failure ? failureMessage(failure, t, t('organizer.tournaments.loadError')) : null;
  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <OrgCrumb slug={slug} className="hover:text-foreground-secondary" />
        <span>/</span>
        <EventCrumb
          slug={slug}
          eventId={eventId}
          className="hover:text-foreground-secondary"
          fallback={t('organizer.shell.nav.eventOverview')}
        />
      </div>
      <AdminPageHeader
        title={t('organizer.teams.title')}
        subtitle={t('organizer.teams.subtitle')}
      />
      <PageAlert outcome={refused ? errorOutcome(refused) : null} className="mb-6" />
      {tournaments?.length === 0 && (
        <EmptyState
          title={t('organizer.teams.noTeamTournament')}
          description={t('organizer.teams.noTeamTournamentHint')}
        />
      )}
      {tournaments && tournaments.length > 1 && (
        <SegmentedTabs
          aria-label={t('organizer.teams.tournamentTabs')}
          className="mb-4"
          value={chosen}
          onChange={choose}
          tabs={tournaments.map(tabOf)}
        />
      )}
      {tournament && (
        <TeamsPanel key={tournament.id} tournament={tournament} readOnly={isReadOnly} />
      )}
    </main>
  );
}
