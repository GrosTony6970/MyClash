/**
 * Public tournament schedule — a polished, read-only timeline of the event's
 * tournament matches (lices × time, pool/bracket blocks, break bars), mirroring
 * the organizer's Event Command Center board. Linked from the event home's
 * Schedule section.
 */

import type { Metadata } from 'next';
import { createTranslator, getMessages } from '@myclash/i18n';
import { getServerApiUrl } from '@/lib/api-url';
import { BackLink } from '@/components/BackLink';
import { EventHeader, fetchEventInfo } from '../../_components/EventHeader';
import { resolveServerLocale } from '@myclash/next-i18n/server';
import { loadTournamentSchedule } from './_lib/schedule-grid-data';
import { TournamentScheduleGrid } from './_components/TournamentScheduleGrid';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  return { title: `Tournament schedule — ${eventSlug}` };
}

export default async function TournamentSchedulePage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tr = createTranslator(getMessages(locale));
  const [event, schedule] = await Promise.all([
    fetchEventInfo(eventSlug, apiUrl),
    loadTournamentSchedule(eventSlug, apiUrl),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={tr('publicApp.eventHome.backToHome')}
        className="mb-1"
      />
      {event && <EventHeader event={event} locale={locale} eventSlug={eventSlug} />}
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold text-foreground sm:text-3xl">
          {tr('publicApp.eventHome.schedule.viewTournamentSchedule')}
        </h1>
        {schedule ? (
          <TournamentScheduleGrid
            data={schedule}
            eventSlug={eventSlug}
            emptyLabel={tr('publicApp.eventHome.schedule.notScheduled')}
          />
        ) : (
          <p className="text-sm text-muted">{tr('publicApp.eventHome.schedule.notScheduled')}</p>
        )}
      </section>
    </main>
  );
}
