/**
 * Public tournament schedule — the day-by-day agenda of every scheduled
 * tournament. Linked from the event home's Schedule section.
 */

import type { Metadata } from 'next';
import { t as tr } from '@myclash/i18n';
import { getApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { EventHeader, fetchEventInfo } from '../../_components/EventHeader';
import { fetchTournaments } from '../../home/_lib/public-event-data';
import { buildTournamentEntries } from '../../home/_lib/schedule-entries';
import { ScheduleAgenda } from '../../home/_components/ScheduleAgenda';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Tournament schedule — ${eventSlug}` };
}

export default async function TournamentSchedulePage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getApiUrl();
  const event = await fetchEventInfo(eventSlug, apiUrl);
  const tournaments = await fetchTournaments(event?.id ?? '', apiUrl);
  const entries = buildTournamentEntries(tournaments, eventSlug);
  const tz = event?.timezone ?? 'Europe/Paris';

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={tr('publicApp.eventHome.backToHome')}
        className="mb-1"
      />
      {event && <EventHeader event={event} />}
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
          {tr('publicApp.eventHome.schedule.viewTournamentSchedule')}
        </h1>
        <ScheduleAgenda
          entries={entries}
          tz={tz}
          emptyLabel={tr('publicApp.eventHome.schedule.notScheduled')}
        />
      </section>
    </main>
  );
}
