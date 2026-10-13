/**
 * Public tournaments full list — the "see full list" target from the event
 * home's Tournaments section. Mirrors the /workshops list layout.
 */

import { createTranslator, getMessages } from '@myclash/i18n';
import { getServerApiUrl } from '@/lib/api-url';
import { titled } from '@/lib/page-metadata';
import { BackLink } from '@/components/BackLink';
import { EventHeader } from '../_components/EventHeader';
import { eventOrNotFound } from '../_lib/event-or-not-found';
import { resolveServerLocale } from '@myclash/next-i18n/server';
import { fetchTournaments } from '../home/_lib/public-event-data';
import { TournamentCard } from '../home/_components/TournamentCard';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

export const generateMetadata = titled('publicApp.titles.tournaments');

export default async function TournamentsListPage({ params }: Props) {
  const { eventSlug } = await params;
  const apiUrl = getServerApiUrl();
  const locale = await resolveServerLocale();
  const tr = createTranslator(getMessages(locale));
  const event = await eventOrNotFound(eventSlug);
  const tournaments = await fetchTournaments(event.id, apiUrl);
  const tz = event.timezone;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:max-w-6xl">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={tr('publicApp.eventHome.backToHome')}
        className="mb-1"
      />
      <EventHeader event={event} locale={locale} eventSlug={eventSlug} />
      <section>
        <h1 className="mb-4 font-display text-2xl font-bold text-foreground sm:text-3xl">
          {tr('publicApp.eventHome.section.tournaments')}
        </h1>
        {tournaments.length === 0 ? (
          <p className="text-sm text-muted">{tr('publicApp.eventHome.tournaments.empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                eventSlug={eventSlug}
                tz={tz}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
